"""Remote SSH Manager - VS Code style remote development."""

import os
import subprocess
import threading
from typing import Optional
from PySide6.QtCore import QObject, Signal, QTimer
from ..core.config import get_user_data_dir


class RemoteSSHManager(QObject):
    """Manages Remote - SSH connections."""
    
    connection_state_changed = Signal(str)  # disconnected, connecting, connected
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_host: Optional[str] = None
        self._state = "disconnected"
        
    def _set_state(self, state: str):
        if self._state != state:
            self._state = state
            self.connection_state_changed.emit(state)

    def get_state(self) -> str:
        return self._state
        
    def get_current_host(self) -> Optional[str]:
        return self._current_host
        
    def connect_to_host(self, host: str):
        """Initiate SSH connection."""
        self._current_host = host
        self._set_state("connecting")
        
        def _connector():
            import time
            # In a real app this would start an SSH tunnel and remote server agent
            # For now, we mock the connection delay
            time.sleep(2)
            return True
            
        def _on_done(success):
            if success:
                self._set_state("connected")
            else:
                self._current_host = None
                self._set_state("disconnected")
                
        threading.Thread(target=lambda: QTimer.singleShot(0, lambda: _on_done(_connector())), daemon=True).start()

    def disconnect(self):
        self._current_host = None
        self._set_state("disconnected")
        
    def get_remote_file_content(self, path: str) -> str:
        """Fetch file from remote host."""
        if self._state != "connected":
            return ""
        # Mock remote fetch
        return f"# Remote file {path} from {self._current_host}\n"
