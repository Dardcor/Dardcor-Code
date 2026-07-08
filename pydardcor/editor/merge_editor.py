"""
Merge Editor — TASK-0090
==========================
3-way merge visual editor.
Mirip VS Code: src/vs/workbench/contrib/mergeEditor/
"""

from __future__ import annotations

from typing import Callable, List, Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
        QSplitter, QTextEdit, QSizePolicy
    )
    from PySide6.QtCore import Qt, Signal
    from PySide6.QtGui import QTextCharFormat, QColor, QFont
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class MergeConflict:
        """Represents a single merge conflict."""
        def __init__(
            self,
            start_line: int,
            mid_line: int,
            end_line: int,
            ours: List[str],
            theirs: List[str],
            resolved: Optional[str] = None,
        ):
            self.start_line = start_line
            self.mid_line = mid_line
            self.end_line = end_line
            self.ours = ours
            self.theirs = theirs
            self.resolved = resolved

        @property
        def is_resolved(self) -> bool:
            return self.resolved is not None


    class MergeEditor(QWidget):
        """
        3-way merge editor.
        Shows: Ours | Result | Theirs
        """

        all_resolved = Signal()

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._conflicts: List[MergeConflict] = []
            self._current_conflict_idx = 0
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)

            # Header toolbar
            toolbar = QWidget()
            toolbar.setFixedHeight(35)
            toolbar.setStyleSheet("background: #1a1a1a;")
            tb_layout = QHBoxLayout(toolbar)
            tb_layout.setContentsMargins(8, 0, 8, 0)

            title = QLabel("⚔  Merge Conflict Editor")
            title.setStyleSheet("color: #cccccc; font-size: 12px; font-weight: 600;")
            tb_layout.addWidget(title)
            tb_layout.addStretch()

            prev_btn = QPushButton("← Prev")
            next_btn = QPushButton("Next →")
            for btn in [prev_btn, next_btn]:
                btn.setStyleSheet(
                    "QPushButton { background: #3a3d3f; border: none; color: #ccc; "
                    "padding: 3px 10px; border-radius: 3px; }"
                    "QPushButton:hover { background: #4a4d4f; }"
                )
            prev_btn.clicked.connect(self._prev_conflict)
            next_btn.clicked.connect(self._next_conflict)
            tb_layout.addWidget(prev_btn)
            tb_layout.addWidget(next_btn)
            layout.addWidget(toolbar)

            # 3-column pane
            splitter = QSplitter(Qt.Horizontal)

            # Ours panel
            ours_frame = self._create_pane(
                "INCOMING (OURS)",
                "#1a4a1a",
                "#4e9a4e",
            )
            self._ours_text = ours_frame[1]
            splitter.addWidget(ours_frame[0])

            # Result panel
            result_frame = self._create_pane(
                "RESULT",
                "#1a1a2e",
                "#6c6c8e",
            )
            self._result_text = result_frame[1]
            splitter.addWidget(result_frame[0])

            # Theirs panel
            theirs_frame = self._create_pane(
                "CURRENT CHANGE (THEIRS)",
                "#2e1a1a",
                "#9a4e4e",
            )
            self._theirs_text = theirs_frame[1]
            splitter.addWidget(theirs_frame[0])

            layout.addWidget(splitter, 1)

            # Action buttons
            btn_row = QWidget()
            btn_row.setFixedHeight(40)
            btn_row.setStyleSheet("background: #1a1a1a; border-top: 1px solid #3c3c3c;")
            btn_row_layout = QHBoxLayout(btn_row)
            btn_row_layout.setContentsMargins(8, 0, 8, 0)

            accept_ours_btn = QPushButton("Accept Incoming")
            accept_ours_btn.clicked.connect(self._accept_ours)
            accept_theirs_btn = QPushButton("Accept Current")
            accept_theirs_btn.clicked.connect(self._accept_theirs)
            accept_both_btn = QPushButton("Accept Both")
            accept_both_btn.clicked.connect(self._accept_both)

            for btn in [accept_ours_btn, accept_theirs_btn, accept_both_btn]:
                btn.setStyleSheet(
                    "QPushButton { background: #0e639c; border: none; color: white; "
                    "padding: 5px 16px; border-radius: 3px; }"
                    "QPushButton:hover { background: #1177bb; }"
                )
                btn_row_layout.addWidget(btn)
            btn_row_layout.addStretch()
            layout.addWidget(btn_row)

        def _create_pane(self, title: str, bg: str, border: str):
            frame = QWidget()
            frame.setStyleSheet(f"background: #1e1e1e;")
            layout = QVBoxLayout(frame)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            header = QLabel(title)
            header.setFixedHeight(25)
            header.setAlignment(Qt.AlignCenter)
            header.setStyleSheet(
                f"background: {bg}; color: {border}; font-size: 10px; font-weight: bold;"
            )
            layout.addWidget(header)

            text = QTextEdit()
            text.setReadOnly(True)
            text.setStyleSheet(
                "QTextEdit { background: #1e1e1e; color: #d4d4d4; border: none; "
                "font-family: 'Cascadia Code', Consolas, monospace; font-size: 13px; }"
            )
            layout.addWidget(text, 1)
            return frame, text

        def load_conflicts(self, conflicts: List[MergeConflict]) -> None:
            self._conflicts = conflicts
            self._current_conflict_idx = 0
            self._show_current()

        def _show_current(self) -> None:
            if not self._conflicts:
                return
            c = self._conflicts[self._current_conflict_idx]
            self._ours_text.setPlainText("\n".join(c.ours))
            self._theirs_text.setPlainText("\n".join(c.theirs))
            result = c.resolved if c.resolved is not None else ""
            self._result_text.setPlainText(result)

        def _prev_conflict(self) -> None:
            if self._current_conflict_idx > 0:
                self._current_conflict_idx -= 1
                self._show_current()

        def _next_conflict(self) -> None:
            if self._current_conflict_idx < len(self._conflicts) - 1:
                self._current_conflict_idx += 1
                self._show_current()

        def _accept_ours(self) -> None:
            if self._conflicts:
                c = self._conflicts[self._current_conflict_idx]
                c.resolved = "\n".join(c.ours)
                self._result_text.setPlainText(c.resolved)

        def _accept_theirs(self) -> None:
            if self._conflicts:
                c = self._conflicts[self._current_conflict_idx]
                c.resolved = "\n".join(c.theirs)
                self._result_text.setPlainText(c.resolved)

        def _accept_both(self) -> None:
            if self._conflicts:
                c = self._conflicts[self._current_conflict_idx]
                c.resolved = "\n".join(c.ours + c.theirs)
                self._result_text.setPlainText(c.resolved)

        def is_all_resolved(self) -> bool:
            return all(c.is_resolved for c in self._conflicts)

        def get_merged_result(self) -> List[str]:
            """Return resolved text for each conflict."""
            return [c.resolved or "" for c in self._conflicts]

else:
    class MergeConflict:  # type: ignore
        pass

    class MergeEditor:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass
