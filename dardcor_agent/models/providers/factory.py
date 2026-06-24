from typing import Optional, Dict, Any
from .base import BaseProvider

class ProviderFactory:
    """Factory to instantiate the appropriate provider."""
    
    @staticmethod
    def create(config: Any, model_override: Optional[str]) -> BaseProvider:
        # Determine if we should use Antigravity mode based on settings
        is_antigravity = False
        try:
            import os, json
            from pydardcor.core.config import get_user_data_dir
            prov_file = os.path.join(get_user_data_dir(), "database", "models", "provider.json")
            if os.path.exists(prov_file):
                with open(prov_file, "r", encoding="utf-8") as f:
                    providers = json.load(f)
                if providers.get("Antigravity", False) and model_override:
                    is_antigravity = True
        except Exception:
            pass

        if is_antigravity:
            from .antigravity.provider import AntigravityProvider
            return AntigravityProvider()
        else:
            from .openai.provider import StandardOpenAIProvider
            return StandardOpenAIProvider()
