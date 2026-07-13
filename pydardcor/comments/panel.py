"""Comments Panel - Sidebar panel for full comment/discussion support."""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QScrollArea, QFrame, QLineEdit, QComboBox,
    QInputDialog, QMessageBox
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont

from .service import CommentService, CommentThread


_STYLE_BASE = """
    QWidget { background-color: #000000; color: #cccccc; font-size: 12px; }
    QPushButton {
        background: transparent; border: none; color: #cccccc;
        padding: 2px 6px; border-radius: 2px; font-size: 11px;
    }
    QPushButton:hover { background: #2c004a; }
    QPushButton:pressed { background: #3c0068; }
    QPushButton:disabled { color: #555555; }
    QTextEdit { background: #0d0d0d; border: 1px solid #3c0068; border-radius: 2px; color: #cccccc; padding: 4px; font-size: 12px; }
    QLineEdit { background: #0d0d0d; border: 1px solid #3c0068; border-radius: 2px; color: #cccccc; padding: 4px; font-size: 12px; }
    QComboBox { background: #0d0d0d; border: 1px solid #3c0068; border-radius: 2px; color: #cccccc; padding: 2px 4px; font-size: 11px; }
    QComboBox::drop-down { border: none; width: 16px; }
    QComboBox::down-arrow { image: none; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 6px solid #888888; margin-right: 4px; }
    QScrollBar:vertical { background: transparent; width: 8px; }
    QScrollBar::handle:vertical { background: #2c004a; min-height: 20px; border-radius: 2px; }
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }
"""


class ThreadReplyWidget(QFrame):
    """A single reply displayed within a thread."""

    def __init__(self, author: str, body: str, timestamp: str, parent=None):
        super().__init__(parent)
        self.setStyleSheet("background: transparent; border: none; margin: 0px; padding: 0px;")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 1, 0, 1)
        layout.setSpacing(0)

        header = QLabel(f"<b style='color:#a855f7;'>{author}</b>  <span style='color:#666666;font-size:10px;'>{timestamp}</span>")
        header.setTextFormat(Qt.RichText)
        header.setStyleSheet("background: transparent; border: none; padding: 0px;")
        layout.addWidget(header)

        body_label = QLabel(body)
        body_label.setWordWrap(True)
        body_label.setStyleSheet("color: #cccccc; background: transparent; border: none; padding: 1px 0 2px 0;")
        layout.addWidget(body_label)


class CommentThreadWidget(QFrame):
    """A single comment thread with replies, actions, and inline reply input."""

    resolve_toggled = Signal(str)
    reply_added = Signal(str, str)
    thread_deleted = Signal(str)
    navigate_requested = Signal(str, int)

    def __init__(self, thread: CommentThread, parent=None):
        super().__init__(parent)
        self._thread = thread
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("""
            CommentThreadWidget {
                background: #0a0a0a; border: 1px solid #1a0033; border-radius: 3px;
                margin: 2px 4px; padding: 6px;
            }
        """)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(4)

        # Header row: line + resolved badge + action buttons
        header = QHBoxLayout()
        header.setSpacing(4)

        line_label = QLabel(f"<b style='color:#a855f7;'>Line {self._thread.line}</b>")
        line_label.setTextFormat(Qt.RichText)
        line_label.setCursor(Qt.PointingHandCursor)
        line_label.setStyleSheet("background: transparent; border: none; padding: 0px;")
        line_label.mousePressEvent = lambda e: self.navigate_requested.emit(self._thread.file_path, self._thread.line)
        header.addWidget(line_label)

        if self._thread.resolved:
            badge = QLabel("<span style='color:#4caf50;font-size:10px;'>RESOLVED</span>")
            badge.setTextFormat(Qt.RichText)
            badge.setStyleSheet("background: transparent; border: none; padding: 0px;")
            header.addWidget(badge)

        header.addStretch()

        self._resolve_btn = QPushButton("Resolve" if not self._thread.resolved else "Unresolve")
        self._resolve_btn.setFixedHeight(20)
        self._resolve_btn.setStyleSheet("QPushButton { color: #888888; font-size: 10px; } QPushButton:hover { color: #ffffff; }")
        self._resolve_btn.clicked.connect(lambda: self.resolve_toggled.emit(self._thread.id))
        header.addWidget(self._resolve_btn)

        delete_btn = QPushButton("🗑")
        delete_btn.setFixedSize(20, 20)
        delete_btn.setToolTip("Delete thread")
        delete_btn.clicked.connect(lambda: self.thread_deleted.emit(self._thread.id))
        header.addWidget(delete_btn)

        layout.addLayout(header)

        # Replies
        self._replies_widget = QWidget()
        self._replies_widget.setStyleSheet("background: transparent; border: none;")
        self._replies_layout = QVBoxLayout(self._replies_widget)
        self._replies_layout.setContentsMargins(8, 0, 0, 0)
        self._replies_layout.setSpacing(1)
        self._populate_replies()
        layout.addWidget(self._replies_widget)

        # Reply input area
        reply_row = QHBoxLayout()
        reply_row.setSpacing(4)
        self._reply_input = QLineEdit()
        self._reply_input.setPlaceholderText("Reply...")
        self._reply_input.setFixedHeight(24)
        self._reply_input.returnPressed.connect(self._send_reply)
        reply_row.addWidget(self._reply_input)

        send_btn = QPushButton("Reply")
        send_btn.setFixedHeight(24)
        send_btn.setStyleSheet("QPushButton { background: #3c0068; color: #ffffff; font-weight: bold; padding: 2px 10px; border-radius: 2px; } QPushButton:hover { background: #5a009c; }")
        send_btn.clicked.connect(self._send_reply)
        reply_row.addWidget(send_btn)
        layout.addLayout(reply_row)

    def _populate_replies(self):
        while self._replies_layout.count():
            item = self._replies_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        for i, reply in enumerate(self._thread.replies):
            reply_widget = ThreadReplyWidget(reply.author, reply.body, reply.timestamp)
            self._replies_layout.addWidget(reply_widget)

    def _send_reply(self):
        text = self._reply_input.text().strip()
        if text:
            self.reply_added.emit(self._thread.id, text)
            self._reply_input.clear()


