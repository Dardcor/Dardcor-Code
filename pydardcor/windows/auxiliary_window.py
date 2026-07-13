from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from PySide6.QtWidgets import QWidget
    from PySide6.QtGui import QCloseEvent

try:
    from PySide6.QtWidgets import (
        QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
        QSizePolicy, QApplication, QMenu, QMainWindow
    )
    from PySide6.QtCore import Qt, Signal, QTimer, QByteArray, QMimeData, QPoint, QRect, QObject
    from PySide6.QtGui import QFont, QCloseEvent, QDrag, QPainter, QColor, QPen, QAction
    HAS_QT = True
except ImportError:
    HAS_QT = False


if HAS_QT:
    class AuxiliaryTitleBar(QWidget):
        """Custom title bar for auxiliary windows with full styling support."""

        close_clicked = Signal()
        minimize_clicked = Signal()
        maximize_clicked = Signal()
        drag_started = Signal(QPoint)

        def __init__(self, title: str = "Auxiliary Window", parent=None):
            super().__init__(parent)
            self._title = title
            self.setFixedHeight(32)
            self.setObjectName("AuxiliaryTitleBar")
            self.setAttribute(Qt.WA_StyledBackground, True)
            self.setStyleSheet("""
                #AuxiliaryTitleBar {
                    background-color: #252526;
                    border-bottom: 1px solid #3c3c3c;
                }
            """)
            self._start_pos = None
            self._setup_ui()

        def _setup_ui(self):
            layout = QHBoxLayout(self)
            layout.setContentsMargins(8, 0, 4, 0)
            layout.setSpacing(4)

            self._title_label = QLabel(self._title)
            self._title_label.setStyleSheet("color: #cccccc; font-size: 11px; background: transparent;")
            self._title_label.setAttribute(Qt.WA_TransparentForMouseEvents)
            layout.addWidget(self._title_label)
            layout.addStretch()

            btn_style = """
                QPushButton {
                    background: transparent; border: none; color: #888;
                    font-size: 12px; padding: 2px 6px; border-radius: 2px;
                }
                QPushButton:hover { background: rgba(255,255,255,0.1); color: #fff; }
            """
            self._min_btn = QPushButton("\u2500")
            self._min_btn.setFixedSize(24, 20)
            self._min_btn.setStyleSheet(btn_style)
            self._min_btn.clicked.connect(self.minimize_clicked.emit)
            layout.addWidget(self._min_btn)

            self._max_btn = QPushButton("\u25a1")
            self._max_btn.setFixedSize(24, 20)
            self._max_btn.setStyleSheet(btn_style)
            self._max_btn.clicked.connect(self.maximize_clicked.emit)
            layout.addWidget(self._max_btn)

            close_style = """
                QPushButton {
                    background: transparent; border: none; color: #888;
                    font-size: 12px; padding: 2px 6px; border-radius: 2px;
                }
                QPushButton:hover { background: #c0392b; color: white; }
            """
            self._close_btn = QPushButton("\u2715")
            self._close_btn.setFixedSize(24, 20)
            self._close_btn.setStyleSheet(close_style)
            self._close_btn.clicked.connect(self.close_clicked.emit)
            layout.addWidget(self._close_btn)

        def set_title(self, title: str):
            self._title = title
            self._title_label.setText(title)

        def mousePressEvent(self, event):
            if event.button() == Qt.LeftButton:
                self._start_pos = event.globalPosition().toPoint()
                self.drag_started.emit(self._start_pos)
                event.accept()
            else:
                super().mousePressEvent(event)

        def mouseMoveEvent(self, event):
            if event.buttons() == Qt.LeftButton and self._start_pos is not None:
                delta = event.globalPosition().toPoint() - self._start_pos
                win = self.window()
                win.move(win.pos() + delta)
                self._start_pos = event.globalPosition().toPoint()
                event.accept()
            else:
                super().mouseMoveEvent(event)

        def mouseReleaseEvent(self, event):
            self._start_pos = None
            super().mouseReleaseEvent(event)

        def mouseDoubleClickEvent(self, event):
            if event.button() == Qt.LeftButton:
                win = self.window()
                if win.isMaximized():
                    win.showNormal()
                else:
                    win.showMaximized()
                event.accept()
            else:
                super().mouseDoubleClickEvent(event)


    class AuxiliaryWindow(QWidget):
        """Secondary window that can host any panel/view. Floats independently.
        Supports custom title bar, frameless mode, content embedding,
        IPC communication, and editor tab hosting.
        """

        closed = Signal()
        focus_gained = Signal()
        content_changed = Signal(object)

        def __init__(
            self,
            title: str = "Auxiliary Window",
            parent: Optional[QWidget] = None,
            frameless: bool = True,
            presentation_mode: bool = False,
        ):
            flags = Qt.Window
            if frameless and not presentation_mode:
                flags |= Qt.FramelessWindowHint
            if presentation_mode:
                flags |= Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
            super().__init__(parent, flags)
            self._title = title
            self._content: Optional[QWidget] = None
            self._frameless = frameless
            self._presentation_mode = presentation_mode
            self._window_id: int = id(self)
            self._is_maximized = False
            self._normal_geometry: QRect | None = None
            self._setup_ui()
            self.resize(600, 400)
            self.setAttribute(Qt.WA_DeleteOnClose, True)

            if frameless:
                self.setAttribute(Qt.WA_TranslucentBackground, False)
                self.setStyleSheet("""
                    AuxiliaryWindow {
                        background-color: #1e1e1e;
                        border: 1px solid #3c3c3c;
                    }
                """)

        def _setup_ui(self) -> None:
            self.setWindowTitle(self._title)
            layout = QVBoxLayout(self)
            layout.setContentsMargins(0, 0, 0, 0)
            layout.setSpacing(0)

            if self._frameless or self._presentation_mode:
                self._title_bar = AuxiliaryTitleBar(self._title, self)
                self._title_bar.close_clicked.connect(self.close)
                self._title_bar.minimize_clicked.connect(self.showMinimized)
                self._title_bar.maximize_clicked.connect(self._toggle_maximize)
                layout.addWidget(self._title_bar)
            else:
                self._title_bar = None

            self._content_area = QWidget()
            self._content_area.setObjectName("AuxContentArea")
            self._content_area.setStyleSheet("""
                #AuxContentArea {
                    background-color: #1e1e1e;
                }
            """)
            self._content_layout = QVBoxLayout(self._content_area)
            self._content_layout.setContentsMargins(0, 0, 0, 0)
            self._content_layout.setSpacing(0)
            layout.addWidget(self._content_area, 1)

            if self._presentation_mode:
                self._setup_presentation_overlay()

        def _setup_presentation_overlay(self):
            overlay = QLabel("Presentation Mode", self)
            overlay.setStyleSheet("""
                background: rgba(0,0,0,180); color: white;
                font-size: 14px; padding: 20px;
                border-radius: 8px;
            """)
            overlay.setAlignment(Qt.AlignCenter)
            overlay.setAttribute(Qt.WA_TransparentForMouseEvents, True)
            overlay.hide()

        def _toggle_maximize(self):
            if self._is_maximized:
                if self._normal_geometry:
                    self.setGeometry(self._normal_geometry)
                else:
                    self.showNormal()
                self._is_maximized = False
                if self._title_bar:
                    self._title_bar._max_btn.setText("\u25a1")
            else:
                self._normal_geometry = self.geometry()
                screen = QApplication.screenAt(self.mapToGlobal(QPoint(0, 0)))
                if screen:
                    self.setGeometry(screen.availableGeometry())
                else:
                    self.showMaximized()
                self._is_maximized = True
                if self._title_bar:
                    self._title_bar._max_btn.setText("\u2752")

        def set_content(self, widget: QWidget) -> None:
            old = self._content
            if old:
                self._content_layout.removeWidget(old)
                old.setParent(None)
            self._content = widget
            widget.setParent(self._content_area)
            self._content_layout.addWidget(widget)
            self.content_changed.emit(widget)

        def set_title(self, title: str) -> None:
            self._title = title
            self.setWindowTitle(title)
            if hasattr(self, "_title_bar") and self._title_bar:
                self._title_bar.set_title(title)

        def set_title_bar_visible(self, visible: bool) -> None:
            if self._title_bar:
                self._title_bar.setVisible(visible)

        def set_presentation_mode(self, enabled: bool) -> None:
            self._presentation_mode = enabled
            if enabled:
                self.showFullScreen()
                self.set_title_bar_visible(False)
            else:
                self.showNormal()
                self.set_title_bar_visible(True)

        def closeEvent(self, event: QCloseEvent) -> None:
            self.closed.emit()
            super().closeEvent(event)

        def show_and_raise(self) -> None:
            self.show()
            self.raise_()
            self.activateWindow()
            self.focus_gained.emit()

        def changeEvent(self, event):
            if event.type() == event.WindowStateChange:
                if self.windowState() & Qt.WindowActive:
                    self.focus_gained.emit()
            super().changeEvent(event)

        def nativeEvent(self, eventType, message):
            if os.name == "nt" and self._frameless:
                try:
                    import ctypes
                    from ctypes import wintypes
                    msg = wintypes.MSG.from_address(message.__int__())
                    if msg.message == 0x0084:
                        from PySide6.QtGui import QCursor
                        pos = self.mapFromGlobal(QCursor.pos())
                        w, h = self.width(), self.height()
                        b = 6
                        if pos.x() < b and pos.y() < b:
                            return True, 13
                        if pos.x() > w - b and pos.y() < b:
                            return True, 14
                        if pos.x() < b and pos.y() > h - b:
                            return True, 16
                        if pos.x() > w - b and pos.y() > h - b:
                            return True, 17
                        if pos.x() < b:
                            return True, 10
                        if pos.x() > w - b:
                            return True, 11
                        if pos.y() < b:
                            return True, 12
                        if pos.y() > h - b:
                            return True, 15
                        if self._title_bar and self._title_bar.geometry().contains(pos):
                            tb_pos = self._title_bar.mapFrom(self, pos)
                            child = self._title_bar.childAt(tb_pos)
                            if isinstance(child, QPushButton):
                                return False, 0
                            return True, 2
                except Exception:
                    pass
            return super().nativeEvent(eventType, message)


    class AuxiliaryWindowManager(QObject):
        """Manages multiple auxiliary (floating) windows with IPC support."""

        window_opened = Signal(int)
        window_closed = Signal(int)

        def __init__(self, parent=None):
            super().__init__(parent)
            self._windows: Dict[int, AuxiliaryWindow] = {}
            self._window_counter = 0

        def create_window(
            self,
            title: str = "Auxiliary Window",
            content: Optional[QWidget] = None,
            parent: Optional[QWidget] = None,
            frameless: bool = True,
            presentation_mode: bool = False,
        ) -> AuxiliaryWindow:
            win = AuxiliaryWindow(title, parent, frameless, presentation_mode)
            self._window_counter += 1
            if content:
                win.set_content(content)
            win.closed.connect(lambda: self._on_window_closed(win))
            self._windows[id(win)] = win
            self.window_opened.emit(id(win))
            return win

        def _on_window_closed(self, win: AuxiliaryWindow):
            wid = id(win)
            if wid in self._windows:
                del self._windows[wid]
                self.window_closed.emit(wid)

        def get_window(self, window_id: int) -> Optional[AuxiliaryWindow]:
            return self._windows.get(window_id)

        def get_all_windows(self) -> List[AuxiliaryWindow]:
            return list(self._windows.values())

        def close_window(self, window_id: int) -> bool:
            win = self._windows.get(window_id)
            if win:
                win.close()
                return True
            return False

        def close_all(self):
            for win in list(self._windows.values()):
                win.close()

        def broadcast_message(self, msg_type: str, data: dict | None = None):
            for win in self._windows.values():
                if hasattr(win, "handle_ipc_message"):
                    win.handle_ipc_message(msg_type, data or {})

else:
    class AuxiliaryTitleBar:
        def __init__(self, *args, **kwargs):
            pass

    class AuxiliaryWindow:
        def __init__(self, *args, **kwargs):
            pass

        def set_content(self, *args):
            pass

        def set_title(self, *args):
            pass

        def show_and_raise(self):
            pass

        def set_title_bar_visible(self, *args):
            pass

        def set_presentation_mode(self, *args):
            pass

    class AuxiliaryWindowManager:
        def create_window(self, *args, **kwargs):
            return None

        def get_window(self, *args):
            return None

        def get_all_windows(self):
            return []

        def close_window(self, *args):
            return False

        def close_all(self):
            pass
