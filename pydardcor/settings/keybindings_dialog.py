import os
import json
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QLineEdit, QTreeWidget, QTreeWidgetItem, QPushButton,
    QDialogButtonBox, QMessageBox, QComboBox, QTabWidget,
    QPlainTextEdit, QHeaderView
)
from PySide6.QtCore import Qt, Signal, QEvent
from PySide6.QtGui import QKeySequence, QKeyEvent

from ..core.config import get_global_home_dir


WHEN_PRESETS = [
    "", "editorTextFocus", "editorHasSelection", "editorLangId == 'python'",
    "inDebugMode", "terminalFocus", "sidebarVisible", "panelVisible",
    "explorerViewletVisible", "resourceScheme == 'file'",
    "editorHasMultipleSelections", "!editorReadonly",
    "view == 'workbench.explorer.explorerView'", "inputFocus",
]


class KeybindingsManager:
    def __init__(self, defaults=None):
        self.config_dir = get_global_home_dir()
        self.config_file = os.path.join(self.config_dir, "keybindings.json")
        self.defaults = defaults or []
        self.keybindings = {}
        self.labels = {}
        self.when_clauses = {}
        self._load()

    def _load(self):
        for item in self.defaults:
            cmd_id = item.get('id')
            self.keybindings[cmd_id] = item.get('shortcut', '')
            self.labels[cmd_id] = item.get('label', '')
            self.when_clauses[cmd_id] = item.get('when', '')

        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                    if isinstance(saved, list):
                        for entry in saved:
                            cmd = entry.get('command', '')
                            if cmd in self.keybindings:
                                self.keybindings[cmd] = entry.get('keybinding', self.keybindings[cmd])
                                if entry.get('when'):
                                    self.when_clauses[cmd] = entry.get('when', '')
                    elif isinstance(saved, dict):
                        for k, v in saved.items():
                            if k in self.keybindings:
                                self.keybindings[k] = v if isinstance(v, str) else v.get('keybinding', v)
                                if isinstance(v, dict) and v.get('when'):
                                    self.when_clauses[k] = v.get('when', '')
            except Exception:
                pass

    def save(self):
        if not os.path.exists(self.config_dir):
            os.makedirs(self.config_dir, exist_ok=True)
        data = []
        for cmd_id in self.keybindings:
            entry = {
                "command": cmd_id,
                "keybinding": self.keybindings[cmd_id],
            }
            when = self.when_clauses.get(cmd_id, "")
            if when:
                entry["when"] = when
            data.append(entry)
        tmp = self.config_file + ".tmp"
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
            os.replace(tmp, self.config_file)
        except Exception:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    def get_shortcut(self, command_id):
        return self.keybindings.get(command_id, '')

    def set_shortcut(self, command_id, key_sequence):
        self.keybindings[command_id] = key_sequence

    def set_when_clause(self, command_id, when_clause):
        self.when_clauses[command_id] = when_clause

    def get_when_clause(self, command_id):
        return self.when_clauses.get(command_id, '')

    def get_all(self):
        return [
            {'id': k, 'label': self.labels.get(k, k), 'keys': v, 'when': self.when_clauses.get(k, '')}
            for k, v in self.keybindings.items()
        ]

    def reset_to_defaults(self):
        for item in self.defaults:
            cmd_id = item.get('id')
            self.keybindings[cmd_id] = item.get('shortcut', '')
            self.when_clauses[cmd_id] = item.get('when', '')


class KeySequenceRecorder(QLineEdit):
    recording_finished = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setText("Press desired key combination... (Esc to cancel)")
        self.setStyleSheet("""
            QLineEdit {
                background-color: #1a0033;
                color: #cccccc;
                border: 1px solid #4a0072;
                padding: 4px;
                font-style: italic;
            }
        """)

    def keyPressEvent(self, event: QKeyEvent):
        key = event.key()
        modifiers = event.modifiers()
        if key in (Qt.Key_Shift, Qt.Key_Control, Qt.Key_Alt, Qt.Key_Meta):
            return
        if key == Qt.Key_Escape and modifiers == Qt.NoModifier:
            self.recording_finished.emit("")
            return
        key_sequence = QKeySequence(modifiers | key)
        shortcut_str = key_sequence.toString(QKeySequence.PortableText)
        self.recording_finished.emit(shortcut_str)


