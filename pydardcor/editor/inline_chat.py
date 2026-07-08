"""
Inline Chat Widget — VS Code parity.

Opens via Ctrl+I (when editor is focused), displays a floating panel anchored
below the current cursor line. User types a prompt; the AI response is streamed
as ghost text / diff inline in the editor.
"""
from __future__ import annotations

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QDialog, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QVBoxLayout, QWidget,
)


class InlineChatWidget(QDialog):
    """
    Floating inline chat panel — equivalent to VS Code's Ctrl+I inline chat.
    Shown as a non-modal overlay attached to the editor view.
    """

    # Emitted with the user's prompt text and the editor widget that triggered it
    prompt_submitted = Signal(str, object)  # (prompt, editor)
    dismissed = Signal()

    def __init__(self, editor_widget, parent: QWidget | None = None):
        super().__init__(parent, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self._editor = editor_widget
        self._build_ui()
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setMinimumWidth(420)
        self.setMaximumWidth(700)

    # ── UI ─────────────────────────────────────────────────

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

        icon_lbl = QLabel("\ueac8")  # codicon spark
        icon_lbl.setStyleSheet("color: #a78bfa; font-family: codicon; font-size: 14px;")

        title_lbl = QLabel("Dardcor AI (Inline)")
        title_lbl.setStyleSheet("color: #d4d4d4; font-size: 12px; font-weight: 600;")

        close_btn = QPushButton("\uea76")  # codicon close
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

        header.addWidget(icon_lbl)
        header.addWidget(title_lbl)
        header.addStretch()
        header.addWidget(close_btn)

        # Input row
        input_row = QHBoxLayout()
        input_row.setSpacing(6)

        self._input = QLineEdit()
        self._input.setPlaceholderText("Ask Dardcor AI to edit or generate code…")
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

        send_btn = QPushButton("\uea9c")  # codicon send
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

        # Hint label
        hint = QLabel("Enter to submit · Esc to dismiss · Ctrl+I to reopen")
        hint.setStyleSheet("color: #6b6b8a; font-size: 10px;")

        layout.addLayout(header)
        layout.addLayout(input_row)
        layout.addWidget(hint)

        root.addWidget(container)

        # Esc closes
        esc = QShortcut(QKeySequence("Escape"), self)
        esc.activated.connect(self._on_dismiss)

    # ── Positioning ────────────────────────────────────────

    def show_anchored(self):
        """Position the widget just below the editor's cursor region and show."""
        if self._editor and self._editor.parentWidget():
            parent_geom = self._editor.geometry()
            gp = self._editor.mapToGlobal(parent_geom.topLeft()) if hasattr(self._editor, "mapToGlobal") else self._editor.pos()
            # Try to get global position of the editor
            try:
                gp = self._editor.mapToGlobal(self._editor.rect().topLeft())
            except Exception:
                gp = self._editor.pos()

            x = gp.x() + 40
            y = gp.y() + 80
            self.move(x, y)

        self.show()
        self._input.setFocus()
        self._input.selectAll()

    # ── Slots ──────────────────────────────────────────────

    def _on_submit(self):
        text = self._input.text().strip()
        if not text:
            return
        self.prompt_submitted.emit(text, self._editor)
        self._input.clear()
        self.hide()

    def _on_dismiss(self):
        self.dismissed.emit()
        self.hide()
