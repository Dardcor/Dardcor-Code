import copy
import json
import os
from typing import Any, Dict, List, Tuple

from dardcor_agent.models.providers.base import BaseProvider, ProviderResponse
from dardcor_agent.models.providers.openai.provider import StandardOpenAIProvider


class DardcorV1Provider(BaseProvider):
    """Virtual model: one Dardcor name, configured provider models behind it."""

    _PREFERRED_PROVIDERS = (
        "OpenCodeZen",
        "Gemini",
        "Groq",
        "OpenRouter",
        "NVIDIA",
        "SambaNova",
        "ChutesAI",
        "Cerebras",
        "GitHubModels",
        "DeepSeek",
        "Ollama",
    )

    def _is_free_model(self, model: Dict[str, Any]) -> bool:
        name = str(model.get("name", "")).lower()
        model_id = str(model.get("id", "")).lower()
        return "(free)" in name or model_id.endswith(":free") or model.get("free") is True

    @staticmethod
    def _normalize_secrets(raw: Dict[str, Any]) -> Dict[str, List[str]]:
        secrets = {}
        for provider, value in raw.items():
            if isinstance(value, str):
                values = [value]
            elif isinstance(value, list):
                values = [v for v in value if isinstance(v, str)]
            else:
                values = []
            cleaned = [v.strip() for v in values if v.strip()]
            if cleaned:
                secrets[str(provider).lower()] = cleaned
        return secrets

    @staticmethod
    def _parse_dotenv(text: str) -> Dict[str, List[str]]:
        env_to_provider = {
            "OPENROUTER_API_KEY": "openrouter",
            "GROQ_API_KEY": "groq",
            "NVIDIA_API_KEY": "nvidia",
            "GOOGLE_API_KEY": "gemini",
            "GEMINI_API_KEY": "gemini",
            "DEEPSEEK_API_KEY": "deepseek",
        }
        raw: Dict[str, List[str]] = {}
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            base_key = key
            if "_" in key and key.rsplit("_", 1)[-1].isdigit():
                base_key = key.rsplit("_", 1)[0]
            provider = env_to_provider.get(base_key)
            if provider and value:
                raw.setdefault(provider, []).append(value)
        return raw

    def _load_secrets(self) -> Dict[str, List[str]]:
        raw: Dict[str, Any] = {}
        for dotenv_path in self._dotenv_paths():
            try:
                if os.path.exists(dotenv_path):
                    with open(dotenv_path, "r", encoding="utf-8") as f:
                        parsed = self._parse_dotenv(f.read())
                    for provider, values in parsed.items():
                        raw.setdefault(provider, [])
                        if isinstance(raw[provider], list):
                            raw[provider].extend(values)
            except Exception:
                pass

        try:
            from pydardcor.core.config import get_user_data_dir

            secrets_path = os.path.join(get_user_data_dir(), "secrets.json")
            if os.path.exists(secrets_path):
                with open(secrets_path, "r", encoding="utf-8") as f:
                    raw.update(json.load(f))
        except Exception:
            pass

        env_map = {
            "openrouter": "OPENROUTER_API_KEY",
            "groq": "GROQ_API_KEY",
            "nvidia": "NVIDIA_API_KEY",
            "gemini": "GOOGLE_API_KEY",
            "deepseek": "DEEPSEEK_API_KEY",
            "mimo": "MIMO_API_KEY",
            "opencodezen": "OPENCODE_ZEN_API_KEY",
            "ninerouter": "NINEROUTER_API_KEY",
        }
        for provider, env_name in env_map.items():
            value = os.environ.get(env_name, "")
            if value and provider not in raw:
                raw[provider] = value
        return self._normalize_secrets(raw)

    def _dotenv_paths(self) -> List[str]:
        """Load .env only from user data — never from workspace (security)."""
        try:
            from pydardcor.core.config import get_user_data_dir

            return [os.path.join(get_user_data_dir(), ".env")]
        except Exception:
            return []

    def _is_provider_active(self, provider_name: str) -> bool:
        try:
            from pydardcor.core.config import get_user_data_dir

            provider_file = os.path.join(get_user_data_dir(), "database", "models", "provider.json")
            with open(provider_file, "r", encoding="utf-8") as f:
                states = json.load(f)
            return bool(states.get(provider_name))
        except Exception:
            return False

    def _registry_provider_name(self, provider_name: str) -> str:
        aliases = {
            "openrouter": "OpenRouter",
            "githubmodels": "GitHubModels",
            "togetherai": "TogetherAI",
            "fireworksai": "FireworksAI",
            "moonshotai": "MoonshotAI",
            "zhipuai": "ZhipuAI",
        }
        return aliases.get(provider_name.lower(), provider_name[:1].upper() + provider_name[1:])

    def _candidate_models(self) -> List[Tuple[str, str, str]]:
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

            candidates = []
            for provider_name in self._PREFERRED_PROVIDERS:
                provider = PROVIDER_REGISTRY.get(provider_name, {})
                for model in provider.get("models", []):
                    model_id = model.get("id")
                    if model_id and self._is_free_model(model):
                        candidates.append((
                            provider_name.lower(),
                            provider.get("base_url", ""),
                            model_id,
                        ))
            return candidates
        except Exception:
            return []

    def generate_turn(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        config: Any,
        model_override: str,
        abort_check_fn: callable,
        conversation_callback: callable,
    ) -> ProviderResponse:
        backend = StandardOpenAIProvider()
        secrets = self._load_secrets()
        tried = []

        if self._is_provider_active("Antigravity"):
            try:
                from dardcor_agent.models.providers.antigravity.provider import AntigravityProvider

                response = AntigravityProvider().generate_turn(
                    messages=messages,
                    tools=tools,
                    config=config,
                    model_override="Gemini 3.5 Flash (Low)",
                    abort_check_fn=abort_check_fn,
                    conversation_callback=conversation_callback,
                )
                if not response.error:
                    return response
                tried.append("antigravity")
            except Exception as exc:
                tried.append(f"antigravity:{exc}")

        for provider_name, base_url, model_id in self._candidate_models():
            if abort_check_fn():
                return ProviderResponse(error="Agent dihentikan oleh pengguna.")
            keys = secrets.get(provider_name, [])
            if not keys and not self._is_provider_active(self._registry_provider_name(provider_name)):
                continue

            tried.append(f"{provider_name}:{model_id}")
            routed_config = copy.copy(config)
            routed_config.provider = provider_name
            routed_config.base_url = base_url
            routed_config.api_key = keys[0] if keys else getattr(config, "api_key", "")
            response = backend.generate_turn(
                messages=messages,
                tools=tools,
                config=routed_config,
                model_override=model_id,
                abort_check_fn=abort_check_fn,
                conversation_callback=conversation_callback,
            )
            if not response.error:
                return response

        tried_text = ", ".join(tried[:8]) or "none"
        return ProviderResponse(
            error=(
                "Dardcor v1 tidak menemukan free model aktif yang bisa dipakai.\n\n"
                "Buat secrets.json di user data Dardcor atau set env var "
                "OPENROUTER_API_KEY/GROQ_API_KEY/NVIDIA_API_KEY/GOOGLE_API_KEY. Tried: "
                f"{tried_text}"
            )
        )
