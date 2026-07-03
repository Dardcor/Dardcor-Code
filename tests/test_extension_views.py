"""Tests for extension view containers + TreeDataProvider (Node host)."""

import json
import os
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch


TREE_EXT_JS = r"""
const vscode = require("vscode");
function activate(context) {
  const items = [
    { key: "alpha", label: "Alpha" },
    { key: "beta", label: "Beta" },
  ];
  const provider = {
    getChildren(el) {
      if (!el) return items;
      if (el.key === "alpha") return [{ key: "alpha-child", label: "Alpha Child" }];
      return [];
    },
    getTreeItem(el) {
      return {
        label: el.label,
        collapsibleState: el.key === "alpha" ? 1 : 0,
        command: { command: "myext.open", title: "Open", arguments: [el.key] },
      };
    },
  };
  vscode.window.registerTreeDataProvider("myextView", provider);
}
function deactivate() {}
module.exports = { activate, deactivate };
"""

MANIFEST = {
    "name": "myext",
    "publisher": "test",
    "version": "1.0.0",
    "displayName": "My Ext",
    "main": "extension.js",
    "contributes": {
        "viewsContainers": {
            "activitybar": [
                {"id": "myext-container", "title": "My Ext", "icon": "icon.svg"}
            ]
        },
        "views": {
            "myext-container": [
                {"id": "myextView", "name": "My Tree"}
            ]
        },
    },
}


class TestViewContainerParsing(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._ext_dir = os.path.join(self._tmp, "extensions")
        ext = os.path.join(self._ext_dir, "test.myext-1.0.0")
        os.makedirs(ext, exist_ok=True)
        with open(os.path.join(ext, "package.json"), "w", encoding="utf-8") as f:
            json.dump(MANIFEST, f)
        with open(os.path.join(ext, "icon.svg"), "w", encoding="utf-8") as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24"/></svg>')
        with open(os.path.join(ext, "extension.js"), "w", encoding="utf-8") as f:
            f.write(TREE_EXT_JS)
        self._ext_path = ext

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

    def test_parse_view_containers(self):
        from pydardcor.core.extension_manager import ExtensionManager
        from pydardcor.core.extension_contributions import ContributionParser

        mgr = ExtensionManager()
        with patch("pydardcor.core.extension_manager.get_extension_manager", return_value=mgr):
            parser = ContributionParser()
            containers = parser.get_activitybar_containers()

        self.assertEqual(len(containers), 1)
        c = containers[0]
        self.assertEqual(c["container"].id, "myext-container")
        self.assertEqual(c["container"].title, "My Ext")
        self.assertTrue(c["container"].icon.endswith("icon.svg"))
        self.assertEqual(len(c["views"]), 1)
        self.assertEqual(c["views"][0].id, "myextView")

    def test_node_tree_data_provider(self):
        import shutil as _sh
        if _sh.which("node") is None:
            self.skipTest("node not installed")

        from pydardcor.core.extension_host import NodeExtensionHost

        host = NodeExtensionHost()
        host.start("")
        # Give the host a moment to become ready
        for _ in range(50):
            if host._ready:
                break
            time.sleep(0.1)
        self.assertTrue(host._ready, "extension host did not start")

        try:
            result = host.load_extension(self._ext_path)
            self.assertIsNotNone(result)

            roots = host.get_tree_children("myextView", None)
            labels = [r["label"] for r in roots]
            self.assertIn("Alpha", labels)
            self.assertIn("Beta", labels)

            alpha = next(r for r in roots if r["label"] == "Alpha")
            self.assertEqual(alpha["collapsibleState"], 1)
            self.assertEqual(alpha["command"]["command"], "myext.open")

            children = host.get_tree_children("myextView", alpha["id"])
            self.assertEqual(len(children), 1)
            self.assertEqual(children[0]["label"], "Alpha Child")
        finally:
            host.stop()


if __name__ == "__main__":
    unittest.main()
