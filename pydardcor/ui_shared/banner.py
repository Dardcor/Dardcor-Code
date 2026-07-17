"""
Banner Part — TASK-0026
========================
Top notification banner mirip VS Code.
Mirip: src/vs/workbench/browser/parts/banner/bannerPart.ts
"""

from __future__ import annotations

from typing import Callable, List, Optional

try:
    from PySide6.QtWidgets import (
        QWidget, QHBoxLayout, QLabel, QPushButton, QSizePolicy
    )
    from PySide6.QtCore import Qt, Signal
    from PySide6.QtGui import QFont
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class BannerAction:
        def __init__(self, label: str, handler: Callable):
            self.label = label
            self.handler = handler

    class BannerCloseButton(QPushButton):
        """Custom close button for banner to guarantee rendering of X icon."""
        
        def __init__(self, parent=None):
            super().__init__(parent)
            from PySide6.QtCore import QSize, QByteArray
            from PySide6.QtGui import QIcon, QImage, QPainter, QPixmap
            from PySide6.QtSvg import QSvgRenderer
            
            self.setFixedSize(QSize(20, 20))
            self.setCursor(Qt.PointingHandCursor)
            self.setFlat(True)
            
            svg_x = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#b0b0b0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4.5" y1="4.5" x2="11.5" y2="11.5"></line>
                <line x1="11.5" y1="4.5" x2="4.5" y2="11.5"></line>
            </svg>'''
            
            svg_x_hover = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4.5" y1="4.5" x2="11.5" y2="11.5"></line>
                <line x1="11.5" y1="4.5" x2="4.5" y2="11.5"></line>
            </svg>'''
            
            icon = QIcon()
            
            renderer_normal = QSvgRenderer(QByteArray(svg_x))
            for size in (16, 32):
                image = QImage(size, size, QImage.Format_ARGB32)
                image.fill(Qt.transparent)
                painter = QPainter(image)
                painter.setRenderHint(QPainter.Antialiasing)
                renderer_normal.render(painter)
                painter.end()
                pixmap = QPixmap.fromImage(image)
                pixmap.setDevicePixelRatio(size / 16.0)
                icon.addPixmap(pixmap, QIcon.Normal, QIcon.Off)
                
            renderer_hover = QSvgRenderer(QByteArray(svg_x_hover))
            for size in (16, 32):
                image = QImage(size, size, QImage.Format_ARGB32)
                image.fill(Qt.transparent)
                painter = QPainter(image)
                painter.setRenderHint(QPainter.Antialiasing)
                renderer_hover.render(painter)
                painter.end()
                pixmap = QPixmap.fromImage(image)
                pixmap.setDevicePixelRatio(size / 16.0)
                icon.addPixmap(pixmap, QIcon.Active, QIcon.Off)
                icon.addPixmap(pixmap, QIcon.Selected, QIcon.Off)
                
            self.setIcon(icon)
            self.setIconSize(QSize(12, 12))
            self.setStyleSheet("QPushButton { background: transparent; border: none; padding: 0px; margin: 0px; }")

    class BannerWidget(QWidget):
        """
        Top-of-window notification banner.
        Used for important workspace-level messages.
        """

        closed = Signal()

        def __init__(self, parent: Optional[QWidget] = None):
            super().__init__(parent)
            self._message = ""
            self._icon = ""
            self._actions: List[BannerAction] = []
            self._aria_label = ""
            self.setVisible(False)
            self.setFixedHeight(28)
            self._setup_ui()

        def _setup_ui(self) -> None:
            self.setStyleSheet(
                "BannerWidget { background: #0e639c; }"
            )
            layout = QHBoxLayout(self)
            layout.setContentsMargins(10, 0, 10, 0)
            layout.setSpacing(8)

            self._icon_label = QLabel("")
            self._icon_label.setFixedWidth(16)
            self._icon_label.setStyleSheet("color: white; font-size: 14px;")
            layout.addWidget(self._icon_label, 0, Qt.AlignVCenter)

            self._message_label = QLabel("")
            self._message_label.setStyleSheet("color: white; font-size: 12px;")
            self._message_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            layout.addWidget(self._message_label, 0, Qt.AlignVCenter)

            self._actions_container = QWidget()
            self._actions_container.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Preferred)
            self._actions_layout = QHBoxLayout(self._actions_container)
            self._actions_layout.setContentsMargins(0, 0, 0, 0)
            self._actions_layout.setSpacing(4)
            layout.addWidget(self._actions_container, 0, Qt.AlignVCenter)

            self._close_btn = BannerCloseButton(self)
            self._close_btn.clicked.connect(self.dismiss)
            layout.addWidget(self._close_btn, 0, Qt.AlignVCenter)

        def show_message(
            self,
            message: str,
            *,
            icon: str = "ℹ",
            actions: Optional[List[BannerAction]] = None,
            aria_label: str = "",
            color: str = "#0e639c",
        ) -> None:
            """Show a banner message."""
            self._message = message
            self._icon = icon
            self._actions = actions or []
            self._aria_label = aria_label

            self._icon_label.setText(icon)
            self._message_label.setText(message)

            try:
                from ..app.theme_manager import ThemeManager
                theme_colors = ThemeManager.THEMES.get(ThemeManager.current_theme_id(), ThemeManager.THEMES["dardcor-purple"])["colors"]
                bg = theme_colors.get("sidebar", "#1e1e1e")
                fg = theme_colors.get("foreground", "#cccccc")
                border = theme_colors.get("border", "#3c0068")
                accent = theme_colors.get("accent", "#0e639c")
                accent_hover = theme_colors.get("accent_hover", "#1177bb")
            except Exception:
                bg = "#1e1e1e"
                fg = "#cccccc"
                border = "#3c0068"
                accent = "#0e639c"
                accent_hover = "#1177bb"

            self.setStyleSheet(f"BannerWidget {{ background: {bg}; border-bottom: 1px solid {border}; }}")
            self._icon_label.setStyleSheet(f"color: {accent}; font-size: 14px; font-weight: bold;")
            self._message_label.setStyleSheet(f"color: {fg}; font-size: 12px;")

            # Clear old action buttons
            while self._actions_layout.count():
                item = self._actions_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()

            # Add new action buttons
            for action in self._actions:
                btn = QPushButton(action.label)
                btn.setCursor(Qt.PointingHandCursor)
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background-color: {accent};
                        border: 1px solid {border};
                        color: white;
                        padding: 3px 10px;
                        font-size: 11px;
                        border-radius: 3px;
                        font-weight: bold;
                    }}
                    QPushButton:hover {{
                        background-color: {accent_hover};
                    }}
                """)
                btn.clicked.connect(action.handler)
                self._actions_layout.addWidget(btn)

            self.setVisible(True)

        def dismiss(self) -> None:
            """Hide the banner."""
            self.setVisible(False)
            self.closed.emit()

        def paintEvent(self, event) -> None:
            from PySide6.QtWidgets import QStyle, QStyleOption
            from PySide6.QtGui import QPainter
            painter = QPainter(self)
            opt = QStyleOption()
            opt.initFrom(self)
            self.style().drawPrimitive(QStyle.PE_Widget, opt, painter, self)
            super().paintEvent(event)

        def show_warning(self, message: str, **kwargs) -> None:
            self.show_message(message, icon="⚠", color="#c37e00", **kwargs)

        def show_error(self, message: str, **kwargs) -> None:
            self.show_message(message, icon="✕", color="#a1260d", **kwargs)

        def show_info(self, message: str, **kwargs) -> None:
            self.show_message(message, icon="ℹ", color="#0e639c", **kwargs)

else:
    class BannerWidget:  # type: ignore
        def __init__(self, *args, **kwargs):
            pass

        def show_message(self, *args, **kwargs):
            pass

        def dismiss(self):
            pass
