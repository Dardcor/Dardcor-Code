"""Keybinding Editor - UI to edit keybindings."""
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel

class KeybindingEditor(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Keybindings Editor UI"))
