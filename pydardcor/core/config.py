"""Configuration management for Dardcor Code."""

import os
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, Any, Optional

def get_user_data_dir() -> str:
    """Return the writable user-data directory for Dardcor Code.

    On Windows this is %LOCALAPPDATA%\\Dardcor Code so that the app never
    tries to write into the Program Files installation folder.
    On other platforms it falls back to ~/.dardcor-code.
    The directory is created on first call.
    """
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        data_dir = os.path.join(base, "Dardcor Code")
    else:
        data_dir = os.path.join(os.path.expanduser("~"), ".dardcor-code")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir

CONFIG_DIR = get_user_data_dir()
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

@dataclass
class AppConfig:
    workspace_path: str = ""
    ui_zoom: int = 0
    auto_save: bool = True
    font_family: str = "Cascadia Code"
    font_size: int = 13
    tab_size: int = 4
    word_wrap: bool = False
    minimap_enabled: bool = True
    terminal_shell: str = ""
    recent_files: list = field(default_factory=list)
    recent_folders: list = field(default_factory=list)
    show_open_editors: bool = False
    show_folders: bool = True
    show_outline: bool = True
    show_timeline: bool = True

    def save(self):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        data = asdict(self)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @classmethod
    def load(cls) -> "AppConfig":
        if not os.path.exists(CONFIG_FILE):
            cfg = cls()
            cfg.save()
            return cfg
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            valid_keys = {k for k in cls.__dataclass_fields__}
            cfg_data = {k: v for k, v in data.items() if k in valid_keys}
            return cls(**cfg_data)
        except Exception:
            return cls()

class HierarchicalConfig:
    """Manages VS Code style configuration hierarchy (Default -> User -> Workspace -> Folder)."""
    
    def __init__(self, workspace_path: Optional[str] = None):
        self.workspace_path = workspace_path
        self.user_settings: Dict[str, Any] = {}
        self.workspace_settings: Dict[str, Any] = {}
        self.folder_settings: Dict[str, Dict[str, Any]] = {}
        
        self.load_all()

    def load_all(self):
        # Load user settings (global)
        user_settings_path = os.path.join(CONFIG_DIR, "settings.json")
        self.user_settings = self._load_json_file(user_settings_path)
        
        # Load workspace settings
        if self.workspace_path and os.path.isdir(self.workspace_path):
            ws_settings_path = os.path.join(self.workspace_path, ".vscode", "settings.json")
            self.workspace_settings = self._load_json_file(ws_settings_path)

    def _load_json_file(self, path: str) -> Dict[str, Any]:
        if not os.path.exists(path):
            return {}
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
                lines = [line for line in content.split('\n') if not line.strip().startswith('//')]
                return json.loads('\n'.join(lines))
        except Exception:
            return {}

    def get(self, key: str, default: Any = None, folder_path: Optional[str] = None) -> Any:
        """Get a setting by traversing the hierarchy."""
        # 1. Folder settings (if multi-root)
        if folder_path and folder_path in self.folder_settings:
            if key in self.folder_settings[folder_path]:
                return self.folder_settings[folder_path][key]
                
        # 2. Workspace settings
        if key in self.workspace_settings:
            return self.workspace_settings[key]
            
        # 3. User settings
        if key in self.user_settings:
            return self.user_settings[key]
            
        # 4. Default
        return default

_config_instance = None
_hierarchical_instance = None

def get_config() -> AppConfig:
    global _config_instance
    if _config_instance is None:
        _config_instance = AppConfig.load()
    return _config_instance

def get_hierarchical_config(workspace_path: Optional[str] = None) -> HierarchicalConfig:
    global _hierarchical_instance
    if _hierarchical_instance is None or _hierarchical_instance.workspace_path != workspace_path:
        _hierarchical_instance = HierarchicalConfig(workspace_path)
    return _hierarchical_instance

def reset_config():
    global _config_instance, _hierarchical_instance
    _config_instance = None
    _hierarchical_instance = None
