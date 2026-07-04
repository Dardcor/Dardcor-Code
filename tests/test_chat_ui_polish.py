"""Focused checks for Dardcor chat UI polish."""

import os
import py_compile
import re
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PANEL_PATH = os.path.join(ROOT, "dardcor_agent", "chat", "panel.py")
IDENTITY_PATH = os.path.join(ROOT, "dardcor_agent", "chat", "identity.py")
CHAT_JS_PATH = os.path.join(ROOT, "script", "script", "chat.js")
CHAT_CSS_PATH = os.path.join(ROOT, "script", "css", "chat.css")
CHAT_HTML_PATH = os.path.join(ROOT, "script", "index", "chat.html")

INDONESIAN_UI_MARKERS = [
    "Tidak Ada",
    "Perintah",
    "Silakan",
    "Kemampuan",
    "Kegunaan",
    "Membaca",
    "Mengedit",
    "Mencari",
    "Menjalankan",
    "Direktori",
    "Cabang Aktif",
    "Konfigurasi Editor",
    "Belum diatur",
    "Nonaktif",
    "tidak dikenali",
]


class TestChatUiPolish(unittest.TestCase):
    def test_chat_sources_compile(self):
        py_compile.compile(PANEL_PATH, doraise=True)
        py_compile.compile(IDENTITY_PATH, doraise=True)

    def test_panel_slash_help_is_english_only(self):
        with open(PANEL_PATH, encoding="utf-8") as handle:
            source = handle.read()

        self.assertIn("Dardcor Slash Commands", source)
        self.assertIn('attach_menu.addAction("Add File"', source)
        self.assertIn('attach_menu.addAction("Add Folder"', source)
        self.assertIn("def get_chat_mode(self)", source)

        for marker in INDONESIAN_UI_MARKERS:
            self.assertNotIn(marker, source, msg=f"Found Indonesian UI marker: {marker}")

    def test_identity_prompt_has_no_indonesian_typo(self):
        from dardcor_agent.chat.identity import get_identity_prompt

        prompt = get_identity_prompt()
        self.assertNotIn("dan confirm", prompt)
        self.assertIn("and confirm it runs successfully", prompt)

    def test_chat_js_thought_and_activity_labels(self):
        with open(CHAT_JS_PATH, encoding="utf-8") as handle:
            source = handle.read()

        self.assertIn("<summary><span>Thoughts</span></summary>", source)
        self.assertNotIn("Agent is thinking", source)
        self.assertIn("function settleCurrentWorkPanel()", source)
        self.assertIn("return 'Edit';", source)
        self.assertIn("return 'Run';", source)

    def test_chat_css_has_compact_tool_rows(self):
        with open(CHAT_CSS_PATH, encoding="utf-8") as handle:
            source = handle.read()

        self.assertIn(".tool-header {", source)
        self.assertIn("font-size: 11px;", source)
        self.assertIn(".thought-block", source)
        self.assertIn("padding: 0 4px;", source)

    def test_chat_html_typing_label(self):
        with open(CHAT_HTML_PATH, encoding="utf-8") as handle:
            source = handle.read()

        self.assertIn('id="typing-text">Thinking</span>', source)


if __name__ == "__main__":
    unittest.main()
