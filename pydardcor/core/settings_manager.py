"""Settings Manager for Dardcor Code.
Handles settings.json parsing, validation against schema, inheritance (User -> Workspace -> Folder),
and file watching for external changes.
"""

import os
import json
import logging
from typing import Any, Dict, Optional, List, Callable
from PySide6.QtCore import QObject, Signal, QFileSystemWatcher, QTimer

from .config import get_user_data_dir

logger = logging.getLogger(__name__)

class SettingsSchema:
    def __init__(self):
        self.properties: Dict[str, Dict[str, Any]] = {}
        # Prepopulate with basic schema
        self.register_property("editor.fontSize", {"type": "number", "default": 14})
        self.register_property("editor.fontFamily", {"type": "string", "default": "Consolas, 'Courier New', monospace"})
        self.register_property("editor.tabSize", {"type": "number", "default": 4})
        self.register_property("editor.wordWrap", {"type": "boolean", "default": False})
        self.register_property("files.autoSave", {"type": "string", "default": "off", "enum": ["off", "afterDelay", "onFocusChange", "onWindowChange"]})
        self.register_property("files.hotExit", {"type": "string", "default": "onExit", "enum": ["off", "onExit", "onExitAndWindowClose"]})
        self.register_property("workbench.colorTheme", {"type": "string", "default": "Default Dark Modern"})

    def register_property(self, key: str, schema: Dict[str, Any]):
        self.properties[key] = schema

    def get_default(self, key: str) -> Any:
        return self.properties.get(key, {}).get("default")
        
    def validate(self, key: str, value: Any) -> Any:
        if key not in self.properties:
            return value
        
        schema = self.properties[key]
        expected_type = schema.get("type")
        
        if expected_type == "number":
            if not isinstance(value, (int, float)):
                return self.get_default(key)
        elif expected_type == "boolean":
            if not isinstance(value, bool):
                return self.get_default(key)
        elif expected_type == "string":
            if not isinstance(value, str):
                return self.get_default(key)
            if "enum" in schema and value not in schema["enum"]:
                return self.get_default(key)
        
        return value

