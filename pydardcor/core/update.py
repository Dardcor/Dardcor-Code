"""Update Manager - Manages stable/insiders update checks, background downloading, and installers."""

import os
import json
import urllib.request
import threading
from PySide6.QtCore import QObject, Signal, QTimer

class UpdateManager(QObject):
    """Checks for Dardcor Code updates and manages background downloads."""
    
    check_finished = Signal(bool, str, str)  # update_available, version, release_notes
    download_progress = Signal(int)  # percentage
    download_finished = Signal(str)  # local_path

    def __init__(self, current_version="1.0.0", parent=None):
        super().__init__(parent)
        self.current_version = current_version
        self._channel = "stable"
        self._update_url = "https://raw.githubusercontent.com/Dardcor/Dardcor-Code/main/product.json"

    def set_channel(self, channel: str):
        if channel in ["stable", "insiders"]:
            self._channel = channel

    def get_channel(self) -> str:
        return self._channel

    def check_for_updates(self):
        """Asynchronously query current product.json for newer versions."""
        def _check():
            try:
                # We query GitHub product.json or use a mock fallback if offline
                req = urllib.request.Request(self._update_url, headers={'User-Agent': 'Dardcor-Code'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read().decode('utf-8'))
                
                latest_ver = data.get("version", "1.0.0")
                notes = data.get("releaseNotes", "Performance improvements and bug fixes.")
                
                # Simple semantic version check
                has_update = latest_ver != self.current_version
                self.check_finished.emit(has_update, latest_ver, notes)
            except Exception:
                # Fallback to check offline/mock update
                self.check_finished.emit(False, self.current_version, "")

        threading.Thread(target=_check, daemon=True).start()

    def download_update(self, version: str):
        """Mock downloading version package in background with progress signals."""
        def _download():
            import time
            for i in range(0, 101, 10):
                self.download_progress.emit(i)
                time.sleep(0.2)
            
            temp_path = os.path.expanduser(f"~/.dardcor-code/updates/update_{version}.zip")
            os.makedirs(os.path.dirname(temp_path), exist_ok=True)
            with open(temp_path, "w") as f:
                f.write("mock_payload")
            self.download_finished.emit(temp_path)

        threading.Thread(target=_download, daemon=True).start()
