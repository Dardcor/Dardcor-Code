import os
import tempfile
import unittest
from unittest.mock import patch


class TestAICapabilities(unittest.TestCase):
    def test_local_embedding_has_stable_dimensions(self):
        from dardcor_agent.capabilities.embeddings import local_embedding

        first = local_embedding("hello world")
        second = local_embedding("hello world")

        self.assertEqual(len(first), 256)
        self.assertEqual(first, second)

    def test_web_fetch_blocks_local_by_default(self):
        from dardcor_agent.capabilities.web import assert_public_url

        with self.assertRaises(ValueError):
            assert_public_url("http://localhost:8000")

    def test_skills_catalog_contains_prompt_efficiency(self):
        from dardcor_agent.capabilities.skills import list_skills

        names = {skill["name"] for skill in list_skills()}
        self.assertIn("prompt-efficiency", names)

    def test_capability_storage_uses_user_data_dir(self):
        from dardcor_agent.capabilities.storage import capability_dir

        with tempfile.TemporaryDirectory() as tmp:
            with patch("pydardcor.core.config.get_user_data_dir", return_value=tmp):
                path = capability_dir("images")
                self.assertTrue(path.startswith(tmp))
                self.assertTrue(os.path.isdir(path))

    def test_agent_exposes_multimodal_tools(self):
        from dardcor_agent.chat.agent import TOOLS

        names = {tool["function"]["name"] for tool in TOOLS}
        self.assertIn("web_search", names)
        self.assertIn("web_fetch", names)
        self.assertIn("create_embedding", names)
        self.assertIn("generate_image", names)
        self.assertIn("speech_to_text", names)
        self.assertIn("text_to_speech", names)
        self.assertIn("list_skills", names)


if __name__ == "__main__":
    unittest.main()
