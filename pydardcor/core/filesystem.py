"""Filesystem operations for Dardcor Code."""

import os
import re
import fnmatch
import glob as _glob
from typing import List, Dict, Any, Optional


# Binary file extensions to skip
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
    ".mp3", ".mp4", ".wav", ".avi", ".mkv", ".mov", ".flv",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".class",
    ".pyc", ".pyo", ".whl", ".egg",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".ttf", ".otf", ".woff", ".woff2", ".eot",
    ".db", ".sqlite", ".sqlite3",
}

# Directories to always skip
SKIP_DIRS = {
    ".git", ".svn", ".hg", "__pycache__", "node_modules", ".venv", "venv",
    ".env", "env", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "dist", "build", ".eggs", "*.egg-info", ".next", ".nuxt",
    "target", "bin", "obj", ".idea", ".vs",
}


def should_skip_dir(dirname: str) -> bool:
    if dirname.startswith("."):
        return True
    return dirname in SKIP_DIRS or any(fnmatch.fnmatch(dirname, p) for p in SKIP_DIRS)


def is_binary(filepath: str) -> bool:
    ext = os.path.splitext(filepath)[1].lower()
    return ext in BINARY_EXTENSIONS


class FileSystem:
    """Filesystem operations: read, write, list, search, grep."""

    def read_file(self, path: str, encoding: str = "utf-8") -> str:
        with open(path, "r", encoding=encoding, errors="replace") as f:
            return f.read()

    def write_file(self, path: str, content: str, encoding: str = "utf-8"):
        dir_name = os.path.dirname(path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        with open(path, "w", encoding=encoding) as f:
            f.write(content)

    def list_dir(self, path: str, recursive: bool = False) -> List[str]:
        results = []
        if not recursive:
            try:
                for entry in sorted(os.listdir(path)):
                    full = os.path.join(path, entry)
                    results.append(full)
            except (PermissionError, OSError):
                pass
            return results

        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if not should_skip_dir(d)]
            for f in sorted(files):
                results.append(os.path.join(root, f))
        return results

    def glob_files(self, pattern: str, root: str) -> List[str]:
        results = _glob.glob(os.path.join(root, pattern), recursive=True)
        return sorted(results)

    def _match_path_patterns(self, relative_path: str, patterns: str, root: str) -> bool:
        if not patterns:
            return False
        normalized = relative_path.replace(os.sep, "/")
        filename = os.path.basename(normalized)
        for raw in re.split(r"[,;]", patterns):
            pattern = raw.strip().replace("\\", "/")
            if not pattern:
                continue
            if os.path.isabs(pattern):
                try:
                    pattern = os.path.relpath(pattern, root).replace(os.sep, "/")
                except ValueError:
                    continue
            if pattern.endswith("/"):
                pattern += "**"
            if "/" not in pattern:
                if fnmatch.fnmatch(filename, pattern) or fnmatch.fnmatch(normalized, pattern):
                    return True
                continue
            if fnmatch.fnmatch(normalized, pattern):
                return True
            if pattern.endswith("/**") and normalized.startswith(pattern[:-3]):
                return True
        return False

    def grep(
        self,
        query: str,
        root: str,
        case_sensitive: bool = False,
        is_regex: bool = False,
        whole_word: bool = False,
        max_results: int = 500,
        file_pattern: str = None,
        exclude_pattern: str = None,
    ) -> List[Dict[str, Any]]:
        """Search file contents for a query string."""
        results = []
        flags = 0 if case_sensitive else re.IGNORECASE

        try:
            if not is_regex:
                query = re.escape(query)
            if whole_word:
                query = rf"\b{query}\b"
            pattern = re.compile(query, flags)
        except re.error:
            return results

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]

            for filename in filenames:
                if is_binary(filename):
                    continue
                filepath = os.path.join(dirpath, filename)
                relative = os.path.relpath(filepath, root)
                if file_pattern and not self._match_path_patterns(relative, file_pattern, root):
                    continue
                if exclude_pattern and self._match_path_patterns(relative, exclude_pattern, root):
                    continue

                try:
                    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                        for line_num, line in enumerate(f, 1):
                            if pattern.search(line):
                                results.append({
                                    "file": filepath,
                                    "line": line_num,
                                    "content": line.rstrip("\n\r"),
                                    "relative": relative,
                                })
                                if len(results) >= max_results:
                                    return results
                except (PermissionError, OSError, UnicodeDecodeError):
                    continue

        return results

    def find_files(self, name_pattern: str, root: str, max_results: int = 200) -> List[str]:
        """Find files by name pattern (glob-style)."""
        results = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]
            for filename in filenames:
                if fnmatch.fnmatch(filename.lower(), name_pattern.lower()):
                    results.append(os.path.join(dirpath, filename))
                    if len(results) >= max_results:
                        return results
        return results

    def file_info(self, path: str) -> Dict[str, Any]:
        stat = os.stat(path)
        return {
            "path": path,
            "name": os.path.basename(path),
            "size": stat.st_size,
            "is_dir": os.path.isdir(path),
            "is_file": os.path.isfile(path),
            "modified": stat.st_mtime,
        }


def parse_python_symbols(content: str) -> list:
    """Parse Python source code and return a tree of symbols (classes, functions)."""
    import ast
    try:
        tree = ast.parse(content)
    except Exception:
        return []

    symbols = []

    def get_symbols(node, parent_list):
        if not hasattr(node, 'body'):
            return
        for child in node.body:
            if isinstance(child, ast.ClassDef):
                sym = {
                    'name': child.name,
                    'type': 'class',
                    'line': child.lineno,
                    'children': []
                }
                parent_list.append(sym)
                get_symbols(child, sym['children'])
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                sym = {
                    'name': child.name,
                    'type': 'function',
                    'line': child.lineno,
                    'children': []
                }
                parent_list.append(sym)
                # Parse methods or inner functions
                get_symbols(child, sym['children'])

    get_symbols(tree, symbols)
    return symbols
