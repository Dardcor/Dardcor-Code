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

# Extension-contributed view containers use ids starting here
EXT_VIEW_BASE = 1000



class ActivityBarButton(QPushButton):
    """Custom painted icon button matching VS Code activity bar icons."""

    def __init__(self, icon_type: str, tooltip: str, parent=None, icon_path: str = ""):
        super().__init__(parent)
        self._icon_type = icon_type
        self._icon_path = icon_path or ""
        self._ext_pixmap = None
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
        if self._icon_path:
            self._ext_pixmap = self._load_icon_pixmap(self._icon_path)
        if self._ext_pixmap is None:
            self.setText(icon_map.get(icon_type, "\ueae6"))

        self.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: none;
                border-left: 2px solid transparent;
                color: #ffffff;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.08);
                color: #ffffff;
            }
            QPushButton:checked {
                border-left: 2px solid #ffffff;
                background-color: transparent;
                color: #ffffff;
            }
        """)

    def _load_icon_pixmap(self, path):
        """Render an extension icon (SVG/PNG) tinted for the activity bar."""
        import os
        from PySide6.QtGui import QPixmap, QImage, QPainter, QColor
        from PySide6.QtCore import Qt as _Qt, QByteArray

        if not path or not os.path.exists(path):
            return None
        size = 24
        try:
            if path.lower().endswith(".svg"):
                from PySide6.QtSvg import QSvgRenderer
                with open(path, "rb") as f:
                    data = f.read()
                renderer = QSvgRenderer(QByteArray(data))
                if not renderer.isValid():
                    return None
                image = QImage(size, size, QImage.Format_ARGB32)
                image.fill(_Qt.transparent)
                painter = QPainter(image)
                painter.setRenderHint(QPainter.Antialiasing)
                renderer.render(painter)
                painter.end()
                pixmap = QPixmap.fromImage(image)
            else:
                pixmap = QPixmap(path)
                if pixmap.isNull():
                    return None
                pixmap = pixmap.scaled(size, size, _Qt.KeepAspectRatio, _Qt.SmoothTransformation)
            return pixmap
        except Exception:
            return None

    def set_badge(self, text: str):
        self._badge_text = text
        self.update()

    def paintEvent(self, event):
        super().paintEvent(event)
        if self._ext_pixmap is not None:
            from PySide6.QtGui import QPainter, QColor, QPixmap
            from PySide6.QtCore import Qt as _Qt
            painter = QPainter(self)
            painter.setRenderHint(QPainter.SmoothPixmapTransform)
            pm = self._ext_pixmap
            x = (self.width() - pm.width()) // 2
            y = (self.height() - pm.height()) // 2
            # Tint extension SVG/PNG icons white
            tinted = QPixmap(pm.size())
            tinted.fill(_Qt.transparent)
            tp = QPainter(tinted)
            tp.drawPixmap(0, 0, pm)
            tp.setCompositionMode(QPainter.CompositionMode_SourceIn)
            tp.fillRect(tinted.rect(), QColor("#ffffff"))
            tp.end()
            painter.setOpacity(1.0 if self.isChecked() or self.underMouse() else 0.75)
            painter.drawPixmap(x, y, tinted)
            painter.end()
        if self._badge_text:
            from PySide6.QtGui import QPainter, QColor, QFont
            from PySide6.QtCore import Qt, QRect
            painter = QPainter(self)
            painter.setRenderHint(QPainter.Antialiasing)
            
            f = QFont("Segoe UI", 8, QFont.Bold)
            painter.setFont(f)
            
            from PySide6.QtGui import QFontMetrics
            fm = QFontMetrics(f)
            text_width = fm.horizontalAdvance(self._badge_text)
            
            # Badge dimensions (pill shape)
            bh = 16
            bw = max(16, text_width + 8)
            x = self.width() - bw - 4
            y = self.height() - bh - 6
            
            # Draw blue pill
            painter.setBrush(QColor("#0078d4"))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(x, y, bw, bh, 8, 8)
            
            # Draw text
            painter.setPen(QColor("#ffffff"))
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
                border-right: 1px solid #2b2b2b;
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

        # Extension-contributed buttons are inserted just before this stretch
        layout.addStretch()
        self._stretch_index = layout.count() - 1
        self._ext_buttons = {}

        self._group.buttonClicked.connect(self._on_clicked)
        self.set_active(VIEW_EXPLORER)

    def _add_button(self, icon_type: str, tooltip: str, view_id: int):
        btn = ActivityBarButton(icon_type, tooltip)
        self._group.addButton(btn, view_id)
        self.layout().addWidget(btn)

    def add_extension_button(self, view_id: int, tooltip: str, icon_path: str = "",
                             icon_type: str = "extensions"):
        """Add a dynamic activity-bar button for an extension view container."""
        if view_id in self._ext_buttons:
            return
        btn = ActivityBarButton(icon_type, tooltip, icon_path=icon_path)
        self._group.addButton(btn, view_id)
        self.layout().insertWidget(self._stretch_index, btn)
        self._stretch_index += 1
        self._ext_buttons[view_id] = btn

    def clear_extension_buttons(self):
        """Remove all extension-contributed buttons (before a refresh)."""
        for view_id, btn in list(self._ext_buttons.items()):
            self._group.removeButton(btn)
            self.layout().removeWidget(btn)
            btn.setParent(None)
            btn.deleteLater()
            self._stretch_index -= 1
        self._ext_buttons.clear()

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

