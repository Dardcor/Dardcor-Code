"""Activity Bar - VS Code style vertical icon bar."""

from PySide6.QtWidgets import QWidget, QVBoxLayout, QPushButton, QButtonGroup, QMenu
from PySide6.QtCore import Signal, Qt, QSize, QRect, QPoint
from PySide6.QtGui import QPainter, QColor, QPen, QPolygon, QPainterPath, QAction


VIEW_EXPLORER = 0
VIEW_SEARCH = 1
VIEW_SOURCE_CONTROL = 2
VIEW_DEBUG = 3
VIEW_EXTENSIONS = 4
VIEW_TESTING = 5



class ActivityBarButton(QPushButton):
    """Custom painted icon button matching VS Code activity bar icons."""

    def __init__(self, icon_type: str, tooltip: str, parent=None):
        super().__init__(parent)
        self._icon_type = icon_type
        self.setToolTip(tooltip)
        self.setCheckable(True)
        self.setFixedSize(48, 48)
        self.setCursor(Qt.PointingHandCursor)
        
        from PySide6.QtGui import QFont
        font = QFont("codicon")
        font.setPixelSize(24)
        self.setFont(font)
        
        icon_map = {
            "explorer": "\ueaf0",
            "search": "\uea6d",
            "git": "\uea68",
            "debug": "\uead8",
            "extensions": "\ueae6",
            "testing": "\uebfc"
        }
        self.setText(icon_map.get(icon_type, "?"))

        self.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: none;
                border-left: 2px solid transparent;
                color: #858585;
            }
            QPushButton:hover {
                background-color: rgba(90, 93, 94, 0.31);
                color: #ffffff;
            }
            QPushButton:checked {
                border-left: 2px solid #4a0072;
                background-color: transparent;
                color: #ffffff;
            }
        """)


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
        self._add_button("testing", "Testing", VIEW_TESTING)

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

    def contextMenuEvent(self, event):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background-color: #252526; color: #cccccc; border: 1px solid #454545; }
            QMenu::item { padding: 4px 24px 4px 24px; }
            QMenu::item:selected { background-color: #094771; color: white; }
        """)
        
        for btn in self._group.buttons():
            # Extract the actual name from tooltip (e.g., "Explorer (Ctrl+Shift+E)" -> "Explorer")
            tooltip = btn.toolTip()
            name = tooltip.split(" (")[0] if " (" in tooltip else tooltip
            
            action = QAction(name, self)
            action.setCheckable(True)
            action.setChecked(btn.isVisible())
            # Capture btn in lambda correctly
            action.toggled.connect(lambda checked, b=btn: b.setVisible(checked))
            menu.addAction(action)
            
        menu.exec_(event.globalPos())

