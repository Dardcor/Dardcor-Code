"""Tests for extension detail fetching and version comparison."""

import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from pydardcor.core.extension_manager import ExtensionManager, SOURCE_VSCODE


class TestExtensionVersionCompare(unittest.TestCase):
    def test_compare_versions_ordering(self):
        self.assertEqual(ExtensionManager.compare_versions("1.0.0", "1.0.0"), 0)
        self.assertEqual(ExtensionManager.compare_versions("1.2.3", "1.2.10"), -1)
        self.assertEqual(ExtensionManager.compare_versions("2.0.0", "1.9.9"), 1)
        self.assertEqual(ExtensionManager.compare_versions("1.0", "1.0.1"), -1)


class TestInstalledExtensionDetails(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._ext_dir = os.path.join(self._tmp, "extensions")
        os.makedirs(self._ext_dir, exist_ok=True)
        self._state_file = os.path.join(self._ext_dir, "extensions.json")
        with open(self._state_file, "w", encoding="utf-8") as f:
            json.dump({"disabled": [], "meta": {}}, f)

        self._p1 = patch("pydardcor.core.extension_manager.EXTENSIONS_DIR", self._ext_dir)
        self._p2 = patch("pydardcor.core.extension_manager.STATE_FILE", self._state_file)
        self._p1.start()
        self._p2.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(self._p2.stop)
        self.mgr = ExtensionManager()

    def _install(self, manifest: dict, readme: str = "# Hello", changelog: str = "## v1"):
        folder = os.path.join(self._ext_dir, f"{manifest['publisher']}.{manifest['name']}-{manifest['version']}")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "package.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with open(os.path.join(folder, "README.md"), "w", encoding="utf-8") as f:
            f.write(readme)
        with open(os.path.join(folder, "CHANGELOG.md"), "w", encoding="utf-8") as f:
            f.write(changelog)
        with open(os.path.join(folder, "extension.py"), "w", encoding="utf-8") as f:
            f.write("def activate(api): pass\n")
        self.mgr.reload_extensions()

    def test_get_installed_extension_details_reads_local_files(self):
        manifest = {
            "name": "detail-test",
            "publisher": "acme",
            "version": "1.0.0",
            "displayName": "Detail Test",
            "description": "A test extension",
            "main": "extension.py",
            "categories": ["Other"],
            "license": "MIT",
            "extensionDependencies": ["ms-python.python"],
        }
        self._install(manifest, readme="# Title\n\nBody", changelog="## 1.0.0\n- Initial")
        details = self.mgr.get_installed_extension_details("detail-test")
        self.assertIsNotNone(details)
        self.assertEqual(details["id"], "acme.detail-test")
        self.assertIn("# Title", details["readme"])
        self.assertIn("1.0.0", details["changelog"])
        self.assertIn("ms-python.python", details["dependencies"])
        self.assertEqual(details["license"], "MIT")
        self.assertTrue(details["size"].endswith("B") or "KB" in details["size"])


class TestMarketplaceExtensionDetails(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._ext_dir = os.path.join(self._tmp, "extensions")
        os.makedirs(self._ext_dir, exist_ok=True)
        self._state_file = os.path.join(self._ext_dir, "extensions.json")
        with open(self._state_file, "w", encoding="utf-8") as f:
            json.dump({"disabled": [], "meta": {}}, f)
        self._p1 = patch("pydardcor.core.extension_manager.EXTENSIONS_DIR", self._ext_dir)
        self._p2 = patch("pydardcor.core.extension_manager.STATE_FILE", self._state_file)
        self._p1.start()
        self._p2.start()
        self.addCleanup(self._p1.stop)
        self.addCleanup(self._p2.stop)
        self.mgr = ExtensionManager()

    def test_get_marketplace_extension_details_vscode(self):
        details = self.mgr.get_marketplace_extension_details("ms-python.python", SOURCE_VSCODE)
        if details is None:
            self.skipTest("VS Code Marketplace unreachable")
        self.assertEqual(details["id"], "ms-python.python")
        self.assertTrue(details.get("version"))
        self.assertIn("source", details)
        self.assertEqual(details["source"], SOURCE_VSCODE)


if __name__ == "__main__":
    unittest.main()
