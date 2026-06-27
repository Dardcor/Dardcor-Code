"""Live Share Manager - VS Code style real-time collaboration."""

import uuid
import threading
from typing import Optional, List, Dict
from PySide6.QtCore import QObject, Signal, QTimer
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QListWidget, QListWidgetItem, QInputDialog, QMessageBox
)


class LiveShareManager(QObject):
    """Manages real-time collaboration state."""
    
    session_started = Signal(str)  # session URL
    session_ended = Signal()
    participant_joined = Signal(str)  # user name
    participant_left = Signal(str)    # user name
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._is_hosting = False
        self._is_guest = False
        self._session_id: Optional[str] = None
        self._participants: List[str] = []
        
    def is_active(self) -> bool:
        return self._is_hosting or self._is_guest
        
    def get_participants(self) -> List[str]:
        return self._participants
        
    def start_session(self):
        """Start hosting a new Live Share session."""
        if self.is_active():
            return
            
        def _mock_start():
            import time
            time.sleep(1)
            return True
            
        def _on_done(success):
            if success:
                self._is_hosting = True
                self._session_id = f"https://prod.liveshare.vsengsaas.visualstudio.com/join?{uuid.uuid4().hex[:12]}"
                self._participants = ["Me (Host)"]
                self.session_started.emit(self._session_id)
                
                # Mock a participant joining after 5 seconds
                QTimer.singleShot(5000, lambda: self._add_participant("Guest_01"))
                
        threading.Thread(target=lambda: QTimer.singleShot(0, lambda: _on_done(_mock_start())), daemon=True).start()
        
    def join_session(self, url: str):
        if self.is_active():
            return
            
        def _mock_join():
            import time
            time.sleep(1)
            return True
            
        def _on_done(success):
            if success:
                self._is_guest = True
                self._session_id = url
                self._participants = ["Host", "Me (Guest)"]
                self.session_started.emit(self._session_id)
                
        threading.Thread(target=lambda: QTimer.singleShot(0, lambda: _on_done(_mock_join())), daemon=True).start()
        
    def end_session(self):
        self._is_hosting = False
        self._is_guest = False
        self._session_id = None
        self._participants.clear()
        self.session_ended.emit()
        
    def _add_participant(self, name: str):
        if self.is_active():
            self._participants.append(name)
            self.participant_joined.emit(name)
