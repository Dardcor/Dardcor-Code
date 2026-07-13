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
            "justMyCode": True,
        },
        {
            "name": "Python: Module",
            "type": "python",
            "request": "launch",
            "module": "${input:moduleName}",
            "console": "integratedTerminal",
        },
        {
            "name": "Python: Remote Attach",
            "type": "python",
            "request": "attach",
            "connect": {"host": "localhost", "port": 5678},
            "justMyCode": True,
        },
        {
            "name": "Node.js: Current File",
            "type": "node",
            "request": "launch",
            "program": "${file}",
            "console": "integratedTerminal",
        },
        {
            "name": "Node.js: Attach to Process",
            "type": "node",
            "request": "attach",
            "port": 9229,
        },
    ],
    "compounds": [
        {
            "name": "Python + Node.js",
            "configurations": ["Python: Current File", "Node.js: Current File"],
            "preLaunchTask": "",
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
        self.host = data.get("connect", {}).get("host", "localhost")
        self.attach_port = data.get("connect", {}).get("port", 0)
        self.pre_launch_task = data.get("preLaunchTask", "")
        self.post_debug_task = data.get("postDebugTask", "")
        self.breakpoints = data.get("breakpoints", [])
        self.exception_breakpoints = data.get("exceptionBreakpoints", [])
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


class CompoundConfig:
    """Represents a compound debug configuration."""

    def __init__(self, data: dict):
        self.name = data.get("name", "Compound")
        self.configurations = data.get("configurations", [])
        self.pre_launch_task = data.get("preLaunchTask", "")
        self.stop_all = data.get("stopAll", True)

    def resolve(self) -> dict:
        return {
            "name": self.name,
            "compounds": self.configurations,
            "preLaunchTask": self.pre_launch_task,
            "stopAll": self.stop_all,
        }


class LaunchConfigManager:
    """Manages launch.json configurations."""

    def __init__(self, workspace_path: str = ""):
        self._workspace = workspace_path
        self._configs: List[LaunchConfig] = []
        self._compounds: List[CompoundConfig] = []
        self._load()

    def _get_launch_path(self) -> str:
        if self._workspace:
            return os.path.join(self._workspace, ".vscode", "launch.json")
        return ""

    def _load(self):
        self._configs = []
        self._compounds = []
        launch_path = self._get_launch_path()
        if launch_path and os.path.exists(launch_path):
            try:
                with open(launch_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                    data = json.loads("\n".join(lines))
                for cfg_data in data.get("configurations", []):
                    self._configs.append(LaunchConfig(cfg_data))
                for cmp_data in data.get("compounds", []):
                    self._compounds.append(CompoundConfig(cmp_data))
            except Exception:
                pass

        if not self._configs:
            for cfg_data in DEFAULT_LAUNCH_CONFIG["configurations"]:
                self._configs.append(LaunchConfig(cfg_data))

        if not self._compounds and "compounds" in DEFAULT_LAUNCH_CONFIG:
            for cmp_data in DEFAULT_LAUNCH_CONFIG["compounds"]:
                self._compounds.append(CompoundConfig(cmp_data))

    def get_configurations(self) -> List[LaunchConfig]:
        return self._configs

    def get_config_names(self) -> List[str]:
        names = [c.name for c in self._configs]
        names += [f"[Compound] {c.name}" for c in self._compounds]
        return names

    def get_config_by_name(self, name: str) -> Optional[LaunchConfig]:
        for c in self._configs:
            if c.name == name:
                return c
        return None

    def get_compounds(self) -> List[CompoundConfig]:
        return self._compounds

    def get_compound_by_name(self, name: str) -> Optional[CompoundConfig]:
        for c in self._compounds:
            if c.name == name:
                return c
        return None

    def set_workspace(self, workspace_path: str):
        self._workspace = workspace_path
        self._load()

    def create_default_launch_json(self):
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
        if config_data.get("configurations") or config_data.get("name", "").startswith("[Compound]"):
            name = config_data.get("name", "Compound").replace("[Compound] ", "")
            self._compounds.append(CompoundConfig({"name": name, "configurations": config_data.get("configurations", [])}))
        else:
            self._configs.append(LaunchConfig(config_data))
        self._save()

    def remove_configuration(self, name: str):
        self._configs = [c for c in self._configs if c.name != name]
        self._compounds = [c for c in self._compounds if c.name != name]
        self._save()

    def _save(self):
        launch_path = self._get_launch_path()
        if not launch_path:
            return
        os.makedirs(os.path.dirname(launch_path), exist_ok=True)
        data = {
            "version": "0.2.0",
            "configurations": [c._raw for c in self._configs],
            "compounds": [{
                "name": c.name,
                "configurations": c.configurations,
                "preLaunchTask": c.pre_launch_task,
                "stopAll": c.stop_all,
            } for c in self._compounds],
        }
        with open(launch_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)

    def get_breakpoints(self) -> List[Dict]:
        """Collect breakpoints from all configurations for initial setup."""
        bps = []
        for cfg in self._configs:
            for bp in cfg.breakpoints:
                bp_entry = {"path": bp.get("path", cfg.program), "points": bp.get("points", [bp])}
                if bp_entry["points"]:
                    bps.append(bp_entry)
        return bps

    def get_task_names(self) -> List[str]:
        """Return list of preLaunchTask references from all configs."""
        tasks = set()
        for cfg in self._configs:
            if cfg.pre_launch_task:
                tasks.add(cfg.pre_launch_task)
        for cmp in self._compounds:
            if cmp.pre_launch_task:
                tasks.add(cmp.pre_launch_task)
        return sorted(tasks)
