"""Settings Migration - Handles migrating settings between versions, formats, and profiles."""

import os
import json
import shutil
import copy
from typing import Dict, Any, Optional
from ..core.config import get_user_data_dir, get_global_home_dir, CONFIG_FILE

MIGRATIONS_FILE = os.path.join(get_user_data_dir(), "migrations.json")


def _load_migrations_state() -> Dict[str, Any]:
    if os.path.exists(MIGRATIONS_FILE):
        try:
            with open(MIGRATIONS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 0, "applied": []}


def _save_migrations_state(state: Dict[str, Any]):
    os.makedirs(os.path.dirname(MIGRATIONS_FILE), exist_ok=True)
    with open(MIGRATIONS_FILE, "w") as f:
        json.dump(state, f, indent=2)


class SettingsMigration:
    MIGRATIONS = []

    @classmethod
    def register(cls, version: int, description: str, fn):
        cls.MIGRATIONS.append({"version": version, "description": description, "fn": fn})
        cls.MIGRATIONS.sort(key=lambda m: m["version"])

    @classmethod
    def run_pending(cls):
        state = _load_migrations_state()
        current_version = state["version"]
        applied = set(state["applied"])

        for mig in cls.MIGRATIONS:
            if mig["version"] > current_version and mig["description"] not in applied:
                try:
                    mig["fn"]()
                    applied.add(mig["description"])
                    state["version"] = mig["version"]
                    state["applied"] = list(applied)
                    _save_migrations_state(state)
                except Exception as e:
                    import logging
                    logging.error(f"Migration v{mig['version']} ('{mig['description']}') failed: {e}")
                    raise

        _save_migrations_state(state)

    @classmethod
    def get_pending_count(cls) -> int:
        state = _load_migrations_state()
        applied = set(state["applied"])
        return sum(1 for m in cls.MIGRATIONS if m["description"] not in applied)


def _v1_migrate_old_config():
    """Migrate from old flat config format to hierarchical settings.json."""
    home = get_global_home_dir()
    old_config = os.path.join(home, "config", "config.json")
    if os.path.exists(old_config):
        try:
            with open(old_config, "r") as f:
                data = json.load(f)
            settings_path = os.path.join(home, "settings.json")
            if os.path.exists(settings_path):
                with open(settings_path, "r") as f:
                    existing = json.load(f)
            else:
                existing = {}
            existing.update({k: v for k, v in data.items() if k not in existing})
            os.makedirs(os.path.dirname(settings_path), exist_ok=True)
            with open(settings_path, "w") as f:
                json.dump(existing, f, indent=2)
            os.rename(old_config, old_config + ".bak")
        except Exception:
            pass


def _v2_migrate_snippets_format():
    """Migrate single-file snippets to per-language files."""
    home = get_global_home_dir()
    old_snippets = os.path.join(home, "snippets", "snippets.json")
    if os.path.exists(old_snippets):
        try:
            with open(old_snippets, "r") as f:
                data = json.load(f)
            snippets_dir = os.path.join(home, "snippets")
            by_lang: Dict[str, dict] = {}
            for name, val in data.items():
                scope = val.get("scope", "global")
                lang = scope if scope and scope != "global" else "global"
                if lang not in by_lang:
                    by_lang[lang] = {}
                by_lang[lang][name] = val
            for lang, snippets in by_lang.items():
                fpath = os.path.join(snippets_dir, f"{lang}.json")
                if not os.path.exists(fpath):
                    with open(fpath, "w") as f:
                        json.dump(snippets, f, indent=2)
            os.rename(old_snippets, old_snippets + ".bak")
        except Exception:
            pass


def _v3_migrate_keybindings_format():
    """Migrate flat keybindings map to array format."""
    home = get_global_home_dir()
    kb_file = os.path.join(home, "keybindings.json")
    if os.path.exists(kb_file):
        try:
            with open(kb_file, "r") as f:
                data = json.load(f)
            if isinstance(data, dict):
                array_format = [{"command": k, "keybinding": v} for k, v in data.items()]
                with open(kb_file, "w") as f:
                    json.dump(array_format, f, indent=2)
        except Exception:
            pass


SettingsMigration.register(1, "Migrate old flat config to settings.json", _v1_migrate_old_config)
SettingsMigration.register(2, "Migrate snippets to per-language files", _v2_migrate_snippets_format)
SettingsMigration.register(3, "Migrate keybindings dict to array format", _v3_migrate_keybindings_format)


def run_migrations():
    SettingsMigration.run_pending()
