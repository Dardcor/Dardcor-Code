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
    """VS Code style Quick Open / Command Center unified dialog (Ctrl+P).
    
    When opened from the Command Center (search bar), shows:
    1. Quick access help picks (search modes) at the top
    2. Recently opened files below
    
    When the user starts typing, switches to file search.
    Prefix '>' switches to command palette mode.
    Prefix ':' switches to go-to-line mode.
    Prefix '@' switches to go-to-symbol mode.
    """

    file_selected = Signal(str)

    # Help picks that appear when the dialog is opened from Command Center
    HELP_PICKS = [
        {"label": "Go to File...", "prefix": "", "shortcut": "", "icon": "\uea7b"},  # search
        {"label": "Show and Run Commands", "prefix": ">", "shortcut": "Ctrl+Shift+P", "icon": "\ueaef"},  # terminal
        {"label": "Go to Line/Column...", "prefix": ":", "shortcut": "Ctrl+G", "icon": "\uea9e"},  # symbol-method 
        {"label": "Go to Symbol in Editor...", "prefix": "@", "shortcut": "Ctrl+Shift+O", "icon": "\ueb1d"},  # symbol-class
        {"label": "Search Files by Content", "prefix": "% ", "shortcut": "", "icon": "\ueb1c"},  # search
        {"label": "Ask Dardcor", "prefix": "", "shortcut": "", "icon": "\uec4f"},  # chat-sparkle
    ]

    def __init__(self, root_path: str = "", parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Popup | Qt.FramelessWindowHint)
        self._root_path = root_path
        self._all_files = []
        self._filtered = []
        self._recent_files = []  # Track recently opened files
        self._from_command_center = False  # Whether opened from Command Center click
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
        self._input.setPlaceholderText("Search files by name (type '>' for commands)")
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
        self._all_files = []  # Reset cache when root changes

    def add_recent_file(self, file_path: str):
        """Track a file as recently opened."""
        # Remove if already in list, add to front
        if file_path in self._recent_files:
            self._recent_files.remove(file_path)
        self._recent_files.insert(0, file_path)
        # Keep max 20 recent files
        self._recent_files = self._recent_files[:20]

    def _scan_files(self):
        """Scan directory for files (cached)."""
        if self._all_files:
            return

        from ..core.filesystem import FileSystem, should_skip_dir, is_binary
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

    def _show_help_picks(self):
        """Show the VS Code-style help picks (search modes) + recently opened files."""
        self._list.clear()
        
        # --- Help picks section ---
        for pick in self.HELP_PICKS:
            item = QListWidgetItem()
            widget = QWidget()
            h_layout = QHBoxLayout(widget)
            h_layout.setContentsMargins(8, 0, 8, 0)
            h_layout.setSpacing(10)

            # Icon
            icon_label = QLabel(pick["icon"])
            icon_label.setFont(QFont("codicon", 14))
            icon_label.setFixedWidth(22)
            icon_label.setStyleSheet("color: #cccccc; background: transparent;")
            h_layout.addWidget(icon_label)

            # Label
            name_label = QLabel(pick["label"])
            name_label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
            h_layout.addWidget(name_label)
            
            # Prefix as description
            if pick["prefix"]:
                prefix_label = QLabel(pick["prefix"])
                prefix_label.setStyleSheet("color: #858585; font-size: 11px; background: transparent;")
                h_layout.addWidget(prefix_label)

            h_layout.addStretch()

            # Keyboard shortcut
            if pick["shortcut"]:
                shortcut_label = QLabel(pick["shortcut"])
                shortcut_label.setStyleSheet("""
                    color: #858585;
                    font-size: 11px;
                    background-color: #1a0033;
                    border: 1px solid #454545;
                    border-radius: 3px;
                    padding: 1px 6px;
                """)
                h_layout.addWidget(shortcut_label)

            item.setSizeHint(QSize(0, 28))
            item.setData(Qt.UserRole, f"help:{pick['prefix']}")
            self._list.addItem(item)
            self._list.setItemWidget(item, widget)

        # --- Recently opened files section ---
        valid_recent = [f for f in self._recent_files if os.path.exists(f)]
        if valid_recent:
            # Separator
            sep_item = QListWidgetItem()
            sep_widget = QWidget()
            sep_layout = QHBoxLayout(sep_widget)
            sep_layout.setContentsMargins(14, 4, 14, 4)
            sep_label = QLabel("recently opened")
            sep_label.setStyleSheet("color: #858585; font-size: 11px; background: transparent;")
            sep_layout.addWidget(sep_label)
            sep_layout.addStretch()
            sep_item.setSizeHint(QSize(0, 22))
            sep_item.setFlags(Qt.NoItemFlags)  # Not selectable
            self._list.addItem(sep_item)
            self._list.setItemWidget(sep_item, sep_widget)

            for fpath in valid_recent[:10]:
                fname = os.path.basename(fpath)
                rel = os.path.relpath(fpath, self._root_path) if self._root_path else fpath
                rel_dir = os.path.dirname(rel)

                item = QListWidgetItem()
                widget = QWidget()
                h_layout = QHBoxLayout(widget)
                h_layout.setContentsMargins(8, 0, 8, 0)
                h_layout.setSpacing(8)

                name_label = QLabel(fname)
                name_label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
                h_layout.addWidget(name_label)

                if rel_dir:
                    path_label = QLabel(rel_dir)
                    path_label.setStyleSheet("color: #858585; font-size: 11px; background: transparent;")
                    h_layout.addWidget(path_label)

                h_layout.addStretch()

                item.setSizeHint(QSize(0, 26))
                item.setData(Qt.UserRole, fpath)
                self._list.addItem(item)
                self._list.setItemWidget(item, widget)

        if self._list.count() > 0:
            self._list.setCurrentRow(0)

        total = self._list.count()
        visible = min(total, 14)
        self._list.setFixedHeight(max(50, visible * 27 + 8))
        self.adjustSize()

    def _on_filter(self, text):
        text_stripped = text.strip()

        # Empty input - show help picks if from command center, otherwise show recent files
        if not text_stripped:
            if self._from_command_center:
                self._show_help_picks()
            else:
                self._filtered = self._all_files[:50]
                self._populate_list()
            return

        # 1. Prefix ">" - Show Command Palette
        if text_stripped.startswith(">"):
            # Delegate to command palette
            parent = self.parent()
            if parent and hasattr(parent, '_show_command_palette'):
                self.close()
                QTimer.singleShot(50, parent._show_command_palette)
            return

        # 2. Prefix ":" - Go to Line
        if text_stripped.startswith(":"):
            line_str = text_stripped[1:].strip()
            self._list.clear()
            
            max_line = 99999
            parent = self.parent()
            if parent and hasattr(parent, "_editor_tabs"):
                editor = parent._editor_tabs.current_editor()
                if editor:
                    content = editor.get_content()
                    max_line = len(content.splitlines())
                    
            item = QListWidgetItem()
            widget = QWidget()
            layout = QHBoxLayout(widget)
            layout.setContentsMargins(0, 0, 0, 0)
            
            if line_str:
                try:
                    line_num = int(line_str)
                    if 1 <= line_num <= max_line:
                        msg = f"Go to Line {line_num}"
                        item.setData(Qt.UserRole, f"line:{line_num}")
                    else:
                        msg = f"Line {line_num} is out of range (1-{max_line})"
                        item.setData(Qt.UserRole, None)
                except ValueError:
                    msg = "Type a line number to go to"
                    item.setData(Qt.UserRole, None)
            else:
                msg = "Type a line number to go to"
                item.setData(Qt.UserRole, None)
                
            label = QLabel(msg)
            label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
            layout.addWidget(label)
            layout.addStretch()
            item.setSizeHint(QSize(0, 26))
            self._list.addItem(item)
            self._list.setItemWidget(item, widget)
            self._list.setCurrentRow(0)
            self._list.setFixedHeight(40)
            self.adjustSize()
            return
            
        # 3. Prefix "@" - Go to Symbol
        if text_stripped.startswith("@"):
            query_sym = text_stripped[1:].strip().lower()
            self._list.clear()
            
            parent = self.parent()
            if parent and hasattr(parent, "_editor_tabs"):
                editor = parent._editor_tabs.current_editor()
                if editor:
                    content = editor.get_content()
                    from ..core.filesystem import parse_python_symbols
                    symbols = parse_python_symbols(content)
                    
                    flat_symbols = []
                    def flatten(syms, prefix=""):
                        for sym in syms:
                            fullname = f"{prefix}{sym['name']}"
                            flat_symbols.append((fullname, sym['type'], sym['line']))
                            if sym.get('children'):
                                flatten(sym['children'], f"{fullname} > ")
                    flatten(symbols)
                    
                    filtered_syms = [
                        s for s in flat_symbols
                        if not query_sym or query_sym in s[0].lower()
                    ]
                    
                    for name, sym_type, line in filtered_syms[:30]:
                        item = QListWidgetItem()
                        widget = QWidget()
                        layout = QHBoxLayout(widget)
                        layout.setContentsMargins(0, 0, 0, 0)
                        layout.setSpacing(8)
                        
                        icon_text = "\U0001F4E6" if sym_type == "class" else "\u0192"
                        icon_label = QLabel(icon_text)
                        icon_label.setStyleSheet("color: #858585; font-size: 13px; font-weight: bold; background: transparent;")
                        layout.addWidget(icon_label)
                        
                        name_label = QLabel(name)
                        name_label.setStyleSheet("color: #cccccc; font-size: 13px; background: transparent;")
                        layout.addWidget(name_label)
                        
                        layout.addStretch()
                        
                        line_label = QLabel(f"line {line}")
                        line_label.setStyleSheet("color: #858585; font-size: 11px; background: transparent;")
                        layout.addWidget(line_label)
                        
                        item.setSizeHint(QSize(0, 26))
                        item.setData(Qt.UserRole, f"line:{line}")
                        self._list.addItem(item)
                        self._list.setItemWidget(item, widget)
                        
                    if filtered_syms:
                        self._list.setCurrentRow(0)
                    
                    visible = min(len(filtered_syms), 12)
                    self._list.setFixedHeight(max(50, visible * 26 + 8))
                    self.adjustSize()
                    return

        # 4. Prefix "% " - Search file content
        if text_stripped.startswith("% ") or text_stripped.startswith("%"):
            query_content = text_stripped.lstrip("% ").strip().lower()
            self._list.clear()
            
            if not query_content:
                item = QListWidgetItem()
                widget = QWidget()
                layout = QHBoxLayout(widget)
                layout.setContentsMargins(0, 0, 0, 0)
                label = QLabel("Type to search files by content...")
                label.setStyleSheet("color: #858585; font-size: 13px; background: transparent;")
                layout.addWidget(label)
                item.setSizeHint(QSize(0, 26))
                item.setData(Qt.UserRole, None)
                self._list.addItem(item)
                self._list.setItemWidget(item, widget)
                self._list.setFixedHeight(40)
                self.adjustSize()
            else:
                # Open the search sidebar
                parent = self.parent()
                if parent and hasattr(parent, '_switch_sidebar'):
                    self.close()
                    parent._switch_sidebar(1)  # VIEW_SEARCH
            return

        # 5. Default File Search
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
        data = item.data(Qt.UserRole)
        if not data:
            return

        # Help pick selected - set the prefix in the input
        if isinstance(data, str) and data.startswith("help:"):
            prefix = data[5:]
            if prefix:
                self._from_command_center = False  # Switch to prefix mode
                self._input.setText(prefix + " ")
                self._input.setCursorPosition(len(self._input.text()))
            else:
                # "Go to File..." or "Ask Dardcor" - switch to file search mode
                self._from_command_center = False
                self._input.clear()
                self._filtered = self._all_files[:50]
                self._populate_list()
            return

        if isinstance(data, str) and data.startswith("line:"):
            line = int(data.split(":")[1])
            parent = self.parent()
            if parent and hasattr(parent, "_editor_tabs"):
                editor = parent._editor_tabs.current_editor()
                if editor:
                    editor.reveal_line(line)
            self.close()
            return

        self.file_selected.emit(data)
        self.close()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.close()
            return
        if event.key() == Qt.Key_Down:
            row = self._list.currentRow()
            # Skip non-selectable separator items
            next_row = row + 1
            while next_row < self._list.count():
                next_item = self._list.item(next_row)
                if next_item and next_item.flags() != Qt.NoItemFlags:
                    self._list.setCurrentRow(next_row)
                    break
                next_row += 1
            return
        if event.key() == Qt.Key_Up:
            row = self._list.currentRow()
            prev_row = row - 1
            while prev_row >= 0:
                prev_item = self._list.item(prev_row)
                if prev_item and prev_item.flags() != Qt.NoItemFlags:
                    self._list.setCurrentRow(prev_row)
                    break
                prev_row -= 1
            return
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            item = self._list.currentItem()
            if item:
                self._on_item_selected(item)
            return
        super().keyPressEvent(event)

    def show_dialog(self, from_command_center=False):
        """Show the Quick Open dialog.
        
        Args:
            from_command_center: If True, shows help picks first (VS Code Command Center behavior).
                                If False, shows file list directly (Ctrl+P behavior).
        """
        self._scan_files()
        self._from_command_center = from_command_center
        parent = self.parent()
        if parent:
            parent_geo = parent.geometry()
            x = parent_geo.x() + (parent_geo.width() - self.width()) // 2
            y = parent_geo.y() + 50
            self.move(x, y)
        self._input.clear()
        
        if from_command_center:
            self._show_help_picks()
        else:
            self._filtered = self._all_files[:50]
            self._populate_list()
        
        self.show()
        self._input.setFocus()

