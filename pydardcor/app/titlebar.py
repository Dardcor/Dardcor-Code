"""
Custom Title Bar — TASK-0028
==============================
Frameless window + custom title bar dengan window controls.
Mirip VS Code: src/vs/workbench/browser/parts/titlebar/

Mendukung:
- Custom minimize/maximize/close controls
- Title text with ${activeEditorShort} variables
- Double-click to maximize
- Drag to move window
- macOS / Windows / Linux style
"""

from __future__ import annotations

import sys
from typing import Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QHBoxLayout, QLabel, QPushButton, QSizePolicy,
        QApplication
    )
    from PySide6.QtCore import Qt, Signal, QPoint, QSize
    from PySide6.QtGui import QFont, QMouseEvent, QPainter, QColor, QIcon, QPixmap
    HAS_QT = True
except ImportError:
    HAS_QT = False

IS_MACOS = sys.platform == "darwin"
IS_WINDOWS = sys.platform == "win32"


if HAS_QT:
    class WindowControlButton(QPushButton):
        """A single window control button (minimize/maximize/close)."""

        def __init__(
            self,
            action: str,   # "minimize" | "maximize" | "close"
            parent: Optional[QWidget] = None,
        ):
            super().__init__(parent)
            self._action = action
            self._hovered = False
            self.setFixedSize(46, 32)
            self.setFlat(True)
            self.setMouseTracking(True)
            self._update_style()

        def _update_style(self) -> None:
            base = "QPushButton { border: none; background: transparent; }"
            hover_map = {
                "minimize": "QPushButton:hover { background: #3f3f3f; }",
                "maximize": "QPushButton:hover { background: #3f3f3f; }",
                "close": "QPushButton:hover { background: #c0392b; }",
            }
            self.setStyleSheet(base + hover_map.get(self._action, ""))

        def paintEvent(self, event) -> None:
            super().paintEvent(event)
            painter = QPainter(self)
            painter.setRenderHint(QPainter.Antialiasing)

            rect = self.rect()
            cx = rect.center().x()
            cy = rect.center().y()
            painter.setPen(QColor("#cccccc"))

            if self._action == "minimize":
                painter.drawLine(cx - 5, cy, cx + 5, cy)
            elif self._action == "maximize":
                painter.drawRect(cx - 5, cy - 5, 10, 10)
            elif self._action == "close":
                painter.drawLine(cx - 5, cy - 5, cx + 5, cy + 5)
                painter.drawLine(cx + 5, cy - 5, cx - 5, cy + 5)

    class CustomTitleBar(QWidget):
        """
        VS Code-style custom title bar.
        Works with a frameless main window.
        """

        minimize_clicked = Signal()
        maximize_clicked = Signal()
        close_clicked = Signal()

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._drag_pos: Optional[QPoint] = None
            self._window_title = "Dardcor Code"
            self._active_editor = ""
            self._workspace_name = ""
            self.setFixedHeight(32)
            self.setStyleSheet("background: #1a1a1a;")
            self._setup_ui()

        def _setup_ui(self) -> None:
            layout = QHBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            # App icon (left)
            self._app_icon = QLabel()
            self._app_icon.setFixedSize(32, 32)
            self._app_icon.setStyleSheet("background: transparent;")
            self._app_icon.setAlignment(Qt.AlignCenter)
            self._app_icon.setText("⬡")  # placeholder
            layout.addWidget(self._app_icon)

            # Menu bar placeholder (will be filled by menubar.py)
            self._menu_area = QWidget()
            self._menu_area.setStyleSheet("background: transparent;")
            layout.addWidget(self._menu_area)

            # Command center (center) — will be filled by command_center.py
            layout.addStretch(1)

            self._title_label = QLabel(self._window_title)
            self._title_label.setAlignment(Qt.AlignCenter)
            self._title_label.setStyleSheet(
                "color: #cccccc; font-size: 12px; background: transparent;"
            )
            self._title_label.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Preferred)
            layout.addWidget(self._title_label)

            layout.addStretch(1)

            # Window controls (right) — Windows style
            if not IS_MACOS:
                self._min_btn = WindowControlButton("minimize", self)
                self._max_btn = WindowControlButton("maximize", self)
                self._close_btn = WindowControlButton("close", self)
                self._min_btn.clicked.connect(self.minimize_clicked)
                self._max_btn.clicked.connect(self.maximize_clicked)
                self._close_btn.clicked.connect(self.close_clicked)
                layout.addWidget(self._min_btn)
                layout.addWidget(self._max_btn)
                layout.addWidget(self._close_btn)
            else:
                # macOS: controls on left
                self._close_btn = WindowControlButton("close", self)
                self._min_btn = WindowControlButton("minimize", self)
                self._max_btn = WindowControlButton("maximize", self)
                self._close_btn.clicked.connect(self.close_clicked)
                self._min_btn.clicked.connect(self.minimize_clicked)
                self._max_btn.clicked.connect(self.maximize_clicked)
                # Re-insert at start
                layout.insertWidget(0, self._max_btn)
                layout.insertWidget(0, self._min_btn)
                layout.insertWidget(0, self._close_btn)

        def update_title(
            self,
            active_editor: str = "",
            workspace_name: str = "",
            dirty: bool = False,
            app_name: str = "Dardcor Code",
        ) -> None:
            """Update window title with VS Code style variables."""
            self._active_editor = active_editor
            self._workspace_name = workspace_name

            parts = []
            if active_editor:
                display = active_editor
                if dirty:
                    display = "● " + display
                parts.append(display)
            if workspace_name:
                parts.append(workspace_name)
            parts.append(app_name)

            title = " — ".join(parts)
            self._title_label.setText(title)
            self._window_title = title

        # Drag to move window
        def mousePressEvent(self, event: "QMouseEvent") -> None:
            if event.button() == Qt.LeftButton:
                self._drag_pos = event.globalPosition().toPoint() - self.window().frameGeometry().topLeft()
            super().mousePressEvent(event)

        def mouseMoveEvent(self, event: "QMouseEvent") -> None:
            if event.buttons() == Qt.LeftButton and self._drag_pos:
                window = self.window()
                if not window.isMaximized():
                    window.move(event.globalPosition().toPoint() - self._drag_pos)
            super().mouseMoveEvent(event)

        def mouseReleaseEvent(self, event: "QMouseEvent") -> None:
            self._drag_pos = None
            super().mouseReleaseEvent(event)

        def mouseDoubleClickEvent(self, event: "QMouseEvent") -> None:
            if event.button() == Qt.LeftButton:
                self.maximize_clicked.emit()

        def get_menu_area(self) -> QWidget:
            return self._menu_area

else:
    class CustomTitleBar:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def update_title(self, *args, **kwargs):
            pass
