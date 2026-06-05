"""Command Palette - VS Code style quick-open command palette (Ctrl+Shift+P)."""

import os
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QLineEdit, QListWidget, QListWidgetItem,
    QWidget, QHBoxLayout, QLabel, QApplication,
)
from PySide6.QtCore import Signal, Qt, QTimer, QSize
from PySide6.QtGui import QColor, QKeyEvent, QFont


class CommandPalette(QDialog):
    """VS Code style Command Palette overlay dialog."""

    command_selected = Signal(str)  # Emits command id

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_TranslucentBackground, False)
        self._commands = []
        self._filtered = []
        self._setup_ui()

    def _setup_ui(self):
        self.setFixedWidth(600)
        self.setMaximumHeight(400)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Container with border
        container = QWidget()
        container.setStyleSheet("""
            QWidget {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
        """)
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(0)

        # Search input
        self._input = QLineEdit()
        self._input.setPlaceholderText(">")
        self._input.setFixedHeight(36)
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: none;
                border-bottom: 1px solid #3c0068;
                padding: 4px 14px;
                font-size: 14px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
            }
        """)
        self._input.textChanged.connect(self._on_filter)
        container_layout.addWidget(self._input)

        # Results list
        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-size: 13px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                outline: none;
                padding: 4px 0px;
                border-bottom-left-radius: 6px;
                border-bottom-right-radius: 6px;
            }
            QListWidget::item {
                padding: 4px 14px;
                min-height: 24px;
                border: none;
            }
            QListWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QListWidget::item:hover:!selected {
                background-color: #2a2d2e;
            }
        """)
        self._list.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._list.itemActivated.connect(self._on_item_selected)
        self._list.itemClicked.connect(self._on_item_selected)
        container_layout.addWidget(self._list)

        layout.addWidget(container)

    def set_commands(self, commands: list):
        """Set available commands. Each command is a dict with 'id', 'label', 'shortcut'."""
        self._commands = commands
        self._filtered = commands[:]
        self._populate_list()

    def _populate_list(self):
        self._list.clear()
        for cmd in self._filtered[:30]:
            item = QListWidgetItem()

            # Create custom widget for the item
            widget = QWidget()
            layout = QHBoxLayout(widget)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(8)

            label = QLabel(cmd.get("label", ""))
            label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
            layout.addWidget(label)

            layout.addStretch()

            shortcut = cmd.get("shortcut", "")
            if shortcut:
                shortcut_label = QLabel(shortcut)
                shortcut_label.setStyleSheet("""
                    color: #858585;
                    font-size: 11px;
                    background-color: #1a0033;
                    border: 1px solid #454545;
                    border-radius: 3px;
                    padding: 1px 6px;
                """)
                layout.addWidget(shortcut_label)

            item.setSizeHint(QSize(0, 28))
            item.setData(Qt.UserRole, cmd.get("id", ""))
            self._list.addItem(item)
            self._list.setItemWidget(item, widget)

        if self._filtered:
            self._list.setCurrentRow(0)

        # Adjust height
        item_height = 28
        visible = min(len(self._filtered), 12)
        list_height = max(50, visible * item_height + 8)
        self._list.setFixedHeight(list_height)
        self.adjustSize()

    def _on_filter(self, text):
        text = text.lstrip(">").strip().lower()
        if not text:
            self._filtered = self._commands[:]
        else:
            self._filtered = [
                cmd for cmd in self._commands
                if text in cmd.get("label", "").lower()
                or text in cmd.get("id", "").lower()
            ]
        self._populate_list()

    def _on_item_selected(self, item):
        cmd_id = item.data(Qt.UserRole)
        if cmd_id:
            self.command_selected.emit(cmd_id)
        self.close()

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() == Qt.Key_Escape:
            self.close()
            return
        if event.key() == Qt.Key_Down:
            row = self._list.currentRow()
            if row < self._list.count() - 1:
                self._list.setCurrentRow(row + 1)
            return
        if event.key() == Qt.Key_Up:
            row = self._list.currentRow()
            if row > 0:
                self._list.setCurrentRow(row - 1)
            return
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            item = self._list.currentItem()
            if item:
                self._on_item_selected(item)
            return
        super().keyPressEvent(event)

    def show_palette(self):
        """Show the command palette centered at top of parent window."""
        parent = self.parent()
        if parent:
            parent_geo = parent.geometry()
            x = parent_geo.x() + (parent_geo.width() - self.width()) // 2
            y = parent_geo.y() + 50
            self.move(x, y)
        self._input.clear()
        self._input.setText("> ")
        self._filtered = self._commands[:]
        self._populate_list()
        self.show()
        self._input.setFocus()
        self._input.setCursorPosition(len(self._input.text()))


