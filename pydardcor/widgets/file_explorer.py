"""File Explorer - VS Code style file tree with file type icons."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem,
    QLabel, QPushButton, QHBoxLayout, QFileDialog, QMenu, QInputDialog,
    QMessageBox, QHeaderView, QStyledItemDelegate, QStyleOptionViewItem,
    QProxyStyle, QStyle,
)
from PySide6.QtCore import Signal, Qt, QSize, QPoint, QByteArray
from PySide6.QtGui import QAction, QColor, QPainter, QPixmap, QIcon, QPen, QFont, QPolygonF, QCursor
from PySide6.QtSvg import QSvgRenderer


class TreeBranchStyle(QProxyStyle):
    """Custom style that draws VS Code-style chevron branch indicators."""

    def drawPrimitive(self, element, option, painter, widget=None):
        if element == QStyle.PE_IndicatorBranch:
            painter.save()
            painter.setRenderHint(QPainter.Antialiasing)

            rect = option.rect
            cx = rect.x() + rect.width() // 2
            cy = rect.y() + rect.height() // 2

            # VS Code style chevron (lines, not solid triangle)
            pen = QPen(QColor("#858585"))
            pen.setWidth(2)
            pen.setCapStyle(Qt.RoundCap)
            pen.setJoinStyle(Qt.RoundJoin)
            painter.setPen(pen)
            painter.setBrush(Qt.NoBrush)

            if option.state & QStyle.State_Children:
                if option.state & QStyle.State_Open:
                    # v downward chevron
                    painter.drawLine(cx - 3, cy - 2, cx, cy + 2)
                    painter.drawLine(cx, cy + 2, cx + 3, cy - 2)
                else:
                    # > rightward chevron
                    painter.drawLine(cx - 2, cy - 3, cx + 2, cy)
                    painter.drawLine(cx + 2, cy, cx - 2, cy + 3)

            painter.restore()
            return

        super().drawPrimitive(element, option, painter, widget)


# VS Code Material Theme SVG Icons
SVG_FOLDER = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>'''

SVG_FOLDER_OPEN = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#D0A74F" d="M19 20H4c-1.11 0-2-.89-2-2V6c0-1.11.89-2 2-2h6l2 2h7c1.09 0 2 .89 2 2H4v10l2.14-8h17.07l-2.28 8.5c-.23.87-1.01 1.5-1.93 1.5z"/></svg>'''

SVG_FILE = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6d8086" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'''

SVG_PYTHON = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#387EB8" d="M12.01 1.99c-2.88 0-5.46.36-6.68.83-1.63.63-2.3 2.1-2.3 3.99v3.42h9.08v1H3.01v4.86c0 1.98.67 3.54 2.3 4.22 1.22.5 3.8.88 6.68.88h.01v-3.79c0-2.39 1.83-4.22 4.09-4.22h3.9V5.82c0-1.89-.67-3.36-2.3-3.99-1.22-.47-3.8-.84-6.68-.84zm-2.03 2.5a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z"/><path fill="#FFE052" d="M12.01 22.01c2.88 0 5.46-.36 6.68-.83 1.63-.63 2.3-2.1 2.3-3.99v-3.42h-9.08v-1h9.1v-4.86c0-1.98-.67-3.54-2.3-4.22-1.22-.5-3.8-.88-6.68-.88h-.01v3.79c0 2.39-1.83 4.22-4.09 4.22h-3.9v3.37c0 1.89.67 3.36 2.3 3.99 1.22.47 3.8.84 6.68.84zm2.03-2.5a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6z"/></svg>'''

SVG_GIT = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#F05032" d="M10.87 2.05L2.05 10.87c-.6.6-.6 1.57 0 2.17l8.82 8.82c.6.6 1.57.6 2.17 0l8.82-8.82c.6-.6.6-1.57 0-2.17l-8.82-8.82c-.6-.6-1.57-.6-2.17 0zM12 7c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5S11.17 7 12 7zm-5 5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zm10 0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zM12 12c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5z"/></svg>'''

SVG_MD = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#519aba" d="M2.5 5h19c.825 0 1.5.675 1.5 1.5v11c0 .825-.675 1.5-1.5 1.5h-19C1.675 19 1 18.325 1 17.5v-11C1 5.675 1.675 5 2.5 5zm15.5 11.5l4-4.5h-2.5V8h-3v4.5H14l4 4.5zM10.5 8H3v8h2v-4.5L7 14l2-2.5V16h1.5V8z"/></svg>'''

SVG_JSON = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FBC02D" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'''

SVG_TOML = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#CB3837" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>'''

SVG_HTML = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#E34F26" d="M1.5 2h21l-1.91 21.56L12 22l-8.59-1.56L1.5 2zm16.5 6H7.35l.22 2.5h10.21l-.47 5.25L12 17.15l-5.31-1.4-.35-3.8h2.5l.18 1.95L12 14.7l2.9-.8.29-3.4H6.57L5.9 3.5h12.1v2.5z"/></svg>'''

SVG_CSS = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1572B6" d="M1.5 2h21l-1.91 21.56L12 22l-8.59-1.56L1.5 2zm16.5 6H7.35l.22 2.5h10.21l-.47 5.25L12 17.15l-5.31-1.4-.35-3.8h2.5l.18 1.95L12 14.7l2.9-.8.29-3.4H6.57L5.9 3.5h12.1v2.5z"/></svg>'''

SVG_JS = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#F7DF1E" d="M1.5 2h21l-1.91 21.56L12 22l-8.59-1.56L1.5 2zm12.33 13.06c.39.69.91 1.25 1.7 1.25.75 0 1.22-.36 1.22-.89 0-.61-.49-.83-1.34-1.2l-.46-.2c-1.36-.57-2.27-1.33-2.27-2.91 0-1.51 1.13-2.73 3.03-2.73 1.54 0 2.53.64 3.08 1.73l-1.43.92c-.3-.59-.72-.88-1.42-.88-.66 0-1.04.34-1.04.8 0 .54.38.74 1.17 1.08l.46.2c1.61.69 2.47 1.39 2.47 3.03 0 1.7-1.28 2.87-3.32 2.87-2.09 0-3.32-1.06-3.83-2.31l1.71-.97zM8.33 13h1.83v2.83c0 .87-.41 1.42-1.33 1.42-.64 0-1.1-.38-1.31-.91L5.8 17.18c.55 1.11 1.49 1.71 3.04 1.71 2.03 0 3.16-1.12 3.16-3.08V8.12H8.33V13z"/></svg>'''

SVG_TS = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#3178C6" d="M1.5 2h21l-1.91 21.56L12 22l-8.59-1.56L1.5 2zm11.36 13h-2.12v-5.26H7.9v-1.63h6.84v1.63H12.86V15zm5.72-2.12c-.22.61-.64 1.05-1.36 1.05-.63 0-.97-.31-.97-.73 0-.5.44-.68 1.18-.94l.43-.16c1.17-.43 1.83-.98 1.83-2.13 0-1.27-.92-2.16-2.58-2.16-1.23 0-2.07.51-2.49 1.37l1.23.73c.24-.49.59-.71 1.14-.71.5 0 .79.25.79.62 0 .42-.31.57-.96.82l-.4.16c-1.29.5-2.07 1.06-2.07 2.29 0 1.33.99 2.19 2.64 2.19 1.63 0 2.53-.84 2.86-1.92l-1.32-.47z"/></svg>'''

SVG_SHELL = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4CAF50" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-8v-2h8v2zm0-4h-8v-2h8v2zm0-4h-8V7h8v2z"/></svg>'''

SVG_IMAGE = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4CAF50" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>'''

def _render_svg(svg_bytes: bytes, size: int = 16) -> QIcon:
    renderer = QSvgRenderer(QByteArray(svg_bytes))
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    renderer.render(painter)
    painter.end()
    return QIcon(pixmap)


def get_file_icon(filepath: str) -> QIcon:
    """Get appropriate SVG icon for a file."""
    name = os.path.basename(filepath).lower()
    ext = os.path.splitext(name)[1]

    if name in (".gitignore", ".git"):
        return _render_svg(SVG_GIT)
    if name.endswith(".md"):
        return _render_svg(SVG_MD)
    if name.endswith(".json"):
        return _render_svg(SVG_JSON)
    if name.endswith(".toml"):
        return _render_svg(SVG_TOML)
    if ext in (".py", ".pyc", ".pyw"):
        return _render_svg(SVG_PYTHON)
    if ext in (".html", ".htm"):
        return _render_svg(SVG_HTML)
    if ext == ".css":
        return _render_svg(SVG_CSS)
    if ext == ".js":
        return _render_svg(SVG_JS)
    if ext == ".ts":
        return _render_svg(SVG_TS)
    if ext in (".sh", ".bat", ".cmd", ".ps1"):
        return _render_svg(SVG_SHELL)
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".bmp", ".ico"):
        return _render_svg(SVG_IMAGE)
    
    return _render_svg(SVG_FILE)


def get_folder_icon(is_open: bool = False) -> QIcon:
    """Get appropriate SVG icon for a folder."""
    if is_open:
        return _render_svg(SVG_FOLDER_OPEN)
    return _render_svg(SVG_FOLDER)


class FileExplorer(QWidget):
    file_selected = Signal(str)
    root_changed = Signal(str)

    def __init__(self, root_path: str = None, parent=None):
        super().__init__(parent)
        self._root_path = root_path or os.path.expanduser("~")
        self._git_status = {}
        self._git_folders = set()
        self._in_inline_edit = False
        self.setObjectName("fileExplorer")
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("""
            background-color: #000000;
            border-bottom: 1px solid #000000;
        """)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(20, 0, 8, 0)
        header_layout.setSpacing(4)

        title = QLabel("EXPLORER")
        title.setStyleSheet("""
            color: #bbbbbb;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 1.2px;
        """)
        header_layout.addWidget(title)
        header_layout.addStretch()

        # Action buttons
        for icon_text, tooltip, callback in [
            ("\u2026", "More Actions", None),
        ]:
            btn = QPushButton(icon_text)
            btn.setFixedSize(22, 22)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: none;
                    color: #bbbbbb;
                    font-size: 14px;
                    border-radius: 3px;
                }
                QPushButton:hover {
                    background-color: rgba(90, 93, 94, 0.31);
                    color: #ffffff;
                }
            """)
            if callback:
                btn.clicked.connect(callback)
            header_layout.addWidget(btn)

        layout.addWidget(header)

        # Workspace label
        ws_header = QWidget()
        ws_header.setFixedHeight(22)
        ws_header.setStyleSheet("background-color: #000000;")
        ws_layout = QHBoxLayout(ws_header)
        ws_layout.setContentsMargins(10, 0, 4, 0)
        ws_layout.setSpacing(4)

        self._ws_label = QLabel(os.path.basename(self._root_path).upper())
        self._ws_label.setStyleSheet("""
            color: #cccccc;
            font-size: 11px;
            font-weight: bold;
        """)
        ws_layout.addWidget(self._ws_label)
        ws_layout.addStretch()

        for icon_text, tooltip, callback in [
            ("+", "New File", self._new_file),
            ("\U0001F4C1", "New Folder", self._new_folder),
            ("\u21BB", "Refresh", self._refresh),
            ("\U0001F4C2", "Open Folder", self._open_folder),
        ]:
            btn = QPushButton(icon_text)
            btn.setFixedSize(20, 20)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    border: none;
                    color: #cccccc;
                    font-size: 11px;
                    border-radius: 3px;
                }
                QPushButton:hover {
                    background-color: rgba(90, 93, 94, 0.31);
                    color: #ffffff;
                }
            """)
            btn.clicked.connect(callback)
            ws_layout.addWidget(btn)

        layout.addWidget(ws_header)

        # Tree widget
        self._tree = QTreeWidget()
        self._tree.setStyle(TreeBranchStyle())
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(20)
        self._tree.setAnimated(True)
        self._tree.setExpandsOnDoubleClick(True)
        self._tree.setRootIsDecorated(True)
        self._tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tree.customContextMenuRequested.connect(self._show_context_menu)
        self._tree.itemExpanded.connect(self._on_item_expanded)
        self._tree.itemCollapsed.connect(self._on_item_collapsed)
        self._tree.itemClicked.connect(self._on_item_clicked)
        self._tree.setIconSize(QSize(16, 16))

        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-family: "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
                font-size: 13px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 1px 4px;
                min-height: 22px;
                border: none;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover:!selected {
                background-color: #2a2d2e;
            }
            QTreeWidget::item:focus {
                background-color: #04395e;
                outline: none;
            }
        """)
        layout.addWidget(self._tree)

        self._tree.itemChanged.connect(self._on_item_changed)
        self._refresh()

    def _load_directory(self, path: str, parent_item: QTreeWidgetItem = None):
        try:
            entries = sorted(
                os.listdir(path),
                key=lambda x: (not os.path.isdir(os.path.join(path, x)), x.lower())
            )
        except (PermissionError, OSError):
            return

        for name in entries:
            if name.startswith(".") and name not in (".gitignore", ".env", ".dockerignore"):
                continue
            if name in ("__pycache__", "node_modules", ".git", ".venv", "venv"):
                continue

            full_path = os.path.join(path, name)
            item = QTreeWidgetItem()
            item.setText(0, name)
            item.setData(0, Qt.UserRole, full_path)
            item.setToolTip(0, full_path)

            # Git Status coloring
            try:
                rel_path = os.path.relpath(full_path, self._root_path)
                rel_path_norm = rel_path.replace("/", os.sep).replace("\\", os.sep)
            except Exception:
                rel_path_norm = ""

            is_dir = os.path.isdir(full_path)
            if is_dir:
                item.setIcon(0, get_folder_icon(False))
                item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                # Lazy load placeholder
                QTreeWidgetItem(item)
                
                # Color folder if it has changes inside
                if rel_path_norm in self._git_folders:
                    item.setForeground(0, QColor("#e2c08d"))
            else:
                item.setIcon(0, get_file_icon(full_path))
                
                # Color file based on its git status
                if rel_path_norm in self._git_status:
                    status = self._git_status[rel_path_norm]
                    if status == "M":
                        item.setForeground(0, QColor("#e2c08d"))  # Yellow for modified
                    elif status in ("A", "?"):
                        item.setForeground(0, QColor("#73c991"))  # Green for added/untracked

            if parent_item:
                parent_item.addChild(item)
            else:
                self._tree.addTopLevelItem(item)

    def _on_item_expanded(self, item: QTreeWidgetItem):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isdir(path):
            item.takeChildren()
            self._load_directory(path, item)
            item.setIcon(0, get_folder_icon(True))

    def _on_item_collapsed(self, item: QTreeWidgetItem):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isdir(path):
            item.setIcon(0, get_folder_icon(False))

    def _on_item_clicked(self, item: QTreeWidgetItem, column: int):
        path = item.data(0, Qt.UserRole)
        if not path:
            return
        if os.path.isfile(path):
            self.file_selected.emit(path)
        elif os.path.isdir(path):
            # Calculate item depth to determine the bounds of the branch indicator
            depth = 0
            parent = item.parent()
            while parent:
                depth += 1
                parent = parent.parent()
            
            indent = self._tree.indentation()
            pos = self._tree.viewport().mapFromGlobal(QCursor.pos())
            
            # Only toggle expansion manually if clicking on the actual item text/icon (x >= indent boundaries)
            # Clicking on the chevron (x < boundary) is already handled automatically by QTreeWidget
            if pos.x() >= (depth + 1) * indent:
                if item.isExpanded():
                    self._tree.collapseItem(item)
                else:
                    self._tree.expandItem(item)

    def _refresh_git_status(self):
        self._git_status = {}
        self._git_folders = set()
        
        # Check if it is a git repo
        try:
            import subprocess
            result = subprocess.run(
                ["git", "status", "--porcelain", "-u"],
                cwd=self._root_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3
            )
            if result.returncode != 0:
                return
            
            for line in result.stdout.splitlines():
                if len(line) < 3:
                    continue
                xy = line[:2]
                path = line[3:].strip().replace("/", os.sep)
                # Parse status
                status = '?' if '?' in xy else ('M' if 'M' in xy or 'R' in xy else 'A')
                self._git_status[path] = status
                
                # Add parents to self._git_folders
                parent = os.path.dirname(path)
                while parent:
                    self._git_folders.add(parent)
                    parent = os.path.dirname(parent)
        except Exception:
            pass

    def _refresh(self):
        self._tree.clear()
        self._refresh_git_status()
        self._load_directory(self._root_path)

    def _open_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Open Folder", self._root_path)
        if folder:
            self._root_path = folder
            self._ws_label.setText(os.path.basename(folder).upper())
            self._refresh()
            self.root_changed.emit(folder)

    def _show_context_menu(self, position):
        item = self._tree.itemAt(position)

        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #454545;
                padding: 4px 0px;
                font-size: 12px;
            }
            QMenu::item {
                padding: 4px 28px 4px 12px;
                min-width: 150px;
            }
            QMenu::item:selected {
                background-color: #2c004a;
            }
            QMenu::separator {
                height: 1px;
                background: #454545;
                margin: 4px 0px;
            }
        """)

        if not item:
            new_file = QAction("New File...", self)
            new_file.triggered.connect(self._new_file)
            menu.addAction(new_file)
            new_folder = QAction("New Folder...", self)
            new_folder.triggered.connect(self._new_folder)
            menu.addAction(new_folder)
            menu.addSeparator()
            open_folder = QAction("Open Folder...", self)
            open_folder.triggered.connect(self._open_folder)
            menu.addAction(open_folder)
            menu.exec(self._tree.viewport().mapToGlobal(position))
            return

        path = item.data(0, Qt.UserRole)
        if not path:
            return

        if os.path.isfile(path):
            open_action = QAction("Open", self)
            open_action.triggered.connect(lambda: self.file_selected.emit(path))
            menu.addAction(open_action)
            menu.addSeparator()

        if os.path.isdir(path):
            new_file = QAction("New File...", self)
            new_file.triggered.connect(lambda: self._new_file_in(path))
            menu.addAction(new_file)
            new_folder = QAction("New Folder...", self)
            new_folder.triggered.connect(lambda: self._new_folder_in(path))
            menu.addAction(new_folder)
            menu.addSeparator()

        rename_action = QAction("Rename...", self)
        rename_action.triggered.connect(lambda: self._rename_item(item, path))
        menu.addAction(rename_action)

        delete_action = QAction("Delete", self)
        delete_action.triggered.connect(lambda: self._delete_item(path))
        menu.addAction(delete_action)

        menu.addSeparator()

        copy_path = QAction("Copy Path", self)
        copy_path.triggered.connect(lambda: self._copy_path(path))
        menu.addAction(copy_path)

        copy_rel = QAction("Copy Relative Path", self)
        copy_rel.triggered.connect(lambda: self._copy_relative_path(path))
        menu.addAction(copy_rel)

        menu.exec(self._tree.viewport().mapToGlobal(position))

    def _copy_path(self, path: str):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(path)

    def _copy_relative_path(self, path: str):
        from PySide6.QtWidgets import QApplication
        rel = os.path.relpath(path, self._root_path)
        QApplication.clipboard().setText(rel)

    def _rename_item(self, item: QTreeWidgetItem, path: str):
        # Store temporary data for the rename operation
        item.setData(0, Qt.UserRole + 1, "rename")
        item.setData(0, Qt.UserRole + 2, path)
        
        # Make the item editable and trigger editing
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)

    def _delete_item(self, path: str):
        reply = QMessageBox.question(
            self, "Confirm Delete",
            f"Are you sure you want to delete '{os.path.basename(path)}'?\n\nThis action cannot be undone.",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            try:
                if os.path.isdir(path):
                    import shutil
                    shutil.rmtree(path)
                else:
                    os.remove(path)
                self._refresh()
            except Exception as e:
                QMessageBox.warning(self, "Error", str(e))

    def _new_file(self):
        curr = self._tree.currentItem()
        if curr:
            path = curr.data(0, Qt.UserRole)
            if os.path.isdir(path):
                self._new_file_in(path, curr)
                return
            else:
                parent = curr.parent()
                parent_path = parent.data(0, Qt.UserRole) if parent else self._root_path
                self._new_file_in(parent_path, parent)
                return
        self._new_file_in(self._root_path, None)

    def _new_folder(self):
        curr = self._tree.currentItem()
        if curr:
            path = curr.data(0, Qt.UserRole)
            if os.path.isdir(path):
                self._new_folder_in(path, curr)
                return
            else:
                parent = curr.parent()
                parent_path = parent.data(0, Qt.UserRole) if parent else self._root_path
                self._new_folder_in(parent_path, parent)
                return
        self._new_folder_in(self._root_path, None)

    def _new_file_in(self, parent_path: str, parent_item: QTreeWidgetItem = None):
        d = parent_path if os.path.isdir(parent_path) else os.path.dirname(parent_path)
        
        item = QTreeWidgetItem()
        item.setText(0, "untitled.py")
        item.setIcon(0, get_file_icon("untitled.py"))
        
        # Operation meta info
        item.setData(0, Qt.UserRole + 1, "create_file")
        item.setData(0, Qt.UserRole + 2, d)
        
        if parent_item:
            parent_item.addChild(item)
            self._tree.expandItem(parent_item)
        else:
            self._tree.addTopLevelItem(item)
            
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)

    def _new_folder_in(self, parent_path: str, parent_item: QTreeWidgetItem = None):
        d = parent_path if os.path.isdir(parent_path) else os.path.dirname(parent_path)
        
        item = QTreeWidgetItem()
        item.setText(0, "untitled_folder")
        item.setIcon(0, get_folder_icon(False))
        
        # Operation meta info
        item.setData(0, Qt.UserRole + 1, "create_folder")
        item.setData(0, Qt.UserRole + 2, d)
        
        if parent_item:
            parent_item.addChild(item)
            self._tree.expandItem(parent_item)
        else:
            self._tree.addTopLevelItem(item)
            
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        self._tree.setCurrentItem(item)
        self._tree.editItem(item, 0)

    def _on_item_changed(self, item: QTreeWidgetItem, column: int):
        if self._in_inline_edit:
            return

        operation = item.data(0, Qt.UserRole + 1)
        if not operation:
            return

        new_name = item.text(0).strip()
        
        # Revert editable flag and clear operations metadata immediately
        item.setFlags(item.flags() & ~Qt.ItemIsEditable)
        item.setData(0, Qt.UserRole + 1, None)
        
        if not new_name:
            if operation in ("create_file", "create_folder"):
                parent = item.parent()
                if parent:
                    parent.removeChild(item)
                else:
                    self._tree.takeTopLevelItem(self._tree.indexOfTopLevelItem(item))
            elif operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                self._in_inline_edit = True
                item.setText(0, os.path.basename(old_path))
                self._in_inline_edit = False
            return

        self._in_inline_edit = True
        try:
            if operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                new_path = os.path.join(os.path.dirname(old_path), new_name)
                if old_path != new_path:
                    os.rename(old_path, new_path)
                    item.setData(0, Qt.UserRole, new_path)
                    item.setToolTip(0, new_path)
                    if os.path.isfile(new_path):
                        item.setIcon(0, get_file_icon(new_path))
                    self._refresh()
            elif operation == "create_file":
                parent_dir = item.data(0, Qt.UserRole + 2)
                full_path = os.path.join(parent_dir, new_name)
                with open(full_path, "w") as f:
                    f.write("")
                item.setData(0, Qt.UserRole, full_path)
                item.setToolTip(0, full_path)
                item.setIcon(0, get_file_icon(full_path))
                self._refresh()
                self.file_selected.emit(full_path)
            elif operation == "create_folder":
                parent_dir = item.data(0, Qt.UserRole + 2)
                full_path = os.path.join(parent_dir, new_name)
                os.makedirs(full_path, exist_ok=True)
                item.setData(0, Qt.UserRole, full_path)
                item.setToolTip(0, full_path)
                item.setIcon(0, get_folder_icon(False))
                item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
                QTreeWidgetItem(item) # lazy load placeholder
                self._refresh()
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Failed to perform operation: {str(e)}")
            if operation in ("create_file", "create_folder"):
                parent = item.parent()
                if parent:
                    parent.removeChild(item)
                else:
                    self._tree.takeTopLevelItem(self._tree.indexOfTopLevelItem(item))
            elif operation == "rename":
                old_path = item.data(0, Qt.UserRole + 2)
                item.setText(0, os.path.basename(old_path))
        finally:
            self._in_inline_edit = False

    def set_root(self, path: str):
        self._root_path = path
        self._ws_label.setText(os.path.basename(path).upper())
        self._refresh()

    def get_root(self) -> str:
        return self._root_path
