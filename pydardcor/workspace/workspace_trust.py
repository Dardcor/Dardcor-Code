"""Workspace Trust - VS Code style restricted mode management."""

import os
import json
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QDialog, QListWidget, QListWidgetItem
)
from PySide6.QtCore import Signal, Qt
from ..core.config import get_user_data_dir


TRUST_FILE = os.path.join(get_user_data_dir(), "trusted_workspaces.json")


class WorkspaceTrust:
    """Manages workspace trust state."""

    def __init__(self):
        self._trusted_paths = set()
        self._load()

    def _load(self):
        if os.path.exists(TRUST_FILE):
            try:
                with open(TRUST_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._trusted_paths = set(data.get("trusted", []))
            except Exception:
                self._trusted_paths = set()

    def _save(self):
        os.makedirs(os.path.dirname(TRUST_FILE), exist_ok=True)
        tmp = TRUST_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"trusted": list(self._trusted_paths)}, f, indent=2)
        os.replace(tmp, TRUST_FILE)

    def is_trusted(self, workspace_path: str) -> bool:
        norm = os.path.normpath(workspace_path)
        for tp in self._trusted_paths:
            if os.path.normpath(tp) == norm:
                return True
        return False

    def trust(self, workspace_path: str):
        self._trusted_paths.add(os.path.normpath(workspace_path))
        self._save()

    def untrust(self, workspace_path: str):
        norm = os.path.normpath(workspace_path)
        self._trusted_paths.discard(norm)
        self._save()

    def get_trusted_list(self):
        return list(self._trusted_paths)


class WorkspaceTrustDialog(QDialog):
    """Dialog to manage workspace trust."""

    def __init__(self, trust_manager: WorkspaceTrust, current_workspace: str, parent=None):
        super().__init__(parent)
        self._trust = trust_manager
        self._workspace = current_workspace
        self.setWindowTitle("Workspace Trust")
        self.setFixedSize(500, 400)
        self.setStyleSheet("""
            QDialog { background-color: #1e1e1e; }
            QLabel { color: #d4d4d4; }
            QPushButton {
                background-color: #2c004a;
                color: #d4d4d4;
                border: 1px solid #3c0068;
                padding: 6px 16px;
                border-radius: 4px;
                font-size: 12px;
            }
            QPushButton:hover { background-color: #3c0068; }
        """)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Do you trust the authors of the files in this folder?")
        title.setStyleSheet("font-size: 16px; font-weight: bold; color: #ffffff;")
        title.setWordWrap(True)
        layout.addWidget(title)

        path_label = QLabel(self._workspace or "No workspace open")
        path_label.setStyleSheet("color: #888888; font-size: 12px;")
        layout.addWidget(path_label)

        is_trusted = self._trust.is_trusted(self._workspace) if self._workspace else False
        status = QLabel("✓ This workspace is trusted" if is_trusted else "⚠ This workspace is in restricted mode")
        status.setStyleSheet(f"color: {'#73c991' if is_trusted else '#f1d45a'}; font-size: 13px;")
        layout.addWidget(status)

        desc = QLabel(
            "If you trust the authors, you can enable all features. "
            "In restricted mode, some features like terminal, tasks, and debugging are disabled."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #999999; font-size: 11px;")
        layout.addWidget(desc)

        btn_row = QHBoxLayout()
        if is_trusted:
            untrust_btn = QPushButton("Don't Trust")
            untrust_btn.clicked.connect(self._untrust)
            btn_row.addWidget(untrust_btn)
        else:
            trust_btn = QPushButton("Trust Workspace & Enable All Features")
            trust_btn.setStyleSheet("""
                QPushButton {
                    background-color: #0e639c;
                    color: #ffffff;
                    border: none;
                    padding: 8px 20px;
                    border-radius: 4px;
                }
                QPushButton:hover { background-color: #1177bb; }
            """)
            trust_btn.clicked.connect(self._do_trust)
            btn_row.addWidget(trust_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        # Trusted list
        layout.addWidget(QLabel("Trusted Workspaces:"))
        self._list = QListWidget()
        self._list.setStyleSheet("""
            QListWidget { background: #0d0d0d; color: #cccccc; border: 1px solid #2c004a; }
            QListWidget::item { padding: 4px; }
            QListWidget::item:selected { background: #2c004a; }
        """)
        for p in self._trust.get_trusted_list():
            self._list.addItem(p)
        layout.addWidget(self._list)

    def _do_trust(self):
        if self._workspace:
            self._trust.trust(self._workspace)
        self.accept()

    def _untrust(self):
        if self._workspace:
            self._trust.untrust(self._workspace)
        self.accept()
