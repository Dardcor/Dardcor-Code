import unittest
import os


class TestDardcorV1Registry(unittest.TestCase):
    def test_dardcor_v1_is_registered_virtual_model(self):
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

        entry = PROVIDER_REGISTRY["Dardcor"]
        self.assertTrue(entry["is_special"])
        self.assertEqual(entry["models"][0]["id"], "dardcor-v1")
        self.assertTrue(entry["built_in"])
        self.assertEqual(entry["tier"], "Built-in")

    def test_factory_returns_dardcor_provider_for_v1(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider
        from dardcor_agent.models.providers.factory import ProviderFactory

        provider = ProviderFactory.create(None, "dardcor-v1")
        self.assertIsInstance(provider, DardcorV1Provider)

    def test_provider_card_meta_shows_builtin_and_free_counts(self):
        from dardcor_agent.models.provider_meta import provider_card_meta
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

        self.assertIn("Built-in", provider_card_meta("Dardcor", PROVIDER_REGISTRY["Dardcor"]))
        self.assertIn("Free models", provider_card_meta("Groq", PROVIDER_REGISTRY["Groq"]))

    def test_antigravity_db_enables_dardcor_by_default(self):
        import json
        import tempfile
        from unittest.mock import patch

        from pydardcor.core.antigravity_db import AntigravityDB

        with tempfile.TemporaryDirectory() as tmp:
            prov_dir = os.path.join(tmp, "database", "models")
            os.makedirs(prov_dir, exist_ok=True)
            prov_file = os.path.join(prov_dir, "provider.json")
            with open(prov_file, "w", encoding="utf-8") as f:
                json.dump({"OpenAI": True}, f)

            with patch("pydardcor.core.antigravity_db.CONFIG_DIR", tmp):
                providers = AntigravityDB(tmp).get_providers()
            self.assertTrue(providers.get("Dardcor"))
            self.assertTrue(providers.get("Antigravity"))
            self.assertIs(providers.get("OpenAI"), True)

    def test_secret_lists_are_normalized_without_real_keys(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        secrets = DardcorV1Provider._normalize_secrets({
            "openrouter": "dummy-openrouter",
            "groq": ["dummy-groq"],
            "gemini": ["dummy-gemini-1", ""],
        })

        self.assertEqual(secrets["openrouter"], ["dummy-openrouter"])
        self.assertEqual(secrets["groq"], ["dummy-groq"])
        self.assertEqual(secrets["gemini"], ["dummy-gemini-1"])

    def test_dotenv_parser_supports_repeated_google_keys(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        parsed = DardcorV1Provider._parse_dotenv(
            "OPENROUTER_API_KEY=dummy-openrouter\n"
            "GOOGLE_API_KEY=dummy-gemini-1\n"
            "GOOGLE_API_KEY_2=dummy-gemini-2\n"
        )

        self.assertEqual(parsed["openrouter"], ["dummy-openrouter"])
        self.assertEqual(parsed["gemini"], ["dummy-gemini-1", "dummy-gemini-2"])


class TestDardcorToolCatalog(unittest.TestCase):
    def test_expanded_tool_names_are_available(self):
        from dardcor_agent.chat.agent import TOOLS

        names = {tool["function"]["name"] for tool in TOOLS}
        self.assertIn("git_status", names)
        self.assertIn("git_diff", names)
        self.assertIn("check_syntax", names)
        self.assertIn("detect_project", names)


class TestPromptEfficiencyPack(unittest.TestCase):
    def test_identity_prompt_includes_builtin_efficiency_pack(self):
        from dardcor_agent.chat.identity import get_identity_prompt

        prompt = get_identity_prompt()
        self.assertIn("BUILT-IN PROMPT EFFICIENCY PACK", prompt)
        self.assertIn("CAVEMAN COMPRESSION", prompt)
        self.assertIn("RTK-STYLE TOKEN DISCIPLINE", prompt)
        self.assertIn("PONYTAIL ENGINEERING", prompt)


class TestToolMessageSanitizer(unittest.TestCase):
    def test_orphan_tool_messages_are_removed_from_api_payload(self):
        from dardcor_agent.chat.memory import Conversation

        conv = Conversation()
        conv.add_message("system", "system")
        conv.add_message("tool", "orphan", tool_call_id="missing", name="read_file")
        conv.add_message("user", "hello")

        roles = [msg["role"] for msg in conv.get_api_messages()]
        self.assertEqual(roles, ["system", "user"])

    def test_assistant_tool_calls_are_not_merged_with_plain_assistant(self):
        from dardcor_agent.chat.memory import Conversation

        conv = Conversation()
        conv.add_message("assistant", "call", tool_calls=[{"id": "tc1", "function": {"name": "read_file", "arguments": "{}"}}])
        conv.add_message("assistant", "plain")

        messages = conv.get_api_messages()
        self.assertEqual(len(messages), 2)
        self.assertIn("tool_calls", messages[0])

    def test_adjacent_user_messages_are_merged_in_api_payload(self):
        from dardcor_agent.chat.memory import Conversation

        conv = Conversation()
        conv.add_message("user", "first")
        conv.add_message("user", "second")

        messages = conv.get_api_messages()
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["content"], "first\n\nsecond")


if __name__ == "__main__":
    unittest.main()
