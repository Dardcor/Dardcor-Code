from PySide6.QtCore import QObject, Slot, Signal

class TerminalBridge(QObject):
    """Bridge for communication between Python and xterm.js inside QWebEngineView."""
    
    # Emitted when the frontend JavaScript sends data (keystrokes) to Python
    data_from_frontend = Signal(str)
    
    # Emitted when the frontend JavaScript resizes the terminal
    resize_requested = Signal(int, int)

    def __init__(self, parent=None):
        super().__init__(parent)

    @Slot(str)
    def receive_data(self, data):
        """Called by xterm.js via QWebChannel when user types."""
        self.data_from_frontend.emit(data)

    @Slot(int, int)
    def resize_pty(self, cols, rows):
        """Called by xterm.js via QWebChannel when terminal resizes."""
        self.resize_requested.emit(cols, rows)

    @Slot(str)
    def copy_to_clipboard(self, text):
        """Called by xterm.js to copy text to system clipboard."""
        from PySide6.QtWidgets import QApplication
        clipboard = QApplication.clipboard()
        clipboard.setText(text)

    @Slot()
    def request_paste(self):
        """Called by xterm.js to paste text from system clipboard."""
        from PySide6.QtWidgets import QApplication
        clipboard = QApplication.clipboard()
        text = clipboard.text()
        if text:
            # We treat pasted text exactly like typed data
            self.data_from_frontend.emit(text)
