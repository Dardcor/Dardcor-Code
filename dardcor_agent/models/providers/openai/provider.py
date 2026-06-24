import json
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

    def generate_turn(
        self, 
        messages: List[Dict[str, Any]], 
        tools: List[Dict[str, Any]], 
        config: Any, 
        model_override: str, 
        abort_check_fn: callable,
        conversation_callback: callable
    ) -> ProviderResponse:

        api_key = config.api_key
        provider = config.provider
        model = model_override if model_override else config.model
        
        # Resolve base_url
        base_url = config.base_url
        if not base_url:
            from dardcor_agent.chat.agent import _get_provider_url
            base_url = _get_provider_url(provider, config.base_url)

        api_keys = [api_key] if api_key else []
        if not api_keys and provider not in ("ollama",):
            return ProviderResponse(error="No API key configured. Go to Settings (Ctrl+,) to set your API key, or set the DARDCOR_CODE_API_KEY environment variable.")

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

        for current_key in api_keys:
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {current_key}",
            }
            if provider == "anthropic":
                headers["x-api-key"] = current_key
                headers["anthropic-version"] = "2023-06-01"

            retry_count = 0
            while retry_count <= self._MAX_RETRIES:
                if abort_check_fn():
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
                                    f"⚠️ **API Error ({e.code})** - Model sedang sibuk (high demand).\\n\\n"
                                    f"Sudah dicoba {self._MAX_RETRIES} kali namun tetap gagal.\\n"
                                    f"Silakan coba lagi nanti atau pilih model lain.\\n\\n"
                                    f"Detail: {body[:300]}"
                                )
                            )
                    elif e.code in (403, 421):
                        last_error = e
                        break  # Try next API key if available
                    else:
                        return ProviderResponse(error=f"API Error ({e.code}): {body[:500]}")
                        
                except urllib.error.URLError as e:
                    if "10061" in str(e) or "Connection refused" in str(e):
                        return ProviderResponse(error="🚨 Koneksi Gagal!\\n\\nTidak dapat terhubung ke server API. Periksa koneksi internet Anda.")
                    retry_count += 1
                    if retry_count <= self._MAX_RETRIES:
                        wait_secs = min(2 ** retry_count, 16)
                        print(f"[Agent] Network error, retrying in {wait_secs}s (attempt {retry_count}/{self._MAX_RETRIES})...")
                        time.sleep(wait_secs)
                        continue
                    return ProviderResponse(error=f"Network error: {str(e)}")
                    
                except Exception as e:
                    if "10061" in str(e):
                        return ProviderResponse(error="🚨 Koneksi Gagal!\\n\\nTidak dapat terhubung ke server API. Periksa koneksi internet Anda.")
                    retry_count += 1
                    if retry_count <= self._MAX_RETRIES:
                        wait_secs = min(2 ** retry_count, 16)
                        print(f"[Agent] Connection error, retrying in {wait_secs}s (attempt {retry_count}/{self._MAX_RETRIES})...")
                        time.sleep(wait_secs)
                        continue
                    return ProviderResponse(error=f"Connection error: {str(e)}")

        if last_error:
            body = ""
            try:
                body = last_error.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            return ProviderResponse(error=f"All accounts exhausted. Last API Error ({last_error.code}): {body[:500]}")
            
        return ProviderResponse(error="All accounts exhausted.")
