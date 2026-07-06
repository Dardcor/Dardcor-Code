import os
import json
from pydardcor.core.config import get_user_data_dir

def get_provider_config_dir(provider_name: str) -> str:
    """Returns the %LOCALAPPDATA% directory for a specific provider."""
    return os.path.join(get_user_data_dir(), "database", "models", provider_name)

def get_provider_config_path(provider_name: str) -> str:
    """Returns the full path to the config.json for a specific provider."""
    return os.path.join(get_provider_config_dir(provider_name), "config.json")

def load_provider_config(provider_name: str) -> dict:
    """Loads the config.json for a given provider. Returns empty dict if not found."""
    path = get_provider_config_path(provider_name)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_provider_config(provider_name: str, config_data: dict):
    """Saves the config.json for a given provider."""
    path = get_provider_config_path(provider_name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=4)

def load_provider_api_key(provider_name: str, env_fallback: str = "") -> str:
    """
    Loads API key ONLY from config.json. Env fallback is ignored as requested.
    """
    config = load_provider_config(provider_name)
    return config.get("api_key", "")

def save_provider_api_key(provider_name: str, api_key: str):
    """Saves ONLY the api_key to the provider's config.json, preserving other fields."""
    config = load_provider_config(provider_name)
    config["api_key"] = api_key
    save_provider_config(provider_name, config)
