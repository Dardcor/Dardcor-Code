from PySide6.QtCore import QObject, Slot, Signal
import json

class WebviewMessageRouter(QObject):
    """Bridge for passing messages between JS in Webview and Python extension host."""
    
    # Signal emitted when JS sends a message to Python
    message_received = Signal(str, dict)

    def __init__(self, view_id: str):
        super().__init__()
        self.view_id = view_id

    @Slot(str)
    def postMessage(self, message_str: str):
        """Called from JS: window.vscode.postMessage(msg)"""
        try:
            message = json.loads(message_str)
            self.message_received.emit(self.view_id, message)
        except Exception:
            pass
