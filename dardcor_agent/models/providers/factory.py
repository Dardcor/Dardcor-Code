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
        if model_override in {"dardcor-flash-free", "dardcor-max"}:
            from .dardcor.provider import DardcorProvider
            return DardcorProvider()

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

                from .registry import find_provider_for_model
                owner, pdef = find_provider_for_model(model_override)
                if owner and not pdef.get("is_special"):
                    owner_folder = owner.lower().replace(" ", "_").replace("-", "_")
                    owner_class = owner.replace(" ", "").replace("-", "") + "Provider"
                    try:
                        import importlib
                        module = importlib.import_module(f"dardcor_agent.models.providers.{owner_folder}.provider")
                        ProviderClass = getattr(module, owner_class)
                        return ProviderClass()
                    except (ImportError, AttributeError) as e:
                        from .openai.provider import StandardOpenAIProvider
                        return StandardOpenAIProvider()

            if not model_override and is_antigravity_active:
                from .antigravity.provider import AntigravityProvider
                return AntigravityProvider()

        except Exception:
            pass

        from .openai.provider import StandardOpenAIProvider
        return StandardOpenAIProvider()
