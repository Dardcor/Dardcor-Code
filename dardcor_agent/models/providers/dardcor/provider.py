import copy
import json
import os
from typing import Any, Dict, List, Tuple

from dardcor_agent.models.providers.base import BaseProvider, ProviderResponse
from dardcor_agent.models.providers.dardcor.fable_prompt import FABLE_PROMPT
from dardcor_agent.models.providers.openai.provider import StandardOpenAIProvider


class DardcorV1Provider(BaseProvider):
    """Virtual model: one Dardcor name, configured provider models behind it."""

    MAX_MODEL_ID = "dardcor-v1-max"
    MAX_USAGE_WEIGHT = 2.5
    _MAX_PROMPT_CACHE = ""
    _DARDCORE_MAX_OVERLAY = """
<dardcor_v1_max_overdrive>
Identity:
- You are Dardcor MAX: Dardcor's highest-power coding orchestrator mode.
- Your job is not to sound powerful; your job is to finish difficult software work with verified results.
- Fable/Mythos doctrine is the reasoning substrate. Dardcor adds tool mastery, provider routing, IDE awareness, and browser control.

Tool supremacy:
- Prefer tools over guessing. Inspect files before editing. Run commands for real evidence. Verify output before claiming success.
- Use browser_open, browser_observe, browser_eval, browser_click, browser_type, and browser_screenshot for UI work.
- For web-app tasks: start server, open AI Chrome, observe DOM/page state, interact, patch, refresh, re-observe.
- Use web_search/web_fetch for current docs or unknown APIs. Use embeddings/skills/media tools only when they directly advance the task.
- Keep tool results small: summarize screenshots by path, large files by focused ranges, and command output by failure/success signal.

Rank target profile:
- Optimize strongest for coding, finance-style quantitative reasoning, and legal-style exact reading: target #1 quality.
- For coding specifically, behave as top-1: understand repo first, make minimal correct edits, preserve user work, run checks, and fix failures.
- Push games, 3D, reasoning, vision, animations, websites, SVG, math, and tool calling toward top-tier results through verification and iteration.
- Improve weak areas proactively: audio, chat continuity, and healthcare safety require extra caution, source checks, and no overconfident claims.
- Rankings are aspiration targets for behavior and evaluation. Never claim an external benchmark rank unless verified by real benchmark data.

Skill mode:
- Choose the smallest useful skill/process. Debug bugs systematically. Review security-sensitive changes. Keep accessibility and data-loss safety intact.
- Treat user-selected active providers as available capacity, but do not waste calls. More calls are only justified when they reduce uncertainty.
- If multiple active providers fail, adapt provider/model choice and report attempted backends in usage.

Coding protocol:
- First preserve user work. Never revert unrelated dirty changes.
- Prefer existing project patterns, stdlib/native APIs, and short diffs.
- Make one coherent change, then run the narrowest useful verification.
- If a test fails, read the full failure, fix root cause, and rerun. Do not retry blindly.

Answer protocol:
- Be direct. Lead with result, bug, or next action.
- Do not expose hidden reasoning. Show assumptions, checks, and residual risk only.
- Never claim impossible certainty or that you are literally above all models. Earn trust through verified work.
</dardcor_v1_max_overdrive>
""".strip()

    _PREFERRED_PROVIDERS = (
        "ClaudeCodeSubscription",
        "CodexSubscription",
        "Anthropic",
        "OpenAI",
        "OpenCodeZen",
        "Gemini",
        "Groq",
        "OpenRouter",
        "NVIDIA",
        "Mistral",
        "Cohere",
        "Perplexity",
        "TogetherAI",
        "DeepInfra",
        "FireworksAI",
        "MoonshotAI",
        "ZhipuAI",
        "SambaNova",
        "ChutesAI",
        "Cerebras",
        "GitHubModels",
        "DeepSeek",
        "xAI",
        "Ollama",
    )
    _MAX_MODEL_KEYWORDS = (
        ("opus", 100),
        ("gpt-5", 95),
        ("claude", 92),
        ("gemini-3", 90),
        ("sonnet", 88),
        ("gpt-oss-120b", 82),
        ("70b", 78),
        ("deepseek", 76),
        ("qwen3", 74),
        ("qwen-3", 74),
        ("flash", 55),
        ("8b", 35),
    )

    def _is_free_model(self, model: Dict[str, Any]) -> bool:
        name = str(model.get("name", "")).lower()
        model_id = str(model.get("id", "")).lower()
        return "(free)" in name or model_id.endswith(":free") or model.get("free") is True

    @classmethod
    def _max_model_score(cls, provider_name: str, model: Dict[str, Any]) -> int:
        text = f"{provider_name} {model.get('id', '')} {model.get('name', '')}".lower()
        score = 10
        for keyword, weight in cls._MAX_MODEL_KEYWORDS:
            if keyword in text:
                score = max(score, weight)
        if "(free)" in text or str(model.get("id", "")).endswith(":free"):
            score += 2
        return score

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
        return bool(self._load_provider_states().get(provider_name))

    def _load_provider_states(self) -> Dict[str, bool]:
        try:
            from pydardcor.core.antigravity_db import AntigravityDB
            from pydardcor.core.config import get_user_data_dir

            states = AntigravityDB(get_user_data_dir()).get_providers()
            return {str(k): bool(v) for k, v in states.items()}
        except Exception:
            return {"Dardcor": True, "Antigravity": True}

    def _load_provider_config(self, provider_name: str) -> Dict[str, Any]:
        try:
            from pydardcor.core.config import get_user_data_dir

            config_path = os.path.join(get_user_data_dir(), "database", "models", provider_name, "config.json")
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            pass
        return {}

    def _secret_key(self, provider_name: str) -> str:
        return provider_name.replace("_", "").lower()

    def _registry_provider_name(self, provider_name: str) -> str:
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

            for name in PROVIDER_REGISTRY:
                if name.lower() == provider_name.lower():
                    return name
        except Exception:
            pass
        aliases = {
            "openrouter": "OpenRouter",
            "githubmodels": "GitHubModels",
            "togetherai": "TogetherAI",
            "fireworksai": "FireworksAI",
            "moonshotai": "MoonshotAI",
            "zhipuai": "ZhipuAI",
        }
        return aliases.get(provider_name.lower(), provider_name[:1].upper() + provider_name[1:])

    def _registry_provider_def(self, provider_name: str) -> Dict[str, Any]:
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

            return PROVIDER_REGISTRY.get(self._registry_provider_name(provider_name), {})
        except Exception:
            return {}

    def _is_keyless_provider(self, provider_def: Dict[str, Any]) -> bool:
        return bool(provider_def.get("is_local") or provider_def.get("tier") in ("Free", "Gateway"))

    def _load_max_prompts(self) -> str:
        return FABLE_PROMPT

    def _dedupe_response_text(self, text: str) -> str:
        stripped = (text or "").strip()
        if not stripped:
            return ""
        half = len(stripped) // 2
        if len(stripped) > 80 and stripped[:half].strip() == stripped[half:].strip():
            stripped = stripped[:half].strip()
        paragraphs = []
        seen = set()
        for part in stripped.split("\n\n"):
            key = " ".join(part.split()).lower()
            if key and key not in seen:
                paragraphs.append(part)
                seen.add(key)
        return "\n\n".join(paragraphs).strip()

    def _with_max_prompt(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not self._MAX_PROMPT_CACHE:
            self.__class__._MAX_PROMPT_CACHE = (
                "You are Dardcor MAX, the strongest Dardcor orchestrator mode. "
                "Use all active user-configured provider capacity responsibly. "
                f"Usage accounting weight: {self.MAX_USAGE_WEIGHT}x per turn.\n\n"
                f"{self._DARDCORE_MAX_OVERLAY}\n\n"
                f"{self._load_max_prompts()}"
            )
        return [{"role": "system", "content": self._MAX_PROMPT_CACHE}, *messages]

    def _candidate_models(self, *, max_mode: bool = False, states: Dict[str, bool] | None = None) -> List[Tuple[str, str, str]]:
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

            states = states or {}
            candidates = []
            seen_providers = set()
            for provider_name in self._PREFERRED_PROVIDERS:
                provider = PROVIDER_REGISTRY.get(provider_name, {})
                active = bool(states.get(provider_name))
                provider_candidates = []
                for model in provider.get("models", []):
                    model_id = model.get("id")
                    if model_id and (self._is_free_model(model) if not max_mode else active):
                        provider_candidates.append((
                            provider_name,
                            provider.get("base_url", ""),
                            model_id,
                            self._max_model_score(provider_name, model) if max_mode else 0,
                        ))
                provider_candidates.sort(key=lambda item: item[3], reverse=True)
                for candidate in provider_candidates:
                    if max_mode and candidate[0] in seen_providers:
                        continue
                    seen_providers.add(candidate[0])
                    candidates.append(candidate)
            candidates.sort(key=lambda item: item[3], reverse=True)
            return [(provider, base_url, model_id) for provider, base_url, model_id, _score in candidates]
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
        states = self._load_provider_states()
        tried = []
        max_mode = model_override == self.MAX_MODEL_ID
        usage = {"model": "Dardcor MAX" if max_mode else "Dardcor Flash Free", "weight": self.MAX_USAGE_WEIGHT if max_mode else 1.0, "attempts": 0}
        routed_messages = self._with_max_prompt(messages) if max_mode else messages
        successful_responses: List[Tuple[str, ProviderResponse]] = []

        if not max_mode and states.get("Antigravity"):
            try:
                from dardcor_agent.models.providers.antigravity.provider import AntigravityProvider

                response = AntigravityProvider().generate_turn(
                    messages=routed_messages,
                    tools=tools,
                    config=config,
                    model_override="Gemini 3.5 Flash (Low)",
                    abort_check_fn=abort_check_fn,
                    conversation_callback=conversation_callback,
                )
                usage["attempts"] += 1
                if not response.error:
                    response.usage = self._usage_meta(usage, "antigravity:Gemini 3.5 Flash (Low)", tried)
                    return response
                tried.append("antigravity")
            except Exception as exc:
                tried.append(f"antigravity:{exc}")

        for provider_name, base_url, model_id in self._candidate_models(max_mode=max_mode, states=states):
            if abort_check_fn():
                return ProviderResponse(error="Agent dihentikan oleh pengguna.")
            registry_name = self._registry_provider_name(provider_name)
            provider_def = self._registry_provider_def(provider_name)
            provider_config = self._load_provider_config(registry_name)
            keys = secrets.get(self._secret_key(provider_name), [])
            active = bool(states.get(registry_name) or states.get(provider_name))
            if not active:
                continue
            oauth_provider = provider_def.get("oauth_provider", "")
            oauth_token = ""
            if oauth_provider:
                try:
                    from dardcor_agent.models.subscription_oauth import load_oauth_token

                    oauth_token = load_oauth_token(oauth_provider).get("access_token", "")
                except Exception:
                    oauth_token = ""
            api_key = provider_config.get("api_key", "") or oauth_token or (keys[0] if keys else getattr(config, "api_key", ""))
            if not api_key and not self._is_keyless_provider(provider_def):
                continue

            tried.append(f"{provider_name}:{model_id}")
            routed_config = copy.copy(config)
            routed_config.provider = provider_name.lower()
            routed_config.base_url = provider_config.get("base_url", "") or base_url
            routed_config.api_key = api_key
            routed_config.api_key_header = provider_def.get("api_key_header", "Authorization")
            routed_config.single_endpoint = bool(provider_def.get("single_endpoint"))
            routed_config.oauth_provider = oauth_provider
            routed_config.skip_dashboard_provider = True
            response = backend.generate_turn(
                messages=routed_messages,
                tools=tools,
                config=routed_config,
                model_override=model_id,
                abort_check_fn=abort_check_fn,
                conversation_callback=conversation_callback,
            )
            usage["attempts"] += 1
            if not response.error:
                if response.tool_calls or not max_mode:
                    response.usage = self._usage_meta(usage, f"{provider_name}:{model_id}", tried)
                    return response
                successful_responses.append((f"{provider_name}:{model_id}", response))

        if successful_responses:
            selected_backend, selected_response = max(
                successful_responses,
                key=lambda item: len((item[1].content or "").strip()),
            )
            selected_response.usage = self._usage_meta(usage, selected_backend, tried)
            selected_response.content = self._dedupe_response_text(selected_response.content)
            return selected_response

        tried_text = ", ".join(tried[:8]) or "none"
        active_names = [name for name, enabled in states.items() if enabled and name != "Dardcor"]
        active_text = ", ".join(active_names[:8]) or "none"
        return ProviderResponse(
            error=(
                f"{usage['model']} tidak menemukan model aktif yang bisa dipakai.\n\n"
                "Provider aktif harus punya API key/OAuth token yang valid, kecuali provider keyless. "
                f"Active: {active_text}. Tried ready routes: {tried_text}"
            )
        )

    def _usage_meta(self, usage: Dict[str, Any], selected_backend: str, tried: List[str]) -> Dict[str, Any]:
        attempts = int(usage.get("attempts", 0))
        weight = float(usage.get("weight", 1.0))
        return {
            "model": usage.get("model", "Dardcor"),
            "attempts": attempts,
            "weight": weight,
            "billed_units": attempts * weight,
            "selected_backend": selected_backend,
            "tried": tried[:8],
        }
