"""Configuration management for Dardcor Code."""

import os
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path


CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".dardcor-code")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")


@dataclass
class AIConfig:
    provider: str = "openai"
    model: str = "gpt-4o"
    api_key: str = ""
    base_url: str = ""
    max_tokens: int = 128000
    temperature: float = 0.7
    system_prompt: str = (
        "You are Dardcor Code, an expert AI coding assistant. "
        "Help the user with their code, answer questions, debug issues, "
        "and suggest improvements. Be concise and accurate."
    )


@dataclass
class AppConfig:
    ai: AIConfig = field(default_factory=AIConfig)
    workspace_path: str = ""
    auto_save: bool = True
    font_family: str = "Cascadia Code"
    font_size: int = 13
    tab_size: int = 4
    word_wrap: bool = False
    minimap_enabled: bool = True
    terminal_shell: str = ""
    recent_files: list = field(default_factory=list)
    recent_folders: list = field(default_factory=list)

    def save(self):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        data = asdict(self)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    @classmethod
    def load(cls) -> "AppConfig":
        if not os.path.exists(CONFIG_FILE):
            cfg = cls()
            # Try to get API key from environment
            for env_key in ("DARDCOR_CODE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
                val = os.environ.get(env_key, "")
                if val:
                    cfg.ai.api_key = val
                    break
            cfg.save()
            return cfg
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            ai_data = data.pop("ai", {})
            ai_config = AIConfig(**{k: v for k, v in ai_data.items() if k in AIConfig.__dataclass_fields__})
            cfg = cls(ai=ai_config, **{k: v for k, v in data.items() if k in cls.__dataclass_fields__ and k != "ai"})
            # Override with env if empty
            if not cfg.ai.api_key:
                for env_key in ("DARDCOR_CODE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
                    val = os.environ.get(env_key, "")
                    if val:
                        cfg.ai.api_key = val
                        break
            return cfg
        except Exception:
            return cls()


_config_instance = None


def get_config() -> AppConfig:
    global _config_instance
    if _config_instance is None:
        _config_instance = AppConfig.load()
    return _config_instance


def reset_config():
    global _config_instance
    _config_instance = None
