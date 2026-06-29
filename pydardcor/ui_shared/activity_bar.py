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
        self._badge_text = ""
        
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

    def set_badge(self, text: str):
        self._badge_text = text
        self.update()

    def paintEvent(self, event):
        super().paintEvent(event)
        if self._badge_text:
            from PySide6.QtGui import QPainter, QColor, QFont
            from PySide6.QtCore import Qt, QRect
            painter = QPainter(self)
            painter.setRenderHint(QPainter.Antialiasing)
            
            # Badge dimensions
            bw, bh = 16, 16
            x = self.width() - bw - 6
            y = 8
            
            # Draw blue circle
            painter.setBrush(QColor("#0078d4"))
            painter.setPen(Qt.NoPen)
            painter.drawEllipse(x, y, bw, bh)
            
            # Draw text
            painter.setPen(QColor("#ffffff"))
            f = QFont("Segoe UI", 8, QFont.Bold)
            painter.setFont(f)
            painter.drawText(QRect(x, y, bw, bh), Qt.AlignCenter, self._badge_text)

    def mousePressEvent(self, event):
        super().mousePressEvent(event)
        if event.button() == Qt.LeftButton:
            self.drag_start_pos = event.pos()

    def mouseMoveEvent(self, event):
        if not (event.buttons() & Qt.LeftButton):
            return
        if not hasattr(self, "drag_start_pos"):
            return
        if (event.pos() - self.drag_start_pos).manhattanLength() < 5:
            return
            
        from PySide6.QtGui import QDrag
        from PySide6.QtCore import QMimeData
        drag = QDrag(self)
        mime = QMimeData()
        mime.setText(f"activity_bar_btn:{self._icon_type}")
        drag.setMimeData(mime)
        drag.exec(Qt.MoveAction)


class ActivityBar(QWidget):
    view_changed = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("activityBar")
        self.setFixedWidth(48)
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setAcceptDrops(True)
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

    def set_badge(self, view_id: int, text: str):
        btn = self._group.button(view_id)
        if btn and hasattr(btn, 'set_badge'):
            btn.set_badge(text)

    def contextMenuEvent(self, event):
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu { background-color: #252526; color: #cccccc; border: 1px solid #454545; }
            QMenu::item { padding: 4px 24px 4px 24px; }
            QMenu::item:selected { background-color: #094771; color: white; }
        """)
        
        for btn in self._group.buttons():
            tooltip = btn.toolTip()
            name = tooltip.split(" (")[0] if " (" in tooltip else tooltip
            action = QAction(name, self)
            action.setCheckable(True)
            action.setChecked(btn.isVisible())
            action.toggled.connect(lambda checked, b=btn: b.setVisible(checked))
            menu.addAction(action)
            
        menu.addSeparator()
        action_move = QAction("Move Activity Bar to Right", self)
        action_move.triggered.connect(self._toggle_position)
        menu.addAction(action_move)
            
        menu.exec_(event.globalPos())

    def _toggle_position(self):
        # We find main window and emit or call a method to toggle side.
        main_win = self.window()
        if hasattr(main_win, "toggle_activity_bar_position"):
            main_win.toggle_activity_bar_position()

    def dragEnterEvent(self, event):
        if event.mimeData().hasText() and event.mimeData().text().startswith("activity_bar_btn:"):
            event.acceptProposedAction()

    def dropEvent(self, event):
        text = event.mimeData().text()
        if text.startswith("activity_bar_btn:"):
            icon_type = text.split(":")[1]
            
            # Find dragged button
            dragged_btn = None
            for btn in self._group.buttons():
                if btn._icon_type == icon_type:
                    dragged_btn = btn
                    break
                    
            if dragged_btn:
                # Find drop index
                drop_y = event.pos().y()
                layout = self.layout()
                insert_idx = 0
                for i in range(layout.count()):
                    item = layout.itemAt(i)
                    if item and item.widget() and isinstance(item.widget(), ActivityBarButton):
                        w = item.widget()
                        if drop_y > w.y() + w.height() / 2:
                            insert_idx = i + 1
                
                layout.removeWidget(dragged_btn)
                layout.insertWidget(insert_idx, dragged_btn)
                event.acceptProposedAction()

