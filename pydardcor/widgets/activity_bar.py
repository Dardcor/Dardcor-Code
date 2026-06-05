"""Activity Bar - VS Code style vertical icon bar."""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QPushButton, QButtonGroup
from PySide6.QtCore import Signal, Qt, QSize, QRect, QPoint
from PySide6.QtGui import QPainter, QColor, QPen, QPolygon, QPainterPath


VIEW_EXPLORER = 0
VIEW_SEARCH = 1
VIEW_SOURCE_CONTROL = 2
VIEW_DEBUG = 3
VIEW_EXTENSIONS = 4



class ActivityBarButton(QPushButton):
    """Custom painted icon button matching VS Code activity bar icons."""

    def __init__(self, icon_type: str, tooltip: str, parent=None):
        super().__init__(parent)
        self._icon_type = icon_type
        self.setToolTip(tooltip)
        self.setCheckable(True)
        self.setFixedSize(48, 48)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: none;
                border-left: 2px solid transparent;
            }
            QPushButton:hover {
                background-color: rgba(90, 93, 94, 0.31);
            }
            QPushButton:checked {
                border-left: 2px solid #4a0072;
                background-color: transparent;
            }
        """)

    def paintEvent(self, event):
        super().paintEvent(event)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        color = QColor("#ffffff") if self.isChecked() else QColor("#858585")
        pen = QPen(color, 1.5)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)

        cx, cy = 24, 24
        s = 10  # half-size

        if self._icon_type == "explorer":
            # Files icon - two overlapping documents
            painter.drawRect(cx - 6, cy - 8, 10, 14)
            painter.drawRect(cx - 3, cy - 5, 10, 14)

        elif self._icon_type == "search":
            # Magnifying glass
            painter.drawEllipse(cx - 6, cy - 7, 12, 12)
            painter.drawLine(cx + 4, cy + 3, cx + 8, cy + 7)

        elif self._icon_type == "git":
            # Git branch icon
            painter.drawEllipse(cx - 2, cy - 9, 5, 5)
            painter.drawEllipse(cx - 2, cy + 4, 5, 5)
            painter.drawEllipse(cx + 4, cy - 2, 5, 5)
            painter.drawLine(cx, cy - 4, cx, cy + 4)
            painter.drawLine(cx + 1, cy - 1, cx + 4, cy)

        elif self._icon_type == "debug":
            # Bug/Play icon
            # Play triangle
            path = QPainterPath()
            path.moveTo(cx - 5, cy - 8)
            path.lineTo(cx - 5, cy + 8)
            path.lineTo(cx + 7, cy)
            path.closeSubpath()
            painter.drawPath(path)
            # Little bug near it
            painter.drawEllipse(cx + 2, cy + 4, 4, 4)

        elif self._icon_type == "extensions":
            # Puzzle piece / extensions icon (4 blocks)
            painter.drawRect(cx - 7, cy - 3, 6, 6)
            painter.drawRect(cx + 1, cy - 3, 6, 6)
            painter.drawRect(cx - 7, cy + 4, 6, 6)
            painter.drawRect(cx + 1, cy + 4, 6, 6)
            painter.drawRect(cx - 3, cy - 9, 6, 6)

        painter.end()


class ActivityBar(QWidget):
    view_changed = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("activityBar")
        self.setFixedWidth(48)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet("""
            #activityBar {
                background-color: #000000;
                border-right: 1px solid #3c0068;
            }
        """)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._group = QButtonGroup(self)
        self._group.setExclusive(True)

        # Top icons
        self._add_button("explorer", "Explorer (Ctrl+Shift+E)", VIEW_EXPLORER)
        self._add_button("search", "Search (Ctrl+Shift+F)", VIEW_SEARCH)
        self._add_button("git", "Source Control (Ctrl+Shift+G)", VIEW_SOURCE_CONTROL)
        self._add_button("debug", "Run and Debug (Ctrl+Shift+D)", VIEW_DEBUG)
        self._add_button("extensions", "Extensions (Ctrl+Shift+X)", VIEW_EXTENSIONS)

        layout.addStretch()

        self._group.buttonClicked.connect(self._on_clicked)
        self.set_active(VIEW_EXPLORER)

    def _add_button(self, icon_type: str, tooltip: str, view_id: int):
        btn = ActivityBarButton(icon_type, tooltip)
        self._group.addButton(btn, view_id)
        self.layout().addWidget(btn)

    def _on_clicked(self, btn):
        view_id = self._group.id(btn)
        self.view_changed.emit(view_id)

    def set_active(self, view_id: int):
        btn = self._group.button(view_id)
        if btn:
            btn.setChecked(True)
