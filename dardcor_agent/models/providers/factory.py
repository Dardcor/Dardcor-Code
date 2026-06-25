from typing import Optional, Dict, Any
from .base import BaseProvider


def _build_antigravity_model_set() -> set:
    """Derive Antigravity model IDs from the registry so this never drifts."""
    try:
        from .registry import PROVIDER_REGISTRY
        entry = PROVIDER_REGISTRY.get("Antigravity", {})
        return {m["id"] for m in entry.get("models", []) if m.get("id")}
    except Exception:
        return set()


class ProviderFactory:
    """Factory to instantiate the appropriate provider."""

    _ANTIGRAVITY_MODELS = _build_antigravity_model_set()

    @staticmethod
    def create(config: Any, model_override: Optional[str]) -> BaseProvider:
        try:
            import os, json
            from pydardcor.core.config import get_user_data_dir

            prov_file = os.path.join(get_user_data_dir(), "database", "models", "provider.json")
            if not os.path.exists(prov_file):
                raise FileNotFoundError

            with open(prov_file, "r", encoding="utf-8") as f:
                providers = json.load(f)

            is_antigravity_active = providers.get("Antigravity", False)

            if model_override:
                if model_override in ProviderFactory._ANTIGRAVITY_MODELS:
                    if is_antigravity_active:
                        from .antigravity.provider import AntigravityProvider
                        return AntigravityProvider()

                from .registry import PROVIDER_REGISTRY
                project_root = os.path.normpath(
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
                )
                for std_name, pdef in PROVIDER_REGISTRY.items():
                    if pdef.get("is_special"):
                        continue
                    if not providers.get(std_name, False):
                        continue
                    config_path = os.path.join(
                        project_root, "database", "models", std_name, "config.json"
                    )
                    if not os.path.exists(config_path):
                        continue
                    try:
                        with open(config_path, "r", encoding="utf-8") as cf:
                            data = json.load(cf)
                    except Exception:
                        continue
                    model_ids = {m.get("id") for m in data.get("models", []) if m.get("id")}
                    if data.get("selected_model"):
                        model_ids.add(data["selected_model"])
                    if model_override in model_ids:
                        from .openai.provider import StandardOpenAIProvider
                        return StandardOpenAIProvider()

            if is_antigravity_active:
                from .antigravity.provider import AntigravityProvider
                return AntigravityProvider()

        except Exception:
            pass

        from .openai.provider import StandardOpenAIProvider
        return StandardOpenAIProvider()
