"""Extension View Panel - renders an extension's activity-bar view container.

Shows the views (tree views) contributed by an extension, populated live from
the extension's TreeDataProvider running in the Node extension host. Clicking a
tree item runs its associated command, mirroring VS Code behaviour.
"""

import threading

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem,
)
from PySide6.QtCore import Signal, Qt, QSize


class _ViewSection(QWidget):
    """A single collapsible tree view inside a container."""

    command_invoked = Signal(str, list)     # command id, arguments
    load_requested = Signal(str, str, object)  # view_id, element_id, tree_item

    def __init__(self, view_id: str, name: str, parent=None):
        super().__init__(parent)
        self._view_id = view_id
        self._name = name
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QLabel(self._name.upper())
        header.setStyleSheet(
            "color: #bbbbbb; font-size: 11px; font-weight: 600; letter-spacing: 0.6px;"
            " padding: 6px 12px; background-color: #000000;"
        )
        layout.addWidget(header)

        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(14)
        self._tree.setVerticalScrollMode(QTreeWidget.ScrollPerPixel)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000; border: none; color: #cccccc;
                font-family: "Segoe UI", sans-serif; font-size: 12px; outline: none;
            }
            QTreeWidget::item { padding: 3px 4px; border: none; }
            QTreeWidget::item:selected { background-color: #04395e; color: #ffffff; }
            QTreeWidget::item:hover:!selected { background-color: #1a1a1a; }
        """)
        self._tree.itemClicked.connect(self._on_item_clicked)
        self._tree.itemExpanded.connect(self._on_item_expanded)
        layout.addWidget(self._tree)

    def view_id(self) -> str:
        return self._view_id

    def clear(self):
        self._tree.clear()

    def set_status(self, text: str):
        self._tree.clear()
        item = QTreeWidgetItem([text])
        item.setForeground(0, Qt.gray)
        item.setFlags(Qt.NoItemFlags)
        self._tree.addTopLevelItem(item)

    def populate(self, parent_id: str, items: list):
        """Fill children under the given parent node (empty parent_id = root)."""
        parent_widget_item = None
        if parent_id:
            parent_widget_item = self._find_item(parent_id)
            if parent_widget_item is None:
                return
            parent_widget_item.takeChildren()
        else:
            self._tree.clear()

        if not items and not parent_id:
            self.set_status("(no items)")
            return

        for data in items:
            self._add_item(parent_widget_item, data)

    def _add_item(self, parent_widget_item, data: dict):
        label = data.get("label", "")
        desc = data.get("description", "")
        text = f"{label}   {desc}" if desc else label
        node = QTreeWidgetItem([text])
        node.setData(0, Qt.UserRole, data)
        tooltip = data.get("tooltip") or label
        if tooltip:
            node.setToolTip(0, tooltip)

        collapsible = data.get("collapsibleState", 0)
        if parent_widget_item is None:
            self._tree.addTopLevelItem(node)
        else:
            parent_widget_item.addChild(node)

        if collapsible:  # 1 = collapsed, 2 = expanded
            placeholder = QTreeWidgetItem(["Loading..."])
            placeholder.setForeground(0, Qt.gray)
            # UserRole stays None so expansion knows children aren't loaded yet
            node.addChild(placeholder)
            if collapsible == 2:
                node.setExpanded(True)

    def _find_item(self, node_id: str, root=None):
        parent = root
        count = (parent.childCount() if parent is not None
                 else self._tree.topLevelItemCount())
        for i in range(count):
            item = parent.child(i) if parent is not None else self._tree.topLevelItem(i)
            data = item.data(0, Qt.UserRole)
            if isinstance(data, dict) and data.get("id") == node_id:
                return item
            found = self._find_item(node_id, item)
            if found is not None:
                return found
        return None

    def _on_item_clicked(self, item: QTreeWidgetItem, _column: int):
        data = item.data(0, Qt.UserRole)
        if not isinstance(data, dict):
            return
        command = data.get("command")
        if command and command.get("command"):
            self.command_invoked.emit(command["command"], command.get("arguments", []))

    def _on_item_expanded(self, item: QTreeWidgetItem):
        data = item.data(0, Qt.UserRole)
        if not isinstance(data, dict):
            return
        # If the only child is the "Loading..." placeholder, fetch real children
        if item.childCount() == 1:
            child = item.child(0)
            if child.data(0, Qt.UserRole) is None:
                self.load_requested.emit(self._view_id, data.get("id", ""), item)


class ExtensionViewPanel(QWidget):
    """Sidebar panel showing one extension activity-bar view container."""

    _items_ready = Signal(str, str, list)  # view_id, parent_id, items

    def __init__(self, container_info: dict, execute_command_cb=None, parent=None):
        super().__init__(parent)
        self._info = container_info
        self._execute_command_cb = execute_command_cb
        self._sections = {}
        self._loaded_once = False
        self.setObjectName("extensionViewPanel")
        self.setStyleSheet("background-color: #000000;")
        self._items_ready.connect(self._on_items_ready)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        container = self._info.get("container")
        title = getattr(container, "title", "") or self._info.get("ext_name", "Extension")

        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        hl = QHBoxLayout(header)
        hl.setContentsMargins(20, 0, 8, 0)
        title_label = QLabel(title.upper())
        title_label.setStyleSheet(
            "color: #bbbbbb; font-size: 11px; font-weight: 600; letter-spacing: 1.2px;")
        hl.addWidget(title_label)
        hl.addStretch()

        refresh_btn = QPushButton("\u21bb")
        refresh_btn.setToolTip("Refresh")
        refresh_btn.setFixedSize(24, 24)
        refresh_btn.setCursor(Qt.PointingHandCursor)
        refresh_btn.setStyleSheet("""
            QPushButton { background: transparent; color: #cccccc; border: none; font-size: 14px; }
            QPushButton:hover { color: #ffffff; background-color: #1a1a1a; border-radius: 4px; }
        """)
        refresh_btn.clicked.connect(self.refresh)
        hl.addWidget(refresh_btn)
        layout.addWidget(header)

        views = self._info.get("views", [])
        if not views:
            empty = QLabel("This extension registers its view dynamically.\n"
                           "Open it via the Command Palette (Ctrl+Shift+P).")
            empty.setStyleSheet("color: #858585; font-size: 12px; padding: 16px;")
            empty.setWordWrap(True)
            empty.setAlignment(Qt.AlignCenter)
            layout.addWidget(empty)
            layout.addStretch()
            return

        for view in views:
            section = _ViewSection(view.id, view.name)
            section.command_invoked.connect(self._on_command)
            section.load_requested.connect(self._load_children)
            self._sections[view.id] = section
            layout.addWidget(section, 1)

    def showEvent(self, event):
        super().showEvent(event)
        if not self._loaded_once:
            self._loaded_once = True
            self.refresh()

    def refresh(self):
        for view_id, section in self._sections.items():
            section.set_status("Loading...")
            self._load_children(view_id, "", None)

    def _load_children(self, view_id: str, element_id: str, _item):
        def work():
            items = []
            try:
                from ..core.extension_host import get_extension_host
                host = get_extension_host()
                if host._ready:
                    items = host.get_tree_children(view_id, element_id or None)
            except Exception:
                items = []
            self._items_ready.emit(view_id, element_id or "", items)

        threading.Thread(target=work, daemon=True).start()

    def _on_items_ready(self, view_id: str, parent_id: str, items: list):
        section = self._sections.get(view_id)
        if section is None:
            return
        if not items and not parent_id:
            section.set_status("(no items)")
            return
        section.populate(parent_id, items)

    def _on_command(self, command_id: str, args: list):
        if self._execute_command_cb:
            self._execute_command_cb(command_id, args)
