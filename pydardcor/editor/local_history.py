"""
Local History — VS Code parity (vs/workbench/contrib/localHistory/)

Automatically saves timestamped snapshots of files whenever they are saved.
Provides a browsable history panel for comparing and restoring previous versions.
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional


# Storage location: .dardcor/local_history/<relative_file_path>/<timestamp>.content
_HISTORY_DIR_NAME = ".dardcor/local_history"
_MAX_VERSIONS_PER_FILE = 50  # same as VS Code default


def _history_dir_for_file(file_path: str, workspace_root: str = "") -> Path:
    """Return the directory where history entries for this file are stored."""
    if workspace_root and file_path.startswith(workspace_root):
        rel = os.path.relpath(file_path, workspace_root)
    else:
        # Strip drive letter / leading slash for absolute paths outside workspace
        rel = file_path.replace(":", "_drive").lstrip("/\\")
    # Flatten path separators to underscores for directory names
    safe = rel.replace(os.sep, "__").replace("/", "__")
    base = Path(workspace_root) if workspace_root else Path.home()
    return base / _HISTORY_DIR_NAME / safe


def save_version(file_path: str, content: str, workspace_root: str = ""):
    """
    Called after every successful file save.
    Writes a timestamped snapshot of the file content.
    """
    try:
        hist_dir = _history_dir_for_file(file_path, workspace_root)
        hist_dir.mkdir(parents=True, exist_ok=True)

        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        entry_path = hist_dir / f"{ts}.json"
        meta = {
            "timestamp": datetime.now().isoformat(),
            "file_path": file_path,
            "size": len(content),
        }
        # Store metadata + content together
        data = {"meta": meta, "content": content}
        entry_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

        _prune_old_versions(hist_dir)
    except Exception:
        pass  # Local history must never block the save


def _prune_old_versions(hist_dir: Path):
    """Keep only the most recent MAX_VERSIONS_PER_FILE snapshots."""
    entries = sorted(hist_dir.glob("*.json"))
    if len(entries) > _MAX_VERSIONS_PER_FILE:
        for old in entries[: len(entries) - _MAX_VERSIONS_PER_FILE]:
            try:
                old.unlink()
            except Exception:
                pass


def list_versions(file_path: str, workspace_root: str = "") -> List[dict]:
    """
    Returns list of version metadata dicts, newest first.
    Each dict has: timestamp (str ISO), file_path (str), size (int), entry_path (str)
    """
    hist_dir = _history_dir_for_file(file_path, workspace_root)
    if not hist_dir.exists():
        return []
    result = []
    for entry in sorted(hist_dir.glob("*.json"), reverse=True):
        try:
            data = json.loads(entry.read_text(encoding="utf-8"))
            meta = data.get("meta", {})
            meta["entry_path"] = str(entry)
            result.append(meta)
        except Exception:
            pass
    return result


def load_version(entry_path: str) -> Optional[str]:
    """Load the content of a specific version snapshot."""
    try:
        data = json.loads(Path(entry_path).read_text(encoding="utf-8"))
        return data.get("content", "")
    except Exception:
        return None


# ── UI Panel ───────────────────────────────────────────────────────────────

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
    QPushButton, QSplitter, QTextEdit, QVBoxLayout, QWidget,
)


class LocalHistoryPanel(QDialog):
    """
    Browsable Local History dialog — shows all saved versions of the current file.
    User can compare any version against current content or restore it.
    """

    restore_requested = Signal(str)   # emits content to restore

    def __init__(self, file_path: str, current_content: str,
                 workspace_root: str = "", parent: QWidget | None = None):
        super().__init__(parent)
        self._file_path = file_path
        self._current_content = current_content
        self._workspace_root = workspace_root
        self.setWindowTitle(f"Local History — {os.path.basename(file_path)}")
        self.setMinimumSize(900, 600)
        self._build_ui()
        self._load_versions()

    def _build_ui(self):
        self.setStyleSheet("""
            QDialog {
                background-color: #0d0d1a;
                color: #cccccc;
            }
            QListWidget {
                background-color: #111111;
                border: 1px solid #3c0068;
                color: #cccccc;
                font-size: 12px;
            }
            QListWidget::item:selected {
                background-color: #3c0068;
                color: white;
            }
            QTextEdit {
                background-color: #0d0d1a;
                border: 1px solid #3c0068;
                color: #cccccc;
                font-family: 'Cascadia Code', Consolas, monospace;
                font-size: 12px;
            }
            QPushButton {
                background-color: #7c3aed;
                border: none;
                border-radius: 4px;
                color: white;
                font-size: 12px;
                padding: 6px 14px;
            }
            QPushButton:hover { background-color: #6d28d9; }
            QPushButton:disabled { background-color: #3c3c5c; color: #666; }
            QLabel { color: #cccccc; font-size: 12px; }
        """)

        main = QVBoxLayout(self)
        main.setContentsMargins(12, 12, 12, 12)
        main.setSpacing(8)

        # Header
        hdr = QLabel(f"Local history for: <b>{self._file_path}</b>")
        hdr.setTextFormat(Qt.RichText)
        main.addWidget(hdr)

        splitter = QSplitter(Qt.Horizontal)

        # Left: version list
        left = QWidget()
        left_lay = QVBoxLayout(left)
        left_lay.setContentsMargins(0, 0, 0, 0)
        left_lay.setSpacing(4)
        left_lay.addWidget(QLabel("Saved versions (newest first):"))
        self._list = QListWidget()
        self._list.currentRowChanged.connect(self._on_version_selected)
        left_lay.addWidget(self._list)
        splitter.addWidget(left)

        # Right: diff / content viewer
        right = QWidget()
        right_lay = QVBoxLayout(right)
        right_lay.setContentsMargins(0, 0, 0, 0)
        right_lay.setSpacing(4)
        right_lay.addWidget(QLabel("Version content:"))
        self._preview = QTextEdit()
        self._preview.setReadOnly(True)
        right_lay.addWidget(self._preview)
        splitter.addWidget(right)

        splitter.setSizes([250, 650])
        main.addWidget(splitter, 1)

        # Buttons
        btn_row = QHBoxLayout()
        self._restore_btn = QPushButton("Restore This Version")
        self._restore_btn.setEnabled(False)
        self._restore_btn.clicked.connect(self._on_restore)

        close_btn = QPushButton("Close")
        close_btn.setStyleSheet("background-color: #2a2a3c;")
        close_btn.clicked.connect(self.reject)

        btn_row.addStretch()
        btn_row.addWidget(self._restore_btn)
        btn_row.addWidget(close_btn)
        main.addLayout(btn_row)

    def _load_versions(self):
        self._versions = list_versions(self._file_path, self._workspace_root)
        self._list.clear()
        for v in self._versions:
            ts = v.get("timestamp", "")
            try:
                dt = datetime.fromisoformat(ts)
                label = dt.strftime("%Y-%m-%d  %H:%M:%S")
            except Exception:
                label = ts
            size = v.get("size", 0)
            item = QListWidgetItem(f"{label}  ({size} chars)")
            self._list.addItem(item)

        if not self._versions:
            self._list.addItem(QListWidgetItem("No history yet."))
            self._preview.setPlainText("No saved versions found for this file.")

    def _on_version_selected(self, row: int):
        if row < 0 or row >= len(self._versions):
            return
        v = self._versions[row]
        content = load_version(v["entry_path"])
        if content is not None:
            self._preview.setPlainText(content)
            self._restore_btn.setEnabled(True)
        self._selected_content = content

    def _on_restore(self):
        content = getattr(self, "_selected_content", None)
        if content is not None:
            self.restore_requested.emit(content)
            self.accept()
