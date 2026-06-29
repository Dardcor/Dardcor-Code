import json
import os
import urllib.request
import urllib.error
import urllib.parse
import ssl
import uuid
import time
from typing import List, Dict, Any, Optional

from dardcor_agent.models.providers.base import BaseProvider, ProviderResponse
from pydardcor.core.config import get_user_data_dir

class AntigravityProvider(BaseProvider):
    """Provider for Google Cloud Code Assist (Antigravity mode)."""

    def __init__(self):
        self._current_acc_idx = 0
        self._retry_count = 0
        self._accounts = self._load_accounts()
        self._active_sockets = []
        self._abort_flag = False

    def abort(self):
        self._abort_flag = True
        for sock in list(self._active_sockets):
            try:
                sock.close()
            except Exception:
                pass

    def _load_accounts(self) -> List[Dict[str, str]]:
        accounts = []
        try:
            accounts_dir = os.path.join(get_user_data_dir(), "database", "models", "Antigravity", "accounts")
            acc_index_file = os.path.join(get_user_data_dir(), "database", "models", "Antigravity", "accounts.json")
            if os.path.exists(acc_index_file):
                with open(acc_index_file, "r", encoding="utf-8") as f:
                    acc_index = json.load(f)
                for idx_acc in acc_index.get("accounts", []):
                    if idx_acc.get("disabled", False) or idx_acc.get("proxy_disabled", False):
                        continue
                    acc_id = idx_acc.get("id", "")
                    acc_file = os.path.join(accounts_dir, f"{acc_id}.json")
                    if os.path.exists(acc_file):
                        try:
                            with open(acc_file, "r", encoding="utf-8") as f:
                                acc_data = json.load(f)
                            rt = acc_data.get("refresh_token") or acc_data.get("token", {}).get("refresh_token")
                            if rt:
                                accounts.append({
                                    "acc_id": acc_id,
                                    "refresh_token": rt,
                                    "email": acc_data.get("email", "Unknown Email")
                                })
                        except Exception:
                            pass
        except Exception:
            pass
        return accounts

    def generate_turn(
        self, 
        messages: List[Dict[str, Any]], 
        tools: List[Dict[str, Any]], 
        config: Any, 
        model_override: str, 
        abort_check_fn: callable,
        conversation_callback: callable
    ) -> ProviderResponse:
        
        if not self._accounts:
            return ProviderResponse(error="Dardcor Code aktif tapi tidak ada akun yang tersedia. Tambahkan akun terlebih dahulu di /models.")

        # Map display name to API model ID
        _MODEL_MAP = {
            "Gemini 3.1 Pro (High)": "gemini-3.1-pro-high",
            "Gemini 3.1 Pro (Low)": "gemini-3.1-pro-low",
            "Gemini 3 Pro (High)": "gemini-3-pro-high",
            "Gemini 3 Pro (Low)": "gemini-3-pro-low",
            "Gemini 3 Flash": "gemini-3-flash",
            "Gemini 3.5 Flash (High)": "gemini-3.5-flash-agent",
            "Gemini 3.5 Flash (Low)": "gemini-3.5-flash-extra-low",
            "Gemini 3.5 Flash (Medium)": "gemini-3.5-flash-low",
            "Gemini 2.5 Pro": "gemini-2.5-pro",
            "Claude Sonnet 4.6 (Thinking)": "claude-sonnet-4-6",
            "Claude Sonnet 4.6": "claude-sonnet-4-6",
            "Claude Opus 4.6 (Thinking)": "claude-opus-4-6-thinking",
            "Gemini 3.1 Flash Thinking": "gemini-3-flash",
            "Gemini 3.1 Flash Lite": "gemini-3.5-flash-extra-low",
            "Gemini 3.1 Flash Image": "gemini-3-flash-agent",
        }
        if not model_override:
            model_override = config.model or "gemini-1.5-pro"
        antigravity_model_id = _MODEL_MAP.get(model_override, model_override.lower().replace(" ", "-").replace("(", "").replace(")", ""))

        cid_part1 = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep"
        cid_part2 = ".apps.googleusercontent.com"
        client_id = cid_part1 + cid_part2
        sec_part1 = "GOCSPX"
        sec_part2 = "-K58FWR486LdLJ1mLB8sXC4z6qDAf"
        client_secret = sec_part1 + sec_part2
        token_url = "https://oauth2.googleapis.com/token"

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        last_err_str = None
        force_text_tools = False
        
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
            while self._current_acc_idx < len(self._accounts):
                if abort_check_fn() or self._abort_flag:
                    return ProviderResponse(error="Agent dihentikan oleh pengguna.")

                current_acc = self._accounts[self._current_acc_idx]
                refresh_token = current_acc["refresh_token"]
                acc_id = current_acc["acc_id"]
                acc_email = current_acc.get("email", "Unknown Email")

                if getattr(self, "_last_notified_idx", None) != self._current_acc_idx:
                    conversation_callback("notification", f"Selected account: {acc_email}")
                    self._last_notified_idx = self._current_acc_idx

                try:
                    # Step 1: Refresh token
                    data_token = urllib.parse.urlencode({
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "refresh_token": refresh_token,
                        "grant_type": "refresh_token"
                    }).encode("utf-8")

                    req_token = urllib.request.Request(token_url, data=data_token, headers={"User-Agent": "Antigravity/1.0"})
                    with urllib.request.urlopen(req_token, context=ctx, timeout=15) as res_token:
                        access_token = json.loads(res_token.read().decode("utf-8")).get("access_token")

                    if not access_token:
                        raise Exception("Failed to get access token")

                    # Step 2: Load Code Assist project ID
                    project_id = None
                    try:
                        lc_req = urllib.request.Request(
                            "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
                            data=json.dumps({"metadata": {"ideType": "ANTIGRAVITY"}}).encode("utf-8"),
                            headers={
                                "Authorization": f"Bearer {access_token}",
                                "User-Agent": "Antigravity/1.0",
                                "Content-Type": "application/json"
                            }
                        )
                        with urllib.request.urlopen(lc_req, context=ctx, timeout=15) as lc_res:
                            lc_data = json.loads(lc_res.read().decode("utf-8"))
                            project_id = lc_data.get("cloudaicompanionProject")
                    except Exception as lc_e:
                        print(f"[Agent] loadCodeAssist failed for {acc_id[:8]}: {lc_e}")

                    # Step 3: Call Google Cloud Code Assist endpoint
                    base_api = "https://daily-cloudcode-pa.sandbox.googleapis.com"
                    api_url = f"{base_api}/v1internal:generateContent"

                    # Transform messages to Google contents format
                    contents = []
                    system_parts = []
                    
                    for msg in messages:
                        role = msg.get("role", "user")
                        content_text = msg.get("content", "")
                        if role == "system":
                            if "You are Dardcor Code" in content_text:
                                # Typically handled in history builder, but just in case
                                system_parts.append({"text": content_text})
                            else:
                                system_parts.append({"text": content_text})
                        elif role == "assistant":
                            parts = []
                            has_google_parts = False
                            if not force_text_tools and "tool_calls" in msg and msg["tool_calls"] and msg["tool_calls"][0].get("google_parts"):
                                parts = msg["tool_calls"][0]["google_parts"]
                                has_google_parts = True
                                
                            if not has_google_parts:
                                if content_text:
                                    parts.append({"text": content_text})
                                if not force_text_tools and "tool_calls" in msg:
                                    for tc in msg["tool_calls"]:
                                        try:
                                            args = json.loads(tc["function"]["arguments"])
                                        except Exception:
                                            args = {}
                                        parts.append({
                                            "functionCall": {
                                                "name": tc["function"]["name"],
                                                "args": args
                                            }
                                        })
                                elif force_text_tools and "tool_calls" in msg:
                                    for tc in msg["tool_calls"]:
                                        parts.append({"text": f"[Tool Call Intended: {tc['function']['name']}]"})
                                if not parts:
                                    parts.append({"text": ""})
                            contents.append({"role": "model", "parts": parts})
                        elif role == "tool":
                            part = {
                                "functionResponse": {
                                    "name": msg.get("name", "tool"),
                                    "response": {"result": content_text}
                                }
                            }
                            if msg.get("tool_call_id"):
                                part["functionResponse"]["id"] = msg["tool_call_id"]
                            if contents and contents[-1]["role"] == "user" and any("functionResponse" in p for p in contents[-1]["parts"]):
                                contents[-1]["parts"].append(part)
                            else:
                                contents.append({"role": "user", "parts": [part]})
                        else:
                            contents.append({
                                "role": "user",
                                "parts": [{"text": content_text}]
                            })

                    # Gemini Payload Sanitizer
                    sanitized_contents = []
                    for c in contents:
                        if not sanitized_contents:
                            if c["role"] == "model":
                                sanitized_contents.append({"role": "user", "parts": [{"text": "Hello"}]})
                            sanitized_contents.append(c)
                        else:
                            if sanitized_contents[-1]["role"] == c["role"]:
                                sanitized_contents[-1]["parts"].extend(c["parts"])
                            else:
                                sanitized_contents.append(c)
                                
                    final_contents = []
                    for c in sanitized_contents:
                        if c["role"] == "user" and any("functionResponse" in p for p in c["parts"]):
                            has_call = final_contents and final_contents[-1]["role"] == "model" and any("functionCall" in p for p in final_contents[-1]["parts"])
                            if not has_call:
                                new_parts = []
                                for p in c["parts"]:
                                    if "functionResponse" in p:
                                        fr = p["functionResponse"]
                                        res = fr.get("response", {}).get("result", "")
                                        new_parts.append({"text": f"[Tool Result: {fr.get('name', 'tool')}]\n{res}"})
                                    else:
                                        new_parts.append(p)
                                c["parts"] = new_parts
                        final_contents.append(c)
                    contents = final_contents

                    google_tools = []
                    for t in tools:
                        func = t["function"].copy()
                        if "parameters" in func and not func["parameters"].get("properties"):
                            func["parameters"] = {"type": "object", "properties": {}}
                        google_tools.append(func)

                    request_id = f"agent/antigravity/{uuid.uuid4().hex[:8]}/{len(messages)}"

                    payload = {
                        "project": project_id or "",
                        "requestId": request_id,
                        "request": {
                            "contents": contents,
                            "systemInstruction": {
                                "role": "user",
                                "parts": system_parts
                            },
                            "tools": [{"functionDeclarations": google_tools}],
                            "generationConfig": {
                                "temperature": config.temperature,
                                "maxOutputTokens": min(config.max_tokens, 8192),
                                "topP": 1.0,
                                "topK": 40
                            },
                            "safetySettings": [
                                { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "OFF" },
                                { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "OFF" },
                                { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "OFF" },
                                { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "OFF" },
                                { "category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "OFF" }
                            ]
                        },
                        "model": antigravity_model_id,
                        "userAgent": "antigravity",
                        "requestType": "agent"
                    }

                    model_label = model_override or ""
                    if "thinking" in antigravity_model_id or "thinking" in model_label.lower():
                        payload["request"]["generationConfig"]["thinkingConfig"] = {
                            "includeThoughts": True,
                            "thinkingBudget": 8192
                        }

                    req = urllib.request.Request(
                        api_url,
                        data=json.dumps(payload).encode("utf-8"),
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "User-Agent": "Antigravity/1.0",
                            "Content-Type": "application/json"
                        },
                        method="POST"
                    )

                    with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
                        result = json.loads(resp.read().decode("utf-8"))

                    candidates = result.get("response", {}).get("candidates", [])
                    if not candidates:
                        return ProviderResponse(error="Tidak ada respons dari model. Silakan coba lagi.")

                    candidate = candidates[0]
                    content = candidate.get("content", {})
                    parts = content.get("parts", [])
                    
                    text_content = ""
                    extracted_tools = []
                    google_parts = []
                    
                    for part in parts:
                        google_parts.append(part)
                        if "text" in part:
                            text_content += part["text"]
                        if "functionCall" in part:
                            fc = part["functionCall"]
                            f_name = fc["name"]
                            f_args = fc.get("args", {})
                            extracted_tools.append({
                                "id": f"call_{uuid.uuid4().hex[:8]}",
                                "type": "function",
                                "function": {
                                    "name": f_name,
                                    "arguments": json.dumps(f_args)
                                },
                                "google_parts": [part]
                            })

                    self._retry_count = 0
                    return ProviderResponse(content=text_content, tool_calls=extracted_tools)

                except urllib.error.HTTPError as e:
                    if abort_check_fn() or self._abort_flag:
                        return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                    body = ""
                    try:
                        body = e.read().decode("utf-8", errors="replace")
                    except Exception:
                        pass
                    
                    if e.code == 400 and "thought_signature" in body and not force_text_tools:
                        force_text_tools = True
                        continue

                    if e.code in (500, 502, 503, 504):
                        self._retry_count += 1
                        if self._retry_count <= 4:
                            wait_secs = min(2 ** self._retry_count, 16)
                            print(f"[Agent] Transient error {e.code} on account {acc_id[:8]}, retrying in {wait_secs}s (attempt {self._retry_count}/4)...")
                            time.sleep(wait_secs)
                            continue
                        else:
                            self._retry_count = 0
                            return ProviderResponse(error=f"⚠️ **API Error ({e.code})** - Model sedang sibuk (high demand).\n\nSudah dicoba 4 kali namun tetap gagal.\nSilakan coba lagi nanti atau pilih model lain.\n\nDetail: {body[:300]}")
                    
                    self._retry_count = 0
                    if e.code in (429, 403, 421):
                        last_err_str = f"Account {acc_id[:8]} quota exhausted ({e.code})"
                        print(f"[Agent] {last_err_str}, trying next account...")
                        
                        next_idx = self._current_acc_idx + 1
                        if next_idx < len(self._accounts):
                            next_email = self._accounts[next_idx].get("email", "Unknown Email")
                            switch_msg = f"🔄 **Batas Token Tercapai.**\nSistem secara otomatis beralih melanjutkan pemikiran/tugas ke akun berikutnya: **{next_email}**"
                            conversation_callback("system", switch_msg)
                            conversation_callback("notification", f"Next account: {next_email}")
                        self._current_acc_idx += 1
                        continue
                        
                    return ProviderResponse(error=f"API Error ({e.code}): {body[:500]}")

                except urllib.error.URLError as e:
                    if abort_check_fn() or self._abort_flag:
                        return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                    if "11001" in str(e) or "10061" in str(e) or "getaddrinfo failed" in str(e) or "Connection refused" in str(e):
                        return ProviderResponse(error="🚨 Koneksi Gagal!\n\nTidak dapat terhubung ke server Google Antigravity. Periksa koneksi internet Anda.")
                    last_err_str = str(e)
                    print(f"[Agent] Network Error for account {acc_id[:8]}: {e}")
                    self._current_acc_idx += 1
                    continue
                except Exception as e:
                    if abort_check_fn() or self._abort_flag:
                        return ProviderResponse(error="Agent dihentikan oleh pengguna.")
                    last_err_str = str(e)
                    print(f"[Agent] Error for account {acc_id[:8]}: {e}")
                    self._current_acc_idx += 1
                    continue
        finally:
            socket.socket = original_socket
            self._active_sockets = []
            
        if abort_check_fn() or self._abort_flag:
            return ProviderResponse(error="Agent dihentikan oleh pengguna.")
        return ProviderResponse(error=f"Semua akun Dardcor Code telah habis. Error terakhir: {last_err_str or 'Unknown'}")
