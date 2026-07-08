"""
Multi-Diff Editor — TASK-0089
================================
Compare multiple files side-by-side.
Mirip VS Code: src/vs/workbench/contrib/multiDiffEditor/
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel, QScrollArea,
        QPushButton, QSplitter, QSizePolicy
    )
    from PySide6.QtCore import Qt, Signal
    HAS_QT = True
except ImportError:
    HAS_QT = False


@dataclass
class DiffEntry:
    """A single diff pair to show."""
    original_uri: str
    modified_uri: str
    label: str = ""


if HAS_QT:
    class MultiDiffViewer(QWidget):
        """
        Shows multiple diff views stacked vertically.
        Used for reviewing multiple changed files at once.
        """

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._entries: List[DiffEntry] = []
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)

            # Header bar
            header = QWidget()
            header.setFixedHeight(30)
            header.setStyleSheet("background: #252526; border-bottom: 1px solid #3c3c3c;")
            header_layout = QHBoxLayout(header)
            header_layout.setContentsMargins(10, 0, 10, 0)
            title = QLabel("Multi-Diff Editor")
            title.setStyleSheet("color: #cccccc; font-size: 12px;")
            header_layout.addWidget(title)
            layout.addWidget(header)

            # Scrollable diff list
            scroll = QScrollArea()
            scroll.setWidgetResizable(True)
            scroll.setStyleSheet("background: #1e1e1e; border: none;")
            self._content = QWidget()
            self._content_layout = QVBoxLayout(self._content)
            self._content_layout.setContentsMargins(0, 0, 0, 0)
            self._content_layout.setSpacing(1)
            self._content_layout.addStretch()
            scroll.setWidget(self._content)
            layout.addWidget(scroll, 1)

        def set_diffs(self, entries: List[DiffEntry]) -> None:
            """Set the list of diffs to display."""
            # Clear existing
            while self._content_layout.count() > 1:
                item = self._content_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()

            self._entries = entries
            for entry in entries:
                self._add_diff_entry(entry)

        def _add_diff_entry(self, entry: DiffEntry) -> None:
            import os
            header = QWidget()
            header.setFixedHeight(28)
            header.setStyleSheet("background: #2d2d2d; border-bottom: 1px solid #3c3c3c;")
            h_layout = QHBoxLayout(header)
            h_layout.setContentsMargins(8, 0, 8, 0)
            label = QLabel(entry.label or f"{os.path.basename(entry.original_uri)} ↔ {os.path.basename(entry.modified_uri)}")
            label.setStyleSheet("color: #cccccc; font-size: 11px;")
            h_layout.addWidget(label)
            self._content_layout.insertWidget(self._content_layout.count() - 1, header)

else:
    class MultiDiffViewer:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def set_diffs(self, *args):
            pass
