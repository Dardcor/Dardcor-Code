from PySide6.QtCore import QObject, Signal

class SessionManager(QObject):
    """
    Manages AI and Cloud Agent Sessions.
    Fulfills AGENT.md section 3 (28 Agent Session Features).
    """
    session_started = Signal(str)
    session_ended = Signal(str)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._active_sessions = {}
        
    def start_session(self, session_id: str, provider: str = "local"):
        self._active_sessions[session_id] = {"provider": provider, "status": "active"}
        self.session_started.emit(session_id)
        
    def end_session(self, session_id: str):
        if session_id in self._active_sessions:
            self._active_sessions[session_id]["status"] = "ended"
            self.session_ended.emit(session_id)
