"""Configuration management for Dardcor Code."""

import os
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, Any, Optional

_TRUE_STRINGS = frozenset({"true", "1", "yes", "on"})
_FALSE_STRINGS = frozenset({"false", "0", "no", "off", ""})


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in _TRUE_STRINGS:
            return True
        if normalized in _FALSE_STRINGS:
            return False
    return default


def _coerce_int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_config_value(value: Any, default: Any) -> Any:
    if isinstance(default, bool):
        return _coerce_bool(value, default)
    if isinstance(default, int):
        return _coerce_int(value, default)
    if isinstance(default, str):
        if value is None:
            return default
        return str(value)
    if isinstance(default, list):
        return value if isinstance(value, list) else default
    return value if isinstance(value, type(default)) else default

def _write_json_if_missing(path: str, payload: dict[str, Any]) -> None:
    if os.path.exists(path):
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except OSError:
        pass


DEFAULT_MCP_SERVERS: dict[str, dict[str, Any]] = {
    "context7": {"enabled": True, "url": "https://mcp.context7.com/mcp"},
    "playwright": {"enabled": True, "command": "npx", "args": ["-y", "@playwright/mcp@latest"]},
    "chrome-devtools-mcp": {"enabled": True, "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"]},
    "filesystem": {"enabled": True, "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:\\"]},
    "sequential-thinking": {"enabled": True, "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]},
    "memory": {"enabled": True, "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]},
    "firecrawl": {"enabled": False, "url": "https://mcp.firecrawl.dev/v2/mcp"},
    "exa": {"enabled": False, "url": "https://mcp.exa.ai/mcp"},
    "docker": {"enabled": False, "command": "npx", "args": ["-y", "@docker/mcp-server"]},
    "dart-mcp-server": {"enabled": False, "command": "dart", "args": ["mcp-server"]},
    "genkit-mcp-server": {
        "enabled": False,
        "command": "npx",
        "args": ["-y", "genkit-cli@^1.28.0", "mcp", "--explicitProjectRoot", "--no-update-notification", "--non-interactive"],
    },
}

DEFAULT_SKILLS: dict[str, dict[str, Any]] = {
    "frontend-design": {"source": "https://github.com/anthropics/skills", "skill": "frontend-design"},
    "ui-ux-pro-max": {"source": "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill", "skill": "ui-ux-pro-max"},
    "redux-toolkit": {"source": "https://github.com/mindrally/skills", "skill": "redux-toolkit"},
    "react-state-management": {"source": "https://github.com/wshobson/agents", "skill": "react-state-management"},
    "supabase": {"source": "https://github.com/supabase/agent-skills", "skill": "supabase"},
    "supabase-postgres-best-practices": {"source": "https://github.com/supabase/agent-skills", "skill": "supabase-postgres-best-practices"},
    "mcp-builder": {"source": "https://github.com/anthropics/skills", "skill": "mcp-builder"},
    "skill-creator": {"source": "https://github.com/anthropics/skills", "skill": "skill-creator"},
    "webapp-testing": {"source": "https://github.com/anthropics/skills", "skill": "webapp-testing"},
    "playwright-best-practices": {"source": "https://github.com/currents-dev/playwright-best-practices-skill", "skill": "playwright-best-practices"},
    "deploy-to-vercel": {"source": "https://github.com/vercel-labs/agent-skills", "skill": "deploy-to-vercel"},
}

DEFAULT_LSP_SERVERS: dict[str, dict[str, Any]] = {
    "python": {"enabled": True, "commands": [["pyright-langserver", "--stdio"], ["pylsp"]]},
    "typescript": {"enabled": True, "commands": [["typescript-language-server", "--stdio"]]},
    "javascript": {"enabled": True, "commands": [["typescript-language-server", "--stdio"]]},
    "typescriptreact": {"enabled": True, "commands": [["typescript-language-server", "--stdio"]]},
    "javascriptreact": {"enabled": True, "commands": [["typescript-language-server", "--stdio"]]},
    "html": {"enabled": True, "commands": [["vscode-html-language-server", "--stdio"]]},
    "css": {"enabled": True, "commands": [["vscode-css-language-server", "--stdio"]]},
    "json": {"enabled": True, "commands": [["vscode-json-language-server", "--stdio"]]},
    "sql": {"enabled": True, "commands": [["sql-language-server", "up", "--method", "stdio"]]},
    "dart": {"enabled": True, "commands": [["dart", "language-server"]]},
}


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

def get_global_home_dir() -> str:
    """Return the global Dardcor home directory: ~/.dardcor-code.

    This folder is shared across every workspace (like ~/.vscode) and holds
    extensions, snippets, themes, caches and logs. It is created automatically
    on first run/build via ensure_user_dirs().
    """
    return os.path.join(os.path.expanduser("~"), ".dardcor-code")


def ensure_user_dirs() -> str:
    """Create the full ~/.dardcor-code directory structure if missing.

    Called automatically at app startup (and from build.py) so the folder
    always exists without any manual step. Returns the home path.
    """
    home = get_global_home_dir()
    for sub in (
        "extensions",
        "snippets",
        "themes",
        "logs",
        "mcp",
        "skills",
        "lsp",
        os.path.join("cache", "icons"),
    ):
        os.makedirs(os.path.join(home, sub), exist_ok=True)

    state_file = os.path.join(home, "extensions", "extensions.json")
    if not os.path.exists(state_file):
        try:
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump({"disabled": [], "meta": {}}, f, indent=2)
        except OSError:
            pass

    keybindings_file = os.path.join(home, "keybindings.json")
    if not os.path.exists(keybindings_file):
        try:
            with open(keybindings_file, "w", encoding="utf-8") as f:
                json.dump([], f, indent=2)
        except OSError:
            pass

    _write_json_if_missing(os.path.join(home, "mcp", "servers.json"), {"servers": DEFAULT_MCP_SERVERS})
    _write_json_if_missing(os.path.join(home, "skills", "skills.json"), {"skills": DEFAULT_SKILLS})
    _write_json_if_missing(os.path.join(home, "lsp", "servers.json"), {"servers": DEFAULT_LSP_SERVERS})
    return home


def get_extensions_dir() -> str:
    """Global extensions directory: ~/.dardcor-code/extensions."""
    return os.path.join(get_global_home_dir(), "extensions")


def get_snippets_dir() -> str:
    """Global user snippets directory: ~/.dardcor-code/snippets."""
    return os.path.join(get_global_home_dir(), "snippets")


CONFIG_DIR = get_user_data_dir()
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")

@dataclass
class AISettings:
    provider: str = "openai"
    model: str = "gpt-4o"
    base_url: str = ""
    api_key: str = ""
    max_tokens: int = 128000
    temperature: float = 0.7


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
    line_numbers_enabled: bool = True
    sticky_scroll_enabled: bool = True
    insert_spaces: bool = True
    terminal_shell: str = ""
    recent_files: list = field(default_factory=list)
    recent_folders: list = field(default_factory=list)
    show_open_editors: bool = False
    show_folders: bool = True
    show_outline: bool = True
    show_timeline: bool = True
    show_tabs: str = "multiple"
    wrap_tabs: bool = False
    file_icon_theme: str = ""
    color_theme: str = ""
    extensions_auto_update: bool = True
    default_model: str = "dardcor-flash-free"
    window_x: int = -1
    window_y: int = -1
    window_width: int = 0
    window_height: int = 0
    window_maximized: bool = False
    ai: AISettings = field(default_factory=AISettings)

    def save(self):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        data = asdict(self)
        # Never persist API keys in config.json — use secrets.json or env vars.
        if isinstance(data.get("ai"), dict):
            data["ai"] = {**data["ai"], "api_key": ""}
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
            defaults = cls()
            cfg_data = {}
            for k, v in data.items():
                if k not in valid_keys:
                    continue
                if k == "ai":
                    ai_defaults = AISettings()
                    if isinstance(v, dict):
                        ai_fields = set(AISettings.__dataclass_fields__)
                        ai_data = {
                            ak: _coerce_config_value(av, getattr(ai_defaults, ak))
                            for ak, av in v.items()
                            if ak in ai_fields
                        }
                        cfg_data[k] = AISettings(**ai_data)
                    else:
                        cfg_data[k] = ai_defaults
                    continue
                cfg_data[k] = _coerce_config_value(v, getattr(defaults, k))
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
