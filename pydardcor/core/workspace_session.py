import os
import json
import logging
from typing import Dict, List, Any, Optional
from PySide6.QtCore import QObject, QTimer, Signal

from pydardcor.core.config import get_global_home_dir

logger = logging.getLogger(__name__)

class WorkspaceSessionManager(QObject):
    """
    Manages session restore and hot exit functionality (Tasks 201-250).
    Saves open folders, files, split ratios, active tabs, and dirty content drafts.
    """
    session_restored = Signal(dict)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.session_file = os.path.join(get_global_home_dir(), "session.json")
        self.backup_file = os.path.join(get_global_home_dir(), "session.backup.json")
        self.drafts_dir = os.path.join(get_global_home_dir(), "drafts")
        os.makedirs(self.drafts_dir, exist_ok=True)
        
        self.auto_save_timer = QTimer(self)
        self.auto_save_timer.setInterval(30000) # 30 seconds
        self.auto_save_timer.timeout.connect(self.auto_save_session)
        
    def start_auto_save(self):
        self.auto_save_timer.start()
        
    def stop_auto_save(self):
        self.auto_save_timer.stop()

    def get_draft_path(self, file_path: str) -> str:
        """Get the draft file path for a dirty file."""
        import hashlib
        h = hashlib.sha256(file_path.encode('utf-8')).hexdigest()
        return os.path.join(self.drafts_dir, f"{h}.draft")

    def save_draft(self, file_path: str, content: str):
        """Save a draft for hot exit."""
        draft_path = self.get_draft_path(file_path)
        try:
            with open(draft_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            logger.error(f"Failed to save draft for {file_path}: {e}")

    def load_draft(self, file_path: str) -> Optional[str]:
        """Load a draft for hot exit."""
        draft_path = self.get_draft_path(file_path)
        if os.path.exists(draft_path):
            try:
                with open(draft_path, "r", encoding="utf-8") as f:
                    return f.read()
            except Exception as e:
                logger.error(f"Failed to load draft for {file_path}: {e}")
        return None

    def remove_draft(self, file_path: str):
        """Remove a draft once the file is saved cleanly."""
        draft_path = self.get_draft_path(file_path)
        if os.path.exists(draft_path):
            try:
                os.remove(draft_path)
            except Exception as e:
                logger.error(f"Failed to remove draft for {file_path}: {e}")

    def capture_current_state(self) -> dict:
        """Override this or pass state externally to capture the current UI state."""
        return {}

    def save_session(self, state: dict):
        """Save session state to session.json."""
        tmp = self.session_file + ".tmp"
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=4)
            os.replace(tmp, self.session_file)
            # Create a backup for crash recovery
            import shutil
            shutil.copy2(self.session_file, self.backup_file)
        except Exception as e:
            logger.error(f"Failed to save session: {e}")

    def load_session(self) -> dict:
        """Load session state from session.json or backup."""
        state = {}
        if os.path.exists(self.session_file):
            try:
                with open(self.session_file, 'r', encoding='utf-8') as f:
                    state = json.load(f)
            except Exception as e:
                logger.error(f"Failed to load session, trying backup: {e}")
                if os.path.exists(self.backup_file):
                    try:
                        with open(self.backup_file, 'r', encoding='utf-8') as f:
                            state = json.load(f)
                    except Exception as e2:
                        logger.error(f"Failed to load backup session: {e2}")
        
        self.session_restored.emit(state)
        return state

    def auto_save_session(self):
        """Periodic auto-save."""
        state = self.capture_current_state()
        if state:
            self.save_session(state)
