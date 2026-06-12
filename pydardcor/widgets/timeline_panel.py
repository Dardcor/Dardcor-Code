"""Timeline Panel - VS Code style timeline view for current file."""

import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QTreeWidget,
    QTreeWidgetItem, QPushButton, QSizePolicy
)
from PySide6.QtCore import Qt, QSize
from PySide6.QtGui import QColor


class TimelinePanel(QWidget):
    """Panel showing local save history and git commits for the active file."""

    HEADER_HEIGHT = 22

    def __init__(self, parent=None):
        super().__init__(parent)
        self._collapsed = True
        self._setup_ui()
        self._apply_collapsed_size()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Header - VS Code style collapsible section header
        self._header = QPushButton()
        self._header.setFixedHeight(self.HEADER_HEIGHT)
        self._header.setCursor(Qt.PointingHandCursor)
        self._header.clicked.connect(self._toggle_collapse)
        self._update_header_text()
        self._header.setStyleSheet("""
            QPushButton {
                background-color: #000000;
                color: #cccccc;
                font-size: 12px;
                font-weight: bold;
                text-align: left;
                padding-left: 10px;
                border: none;
                border-top: 1px solid #2b2b2b;
            }
            QPushButton:hover {
                background-color: #1a1a1a;
            }
        """)
        layout.addWidget(self._header)

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

        # Start collapsed
        self._tree.hide()

    def _apply_collapsed_size(self):
        if self._collapsed:
            self.setFixedHeight(self.HEADER_HEIGHT)
        else:
            self.setMinimumHeight(self.HEADER_HEIGHT + 40)
            self.setMaximumHeight(16777215)  # QWIDGETSIZE_MAX

    def _update_header_text(self):
        chevron = ">" if self._collapsed else "∨"
        self._header.setText(f" {chevron}  Timeline")

    def _toggle_collapse(self):
        self._collapsed = not self._collapsed
        self._tree.setVisible(not self._collapsed)
        self._update_header_text()
        self._apply_collapsed_size()

    def sizeHint(self):
        if self._collapsed:
            return QSize(200, self.HEADER_HEIGHT)
        return super().sizeHint()

    def minimumSizeHint(self):
        return QSize(0, self.HEADER_HEIGHT)

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
