import json
import os
import logging
from PySide6.QtCore import QObject, Signal

logger = logging.getLogger(__name__)

class AuthManager(QObject):
    """Manages OAuth authentication (e.g. GitHub/Microsoft) for Settings Sync."""
    
    auth_state_changed = Signal(bool)
    
    def __init__(self, config_dir: str):
        super().__init__()
        self.config_dir = config_dir
        self.token_file = os.path.join(self.config_dir, "sync_token.json")
        self.access_token = None
        self.user_info = {}
        
        self.load_token()

    def load_token(self):
        if os.path.exists(self.token_file):
            try:
                with open(self.token_file, 'r') as f:
                    data = json.load(f)
                    self.access_token = data.get("access_token")
                    self.user_info = data.get("user", {})
            except Exception as e:
                logger.error(f"Failed to read sync token: {e}")

    def is_authenticated(self) -> bool:
        return self.access_token is not None

    def login(self):
        """Mock login flow. In reality, opens browser to OAuth endpoint and starts local server."""
        import uuid
        self.access_token = str(uuid.uuid4())
        self.user_info = {"login": "user", "name": "Dardcor User"}
        
        with open(self.token_file, 'w') as f:
            json.dump({"access_token": self.access_token, "user": self.user_info}, f)
            
        self.auth_state_changed.emit(True)
        logger.info("Successfully logged in for Settings Sync.")

    def logout(self):
        self.access_token = None
        self.user_info = {}
        if os.path.exists(self.token_file):
            os.remove(self.token_file)
            
        self.auth_state_changed.emit(False)
        logger.info("Logged out of Settings Sync.")
