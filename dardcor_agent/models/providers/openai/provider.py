import json
import os
import urllib.request
import urllib.error
import time
from typing import List, Dict, Any, Optional

from dardcor_agent.models.providers.base import BaseProvider, ProviderResponse

class StandardOpenAIProvider(BaseProvider):
    """Provider for standard OpenAI-compatible endpoints (OpenAI, DeepSeek, Groq, OpenRouter, etc.)."""

    def __init__(self):
        self._MAX_RETRIES = 4
        self._RETRYABLE_CODES = {429, 500, 502, 503, 504}
        self._active_sockets = []
        self._abort_flag = False

    def abort(self):
        self._abort_flag = True
        for sock in list(self._active_sockets):
            try:
                sock.close()
            except Exception:
                pass

    def _generate_codex_subscription(
        self,
        *,
        access_token: str,
        model: str,
        messages: List[Dict[str, Any]],
        config: Any,
    ) -> ProviderResponse:
        try:
            from dardcor_agent.models.subscription_oauth import extract_chatgpt_account_id
            import uuid

            account_id = extract_chatgpt_account_id(access_token)
            if not account_id:
                return ProviderResponse(error="ChatGPT OAuth token missing chatgpt_account_id. Login again.")

            input_items = []
            for m in messages:
                content = str(m.get("content", ""))
                if not content:
                    continue
                role = str(m.get("role", "user"))
                if role not in ("user", "assistant"):
                    role = "user"
                    content = f"Instruction:\n{content}"
                input_items.append(
                    {
                        "type": "message",
                        "role": role,
                        "content": [{"type": "input_text", "text": content}],
                    }
                )
            payload = {
                "model": model.split("/", 1)[-1],
                "input": input_items,
                "stream": True,
                "store": False,
            }
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
                "OpenAI-Beta": "responses=experimental",
                "session_id": str(uuid.uuid4()),
                "originator": "codex_cli_rs",
                "chatgpt-account-id": account_id,
            }
            req = urllib.request.Request(
                "https://chatgpt.com/backend-api/codex/responses",
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            if "data:" in body:
                parts = []
                for line in body.splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    chunk = line[5:].strip()
                    if not chunk or chunk == "[DONE]":
                        continue
                    try:
                        event = json.loads(chunk)
                    except Exception:
                        continue
                    text = (
                        event.get("delta")
                        or event.get("text")
                        or event.get("output_text")
                    )
                    if not text and isinstance(event.get("response"), dict):
                        text = event["response"].get("output_text")
                    if not text and isinstance(event.get("item"), dict):
                        text = event["item"].get("text")
                    if not text and event.get("type") in ("response.output_text.delta", "output_text.delta"):
                        text = event.get("delta")
                    if text:
                        parts.append(str(text))
                if parts:
                    return ProviderResponse(content="".join(parts))
                return ProviderResponse(error=f"Codex OAuth stream returned no text: {body[:500]}")
            if not body.strip():
                return ProviderResponse(error="Codex OAuth returned empty response.")
            result = json.loads(body)
            if isinstance(result.get("output_text"), str):
                return ProviderResponse(content=result["output_text"])
            output = result.get("output", [])
            parts = []
            if isinstance(output, list):
                for item in output:
                    for content in item.get("content", []) if isinstance(item, dict) else []:
                        if isinstance(content, dict):
                            text = content.get("text") or content.get("value")
                            if text:
                                parts.append(str(text))
            return ProviderResponse(content="\n".join(parts) or json.dumps(result)[:4000])
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            return ProviderResponse(error=f"Codex OAuth API Error ({exc.code}): {body[:500]}")
        except Exception as exc:
            return ProviderResponse(error=f"Codex OAuth request failed: {exc}")

    def _load_dashboard_provider(self, model_override: str = "") -> Dict[str, str]:
        try:
            from pydardcor.core.config import get_user_data_dir
            from dardcor_agent.models.providers.registry import (
                PROVIDER_REGISTRY,
                find_provider_for_model,
            )

            states = {}
            provider_file = os.path.join(get_user_data_dir(), "database", "models", "provider.json")
            if os.path.exists(provider_file):
                with open(provider_file, "r", encoding="utf-8") as f:
                    states = json.load(f)

            project_root = os.path.normpath(
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
            )

            # 1) Resolve the owning provider straight from the registry.
            target_name, target_pdef = (None, None)
            if model_override:
                target_name, target_pdef = find_provider_for_model(model_override)

            # 2) Fallback to first enabled non-special provider.
            if not target_name:
                for provider_name, pdef in PROVIDER_REGISTRY.items():
                    if pdef.get("is_special"):
                        continue
                    if states.get(provider_name, False):
                        target_name, target_pdef = provider_name, pdef
                        break

            if not target_name:
                return {}

            # 3) Read per-provider config for api_key / base_url overrides.
            config_path = os.path.join(get_user_data_dir(), "database", "models", target_name, "config.json")
            data = {}
            if os.path.exists(config_path):
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)

            api_key = data.get("api_key", "")
            oauth_provider = (target_pdef or {}).get("oauth_provider", "")
            if not api_key and oauth_provider:
                try:
                    from dardcor_agent.models.subscription_oauth import load_oauth_token

                    api_key = load_oauth_token(oauth_provider).get("access_token", "")
                except Exception:
                    api_key = ""

            base_url = data.get("base_url", "") or (target_pdef or {}).get("base_url", "")
            if target_name == "MiMo" and "opencode.ai" in base_url:
                base_url = (target_pdef or {}).get("base_url", "")

            api_model = model_override or data.get("selected_model", "")
            if target_name == "OpenCodeZen" and api_model.startswith("opencode/"):
                api_model = api_model.split("/", 1)[1]

            return {
                "provider": target_name.lower(),
                "api_key": api_key,
                "model": api_model,
                "base_url": base_url,
                "api_key_header": (target_pdef or {}).get("api_key_header", "Authorization"),
                "single_endpoint": bool((target_pdef or {}).get("single_endpoint")),
                "oauth_provider": oauth_provider,
            }
        except Exception:
            return {}

    def generate_turn(
        self, 
        messages: List[Dict[str, Any]], 
        tools: List[Dict[str, Any]], 
        config: Any, 
        model_override: str, 
        abort_check_fn: callable,
        conversation_callback: callable
    ) -> ProviderResponse:

        dashboard_provider = {}
        if not getattr(config, "skip_dashboard_provider", False):
            dashboard_provider = self._load_dashboard_provider(model_override if model_override else "")
        api_key = dashboard_provider.get("api_key") or config.api_key
        provider = dashboard_provider.get("provider") or config.provider
        model = dashboard_provider.get("model") or model_override or config.model
        api_key_header = dashboard_provider.get("api_key_header") or getattr(config, "api_key_header", "Authorization")
        single_endpoint = bool(dashboard_provider.get("single_endpoint") or getattr(config, "single_endpoint", False))
        oauth_provider = dashboard_provider.get("oauth_provider") or getattr(config, "oauth_provider", "")
        
        # Resolve base_url
        base_url = dashboard_provider.get("base_url") or config.base_url
        if not base_url:
            from dardcor_agent.chat.agent import _get_provider_url
            base_url = _get_provider_url(provider, config.base_url)

        # Providers that can be tried without a key: local servers and free/
        # gateway tiers (the endpoint itself will 401 if a key is truly needed).
        keyless_ok = provider in ("ollama", "lmstudio")
        try:
            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY
            for _pn, _pd in PROVIDER_REGISTRY.items():
                if _pn.lower() == provider:
                    if _pd.get("requires_api_key"):
                        keyless_ok = False
                    elif _pd.get("is_local") or _pd.get("tier") in ("Free", "Gateway"):
                        keyless_ok = True
                    break
        except Exception:
            pass

        api_keys = [api_key] if api_key else []
        if not api_keys and keyless_ok:
            api_keys = [""]  # run one keyless attempt
        if not api_keys and not keyless_ok:
            return ProviderResponse(
                error=(
                    "No API key configured for provider '{}'.\n\n"
                    "Open /models dashboard (or type /models in chat) and:\n"
                    "1. Enable Antigravity if you have accounts imported\n"
                    "2. Or add API key for this provider (Zen/MiMo/Gemini/OpenRouter/etc.)\n"
                    "3. Or set DARDCOR_CODE_API_KEY in Settings (Ctrl+,)"
                ).format(provider)
            )
        if oauth_provider == "codex" and api_keys:
            return self._generate_codex_subscription(
                access_token=api_keys[0],
                model=model,
                messages=messages,
                config=config,
            )
        if oauth_provider and api_keys:
            return ProviderResponse(
                error=f"{oauth_provider.title()} OAuth chat adapter is not wired yet."
            )

        url = base_url.rstrip("/") if single_endpoint else f"{base_url.rstrip('/')}/chat/completions"
        last_error = None
        
        payload = {
            "model": model or "gpt-4o",
            "messages": messages,
            "tools": tools,
            "temperature": config.temperature,
            "max_tokens": min(config.max_tokens, 16384),
        }
        data = json.dumps(payload).encode("utf-8")

        import socket
        import threading
        
        current_thread_id = threading.get_ident()
        original_socket = socket.socket
        self_ref = self
        self._active_sockets = []
        self._abort_flag = False
        
        class PatchedSocket(original_socket):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                if threading.get_ident() == current_thread_id:
                    self_ref._active_sockets.append(self)
                    
        socket.socket = PatchedSocket
        try:
            for current_key in api_keys:
                headers = {
                    "Content-Type": "application/json",
                }
                if current_key:
                    if api_key_header == "api-key":
                        headers["api-key"] = current_key
                    else:
                        headers["Authorization"] = f"Bearer {current_key}"
                if provider == "anthropic":
                    headers["x-api-key"] = current_key
                    headers["anthropic-version"] = "2023-06-01"
                if provider == "openrouter":
                    headers["HTTP-Referer"] = "https://dardcor.local"
                    headers["X-Title"] = "Dardcor Code"

                retry_count = 0
                while retry_count <= self._MAX_RETRIES:
                    if abort_check_fn() or self._abort_flag:
                        return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                        
                    try:
                        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
                        with urllib.request.urlopen(req, timeout=120) as resp:
                            result = json.loads(resp.read().decode("utf-8"))

                        choice = result["choices"][0]
                        msg = choice["message"]
                        content = msg.get("content", "") or ""
                        tool_calls = msg.get("tool_calls", [])

                        return ProviderResponse(content=content, tool_calls=tool_calls)

                    except urllib.error.HTTPError as e:
                        if abort_check_fn() or self._abort_flag:
                            return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                        body = ""
                        try:
                            body = e.read().decode("utf-8", errors="replace")
                        except Exception:
                            pass
                        
                        if e.code in self._RETRYABLE_CODES:
                            retry_count += 1
                            if retry_count <= self._MAX_RETRIES:
                                wait_secs = min(2 ** retry_count, 16)
                                print(f"[Agent] Transient error {e.code}, retrying in {wait_secs}s (attempt {retry_count}/{self._MAX_RETRIES})...")
                                time.sleep(wait_secs)
                                continue
                            else:
                                return ProviderResponse(
                                    error=(
                                        f"⚠️ **API Error ({e.code})** - Model sedang sibuk (high demand).\n\n"
                                        f"Sudah dicoba {self._MAX_RETRIES} kali namun tetap gagal.\n"
                                        f"Silakan coba lagi nanti atau pilih model lain.\n\n"
                                        f"Detail: {body[:300]}"
                                    )
                                )
                        elif e.code in (403, 421):
                            last_error = e
                            break  # Try next API key if available
                        elif e.code == 404 or (e.code == 400 and "not found" in body.lower()):
                            return ProviderResponse(
                                error=(
                                    f"⚠️ **Model tidak ditemukan** — '{model}' tidak tersedia "
                                    f"untuk API key provider '{provider}'.\n\n"
                                    "Buka dropdown model di chat lalu pilih model lain "
                                    "(mis. Gemini Flash Latest / 2.5 Flash), atau ganti provider "
                                    "yang API key-nya sudah aktif.\n\n"
                                    f"Detail: {body[:300]}"
                                )
                            )
                        else:
                            return ProviderResponse(error=f"API Error ({e.code}): {body[:500]}")
                            
                    except urllib.error.URLError as e:
                        if abort_check_fn() or self._abort_flag:
                            return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                        if "10061" in str(e) or "Connection refused" in str(e):
                            return ProviderResponse(error="🚨 Koneksi Gagal!\n\nTidak dapat terhubung ke server API. Periksa koneksi internet Anda.")
                        retry_count += 1
                        if retry_count <= self._MAX_RETRIES:
                            wait_secs = min(2 ** retry_count, 16)
                            print(f"[Agent] Network error, retrying in {wait_secs}s (attempt {retry_count}/{self._MAX_RETRIES})...")
                            time.sleep(wait_secs)
                            continue
                        return ProviderResponse(error=f"Network error: {str(e)}")
                        
                    except Exception as e:
                        if abort_check_fn() or self._abort_flag:
                            return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                        if "10061" in str(e):
                            return ProviderResponse(error="🚨 Koneksi Gagal!\n\nTidak dapat terhubung ke server API. Periksa koneksi internet Anda.")
                        retry_count += 1
                        if retry_count <= self._MAX_RETRIES:
                            wait_secs = min(2 ** retry_count, 16)
                            print(f"[Agent] Connection error, retrying in {wait_secs}s (attempt {retry_count}/{self._MAX_RETRIES})...")
                            time.sleep(wait_secs)
                            continue
                        return ProviderResponse(error=f"Connection error: {str(e)}")
        finally:
            socket.socket = original_socket
            self._active_sockets = []

        if abort_check_fn() or self._abort_flag:
            return ProviderResponse(error="Agent dihentikan oleh pengguna.")
            
        if last_error:
            body = ""
            try:
                body = last_error.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            return ProviderResponse(error=f"All accounts exhausted. Last API Error ({last_error.code}): {body[:500]}")
            
        return ProviderResponse(error="All accounts exhausted.")
