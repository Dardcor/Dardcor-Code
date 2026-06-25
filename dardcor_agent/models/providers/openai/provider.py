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

    def _load_dashboard_provider(self, model_override: str = "") -> Dict[str, str]:
        try:
            from pydardcor.core.config import get_user_data_dir

            provider_file = os.path.join(get_user_data_dir(), "database", "models", "provider.json")
            if not os.path.exists(provider_file):
                return {}
            with open(provider_file, "r", encoding="utf-8") as f:
                states = json.load(f)

            from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY
            project_root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
            for provider_name, pdef in PROVIDER_REGISTRY.items():
                if pdef.get("is_special"):
                    continue
                if not states.get(provider_name, False):
                    continue
                config_path = os.path.join(project_root, "database", "models", provider_name, "config.json")
                if not os.path.exists(config_path):
                    continue
                with open(config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if model_override:
                    model_ids = {m.get("id") for m in data.get("models", []) if m.get("id")}
                    if data.get("selected_model"):
                        model_ids.add(data["selected_model"])
                    if model_override not in model_ids:
                        continue
                return {
                    "provider": provider_name.lower(),
                    "api_key": data.get("api_key", ""),
                    "model": data.get("selected_model", ""),
                    "base_url": data.get("base_url", "") or pdef.get("base_url", ""),
                }
        except Exception:
            return {}
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

        dashboard_provider = self._load_dashboard_provider(model_override if model_override else "")
        api_key = dashboard_provider.get("api_key") or config.api_key
        provider = dashboard_provider.get("provider") or config.provider
        model = model_override if model_override else dashboard_provider.get("model") or config.model
        
        # Resolve base_url
        base_url = dashboard_provider.get("base_url") or config.base_url
        if not base_url:
            from dardcor_agent.chat.agent import _get_provider_url
            base_url = _get_provider_url(provider, config.base_url)

        api_keys = [api_key] if api_key else []
        if not api_keys and provider not in ("ollama",):
            return ProviderResponse(
                error=(
                    "No API key configured for provider '{}'.\n\n"
                    "Open /models dashboard (or type /models in chat) and:\n"
                    "1. Enable Antigravity if you have accounts imported\n"
                    "2. Or add API key for Gemini/OpenRouter/DeepSeek/NVIDIA\n"
                    "3. Or set DARDCOR_CODE_API_KEY in Settings (Ctrl+,)"
                ).format(provider)
            )

        url = f"{base_url.rstrip('/')}/chat/completions"
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
                    "Authorization": f"Bearer {current_key}",
                }
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
