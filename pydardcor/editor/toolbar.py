"""
Editor Actions Toolbar — TASK-0081
=====================================
Floating toolbar di atas editor dengan actions.
Mirip VS Code: editor title actions (split, close, more...)
"""

from __future__ import annotations

from typing import Callable, List, Optional, Tuple

try:
    from PySide6.QtWidgets import (
        QWidget, QHBoxLayout, QPushButton, QSizePolicy, QFrame
    )
    from PySide6.QtCore import Qt, Signal, QSize
    from PySide6.QtGui import QFont
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class EditorToolbarAction:
        def __init__(self, icon: str, tooltip: str, handler: Optional[Callable] = None, toggle: bool = False):
            self.icon = icon
            self.tooltip = tooltip
            self.handler = handler
            self.toggle = toggle


    class EditorToolbar(QWidget):
        """
        Thin toolbar shown at the top right of the editor title area.
        Contains editor-level actions: split, more options, etc.
        """

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self.setFixedHeight(30)
            self.setStyleSheet("background: transparent;")
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QHBoxLayout(self)
            layout.setContentsMargins(4, 0, 4, 0)
            layout.setSpacing(2)

            self._buttons_container = QWidget()
            buttons_layout = QHBoxLayout(self._buttons_container)
            buttons_layout.setContentsMargins(0, 0, 0, 0)
            buttons_layout.setSpacing(2)
            layout.addWidget(self._buttons_container)
            layout.addStretch()

            self._btn_layout = buttons_layout

        def add_action(
            self,
            icon: str,
            tooltip: str,
            handler: Optional[Callable] = None,
            toggle: bool = False,
        ) -> QPushButton:
            btn = QPushButton(icon)
            btn.setFixedSize(24, 22)
            btn.setToolTip(tooltip)
            btn.setFont(QFont("codicon", 13))
            btn.setStyleSheet(
                "QPushButton { background: transparent; border: none; color: #cccccc; border-radius: 3px; }"
                "QPushButton:hover { background: rgba(255,255,255,0.1); color: white; }"
                "QPushButton:checked { background: rgba(255,255,255,0.15); }"
            )
            if toggle:
                btn.setCheckable(True)
            if handler:
                btn.clicked.connect(handler)
            self._btn_layout.addWidget(btn)
            return btn

        def add_default_actions(
            self,
            on_split: Optional[Callable] = None,
            on_close: Optional[Callable] = None,
            on_more: Optional[Callable] = None,
        ) -> None:
            """Add VS Code standard editor title actions."""
            if on_split:
                self.add_action("\uea72", "Split Editor Right (Ctrl+\\)", on_split)
            if on_more:
                self.add_action("\uea7b", "More Actions...", on_more)
            if on_close:
                self.add_action("\uea76", "Close", on_close)

else:
    class EditorToolbar:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def add_action(self, *args, **kwargs):
            pass

        def add_default_actions(self, *args, **kwargs):
            pass
