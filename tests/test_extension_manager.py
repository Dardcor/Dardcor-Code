"""Tests for the global extension system."""

import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from pydardcor.core.config import ensure_user_dirs, get_extensions_dir, get_global_home_dir
from pydardcor.core.extension_manager import ExtensionManager, SOURCE_VSCODE


class TestUserDirs(unittest.TestCase):
    def test_ensure_user_dirs_creates_structure(self):
        home = ensure_user_dirs()
        self.assertTrue(os.path.isdir(home))
        self.assertTrue(os.path.isdir(get_extensions_dir()))
        self.assertTrue(os.path.isfile(os.path.join(get_extensions_dir(), "extensions.json")))
        self.assertEqual(home, get_global_home_dir())


class TestExtensionManager(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._ext_dir = os.path.join(self._tmp, "extensions")
        os.makedirs(self._ext_dir, exist_ok=True)
        self._state_file = os.path.join(self._ext_dir, "extensions.json")
        with open(self._state_file, "w", encoding="utf-8") as f:
            json.dump({"disabled": [], "meta": {}}, f)

        patcher = patch("pydardcor.core.extension_manager.EXTENSIONS_DIR", self._ext_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

        state_patcher = patch("pydardcor.core.extension_manager.STATE_FILE", self._state_file)
        state_patcher.start()
        self.addCleanup(state_patcher.stop)

        self.mgr = ExtensionManager()

    def _make_vsix(self, manifest: dict) -> str:
        vsix_path = os.path.join(self._tmp, "test.vsix")
        with zipfile.ZipFile(vsix_path, "w") as zf:
            zf.writestr(
                "extension/package.json",
                json.dumps(manifest),
            )
            zf.writestr("extension/extension.py", "def activate(api): pass\n")
        return vsix_path

    def test_install_folder_uses_vscode_naming(self):
        manifest = {
            "name": "hello-world",
            "publisher": "acme",
            "version": "1.2.3",
            "displayName": "Hello",
            "main": "extension.py",
        }
        ext = self.mgr.install_from_vsix(self._make_vsix(manifest))
        self.assertEqual(ext.name, "hello-world")
        self.assertTrue(ext.path.endswith(os.path.join("acme.hello-world-1.2.3")))
        self.assertTrue(os.path.isdir(ext.path))

    def test_toggle_persists_disabled_state(self):
        manifest = {
            "name": "persist-test",
            "publisher": "test",
            "version": "1.0.0",
            "main": "extension.py",
        }
        self.mgr.install_from_vsix(self._make_vsix(manifest))
        self.mgr.toggle_extension("persist-test", False)

        mgr2 = ExtensionManager()
        ext = next(e for e in mgr2.get_installed_extensions() if e.name == "persist-test")
        self.assertFalse(ext.enabled)

    def test_search_vscode_marketplace_returns_results(self):
        results = self.mgr.search_vscode_marketplace("python", limit=3)
        if not results:
            self.skipTest("VS Code Marketplace unreachable")
        self.assertGreater(len(results), 0)
        self.assertIn("id", results[0])
        self.assertEqual(results[0].get("source"), SOURCE_VSCODE)

    def test_builtin_welcome_extension_discovered(self):
        names = {e.name for e in self.mgr.get_installed_extensions()}
        self.assertIn("dardcor-welcome", names)

    def test_nls_display_name_resolved_from_package_nls(self):
        ext_folder = os.path.join(self._ext_dir, "testco.cool-ext-1.0.0")
        os.makedirs(ext_folder, exist_ok=True)
        with open(os.path.join(ext_folder, "package.json"), "w", encoding="utf-8") as f:
            json.dump({
                "name": "cool-ext",
                "publisher": "testco",
                "version": "1.0.0",
                "displayName": "%displayName%",
                "description": "%description%",
                "main": "extension.py",
            }, f)
        with open(os.path.join(ext_folder, "package.nls.json"), "w", encoding="utf-8") as f:
            json.dump({
                "displayName": "My Cool Ext",
                "description": "A localized description.",
            }, f)
        with open(os.path.join(ext_folder, "extension.py"), "w", encoding="utf-8") as f:
            f.write("def activate(api): pass\n")

        mgr = ExtensionManager()
        ext = next(e for e in mgr.get_installed_extensions() if e.name == "cool-ext")
        self.assertEqual(ext.display_name, "My Cool Ext")
        self.assertEqual(ext.description, "A localized description.")

    def test_nls_display_name_resolved_from_vsix(self):
        manifest = {
            "name": "nls-vsix",
            "publisher": "testco",
            "version": "2.0.0",
            "displayName": "%displayName%",
            "description": "%description%",
            "main": "extension.py",
        }
        vsix_path = os.path.join(self._tmp, "nls.vsix")
        with zipfile.ZipFile(vsix_path, "w") as zf:
            zf.writestr("extension/package.json", json.dumps(manifest))
            zf.writestr(
                "extension/package.nls.json",
                json.dumps({"displayName": "VSIX Localized", "description": "From VSIX NLS."}),
            )
            zf.writestr("extension/extension.py", "def activate(api): pass\n")

        ext = self.mgr.install_from_vsix(vsix_path)
        self.assertEqual(ext.display_name, "VSIX Localized")
        self.assertEqual(ext.description, "From VSIX NLS.")

    def test_nls_missing_key_falls_back_to_extension_name(self):
        ext_folder = os.path.join(self._ext_dir, "testco.fallback-ext-1.0.0")
        os.makedirs(ext_folder, exist_ok=True)
        with open(os.path.join(ext_folder, "package.json"), "w", encoding="utf-8") as f:
            json.dump({
                "name": "fallback-ext",
                "publisher": "testco",
                "version": "1.0.0",
                "displayName": "%displayName%",
                "main": "extension.py",
            }, f)
        with open(os.path.join(ext_folder, "extension.py"), "w", encoding="utf-8") as f:
            f.write("def activate(api): pass\n")

        mgr = ExtensionManager()
        ext = next(e for e in mgr.get_installed_extensions() if e.name == "fallback-ext")
        self.assertEqual(ext.display_name, "fallback-ext")
        self.assertNotIn("%", ext.display_name)


if __name__ == "__main__":
    unittest.main()
