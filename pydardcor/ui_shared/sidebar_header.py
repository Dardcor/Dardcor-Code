"""
Side Bar Header — TASK-0051
=============================
View title + Actions toolbar mirip VS Code.
Mirip: src/vs/workbench/browser/parts/views/viewPaneContainer.ts
"""

from __future__ import annotations

from typing import Callable, List, Optional, Tuple

try:
    from PySide6.QtWidgets import (
        QWidget, QHBoxLayout, QLabel, QPushButton, QSizePolicy, QToolButton, QMenu
    )
    from PySide6.QtCore import Qt, Signal, QSize
    from PySide6.QtGui import QFont, QAction, QIcon
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class SideBarActionButton(QToolButton):
        """Small icon action button for sidebar header toolbar."""

        def __init__(
            self,
            icon_char: str,
            tooltip: str,
            handler: Optional[Callable] = None,
            parent: Optional[QWidget] = None,
        ):
            super().__init__(parent)
            self.setFixedSize(22, 22)
            self.setToolTip(tooltip)
            self.setText(icon_char)
            self.setFont(QFont("codicon", 14))
            self.setStyleSheet("""
                QToolButton {
                    background: transparent;
                    border: none;
                    color: #cccccc;
                    border-radius: 3px;
                }
                QToolButton:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #ffffff;
                }
                QToolButton:pressed {
                    background: rgba(255, 255, 255, 0.05);
                }
            """)
            if handler:
                self.clicked.connect(handler)


    class SideBarHeader(QWidget):
        """
        VS Code-style sidebar header with view title and action toolbar.
        Shows at the top of each sidebar view pane.
        """

        def __init__(
            self,
            title: str = "",
            parent: Optional[QWidget] = None,
        ):
            super().__init__(parent)
            self._title = title
            self._actions: List[SideBarActionButton] = []
            self.setFixedHeight(35)
            self.setStyleSheet("background: #252526;")
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QHBoxLayout(self)
            layout.setContentsMargins(12, 0, 6, 0)
            layout.setSpacing(4)

            self._title_label = QLabel(self._title.upper())
            self._title_label.setStyleSheet(
                "color: #bbbcbe; font-size: 11px; font-weight: 600; letter-spacing: 1px;"
            )
            self._title_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            layout.addWidget(self._title_label)

            self._actions_container = QWidget()
            self._actions_layout = QHBoxLayout(self._actions_container)
            self._actions_layout.setContentsMargins(0, 0, 0, 0)
            self._actions_layout.setSpacing(2)
            layout.addWidget(self._actions_container)

        def set_title(self, title: str) -> None:
            self._title = title
            self._title_label.setText(title.upper())

        def add_action(
            self,
            icon_char: str,
            tooltip: str,
            handler: Optional[Callable] = None,
        ) -> SideBarActionButton:
            """Add an action button to the header toolbar."""
            btn = SideBarActionButton(icon_char, tooltip, handler, self)
            self._actions_layout.addWidget(btn)
            self._actions.append(btn)
            return btn

        def clear_actions(self) -> None:
            while self._actions_layout.count():
                item = self._actions_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            self._actions.clear()

        def set_actions_visible(self, visible: bool) -> None:
            self._actions_container.setVisible(visible)

        def enterEvent(self, event) -> None:
            self._actions_container.setVisible(True)
            super().enterEvent(event)

        def leaveEvent(self, event) -> None:
            self._actions_container.setVisible(True)
            super().leaveEvent(event)

else:
    class SideBarHeader:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def add_action(self, *args, **kwargs):
            pass

        def set_title(self, title: str):
            pass
