"""
Banner Part — TASK-0026
========================
Top notification banner mirip VS Code.
Mirip: src/vs/workbench/browser/parts/banner/bannerPart.ts
"""

from __future__ import annotations

from typing import Callable, List, Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QHBoxLayout, QLabel, QPushButton, QSizePolicy
    )
    from PySide6.QtCore import Qt, Signal
    from PySide6.QtGui import QFont
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class BannerAction:
        def __init__(self, label: str, handler: Callable):
            self.label = label
            self.handler = handler

    class BannerWidget(QWidget):
        """
        Top-of-window notification banner.
        Used for important workspace-level messages.
        """

        closed = Signal()

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._message = ""
            self._icon = ""
            self._actions: List[BannerAction] = []
            self._aria_label = ""
            self.setVisible(False)
            self.setFixedHeight(28)
            self._setup_ui()

        def _setup_ui(self) -> None:
            self.setStyleSheet(
                "BannerWidget { background: #0e639c; }"
            )
            layout = QHBoxLayout(self)
            layout.setContentsMargins(10, 0, 10, 0)
            layout.setSpacing(8)

            self._icon_label = QLabel("")
            self._icon_label.setFixedWidth(16)
            self._icon_label.setStyleSheet("color: white; font-size: 14px;")
            layout.addWidget(self._icon_label)

            self._message_label = QLabel("")
            self._message_label.setStyleSheet("color: white; font-size: 12px;")
            self._message_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            layout.addWidget(self._message_label)

            self._actions_container = QWidget()
            self._actions_layout = QHBoxLayout(self._actions_container)
            self._actions_layout.setContentsMargins(0, 0, 0, 0)
            self._actions_layout.setSpacing(4)
            layout.addWidget(self._actions_container)

            self._close_btn = QPushButton("✕")
            self._close_btn.setFixedSize(20, 20)
            self._close_btn.setStyleSheet(
                "QPushButton { background: transparent; border: none; color: rgba(255,255,255,0.7); }"
                "QPushButton:hover { color: white; }"
            )
            self._close_btn.clicked.connect(self.dismiss)
            layout.addWidget(self._close_btn)

        def show_message(
            self,
            message: str,
            *,
            icon: str = "ℹ",
            actions: Optional[List[BannerAction]] = None,
            aria_label: str = "",
            color: str = "#0e639c",
        ) -> None:
            """Show a banner message."""
            self._message = message
            self._icon = icon
            self._actions = actions or []
            self._aria_label = aria_label

            self._icon_label.setText(icon)
            self._message_label.setText(message)
            self.setStyleSheet(f"BannerWidget {{ background: {color}; }}")

            # Clear old action buttons
            while self._actions_layout.count():
                item = self._actions_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()

            # Add new action buttons
            for action in self._actions:
                btn = QPushButton(action.label)
                btn.setStyleSheet(
                    "QPushButton { "
                    "  background: rgba(255,255,255,0.15); "
                    "  border: 1px solid rgba(255,255,255,0.3); "
                    "  color: white; "
                    "  padding: 2px 8px; "
                    "  font-size: 11px; "
                    "  border-radius: 3px; "
                    "}"
                    "QPushButton:hover { background: rgba(255,255,255,0.25); }"
                )
                btn.clicked.connect(action.handler)
                self._actions_layout.addWidget(btn)

            self.setVisible(True)

        def dismiss(self) -> None:
            """Hide the banner."""
            self.setVisible(False)
            self.closed.emit()

        def show_warning(self, message: str, **kwargs) -> None:
            self.show_message(message, icon="⚠", color="#c37e00", **kwargs)

        def show_error(self, message: str, **kwargs) -> None:
            self.show_message(message, icon="✕", color="#a1260d", **kwargs)

        def show_info(self, message: str, **kwargs) -> None:
            self.show_message(message, icon="ℹ", color="#0e639c", **kwargs)

else:
    class BannerWidget:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def show_message(self, *args, **kwargs):
            pass

        def dismiss(self):
            pass
