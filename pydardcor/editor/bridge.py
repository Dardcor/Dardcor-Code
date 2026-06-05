import os
import json
import subprocess
from PySide6.QtCore import QObject, Signal, Slot

class EditorBridge(QObject):
    """Bridge object exposed to Monaco Editor via QWebChannel."""

    # Signals (Monaco -> Python)
    content_changed = Signal(str)       # fired whenever user types
    cursor_changed = Signal(int, int)   # line, column
    save_requested = Signal()
    command_palette_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._diagnostics_callback = None
        self._file_path = None

    @Slot(str)
    def on_content_changed(self, content):
        """Called by Monaco when user edits text."""
        self.content_changed.emit(content)

    @Slot(int, int)
    def on_cursor_changed(self, line, col):
        """Called by Monaco when cursor moves."""
        self.cursor_changed.emit(line, col)

    @Slot()
    def request_save(self):
        """Called by Monaco when user presses Ctrl+S."""
        self.save_requested.emit()

    @Slot()
    def request_command_palette(self):
        """Called by Monaco when user presses Ctrl+Shift+P."""
        self.command_palette_requested.emit()

    def set_file_path(self, path):
        self._file_path = path
