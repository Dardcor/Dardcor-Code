"""Profile Manager - VS Code style profiles supporting customized settings, keymaps, and extensions."""

import os
import json
import shutil
from typing import List, Dict, Any
from PySide6.QtCore import QObject, Signal

class ProfileManager(QObject):
    """Manages custom profiles (e.g., Python Developer, Demo, Minimal)."""
    profile_changed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._profiles_dir = os.path.expanduser("~/.dardcor-code/profiles")
        self._active_profile = "Default"
        self._load_active_profile()

    def _load_active_profile(self):
        active_file = os.path.expanduser("~/.dardcor-code/active_profile.txt")
        if os.path.exists(active_file):
            try:
                with open(active_file, "r", encoding="utf-8") as f:
                    self._active_profile = f.read().strip() or "Default"
            except Exception:
                self._active_profile = "Default"

    def _save_active_profile(self):
        active_file = os.path.expanduser("~/.dardcor-code/active_profile.txt")
        try:
            os.makedirs(os.path.dirname(active_file), exist_ok=True)
            with open(active_file, "w", encoding="utf-8") as f:
                f.write(self._active_profile)
        except Exception:
            pass

    def get_profiles(self) -> List[str]:
        profiles = ["Default"]
        if os.path.exists(self._profiles_dir):
            for name in os.listdir(self._profiles_dir):
                if os.path.isdir(os.path.join(self._profiles_dir, name)):
                    profiles.append(name)
        return profiles

    def get_active_profile(self) -> str:
        return self._active_profile

    def create_profile(self, name: str, copy_from: str = "Default") -> bool:
        if not name or name == "Default":
            return False
        
        target_dir = os.path.join(self._profiles_dir, name)
        if os.path.exists(target_dir):
            return False  # Already exists
            
        try:
            os.makedirs(target_dir, exist_ok=True)
            if copy_from != "Default":
                source_dir = os.path.join(self._profiles_dir, copy_from)
                if os.path.exists(source_dir):
                    # Copy settings/keybindings
                    for item in os.listdir(source_dir):
                        s = os.path.join(source_dir, item)
                        d = os.path.join(target_dir, item)
                        if os.path.isdir(s):
                            shutil.copytree(s, d)
                        else:
                            shutil.copy2(s, d)
            return True
        except Exception:
            return False

    def switch_profile(self, name: str):
        if name in self.get_profiles():
            self._active_profile = name
            self._save_active_profile()
            self.profile_changed.emit(name)

    def delete_profile(self, name: str) -> bool:
        if name == "Default" or name == self._active_profile:
            return False
        target_dir = os.path.join(self._profiles_dir, name)
        if os.path.exists(target_dir):
            try:
                shutil.rmtree(target_dir)
                return True
            except Exception:
                return False
        return False

    def export_profile(self, name: str, filepath: str) -> bool:
        target_dir = os.path.join(self._profiles_dir, name) if name != "Default" else os.path.expanduser("~/.dardcor-code")
        settings_file = os.path.join(target_dir, "settings.json")
        keybindings_file = os.path.join(target_dir, "keybindings.json")
        
        data = {"profile_name": name, "settings": {}, "keybindings": []}
        try:
            if os.path.exists(settings_file):
                with open(settings_file, "r", encoding="utf-8") as f:
                    data["settings"] = json.load(f)
            if os.path.exists(keybindings_file):
                with open(keybindings_file, "r", encoding="utf-8") as f:
                    data["keybindings"] = json.load(f)
            
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            return True
        except Exception:
            return False

    def import_profile(self, filepath: str) -> bool:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            name = data.get("profile_name")
            if not name or name == "Default":
                return False
                
            self.create_profile(name)
            target_dir = os.path.join(self._profiles_dir, name)
            
            settings_file = os.path.join(target_dir, "settings.json")
            keybindings_file = os.path.join(target_dir, "keybindings.json")
            
            if data.get("settings"):
                with open(settings_file, "w", encoding="utf-8") as f:
                    json.dump(data["settings"], f, indent=4)
            if data.get("keybindings"):
                with open(keybindings_file, "w", encoding="utf-8") as f:
                    json.dump(data["keybindings"], f, indent=4)
            return True
        except Exception:
            return False
