"""Timeline Panel - Shows local history and git commits for the active file."""

import os
import subprocess
from datetime import datetime
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QTreeWidget, QTreeWidgetItem, QLabel
)
from PySide6.QtCore import Qt, QSize, Signal
from PySide6.QtGui import QColor

from .outline_panel import SectionHeaderButton

class TimelinePanel(QWidget):
    item_selected = Signal(str)  # Emit commit hash or local history ID
    toggled = Signal(bool)
    def __init__(self, parent=None):
        super().__init__(parent)
        self._collapsed = True
        self._setup_ui()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        self._header = SectionHeaderButton("Timeline", self._collapsed)
        self._header.clicked.connect(self._toggle_collapse)
        layout.addWidget(self._header)
        
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(16)
        self._tree.itemClicked.connect(self._on_item_clicked)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 11px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 4px 2px;
                border: none;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover {
                background-color: #2a2d2e;
            }
        """)
        layout.addWidget(self._tree)
        self._tree.hide()
        
    def _update_header_text(self):
        self._header.set_collapsed(self._collapsed)
        
    def _toggle_collapse(self):
        self._collapsed = not self._collapsed
        self._tree.setVisible(not self._collapsed)
        self._update_header_text()
        self.toggled.emit(self._collapsed)
        
    def update_timeline(self, file_path: str):
        self._tree.clear()
        if not file_path:
            item = QTreeWidgetItem(["No active file"])
            item.setForeground(0, QColor("#888888"))
            self._tree.addTopLevelItem(item)
            return
            
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000

            root = self._git_root(file_path, kwargs)
            rel_path = os.path.relpath(file_path, root) if root else file_path

            self._add_working_tree_item(file_path, root, rel_path, kwargs)
            
            # 1. Load Local History
            try:
                from ..editor.local_history import list_versions
                versions = list_versions(file_path, root or "")
                for v in versions:
                    time_str = v.get("timestamp_str", "Unknown")
                    item = QTreeWidgetItem([f"[Local] Saved at {time_str}"])
                    item.setForeground(0, QColor("#e2c08d"))
                    item.setToolTip(0, f"Local history snapshot\nSize: {v.get('size_bytes', 0)} bytes")
                    item.setData(0, Qt.UserRole, f"local:{v.get('timestamp')}")
                    self._tree.addTopLevelItem(item)
            except Exception as e:
                pass # Local history not available or failed

            # 2. Load Git History
            res = subprocess.run(
                ["git", "log", "--pretty=format:%h|%an|%ar|%s", "--max-count=10", "--", rel_path],
                cwd=root or os.path.dirname(file_path),
                capture_output=True,
                text=True,
                timeout=2,
                **kwargs
            )
            
            if res.returncode == 0 and res.stdout.strip():
                lines = res.stdout.strip().splitlines()
                for line in lines:
                    parts = line.split("|", 3)
                    if len(parts) == 4:
                        hash_, author, time_, msg = parts
                        item = QTreeWidgetItem([f"[{hash_}] {msg} ({time_})"])
                        item.setToolTip(0, f"Author: {author}\nMessage: {msg}")
                        item.setData(0, Qt.UserRole, hash_)
                        self._tree.addTopLevelItem(item)
            else:
                self._add_empty_item("No Git history")

        except Exception:
            self._add_empty_item("History unavailable")

    def _git_root(self, file_path: str, kwargs: dict) -> str:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=os.path.dirname(file_path),
            capture_output=True,
            text=True,
            timeout=2,
            **kwargs
        )
        if res.returncode == 0:
            return res.stdout.strip()
        return ""

    def _add_working_tree_item(self, file_path: str, root: str, rel_path: str, kwargs: dict):
        if root:
            res = subprocess.run(
                ["git", "status", "--short", "--", rel_path],
                cwd=root,
                capture_output=True,
                text=True,
                timeout=2,
                **kwargs
            )
            if res.returncode == 0 and res.stdout.strip():
                status = res.stdout.strip()[:2].strip() or "modified"
                item = QTreeWidgetItem([f"Working tree: {status}"])
                item.setForeground(0, QColor("#e2c08d"))
                item.setToolTip(0, rel_path)
                self._tree.addTopLevelItem(item)
                return

        if os.path.exists(file_path):
            changed = datetime.fromtimestamp(os.path.getmtime(file_path)).strftime("%Y-%m-%d %H:%M")
            item = QTreeWidgetItem([f"Last saved: {changed}"])
            item.setForeground(0, QColor("#e2c08d"))
            self._tree.addTopLevelItem(item)

    def _add_empty_item(self, text: str):
        item = QTreeWidgetItem([text])
        item.setForeground(0, QColor("#888888"))
        self._tree.addTopLevelItem(item)

    def _on_item_clicked(self, item: QTreeWidgetItem, _col: int):
        commit = item.data(0, Qt.UserRole)
        if commit:
            self.item_selected.emit(commit)
