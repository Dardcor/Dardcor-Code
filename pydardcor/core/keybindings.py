"""Keybindings Manager - VS Code style keybindings.json support."""

import os
import json
from typing import Dict, List, Optional, Tuple
from ..core.config import get_user_data_dir


KEYBINDINGS_FILE = os.path.join(get_user_data_dir(), "keybindings.json")


class KeybindingsManager:
    """Manages VS Code style keyboard shortcuts with user overrides."""

    def __init__(self, defaults: List[Tuple[str, str, str]] = None):
        # defaults: [(command_id, label, shortcut), ...]
        self._defaults: Dict[str, str] = {}  # command_id -> shortcut
        self._labels: Dict[str, str] = {}    # command_id -> label
        self._user_overrides: Dict[str, str] = {}  # command_id -> shortcut
        self._when_clauses: Dict[str, str] = {}  # command_id -> when clause

        if defaults:
            for item in defaults:
                if len(item) >= 3:
                    cmd_id, label, shortcut = item[0], item[1], item[2]
                    self._defaults[cmd_id] = shortcut
                    self._labels[cmd_id] = label

        self._load_user_overrides()

    def _load_user_overrides(self):
        if not os.path.exists(KEYBINDINGS_FILE):
            return
        try:
            with open(KEYBINDINGS_FILE, "r", encoding="utf-8") as f:
                content = f.read()
                lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                data = json.loads("\n".join(lines))
            if isinstance(data, list):
                for entry in data:
                    cmd = entry.get("command", "")
                    key = entry.get("key", "")
                    when = entry.get("when", "")
                    if cmd and key:
                        self._user_overrides[cmd] = key
                        if when:
                            self._when_clauses[cmd] = when
        except Exception:
            pass

    def get_shortcut(self, command_id: str) -> str:
        """Get effective shortcut for a command (user override > default)."""
        return self._user_overrides.get(command_id, self._defaults.get(command_id, ""))

    def get_label(self, command_id: str) -> str:
        return self._labels.get(command_id, command_id)

    def set_shortcut(self, command_id: str, shortcut: str):
        self._user_overrides[command_id] = shortcut
        self._save()

    def reset_shortcut(self, command_id: str):
        self._user_overrides.pop(command_id, None)
        self._save()

    def get_all_bindings(self) -> List[dict]:
        """Get all keybindings as list of dicts."""
        result = []
        all_commands = set(list(self._defaults.keys()) + list(self._user_overrides.keys()))
        for cmd in sorted(all_commands):
            result.append({
                "command": cmd,
                "label": self._labels.get(cmd, cmd),
                "key": self.get_shortcut(cmd),
                "default": self._defaults.get(cmd, ""),
                "overridden": cmd in self._user_overrides,
            })
        return result

    def find_command_by_shortcut(self, shortcut: str) -> Optional[str]:
        """Find command ID by shortcut string."""
        norm = shortcut.lower().replace(" ", "")
        for cmd, key in self._user_overrides.items():
            if key.lower().replace(" ", "") == norm:
                return cmd
        for cmd, key in self._defaults.items():
            if key.lower().replace(" ", "") == norm:
                return cmd
        return None

    def _save(self):
        data = []
        for cmd, key in self._user_overrides.items():
            entry = {"key": key, "command": cmd}
            if cmd in self._when_clauses:
                entry["when"] = self._when_clauses[cmd]
            data.append(entry)
        os.makedirs(os.path.dirname(KEYBINDINGS_FILE), exist_ok=True)
        with open(KEYBINDINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
