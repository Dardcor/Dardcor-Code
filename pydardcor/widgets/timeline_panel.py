"""Timeline Panel - VS Code style timeline view for current file."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem
)
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor

class TimelinePanel(QWidget):
    """Panel showing local save history and git commits for the active file."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header
        header = QWidget()
        header.setFixedHeight(22)
        header.setStyleSheet("background-color: #000000;")
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(10, 0, 4, 0)
        
        title = QLabel("TIMELINE")
        title.setStyleSheet("""
            color: #cccccc;
            font-size: 11px;
            font-weight: bold;
        """)
        h_lay.addWidget(title)
        h_lay.addStretch()

        layout.addWidget(header)

        # Tree
        self._tree = QTreeWidget()
        self._tree.setHeaderHidden(True)
        self._tree.setIndentation(16)
        self._tree.setStyleSheet("""
            QTreeWidget {
                background-color: #000000;
                color: #cccccc;
                border: none;
                font-size: 12px;
                outline: none;
            }
            QTreeWidget::item {
                padding: 2px;
                border: none;
            }
            QTreeWidget::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QTreeWidget::item:hover {
                background-color: #2a2d2e;
            }
        """)
        layout.addWidget(self._tree)

    def update_timeline(self, file_path: str):
        self._tree.clear()
        if not file_path:
            return

        # Add a placeholder for now
        item = QTreeWidgetItem([f"Local Save - {os.path.basename(file_path)}"])
        item.setForeground(0, QColor("#cccccc"))
        self._tree.addTopLevelItem(item)

        item2 = QTreeWidgetItem(["Git commit: Initial commit (if tracked)"])
        item2.setForeground(0, QColor("#888888"))
        self._tree.addTopLevelItem(item2)
