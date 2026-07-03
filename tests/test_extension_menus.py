"""Tests for extension-contributed context menu aggregation."""

import json
import os
import shutil
import tempfile
import unittest
from unittest.mock import patch


MENU_MANIFEST = {
    "name": "menu-ext",
    "publisher": "test",
    "version": "1.0.0",
    "displayName": "Menu Ext",
    "main": "extension.py",
    "contributes": {
        "commands": [
            {"command": "menu-ext.sayHello", "title": "Say Hello", "category": "Menu Ext"},
            {"command": "menu-ext.noTitle"},
        ],
        "menus": {
            "editor/context": [
                {"command": "menu-ext.sayHello", "group": "navigation@1", "when": "editorTextFocus"},
                {"command": "menu-ext.noTitle", "group": "navigation@2"},
                {"submenu": "menu-ext.sub", "group": "navigation"},
            ],
            "explorer/context": [
                {"command": "menu-ext.sayHello", "group": "2_workspace@1"},
            ],
        },
    },
}


class TestExtensionMenuItems(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._ext_dir = os.path.join(self._tmp, "extensions")
        ext = os.path.join(self._ext_dir, "test.menu-ext-1.0.0")
        os.makedirs(ext, exist_ok=True)
        with open(os.path.join(ext, "package.json"), "w", encoding="utf-8") as f:
            json.dump(MENU_MANIFEST, f)
        with open(os.path.join(ext, "extension.py"), "w", encoding="utf-8") as f:
            f.write("def activate(api): pass\n")

        state_file = os.path.join(self._ext_dir, "extensions.json")
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump({"disabled": [], "meta": {}}, f)

        self._p1 = patch("pydardcor.core.extension_manager.EXTENSIONS_DIR", self._ext_dir)
        self._p2 = patch("pydardcor.core.extension_manager.STATE_FILE", state_file)
        self._p1.start()
        self._p2.start()

    def tearDown(self):
        self._p1.stop()
        self._p2.stop()
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_get_menu_items_editor_context(self):
        from pydardcor.core.extension_manager import ExtensionManager
        from pydardcor.core.extension_contributions import ContributionParser

        mgr = ExtensionManager()
        with patch("pydardcor.core.extension_manager.get_extension_manager", return_value=mgr):
            parser = ContributionParser()
            items = parser.get_menu_items("editor/context")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].command, "menu-ext.sayHello")
        self.assertEqual(items[0].label, "Menu Ext: Say Hello")
        self.assertEqual(items[0].group, "navigation")
        self.assertEqual(items[0].order, 1.0)

    def test_get_menu_items_excludes_disabled(self):
        from pydardcor.core.extension_manager import ExtensionManager
        from pydardcor.core.extension_contributions import ContributionParser

        mgr = ExtensionManager()
        mgr.toggle_extension("menu-ext", False)
        with patch("pydardcor.core.extension_manager.get_extension_manager", return_value=mgr):
            parser = ContributionParser()
            items = parser.get_menu_items("explorer/context")

        self.assertEqual(len(items), 0)

    def test_get_menu_items_explorer_context(self):
        from pydardcor.core.extension_manager import ExtensionManager
        from pydardcor.core.extension_contributions import ContributionParser

        mgr = ExtensionManager()
        with patch("pydardcor.core.extension_manager.get_extension_manager", return_value=mgr):
            parser = ContributionParser()
            items = parser.get_menu_items("explorer/context")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].group, "2_workspace")


class TestMarkdownHtmlBaseHref(unittest.TestCase):
    def test_wrap_html_document_includes_base_href(self):
        from pydardcor.ui_shared.markdown_html import wrap_html_document, markdown_to_html

        body = markdown_to_html("![demo](images/demo.gif)")
        html = wrap_html_document(body, "file:///C:/ext/")
        self.assertIn('<base href="file:///C:/ext/">', html)
        self.assertIn("images/demo.gif", html)
        self.assertIn("background-color: #000000", html)

    def test_markdown_image_preserved_in_output(self):
        from pydardcor.ui_shared.markdown_html import markdown_to_html

        html = markdown_to_html("# Title\n\n![shot](./screenshot.png)")
        self.assertIn("screenshot.png", html)
        self.assertIn("<h1>", html)


if __name__ == "__main__":
    unittest.main()
