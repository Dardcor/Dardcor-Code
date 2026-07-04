import json
import os
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


class _Config:
    file_icon_theme = ""

    def save(self):
        pass


class TestIconThemeManager(unittest.TestCase):
    def setUp(self):
        from pydardcor.core import icon_theme_manager as itm

        itm._SVG_ICON_CACHE.clear()
        itm._instance = None
        self._tmp = tempfile.mkdtemp()
        self._ext = os.path.join(self._tmp, "publisher.theme-1.0.0")
        os.makedirs(os.path.join(self._ext, "icons"), exist_ok=True)
        with open(os.path.join(self._ext, "package.json"), "w", encoding="utf-8") as f:
            json.dump({}, f)
        with open(os.path.join(self._ext, "theme-a.json"), "w", encoding="utf-8") as f:
            json.dump({
                "iconDefinitions": {
                    "_bad_ts": {"fontCharacter": "\\ue001"},
                    "_file": {"iconPath": "./icons/file.svg"},
                },
                "fileExtensions": {"ts": "_bad_ts"},
                "file": "_file",
            }, f)
        with open(os.path.join(self._ext, "theme-b.json"), "w", encoding="utf-8") as f:
            json.dump({"iconDefinitions": {}, "file": ""}, f)
        with open(os.path.join(self._ext, "icons", "file.svg"), "w", encoding="utf-8") as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _make_manager(self):
        from pydardcor.core.icon_theme_manager import IconThemeManager

        ext = SimpleNamespace(
            enabled=True,
            path=self._ext,
            name="theme",
            display_name="Theme Pack",
            manifest={
                "contributes": {
                    "iconThemes": [
                        {"id": "theme-a", "label": "Theme A", "path": "theme-a.json"},
                        {"id": "theme-b", "label": "Theme B", "path": "theme-b.json"},
                    ]
                }
            },
        )
        mgr_obj = SimpleNamespace(get_installed_extensions=lambda: [ext])

        with patch("pydardcor.core.extension_manager.get_extension_manager", return_value=mgr_obj), \
             patch("pydardcor.core.config.get_config", return_value=_Config()):
            return IconThemeManager()

    def test_discovers_multiple_icon_themes(self):
        mgr = self._make_manager()
        self.assertEqual([t["id"] for t in mgr.available_themes()], ["theme-a", "theme-b"])

    def test_file_icon_falls_back_to_default_file_definition(self):
        mgr = self._make_manager()
        self.assertIsNotNone(mgr.file_icon("readme.unknown"))
        self.assertIsNotNone(mgr.file_icon("demo.ts"))


class TestExtensionIconHelpers(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def test_installed_icon_path_resolves_manifest_icon(self):
        from pydardcor.ui_shared.extension_icons import installed_extension_icon_path

        os.makedirs(os.path.join(self._tmp, "resources"), exist_ok=True)
        icon = os.path.join(self._tmp, "resources", "icon.svg")
        with open(icon, "w", encoding="utf-8") as f:
            f.write("<svg></svg>")

        self.assertEqual(
            installed_extension_icon_path(self._tmp, {"icon": "resources/icon.svg"}),
            icon,
        )

    def test_installed_icon_path_returns_none_when_manifest_icon_missing(self):
        from pydardcor.ui_shared.extension_icons import installed_extension_icon_path

        self.assertIsNone(installed_extension_icon_path(self._tmp, {"icon": "missing.svg"}))

    def test_label_setup_enables_elide_and_tooltip(self):
        from PySide6.QtCore import Qt
        from PySide6.QtWidgets import QApplication, QLabel, QSizePolicy
        from pydardcor.ui_shared.extensions_panel import configure_elided_label

        app = QApplication.instance() or QApplication([])
        label = QLabel()
        configure_elided_label(label, "Very Long Extension Name")

        self.assertEqual(label.text(), "Very Long Extension Name")
        self.assertEqual(label.toolTip(), "Very Long Extension Name")
        self.assertEqual(label.textInteractionFlags(), Qt.NoTextInteraction)
        self.assertEqual(label.property("_full_text"), "Very Long Extension Name")
        self.assertEqual(label.sizePolicy().horizontalPolicy(), QSizePolicy.Policy.Ignored)
        _ = app


if __name__ == "__main__":
    unittest.main()
