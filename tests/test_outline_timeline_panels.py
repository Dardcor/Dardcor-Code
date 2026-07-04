"""Tests for Outline and Timeline explorer panels."""

import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from pydardcor.file_explorer.outline_panel import parse_outline_symbols


class TestParseOutlineSymbols(unittest.TestCase):
    def test_python_nested_symbols(self):
        content = (
            "class Widget:\n"
            "    def render(self):\n"
            "        pass\n"
            "\n"
            "def main():\n"
            "    pass\n"
        )
        symbols = parse_outline_symbols(content, "widget.py")
        names = [s["name"] for s in symbols]
        self.assertIn("Widget", names)
        self.assertIn("main", names)
        widget = next(s for s in symbols if s["name"] == "Widget")
        self.assertEqual(widget["children"][0]["name"], "render")

    def test_javascript_symbols(self):
        content = (
            "export class App {}\n"
            "export function init() {}\n"
            "const run = () => {}\n"
        )
        symbols = parse_outline_symbols(content, "app.ts")
        names = [s["name"] for s in symbols]
        self.assertIn("App", names)
        self.assertIn("init", names)
        self.assertIn("run", names)

    def test_vue_symbols(self):
        content = (
            "<template>\n"
            "  <MyCard />\n"
            "</template>\n"
            "<script>\n"
            "export function setup() {}\n"
            "</script>\n"
        )
        symbols = parse_outline_symbols(content, "Panel.vue")
        names = [s["name"] for s in symbols]
        self.assertIn("MyCard", names)
        self.assertIn("setup", names)

    def test_text_fallback_markdown(self):
        content = "# Intro\n\nSome text\n## Details\n"
        symbols = parse_outline_symbols(content, "notes.txt")
        names = [s["name"] for s in symbols]
        self.assertEqual(names, ["Intro", "Details"])

    def test_python_syntax_error_falls_back_to_text(self):
        content = "# Broken\nclass Oops(\n"
        symbols = parse_outline_symbols(content, "broken.py")
        names = [s["name"] for s in symbols]
        self.assertIn("Broken", names)


class TestTimelinePanel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._env_patch = patch.dict(os.environ, {"QT_QPA_PLATFORM": "offscreen"}, clear=False)
        cls._env_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls._env_patch.stop()

    def test_update_timeline_shows_git_and_mtime(self):
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])

        from pydardcor.file_explorer.timeline_panel import TimelinePanel

        with tempfile.TemporaryDirectory() as tmp:
            repo = os.path.join(tmp, "repo")
            os.makedirs(repo)
            subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)
            subprocess.run(
                ["git", "config", "user.email", "test@example.com"],
                cwd=repo,
                capture_output=True,
                check=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test User"],
                cwd=repo,
                capture_output=True,
                check=True,
            )

            file_path = os.path.join(repo, "sample.py")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write("print('one')\n")
            subprocess.run(["git", "add", "sample.py"], cwd=repo, capture_output=True, check=True)
            subprocess.run(
                ["git", "commit", "-m", "Initial commit"],
                cwd=repo,
                capture_output=True,
                check=True,
            )

            with open(file_path, "a", encoding="utf-8") as f:
                f.write("print('two')\n")

            panel = TimelinePanel()
            panel.update_timeline(file_path)

            labels = [panel._tree.topLevelItem(i).text(0) for i in range(panel._tree.topLevelItemCount())]
            joined = "\n".join(labels)
            self.assertIn("Working tree", joined)
            self.assertIn("Initial commit", joined)

    def test_update_timeline_empty_path(self):
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])

        from pydardcor.file_explorer.timeline_panel import TimelinePanel

        panel = TimelinePanel()
        panel.update_timeline("")
        self.assertEqual(panel._tree.topLevelItem(0).text(0), "No active file")


class TestOutlinePanelWidget(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._env_patch = patch.dict(os.environ, {"QT_QPA_PLATFORM": "offscreen"}, clear=False)
        cls._env_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls._env_patch.stop()

    def test_set_symbols_populates_tree(self):
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])

        from pydardcor.file_explorer.outline_panel import OutlinePanel

        panel = OutlinePanel()
        panel.set_symbols([
            {"name": "Alpha", "type": "class", "line": 1, "children": [
                {"name": "beta", "type": "method", "line": 2, "children": []},
            ]},
        ])
        self.assertEqual(panel._tree.topLevelItemCount(), 1)
        self.assertIn("Alpha", panel._tree.topLevelItem(0).text(0))
        self.assertEqual(panel._tree.topLevelItem(0).childCount(), 1)


if __name__ == "__main__":
    unittest.main()
