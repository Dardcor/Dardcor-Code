"""Profile Manager - VS Code style profiles supporting customized settings, keymaps, snippets, and extensions."""

import os
import json
import shutil
import copy
from typing import List, Dict, Any, Optional
from PySide6.QtCore import QObject, Signal

from ..core.config import get_global_home_dir, get_user_data_dir


class ProfileManager(QObject):
    """Manages custom profiles (e.g., Python Developer, Demo, Minimal) with full settings/keybindings/snippets/extensions isolation."""
    profile_changed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._profiles_dir = os.path.join(get_global_home_dir(), "profiles")
        self._active_profile = "Default"
        self._load_active_profile()

    def _load_active_profile(self):
        active_file = os.path.join(get_global_home_dir(), "active_profile.txt")
        if os.path.exists(active_file):
            try:
                with open(active_file, "r", encoding="utf-8") as f:
                    self._active_profile = f.read().strip() or "Default"
            except Exception:
                self._active_profile = "Default"

    def _save_active_profile(self):
        active_file = os.path.join(get_global_home_dir(), "active_profile.txt")
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
            return False
        try:
            os.makedirs(target_dir, exist_ok=True)
            if copy_from != "Default":
                source_dir = os.path.join(self._profiles_dir, copy_from)
                if os.path.exists(source_dir):
                    for item in os.listdir(source_dir):
                        s = os.path.join(source_dir, item)
                        d = os.path.join(target_dir, item)
                        if os.path.isdir(s):
                            shutil.copytree(s, d)
                        else:
                            shutil.copy2(s, d)
            else:
                settings_path = os.path.join(get_user_data_dir(), "settings.json")
                if os.path.exists(settings_path):
                    shutil.copy2(settings_path, os.path.join(target_dir, "settings.json"))
                kb_path = os.path.join(get_global_home_dir(), "keybindings.json")
                if os.path.exists(kb_path):
                    shutil.copy2(kb_path, os.path.join(target_dir, "keybindings.json"))
                snip_dir = os.path.join(get_global_home_dir(), "snippets")
                if os.path.exists(snip_dir):
                    shutil.copytree(snip_dir, os.path.join(target_dir, "snippets"))
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

    def duplicate_profile(self, name: str, new_name: str) -> bool:
        if not new_name or new_name == "Default":
            return False
        return self.create_profile(new_name, copy_from=name)

    def rename_profile(self, old_name: str, new_name: str) -> bool:
        if old_name == "Default" or not new_name or new_name == "Default":
            return False
        old_dir = os.path.join(self._profiles_dir, old_name)
        new_dir = os.path.join(self._profiles_dir, new_name)
        if not os.path.exists(old_dir) or os.path.exists(new_dir):
            return False
        try:
            os.rename(old_dir, new_dir)
            if self._active_profile == old_name:
                self._active_profile = new_name
                self._save_active_profile()
            return True
        except Exception:
            return False

    def export_profile(self, name: str, filepath: str) -> bool:
        data = self._export_profile_data(name)
        if data is None:
            return False
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            return True
        except Exception:
            return False

    def _export_profile_data(self, name: str) -> Optional[dict]:
        if name == "Default":
            target_dir = get_global_home_dir()
        else:
            target_dir = os.path.join(self._profiles_dir, name)
            if not os.path.exists(target_dir):
                return None
        settings_file = os.path.join(target_dir, "settings.json")
        keybindings_file = os.path.join(target_dir, "keybindings.json")
        snippets_dir = os.path.join(target_dir, "snippets")
        data: dict = {
            "profile_name": name,
            "dardcor_version": "1.0.0",
            "settings": {},
            "keybindings": [],
            "snippets": {},
            "extensions": {},
        }
        try:
            if os.path.exists(settings_file):
                with open(settings_file, "r", encoding="utf-8") as f:
                    data["settings"] = json.load(f)
            if os.path.exists(keybindings_file):
                with open(keybindings_file, "r", encoding="utf-8") as f:
                    data["keybindings"] = json.load(f)
            if os.path.isdir(snippets_dir):
                for fname in os.listdir(snippets_dir):
                    if fname.endswith(".json"):
                        spath = os.path.join(snippets_dir, fname)
                        try:
                            with open(spath, "r", encoding="utf-8") as f:
                                data["snippets"][fname.replace(".json", "")] = json.load(f)
                        except Exception:
                            pass
        except Exception:
            return None
        return data

    def import_profile(self, filepath: str) -> bool:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            name = data.get("profile_name")
            if not name or name == "Default":
                return False
            self.create_profile(name)
            target_dir = os.path.join(self._profiles_dir, name)
            if data.get("settings"):
                with open(os.path.join(target_dir, "settings.json"), "w", encoding="utf-8") as f:
                    json.dump(data["settings"], f, indent=4)
            if data.get("keybindings"):
                with open(os.path.join(target_dir, "keybindings.json"), "w", encoding="utf-8") as f:
                    json.dump(data["keybindings"], f, indent=4)
            if data.get("snippets"):
                snip_dir = os.path.join(target_dir, "snippets")
                os.makedirs(snip_dir, exist_ok=True)
                for lang, snippets in data["snippets"].items():
                    with open(os.path.join(snip_dir, f"{lang}.json"), "w", encoding="utf-8") as f:
                        json.dump(snippets, f, indent=4)
            return True
        except Exception:
            return False

    def get_profile_settings(self, name: str) -> dict:
        if name == "Default":
            spath = os.path.join(get_user_data_dir(), "settings.json")
        else:
            spath = os.path.join(self._profiles_dir, name, "settings.json")
        if os.path.exists(spath):
            try:
                with open(spath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def get_profile_keybindings(self, name: str) -> list:
        if name == "Default":
            kpath = os.path.join(get_global_home_dir(), "keybindings.json")
        else:
            kpath = os.path.join(self._profiles_dir, name, "keybindings.json")
        if os.path.exists(kpath):
            try:
                with open(kpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data if isinstance(data, list) else []
            except Exception:
                pass
        return []

    def get_profile_snippets(self, name: str) -> dict:
        if name == "Default":
            sdir = os.path.join(get_global_home_dir(), "snippets")
        else:
            sdir = os.path.join(self._profiles_dir, name, "snippets")
        result = {}
        if os.path.isdir(sdir):
            for fname in os.listdir(sdir):
                if fname.endswith(".json"):
                    try:
                        with open(os.path.join(sdir, fname), "r", encoding="utf-8") as f:
                            result[fname.replace(".json", "")] = json.load(f)
                    except Exception:
                        pass
        return result

    def get_profile_metadata(self, name: str) -> dict:
        """Get metadata about a profile including size and file count."""
        if name == "Default":
            return {"name": "Default", "is_builtin": True}
        pdir = os.path.join(self._profiles_dir, name)
        if not os.path.exists(pdir):
            return {"name": name, "exists": False}
        total_size = 0
        file_count = 0
        for root, dirs, files in os.walk(pdir):
            for f in files:
                fp = os.path.join(root, f)
                try:
                    total_size += os.path.getsize(fp)
                    file_count += 1
                except OSError:
                    pass
        return {
            "name": name,
            "exists": True,
            "size_bytes": total_size,
            "file_count": file_count,
            "is_builtin": False,
        }
