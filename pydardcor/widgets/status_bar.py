"""Status Bar - VS Code exact replica status bar."""

from PySide6.QtWidgets import QWidget, QHBoxLayout, QLabel, QPushButton, QStatusBar
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QPainter, QPen


class StatusBarButton(QPushButton):
    """Clickable status bar item."""

    def __init__(self, text="", parent=None):
        super().__init__(text, parent)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background: transparent;
                color: #ffffff;
                border: none;
                padding: 0px 6px;
                font-size: 12px;
                font-family: "codicon", "Segoe UI", "Ubuntu", sans-serif;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.12);
            }
        """)


class StatusBar(QStatusBar):
    """VS Code style status bar at the bottom of the window."""

    command_palette_requested = Signal()
    go_to_line_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("statusBar")
        self.setFixedHeight(22)
        self.setStyleSheet("""
            #statusBar {
                background-color: #000000;
                min-height: 22px;
                max-height: 22px;
                border-top: 1px solid #3c0068;
            }
        """)
        self._setup_ui()

    def _setup_ui(self):
        # Remove default margins and spacing
        self.setContentsMargins(0, 0, 0, 0)

        self.setSizeGripEnabled(True)

        # LEFT SIDE (addWidget = left-aligned)
        self._remote_btn = StatusBarButton()
        self._remote_btn.hide()
        self._remote_btn.setStyleSheet("""
            QPushButton {
                background: #007acc;
                color: #ffffff;
                border: none;
                padding: 0px 10px;
                font-size: 12px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #0098ff;
            }
        """)
        self.addWidget(self._remote_btn)

        self._git_btn = StatusBarButton("\uea68 main")
        self._git_btn.setToolTip("Git Branch")
        self.addWidget(self._git_btn)

        self._sync_btn = StatusBarButton("\uea77")
        self._sync_btn.setToolTip("Synchronize Changes")
        self._sync_btn.setFixedWidth(24)
        self.addWidget(self._sync_btn)

        self._errors_btn = StatusBarButton("\uea87 0  \uea6c 0")
        self._errors_btn.setToolTip("No Problems")
        self.addWidget(self._errors_btn)

        # RIGHT SIDE (addPermanentWidget = right-aligned)
        self._cursor_btn = StatusBarButton("Ln 1, Col 1")
        self._cursor_btn.setToolTip("Go to Line/Column")
        self._cursor_btn.clicked.connect(self.go_to_line_requested.emit)
        self.addPermanentWidget(self._cursor_btn)

        self._indent_btn = StatusBarButton("Spaces: 4")
        self._indent_btn.setToolTip("Select Indentation")
        self.addPermanentWidget(self._indent_btn)

        self._encoding_btn = StatusBarButton("UTF-8")
        self._encoding_btn.setToolTip("Select Encoding")
        self.addPermanentWidget(self._encoding_btn)

        self._eol_btn = StatusBarButton("CRLF")
        self._eol_btn.setToolTip("Select End of Line Sequence")
        self.addPermanentWidget(self._eol_btn)

        self._lang_btn = StatusBarButton("Plain Text")
        self._lang_btn.setToolTip("Select Language Mode")
        self.addPermanentWidget(self._lang_btn)

        self._ai_btn = StatusBarButton("\ueab2 Dardcor AI")
        self._ai_btn.setToolTip("AI Engine Status")
        self._ai_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                color: #ffffff;
                border: none;
                padding: 0px 8px;
                font-size: 12px;
                font-family: "codicon", "Segoe UI", "Ubuntu", sans-serif;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.12);
            }
        """)
        self.addPermanentWidget(self._ai_btn)

        self._notif_btn = StatusBarButton("\ueaa2")
        self._notif_btn.setFixedWidth(28)
        self._notif_btn.setToolTip("No Notifications")
        self.addPermanentWidget(self._notif_btn)

    def set_connected(self, connected: bool):
        if connected:
            self._ai_btn.setText("\ueab2 Dardcor AI")
            self._ai_btn.setToolTip("AI Engine Ready")
        else:
            self._ai_btn.setText("\uea76 AI Offline")
            self._ai_btn.setToolTip("AI Engine Offline - Check Settings")

    def set_cursor_position(self, line: int, col: int):
        self._cursor_btn.setText(f"Ln {line}, Col {col}")

    def set_language(self, language: str):
        self._lang_btn.setText(language)

    def set_git_branch(self, branch: str):
        self._git_btn.setText(f"\uea68 {branch}")

    def set_encoding(self, encoding: str):
        self._encoding_btn.setText(encoding)

    def set_eol(self, eol: str):
        self._eol_btn.setText(eol)

    def set_indent(self, spaces: int):
        self._indent_btn.setText(f"Spaces: {spaces}")

    def set_errors_warnings(self, errors: int, warnings: int):
        self._errors_btn.setText(f"\uea87 {errors}  \uea6c {warnings}")
        if errors > 0:
            self._errors_btn.setToolTip(f"{errors} Error(s), {warnings} Warning(s)")
        elif warnings > 0:
            self._errors_btn.setToolTip(f"{warnings} Warning(s)")
        else:
            self._errors_btn.setToolTip("No Problems")

    def set_remote_name(self, name: str):
        if name:
            self._remote_btn.setText(f">{name}")
            self._remote_btn.show()
        else:
            self._remote_btn.hide()
