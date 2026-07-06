"""Central provider registry for Dardcor Code.

Dynamically loaded from each provider's registry.py file.
"""

import os
import importlib

PROVIDER_REGISTRY = {}

providers_dir = os.path.dirname(__file__)

for folder_name in os.listdir(providers_dir):
    folder_path = os.path.join(providers_dir, folder_name)
    if not os.path.isdir(folder_path) or folder_name.startswith("__"):
        continue
    
    try:
        module = importlib.import_module(f"dardcor_agent.models.providers.{folder_name}.registry")
        if hasattr(module, "PROVIDER_KEY") and hasattr(module, "PROVIDER_REGISTRY_ENTRY"):
            provider_key = getattr(module, "PROVIDER_KEY")
            entry = getattr(module, "PROVIDER_REGISTRY_ENTRY")
            PROVIDER_REGISTRY[provider_key] = entry
    except ImportError:
        pass

def find_provider_for_model(model_id: str):
    """Return (provider_name, provider_def) that owns model_id, else (None, None).

    Resolution is registry-driven so routing never depends on per-provider
    config.json having a cached 'models' list.
    """
    if not model_id:
        return None, None
    if model_id.startswith("claude-code/"):
        return "ClaudeCodeSubscription", PROVIDER_REGISTRY.get("ClaudeCodeSubscription")
    if model_id.startswith("codex/"):
        return "CodexSubscription", PROVIDER_REGISTRY.get("CodexSubscription")
    if model_id.startswith("opencode/"):
        return "OpenCodeZen", PROVIDER_REGISTRY.get("OpenCodeZen")
    if model_id.startswith("mimo-"):
        return "MiMo", PROVIDER_REGISTRY.get("MiMo")
    for provider_name, pdef in PROVIDER_REGISTRY.items():
        if not pdef:
            continue
        for model in pdef.get("models", []):
            if isinstance(model, dict) and model.get("id") == model_id:
                return provider_name, pdef
    return None, None
