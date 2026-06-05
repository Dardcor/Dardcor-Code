"""Chat Panel - VS Code Copilot-style AI chat sidebar."""

import json
from datetime import datetime
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTextEdit,
    QPushButton, QLabel, QFrame, QScrollArea,
)
from PySide6.QtCore import Signal, Qt, QTimer
from PySide6.QtGui import QColor, QTextCursor, QTextCharFormat, QFont, QKeyEvent


class ChatPanel(QWidget):
    """VS Code Copilot Chat style panel."""

    message_sent = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("chatPanel")
        self.setMinimumWidth(300)
        self.setStyleSheet("""
            #chatPanel {
                background-color: #000000;
            }
        """)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(35)
        header.setStyleSheet("""
            background-color: #000000;
        """)
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(12, 0, 8, 0)
        header_layout.setSpacing(4)

        title = QLabel("Agent")
        title.setStyleSheet("""
            color: #cccccc;
            font-size: 13px;
        """)
        header_layout.addWidget(title)
        header_layout.addStretch()

        def create_header_btn(icon, tooltip):
            btn = QPushButton(icon)
            btn.setFixedSize(26, 26)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent; border: none; color: #cccccc;
                    font-size: 14px; border-radius: 4px;
                }
                QPushButton:hover { background-color: #2a2a2a; }
            """)
            return btn

        new_btn = create_header_btn("+", "New Chat")
        new_btn.clicked.connect(self._request_new_conversation)
        header_layout.addWidget(new_btn)

        hist_btn = create_header_btn("⏱", "History")
        header_layout.addWidget(hist_btn)

        more_btn = create_header_btn("⋯", "More Actions")
        header_layout.addWidget(more_btn)

        close_btn = create_header_btn("✕", "Close Chat")
        close_btn.clicked.connect(self.hide)
        header_layout.addWidget(close_btn)

        layout.addWidget(header)

        # Chat history
        self._history = QTextEdit()
        self._history.setReadOnly(True)
        self._history.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self._history.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._history.setStyleSheet("""
            QTextEdit {
                background-color: #000000;
                border: none;
                color: #d4d4d4;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 13px;
                padding: 12px;
                selection-background-color: #4a0072;
            }
            QScrollBar:vertical {
                background-color: #000000;
                width: 10px;
                border: none;
            }
            QScrollBar::handle:vertical {
                background-color: #2c004a;
                min-height: 30px;
                border-radius: 5px;
            }
            QScrollBar::handle:vertical:hover {
                background-color: #4a0072;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
        """)
        layout.addWidget(self._history, 1)

        # Workspace Title
        self._workspace_lbl = QLabel("")
        self._workspace_lbl.setStyleSheet("""
            color: #ffffff;
            font-size: 14px;
            font-weight: bold;
            padding: 8px 16px 0px 16px;
            background-color: #000000;
        """)
        layout.addWidget(self._workspace_lbl)

        # Input area
        input_container = QWidget()
        input_container.setObjectName("inputContainer")
        input_container.setStyleSheet("""
            #inputContainer {
                background-color: #000000;
            }
        """)
        input_layout = QVBoxLayout(input_container)
        input_layout.setContentsMargins(16, 8, 16, 16)
        input_layout.setSpacing(12)

        input_box = QFrame()
        input_box.setStyleSheet("""
            QFrame {
                background-color: #000000;
                border: 1px solid #2c004a;
                border-radius: 8px;
            }
        """)
        input_box_layout = QVBoxLayout(input_box)
        input_box_layout.setContentsMargins(0, 0, 0, 0)
        input_box_layout.setSpacing(0)

        # Text input
        self._input = ChatInput()
        self._input.setPlaceholderText("Ask anything, @ to mention, / for workfl...")
        self._input.setFixedHeight(50)
        self._input.setAcceptRichText(False)
        self._input.setStyleSheet("""
            QTextEdit {
                background-color: transparent;
                color: #cccccc;
                border: none;
                padding: 12px;
                font-family: "Segoe UI", "Ubuntu", sans-serif;
                font-size: 13px;
                selection-background-color: #4a0072;
            }
        """)
        self._input.submit_pressed.connect(self._send_message)
        input_box_layout.addWidget(self._input)

        # Bottom row of input box
        input_bottom = QWidget()
        input_bottom_layout = QHBoxLayout(input_bottom)
        input_bottom_layout.setContentsMargins(8, 4, 8, 8)
        input_bottom_layout.setSpacing(8)

        attach_btn = QPushButton("+")
        attach_btn.setFixedSize(24, 24)
        attach_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #888888;
                font-size: 18px; border-radius: 4px;
            }
            QPushButton:hover { background-color: #333333; color: #cccccc; }
        """)
        input_bottom_layout.addWidget(attach_btn)

        model_btn = QPushButton("Gemini 3.1 Pro (High) ⌄")
        model_btn.setStyleSheet("""
            QPushButton {
                background: transparent; border: none; color: #888888;
                font-size: 12px; border-radius: 4px; padding: 4px 8px;
            }
            QPushButton:hover { background-color: #333333; color: #cccccc; }
        """)
        input_bottom_layout.addWidget(model_btn)

        input_bottom_layout.addStretch()

        self._send_btn = QPushButton("🎙")
        self._send_btn.setFixedSize(28, 28)
        self._send_btn.setCursor(Qt.PointingHandCursor)
        self._send_btn.setStyleSheet("""
            QPushButton {
                background-color: #333333;
                color: #cccccc;
                border: none;
                border-radius: 14px;
                font-size: 14px;
            }
            QPushButton:hover { background-color: #444444; }
            QPushButton:pressed { background-color: #222222; }
            QPushButton:disabled {
                background-color: #2a2a2a;
                color: #666666;
            }
        """)
        self._send_btn.clicked.connect(self._send_message)
        input_bottom_layout.addWidget(self._send_btn)

        input_box_layout.addWidget(input_bottom)
        input_layout.addWidget(input_box)

        # Disclaimer
        disclaimer = QLabel("AI may make mistakes. Double-check all generated code.")
        disclaimer.setAlignment(Qt.AlignCenter)
        disclaimer.setStyleSheet("color: #666666; font-size: 10px;")
        input_layout.addWidget(disclaimer)

        layout.addWidget(input_container)

        # Show welcome message
        self._show_welcome()

    def _show_welcome(self):
        pass

    def set_workspace_name(self, name: str):
        self._workspace_lbl.setText(name)

    def _request_new_conversation(self):
        """Placeholder - connected by main_window."""
        pass

    def _send_message(self):
        text = self._input.toPlainText().strip()
        if not text:
            return
        self._append_user_message(text)
        self._input.clear()
        self.message_sent.emit(text)

    def _append_user_message(self, text: str):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        # User icon + name
        fmt_header = QTextCharFormat()
        fmt_header.setForeground(QColor("#4fc1ff"))
        fmt_header.setFontWeight(700)
        fmt_header.setFontPointSize(12)
        cursor.insertText(f"\nYou", fmt_header)

        # Timestamp
        fmt_time = QTextCharFormat()
        fmt_time.setForeground(QColor("#666666"))
        fmt_time.setFontPointSize(10)
        cursor.insertText(f"  {datetime.now().strftime('%H:%M')}\n", fmt_time)

        # Message body
        fmt_body = QTextCharFormat()
        fmt_body.setForeground(QColor("#d4d4d4"))
        fmt_body.setFontPointSize(12)
        cursor.insertText(f"{text}\n", fmt_body)

        self._scroll_to_bottom()

    def append_agent_message(self, text: str):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        # Agent icon + name
        fmt_header = QTextCharFormat()
        fmt_header.setForeground(QColor("#c586c0"))
        fmt_header.setFontWeight(700)
        fmt_header.setFontPointSize(12)
        cursor.insertText(f"\nDardcor AI", fmt_header)

        # Timestamp
        fmt_time = QTextCharFormat()
        fmt_time.setForeground(QColor("#666666"))
        fmt_time.setFontPointSize(10)
        cursor.insertText(f"  {datetime.now().strftime('%H:%M')}\n", fmt_time)

        # Message body
        fmt_body = QTextCharFormat()
        fmt_body.setForeground(QColor("#d4d4d4"))
        fmt_body.setFontPointSize(12)
        cursor.insertText(f"{text}\n", fmt_body)

        self._scroll_to_bottom()

    def append_system_message(self, text: str):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        fmt = QTextCharFormat()
        fmt.setForeground(QColor("#858585"))
        fmt.setFontItalic(True)
        fmt.setFontPointSize(11)
        cursor.insertText(f"{text}\n\n", fmt)

        self._scroll_to_bottom()

    def append_tool_call(self, tool_name: str, args: str, status: str = "running"):
        cursor = self._history.textCursor()
        cursor.movePosition(QTextCursor.End)

        color_map = {
            "running": "#dcdcaa",
            "success": "#4ec9b0",
            "error": "#f14c4c",
        }
        color = color_map.get(status, "#858585")

        status_icon = {
            "running": "\u23f3",
            "success": "\u2713",
            "error": "\u2717",
        }
        icon = status_icon.get(status, "\u2022")

        fmt = QTextCharFormat()
        fmt.setForeground(QColor(color))
        fmt.setFontFamily("Cascadia Code, Consolas, monospace")
        fmt.setFontPointSize(10)
        cursor.insertText(f"  {icon} {tool_name}({args[:60]}) [{status}]\n", fmt)

        self._scroll_to_bottom()

    def _scroll_to_bottom(self):
        QTimer.singleShot(10, lambda: self._history.verticalScrollBar().setValue(
            self._history.verticalScrollBar().maximum()
        ))

    def clear(self):
        self._history.clear()

    def set_enabled(self, enabled: bool):
        self._send_btn.setEnabled(enabled)
        self._input.setEnabled(enabled)
        if enabled:
            self._send_btn.setText("🎙")
        else:
            self._send_btn.setText("⏳")


class ChatInput(QTextEdit):
    """Custom text input that submits on Enter."""

    submit_pressed = Signal()

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if not (event.modifiers() & Qt.ShiftModifier):
                self.submit_pressed.emit()
                return
        super().keyPressEvent(event)
