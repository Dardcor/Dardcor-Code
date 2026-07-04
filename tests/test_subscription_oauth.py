import json
import os
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch


class TestSubscriptionOAuth(unittest.TestCase):
    def test_codex_auth_url_uses_pkce_and_fixed_callback(self):
        from dardcor_agent.models.subscription_oauth import build_oauth_session

        session = build_oauth_session("codex")
        parsed = urlparse(session.auth_url)
        params = parse_qs(parsed.query)

        self.assertEqual(parsed.netloc, "auth.openai.com")
        self.assertEqual(params["client_id"], ["app_EMoamEEZ73f0CkXaXp7hrann"])
        self.assertEqual(params["redirect_uri"], ["http://localhost:1455/auth/callback"])
        self.assertEqual(params["code_challenge_method"], ["S256"])
        self.assertTrue(session.code_verifier)
        self.assertTrue(session.state)

    def test_claude_auth_url_uses_pkce_and_callback(self):
        from dardcor_agent.models.subscription_oauth import build_oauth_session

        session = build_oauth_session("claude")
        parsed = urlparse(session.auth_url)
        params = parse_qs(parsed.query)

        self.assertEqual(parsed.netloc, "claude.ai")
        self.assertEqual(params["client_id"], ["9d1c250a-e61b-44d9-88ed-5944d1962f5e"])
        self.assertEqual(params["redirect_uri"], ["http://localhost:20128/callback"])
        self.assertEqual(params["code"], ["true"])
        self.assertIn("user:inference", params["scope"][0])

    def test_tokens_are_saved_outside_repo_user_data(self):
        from dardcor_agent.models.subscription_oauth import load_oauth_token, save_oauth_token

        with tempfile.TemporaryDirectory() as tmp:
            with patch("pydardcor.core.config.get_user_data_dir", return_value=tmp):
                save_oauth_token("codex", {"access_token": "tok", "refresh_token": "ref"})

                path = os.path.join(tmp, "database", "models", "oauth_tokens.json")
                self.assertTrue(os.path.exists(path))
                with open(path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                self.assertEqual(raw["codex"]["access_token"], "tok")
                self.assertEqual(load_oauth_token("codex")["refresh_token"], "ref")

    def test_callback_parser_accepts_query_fragment_and_code_hash_state(self):
        from dardcor_agent.models.subscription_oauth import parse_oauth_callback

        state = "STATE123"
        self.assertEqual(
            parse_oauth_callback("/callback?code=abc&state=STATE123", state),
            "abc",
        )
        self.assertEqual(
            parse_oauth_callback("/callback#code=def&state=STATE123", state),
            "def",
        )
        self.assertEqual(
            parse_oauth_callback("/callback?code=ghi%23STATE123", state),
            "ghi",
        )

    def test_callback_parser_marks_stale_state_as_ignorable(self):
        from dardcor_agent.models.subscription_oauth import OAuthStateMismatch, parse_oauth_callback

        with self.assertRaises(OAuthStateMismatch):
            parse_oauth_callback("/callback?code=old&state=OLD", "NEW")

    def test_chatgpt_account_id_is_extracted_from_jwt_payload(self):
        from dardcor_agent.models.subscription_oauth import extract_chatgpt_account_id

        payload = {"https://api.openai.com/auth": {"chatgpt_account_id": "acc_123"}}
        import base64
        import json

        body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        token = f"header.{body}.sig"

        self.assertEqual(extract_chatgpt_account_id(token), "acc_123")


if __name__ == "__main__":
    unittest.main()
