"""Notification Service - VS Code style toast notification system."""

from collections import deque

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

_MAX_VISIBLE = 3

_SEVERITY_STYLES = {
    "info": {
        "border": "#3c0068",
        "accent": "#c586c0",
        "icon": "ℹ",
    },
    "warning": {
        "border": "#8a6d00",
        "accent": "#f1d45a",
        "icon": "⚠",
    },
    "error": {
        "border": "#8b1a1a",
        "accent": "#f14c4c",
        "icon": "✕",
    },
}


class NotificationToast(QWidget):
    """Single notification toast widget."""

    closed = Signal()

    def __init__(self, message: str, severity: str = "info", actions: list = None, parent=None):
        super().__init__(parent)
        self.setFixedWidth(380)
        self.setMinimumHeight(50)
        self.setMaximumHeight(120)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.action_buttons: list[QPushButton] = []

        style = _SEVERITY_STYLES.get(severity, _SEVERITY_STYLES["info"])
        accent = style["accent"]

        try:
            from pydardcor.app.theme_manager import ThemeManager
            c = getattr(ThemeManager, '_current_shell_colors', {})
            bg_color = c.get('background', '#0d0d0d')
            theme_border = c.get('border', style['border'])
            fg_color = c.get('foreground', '#e0e0e0')
        except Exception:
            bg_color = '#0d0d0d'
            theme_border = style['border']
            fg_color = '#e0e0e0'

        self.setStyleSheet(f"""
            NotificationToast {{
                background-color: {bg_color};
                border: 1px solid {theme_border};
                border-left: 3px solid {accent};
                border-radius: 6px;
            }}
        """)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 8, 8)
        layout.setSpacing(4)

        top = QHBoxLayout()
        top.setSpacing(8)

        icon = QLabel(style["icon"])
        icon.setStyleSheet(f"color: {accent}; font-size: 14px;")
        icon.setFixedWidth(18)
        top.addWidget(icon)

        msg = QLabel(message)
        msg.setWordWrap(True)
        msg.setStyleSheet(f"color: {fg_color}; font-size: 12px;")
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
            QPushButton:hover { color: #c586c0; }
        """)
        close_btn.clicked.connect(self._close)
        top.addWidget(close_btn)
        layout.addLayout(top)

        if actions:
            btn_row = QHBoxLayout()
            btn_row.setContentsMargins(26, 0, 0, 0)
            btn_row.addStretch()
            for label, callback in actions:
                btn = QPushButton(label)
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: transparent;
                        color: {accent};
                        border: none;
                        font-size: 11px;
                        padding: 2px 8px;
                    }}
                    QPushButton:hover {{ color: #ffffff; text-decoration: underline; }}
                """)
                btn.clicked.connect(callback)
                btn.clicked.connect(self._close)
                self.action_buttons.append(btn)
                btn_row.addWidget(btn)
            layout.addLayout(btn_row)

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._close)
        timeout = 8000 if severity == "info" else 12000
        self._timer.start(timeout)

    def _close(self):
        self._timer.stop()
        self.closed.emit()
        self.hide()
        self.deleteLater()


class NotificationService(QWidget):
    """Manages a stack of notification toasts in the bottom-right corner."""

    count_changed = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setStyleSheet("background: transparent;")
        self._toasts: list[NotificationToast] = []
        self._queue: deque = deque()

    @property
    def visible_count(self) -> int:
        return len(self._toasts)

    @property
    def queued_count(self) -> int:
        return len(self._queue)

    @property
    def unread_count(self) -> int:
        return self.visible_count + self.queued_count

    def show_info(self, message: str, actions: list = None):
        self._show(message, "info", actions)

    def show_warning(self, message: str, actions: list = None):
        self._show(message, "warning", actions)

    def show_error(self, message: str, actions: list = None):
        self._show(message, "error", actions)

    def dismiss_oldest(self):
        if self._toasts:
            self._toasts[0]._close()

    def dismiss_all(self):
        for toast in list(self._toasts):
            toast._close()
        self._queue.clear()
        self._emit_count()

    def _show(self, message: str, severity: str, actions: list = None):
        if len(self._toasts) >= _MAX_VISIBLE:
            self._queue.append((message, severity, actions))
            self._emit_count()
            return

        toast = NotificationToast(message, severity, actions, self.parent())
        toast.closed.connect(lambda t=toast: self._on_closed(t))
        self._toasts.append(toast)
        self._reposition()
        toast.show()
        toast.raise_()
        self._emit_count()

    def _on_closed(self, toast):
        if toast in self._toasts:
            self._toasts.remove(toast)
        self._reposition()
        if self._queue:
            msg, sev, acts = self._queue.popleft()
            self._show(msg, sev, acts)
        else:
            self._emit_count()

    def _emit_count(self):
        self.count_changed.emit(self.unread_count)

    def _reposition(self):
        parent = self.parent()
        if not parent:
            return
        pw = parent.width()
        ph = parent.height()
        margin = 16
        y = ph - margin
        for toast in reversed(self._toasts):
            toast.adjustSize()
            y -= toast.height() + 8
            x = pw - toast.width() - margin
            toast.move(x, y)
            toast.raise_()

    def reposition(self):
        """Re-stack toasts after the parent window is resized."""
        self._reposition()
