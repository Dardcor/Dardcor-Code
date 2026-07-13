"""Keybindings UI Editor - Interactive keybinding table with JSON editor, when clause layers, and conflict detection."""

import json
import os
import re
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QTableWidget, QTableWidgetItem, QPushButton, QHeaderView,
    QAbstractItemView, QScrollArea, QPlainTextEdit, QTabWidget,
    QMessageBox, QSplitter, QComboBox, QCheckBox, QGroupBox
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QFont

from ..core.config import get_global_home_dir


DEFAULT_KEYBINDINGS = [
    {"command": "workbench.action.showCommands", "keybinding": "Ctrl+Shift+P", "when": ""},
    {"command": "workbench.action.quickOpen", "keybinding": "Ctrl+P", "when": ""},
    {"command": "workbench.action.newWindow", "keybinding": "Ctrl+Shift+N", "when": ""},
    {"command": "workbench.action.closeWindow", "keybinding": "Ctrl+Shift+W", "when": ""},
    {"command": "workbench.action.toggleSidebarVisibility", "keybinding": "Ctrl+B", "when": ""},
    {"command": "workbench.action.togglePanel", "keybinding": "Ctrl+J", "when": ""},
    {"command": "editor.action.formatDocument", "keybinding": "Shift+Alt+F", "when": "editorTextFocus"},
    {"command": "editor.action.commentLine", "keybinding": "Ctrl+/", "when": "editorTextFocus"},
    {"command": "editor.action.blockComment", "keybinding": "Shift+Alt+A", "when": "editorTextFocus"},
    {"command": "editor.action.triggerSuggest", "keybinding": "Ctrl+Space", "when": "editorTextFocus"},
    {"command": "workbench.action.gotoLine", "keybinding": "Ctrl+G", "when": ""},
    {"command": "editor.action.startFindReplaceAction", "keybinding": "Ctrl+H", "when": ""},
    {"command": "editor.action.addSelectionToNextFindMatch", "keybinding": "Ctrl+D", "when": "editorTextFocus"},
    {"command": "editor.action.selectHighlights", "keybinding": "Ctrl+Shift+L", "when": "editorTextFocus"},
    {"command": "editor.action.copyLinesDownAction", "keybinding": "Shift+Alt+Down", "when": "editorTextFocus"},
    {"command": "editor.action.copyLinesUpAction", "keybinding": "Shift+Alt+Up", "when": "editorTextFocus"},
    {"command": "editor.action.moveLinesDownAction", "keybinding": "Alt+Down", "when": "editorTextFocus"},
    {"command": "editor.action.moveLinesUpAction", "keybinding": "Alt+Up", "when": "editorTextFocus"},
    {"command": "editor.action.insertLineAfter", "keybinding": "Ctrl+Enter", "when": "editorTextFocus"},
    {"command": "editor.action.insertLineBefore", "keybinding": "Ctrl+Shift+Enter", "when": "editorTextFocus"},
    {"command": "editor.action.outdentLines", "keybinding": "Shift+Tab", "when": "editorTextFocus"},
    {"command": "editor.action.indentLines", "keybinding": "Tab", "when": "editorTextFocus"},
    {"command": "editor.action.deleteLines", "keybinding": "Ctrl+Shift+K", "when": "editorTextFocus"},
    {"command": "editor.action.jumpToBracket", "keybinding": "Ctrl+Shift+\\", "when": "editorTextFocus"},
    {"command": "editor.action.smartSelect.expand", "keybinding": "Shift+Alt+Right", "when": "editorTextFocus"},
    {"command": "editor.action.smartSelect.shrink", "keybinding": "Shift+Alt+Left", "when": "editorTextFocus"},
    {"command": "editor.action.transformToUppercase", "keybinding": "Ctrl+Shift+U", "when": "editorTextFocus"},
    {"command": "editor.action.transformToLowercase", "keybinding": "Ctrl+U", "when": "editorTextFocus"},
    {"command": "editor.fold", "keybinding": "Ctrl+Shift+[", "when": "editorTextFocus"},
    {"command": "editor.unfold", "keybinding": "Ctrl+Shift+]", "when": "editorTextFocus"},
    {"command": "editor.foldAll", "keybinding": "Ctrl+K Ctrl+0", "when": "editorTextFocus"},
    {"command": "editor.unfoldAll", "keybinding": "Ctrl+K Ctrl+J", "when": "editorTextFocus"},
    {"command": "workbench.action.files.save", "keybinding": "Ctrl+S", "when": ""},
    {"command": "workbench.action.files.saveAll", "keybinding": "Ctrl+K S", "when": ""},
    {"command": "workbench.action.closeEditor", "keybinding": "Ctrl+W", "when": ""},
    {"command": "workbench.action.reopenClosedEditor", "keybinding": "Ctrl+Shift+T", "when": ""},
    {"command": "workbench.action.nextEditor", "keybinding": "Ctrl+Tab", "when": ""},
    {"command": "workbench.action.previousEditor", "keybinding": "Ctrl+Shift+Tab", "when": ""},
    {"command": "workbench.action.navigateBack", "keybinding": "Alt+Left", "when": ""},
    {"command": "workbench.action.navigateForward", "keybinding": "Alt+Right", "when": ""},
    {"command": "workbench.action.openSettings", "keybinding": "Ctrl+,", "when": ""},
    {"command": "workbench.action.openGlobalKeybindings", "keybinding": "Ctrl+K Ctrl+S", "when": ""},
    {"command": "workbench.action.selectTheme", "keybinding": "Ctrl+K Ctrl+T", "when": ""},
    {"command": "workbench.action.toggleZenMode", "keybinding": "Ctrl+K Z", "when": ""},
    {"command": "workbench.action.gotoSymbol", "keybinding": "Ctrl+Shift+O", "when": ""},
    {"command": "workbench.action.showAllSymbols", "keybinding": "Ctrl+T", "when": ""},
    {"command": "editor.action.marker.nextInFiles", "keybinding": "F8", "when": "editorTextFocus"},
    {"command": "editor.action.marker.prevInFiles", "keybinding": "Shift+F8", "when": "editorTextFocus"},
    {"command": "editor.action.insertCursorAbove", "keybinding": "Ctrl+Alt+Up", "when": "editorTextFocus"},
    {"command": "editor.action.insertCursorBelow", "keybinding": "Ctrl+Alt+Down", "when": "editorTextFocus"},
    {"command": "cursorColumnSelectDown", "keybinding": "Ctrl+Shift+Alt+Down", "when": "editorTextFocus"},
    {"command": "cursorColumnSelectUp", "keybinding": "Ctrl+Shift+Alt+Up", "when": "editorTextFocus"},
    {"command": "workbench.action.toggleFullScreen", "keybinding": "F11", "when": ""},
    {"command": "workbench.action.zoomIn", "keybinding": "Ctrl+=", "when": ""},
    {"command": "workbench.action.zoomOut", "keybinding": "Ctrl+-", "when": ""},
    {"command": "editor.action.toggleWordWrap", "keybinding": "Alt+Z", "when": "editorTextFocus"},
    {"command": "workbench.action.terminal.new", "keybinding": "Ctrl+Shift+`", "when": ""},
    {"command": "workbench.action.terminal.toggleTerminal", "keybinding": "Ctrl+`", "when": ""},
    {"command": "editor.action.revealDefinition", "keybinding": "F12", "when": "editorTextFocus"},
    {"command": "editor.action.peekDefinition", "keybinding": "Alt+F12", "when": "editorTextFocus"},
    {"command": "editor.action.goToReferences", "keybinding": "Shift+F12", "when": "editorTextFocus"},
    {"command": "editor.action.rename", "keybinding": "F2", "when": "editorTextFocus"},
    {"command": "workbench.action.splitEditor", "keybinding": "Ctrl+\\", "when": ""},
    {"command": "workbench.action.debug.start", "keybinding": "F5", "when": ""},
    {"command": "workbench.action.debug.stepOver", "keybinding": "F10", "when": "inDebugMode"},
    {"command": "workbench.action.debug.stepInto", "keybinding": "F11", "when": "inDebugMode"},
    {"command": "workbench.action.debug.stepOut", "keybinding": "Shift+F11", "when": "inDebugMode"},
    {"command": "workbench.action.debug.continue", "keybinding": "F5", "when": "inDebugMode"},
    {"command": "workbench.action.debug.stop", "keybinding": "Shift+F5", "when": "inDebugMode"},
]


