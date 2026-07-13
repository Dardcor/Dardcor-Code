"""Test Explorer Panel - VS Code style full testing framework."""

import os
import ast
import re
import subprocess
import threading
import time
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Tuple, Set

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTreeWidget, QTreeWidgetItem, QScrollArea, QProgressBar,
    QLineEdit, QMenu, QInputDialog, QMessageBox, QSplitter,
    QFrame, QToolButton, QCheckBox, QComboBox, QPlainTextEdit,
    QHeaderView, QAbstractItemView, QDialog, QDialogButtonBox,
    QFormLayout, QSpinBox
)
from PySide6.QtCore import (
    Qt, Signal, QTimer, QFileSystemWatcher, QSize, QPropertyAnimation,
    Property, QEasingCurve
)
from PySide6.QtGui import (
    QColor, QFont, QIcon, QPainter, QBrush, QPen, QAction,
    QTextCharFormat, QTextCursor
)


TEST_FILE_PATTERNS = [
    "test_*.py", "*_test.py", "test*.py",
]

PYTEST_MARKERS = [
    "pytest", "pytest.fixture", "pytest.mark",
]

UNITTEST_BASE = "unittest.TestCase"


def _is_test_file(filename: str) -> bool:
    name = Path(filename).stem
    for pat in TEST_FILE_PATTERNS:
        if pat.endswith("*"):
            prefix = pat.replace("*", "")
            if name.startswith(prefix):
                return True
        elif pat.startswith("*"):
            suffix = pat.replace("*", "")
            if name.endswith(suffix):
                return True
        else:
            if name == Path(pat).stem:
                return True
    return False


def _parse_test_functions(source: str, module_path: str) -> List[dict]:
    """Parse Python source for test classes and functions using AST."""
    results = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return results

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith("test_"):
            results.append({
                "type": "function",
                "name": node.name,
                "line": node.lineno,
                "file": module_path,
            })
        elif isinstance(node, ast.ClassDef):
            methods = []
            for item in ast.iter_child_nodes(node):
                if isinstance(item, ast.FunctionDef) and item.name.startswith("test_"):
                    methods.append({
                        "type": "method",
                        "name": item.name,
                        "line": item.lineno,
                        "file": module_path,
                        "class_name": node.name,
                    })
            if methods:
                results.append({
                    "type": "class",
                    "name": node.name,
                    "line": node.lineno,
                    "file": module_path,
                    "methods": methods,
                    "has_unittest": any(
                        isinstance(b, ast.Attribute) and b.attr == "TestCase"
                        for base in getattr(node, "bases", [])
                    ) if hasattr(ast, "Attribute") else False,
                })
    return results


def _discover_tests(root_path: str) -> List[dict]:
    """Discover all test files and their tests in a directory tree."""
    if not root_path or not os.path.isdir(root_path):
        return []

    tests = []
    root = Path(root_path)

    for filepath in root.rglob("*.py"):
        if not _is_test_file(filepath.name):
            continue
        ignored = any(part.startswith(".") or part == "__pycache__" or part == "node_modules"
                      for part in filepath.relative_to(root).parts)
        if ignored:
            continue

        try:
            source = filepath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        parsed = _parse_test_functions(source, str(filepath))
        if parsed:
            tests.append({
                "type": "file",
                "name": str(filepath.relative_to(root)),
                "file": str(filepath),
                "items": parsed,
            })

    return tests


def _pytest_colect_tests(root_path: str) -> List[dict]:
    """Use pytest --collect-only for discovery (more accurate)."""
    try:
        kwargs = {}
        if os.name == 'nt':
            kwargs['creationflags'] = 0x08000000
        res = subprocess.run(
            ["pytest", "--collect-only", "-q"],
            cwd=root_path, capture_output=True, text=True,
            timeout=15, **kwargs
        )
        lines = res.stdout.splitlines()
        collected = []
        file_map: Dict[str, dict] = {}

        for line in lines:
            if "::" in line:
                parts = line.split("::")
                file_part = parts[0].strip()
                test_path = parts[-1].strip()
                rel = file_part
                full = os.path.join(root_path, file_part) if not os.path.isabs(file_part) else file_part

                if len(parts) == 2:
                    if rel not in file_map:
                        file_map[rel] = {
                            "type": "file",
                            "name": rel,
                            "file": full,
                            "items": [],
                        }
                    file_map[rel]["items"].append({
                        "type": "function",
                        "name": test_path,
                        "line": 0,
                        "file": full,
                    })
                elif len(parts) >= 3:
                    class_name = parts[1].strip()
                    if rel not in file_map:
                        file_map[rel] = {
                            "type": "file",
                            "name": rel,
                            "file": full,
                            "items": [],
                        }
                    existing_class = None
                    for item in file_map[rel]["items"]:
                        if item["type"] == "class" and item["name"] == class_name:
                            existing_class = item
                            break
                    if existing_class is None:
                        existing_class = {
                            "type": "class",
                            "name": class_name,
                            "line": 0,
                            "file": full,
                            "methods": [],
                            "has_unittest": True,
                        }
                        file_map[rel]["items"].append(existing_class)
                    existing_class["methods"].append({
                        "type": "method",
                        "name": test_path,
                        "line": 0,
                        "file": full,
                        "class_name": class_name,
                    })

        collected = list(file_map.values())
        return collected
    except Exception:
        return []


def _parse_pytest_output(stdout: str, stderr: str) -> Dict[str, List[str]]:
    """Parse pytest output into passed, failed, error, skipped test names."""
    result = {"passed": [], "failed": [], "error": [], "skipped": []}

    for line in stdout.splitlines():
        line_stripped = line.strip()
        if line_stripped.startswith("PASSED"):
            parts = line_stripped.split()
            if len(parts) >= 2:
                result["passed"].append(parts[-1])
        elif line_stripped.startswith("FAILED"):
            parts = line_stripped.split()
            if len(parts) >= 2:
                result["failed"].append(parts[-1])
        elif line_stripped.startswith("ERROR"):
            parts = line_stripped.split()
            if len(parts) >= 2:
                result["error"].append(parts[-1])
        elif "s" in line_stripped and "SKIPPED" in line_stripped:
            parts = line_stripped.split()
            if len(parts) >= 2:
                result["skipped"].append(parts[-1])

    return result


