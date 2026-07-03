"""Tests for AppConfig.load() type coercion."""

import json
import os
import tempfile
import unittest
from unittest.mock import patch

from pydardcor.core.config import AppConfig, _coerce_bool, _coerce_config_value


class TestCoerceHelpers(unittest.TestCase):
    def test_coerce_bool_from_strings(self):
        self.assertTrue(_coerce_bool("true", False))
        self.assertTrue(_coerce_bool("TRUE", False))
        self.assertTrue(_coerce_bool("1", False))
        self.assertTrue(_coerce_bool("yes", False))
        self.assertTrue(_coerce_bool("on", False))
        self.assertFalse(_coerce_bool("false", True))
        self.assertFalse(_coerce_bool("FALSE", True))
        self.assertFalse(_coerce_bool("0", True))
        self.assertFalse(_coerce_bool("no", True))
        self.assertFalse(_coerce_bool("off", True))
        self.assertFalse(_coerce_bool("", True))

    def test_coerce_bool_from_numbers(self):
        self.assertTrue(_coerce_bool(1, False))
        self.assertFalse(_coerce_bool(0, True))

    def test_coerce_int_bad_value_falls_back(self):
        self.assertEqual(_coerce_config_value("not-a-number", 13), 13)
        self.assertEqual(_coerce_config_value(None, 4), 4)

    def test_coerce_list_bad_value_falls_back(self):
        self.assertEqual(_coerce_config_value("oops", []), [])
        self.assertEqual(_coerce_config_value(["a.py"], []), ["a.py"])


class TestAppConfigLoad(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._config_file = os.path.join(self._tmp, "config.json")
        self._config_dir = self._tmp

        dir_patcher = patch("pydardcor.core.config.CONFIG_DIR", self._config_dir)
        file_patcher = patch("pydardcor.core.config.CONFIG_FILE", self._config_file)
        dir_patcher.start()
        file_patcher.start()
        self.addCleanup(dir_patcher.stop)
        self.addCleanup(file_patcher.stop)

    def _write_config(self, data: dict) -> None:
        with open(self._config_file, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def test_string_auto_save_coerced_to_bool(self):
        self._write_config({"auto_save": "true"})
        cfg = AppConfig.load()
        self.assertIs(cfg.auto_save, True)
        self.assertIsInstance(cfg.auto_save, bool)

    def test_string_false_auto_save(self):
        self._write_config({"auto_save": "false"})
        cfg = AppConfig.load()
        self.assertIs(cfg.auto_save, False)

    def test_bad_font_size_falls_back_to_default(self):
        self._write_config({"font_size": "large"})
        cfg = AppConfig.load()
        self.assertEqual(cfg.font_size, 13)

    def test_bad_recent_files_falls_back_to_empty_list(self):
        self._write_config({"recent_files": "not-a-list"})
        cfg = AppConfig.load()
        self.assertEqual(cfg.recent_files, [])

    def test_workspace_path_string_preserved(self):
        self._write_config({"workspace_path": "C:/Projects/demo"})
        cfg = AppConfig.load()
        self.assertEqual(cfg.workspace_path, "C:/Projects/demo")


if __name__ == "__main__":
    unittest.main()