class GoToLineDialog(QDialog):
    """VS Code style Go to Line dialog."""

    line_selected = Signal(int)

    def __init__(self, max_line: int = 1, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self._max_line = max_line
        self._setup_ui()

    def _setup_ui(self):
        self.setFixedWidth(500)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        container = QWidget()
        container.setStyleSheet("""
            QWidget {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
        """)
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)

        self._input = QLineEdit()
        self._input.setPlaceholderText(f"Type a line number between 1 and {self._max_line}")
        self._input.setFixedHeight(36)
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: none;
                padding: 4px 14px;
                font-size: 14px;
                font-family: "Segoe UI", sans-serif;
                border-radius: 6px;
            }
        """)
        self._input.returnPressed.connect(self._on_submit)
        container_layout.addWidget(self._input)

        layout.addWidget(container)

    def _on_submit(self):
        try:
            line = int(self._input.text().strip())
            if 1 <= line <= self._max_line:
                self.line_selected.emit(line)
        except ValueError:
            pass
        self.close()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.close()
            return
        super().keyPressEvent(event)

    def show_dialog(self):
        parent = self.parent()
        if parent:
            parent_geo = parent.geometry()
            x = parent_geo.x() + (parent_geo.width() - self.width()) // 2
            y = parent_geo.y() + 50
            self.move(x, y)
        self._input.clear()
        self.show()
        self._input.setFocus()


class QuickOpenDialog(QDialog):
    """VS Code style Quick Open file dialog (Ctrl+P)."""

    file_selected = Signal(str)

    def __init__(self, root_path: str = "", parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self._root_path = root_path
        self._all_files = []
        self._filtered = []
        self._setup_ui()

    def _setup_ui(self):
        self.setFixedWidth(600)
        self.setMaximumHeight(400)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        container = QWidget()
        container.setStyleSheet("""
            QWidget {
                background-color: #000000;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
        """)
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(0)

        self._input = QLineEdit()
        self._input.setPlaceholderText("Type to search for files...")
        self._input.setFixedHeight(36)
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: none;
                border-bottom: 1px solid #3c0068;
                padding: 4px 14px;
                font-size: 14px;
                font-family: "Segoe UI", sans-serif;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
            }
        """)
        self._input.textChanged.connect(self._on_filter)
        container_layout.addWidget(self._input)

        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget {
                background-color: #000000;
                border: none;
                color: #cccccc;
                font-size: 13px;
                outline: none;
                padding: 4px 0px;
                border-bottom-left-radius: 6px;
                border-bottom-right-radius: 6px;
            }
            QListWidget::item {
                padding: 3px 14px;
                min-height: 22px;
            }
            QListWidget::item:selected {
                background-color: #04395e;
            }
            QListWidget::item:hover:!selected {
                background-color: #2a2d2e;
            }
        """)
        self._list.itemActivated.connect(self._on_item_selected)
        self._list.itemClicked.connect(self._on_item_selected)
        container_layout.addWidget(self._list)

        layout.addWidget(container)

    def set_root(self, root_path: str):
        self._root_path = root_path

    def _scan_files(self):
        """Scan directory for files (cached)."""
        if self._all_files:
            return

        from ..engine.filesystem import FileSystem, should_skip_dir, is_binary
        skip_dirs = {".git", "__pycache__", "node_modules", ".venv", "venv",
                     "dist", "build", ".next", ".nuxt", "target"}

        for dirpath, dirnames, filenames in os.walk(self._root_path):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
            for fname in filenames:
                if not is_binary(fname):
                    full = os.path.join(dirpath, fname)
                    rel = os.path.relpath(full, self._root_path)
                    self._all_files.append((fname, rel, full))
                    if len(self._all_files) >= 5000:
                        return

    def _on_filter(self, text):
        text = text.strip().lower()
        if not text:
            self._filtered = self._all_files[:50]
        else:
            self._filtered = [
                f for f in self._all_files
                if text in f[0].lower() or text in f[1].lower()
            ][:50]
        self._populate_list()

    def _populate_list(self):
        self._list.clear()
        for fname, rel, full in self._filtered:
            item = QListWidgetItem()
            widget = QWidget()
            layout = QHBoxLayout(widget)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(8)

            name_label = QLabel(fname)
            name_label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
            layout.addWidget(name_label)

            path_label = QLabel(os.path.dirname(rel))
            path_label.setStyleSheet("color: #858585; font-size: 11px; background: transparent;")
            layout.addWidget(path_label)

            layout.addStretch()

            item.setSizeHint(QSize(0, 26))
            item.setData(Qt.UserRole, full)
            self._list.addItem(item)
            self._list.setItemWidget(item, widget)

        if self._filtered:
            self._list.setCurrentRow(0)

        visible = min(len(self._filtered), 12)
        self._list.setFixedHeight(max(50, visible * 26 + 8))
        self.adjustSize()

    def _on_item_selected(self, item):
        path = item.data(Qt.UserRole)
        if path:
            self.file_selected.emit(path)
        self.close()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.close()
            return
        if event.key() == Qt.Key_Down:
            row = self._list.currentRow()
            if row < self._list.count() - 1:
                self._list.setCurrentRow(row + 1)
            return
        if event.key() == Qt.Key_Up:
            row = self._list.currentRow()
            if row > 0:
                self._list.setCurrentRow(row - 1)
            return
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            item = self._list.currentItem()
            if item:
                self._on_item_selected(item)
            return
        super().keyPressEvent(event)

    def show_dialog(self):
        self._scan_files()
        parent = self.parent()
        if parent:
            parent_geo = parent.geometry()
            x = parent_geo.x() + (parent_geo.width() - self.width()) // 2
            y = parent_geo.y() + 50
            self.move(x, y)
        self._input.clear()
        self._filtered = self._all_files[:50]
        self._populate_list()
        self.show()
        self._input.setFocus()
