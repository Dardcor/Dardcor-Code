import base64
from PySide6.QtCore import QObject, Slot, Signal

class WebBridge(QObject):
    # Signals to send data to JS
    append_user_message = Signal(str, str)
    append_agent_message = Signal(str, bool)
    append_system_message = Signal(str)
    append_tool_call = Signal(str, str, str, str)
    show_typing = Signal(bool, str)
    clear_chat = Signal()
    show_notification = Signal(str)
    
    # Signal to notify panel when an action occurs (e.g. copy, retry, revert)
    action_requested = Signal(str, str)

    def __init__(self, parent=None):
        super().__init__(parent)

    @Slot(str, str)
    def handle_action(self, action: str, b64_payload: str):
        try:
            payload = base64.b64decode(b64_payload).decode('utf-8')
        except Exception:
            payload = ""
        self.action_requested.emit(action, payload)
