import unittest
import os


class TestDardcorV1Registry(unittest.TestCase):
    def test_dardcor_v1_is_registered_virtual_model(self):
        from dardcor_agent.models.providers.registry import PROVIDER_REGISTRY

        entry = PROVIDER_REGISTRY["Dardcor"]
        self.assertTrue(entry["is_special"])
        ids = {model["id"] for model in entry["models"]}
        self.assertIn("dardcor-flash-free", ids)
        self.assertIn("dardcor-v1-max", ids)
        self.assertTrue(entry["built_in"])
        self.assertEqual(entry["tier"], "Built-in")

    def test_factory_returns_dardcor_provider_for_v1(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider
        from dardcor_agent.models.providers.factory import ProviderFactory

        provider = ProviderFactory.create(None, "dardcor-v1-max")
        self.assertIsInstance(provider, DardcorV1Provider)

    def test_max_prompt_loader_has_fallback(self):
        from unittest.mock import patch

        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        with patch("os.path.exists", return_value=False):
            prompt = DardcorV1Provider()._load_max_prompts()
        self.assertIn("Claude Fable 5", prompt)
        self.assertIn("adversarial_self_review", prompt)
        self.assertEqual(DardcorV1Provider.MAX_USAGE_WEIGHT, 2.5)

    def test_max_prompt_includes_dardcor_tool_overlay(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        messages = DardcorV1Provider()._with_max_prompt([{"role": "user", "content": "hi"}])
        prompt = messages[0]["content"]
        self.assertIn("<dardcor_v1_max_overdrive>", prompt)
        self.assertIn("browser_open", prompt)
        self.assertIn("provider routing", prompt)
        self.assertIn("target #1 quality", prompt)

    def test_max_model_score_prefers_stronger_models(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        opus = DardcorV1Provider._max_model_score("Anthropic", {"id": "claude-opus-4-8", "name": "Claude Opus"})
        small = DardcorV1Provider._max_model_score("Groq", {"id": "llama-3.1-8b-instant", "name": "8B"})
        self.assertGreater(opus, small)

    def test_max_candidates_keep_registry_provider_names(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        candidates = DardcorV1Provider()._candidate_models(max_mode=True, states={"OpenRouter": True})
        self.assertTrue(any(provider == "OpenRouter" for provider, _base, _model in candidates))

    def test_max_candidates_pick_one_best_model_per_provider(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        candidates = DardcorV1Provider()._candidate_models(max_mode=True, states={"Groq": True})
        groq_models = [model for provider, _base, model in candidates if provider == "Groq"]
        self.assertEqual(len(groq_models), 1)

    def test_keyless_provider_detection(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        provider = DardcorV1Provider()
        self.assertTrue(provider._is_keyless_provider({"tier": "Free"}))
        self.assertFalse(provider._is_keyless_provider({"tier": "Paid"}))

    def test_max_response_dedupes_repeated_content(self):
        from dardcor_agent.models.providers.dardcor.provider import DardcorV1Provider

        provider = DardcorV1Provider()
        block = "Hello from Dardcor MAX.\n\nI can inspect, edit, run tests, and verify your app."
        self.assertEqual(provider._dedupe_response_text(block + block), block)

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