def _find_method_item(file_item: QTreeWidgetItem, test_name: str) -> Optional[QTreeWidgetItem]:
    """Find a tree item by test name (last part after ::)."""
    short = test_name.split("::")[-1].strip()
    for i in range(file_item.childCount()):
        child = file_item.child(i)
        if child.text(0) == short:
            return child
        for j in range(child.childCount()):
            grandchild = child.child(j)
            if grandchild.text(0) == short:
                return grandchild
    return None


_TEST_STYLES = """
QTreeWidget {
    background-color: #000000;
    color: #cccccc;
    border: none;
    outline: none;
    font-size: 12px;
}
QTreeWidget::item {
    padding: 2px 4px;
    border: none;
}
QTreeWidget::item:selected {
    background-color: #1a1a1a;
    color: #ffffff;
}
QTreeWidget::item:hover {
    background-color: #1a0033;
}
QTreeWidget::branch:has-children:!has-siblings:closed,
QTreeWidget::branch:closed:has-children:has-siblings {
    border-image: none;
}
QTreeWidget::branch:open:has-children:!has-siblings,
QTreeWidget::branch:open:has-children:has-siblings {
    border-image: none;
}
"""


class TestOutputPanel(QWidget):
    """Inline test output display panel."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        toolbar = QWidget()
        toolbar.setFixedHeight(28)
        toolbar.setStyleSheet("background: #0a0a0a; border-bottom: 1px solid #2b2b2b;")
        t_lay = QHBoxLayout(toolbar)
        t_lay.setContentsMargins(8, 0, 8, 0)

        title = QLabel("TEST OUTPUT")
        title.setStyleSheet("color: #888888; font-size: 10px; font-weight: 600; letter-spacing: 1px;")
        t_lay.addWidget(title)
        t_lay.addStretch()

        copy_btn = QPushButton("Copy")
        copy_btn.setFixedHeight(20)
        copy_btn.setStyleSheet("""
            QPushButton { background: transparent; border: 1px solid #333; color: #aaa; font-size: 10px; padding: 0 8px; }
            QPushButton:hover { background: #1a1a1a; color: #fff; }
        """)
        copy_btn.clicked.connect(self._copy_output)
        t_lay.addWidget(copy_btn)

        clear_btn = QPushButton("Clear")
        clear_btn.setFixedHeight(20)
        clear_btn.setStyleSheet("""
            QPushButton { background: transparent; border: 1px solid #333; color: #aaa; font-size: 10px; padding: 0 8px; }
            QPushButton:hover { background: #1a1a1a; color: #fff; }
        """)
        clear_btn.clicked.connect(self.clear)
        t_lay.addWidget(clear_btn)

        layout.addWidget(toolbar)

        self._output = QPlainTextEdit()
        self._output.setReadOnly(True)
        self._output.setStyleSheet("""
            QPlainTextEdit {
                background-color: #000000;
                color: #cccccc;
                border: none;
                padding: 4px 8px;
                font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
                font-size: 12px;
                selection-background-color: #264f78;
            }
        """)
        layout.addWidget(self._output)

    def append(self, text: str):
        self._output.appendPlainText(text)
        self._output.moveCursor(QTextCursor.MoveOperation.End)

    def append_html(self, html: str):
        self._output.appendHtml(html)
        self._output.moveCursor(QTextCursor.MoveOperation.End)

    def clear(self):
        self._output.clear()

    def set_text(self, text: str):
        self._output.setPlainText(text)

    def _copy_output(self):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText(self._output.toPlainText())


class TestHistoryDialog(QDialog):
    """Dialog showing test run history."""

    def __init__(self, history: List[dict], parent=None):
        super().__init__(parent)
        self.setWindowTitle("Test History")
        self.setMinimumSize(600, 400)
        self.setStyleSheet("""
            QDialog { background-color: #0d0d0d; color: #cccccc; }
            QLabel { color: #cccccc; }
        """)
        layout = QVBoxLayout(self)

        self._tree = QTreeWidget()
        self._tree.setHeaderLabels(["Time", "Status", "Passed", "Failed", "Duration"])
        self._tree.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: 1px solid #2b2b2b; font-size: 12px; }
            QTreeWidget::item { padding: 3px 6px; }
            QTreeWidget::item:selected { background-color: #1a1a1a; }
        """)
        self._tree.header().setStretchLastSection(True)
        layout.addWidget(self._tree)

        for entry in reversed(history):
            item = QTreeWidgetItem([
                entry.get("time", ""),
                entry.get("status", ""),
                str(entry.get("passed", 0)),
                str(entry.get("failed", 0)),
                entry.get("duration", ""),
            ])
            if entry.get("status") == "PASSED":
                item.setForeground(1, QColor("#73c991"))
            elif entry.get("status") == "FAILED":
                item.setForeground(1, QColor("#f14c4c"))
            else:
                item.setForeground(1, QColor("#e0a020"))
            self._tree.addTopLevelItem(item)

        btn_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        btn_box.rejected.connect(self.reject)
        layout.addWidget(btn_box)


class TestRunProfile:
    """Configuration for a test run profile."""

    def __init__(self, name: str = "Default", pytest_args: str = "", env: str = "",
                 timeout: int = 60, parallel: bool = False):
        self.name = name
        self.pytest_args = pytest_args
        self.env = env
        self.timeout = timeout
        self.parallel = parallel

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "pytest_args": self.pytest_args,
            "env": self.env,
            "timeout": self.timeout,
            "parallel": self.parallel,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TestRunProfile":
        return cls(
            name=d.get("name", "Default"),
            pytest_args=d.get("pytest_args", ""),
            env=d.get("env", ""),
            timeout=d.get("timeout", 60),
            parallel=d.get("parallel", False),
        )


class ProfileDialog(QDialog):
    """Dialog for managing test run profiles."""

    def __init__(self, profiles: List[TestRunProfile], parent=None):
        super().__init__(parent)
        self.setWindowTitle("Test Run Profiles")
        self.setMinimumSize(500, 400)
        self.setStyleSheet("""
            QDialog { background-color: #0d0d0d; color: #cccccc; }
            QLabel { color: #cccccc; }
            QLineEdit, QSpinBox { background: #1a1a1a; color: #ccc; border: 1px solid #333; padding: 3px 6px; }
            QCheckBox { color: #ccc; }
        """)
        self._profiles = profiles
        self._result = profiles[:]
        layout = QVBoxLayout(self)

        self._list = QTreeWidget()
        self._list.setHeaderLabels(["Name", "Args", "Timeout"])
        self._list.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: 1px solid #2b2b2b; font-size: 12px; }
            QTreeWidget::item { padding: 3px 6px; }
            QTreeWidget::item:selected { background-color: #1a1a1a; }
        """)
        self._list.itemClicked.connect(self._on_select)
        layout.addWidget(self._list)

        form = QFormLayout()
        self._name_edit = QLineEdit()
        self._args_edit = QLineEdit()
        self._env_edit = QLineEdit()
        self._timeout_spin = QSpinBox()
        self._timeout_spin.setRange(5, 600)
        self._timeout_spin.setValue(60)
        self._parallel_check = QCheckBox("Run tests in parallel (pytest-xdist)")

        form.addRow("Name:", self._name_edit)
        form.addRow("Pytest args:", self._args_edit)
        form.addRow("Env vars (KEY=VAL;...):", self._env_edit)
        form.addRow("Timeout (s):", self._timeout_spin)
        form.addRow(self._parallel_check)
        layout.addLayout(form)

        btn_row = QHBoxLayout()
        add_btn = QPushButton("Add")
        add_btn.setStyleSheet("QPushButton { background: #1a0033; color: #ccc; border: 1px solid #3c0068; padding: 4px 12px; } QPushButton:hover { background: #2c004a; }")
        add_btn.clicked.connect(self._add_profile)
        btn_row.addWidget(add_btn)

        remove_btn = QPushButton("Remove")
        remove_btn.setStyleSheet("QPushButton { background: #1a0033; color: #ccc; border: 1px solid #3c0068; padding: 4px 12px; } QPushButton:hover { background: #2c004a; }")
        remove_btn.clicked.connect(self._remove_profile)
        btn_row.addWidget(remove_btn)

        btn_row.addStretch()

        save_btn = QPushButton("Save")
        save_btn.setStyleSheet("QPushButton { background: #7c3aed; color: white; border: none; padding: 4px 16px; } QPushButton:hover { background: #6d28d9; }")
        save_btn.clicked.connect(self._save)
        btn_row.addWidget(save_btn)

        cancel_btn = QPushButton("Cancel")
        cancel_btn.setStyleSheet("QPushButton { background: #2a2a2a; color: #ccc; border: 1px solid #444; padding: 4px 12px; } QPushButton:hover { background: #3a3a3a; }")
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)

        layout.addLayout(btn_row)
        self._refresh_list()

    def _refresh_list(self):
        self._list.clear()
        for p in self._profiles:
            item = QTreeWidgetItem([p.name, p.pytest_args, str(p.timeout)])
            item.setData(0, Qt.UserRole, self._profiles.index(p))
            self._list.addTopLevelItem(item)

    def _on_select(self, item, col):
        idx = item.data(0, Qt.UserRole)
        if idx is not None and 0 <= idx < len(self._profiles):
            p = self._profiles[idx]
            self._name_edit.setText(p.name)
            self._args_edit.setText(p.pytest_args)
            self._env_edit.setText(p.env)
            self._timeout_spin.setValue(p.timeout)
            self._parallel_check.setChecked(p.parallel)

    def _add_profile(self):
        name = self._name_edit.text().strip() or f"Profile {len(self._profiles) + 1}"
        p = TestRunProfile(
            name=name,
            pytest_args=self._args_edit.text().strip(),
            env=self._env_edit.text().strip(),
            timeout=self._timeout_spin.value(),
            parallel=self._parallel_check.isChecked(),
        )
        self._profiles.append(p)
        self._refresh_list()

    def _remove_profile(self):
        item = self._list.currentItem()
        if item:
            idx = item.data(0, Qt.UserRole)
            if idx is not None and 0 <= idx < len(self._profiles):
                self._profiles.pop(idx)
                self._refresh_list()

    def _save(self):
        self._result = self._profiles[:]
        self.accept()

    def get_profiles(self) -> List[TestRunProfile]:
        return self._result


class TestPeekWidget(QFrame):
    """Inline peek view showing test definition."""

    def __init__(self, test_info: dict, parent=None):
        super().__init__(parent)
        self.setStyleSheet("""
            TestPeekWidget {
                background-color: #1a1a2e;
                border: 1px solid #3c0068;
                border-radius: 4px;
            }
        """)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)

        header = QLabel(f"Test: {test_info.get('name', '')}")
        header.setStyleSheet("color: #73c991; font-weight: bold; font-size: 12px;")
        layout.addWidget(header)

        file_label = QLabel(f"File: {test_info.get('file', '')}")
        file_label.setStyleSheet("color: #888888; font-size: 11px;")
        layout.addWidget(file_label)

        if test_info.get("line"):
            line_label = QLabel(f"Line: {test_info['line']}")
            line_label.setStyleSheet("color: #888888; font-size: 11px;")
            layout.addWidget(line_label)


class TestRelatedCodePanel(QWidget):
    """Panel showing code related to selected test."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        header = QLabel("RELATED CODE")
        header.setStyleSheet("color: #888888; font-size: 10px; font-weight: 600; padding: 4px 8px; background: #0a0a0a; border-bottom: 1px solid #2b2b2b;")
        layout.addWidget(header)

        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setStyleSheet("""
            QTreeWidget { background-color: #000000; color: #cccccc; border: none; font-size: 12px; }
            QTreeWidget::item { padding: 2px 8px; }
            QTreeWidget::item:hover { background-color: #1a0033; }
        """)
        layout.addWidget(self._tree)

    def show_related(self, test_file: str, test_name: str):
        self._tree.clear()
        if not test_file:
            return

        test_path = Path(test_file)
        source_dir = test_path.parent

        related = QTreeWidgetItem([f"Source: {test_path.name}"])
        related.setForeground(0, QColor("#73c991"))
        self._tree.addTopLevelItem(related)

        imports = QTreeWidgetItem(["Imports:"])
        imports.setForeground(0, QColor("#888888"))

        try:
            source = test_path.read_text(encoding="utf-8", errors="replace")
            tree = ast.parse(source)
            for node in ast.iter_child_nodes(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        QTreeWidgetItem(imports, [f"  import {alias.name}"])
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    for alias in node.names:
                        QTreeWidgetItem(imports, [f"  from {module} import {alias.name}"])
        except Exception:
            QTreeWidgetItem(imports, ["  (parse error)"])

        self._tree.addTopLevelItem(imports)
        imports.setExpanded(True)

    def clear(self):
        self._tree.clear()


class TestExplorerPanel(QWidget):
    """VS Code-style Testing panel with full features."""

    file_open_requested = Signal(str)
    test_status_changed = Signal(int, int, int)  # passed, failed, total
    test_run_started = Signal()
    test_run_finished = Signal()
    debug_test_requested = Signal(str, str)  # file_path, test_name

    def __init__(self, root_path=None, parent=None):
        super().__init__(parent)
        self._root = root_path or os.path.expanduser("~")
        self._tests: List[dict] = []
        self._test_items: Dict[str, QTreeWidgetItem] = {}
        self._is_running = False
        self._current_test = ""
        self._passed = 0
        self._failed = 0
        self._skipped = 0
        self._total = 0
        self._history: List[dict] = []
        self._profiles: List[TestRunProfile] = [TestRunProfile()]
        self._current_profile_idx = 0
        self._continuous_run = False
        self._file_watcher: Optional[QFileSystemWatcher] = None
        self._related_code_panel = TestRelatedCodePanel()
        self._watch_enabled = False
        self._filter_text = ""
        self._sort_mode = "default"

        self._setup_ui()
        self._setup_connections()
        self.refresh_tests()

    def _setup_ui(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # ── Header ──
        header = QWidget()
        header.setFixedHeight(36)
        header.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("TESTING")
        title.setStyleSheet("color: #bbbbbb; font-size: 10px; font-weight: 600; letter-spacing: 1.2px;")
        h_lay.addWidget(title)
        h_lay.addStretch()

        run_all_btn = QPushButton("▶ Run All")
        run_all_btn.setFixedHeight(22)
        run_all_btn.setToolTip("Run All Tests")
        run_all_btn.setStyleSheet("""
            QPushButton { background: #1a0033; border: 1px solid #3c0068; color: #cccccc;
            font-size: 10px; padding: 0 10px; border-radius: 3px; }
            QPushButton:hover { background: #2c004a; color: #ffffff; }
        """)
        run_all_btn.clicked.connect(self.run_all_tests)
        h_lay.addWidget(run_all_btn)

        self._refresh_btn = QPushButton()
        self._refresh_btn.setFixedSize(22, 22)
        self._refresh_btn.setToolTip("Discover Tests")
        self._refresh_btn.setStyleSheet(self._icon_btn())
        self._refresh_btn.setText("↻")
        self._refresh_btn.clicked.connect(self.refresh_tests)
        h_lay.addWidget(self._refresh_btn)

        main_layout.addWidget(header)

        # ── Progress Bar ──
        self._progress = QProgressBar()
        self._progress.setFixedHeight(3)
        self._progress.setRange(0, 100)
        self._progress.setTextVisible(False)
        self._progress.setStyleSheet("""
            QProgressBar {
                background-color: #000000;
                border: none;
            }
            QProgressBar::chunk {
                background-color: #7c3aed;
            }
        """)
        self._progress.hide()
        main_layout.addWidget(self._progress)

        # ── Status / Action Bar ──
        btn_row = QWidget()
        btn_row.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        btn_lay = QHBoxLayout(btn_row)
        btn_lay.setContentsMargins(8, 4, 8, 4)
        btn_lay.setSpacing(6)

        self._status_label = QLabel("  No tests found")
        self._status_label.setStyleSheet("color: #888888; font-size: 11px;")
        btn_lay.addWidget(self._status_label)
        btn_lay.addStretch()

        self._continuous_btn = QPushButton("▶ Loop")
        self._continuous_btn.setFixedHeight(20)
        self._continuous_btn.setToolTip("Continuous Run (auto re-run on changes)")
        self._continuous_btn.setStyleSheet("""
            QPushButton { background: transparent; border: 1px solid #333; color: #888; font-size: 10px; padding: 0 6px; border-radius: 2px; }
            QPushButton:hover { background: #1a1a1a; color: #ccc; }
            QPushButton:checked { background: #1a0033; border-color: #7c3aed; color: #b794f4; }
        """)
        self._continuous_btn.setCheckable(True)
        self._continuous_btn.toggled.connect(self._toggle_continuous_run)
        btn_lay.addWidget(self._continuous_btn)

        self._profile_combo = QComboBox()
        self._profile_combo.setStyleSheet("""
            QComboBox { background: transparent; border: 1px solid #333; color: #888; font-size: 10px; padding: 0 4px; }
            QComboBox::drop-down { border: none; width: 12px; }
            QComboBox:hover { border-color: #555; color: #ccc; }
        """)
        self._profile_combo.currentIndexChanged.connect(self._on_profile_changed)
        btn_lay.addWidget(self._profile_combo)

        history_btn = QPushButton("History")
        history_btn.setFixedHeight(20)
        history_btn.setToolTip("Show Test Run History")
        history_btn.setStyleSheet("""
            QPushButton { background: transparent; border: 1px solid #333; color: #888; font-size: 10px; padding: 0 6px; border-radius: 2px; }
            QPushButton:hover { background: #1a1a1a; color: #ccc; }
        """)
        history_btn.clicked.connect(self._show_history)
        btn_lay.addWidget(history_btn)

        main_layout.addWidget(btn_row)

        # ── Filter / Sort Bar ──
        filter_bar = QWidget()
        filter_bar.setStyleSheet("background-color: #000000; border-bottom: 1px solid #2b2b2b;")
        filter_lay = QHBoxLayout(filter_bar)
        filter_lay.setContentsMargins(8, 2, 8, 2)
        filter_lay.setSpacing(4)

        self._filter_input = QLineEdit()
        self._filter_input.setPlaceholderText("Filter tests...")
        self._filter_input.setStyleSheet("""
            QLineEdit { background: #1a1a1a; color: #aaa; border: 1px solid #333;
            border-radius: 2px; padding: 2px 6px; font-size: 11px; }
            QLineEdit:focus { border-color: #7c3aed; color: #ccc; }
        """)
        self._filter_input.textChanged.connect(self._on_filter_changed)
        filter_lay.addWidget(self._filter_input)

        self._sort_combo = QComboBox()
        self._sort_combo.addItems(["Default", "Name", "File", "Status"])
        self._sort_combo.setStyleSheet("""
            QComboBox { background: transparent; border: 1px solid #333; color: #888; font-size: 10px; padding: 0 4px; }
            QComboBox::drop-down { border: none; width: 12px; }
            QComboBox:hover { border-color: #555; color: #ccc; }
        """)
        self._sort_combo.currentTextChanged.connect(self._on_sort_changed)
        filter_lay.addWidget(self._sort_combo)

        self._watch_check = QCheckBox("Auto-refresh")
        self._watch_check.setStyleSheet("QCheckBox { color: #888; font-size: 10px; spacing: 3px; } QCheckBox::indicator { width: 10px; height: 10px; }")
        self._watch_check.toggled.connect(self._toggle_watch)
        filter_lay.addWidget(self._watch_check)

        main_layout.addWidget(filter_bar)

        # ── Tree + Output splitter ──
        self._splitter = QSplitter(Qt.Orientation.Vertical)
        self._splitter.setStyleSheet("QSplitter::handle { background: #2b2b2b; height: 1px; }")

        # Tree container
        tree_container = QWidget()
        tree_lay = QVBoxLayout(tree_container)
        tree_lay.setContentsMargins(0, 0, 0, 0)
        tree_lay.setSpacing(0)

        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setRootIsDecorated(True)
        self._tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tree.setAnimated(True)
        self._tree.setIndentation(16)
        self._tree.setStyleSheet(_TEST_STYLES)
        self._tree.customContextMenuRequested.connect(self._show_context_menu)
        self._tree.itemClicked.connect(self._on_item_clicked)
        self._tree.itemDoubleClicked.connect(self._on_item_double_clicked)

        tree_lay.addWidget(self._tree)

        self._splitter.addWidget(tree_container)

        # The output panel replaces the bottom part of the splitter
        self._output_panel = TestOutputPanel()
        self._output_panel.hide()
        self._splitter.addWidget(self._output_panel)

        main_layout.addWidget(self._splitter)
        self._splitter.setSizes([400, 150])
        self._splitter.setCollapsible(1, False)

    def _icon_btn(self):
        return """
            QPushButton { background: transparent; border: none; color: #cccccc; font-size: 14px; border-radius: 3px; }
            QPushButton:hover { background: #1a1a1a; }
        """

    def _setup_connections(self):
        pass

    # ── Public API ──

    def set_root(self, path):
        self._root = path
        self.refresh_tests()

    def refresh_tests(self):
        self._status_label.setText("  Discovering tests...")
        self._progress.show()
        self._progress.setValue(10)
        self._tree.clear()
        self._test_items.clear()

        def _discover():
            try:
                collected = _pytest_colect_tests(self._root)
                if not collected:
                    collected = _discover_tests(self._root)
                return collected
            except Exception:
                return _discover_tests(self._root)

        def _on_done(tests):
            self._tests = tests
            self._populate_tree(tests)
            total = self._count_total(tests)
            self._total = total
            self._status_label.setText(f"  {total} tests found")
            self._progress.hide()
            self._setup_file_watcher()

        threading.Thread(
            target=lambda: QTimer.singleShot(0, lambda t=_discover(): _on_done(t)),
            daemon=True
        ).start()

    # ── Test Discovery Helpers ──

    def _count_total(self, tests: List[dict]) -> int:
        count = 0
        for t in tests:
            if t["type"] == "file":
                for item in t.get("items", []):
                    if item["type"] == "class":
                        count += len(item.get("methods", []))
                    else:
                        count += 1
            elif t["type"] == "function":
                count += 1
        return count

    def _populate_tree(self, tests: List[dict]):
        self._tree.clear()
        self._test_items.clear()

        for file_entry in tests:
            if file_entry["type"] != "file":
                continue

            file_item = QTreeWidgetItem()
            file_item.setText(0, f"  {file_entry['name']}")
            file_item.setData(0, Qt.UserRole, {"type": "file", "file": file_entry["file"]})
            file_item.setForeground(0, QColor("#cccccc"))
            font = file_item.font(0)
            font.setBold(True)
            file_item.setFont(0, font)

            for item in file_entry.get("items", []):
                if item["type"] == "class":
                    class_item = QTreeWidgetItem()
                    class_item.setText(0, f"  {item['name']}")
                    class_item.setData(0, Qt.UserRole, {
                        "type": "class",
                        "name": item["name"],
                        "file": item["file"],
                        "line": item["line"],
                    })
                    class_item.setForeground(0, QColor("#dcdcaa"))
                    class_item.setToolTip(0, f"{item['file']}:{item['line']}")

                    for method in item.get("methods", []):
                        method_item = QTreeWidgetItem()
                        method_item.setText(0, f"  {method['name']}")
                        method_item.setData(0, Qt.UserRole, {
                            "type": "method",
                            "name": method["name"],
                            "file": method["file"],
                            "line": method["line"],
                            "class_name": method.get("class_name", ""),
                        })
                        method_item.setForeground(0, QColor("#cccccc"))
                        method_item.setToolTip(0, f"{method['file']}:{method['line']}")
                        key = f"{method['file']}::{method['name']}"
                        self._test_items[key] = method_item
                        class_item.addChild(method_item)

                    file_item.addChild(class_item)
                    key = f"{item['file']}::{item['name']}"
                    self._test_items[key] = class_item

                elif item["type"] == "function":
                    func_item = QTreeWidgetItem()
                    func_item.setText(0, f"  {item['name']}")
                    func_item.setData(0, Qt.UserRole, {
                        "type": "function",
                        "name": item["name"],
                        "file": item["file"],
                        "line": item["line"],
                    })
                    func_item.setForeground(0, QColor("#cccccc"))
                    func_item.setToolTip(0, f"{item['file']}:{item['line']}")
                    key = f"{item['file']}::{item['name']}"
                    self._test_items[key] = func_item
                    file_item.addChild(func_item)

            self._tree.addTopLevelItem(file_item)
            file_item.setExpanded(True)

    # ── Running Tests ──

    def run_all_tests(self):
        if self._is_running:
            return
        self._start_run()
        profile = self._profiles[self._current_profile_idx]
        args = ["pytest"] + (profile.pytest_args.split() if profile.pytest_args else [])
        env = os.environ.copy()
        if profile.env:
            for pair in profile.env.split(";"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    env[k.strip()] = v.strip()

        def _run():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                start = time.time()
                res = subprocess.run(
                    args + ["-v"],
                    cwd=self._root, capture_output=True, text=True,
                    timeout=profile.timeout, env=env, **kwargs
                )
                duration = time.time() - start
                return res.stdout, res.stderr, res.returncode, duration
            except subprocess.TimeoutExpired:
                return "", "Test run timed out", 1, 0
            except Exception as e:
                return "", str(e), 1, 0

        def _on_done(stdout, stderr, rc, duration):
            self._finish_run()
            self._output_panel.show()
            self._splitter.setSizes([300, 250])

            output_text = stdout + "\n" + stderr if stderr else stdout
            self._output_panel.set_text(output_text)

            parsed = _parse_pytest_output(stdout, stderr)
            self._passed = len(parsed["passed"])
            self._failed = len(parsed["failed"]) + len(parsed["error"])
            self._skipped = len(parsed["skipped"])

            status = "PASSED" if rc == 0 else "FAILED"
            self._update_tree_colors(parsed)
            self._update_status_label()

            entry = {
                "time": datetime.now().strftime("%H:%M:%S"),
                "status": status,
                "passed": self._passed,
                "failed": self._failed,
                "skipped": self._skipped,
                "total": self._total,
                "duration": f"{duration:.1f}s",
                "output": output_text[:500],
            }
            self._history.append(entry)
            if len(self._history) > 100:
                self._history = self._history[-100:]

            self.test_status_changed.emit(self._passed, self._failed, self._total)
            self.test_run_finished.emit()

            if self._continuous_run and rc == 1:
                self._continuous_run = False
                self._continuous_btn.setChecked(False)

        threading.Thread(
            target=lambda: QTimer.singleShot(0, lambda res=_run(): _on_done(*res)),
            daemon=True
        ).start()

    def run_test(self, test_key: str):
        if self._is_running:
            return
        if "::" in test_key:
            parts = test_key.split("::")
            file_part = parts[0]
            test_path = "::".join(parts[1:])
        else:
            file_part = ""
            test_path = ""

        rel_file = ""
        if file_part and self._root:
            try:
                rel_file = os.path.relpath(file_part, self._root)
            except ValueError:
                rel_file = file_part

        self._start_run()
        self._current_test = test_key

        def _run():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                cmd = ["pytest", "-v", test_key]
                start = time.time()
                res = subprocess.run(
                    cmd, cwd=self._root, capture_output=True,
                    text=True, timeout=60, **kwargs
                )
                duration = time.time() - start
                return res.stdout, res.stderr, res.returncode, duration
            except subprocess.TimeoutExpired:
                return "", "Test timed out", 1, 0
            except Exception as e:
                return "", str(e), 1, 0

        def _on_done(stdout, stderr, rc, duration):
            self._finish_run()
            output_text = stdout + "\n" + stderr if stderr else stdout
            self._output_panel.show()
            self._splitter.setSizes([300, 250])
            self._output_panel.set_text(output_text)

            parsed = _parse_pytest_output(stdout, stderr)
            self._passed = len(parsed["passed"])
            self._failed = len(parsed["failed"]) + len(parsed["error"])

            status = "PASSED" if rc == 0 else "FAILED"
            self._update_tree_colors(parsed)
            self._update_status_label()

            entry = {
                "time": datetime.now().strftime("%H:%M:%S"),
                "status": status,
                "passed": self._passed,
                "failed": self._failed,
                "skipped": len(parsed["skipped"]),
                "total": 1,
                "duration": f"{duration:.1f}s",
                "output": output_text[:500],
            }
            self._history.append(entry)
            self.test_status_changed.emit(self._passed, self._failed, self._total)
            self.test_run_finished.emit()

        threading.Thread(
            target=lambda: QTimer.singleShot(0, lambda res=_run(): _on_done(*res)),
            daemon=True
        ).start()

    def debug_test(self, test_key: str):
        if "::" in test_key:
            parts = test_key.split("::")
            test_file = parts[0]
            test_name = "::".join(parts[1:])
        else:
            test_file = test_key
            test_name = ""

        self.debug_test_requested.emit(test_file, test_name)

        self._output_panel.show()
        self._splitter.setSizes([300, 250])
        self._output_panel.append(f"Debug session requested for: {test_key}")
        self._output_panel.append("Attach debugger and set breakpoints to start.")

    def _start_run(self):
        self._is_running = True
        self._passed = 0
        self._failed = 0
        self._skipped = 0
        self._status_label.setText("  Running tests...")
        self._progress.show()
        self._progress.setRange(0, 0)
        self._progress.setValue(0)
        self.test_run_started.emit()

    def _finish_run(self):
        self._is_running = False
        self._progress.setRange(0, 100)
        self._progress.setValue(100)
        QTimer.singleShot(500, self._progress.hide)

    def _update_tree_colors(self, parsed: Dict[str, List[str]]):
        for status, color in [("passed", "#73c991"), ("failed", "#f14c4c"),
                              ("error", "#f14c4c"), ("skipped", "#e0a020")]:
            for test_name in parsed.get(status, []):
                item = self._find_test_item(test_name)
                if item:
                    item.setForeground(0, QColor(color))
                    if status in ("failed", "error"):
                        item.setBackground(0, QColor("#2a0000"))

    def _find_test_item(self, test_name: str) -> Optional[QTreeWidgetItem]:
        if test_name in self._test_items:
            return self._test_items[test_name]
        short = test_name.split("::")[-1]
        for key, item in self._test_items.items():
            if key.endswith(f"::{short}"):
                return item
        for i in range(self._tree.topLevelItemCount()):
            file_item = self._tree.topLevelItem(i)
            for j in range(file_item.childCount()):
                child = file_item.child(j)
                if child.text(0).strip() == short:
                    return child
                for k in range(child.childCount()):
                    grandchild = child.child(k)
                    if grandchild.text(0).strip() == short:
                        return grandchild
        return None

    def _update_status_label(self):
        parts = []
        if self._passed:
            parts.append(f"\ueaa3 {self._passed} passed")
        if self._failed:
            parts.append(f"\uea87 {self._failed} failed")
        if self._skipped:
            parts.append(f"\ueb52 {self._skipped} skipped")
        if not parts:
            parts.append("No results")

        text = "  " + "  ".join(parts)
        self._status_label.setText(text)

        if self._failed > 0:
            self._status_label.setStyleSheet("color: #f14c4c; font-size: 11px;")
        elif self._passed > 0:
            self._status_label.setStyleSheet("color: #73c991; font-size: 11px;")
        else:
            self._status_label.setStyleSheet("color: #888888; font-size: 11px;")

    # ── Context Menu ──

    def _show_context_menu(self, pos):
        item = self._tree.itemAt(pos)
        if not item:
            return

        data = item.data(0, Qt.UserRole)
        if not data:
            return

        menu = QMenu(self._tree)
        menu.setStyleSheet("""
            QMenu { background-color: #1a1a1a; color: #cccccc; border: 1px solid #333; padding: 4px; }
            QMenu::item { padding: 4px 24px; }
            QMenu::item:selected { background-color: #1a0033; }
            QMenu::separator { height: 1px; background: #333; margin: 4px 8px; }
        """)

        test_type = data.get("type", "")

        if test_type in ("method", "function"):
            test_key = f"{data['file']}::{data['name']}"
            run_act = menu.addAction("▶ Run Test")
            run_act.triggered.connect(lambda: self.run_test(test_key))

            debug_act = menu.addAction("Debug Test")
            debug_act.triggered.connect(lambda: self.debug_test(test_key))

            menu.addSeparator()
            peek_act = menu.addAction("Peek Test")
            peek_act.triggered.connect(lambda: self._peek_test(data))

            open_act = menu.addAction("Open File")
            open_act.triggered.connect(lambda: self.file_open_requested.emit(data["file"]))

        elif test_type == "class":
            test_key = f"{data['file']}::{data['name']}"
            run_act = menu.addAction("▶ Run Tests in Class")
            run_act.triggered.connect(lambda: self.run_test(test_key))

            debug_act = menu.addAction("Debug Tests in Class")
            debug_act.triggered.connect(lambda: self.debug_test(test_key))

            menu.addSeparator()
            open_act = menu.addAction("Open File")
            open_act.triggered.connect(lambda: self.file_open_requested.emit(data["file"]))

        elif test_type == "file":
            menu.addSection(data.get("file", ""))
            run_file = menu.addAction("▶ Run All Tests in File")
            run_file.triggered.connect(lambda: self._run_file_tests(data["file"]))

            debug_file = menu.addAction("Debug All Tests in File")
            debug_file.triggered.connect(lambda: self._debug_file_tests(data["file"]))

            menu.addSeparator()
            open_act = menu.addAction("Open File")
            open_act.triggered.connect(lambda: self.file_open_requested.emit(data["file"]))

        menu.addSeparator()
        if test_type in ("method", "function", "class"):
            history_act = menu.addAction("Show Related Code")
            history_act.triggered.connect(lambda: self._show_related(data))

        menu.exec(self._tree.viewport().mapToGlobal(pos))

    def _peek_test(self, data: dict):
        peek = TestPeekWidget(data)
        item = self._find_test_item(f"{data['file']}::{data['name']}")
        if item:
            self._tree.scrollToItem(item)
            self._tree.setItemWidget(item, 0, peek)

    def _show_related(self, data: dict):
        self._related_code_panel.show_related(data.get("file", ""), data.get("name", ""))

    def _run_file_tests(self, file_path: str):
        if self._is_running:
            return
        self._start_run()

        def _run():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                start = time.time()
                res = subprocess.run(
                    ["pytest", "-v", file_path],
                    cwd=self._root, capture_output=True, text=True,
                    timeout=60, **kwargs
                )
                duration = time.time() - start
                return res.stdout, res.stderr, res.returncode, duration
            except Exception as e:
                return "", str(e), 1, 0

        def _on_done(stdout, stderr, rc, duration):
            self._finish_run()
            self._output_panel.show()
            self._splitter.setSizes([300, 250])
            self._output_panel.set_text(stdout + ("\n" + stderr if stderr else ""))
            parsed = _parse_pytest_output(stdout, stderr)
            self._passed = len(parsed["passed"])
            self._failed = len(parsed["failed"])
            self._update_tree_colors(parsed)
            self._update_status_label()
            self.test_status_changed.emit(self._passed, self._failed, self._total)
            self.test_run_finished.emit()

        threading.Thread(
            target=lambda: QTimer.singleShot(0, lambda res=_run(): _on_done(*res)),
            daemon=True
        ).start()

    def _debug_file_tests(self, file_path: str):
        self.debug_test_requested.emit(file_path, "")
        self._output_panel.show()
        self._splitter.setSizes([300, 250])
        self._output_panel.append(f"Debug session requested for: {file_path}")

    # ── Item Interactions ──

    def _on_item_clicked(self, item, col):
        data = item.data(0, Qt.UserRole)
        if data and data.get("type") in ("method", "function"):
            pass

    def _on_item_double_clicked(self, item, col):
        data = item.data(0, Qt.UserRole)
        if data and data.get("file"):
            self.file_open_requested.emit(data["file"])

    # ── Filter / Sort ──

    def _on_filter_changed(self, text: str):
        self._filter_text = text.lower()
        self._apply_filter()

    def _apply_filter(self):
        for i in range(self._tree.topLevelItemCount()):
            file_item = self._tree.topLevelItem(i)
            if not self._filter_text:
                file_item.setHidden(False)
                self._set_children_visible(file_item, True)
                continue

            file_visible = False
            for j in range(file_item.childCount()):
                child = file_item.child(j)
                child_text = child.text(0).lower()
                child_visible = self._filter_text in child_text

                if child.childCount() > 0:
                    method_visible = False
                    for k in range(child.childCount()):
                        gc = child.child(k)
                        gc_visible = self._filter_text in gc.text(0).lower()
                        gc.setHidden(not gc_visible)
                        if gc_visible:
                            method_visible = True
                    child.setHidden(not (child_visible or method_visible))
                else:
                    child.setHidden(not child_visible)

                if child_visible or (not child.isHidden()):
                    file_visible = True

            file_item.setHidden(not (file_visible or self._filter_text in file_item.text(0).lower()))

    def _set_children_visible(self, item, visible: bool):
        for i in range(item.childCount()):
            child = item.child(i)
            child.setHidden(not visible)
            self._set_children_visible(child, visible)

    def _on_sort_changed(self, mode: str):
        self._sort_mode = mode.lower()
        self._populate_tree(self._tests)

    # ── Continuous Run ──

    def _toggle_continuous_run(self, enabled: bool):
        self._continuous_run = enabled
        if enabled:
            self.run_all_tests()

    # ── File Watcher Auto-Refresh ──

    def _toggle_watch(self, enabled: bool):
        self._watch_enabled = enabled
        if enabled:
            self._setup_file_watcher()
        else:
            self._teardown_file_watcher()

    def _setup_file_watcher(self):
        self._teardown_file_watcher()
        if not self._root or not os.path.isdir(self._root):
            return

        try:
            self._file_watcher = QFileSystemWatcher()
            test_dirs = set()
            for test in self._tests:
                d = os.path.dirname(test.get("file", ""))
                if d and os.path.isdir(d):
                    test_dirs.add(d)

            for d in test_dirs:
                self._file_watcher.addPath(d)

            self._file_watcher.directoryChanged.connect(self._on_watch_changed)
            self._file_watcher.fileChanged.connect(self._on_watch_changed)
        except Exception:
            pass

    def _teardown_file_watcher(self):
        if self._file_watcher:
            try:
                for p in self._file_watcher.files() + self._file_watcher.directories():
                    self._file_watcher.removePath(p)
            except Exception:
                pass
            self._file_watcher = None

    def _on_watch_changed(self, path: str):
        if self._watch_enabled and not self._is_running:
            QTimer.singleShot(500, self.refresh_tests)

    # ── Profiles ──

    def _on_profile_changed(self, idx: int):
        self._current_profile_idx = idx

    def _refresh_profile_combo(self):
        self._profile_combo.blockSignals(True)
        self._profile_combo.clear()
        for p in self._profiles:
            self._profile_combo.addItem(p.name)
        self._profile_combo.setCurrentIndex(min(self._current_profile_idx, len(self._profiles) - 1))
        self._profile_combo.blockSignals(False)

    def _show_profile_dialog(self):
        dlg = ProfileDialog(self._profiles, self)
        if dlg.exec():
            self._profiles = dlg.get_profiles()
            self._refresh_profile_combo()

    # ── History ──

    def _show_history(self):
        dlg = TestHistoryDialog(self._history, self)
        dlg.exec()

    # ── Public Status API ──

    def get_status_data(self) -> dict:
        return {
            "passed": self._passed,
            "failed": self._failed,
            "total": self._total,
            "is_running": self._is_running,
        }

    def get_test_count(self) -> int:
        return self._total

    def get_failed_count(self) -> int:
        return self._failed

    def get_passed_count(self) -> int:
        return self._passed


class TestStatusIndicator(QWidget):
    """Status bar widget for test status."""

    clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(22)
        self._passed = 0
        self._failed = 0
        self._total = 0
        self._is_running = False

        layout = QHBoxLayout(self)
        layout.setContentsMargins(6, 0, 6, 0)
        layout.setSpacing(4)

        self._icon = QLabel("\uea6b")
        self._icon.setStyleSheet("color: #888888; font-size: 12px; background: transparent;")
        layout.addWidget(self._icon)

        self._text = QLabel("Tests")
        self._text.setStyleSheet("color: #888888; font-size: 11px; background: transparent;")
        layout.addWidget(self._text)

    def update_status(self, passed: int, failed: int, total: int):
        self._passed = passed
        self._failed = failed
        self._total = total
        self._update_display()

    def set_running(self, running: bool):
        self._is_running = running
        self._update_display()

    def _update_display(self):
        if self._is_running:
            self._icon.setText("\uea6b")
            self._icon.setStyleSheet("color: #7c3aed; font-size: 12px; background: transparent;")
            self._text.setText("Running...")
            self._text.setStyleSheet("color: #b794f4; font-size: 11px; background: transparent;")
        elif self._failed > 0:
            self._icon.setText("\uea87")
            self._icon.setStyleSheet("color: #f14c4c; font-size: 12px; background: transparent;")
            self._text.setText(f"{self._failed} Failed")
            self._text.setStyleSheet("color: #f14c4c; font-size: 11px; background: transparent;")
        elif self._passed > 0:
            self._icon.setText("\ueaa3")
            self._icon.setStyleSheet("color: #73c991; font-size: 12px; background: transparent;")
            self._text.setText(f"{self._passed} Passed")
            self._text.setStyleSheet("color: #73c991; font-size: 11px; background: transparent;")
        else:
            self._icon.setText("\uea6b")
            self._icon.setStyleSheet("color: #888888; font-size: 12px; background: transparent;")
            self._text.setText("Tests")
            self._text.setStyleSheet("color: #888888; font-size: 11px; background: transparent;")

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)
