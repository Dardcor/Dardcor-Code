"""Keybindings UI Editor - Interactive keybinding table that opens as an editor tab."""

import json
import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QTableWidget, QTableWidgetItem, QPushButton, QHeaderView,
    QAbstractItemView, QScrollArea
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QFont


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
    {"command": "editor.action.findWithSelection", "keybinding": "Ctrl+F", "when": ""},
    {"command": "editor.action.startFindReplaceAction", "keybinding": "Ctrl+H", "when": ""},
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
    {"command": "workbench.action.focusNextGroup", "keybinding": "Ctrl+1", "when": ""},
    {"command": "workbench.action.focusSecondEditorGroup", "keybinding": "Ctrl+2", "when": ""},
    {"command": "workbench.action.debug.start", "keybinding": "F5", "when": ""},
    {"command": "workbench.action.debug.stepOver", "keybinding": "F10", "when": "inDebugMode"},
    {"command": "workbench.action.debug.stepInto", "keybinding": "F11", "when": "inDebugMode"},
    {"command": "workbench.action.debug.stepOut", "keybinding": "Shift+F11", "when": "inDebugMode"},
    {"command": "workbench.action.debug.continue", "keybinding": "F5", "when": "inDebugMode"},
    {"command": "workbench.action.debug.stop", "keybinding": "Shift+F5", "when": "inDebugMode"},
    {"command": "editor.action.selectAll", "keybinding": "Ctrl+A", "when": "editorTextFocus"},
    {"command": "editor.action.clipboardCutAction", "keybinding": "Ctrl+X", "when": "editorTextFocus"},
    {"command": "editor.action.clipboardCopyAction", "keybinding": "Ctrl+C", "when": "editorTextFocus"},
    {"command": "editor.action.clipboardPasteAction", "keybinding": "Ctrl+V", "when": "editorTextFocus"},
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
    {"command": "workbench.action.toggleScreencastMode", "keybinding": "Ctrl+Shift+Alt+P", "when": ""},
    {"command": "editor.action.insertCursorAbove", "keybinding": "Ctrl+Alt+Up", "when": "editorTextFocus"},
    {"command": "editor.action.insertCursorBelow", "keybinding": "Ctrl+Alt+Down", "when": "editorTextFocus"},
    {"command": "cursorColumnSelectDown", "keybinding": "Ctrl+Shift+Alt+Down", "when": "editorTextFocus"},
    {"command": "cursorColumnSelectUp", "keybinding": "Ctrl+Shift+Alt+Up", "when": "editorTextFocus"},
]


class KeybindingsUIWidget(QWidget):
    """Interactive keybindings editor displayed as an editor tab."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._keybindings = list(DEFAULT_KEYBINDINGS)
        self._setup_ui()

    # Duck-typing for editor tab compatibility
    def get_file_path(self):
        return ""
    def is_dirty(self):
        return False
    def get_language(self):
        return "keybindings"
    def get_content(self):
        return json.dumps(self._keybindings, indent=2)

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.setStyleSheet("background-color: #000000;")

        # Header
        header = QWidget()
        header.setFixedHeight(50)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #1a0033;")
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(24, 0, 24, 0)

        title = QLabel("⌨ Keyboard Shortcuts")
        title.setStyleSheet("color: #cccccc; font-size: 18px; font-weight: 300;")
        header_layout.addWidget(title)
        header_layout.addStretch()

        # JSON button
        json_btn = QPushButton("Open Keyboard Shortcuts (JSON)")
        json_btn.setCursor(Qt.PointingHandCursor)
        json_btn.setStyleSheet("""
            QPushButton {
                background: transparent; color: #4a90d9;
                border: none; font-size: 12px; text-decoration: underline;
            }
            QPushButton:hover { color: #6bb0ff; }
        """)
        header_layout.addWidget(json_btn)
        layout.addWidget(header)

        # Search
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
        layout.addWidget(search_bar)

        # Table
        self._table = QTableWidget()
        self._table.setColumnCount(3)
        self._table.setHorizontalHeaderLabels(["Command", "Keybinding", "When"])
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self._table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self._table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._table.setAlternatingRowColors(True)
        self._table.verticalHeader().setVisible(False)
        self._table.setStyleSheet("""
            QTableWidget {
                background-color: #000000; color: #cccccc;
                border: none; font-size: 12px;
                gridline-color: #1a0033;
            }
            QTableWidget::item {
                padding: 6px 8px;
            }
            QTableWidget::item:selected {
                background-color: #04395e;
            }
            QTableWidget::item:alternate {
                background-color: #0a0a0a;
            }
            QHeaderView::section {
                background-color: #080808; color: #858585;
                border: none; border-bottom: 1px solid #1a0033;
                padding: 8px; font-size: 11px; font-weight: bold;
                text-transform: uppercase;
            }
        """)
        self._populate_table()
        layout.addWidget(self._table)

    def _populate_table(self):
        # Detect conflicts: same keybinding and same 'when' condition
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
                cmd_text = "⚠️ " + cmd_text

            cmd_item = QTableWidgetItem(cmd_text)
            cmd_item.setFlags(cmd_item.flags() & ~Qt.ItemIsEditable)
            if is_conflict:
                cmd_item.setToolTip("Conflict detected with another keybinding")
            self._table.setItem(i, 0, cmd_item)

            key_item = QTableWidgetItem(kb["keybinding"])
            if is_conflict:
                key_item.setForeground(QColor("#ff5555"))
            else:
                key_item.setForeground(QColor("#e2c08d"))
            self._table.setItem(i, 1, key_item)

            when_item = QTableWidgetItem(kb.get("when", ""))
            when_item.setForeground(QColor("#858585"))
            when_item.setFlags(when_item.flags() & ~Qt.ItemIsEditable)
            self._table.setItem(i, 2, when_item)

    def _filter_keybindings(self, text):
        text = text.lower()
        for row in range(self._table.rowCount()):
            match = True
            if text:
                cmd = self._table.item(row, 0).text().lower()
                key = self._table.item(row, 1).text().lower()
                match = text in cmd or text in key
            self._table.setRowHidden(row, not match)
