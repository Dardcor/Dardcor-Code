"""Screencast Mode - Shows keystrokes and mouse clicks on screen overlay."""

from PySide6.QtWidgets import QWidget, QLabel, QVBoxLayout, QApplication
from PySide6.QtCore import Qt, QTimer, QEvent, QObject
from PySide6.QtGui import QFont, QKeyEvent


class ScreencastOverlay(QLabel):
    """Floating label that shows keystroke combos."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.ToolTip | Qt.FramelessWindowHint)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setAlignment(Qt.AlignCenter)
        self.setFixedHeight(40)
        self.setMinimumWidth(100)
        self.setStyleSheet("""
            QLabel {
                background-color: rgba(30, 0, 50, 0.85);
                color: #e0d0ff;
                border: 1px solid #4a0072;
                border-radius: 8px;
                padding: 6px 16px;
                font-size: 16px;
                font-family: "Cascadia Code", "Consolas", monospace;
                font-weight: bold;
            }
        """)
        self.hide()
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._fade_out)

    def show_key(self, text: str):
        self.setText(text)
        self.adjustSize()
        if self.parent():
            pw = self.parent().width()
            ph = self.parent().height()
            x = (pw - self.width()) // 2
            y = ph - self.height() - 60
            self.move(x, y)
        self.show()
        self.raise_()
        self._timer.start(1500)

    def _fade_out(self):
        self.hide()


class ScreencastMode(QObject):
    """Installs an event filter to capture keystrokes and display them."""

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self._active = False
        self._overlay = ScreencastOverlay(main_window)

    def toggle(self):
        self._active = not self._active
        if self._active:
            QApplication.instance().installEventFilter(self)
        else:
            QApplication.instance().removeEventFilter(self)
            self._overlay.hide()

    def is_active(self):
        return self._active

    def eventFilter(self, obj, event):
        if not self._active:
            return False
        if event.type() == QEvent.KeyPress:
            key_event = event
            parts = []
            mods = key_event.modifiers()
            if mods & Qt.ControlModifier:
                parts.append("Ctrl")
            if mods & Qt.ShiftModifier:
                parts.append("Shift")
            if mods & Qt.AltModifier:
                parts.append("Alt")

            key = key_event.key()
            # Filter out lone modifier keys
            if key in (Qt.Key_Control, Qt.Key_Shift, Qt.Key_Alt, Qt.Key_Meta):
                return False

            key_text = key_event.text()
            if key == Qt.Key_Return or key == Qt.Key_Enter:
                parts.append("Enter")
            elif key == Qt.Key_Backspace:
                parts.append("Backspace")
            elif key == Qt.Key_Tab:
                parts.append("Tab")
            elif key == Qt.Key_Escape:
                parts.append("Esc")
            elif key == Qt.Key_Space:
                parts.append("Space")
            elif key == Qt.Key_Delete:
                parts.append("Del")
            elif key == Qt.Key_Up:
                parts.append("↑")
            elif key == Qt.Key_Down:
                parts.append("↓")
            elif key == Qt.Key_Left:
                parts.append("←")
            elif key == Qt.Key_Right:
                parts.append("→")
            elif Qt.Key_F1 <= key <= Qt.Key_F12:
                parts.append(f"F{key - Qt.Key_F1 + 1}")
            elif key_text and key_text.isprintable():
                parts.append(key_text.upper() if len(parts) > 0 else key_text)
            else:
                return False

            combo = " + ".join(parts)
            if combo:
                self._overlay.show_key(combo)

        return False
