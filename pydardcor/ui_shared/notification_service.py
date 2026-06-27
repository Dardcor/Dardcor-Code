"""Notification Service - VS Code style toast notification system."""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QGraphicsOpacityEffect
)
from PySide6.QtCore import Qt, QTimer, QPropertyAnimation, QEasingCurve, Signal
from PySide6.QtGui import QFont
from collections import deque


class NotificationToast(QWidget):
    """Single notification toast widget."""

    closed = Signal()

    def __init__(self, message: str, severity: str = "info", actions: list = None, parent=None):
        super().__init__(parent)
        self.setFixedWidth(380)
        self.setMinimumHeight(50)
        self.setMaximumHeight(120)
        self.setAttribute(Qt.WA_TranslucentBackground, False)

        colors = {
            "info": ("#0e639c", "#1177bb"),
            "warning": ("#c9a100", "#ddb100"),
            "error": ("#b41e1e", "#d42020"),
        }
        bg, hover_bg = colors.get(severity, colors["info"])

        self.setStyleSheet(f"""
            NotificationToast {{
                background-color: #1e1e2e;
                border: 1px solid {bg};
                border-radius: 6px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 8, 8)
        layout.setSpacing(4)

        # Top row: icon + message + close
        top = QHBoxLayout()
        top.setSpacing(8)

        icons = {"info": "ℹ", "warning": "⚠", "error": "✕"}
        icon_colors = {"info": "#569cd6", "warning": "#f1d45a", "error": "#f14c4c"}

        icon = QLabel(icons.get(severity, "ℹ"))
        icon.setStyleSheet(f"color: {icon_colors.get(severity, '#569cd6')}; font-size: 14px;")
        icon.setFixedWidth(18)
        top.addWidget(icon)

        msg = QLabel(message)
        msg.setWordWrap(True)
        msg.setStyleSheet("color: #d4d4d4; font-size: 12px;")
        top.addWidget(msg, 1)

        close_btn = QPushButton("✕")
        close_btn.setFixedSize(18, 18)
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #888888;
                font-size: 11px;
            }
            QPushButton:hover { color: #ffffff; }
        """)
        close_btn.clicked.connect(self._close)
        top.addWidget(close_btn)
        layout.addLayout(top)

        # Action buttons
        if actions:
            btn_row = QHBoxLayout()
            btn_row.setContentsMargins(26, 0, 0, 0)
            btn_row.addStretch()
            for label, callback in actions:
                btn = QPushButton(label)
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: transparent;
                        color: {icon_colors.get(severity, '#569cd6')};
                        border: none;
                        font-size: 11px;
                        padding: 2px 8px;
                    }}
                    QPushButton:hover {{ text-decoration: underline; }}
                """)
                btn.clicked.connect(callback)
                btn.clicked.connect(self._close)
                btn_row.addWidget(btn)
            layout.addLayout(btn_row)

        # Auto-dismiss timer
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._close)
        timeout = 8000 if severity == "info" else 12000
        self._timer.start(timeout)

    def _close(self):
        self.closed.emit()
        self.hide()
        self.deleteLater()


class NotificationService(QWidget):
    """Manages a stack of notification toasts in the bottom-right corner."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setStyleSheet("background: transparent;")
        self._toasts = []
        self._queue = deque()

    def show_info(self, message: str, actions: list = None):
        self._show(message, "info", actions)

    def show_warning(self, message: str, actions: list = None):
        self._show(message, "warning", actions)

    def show_error(self, message: str, actions: list = None):
        self._show(message, "error", actions)

    def _show(self, message: str, severity: str, actions: list = None):
        if len(self._toasts) >= 3:
            self._queue.append((message, severity, actions))
            return

        toast = NotificationToast(message, severity, actions, self.parent())
        toast.closed.connect(lambda t=toast: self._on_closed(t))
        self._toasts.append(toast)
        self._reposition()
        toast.show()
        toast.raise_()

    def _on_closed(self, toast):
        if toast in self._toasts:
            self._toasts.remove(toast)
        self._reposition()
        # Show queued
        if self._queue:
            msg, sev, acts = self._queue.popleft()
            self._show(msg, sev, acts)

    def _reposition(self):
        if not self.parent():
            return
        pw = self.parent().width()
        ph = self.parent().height()
        margin = 16
        y = ph - margin
        for toast in reversed(self._toasts):
            toast.adjustSize()
            y -= toast.height() + 8
            x = pw - toast.width() - margin
            toast.move(x, y)
            toast.raise_()
