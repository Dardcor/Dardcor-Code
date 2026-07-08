"""
Auxiliary Side Bar — TASK-0053
================================
Right side secondary sidebar.
Mirip VS Code: src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts
"""

from __future__ import annotations

from typing import Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
        QSizePolicy, QStackedWidget
    )
    from PySide6.QtCore import Qt, Signal
    from PySide6.QtGui import QFont
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class AuxiliarySideBar(QWidget):
        """
        Right secondary sidebar that hosts additional views.
        Can be toggled with Ctrl+Alt+B.
        """

        toggle_requested = Signal()

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._active_view_id: Optional[str] = None
            self.setMinimumWidth(120)
            self.setMaximumWidth(800)
            self.setStyleSheet("background: #252526;")
            self._setup_ui()
            self.setVisible(False)  # hidden by default

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            # Header
            self._header = QWidget()
            self._header.setFixedHeight(35)
            self._header.setStyleSheet("background: #252526; border-bottom: 1px solid #3c3c3c;")
            header_layout = QHBoxLayout(self._header)
            header_layout.setContentsMargins(10, 0, 6, 0)

            self._title_label = QLabel("SECONDARY SIDE BAR")
            self._title_label.setStyleSheet(
                "color: #bbbcbe; font-size: 11px; font-weight: 600; letter-spacing: 0.8px;"
            )
            header_layout.addWidget(self._title_label)
            header_layout.addStretch()

            close_btn = QPushButton("✕")
            close_btn.setFixedSize(22, 22)
            close_btn.setStyleSheet(
                "QPushButton { background: transparent; border: none; color: #888; border-radius: 3px; }"
                "QPushButton:hover { background: rgba(255,255,255,0.1); color: white; }"
            )
            close_btn.clicked.connect(self.hide)
            header_layout.addWidget(close_btn)
            layout.addWidget(self._header)

            # Content
            self._stack = QStackedWidget()
            self._stack.setStyleSheet("background: #1e1e1e;")
            layout.addWidget(self._stack, 1)

        def set_title(self, title: str) -> None:
            self._title_label.setText(title.upper())

        def add_view(self, view_id: str, widget: QWidget) -> None:
            widget.setProperty("aux_view_id", view_id)
            self._stack.addWidget(widget)

        def show_view(self, view_id: str) -> None:
            for i in range(self._stack.count()):
                w = self._stack.widget(i)
                if w and w.property("aux_view_id") == view_id:
                    self._stack.setCurrentIndex(i)
                    self._active_view_id = view_id
                    self.setVisible(True)
                    return

        def toggle(self) -> None:
            self.setVisible(not self.isVisible())

else:
    class AuxiliarySideBar:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def toggle(self):
            pass
