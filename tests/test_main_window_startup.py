"""Startup-order guards for MainWindow workspace restore."""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch


class TestOnRootChangedGuards(unittest.TestCase):
    def test_on_root_changed_without_quick_open_does_not_crash(self):
        from pydardcor.app.main_window import MainWindow

        window = MainWindow.__new__(MainWindow)
        window._quick_open = None
        window._quick_open_root = ""
        window._config = MagicMock()
        window._config.workspace_path = ""
        window._config.save = MagicMock()
        window._search_panel = MagicMock()
        window._terminal_panel = MagicMock()
        window._chat_panel = MagicMock()
        window._git_panel = MagicMock()
        window._update_window_title = MagicMock()

        with tempfile.TemporaryDirectory() as tmp:
            MainWindow._on_root_changed(window, tmp)
            self.assertEqual(window._quick_open_root, tmp)
            window._search_panel.set_root.assert_called_once_with(tmp)
            window._git_panel.set_root.assert_called_once_with(tmp)

    def test_on_root_changed_updates_quick_open_when_present(self):
        from pydardcor.app.main_window import MainWindow

        window = MainWindow.__new__(MainWindow)
        window._quick_open = MagicMock()
        window._quick_open_root = ""
        window._config = MagicMock()
        window._config.workspace_path = ""
        window._config.save = MagicMock()
        window._search_panel = MagicMock()
        window._terminal_panel = MagicMock()
        window._chat_panel = MagicMock()
        window._git_panel = MagicMock()
        window._update_window_title = MagicMock()

        with tempfile.TemporaryDirectory() as tmp:
            MainWindow._on_root_changed(window, tmp)
            window._quick_open.set_root.assert_called_once_with(tmp)
            self.assertEqual(window._quick_open._all_files, [])


class TestMainWindowOffscreenStartup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._env_patch = patch.dict(
            os.environ,
            {"QT_QPA_PLATFORM": "offscreen"},
            clear=False,
        )
        cls._env_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls._env_patch.stop()

    def test_main_window_constructs_with_restored_workspace(self):
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])

        from pydardcor.core import config as config_module
        from pydardcor.app.main_window import MainWindow

        with tempfile.TemporaryDirectory() as tmp:
            config_data = {
                "auto_save": "true",
                "workspace_path": tmp,
                "font_size": "oops",
            }
            config_file = os.path.join(tmp, "config.json")
            with open(config_file, "w", encoding="utf-8") as f:
                import json
                json.dump(config_data, f)

            config_dir = tmp
            with patch.object(config_module, "CONFIG_DIR", config_dir), patch.object(
                config_module, "CONFIG_FILE", config_file
            ), patch.object(config_module, "_config_instance", None):
                cfg = config_module.AppConfig.load()
                self.assertIs(cfg.auto_save, True)
                self.assertEqual(cfg.workspace_path, tmp)

                with patch("pydardcor.app.main_window.get_config", return_value=cfg):
                    window = MainWindow()
                    self.assertIsNotNone(window._quick_open)
                    self.assertIs(cfg.auto_save, True)

                    from PySide6.QtCore import QTimer

                    loop = MagicMock()

                    def _after_init():
                        self.assertEqual(window._quick_open_root, tmp)
                        self.assertEqual(window._quick_open._root_path, tmp)
                        loop.done = True

                    QTimer.singleShot(300, _after_init)
                    import time
                    deadline = time.time() + 2.0
                    while not getattr(loop, "done", False) and time.time() < deadline:
                        app.processEvents()
                    self.assertTrue(getattr(loop, "done", False), "init_workspace timer did not run")


if __name__ == "__main__":
    unittest.main()
