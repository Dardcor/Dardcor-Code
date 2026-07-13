import json
import os
from PySide6.QtCore import QObject, Signal, Slot
from typing import Dict, Optional

class AuthManager(QObject):
    """
    Manages authentication providers (GitHub, Microsoft) and accounts.
    Fulfills AGENT.md: authentication, github, githubAuthentication, microsoft-authentication.
    """
    auth_changed = Signal(str) # provider_id
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._providers = {
            "github": "GitHub",
            "microsoft": "Microsoft"
        }
        self._sessions: Dict[str, dict] = {}
        
    def get_providers(self):
        return self._providers
        
    def get_sessions(self, provider_id: str):
        return self._sessions.get(provider_id, [])
        
    def login(self, provider_id: str):
        if provider_id not in self._providers:
            return False
        # Mock login for now
        if provider_id not in self._sessions:
            self._sessions[provider_id] = []
        
        self._sessions[provider_id].append({
            "id": f"dummy_{provider_id}_token",
            "account": {
                "label": f"User ({self._providers[provider_id]})",
                "id": "user123"
            }
        })
        self.auth_changed.emit(provider_id)
        return True
        
    def logout(self, provider_id: str):
        if provider_id in self._sessions:
            self._sessions[provider_id] = []
            self.auth_changed.emit(provider_id)
