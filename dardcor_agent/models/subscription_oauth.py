from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import threading
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional


CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"


class OAuthStateMismatch(RuntimeError):
    pass


@dataclass(frozen=True)
class OAuthSession:
    provider: str
    auth_url: str
    token_url: str
    redirect_uri: str
    code_verifier: str
    state: str
    callback_port: int


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def extract_chatgpt_account_id(token: str) -> str:
    try:
        payload = json.loads(_b64url_decode(token.split(".")[1]).decode("utf-8"))
        auth = payload.get("https://api.openai.com/auth", {})
        return str(auth.get("chatgpt_account_id") or "")
    except Exception:
        return ""


def _pkce_pair() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(64))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _token_store_path() -> str:
    from pydardcor.core.config import get_user_data_dir

    return os.path.join(get_user_data_dir(), "database", "models", "oauth_tokens.json")


def build_oauth_session(provider: str) -> OAuthSession:
    verifier, challenge = _pkce_pair()
    state = _b64url(secrets.token_bytes(32))
    if provider == "codex":
        redirect_uri = "http://localhost:1455/auth/callback"
        params = {
            "response_type": "code",
            "client_id": CODEX_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "scope": "openid profile email offline_access",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
            "originator": "codex_cli_rs",
            "state": state,
        }
        return OAuthSession(
            provider=provider,
            auth_url="https://auth.openai.com/oauth/authorize?" + urllib.parse.urlencode(params),
            token_url="https://auth.openai.com/oauth/token",
            redirect_uri=redirect_uri,
            code_verifier=verifier,
            state=state,
            callback_port=1455,
        )
    if provider == "claude":
        redirect_uri = "http://localhost:20128/callback"
        params = {
            "code": "true",
            "client_id": CLAUDE_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": "org:create_api_key user:profile user:inference",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
        return OAuthSession(
            provider=provider,
            auth_url="https://claude.ai/oauth/authorize?" + urllib.parse.urlencode(params),
            token_url="https://platform.claude.com/v1/oauth/token",
            redirect_uri=redirect_uri,
            code_verifier=verifier,
            state=state,
            callback_port=20128,
        )
    raise ValueError(f"Unknown OAuth provider: {provider}")


def save_oauth_token(provider: str, token: Dict[str, Any]) -> None:
    path = _token_store_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data: Dict[str, Any] = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                data = loaded
        except Exception:
            data = {}
    data[provider] = token
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def load_oauth_token(provider: str) -> Dict[str, Any]:
    path = _token_store_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        token = data.get(provider, {}) if isinstance(data, dict) else {}
        return token if isinstance(token, dict) else {}
    except Exception:
        return {}


def parse_oauth_callback(path: str, expected_state: str) -> str:
    parsed = urllib.parse.urlparse(path)
    params = urllib.parse.parse_qs(parsed.query)
    if not params and parsed.fragment:
        params = urllib.parse.parse_qs(parsed.fragment)

    error = params.get("error_description", params.get("error", [""]))[0]
    if error:
        raise RuntimeError(error)

    code = params.get("code", [""])[0]
    state = params.get("state", [""])[0]
    if code and not state and "#" in code:
        code, state = code.rsplit("#", 1)

    if state != expected_state:
        raise OAuthStateMismatch("OAuth state mismatch.")
    if not code:
        raise RuntimeError("OAuth callback did not include code.")
    return code


class OAuthCallbackServer:
    def __init__(self, session: OAuthSession):
        self.session = session
        self.code: Optional[str] = None
        self.error: Optional[str] = None
        self._event = threading.Event()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def do_GET(self):
                try:
                    outer.code = parse_oauth_callback(self.path, outer.session.state)
                except OAuthStateMismatch as exc:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(
                        b"<html><body><h3>Old OAuth callback ignored. Use the newest login tab.</h3></body></html>"
                    )
                    return
                except Exception as exc:
                    outer.error = str(exc)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                message = "Login captured. You can close this tab." if outer.code else outer.error
                self.wfile.write(f"<html><body><h3>{message}</h3></body></html>".encode("utf-8"))
                outer._event.set()

        self._server = ThreadingHTTPServer(("127.0.0.1", session.callback_port), Handler)

    def start(self) -> None:
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def wait_for_code(self, timeout: int = 180) -> str:
        self._event.wait(timeout)
        self._server.shutdown()
        self._server.server_close()
        if self.error:
            raise RuntimeError(self.error)
        if not self.code:
            raise TimeoutError("OAuth login timed out.")
        return self.code


def exchange_code_for_token(session: OAuthSession, code: str) -> Dict[str, Any]:
    data = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": CLAUDE_CLIENT_ID if session.provider == "claude" else CODEX_CLIENT_ID,
            "code": code,
            "redirect_uri": session.redirect_uri,
            "code_verifier": session.code_verifier,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        session.token_url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        token = json.loads(resp.read().decode("utf-8"))
    save_oauth_token(session.provider, token)
    return token