class SettingsManager(QObject):
    settings_changed = Signal(str, object)  # key, new_value
    file_changed = Signal(str) # scope ('user', 'workspace', 'folder')

    def __init__(self, workspace_path: Optional[str] = None):
        super().__init__()
        self.workspace_path = workspace_path
        self.schema = SettingsSchema()
        
        self.user_settings_path = os.path.join(get_user_data_dir(), "settings.json")
        self.workspace_settings_path = os.path.join(self.workspace_path, ".vscode", "settings.json") if self.workspace_path else None
        
        self.user_settings: Dict[str, Any] = {}
        self.workspace_settings: Dict[str, Any] = {}
        self.folder_settings: Dict[str, Dict[str, Any]] = {} # multi-root folder settings
        
        self.watcher = QFileSystemWatcher()
        self.watcher.fileChanged.connect(self._on_file_changed)
        
        self._debounce_timers: Dict[str, QTimer] = {}
        
        self.initialize()

    def initialize(self):
        self._ensure_file(self.user_settings_path)
        self.user_settings = self._load_json(self.user_settings_path)
        self.watcher.addPath(self.user_settings_path)
        
        if self.workspace_settings_path:
            self._ensure_file(self.workspace_settings_path)
            self.workspace_settings = self._load_json(self.workspace_settings_path)
            self.watcher.addPath(self.workspace_settings_path)

    def _ensure_file(self, path: str):
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write("{}")

    def _load_json(self, path: str) -> Dict[str, Any]:
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
                # Basic strip comments
                lines = [line for line in content.split('\\n') if not line.strip().startswith('//')]
                data = json.loads('\\n'.join(lines))
                
                # Validate against schema
                validated_data = {}
                for k, v in data.items():
                    validated_data[k] = self.schema.validate(k, v)
                return validated_data
        except Exception as e:
            logger.error(f"Failed to load settings from {path}: {e}")
            return {}

    def _save_json(self, path: str, data: Dict[str, Any]):
        try:
            # Prevent watcher loop
            self.watcher.removePath(path)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)
            self.watcher.addPath(path)
        except Exception as e:
            logger.error(f"Failed to save settings to {path}: {e}")

    def get(self, key: str, default: Any = None, folder_path: Optional[str] = None) -> Any:
        """Get a setting by traversing hierarchy: Folder -> Workspace -> User -> Default"""
        if folder_path and folder_path in self.folder_settings:
            if key in self.folder_settings[folder_path]:
                return self.folder_settings[folder_path][key]
                
        if key in self.workspace_settings:
            return self.workspace_settings[key]
            
        if key in self.user_settings:
            return self.user_settings[key]
            
        schema_default = self.schema.get_default(key)
        return schema_default if schema_default is not None else default

    def set(self, key: str, value: Any, scope: str = "user", folder_path: Optional[str] = None):
        validated_value = self.schema.validate(key, value)
        
        if scope == "user":
            self.user_settings[key] = validated_value
            self._save_json(self.user_settings_path, self.user_settings)
        elif scope == "workspace" and self.workspace_settings_path:
            self.workspace_settings[key] = validated_value
            self._save_json(self.workspace_settings_path, self.workspace_settings)
        elif scope == "folder" and folder_path:
            if folder_path not in self.folder_settings:
                self.folder_settings[folder_path] = {}
            self.folder_settings[folder_path][key] = validated_value
            # Save folder settings (assuming .vscode/settings.json in folder)
            folder_settings_path = os.path.join(folder_path, ".vscode", "settings.json")
            self._save_json(folder_settings_path, self.folder_settings[folder_path])
            
        self.settings_changed.emit(key, validated_value)

    def reset(self, key: str, scope: str = "user", folder_path: Optional[str] = None):
        """Reset a setting to its default by removing it from the specified scope."""
        if scope == "user":
            if key in self.user_settings:
                del self.user_settings[key]
                self._save_json(self.user_settings_path, self.user_settings)
        elif scope == "workspace":
            if key in self.workspace_settings:
                del self.workspace_settings[key]
                self._save_json(self.workspace_settings_path, self.workspace_settings)
        elif scope == "folder" and folder_path:
            if folder_path in self.folder_settings and key in self.folder_settings[folder_path]:
                del self.folder_settings[folder_path][key]
                folder_settings_path = os.path.join(folder_path, ".vscode", "settings.json")
                self._save_json(folder_settings_path, self.folder_settings[folder_path])
                
        self.settings_changed.emit(key, self.get(key))

    def _on_file_changed(self, path: str):
        # Debounce the file change event
        if path not in self._debounce_timers:
            timer = QTimer(self)
            timer.setSingleShot(True)
            timer.timeout.connect(lambda p=path: self._reload_file(p))
            self._debounce_timers[path] = timer
            
        self._debounce_timers[path].start(500) # 500ms debounce
        
    def _reload_file(self, path: str):
        if path == self.user_settings_path:
            self.user_settings = self._load_json(self.user_settings_path)
            self.file_changed.emit("user")
        elif path == self.workspace_settings_path:
            self.workspace_settings = self._load_json(self.workspace_settings_path)
            self.file_changed.emit("workspace")
        # Ensure path is re-added if editors use atomic saves (save to temp, rename over)
        if path not in self.watcher.files():
            self.watcher.addPath(path)

_global_settings_manager: Optional[SettingsManager] = None

def get_settings_manager(workspace_path: Optional[str] = None) -> SettingsManager:
    global _global_settings_manager
    if _global_settings_manager is None or _global_settings_manager.workspace_path != workspace_path:
        _global_settings_manager = SettingsManager(workspace_path)
    return _global_settings_manager
