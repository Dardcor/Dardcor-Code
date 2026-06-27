"""Launch Configuration Manager - VS Code style launch.json support."""

import os
import json
from typing import Dict, List, Optional, Any
from ..core.config import get_user_data_dir


DEFAULT_LAUNCH_CONFIG = {
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: Current File",
            "type": "python",
            "request": "launch",
            "program": "${file}",
            "console": "integratedTerminal",
            "justMyCode": True
        },
        {
            "name": "Python: Module",
            "type": "python",
            "request": "launch",
            "module": "${input:moduleName}",
            "console": "integratedTerminal"
        },
        {
            "name": "Node.js: Current File",
            "type": "node",
            "request": "launch",
            "program": "${file}",
            "console": "integratedTerminal"
        }
    ]
}


class LaunchConfig:
    """Represents a single debug launch configuration."""

    def __init__(self, data: dict):
        self.name = data.get("name", "Unnamed")
        self.type = data.get("type", "python")
        self.request = data.get("request", "launch")
        self.program = data.get("program", "")
        self.module = data.get("module", "")
        self.args = data.get("args", [])
        self.env = data.get("env", {})
        self.console = data.get("console", "integratedTerminal")
        self.cwd = data.get("cwd", "${workspaceFolder}")
        self.just_my_code = data.get("justMyCode", True)
        self.stop_on_entry = data.get("stopOnEntry", False)
        self.port = data.get("port", 0)
        self._raw = data

    def resolve(self, workspace_path: str, current_file: str = "") -> dict:
        """Resolve variables like ${file}, ${workspaceFolder}, etc."""
        result = dict(self._raw)
        replacements = {
            "${workspaceFolder}": workspace_path,
            "${file}": current_file,
            "${fileBasename}": os.path.basename(current_file) if current_file else "",
            "${fileBasenameNoExtension}": os.path.splitext(os.path.basename(current_file))[0] if current_file else "",
            "${fileDirname}": os.path.dirname(current_file) if current_file else "",
            "${fileExtname}": os.path.splitext(current_file)[1] if current_file else "",
            "${relativeFile}": os.path.relpath(current_file, workspace_path) if current_file and workspace_path else "",
        }

        def _replace(val):
            if isinstance(val, str):
                for k, v in replacements.items():
                    val = val.replace(k, v)
                return val
            elif isinstance(val, list):
                return [_replace(item) for item in val]
            elif isinstance(val, dict):
                return {k2: _replace(v2) for k2, v2 in val.items()}
            return val

        return _replace(result)


class LaunchConfigManager:
    """Manages launch.json configurations."""

    def __init__(self, workspace_path: str = ""):
        self._workspace = workspace_path
        self._configs: List[LaunchConfig] = []
        self._load()

    def _get_launch_path(self) -> str:
        if self._workspace:
            return os.path.join(self._workspace, ".vscode", "launch.json")
        return ""

    def _load(self):
        self._configs = []
        launch_path = self._get_launch_path()
        if launch_path and os.path.exists(launch_path):
            try:
                with open(launch_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                    data = json.loads("\n".join(lines))
                for cfg_data in data.get("configurations", []):
                    self._configs.append(LaunchConfig(cfg_data))
            except Exception:
                pass

        if not self._configs:
            for cfg_data in DEFAULT_LAUNCH_CONFIG["configurations"]:
                self._configs.append(LaunchConfig(cfg_data))

    def get_configurations(self) -> List[LaunchConfig]:
        return self._configs

    def get_config_names(self) -> List[str]:
        return [c.name for c in self._configs]

    def get_config_by_name(self, name: str) -> Optional[LaunchConfig]:
        for c in self._configs:
            if c.name == name:
                return c
        return None

    def set_workspace(self, workspace_path: str):
        self._workspace = workspace_path
        self._load()

    def create_default_launch_json(self):
        """Create a default launch.json in the workspace."""
        if not self._workspace:
            return
        vscode_dir = os.path.join(self._workspace, ".vscode")
        os.makedirs(vscode_dir, exist_ok=True)
        launch_path = os.path.join(vscode_dir, "launch.json")
        if not os.path.exists(launch_path):
            with open(launch_path, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_LAUNCH_CONFIG, f, indent=4)
            self._load()

    def add_configuration(self, config_data: dict):
        """Add a new configuration."""
        self._configs.append(LaunchConfig(config_data))
        self._save()

    def _save(self):
        launch_path = self._get_launch_path()
        if not launch_path:
            return
        os.makedirs(os.path.dirname(launch_path), exist_ok=True)
        data = {
            "version": "0.2.0",
            "configurations": [c._raw for c in self._configs]
        }
        with open(launch_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