def _get_keybindings_path() -> str:
    return os.path.join(get_global_home_dir(), "keybindings.json")


def to_vscode_keybinding(entry: dict) -> str:
    """Convert internal binding to VS Code keybinding string."""
    kb = entry.get("keybinding", "")
    if not kb:
        return ""
    kb = kb.replace("Ctrl+", "ctrl+").replace("Shift+", "shift+").replace("Alt+", "alt+").replace("Meta+", "meta+")
    parts = kb.split(" ")
    return " ".join(p.lower() for p in parts)


def parse_when_clause(when: str) -> list:
    """Parse a when clause into a list of context keys for display."""
    if not when:
        return []
    return re.findall(r'\b(\w+(?:\.\w+)*)\b', when)


WHEN_EXAMPLES = [
    "", "editorTextFocus", "editorHasSelection", "editorLangId == 'python'",
    "inDebugMode", "terminalFocus", "sidebarVisible", "panelVisible",
    "explorerViewletVisible", "resourceScheme == 'file'", "editorHasMultipleSelections",
    "editorHasSelection && editorTextFocus", "!editorReadonly",
    "view == 'workbench.explorer.explorerView'", "inputFocus",
]


class KeybindingsUIWidget(QWidget):
    """Interactive keybindings editor with table, JSON editor, and when clause support."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._keybindings = list(DEFAULT_KEYBINDINGS)
        self._dirty = False
        self._load_saved()
        self._setup_ui()

    def get_file_path(self):
        return ""
    def is_dirty(self):
        return self._dirty
    def get_language(self):
        return "keybindings"
    def get_content(self):
        return json.dumps(self._keybindings, indent=2)

    def _load_saved(self):
        path = _get_keybindings_path()
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                if isinstance(saved, list):
                    self._keybindings = saved
                elif isinstance(saved, dict):
                    self._keybindings = [{"command": k, "keybinding": v, "when": ""} for k, v in saved.items()]
            except Exception:
                pass

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.setStyleSheet("background-color: #000000;")

        header = QWidget()
        header.setFixedHeight(50)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #1a0033;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(24, 0, 24, 0)

        title = QLabel("\u2328 Keyboard Shortcuts")
        title.setStyleSheet("color: #cccccc; font-size: 18px; font-weight: 300;")
        header_layout.addWidget(title)
        header_layout.addStretch()

        self._save_btn = QPushButton("Save Keybindings")
        self._save_btn.setEnabled(False)
        self._save_btn.setCursor(Qt.PointingHandCursor)
        self._save_btn.setStyleSheet("""
            QPushButton {
                background-color: #5a009c; color: #ffffff;
                border: none; border-radius: 3px;
                padding: 5px 14px; font-size: 12px; font-weight: 600;
            }
            QPushButton:hover:enabled { background-color: #7a00d3; }
            QPushButton:disabled { background-color: #1a0033; color: #666666; }
        """)
        self._save_btn.clicked.connect(self._save_keybindings)
        header_layout.addWidget(self._save_btn)

        json_btn = QPushButton("Open JSON")
        json_btn.setCursor(Qt.PointingHandCursor)
        json_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #4a90d9;
                border: none; font-size: 12px; text-decoration: underline;
            }
            QPushButton:hover { color: #6bb0ff; }
        """)
        json_btn.clicked.connect(lambda: self._tabs.setCurrentIndex(1))
        header_layout.addWidget(json_btn)
        layout.addWidget(header)

        self._tabs = QTabWidget()
        self._tabs.setStyleSheet("""
            QTabWidget::pane { border: none; background-color: #000000; }
            QTabBar::tab { background: transparent; color: #858585; padding: 4px 12px; border-bottom: 2px solid transparent; font-size: 11px; }
            QTabBar::tab:selected { color: #fff; border-bottom: 2px solid #5a009c; }
        """)

        self._tabs.addTab(self._build_table_tab(), "Table")
        self._tabs.addTab(self._build_json_tab(), "JSON")
        self._tabs.addTab(self._build_layers_tab(), "When Clauses")

        layout.addWidget(self._tabs)

    def _build_table_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        search_bar = QWidget()
        search_bar.setFixedHeight(40)
        search_bar.setStyleSheet("background-color: #000000;")
        search_layout = QHBoxLayout(search_bar)
        search_layout.setContentsMargins(24, 8, 24, 8)

        self._search = QLineEdit()
        self._search.setPlaceholderText("Type to search in keybindings")
        self._search.setStyleSheet("""
            QLineEdit {
                background-color: #2c004a; color: #cccccc;
                border: 1px solid #2c004a; border-radius: 4px;
                padding: 6px 12px; font-size: 13px;
            }
            QLineEdit:focus { border: 1px solid #4a0072; }
        """)
        self._search.textChanged.connect(self._filter_keybindings)
        search_layout.addWidget(self._search)

        self._when_filter = QComboBox()
        self._when_filter.addItems(["All Contexts", "editorTextFocus", "inDebugMode", "terminalFocus", "sidebarVisible", "panelVisible"])
        self._when_filter.currentTextChanged.connect(lambda: self._filter_keybindings(self._search.text()))
        self._when_filter.setStyleSheet("""
            QComboBox {
                background-color: #2c004a; color: #cccccc;
                border: 1px solid #2c004a; border-radius: 4px;
                padding: 4px 8px; font-size: 12px;
            }
        """)
        search_layout.addWidget(self._when_filter)

        self._show_conflicts = QCheckBox("Show conflicts only")
        self._show_conflicts.setStyleSheet("color: #858585; font-size: 11px;")
        self._show_conflicts.stateChanged.connect(lambda: self._filter_keybindings(self._search.text()))
        search_layout.addWidget(self._show_conflicts)
        search_layout.addStretch()

        layout.addWidget(search_bar)

        self._table = QTableWidget()
        self._table.setColumnCount(4)
        self._table.setHorizontalHeaderLabels(["Command", "Keybinding", "When", "Source"])
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self._table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setAlternatingRowColors(True)
        self._table.verticalHeader().setVisible(False)
        self._table.setSortingEnabled(True)
        self._table.setStyleSheet("""
            QTableWidget {
                background-color: #000000; color: #cccccc;
                border: none; font-size: 12px;
                gridline-color: #1a0033;
            }
            QTableWidget::item { padding: 6px 8px; }
            QTableWidget::item:selected { background-color: #04395e; }
            QTableWidget::item:alternate { background-color: #0a0a0a; }
            QHeaderView::section {
                background-color: #080808; color: #858585;
                border: none; border-bottom: 1px solid #1a0033;
                padding: 8px; font-size: 11px; font-weight: bold;
                text-transform: uppercase;
            }
        """)
        self._populate_table()
        layout.addWidget(self._table)

        return w

    def _build_json_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        header = QLabel("Edit keybindings.json directly. Use the format: [{\"command\": \"...\", \"keybinding\": \"...\", \"when\": \"...\"}]")
        header.setStyleSheet("color: #858585; font-size: 12px;")
        header.setWordWrap(True)
        layout.addWidget(header)

        self._json_editor = QPlainTextEdit()
        self._json_editor.setPlainText(json.dumps(self._keybindings, indent=2))
        self._json_editor.setStyleSheet("""
            QPlainTextEdit {
                background-color: #0a0a0a; color: #cccccc;
                border: 1px solid #2c004a; border-radius: 3px;
                padding: 8px; font-family: Consolas, 'Cascadia Code', monospace;
                font-size: 12px;
            }
            QPlainTextEdit:focus { border: 1px solid #4a0072; }
        """)
        self._json_editor.setMinimumHeight(300)
        self._json_editor.textChanged.connect(self._mark_dirty)
        layout.addWidget(self._json_editor)

        btn_layout = QHBoxLayout()
        apply_json = QPushButton("Apply JSON")
        apply_json.setStyleSheet("""
            QPushButton {
                background-color: #5a009c; color: #fff;
                border: none; border-radius: 3px;
                padding: 6px 16px; font-size: 12px;
            }
            QPushButton:hover { background-color: #7a00d3; }
        """)
        apply_json.clicked.connect(self._apply_json)
        btn_layout.addWidget(apply_json)
        btn_layout.addStretch()
        layout.addLayout(btn_layout)

        return w

    def _build_layers_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        header = QLabel("When clauses control which context a keybinding is active in. Layer your keybindings by context.")
        header.setStyleSheet("color: #858585; font-size: 12px;")
        header.setWordWrap(True)
        layout.addWidget(header)

        self._layer_tree = QTableWidget()
        self._layer_tree.setColumnCount(4)
        self._layer_tree.setHorizontalHeaderLabels(["Layer Name", "When Clause", "Keybinding Count", "Example"])
        self._layer_tree.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self._layer_tree.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self._layer_tree.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self._layer_tree.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        self._layer_tree.verticalHeader().setVisible(False)
        self._layer_tree.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._layer_tree.setStyleSheet("""
            QTableWidget {
                background-color: #000000; color: #cccccc;
                border: 1px solid #1a0033; font-size: 12px;
                gridline-color: #1a0033;
            }
            QTableWidget::item { padding: 6px; }
            QTableWidget::item:selected { background-color: #04395e; }
            QHeaderView::section {
                background-color: #080808; color: #858585;
                border: none; border-bottom: 1px solid #1a0033;
                padding: 6px; font-size: 11px; font-weight: bold;
            }
        """)
        self._populate_layers()
        layout.addWidget(self._layer_tree)

        hint = QLabel(
            "Tip: Use 'when' clause editor in the Table tab to edit per-binding when clauses. "
            "Common layers:\n"
            "\u2022 editorTextFocus \u2014 active when cursor is in the editor\n"
            "\u2022 inDebugMode \u2014 active during a debug session\n"
            "\u2022 terminalFocus \u2014 active when the terminal is focused\n"
            "\u2022 editorLangId == 'python' \u2014 active only for Python files"
        )
        hint.setStyleSheet("color: #666666; font-size: 11px; padding: 8px 0;")
        hint.setWordWrap(True)
        layout.addWidget(hint)

        return w

    def _populate_layers(self):
        layers = {}
        for kb in self._keybindings:
            when = kb.get("when", "") or ""
            if when not in layers:
                layers[when] = {"count": 0, "example": ""}
            layers[when]["count"] += 1
            if not layers[when]["example"]:
                layers[when]["example"] = f"{kb['command']} ({kb.get('keybinding', '')})"

        self._layer_tree.setRowCount(len(layers))
        for i, (when, info) in enumerate(sorted(layers.items(), key=lambda x: -x[1]["count"])):
            layer_name = when if when else "(global / no context)"
            self._layer_tree.setItem(i, 0, QTableWidgetItem(layer_name))
            self._layer_tree.setItem(i, 1, QTableWidgetItem(when))
            self._layer_tree.setItem(i, 2, QTableWidgetItem(str(info["count"])))
            self._layer_tree.setItem(i, 3, QTableWidgetItem(info["example"]))

    def _populate_table(self):
        conflicts = {}
        for i, kb in enumerate(self._keybindings):
            key = (kb["keybinding"].lower(), kb.get("when", ""))
            if key not in conflicts:
                conflicts[key] = []
            conflicts[key].append(i)

        self._table.setRowCount(len(self._keybindings))
        for i, kb in enumerate(self._keybindings):
            is_conflict = len(conflicts.get((kb["keybinding"].lower(), kb.get("when", "")), [])) > 1

            cmd_text = kb["command"]
            if is_conflict:
                cmd_text = "\u26a0\ufe0f " + cmd_text

            cmd_item = QTableWidgetItem(cmd_text)
            cmd_item.setFlags(cmd_item.flags() & ~Qt.ItemIsEditable)
            if is_conflict:
                cmd_item.setToolTip("Conflict: multiple bindings share this keybinding+context")
            self._table.setItem(i, 0, cmd_item)

            key_item = QTableWidgetItem(kb["keybinding"])
            if is_conflict:
                key_item.setForeground(QColor("#ff5555"))
            else:
                key_item.setForeground(QColor("#e2c08d"))
            self._table.setItem(i, 1, key_item)

            when_item = QTableWidgetItem(kb.get("when", ""))
            when_item.setForeground(QColor("#858585"))
            when_item.setToolTip("Double-click to edit when clause")
            self._table.setItem(i, 2, when_item)

            source_item = QTableWidgetItem("user" if self._is_user_defined(i) else "default")
            source_item.setFlags(source_item.flags() & ~Qt.ItemIsEditable)
            source_item.setForeground(QColor("#666666"))
            self._table.setItem(i, 3, source_item)

    def _is_user_defined(self, index: int) -> bool:
        path = _get_keybindings_path()
        if not os.path.exists(path):
            return False
        try:
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, list):
                for s in saved:
                    if s.get("command") == self._keybindings[index]["command"]:
                        return True
        except Exception:
            pass
        return False

    def _filter_keybindings(self, text):
        text = text.lower()
        when_filter = self._when_filter.currentText()
        show_only_conflicts = self._show_conflicts.isChecked()
        for row in range(self._table.rowCount()):
            match = True
            if text:
                cmd = self._table.item(row, 0).text().lower()
                key = self._table.item(row, 1).text().lower()
                when = self._table.item(row, 2).text().lower()
                match = text in cmd or text in key or text in when
            if match and when_filter != "All Contexts":
                when_val = self._table.item(row, 2).text()
                match = when_filter.lower() in when_val.lower()
            if match and show_only_conflicts:
                cmd_text = self._table.item(row, 0).text()
                match = "\u26a0\ufe0f" in cmd_text
            self._table.setRowHidden(row, not match)

    def _apply_json(self):
        text = self._json_editor.toPlainText().strip()
        if not text:
            return
        try:
            data = json.loads(text)
            if isinstance(data, list):
                for item in data:
                    if not isinstance(item, dict) or "command" not in item:
                        raise ValueError("Each entry must have at least a 'command' field")
                self._keybindings = data
                self._populate_table()
                self._populate_layers()
                self._mark_dirty()
            else:
                QMessageBox.warning(self, "Invalid Format", "Keybindings must be a JSON array.")
        except (json.JSONDecodeError, ValueError) as e:
            QMessageBox.warning(self, "Invalid JSON", str(e))

    def _mark_dirty(self):
        self._dirty = True
        self._save_btn.setEnabled(True)

    def _save_keybindings(self):
        path = _get_keybindings_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self._keybindings, f, indent=2, ensure_ascii=False)
            f.write("\n")
        self._dirty = False
        self._save_btn.setEnabled(False)
        self._populate_table()
        self._populate_layers()
