"""Settings Sync - VS Code style cloud synchronization."""

import os
import json
import uuid
import threading
from PySide6.QtCore import QObject, Signal, QTimer
from ..core.config import get_user_data_dir, CONFIG_FILE


class SettingsSyncManager(QObject):
    """Manages synchronization of settings, keybindings, and snippets."""
    
    sync_status_changed = Signal(str)  # status: "off", "syncing", "on", "error"
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._user_data_dir = get_user_data_dir()
        self._sync_id = self._load_sync_id()
        self._status = "off"
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._perform_sync)
        
    def _load_sync_id(self) -> str:
        sync_file = os.path.join(self._user_data_dir, "sync.json")
        if os.path.exists(sync_file):
            try:
                with open(sync_file, "r") as f:
                    data = json.load(f)
                return data.get("sync_id", "")
            except Exception:
                pass
        return ""
        
    def _save_sync_id(self):
        sync_file = os.path.join(self._user_data_dir, "sync.json")
        try:
            with open(sync_file, "w") as f:
                json.dump({"sync_id": self._sync_id}, f)
        except Exception:
            pass

    def turn_on(self, account_type="github"):
        """Initiate Settings Sync."""
        self._set_status("syncing")
        
        def _mock_auth():
            # Mock actual cloud auth by ensuring cloud dir exists
            cloud_dir = os.path.expanduser("~/.dardcor-cloud-mock")
            os.makedirs(cloud_dir, exist_ok=True)
            if not self._sync_id:
                self._sync_id = str(uuid.uuid4())
                self._save_sync_id()
            return True
            
        def _on_done(success):
            if success:
                self._set_status("on")
                self._timer.start(60000) # Sync every 60s
                self._perform_sync()
            else:
                self._set_status("error")
                
        threading.Thread(target=lambda: QTimer.singleShot(0, lambda: _on_done(_mock_auth())), daemon=True).start()
        
    def turn_off(self):
        self._timer.stop()
        self._set_status("off")
        
    def _set_status(self, status: str):
        if self._status != status:
            self._status = status
            self.sync_status_changed.emit(status)
            
    def get_status(self) -> str:
        return self._status

    def _perform_sync(self):
        if self._status != "on":
            return
            
        def _sync_worker():
            import shutil
            cloud_dir = os.path.expanduser("~/.dardcor-cloud-mock")
            files_to_sync = [
                CONFIG_FILE,
                os.path.join(self._user_data_dir, "keybindings.json"),
                os.path.join(self._user_data_dir, "snippets")
            ]
            
            try:
                for f in files_to_sync:
                    if os.path.exists(f):
                        if os.path.isdir(f):
                            dest = os.path.join(cloud_dir, os.path.basename(f))
                            shutil.copytree(f, dest, dirs_exist_ok=True)
                        else:
                            shutil.copy2(f, cloud_dir)
            except Exception as e:
                import logging
                logging.error(f"Sync failed: {e}")
            
        threading.Thread(target=_sync_worker, daemon=True).start()
