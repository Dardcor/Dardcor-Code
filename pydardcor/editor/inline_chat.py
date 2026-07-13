"""
Enhanced Inline Chat Widget — VS Code parity with /fix, /explain, commit generation.

Opens via Ctrl+I (when editor is focused), displays a floating panel anchored
below the current cursor line. User types a prompt; the AI response is streamed
as ghost text / diff inline in the editor.
"""
from __future__ import annotations

import os
from PySide6.QtCore import Qt, QTimer, Signal, QThread, QCoreApplication
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QLabel, QLineEdit, QComboBox,
    QPushButton, QVBoxLayout, QWidget, QFrame,
)

from dardcor_agent.chat.participants import BUILTIN_PARTICIPANTS


class InlineChatWidget(QDialog):
    """
    Floating inline chat panel — equivalent to VS Code's Ctrl+I inline chat.
    Enhanced with /fix, /explain, /commit commands and participant switching.
    """

    prompt_submitted = Signal(str, object)
    dismissed = Signal()
    commit_message_requested = Signal(str)

    def __init__(self, editor_widget, parent: QWidget | None = None):
        super().__init__(parent, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self._editor = editor_widget
        self._build_ui()
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setMinimumWidth(460)
        self.setMaximumWidth(750)

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        container = QWidget()
        container.setObjectName("InlineChatContainer")
        container.setStyleSheet("""
            QWidget#InlineChatContainer {
                background-color: #1e1e2e;
                border: 1px solid #7c3aed;
                border-radius: 8px;
            }
        """)

        layout = QVBoxLayout(container)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(8)

        # Header row
        header = QHBoxLayout()
        header.setSpacing(6)

        icon_lbl = QLabel("\ueac8")
        icon_lbl.setStyleSheet("color: #a78bfa; font-family: codicon; font-size: 14px;")

        title_lbl = QLabel("Dardcor AI (Inline)")
        title_lbl.setStyleSheet("color: #d4d4d4; font-size: 12px; font-weight: 600;")

        # Mode selector
        self._mode_combo = QComboBox()
        self._mode_combo.setFixedSize(90, 20)
        self._mode_combo.setToolTip("Select inline chat mode")
        self._mode_combo.addItem("Ask", "ask")
        self._mode_combo.addItem("/fix", "fix")
        self._mode_combo.addItem("/explain", "explain")
        self._mode_combo.addItem("/commit", "commit")
        self._mode_combo.addItem("/test", "test")
        self._mode_combo.setStyleSheet("""
            QComboBox {
                background: transparent; color: #a78bfa; border: 1px solid #3c0068;
                border-radius: 4px; font-size: 10px; font-weight: 600; padding: 1px 4px;
            }
            QComboBox::drop-down { border: none; width: 14px; }
            QComboBox:hover { border-color: #a78bfa; }
        """)
        self._mode_combo.currentIndexChanged.connect(self._on_mode_changed)
        header.addWidget(icon_lbl)
        header.addWidget(title_lbl)
        header.addWidget(self._mode_combo)
        header.addStretch()

        close_btn = QPushButton("\uea76")
        close_btn.setFixedSize(20, 20)
        close_btn.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                color: #6b6b8a;
                font-family: codicon;
                font-size: 13px;
            }
            QPushButton:hover { color: #d4d4d4; }
        """)
        close_btn.clicked.connect(self._on_dismiss)
        header.addWidget(close_btn)

        # Input row
        input_row = QHBoxLayout()
        input_row.setSpacing(6)

        self._input = QLineEdit()
        self._input.setPlaceholderText("Ask Dardcor AI to edit or generate code\u2026")
        self._input.setStyleSheet("""
            QLineEdit {
                background-color: #0d0d1a;
                border: 1px solid #3c0068;
                border-radius: 4px;
                color: #cccccc;
                font-size: 13px;
                padding: 5px 8px;
            }
            QLineEdit:focus { border-color: #7c3aed; }
        """)
        self._input.returnPressed.connect(self._on_submit)

        send_btn = QPushButton("\uea9c")
        send_btn.setFixedSize(28, 28)
        send_btn.setToolTip("Submit (Enter)")
        send_btn.setStyleSheet("""
            QPushButton {
                background-color: #7c3aed;
                border: none;
                border-radius: 4px;
                color: white;
                font-family: codicon;
                font-size: 14px;
            }
            QPushButton:hover { background-color: #6d28d9; }
        """)
        send_btn.clicked.connect(self._on_submit)

        input_row.addWidget(self._input)
        input_row.addWidget(send_btn)

        # Quick action buttons
        actions_row = QHBoxLayout()
        actions_row.setSpacing(4)
        for cmd, icon, tip in [
            ("/fix", "\u26a1", "Fix code (Ctrl+Shift+F)"),
            ("/explain", "\u2139", "Explain code"),
            ("/commit", "\u2709", "Generate commit message"),
            ("/test", "\u2699", "Generate tests"),
        ]:
            btn = QPushButton(f"{icon} {cmd}")
            btn.setFixedHeight(22)
            btn.setStyleSheet("""
                QPushButton {
                    background: #0d0d1a; color: #a78bfa; border: 1px solid #3c0068;
                    border-radius: 4px; font-size: 9px; padding: 0 8px;
                }
                QPushButton:hover { background: #1a0033; border-color: #a78bfa; }
            """)
            btn.clicked.connect(lambda checked, c=cmd: self._quick_action(c))
            actions_row.addWidget(btn)
        actions_row.addStretch()

        # Hint label
        hint = QLabel("Enter to submit \xb7 Esc to dismiss \xb7 Ctrl+I to reopen")
        hint.setStyleSheet("color: #6b6b8a; font-size: 10px;")

        layout.addLayout(header)
        layout.addLayout(input_row)
        layout.addLayout(actions_row)
        layout.addWidget(hint)

        root.addWidget(container)

        esc = QShortcut(QKeySequence("Escape"), self)
        esc.activated.connect(self._on_dismiss)

    def _on_mode_changed(self, index: int):
        mode = self._mode_combo.currentData()
        prompts = {
            "ask": "Ask Dardcor AI to edit or generate code\u2026",
            "fix": "/fix Describe the bug or issue to fix\u2026",
            "explain": "/explain Select code or describe what to explain\u2026",
            "commit": "/commit Will generate a commit message from git diff",
            "test": "/test Describe what to test\u2026",
        }
        self._input.setPlaceholderText(prompts.get(mode, "Ask Dardcor AI\u2026"))
        if mode == "commit":
            self._input.setText("/commit ")
        self._input.setFocus()

    def _quick_action(self, cmd: str):
        self._input.setText(cmd + " ")
        self._input.setFocus()
        self._input.selectAll()
        QTimer.singleShot(50, self._on_submit)

    def show_anchored(self):
        """Position the widget just below the editor's cursor region and show."""
        if self._editor and self._editor.parentWidget():
            try:
                gp = self._editor.mapToGlobal(self._editor.rect().topLeft())
            except Exception:
                gp = self._editor.pos() if hasattr(self._editor, 'pos') else self._editor.parentWidget().pos()

            x = gp.x() + 40
            y = gp.y() + 80
            self.move(x, y)

        self.show()
        self._input.setFocus()
        self._input.selectAll()

    def _on_submit(self):
        text = self._input.text().strip()
        if not text:
            return

        mode = self._mode_combo.currentData()
        if mode == "commit" or text.startswith("/commit"):
            self._handle_commit(text)
            return
        if text.startswith("/fix"):
            text = text[4:].strip() or "Fix bugs and issues in the current code"
        elif text.startswith("/explain"):
            text = text[8:].strip() or "Explain the selected code in detail"
        elif text.startswith("/test"):
            text = text[5:].strip() or "Generate unit tests for the current code"

        self.prompt_submitted.emit(text, self._editor)
        self._input.clear()
        self.hide()

    def _handle_commit(self, text: str):
        """Generate commit message using AI."""
        self._input.clear()
        self.hide()
        self.commit_message_requested.emit(text)

    def _on_dismiss(self):
        self.dismissed.emit()
        self.hide()

    def _on_dismiss(self):
        self.dismissed.emit()
        self.hide()
