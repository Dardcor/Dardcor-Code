"""Comments Panel - Sidebar panel displaying all active code review comments/threads."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QInputDialog
)
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QFont
from .service import CommentService

class CommentsPanel(QWidget):
    """Comments list view for the sidebar explorer/panel."""

    comment_selected = Signal(str, int)  # file, line

    def __init__(self, service: CommentService, parent=None):
        super().__init__(parent)
        self._service = service
        self._setup_ui()
        self._service.comments_updated.connect(self.refresh)
        self.refresh()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header toolbar
        toolbar = QWidget()
        toolbar.setFixedHeight(30)
        toolbar.setStyleSheet("background-color: #000000; border-bottom: 1px solid #1a0033;")
        tb_lay = QHBoxLayout(toolbar)
        tb_lay.setContentsMargins(12, 0, 8, 0)

        title = QLabel("COMMENTS")
        title.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: bold; letter-spacing: 1px;")
        tb_lay.addWidget(title)
        tb_lay.addStretch()

        refresh_btn = QPushButton("\uea98")
        refresh_btn.setFont(QFont("codicon", 11))
        refresh_btn.setFixedSize(22, 22)
        refresh_btn.setStyleSheet("""
            QPushButton { background: transparent; border: none; color: #cccccc; }
            QPushButton:hover { background: #2c004a; border-radius: 2px; }
        """)
        refresh_btn.clicked.connect(self.refresh)
        tb_lay.addWidget(refresh_btn)

        layout.addWidget(toolbar)

        # Tree widget
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 12px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 4px;
            }
            QTreeWidget::item:selected {
                background-color: #2c004a;
            }
            QTreeWidget::item:hover {
                background-color: #1a0033;
            }
        """)
        self._tree.itemDoubleClicked.connect(self._on_item_clicked)
        layout.addWidget(self._tree)

    def refresh(self):
        self._tree.clear()
        
        # Group threads by file
        files_map = {}
        for thread in self._service._threads.values():
            files_map.setdefault(thread.file_path, []).append(thread)

        if not files_map:
            placeholder = QTreeWidgetItem(self._tree)
            placeholder.setText(0, "No comments in workspace")
            placeholder.setForeground(0, QColor("#888888"))
            return

        for file_path, threads in files_map.items():
            file_item = QTreeWidgetItem(self._tree)
            file_item.setText(0, os.path.basename(file_path))
            file_item.setToolTip(0, file_path)
            file_item.setForeground(0, QColor("#bbbbbb"))
            f = file_item.font(0)
            f.setBold(True)
            file_item.setFont(0, f)
            file_item.setExpanded(True)

            for thread in sorted(threads, key=lambda t: t.line):
                # Format: line: [Author] first comment preview
                first = thread.replies[0] if thread.replies else None
                preview = first.body if first else ""
                author = first.author if first else "System"
                resolved_mark = " (Resolved)" if thread.resolved else ""
                
                thread_item = QTreeWidgetItem(file_item)
                thread_item.setText(0, f"  Line {thread.line}: [{author}] {preview}{resolved_mark}")
                thread_item.setData(0, Qt.UserRole, (file_path, thread.line))
                thread_item.setForeground(0, QColor("#999999") if thread.resolved else QColor("#cccccc"))
                
                # Render replies nested
                if len(thread.replies) > 1:
                    for reply in thread.replies[1:]:
                        rep_item = QTreeWidgetItem(thread_item)
                        rep_item.setText(0, f"    ↳ [{reply.author}] {reply.body}")
                        rep_item.setForeground(0, QColor("#888888"))
                        rep_item.setData(0, Qt.UserRole, (file_path, thread.line))

    def _on_item_clicked(self, item, col):
        data = item.data(0, Qt.UserRole)
        if data:
            file_path, line = data
            self.comment_selected.emit(file_path, line)
