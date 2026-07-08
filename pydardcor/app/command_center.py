"""
Command Center — TASK-0030
============================
Centered search bar di title bar (VS Code's Command Center).
Mirip VS Code: src/vs/workbench/browser/parts/titlebar/commandCenterControl.ts

Klik untuk membuka Command Palette / Quick Open.
"""

from __future__ import annotations

from typing import Callable, Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QHBoxLayout, QLabel, QPushButton, QLineEdit, QSizePolicy
    )
    from PySide6.QtCore import Qt, Signal, QSize
    from PySide6.QtGui import QFont, QKeySequence, QShortcut
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class CommandCenter(QWidget):
        """
        VS Code Command Center widget — centered bar in title bar.
        Clicking opens Quick Open (Ctrl+P) or Command Palette (Ctrl+Shift+P).
        """

        clicked = Signal()

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._on_click_handler: Optional[Callable] = None
            self.setFixedHeight(26)
            self.setMinimumWidth(300)
            self.setMaximumWidth(600)
            self.setCursor(Qt.PointingHandCursor)
            self._setup_ui()

        def _setup_ui(self) -> None:
            self.setStyleSheet("""
                CommandCenter {
                    background: #3c3c3c;
                    border: 1px solid #555555;
                    border-radius: 4px;
                }
                CommandCenter:hover {
                    background: #484848;
                    border-color: #6a6a6a;
                }
            """)

            layout = QHBoxLayout(self)
            layout.setContentsMargins(8, 0, 8, 0)
            layout.setSpacing(6)

            # Search icon
            search_icon = QLabel("🔍")
            search_icon.setStyleSheet("color: #cccccc; font-size: 11px;")
            search_icon.setFixedWidth(16)
            layout.addWidget(search_icon)

            # Placeholder text
            self._placeholder = QLabel("Dardcor Code")
            self._placeholder.setStyleSheet("color: #8a8a8a; font-size: 12px;")
            self._placeholder.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            layout.addWidget(self._placeholder)

            # Shortcut hint
            hint = QLabel("Ctrl+Shift+P")
            hint.setStyleSheet(
                "color: #6a6a6a; font-size: 11px; "
                "background: #2a2a2a; border-radius: 2px; padding: 1px 4px;"
            )
            layout.addWidget(hint)

        def set_placeholder(self, text: str) -> None:
            self._placeholder.setText(text)

        def set_click_handler(self, handler: Callable) -> None:
            self._on_click_handler = handler

        def mousePressEvent(self, event) -> None:
            if event.button() == Qt.LeftButton:
                if self._on_click_handler:
                    self._on_click_handler()
                self.clicked.emit()
            super().mousePressEvent(event)

else:
    class CommandCenter:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def set_click_handler(self, handler):
            pass
