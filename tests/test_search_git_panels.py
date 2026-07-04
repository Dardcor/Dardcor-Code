"""Focused tests for search path matching."""

import os
import tempfile
import unittest

from pydardcor.core.filesystem import FileSystem


class TestSearchPathPatterns(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self._fs = FileSystem()
        src_dir = os.path.join(self._tmp, "src")
        tests_dir = os.path.join(self._tmp, "tests")
        os.makedirs(src_dir)
        os.makedirs(tests_dir)
        with open(os.path.join(src_dir, "app.py"), "w", encoding="utf-8") as handle:
            handle.write("hello world\n")
        with open(os.path.join(tests_dir, "test_app.py"), "w", encoding="utf-8") as handle:
            handle.write("hello tests\n")
        with open(os.path.join(self._tmp, "readme.md"), "w", encoding="utf-8") as handle:
            handle.write("hello docs\n")

    def test_grep_respects_folder_include_pattern(self):
        results = self._fs.grep("hello", self._tmp, file_pattern="src/**")
        files = {os.path.basename(r["file"]) for r in results}
        self.assertEqual(files, {"app.py"})

    def test_grep_respects_exclude_pattern(self):
        results = self._fs.grep("hello", self._tmp, exclude_pattern="tests/**")
        files = {os.path.basename(r["file"]) for r in results}
        self.assertIn("app.py", files)
        self.assertIn("readme.md", files)
        self.assertNotIn("test_app.py", files)

    def test_match_path_patterns_supports_filename_glob(self):
        self.assertTrue(
            self._fs._match_path_patterns("src/app.py", "*.py", self._tmp)
        )
        self.assertFalse(
            self._fs._match_path_patterns("readme.md", "*.py", self._tmp)
        )

if __name__ == "__main__":
    unittest.main()
