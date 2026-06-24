from typing import Optional, Dict, Any
from .base import BaseProvider


class ProviderFactory:
    """Factory to instantiate the appropriate provider."""

    _ANTIGRAVITY_MODELS = {
        "Gemini 3.5 Flash (High)",
        "Gemini 3.5 Flash (Medium)",
        "Gemini 3.5 Flash (Low)",
        "Gemini 3.1 Pro (High)",
        "Gemini 3.1 Pro (Low)",
        "Gemini 3 Flash",
        "Gemini 2.5 Pro",
        "Claude Opus 4.6 (Thinking)",
        "Claude Sonnet 4.6 (Thinking)",
        "Claude Sonnet 4.6",
    }

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

                project_root = os.path.normpath(
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
                )
                for std_name in ("Gemini", "OpenRouter", "DeepSeek", "NVIDIA"):
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
