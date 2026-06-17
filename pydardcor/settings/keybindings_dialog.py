import os
import json
from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
    QLineEdit, QTreeWidget, QTreeWidgetItem, QPushButton, 
    QDialogButtonBox, QMessageBox
)
from PySide6.QtCore import Qt, Signal, QEvent
from PySide6.QtGui import QKeySequence, QKeyEvent

class KeybindingsManager:
    def __init__(self, defaults=None):
        self.config_dir = os.path.expanduser("~/.dardcor-code")
        self.config_file = os.path.join(self.config_dir, "keybindings.json")
        self.defaults = defaults or []
        self.keybindings = {}
        self.labels = {}
        self._load()

    def _load(self):
        # Initialize with defaults
        for item in self.defaults:
            cmd_id = item.get('id')
            self.keybindings[cmd_id] = item.get('shortcut', '')
            self.labels[cmd_id] = item.get('label', '')

        # Override with saved
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                    for k, v in saved.items():
                        if k in self.keybindings:
                            if k == "edit.settings" and v == "Ctrl+,":
                                self.keybindings[k] = ""
                            else:
                                self.keybindings[k] = v
            except Exception:
                pass

    def save(self):
        if not os.path.exists(self.config_dir):
            os.makedirs(self.config_dir, exist_ok=True)
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.keybindings, f, indent=4)
        except Exception:
            pass

    def get_shortcut(self, command_id):
        return self.keybindings.get(command_id, '')

    def set_shortcut(self, command_id, key_sequence):
        self.keybindings[command_id] = key_sequence

    def get_all(self):
        return [
            {'id': k, 'label': self.labels.get(k, k), 'keys': v}
            for k, v in self.keybindings.items()
        ]
        
    def reset_to_defaults(self):
        for item in self.defaults:
            cmd_id = item.get('id')
            self.keybindings[cmd_id] = item.get('shortcut', '')

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
        
        # Ignore modifier-only key presses
        if key in (Qt.Key_Shift, Qt.Key_Control, Qt.Key_Alt, Qt.Key_Meta):
            return

        if key == Qt.Key_Escape and modifiers == Qt.NoModifier:
            self.recording_finished.emit("")
            return
            
        # Build key sequence
        key_sequence = QKeySequence(modifiers | key)
        shortcut_str = key_sequence.toString(QKeySequence.PortableText)
        
        # Replace default Qt representations with VS Code style if needed
        shortcut_str = shortcut_str.replace("Ctrl+", "Ctrl+").replace("Alt+", "Alt+").replace("Shift+", "Shift+")
        
        self.recording_finished.emit(shortcut_str)

class KeybindingsDialog(QDialog):
    def __init__(self, manager: KeybindingsManager, parent=None):
        super().__init__(parent)
        self.manager = manager
        self.setWindowTitle("Keyboard Shortcuts")
        self.resize(800, 600)
        
        self.setStyleSheet("""
            QDialog {
                background-color: #000000;
                color: #cccccc;
            }
            QLabel {
                color: #cccccc;
            }
            QLineEdit {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #2c004a;
                padding: 6px;
                border-radius: 4px;
            }
            QLineEdit:focus {
                border: 1px solid #4a0072;
            }
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: 1px solid #2c004a;
                alternate-background-color: #1a0033;
            }
            QTreeWidget::item {
                padding: 4px;
                border-bottom: 1px solid #1a0033;
            }
            QTreeWidget::item:selected {
                background-color: #2c004a;
            }
            QHeaderView::section {
                background-color: #1a0033;
                color: #cccccc;
                padding: 6px;
                border: none;
                border-bottom: 1px solid #2c004a;
            }
            QPushButton {
                background-color: #2c004a;
                color: #cccccc;
                border: 1px solid #2c004a;
                padding: 6px 16px;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #1a0033;
                border: 1px solid #4a0072;
            }
        """)

        layout = QVBoxLayout(self)

        # Search bar
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Type to search in keybindings")
        self.search_input.textChanged.connect(self.filter_commands)
        layout.addWidget(self.search_input)

        # Tree widget
        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Command", "Keybinding", "ID"])
        self.tree.setColumnWidth(0, 300)
        self.tree.setColumnWidth(1, 200)
        self.tree.setAlternatingRowColors(True)
        self.tree.itemDoubleClicked.connect(self.start_recording)
        layout.addWidget(self.tree)

        # Recorder widget (hidden by default)
        self.recorder = KeySequenceRecorder()
        self.recorder.hide()
        self.recorder.recording_finished.connect(self.finish_recording)
        self.current_edit_item = None
        layout.addWidget(self.recorder)

        # Buttons
        btn_layout = QHBoxLayout()
        
        self.reset_btn = QPushButton("Reset to Defaults")
        self.reset_btn.clicked.connect(self.reset_defaults)
        btn_layout.addWidget(self.reset_btn)
        
        btn_layout.addStretch()

        self.button_box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        self.button_box.accepted.connect(self.accept)
        self.button_box.rejected.connect(self.reject)
        
        # Style standard buttons
        for btn in self.button_box.buttons():
            btn.setStyleSheet("""
                QPushButton {
                    background-color: #2c004a;
                    color: #cccccc;
                    border: 1px solid #2c004a;
                    padding: 6px 16px;
                    border-radius: 4px;
                }
                QPushButton:hover {
                    background-color: #1a0033;
                    border: 1px solid #4a0072;
                }
            """)
            
        btn_layout.addWidget(self.button_box)
        layout.addLayout(btn_layout)

        self.populate_tree()

    def populate_tree(self):
        self.tree.clear()
        for item in self.manager.get_all():
            tree_item = QTreeWidgetItem(self.tree)
            tree_item.setText(0, item['label'])
            tree_item.setText(1, item['keys'])
            tree_item.setText(2, item['id'])
            
    def filter_commands(self, text):
        search_text = text.lower()
        for i in range(self.tree.topLevelItemCount()):
            item = self.tree.topLevelItem(i)
            match = (search_text in item.text(0).lower() or 
                     search_text in item.text(1).lower() or 
                     search_text in item.text(2).lower())
            item.setHidden(not match)

    def start_recording(self, item, column):
        self.current_edit_item = item
        self.recorder.show()
        self.recorder.setFocus()
        self.tree.setEnabled(False)

    def finish_recording(self, keys):
        self.recorder.hide()
        self.tree.setEnabled(True)
        
        if keys and self.current_edit_item:
            # Check for duplicates
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
                
                # Apply dark theme to message box
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
        # Save changes to manager
        for i in range(self.tree.topLevelItemCount()):
            item = self.tree.topLevelItem(i)
            cmd_id = item.text(2)
            keys = item.text(1)
            self.manager.set_shortcut(cmd_id, keys)
            
        self.manager.save()
        super().accept()