class KeybindingsDialog(QDialog):
    def __init__(self, manager: KeybindingsManager, parent=None):
        super().__init__(parent)
        self.manager = manager
        self.setWindowTitle("Keyboard Shortcuts")
        self.resize(900, 650)
        self.setStyleSheet("""
            QDialog { background-color: #000000; color: #cccccc; }
            QLabel { color: #cccccc; }
            QLineEdit { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; padding: 6px; border-radius: 4px; }
            QLineEdit:focus { border: 1px solid #4a0072; }
            QComboBox { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; padding: 4px; border-radius: 4px; }
            QComboBox:focus { border: 1px solid #4a0072; }
            QPlainTextEdit { background-color: #0a0a0a; color: #cccccc; border: 1px solid #2c004a; padding: 6px; font-family: Consolas, monospace; }
            QTreeWidget { background-color: #000000; color: #cccccc; border: 1px solid #2c004a; alternate-background-color: #1a0033; }
            QTreeWidget::item { padding: 4px; border-bottom: 1px solid #1a0033; }
            QTreeWidget::item:selected { background-color: #2c004a; }
            QHeaderView::section { background-color: #1a0033; color: #cccccc; padding: 6px; border: none; border-bottom: 1px solid #2c004a; }
            QPushButton { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; padding: 6px 16px; border-radius: 4px; }
            QPushButton:hover { background-color: #1a0033; border: 1px solid #4a0072; }
            QTabWidget::pane { border: none; background-color: #000000; }
            QTabBar::tab { background: transparent; color: #858585; padding: 4px 12px; border-bottom: 2px solid transparent; font-size: 11px; }
            QTabBar::tab:selected { color: #fff; border-bottom: 2px solid #5a009c; }
        """)

        layout = QVBoxLayout(self)

        self._tabs = QTabWidget()
        self._tabs.addTab(self._build_visual_tab(), "Visual Editor")
        self._tabs.addTab(self._build_json_tab(), "JSON Editor")
        layout.addWidget(self._tabs)

        btn_layout = QHBoxLayout()
        self.reset_btn = QPushButton("Reset to Defaults")
        self.reset_btn.clicked.connect(self.reset_defaults)
        btn_layout.addWidget(self.reset_btn)
        btn_layout.addStretch()

        self.button_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        self.button_box.accepted.connect(self.accept)
        self.button_box.rejected.connect(self.reject)
        for btn in self.button_box.buttons():
            btn.setStyleSheet("""
                QPushButton { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; padding: 6px 16px; border-radius: 4px; }
                QPushButton:hover { background-color: #1a0033; border: 1px solid #4a0072; }
            """)
        btn_layout.addWidget(self.button_box)
        layout.addLayout(btn_layout)

        self.populate_tree()

    def _build_visual_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Type to search in keybindings")
        self.search_input.textChanged.connect(self.filter_commands)
        layout.addWidget(self.search_input)

        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Command", "Keybinding", "When Clause", "ID"])
        self.tree.setColumnWidth(0, 250)
        self.tree.setColumnWidth(1, 150)
        self.tree.setColumnWidth(2, 200)
        self.tree.setAlternatingRowColors(True)
        self.tree.itemDoubleClicked.connect(self.start_recording)
        layout.addWidget(self.tree)

        self.recorder = KeySequenceRecorder()
        self.recorder.hide()
        self.recorder.recording_finished.connect(self.finish_recording)
        self.current_edit_item = None
        layout.addWidget(self.recorder)

        when_layout = QHBoxLayout()
        when_layout.addWidget(QLabel("When clause:"))
        self._when_combo = QComboBox()
        self._when_combo.setEditable(True)
        self._when_combo.addItems(WHEN_PRESETS)
        self._when_combo.setStyleSheet("QComboBox { background-color: #2c004a; color: #cccccc; border: 1px solid #2c004a; padding: 4px; }")
        when_layout.addWidget(self._when_combo)
        apply_when = QPushButton("Apply When")
        apply_when.clicked.connect(self._apply_when_to_selected)
        when_layout.addWidget(apply_when)
        when_layout.addStretch()
        layout.addLayout(when_layout)

        return w

    def _build_json_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(16, 16, 16, 16)

        header = QLabel("Directly edit keybindings.json. Array of {command, keybinding, when} objects.")
        header.setStyleSheet("color: #858585; font-size: 12px;")
        header.setWordWrap(True)
        layout.addWidget(header)

        self._json_editor = QPlainTextEdit()
        self._json_editor.setPlainText(self._get_json_text())
        self._json_editor.setMinimumHeight(300)
        layout.addWidget(self._json_editor)

        btn = QPushButton("Apply from JSON")
        btn.clicked.connect(self._apply_json)
        layout.addWidget(btn)

        return w

    def _get_json_text(self) -> str:
        data = []
        for item in self.manager.get_all():
            entry = {"command": item['id'], "keybinding": item['keys']}
            if item.get('when'):
                entry['when'] = item['when']
            data.append(entry)
        return json.dumps(data, indent=2)

    def _apply_json(self):
        text = self._json_editor.toPlainText().strip()
        if not text:
            return
        try:
            entries = json.loads(text)
            if not isinstance(entries, list):
                raise ValueError("Must be a JSON array")
            for entry in entries:
                cmd = entry.get('command', '')
                if cmd:
                    self.manager.set_shortcut(cmd, entry.get('keybinding', ''))
                    self.manager.set_when_clause(cmd, entry.get('when', ''))
            self.populate_tree()
        except (json.JSONDecodeError, ValueError) as e:
            QMessageBox.warning(self, "Invalid JSON", str(e))

    def _apply_when_to_selected(self):
        item = self.tree.currentItem()
        if item:
            when = self._when_combo.currentText()
            item.setText(2, when)

    def populate_tree(self):
        self.tree.clear()
        for item in self.manager.get_all():
            tree_item = QTreeWidgetItem(self.tree)
            tree_item.setText(0, item['label'])
            tree_item.setText(1, item['keys'])
            tree_item.setText(2, item.get('when', ''))
            tree_item.setText(3, item['id'])

    def filter_commands(self, text):
        search_text = text.lower()
        for i in range(self.tree.topLevelItemCount()):
            item = self.tree.topLevelItem(i)
            match = (search_text in item.text(0).lower() or
                     search_text in item.text(1).lower() or
                     search_text in item.text(2).lower() or
                     search_text in item.text(3).lower())
            item.setHidden(not match)

    def start_recording(self, item, column):
        if column == 2:
            return
        self.current_edit_item = item
        self.recorder.show()
        self.recorder.setFocus()
        self.tree.setEnabled(False)

    def finish_recording(self, keys):
        self.recorder.hide()
        self.tree.setEnabled(True)
        if keys and self.current_edit_item:
            duplicate_item = None
            for i in range(self.tree.topLevelItemCount()):
                item = self.tree.topLevelItem(i)
                if item != self.current_edit_item and item.text(1) == keys:
                    duplicate_item = item
                    break
            if duplicate_item:
                msg = QMessageBox(self)
                msg.setWindowTitle("Duplicate Shortcut")
                msg.setText(f"Shortcut '{keys}' is already assigned to '{duplicate_item.text(0)}'.")
                msg.setInformativeText("Do you want to reassign it?")
                msg.setStandardButtons(QMessageBox.Yes | QMessageBox.No)
                msg.setDefaultButton(QMessageBox.No)
                msg.setStyleSheet("""
                    QMessageBox { background-color: #000000; color: #cccccc; }
                    QLabel { color: #cccccc; }
                    QPushButton { background-color: #2c004a; color: #cccccc; padding: 6px; border: 1px solid #4a0072; }
                    QPushButton:hover { background-color: #1a0033; }
                """)
                if msg.exec() == QMessageBox.Yes:
                    duplicate_item.setText(1, "")
                    self.current_edit_item.setText(1, keys)
            else:
                self.current_edit_item.setText(1, keys)
        self.current_edit_item = None

    def reset_defaults(self):
        self.manager.reset_to_defaults()
        self.populate_tree()

    def accept(self):
        for i in range(self.tree.topLevelItemCount()):
            item = self.tree.topLevelItem(i)
            cmd_id = item.text(3)
            keys = item.text(1)
            when = item.text(2)
            self.manager.set_shortcut(cmd_id, keys)
            self.manager.set_when_clause(cmd_id, when)
        self.manager.save()
        super().accept()
