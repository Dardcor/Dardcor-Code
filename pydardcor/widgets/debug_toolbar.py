from PySide6.QtWidgets import QWidget, QHBoxLayout, QPushButton, QLabel
from PySide6.QtCore import Qt, Signal


class DebugToolbar(QWidget):
    """Floating toolbar for debugging actions (Continue, Step, Stop, Restart)."""

    action_requested = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)
        layout.setSpacing(5)

        self._status_label = QLabel("")
        self._status_label.setStyleSheet(
            "color: #89d185; font-size: 11px; padding: 0 8px; font-weight: bold;"
        )
        layout.addWidget(self._status_label)

        self.btn_continue = QPushButton("\u25b6 Continue")
        self.btn_next = QPushButton("\u23ed Step Over")
        self.btn_step_in = QPushButton("\u23ec Step Into")
        self.btn_step_out = QPushButton("\u23ee Step Out")
        self.btn_restart = QPushButton("\u21bb Restart")
        self.btn_pause = QPushButton("\u23f8 Pause")
        self.btn_stop = QPushButton("\u23f9 Stop")

        self.btn_continue.clicked.connect(lambda: self.action_requested.emit("continue"))
        self.btn_next.clicked.connect(lambda: self.action_requested.emit("next"))
        self.btn_step_in.clicked.connect(lambda: self.action_requested.emit("stepIn"))
        self.btn_step_out.clicked.connect(lambda: self.action_requested.emit("stepOut"))
        self.btn_restart.clicked.connect(lambda: self.action_requested.emit("restart"))
        self.btn_pause.clicked.connect(lambda: self.action_requested.emit("pause"))
        self.btn_stop.clicked.connect(lambda: self.action_requested.emit("disconnect"))

        for btn in [self.btn_continue, self.btn_next, self.btn_step_in,
                    self.btn_step_out, self.btn_restart, self.btn_pause, self.btn_stop]:
            btn.setStyleSheet("""
                QPushButton {
                    background-color: transparent; border: none;
                    color: #cccccc; padding: 4px 8px; font-size: 12px;
                }
                QPushButton:hover {
                    background-color: #3d3d3d; border-radius: 2px;
                }
                QPushButton:disabled {
                    color: #555555;
                }
            """)
            layout.addWidget(btn)

        layout.addStretch()

        self.setStyleSheet("""
            DebugToolbar {
                background-color: #252526;
                border: 1px solid #454545;
                border-radius: 4px;
            }
        """)

    def set_state(self, is_paused: bool):
        self.btn_continue.setEnabled(is_paused)
        self.btn_next.setEnabled(is_paused)
        self.btn_step_in.setEnabled(is_paused)
        self.btn_step_out.setEnabled(is_paused)
        self.btn_restart.setEnabled(is_paused)
        self.btn_pause.setEnabled(not is_paused)

    def set_status(self, text: str):
        self._status_label.setText(text)

    def set_running_color(self, running: bool):
        color = "#89d185" if running else "#cccccc"
        self._status_label.setStyleSheet(
            f"color: {color}; font-size: 11px; padding: 0 8px; font-weight: bold;"
        )