class CommentsPanel(QWidget):
    """Sidebar panel for viewing, adding, and managing code comments."""

    comment_selected = Signal(str, int)

    def __init__(self, service: CommentService, parent=None):
        super().__init__(parent)
        self._service = service
        self._thread_widgets = []
        self._filter_mode = "current"  # "current" or "all"
        self._setup_ui()
        self._service.comments_updated.connect(self.refresh)

    def _setup_ui(self):
        self.setStyleSheet(_STYLE_BASE)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header toolbar
        toolbar = QWidget()
        toolbar.setFixedHeight(32)
        toolbar.setStyleSheet("background: #000000; border-bottom: 1px solid #1a0033;")
        tb_lay = QHBoxLayout(toolbar)
        tb_lay.setContentsMargins(8, 0, 4, 0)
        tb_lay.setSpacing(4)

        title = QLabel("COMMENTS")
        title.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: bold; letter-spacing: 1px; background: transparent; border: none;")
        tb_lay.addWidget(title)
        tb_lay.addStretch()

        self._filter_combo = QComboBox()
        self._filter_combo.addItems(["Current File", "All Files"])
        self._filter_combo.setFixedWidth(100)
        self._filter_combo.currentIndexChanged.connect(self._on_filter_changed)
        tb_lay.addWidget(self._filter_combo)

        add_btn = QPushButton("+ Add")
        add_btn.setFixedHeight(22)
        add_btn.setToolTip("Add comment at current line")
        add_btn.clicked.connect(self._add_comment_dialog)
        tb_lay.addWidget(add_btn)

        refresh_btn = QPushButton("↻")
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setToolTip("Refresh")
        refresh_btn.clicked.connect(self.refresh)
        tb_lay.addWidget(refresh_btn)

        layout.addWidget(toolbar)

        # Scroll area for thread list
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setStyleSheet("QScrollArea { background: #000000; border: none; }")

        self._container = QWidget()
        self._container.setStyleSheet("background: #000000;")
        self._container_layout = QVBoxLayout(self._container)
        self._container_layout.setContentsMargins(0, 4, 0, 4)
        self._container_layout.setSpacing(4)
        self._container_layout.addStretch()

        scroll.setWidget(self._container)
        layout.addWidget(scroll)

    def _on_filter_changed(self, idx):
        self._filter_mode = "current" if idx == 0 else "all"
        self.refresh()

    def set_current_file(self, file_path: str):
        self._service.set_current_file(file_path)
        if self._filter_mode == "current":
            self.refresh()

    def refresh(self):
        for w in self._thread_widgets:
            w.setParent(None)
            w.deleteLater()
        self._thread_widgets.clear()

        while self._container_layout.count() > 1:
            item = self._container_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        if self._filter_mode == "current" and self._service.get_current_file():
            threads = self._service.get_threads_for_file(self._service.get_current_file())
        else:
            threads = sorted(self._service.get_all_threads(), key=lambda t: t.file_path + str(t.line))

        if not threads:
            placeholder = QLabel("No comments yet.\nSelect a line and click + Add" if self._filter_mode == "current" else "No comments in workspace.")
            placeholder.setAlignment(Qt.AlignCenter)
            placeholder.setStyleSheet("color: #666666; background: transparent; border: none; padding: 20px; font-size: 11px;")
            placeholder.setWordWrap(True)
            self._container_layout.insertWidget(0, placeholder)
            return

        for thread in threads:
            w = CommentThreadWidget(thread)
            w.resolve_toggled.connect(self._on_resolve_toggled)
            w.reply_added.connect(self._on_reply_added)
            w.thread_deleted.connect(self._on_thread_deleted)
            w.navigate_requested.connect(self._on_navigate)
            self._thread_widgets.append(w)
            self._container_layout.insertWidget(self._container_layout.count() - 1, w)

    def _on_resolve_toggled(self, thread_id: str):
        self._service.toggle_resolve(thread_id)

    def _on_reply_added(self, thread_id: str, body: str):
        self._service.add_reply(thread_id, "User", body)

    def _on_thread_deleted(self, thread_id: str):
        self._service.delete_thread(thread_id)

    def _on_navigate(self, file_path: str, line: int):
        self.comment_selected.emit(file_path, line)

    def _add_comment_dialog(self):
        file_path = self._service.get_current_file()
        if not file_path:
            QMessageBox.information(self, "No File", "Open a file first to add comments.")
            return

        line, ok = QInputDialog.getInt(self, "Add Comment", "Line number:", 1, 1, 99999)
        if not ok:
            return

        body, ok = QInputDialog.getMultiLineText(self, "Add Comment", "Comment text:")
        if not ok or not body.strip():
            return

        self._service.add_comment(file_path, line, "User", body.strip())

    def add_comment_at_line(self, file_path: str, line: int, body: str):
        if file_path and body.strip():
            self._service.add_comment(file_path, line, "User", body.strip())

    def get_comment_lines(self, file_path: str) -> dict[int, list[dict]]:
        return self._service.get_comment_lines_for_file(file_path)
