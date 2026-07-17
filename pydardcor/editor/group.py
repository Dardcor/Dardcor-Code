import os
import json
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTabBar, QPushButton,
    QStackedWidget, QLabel, QMessageBox, QFileDialog, QScrollArea,
    QLayout, QMenu
)
from PySide6.QtCore import Signal, Qt, QSize, QTimer, QByteArray, QPoint, QRect, QMimeData
from PySide6.QtGui import QPixmap, QIcon, QPainter, QColor, QFont, QImage, QPen
from PySide6.QtSvg import QSvgRenderer

from .widget import MonacoEditorWidget
from .diff_viewer import MonacoDiffEditorWidget
from ..file_explorer.panel import get_file_icon
from dardcor_agent.models.main_dialog import FlowLayout


class DropTargetOverlay(QWidget):
    """Semi-transparent overlay drawn over the editor group to show split-screen drop zones (VS Code style)."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, True)
        self.setAttribute(Qt.WA_NoSystemBackground, True)
        self.setStyleSheet("background: transparent;")
        self._highlight_rect = None
        self.hide()

    def set_highlight(self, rect):
        self._highlight_rect = rect
        self.setGeometry(self.parentWidget().rect())
        self.show()
        self.update()

    def paintEvent(self, event):
        if self._highlight_rect:
            painter = QPainter(self)
            painter.setRenderHint(QPainter.Antialiasing)
            # Translucent purple highlight overlay with solid border
            painter.fillRect(self._highlight_rect, QColor(124, 58, 237, 70))
            pen = QPen(QColor(124, 58, 237, 180), 2)
            painter.setPen(pen)
            painter.drawRect(self._highlight_rect.adjusted(1, 1, -1, -1))


class FlowTabButton(QWidget):
    """Custom tab item widget for FlowTabContainer, supporting icons, close buttons, and tooltips."""
    clicked = Signal(int)
    close_requested = Signal(int)
    context_menu_requested = Signal(int, QPoint)
    middle_clicked = Signal(int)
    double_clicked = Signal(int)

    def __init__(self, index: int, icon: QIcon, title: str, is_active: bool, is_preview: bool, parent=None):
        super().__init__(parent)
        self.index = index
        self.is_active = is_active
        self.is_preview = is_preview
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setCursor(Qt.PointingHandCursor)
        self.setMouseTracking(True)
        self._init_ui(icon, title)

    def _init_ui(self, icon, title):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 4, 6, 4)
        layout.setSpacing(6)

        # Pin icon for pinned tabs
        self._pin_label = QLabel('\ueb5a')
        self._pin_label.setFont(QFont('codicon', 10))
        self._pin_label.setStyleSheet("color: #7c3aed; background: transparent;")
        self._pin_label.setFixedWidth(14)
        self._pin_label.setVisible(False)
        layout.addWidget(self._pin_label)

        # Icon
        self.icon_label = QLabel()
        if not icon.isNull():
            self.icon_label.setPixmap(icon.pixmap(14, 14))
        layout.addWidget(self.icon_label)

        # Title
        self.title_label = QLabel(title)
        font = self.font()
        font.setPointSize(9)
        if self.is_preview:
            font.setItalic(True)
        self.title_label.setFont(font)
        if self.is_active:
            self.title_label.setStyleSheet("color: #ffffff; font-weight: bold;")
        else:
            self.title_label.setStyleSheet("color: #8b8b8b;")
        layout.addWidget(self.title_label)

        # Close button
        self.close_btn = TabCloseButton(self)
        self.close_btn.setFixedSize(16, 16)
        self.close_btn.setIconSize(QSize(10, 10))
        self.close_btn.clicked.connect(lambda: self.close_requested.emit(self.index))
        layout.addWidget(self.close_btn)

        # Active tab style has high contrast background
        if self.is_active:
            bg_color = "#000000"
            border_bottom = "none"
        else:
            bg_color = "#0d0d0d"
            border_bottom = "1px solid #1a0033"

        self.setStyleSheet(f"""
            FlowTabButton {{
                background-color: {bg_color};
                border-right: 1px solid #1a0033;
                border-bottom: {border_bottom};
                border-radius: 0px;
            }}
        """)

        if not self.is_active:
            self.close_btn.hide()

    def enterEvent(self, event):
        super().enterEvent(event)
        if not self.is_active:
            self.setStyleSheet("""
                FlowTabButton {
                    background-color: #1a0033;
                    border-right: 1px solid #1a0033;
                    border-radius: 0px;
                }
            """)
            self.close_btn.show()

    def leaveEvent(self, event):
        super().leaveEvent(event)
        from PySide6.QtGui import QCursor
        if self.rect().contains(self.mapFromGlobal(QCursor.pos())):
            return # Cursor is still inside tab (e.g. over close button)

        if not self.is_active:
            self.setStyleSheet("""
                FlowTabButton {
                    background-color: #0d0d0d;
                    border-right: 1px solid #1a0033;
                    border-bottom: 1px solid #1a0033;
                    border-radius: 0px;
                }
            """)
            self.close_btn.hide()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.clicked.emit(self.index)
        elif event.button() == Qt.MiddleButton:
            self.middle_clicked.emit(self.index)
        super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.double_clicked.emit(self.index)
        super().mouseDoubleClickEvent(event)

    def contextMenuEvent(self, event):
        self.context_menu_requested.emit(self.index, event.globalPos())


class FlowTabContainer(QWidget):
    """Layout container that wraps tabs across multiple rows (multi-row tabs option)."""
    tab_close_requested = Signal(int)
    tab_changed = Signal(int)
    tab_double_clicked = Signal(int)
    context_menu_requested = Signal(int, QPoint)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.flow_layout = FlowLayout(self, margin=2, hSpacing=2, vSpacing=2)
        self.setStyleSheet("background-color: #000000; border-bottom: 1px solid #3c0068;")
        self.buttons = []

    def clear(self):
        for btn in self.buttons:
            self.flow_layout.removeWidget(btn)
            btn.deleteLater()
        self.buttons.clear()

    def rebuild_tabs(self, tabs, active_idx):
        self.clear()
        for i, tab in enumerate(tabs):
            icon = get_file_icon(tab.file_path) if tab.file_path else get_file_icon("untitled.txt")
            title = tab.title
            if tab.editor.is_dirty() and not title.startswith("● "):
                title = "● " + title
            
            btn = FlowTabButton(i, icon, title, i == active_idx, tab.is_preview, self)
            if tab.is_pinned:
                btn._pin_label.setVisible(True)
            btn.clicked.connect(self.tab_changed.emit)
            btn.close_requested.connect(self.tab_close_requested.emit)
            btn.middle_clicked.connect(self.tab_close_requested.emit)
            btn.double_clicked.connect(self.tab_double_clicked.emit)
            btn.context_menu_requested.connect(self.context_menu_requested.emit)
            
            self.flow_layout.addWidget(btn)
            self.buttons.append(btn)






class EditorTab:
    """Metadata for a single editor tab."""
    def __init__(self, editor: MonacoEditorWidget, file_path: str = None):
        self.editor = editor
        self.file_path = file_path
        self.title = os.path.basename(file_path) if file_path else "Untitled"
        self.is_pinned = False
        self.is_preview = False  # VS Code preview mode (italic tab, single-click)


class TabCloseButton(QPushButton):
    """Custom close button for tabs to guarantee rendering of X icon."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(QSize(22, 22))
        self.setCursor(Qt.PointingHandCursor)
        self.setFlat(True)
        
        # Render the 'X' SVG icon
        svg_x = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#969696" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="4" x2="12" y2="12"></line>
            <line x1="12" y1="4" x2="4" y2="12"></line>
        </svg>'''
        
        svg_x_hover = b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="4" x2="12" y2="12"></line>
            <line x1="12" y1="4" x2="4" y2="12"></line>
        </svg>'''
        
        self._icon = QIcon()
        
        # Render normal state
        renderer_normal = QSvgRenderer(QByteArray(svg_x))
        for size in (16, 32, 48):
            image = QImage(size, size, QImage.Format_ARGB32)
            image.fill(Qt.transparent)
            painter = QPainter(image)
            painter.setRenderHint(QPainter.Antialiasing)
            renderer_normal.render(painter)
            painter.end()
            pixmap = QPixmap.fromImage(image)
            pixmap.setDevicePixelRatio(size / 16.0)
            self._icon.addPixmap(pixmap, QIcon.Normal, QIcon.Off)
            
        # Render active state (hover)
        renderer_hover = QSvgRenderer(QByteArray(svg_x_hover))
        for size in (16, 32, 48):
            image = QImage(size, size, QImage.Format_ARGB32)
            image.fill(Qt.transparent)
            painter = QPainter(image)
            painter.setRenderHint(QPainter.Antialiasing)
            renderer_hover.render(painter)
            painter.end()
            pixmap = QPixmap.fromImage(image)
            pixmap.setDevicePixelRatio(size / 16.0)
            self._icon.addPixmap(pixmap, QIcon.Active, QIcon.Off)
            self._icon.addPixmap(pixmap, QIcon.Active, QIcon.On)
            self._icon.addPixmap(pixmap, QIcon.Normal, QIcon.On)
            
        self.setIcon(self._icon)
        self.setIconSize(QSize(16, 16))
        
        self.setStyleSheet("""
            QPushButton {
                background: transparent;
                border: none;
                padding: 0px;
            }
            QPushButton:hover {
                background: transparent;
            }
        """)


class TabScrollArea(QScrollArea):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWidgetResizable(True)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        from PySide6.QtWidgets import QFrame
        self.setFrameShape(QFrame.NoFrame)
        self._hover_style = """
            QScrollArea {
                background: transparent;
                border: none;
            }
            QScrollBar:horizontal {
                border: none;
                background: transparent;
                height: 3px; /* Just tall enough for the line */
                margin: 0px 0px 0px 0px;
            }
            QScrollBar::handle:horizontal {
                background: #6a1b9a;
                min-width: 30px;
                border-radius: 1px;
                margin: 0px 0px 0px 0px; /* Flush with bottom */
            }
            QScrollBar::handle:horizontal:hover {
                background: #4a0072;
            }
            QScrollBar::add-line:horizontal {
                width: 0px;
                background: transparent;
            }
            QScrollBar::sub-line:horizontal {
                width: 0px;
                background: transparent;
            }
        """
        self._hidden_style = """
            QScrollArea {
                background: transparent;
                border: none;
            }
            QScrollBar:horizontal {
                height: 0px;
                margin: 0px;
            }
        """
        self.setStyleSheet(self._hidden_style)

    def enterEvent(self, event):
        super().enterEvent(event)
        self.setStyleSheet(self._hover_style)

    def leaveEvent(self, event):
        super().leaveEvent(event)
        self.setStyleSheet(self._hidden_style)

class DardcorTabBar(QTabBar):
    """Custom tab bar that shows close button only on selected/hovered tabs."""
    tab_double_clicked = None  # Will be set as Signal by EditorGroup
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMovable(True)
        self.setExpanding(False)
        self.setDrawBase(False)
        self.setElideMode(Qt.ElideNone)
        self.setUsesScrollButtons(False)
        self.setDocumentMode(True)
        self._hovered_tab = -1
        self.setMouseTracking(True)
        self.setTabsClosable(True)
        self.setIconSize(QSize(16, 16))
        self._init_style()
        self._double_click_callback = None  # Callback for double-click on preview tab
        self._drag_start_pos = None
        self._drag_tab_idx = -1
        
    def minimumSizeHint(self):
        return self.sizeHint()
        
    def event(self, event):
        from PySide6.QtCore import QEvent
        if event.type() == QEvent.LayoutRequest:
            self.setMinimumWidth(self.sizeHint().width())
        return super().event(event)
        
    def _init_style(self):
        self.setStyleSheet("""
            QTabBar {
                background: transparent;
                border: none;
            }
            QTabBar::tab {
                background: #0d0d0d;
                color: #969696;
                padding: 6px 6px 6px 10px;
                border: none;
                border-right: 1px solid #1a0033;
                min-width: 0px;
                font-size: 12px;
            }
            QTabBar::tab:selected {
                background: #000000;
                color: #cccccc;
                border-top: none;
                border-bottom: none;
            }
            QTabBar::tab:hover:!selected {
                background: #1a0033;
                color: #cccccc;
            }
            QTabBar::tab:pinned {
                border-left: 2px solid #7c3aed;
                color: #7c3aed;
            }
            /* Style native close button to be hidden completely */
            QTabBar::close-button {
                image: none;
                width: 0px;
                height: 0px;
                background: transparent;
            }
        """)

    def tabInserted(self, index):
        super().tabInserted(index)
        btn = TabCloseButton(self)
        btn.clicked.connect(lambda: self._handle_close_clicked(btn))
        self.setTabButton(index, QTabBar.RightSide, btn)
        QTimer.singleShot(0, self._update_close_buttons)
        
    def tabRemoved(self, index):
        super().tabRemoved(index)
        QTimer.singleShot(0, self._update_close_buttons)

    def mousePressEvent(self, event):
        super().mousePressEvent(event)
        if event.button() == Qt.LeftButton:
            self._drag_start_pos = event.pos()
            self._drag_tab_idx = self.tabAt(event.pos())
        
    def mouseMoveEvent(self, event):
        super().mouseMoveEvent(event)
        idx = self.tabAt(event.pos())
        if idx != self._hovered_tab:
            self._hovered_tab = idx
            self._update_close_buttons()

        # Custom Tab Drag to split detection
        if (event.buttons() & Qt.LeftButton) and getattr(self, "_drag_start_pos", None):
            from PySide6.QtWidgets import QApplication
            if (event.pos() - self._drag_start_pos).manhattanLength() >= QApplication.startDragDistance():
                if 0 <= self._drag_tab_idx < self.count():
                    self._start_tab_drag(self._drag_tab_idx)
                    self._drag_start_pos = None
            
    def _start_tab_drag(self, idx):
        from PySide6.QtGui import QDrag
        from PySide6.QtCore import QMimeData, QByteArray
        
        group = self.parentWidget()
        while group is not None and not hasattr(group, "_tabs"):
            group = group.parentWidget()
            
        if not group or idx >= len(group._tabs):
            return
            
        tab = group._tabs[idx]
        
        drag = QDrag(self)
        mime = QMimeData()
        
        info = {
            "source_group_id": id(group),
            "tab_index": idx,
            "file_path": tab.file_path or ""
        }
        mime.setData("application/x-dardcor-tab", QByteArray(json.dumps(info).encode('utf-8')))
        if tab.file_path:
            mime.setText(tab.file_path)
            
        drag.setMimeData(mime)
        
        pixmap = self.grab(self.tabRect(idx))
        drag.setPixmap(pixmap)
        drag.setHotSpot(self._drag_start_pos)
        
        drag.exec_(Qt.MoveAction)

    def leaveEvent(self, event):
        super().leaveEvent(event)
        self._hovered_tab = -1
        self._update_close_buttons()
        
    def _editor_group(self):
        group = self.parentWidget()
        while group is not None and not hasattr(group, "_tabs"):
            group = group.parentWidget()
        return group if group is not None and hasattr(group, "_tabs") else None

    def _is_tab_pinned(self, idx):
        group = self._editor_group()
        return group is not None and 0 <= idx < len(group._tabs) and group._tabs[idx].is_pinned

    def _request_close_tab(self, idx):
        if idx < 0 or self._is_tab_pinned(idx):
            return
        self.tabCloseRequested.emit(idx)

    def _handle_close_clicked(self, btn):
        for i in range(self.count()):
            if self.tabButton(i, QTabBar.RightSide) is btn or self.tabButton(i, QTabBar.LeftSide) is btn:
                self._request_close_tab(i)
                return
                
    def _update_close_buttons(self):
        current = self.currentIndex()
        for i in range(self.count()):
            btn = self.tabButton(i, QTabBar.RightSide) or self.tabButton(i, QTabBar.LeftSide)
            if btn and isinstance(btn, TabCloseButton):
                if self._is_tab_pinned(i):
                    btn.setVisible(False)
                elif i == current or i == self._hovered_tab:
                    btn.setVisible(True)
                else:
                    btn.setVisible(False)

    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.LeftButton:
            idx = self.tabAt(event.pos())
            if idx >= 0 and self._double_click_callback:
                self._double_click_callback(idx)
        super().mouseDoubleClickEvent(event)

    def mouseReleaseEvent(self, event):
        super().mouseReleaseEvent(event)
        if event.button() == Qt.MiddleButton:
            idx = self.tabAt(event.pos())
            if idx >= 0:
                self._request_close_tab(idx)

    def contextMenuEvent(self, event):
        idx = self.tabAt(event.pos())
        group = self.parentWidget()
        while group is not None and not hasattr(group, "_tabs"):
            group = group.parentWidget()
            
        if idx < 0:
            if group and hasattr(group, "_tab_bar"):
                group._tab_bar._show_empty_tab_menu(event.globalPos())
            return
            
        if group and hasattr(group, "show_tab_context_menu"):
            group.show_tab_context_menu(idx, event.globalPos())

    def _execute_cmd(self, cmd_id):
        p = self.parentWidget()
        while p:
            if hasattr(p, "_execute_command"):
                p._execute_command(cmd_id)
                return
            p = p.parentWidget()

    def _show_empty_tab_menu(self, global_pos):
        from PySide6.QtGui import QAction
        from PySide6.QtWidgets import QMenu
        from ..app.theme_manager import ThemeManager

        menu = QMenu(self)
        c = ThemeManager.THEMES.get(ThemeManager.current_theme_id(), ThemeManager.THEMES["dardcor-purple"])["colors"]
        menu.setStyleSheet(f"""
            QMenu {{
                background-color: {c["background"]};
                color: {c["foreground"]};
                border: 1px solid {c["border"]};
                padding: 4px 0px;
                font-size: 12px;
            }}
            QMenu::item {{
                padding: 5px 28px 5px 12px;
                min-width: 210px;
            }}
            QMenu::item:selected {{
                background-color: {c["selection"]};
                color: {c["activity_bar_fg"]};
            }}
            QMenu::item:disabled {{
                color: #666666;
            }}
            QMenu::separator {{
                height: 1px;
                background: {c["border"]};
                margin: 4px 0px;
            }}
        """)

        for label, shortcut, cmd_id in [
            ("New Text File", "Ctrl+N", "file.new"),
            ("Open File...", "Ctrl+P", "file.open"),
        ]:
            action = QAction(label, self)
            action.setShortcut(shortcut)
            action.triggered.connect(lambda checked=False, c=cmd_id: self._execute_cmd(c))
            menu.addAction(action)

        menu.addSeparator()
        terminal = QAction("New Terminal", self)
        terminal.triggered.connect(lambda: self._execute_cmd("workbench.action.createTerminalEditor"))
        menu.addAction(terminal)

        menu.addSeparator()
        for label, shortcut, cmd_id in [
            ("Split Up", "Ctrl+K Ctrl+\\", "view.splitEditorUp"),
            ("Split Down", "", "view.splitEditorDown"),
            ("Split Left", "", "view.splitEditorLeft"),
            ("Split Right", "", "view.splitEditorRight"),
        ]:
            action = QAction(label, self)
            if shortcut:
                action.setShortcut(shortcut)
            action.triggered.connect(lambda checked=False, c=cmd_id: self._execute_cmd(c))
            menu.addAction(action)

        menu.addSeparator()
        for label in ("Move into New Window", "Copy into New Window"):
            action = QAction(label, self)
            action.setEnabled(False)
            menu.addAction(action)

        menu.addSeparator()
        tab_bar_menu = menu.addMenu("Tab Bar")
        tab_bar_menu.setEnabled(False)
        editor_actions_menu = menu.addMenu("Editor Actions Position")
        editor_actions_menu.setEnabled(False)

        menu.addSeparator()
        configure_tabs = QAction("Configure Tabs", self)
        configure_tabs.setEnabled(False)
        menu.addAction(configure_tabs)

        menu.exec(global_pos)


class WelcomeWidget(QScrollArea):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWidgetResizable(True)
        self.setFrameShape(QScrollArea.NoFrame)
        self.setStyleSheet("background-color: #000000; border: none;")
        
        self.container = QWidget()
        self.container.setStyleSheet("background-color: #000000;")
        vl = QVBoxLayout(self.container)
        vl.setAlignment(Qt.AlignCenter)
        vl.setSpacing(16)

        # Logo
        logo = QLabel()
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        logo_path = os.path.join(base_dir, "image", "dardcor.png")
        pixmap = QPixmap(logo_path)
        if not pixmap.isNull():
            pixmap = pixmap.scaled(120, 120, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            logo.setPixmap(pixmap)
        logo.setAlignment(Qt.AlignCenter)
        vl.addWidget(logo)

        title = QLabel("Dardcor Code")
        title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet("color: #4a0072; font-size: 42px; font-weight: bold; letter-spacing: 2px;")
        vl.addWidget(title)

        sub = QLabel("Editing evolved")
        sub.setAlignment(Qt.AlignCenter)
        sub.setStyleSheet("color: #555555; font-size: 16px;")
        vl.addWidget(sub)

        vl.addSpacing(24)

        # Wrapper to perfectly center the button block
        wrapper = QWidget()
        h_layout = QHBoxLayout(wrapper)
        h_layout.setContentsMargins(0, 0, 0, 0)
        h_layout.addStretch()

        # Container for buttons to keep them left-aligned internally
        btn_container = QWidget()
        btn_layout = QVBoxLayout(btn_container)
        btn_layout.setSpacing(8)
        btn_layout.setContentsMargins(0, 0, 0, 0)

        for label, shortcut, cmd in [
            ("Open File...", "Ctrl+O", "file.open"),
            ("Open Folder...", "Ctrl+K", "file.openFolder"),
            ("New File", "Ctrl+N", "file.new"),
        ]:
            btn = QPushButton(f"{label}  {shortcut}")
            btn.setCursor(Qt.PointingHandCursor)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    color: #4a90d9;
                    border: none;
                    font-size: 14px;
                    text-align: left;
                    padding: 4px 8px;
                }
                QPushButton:hover { color: #7ab8f5; }
            """)
            btn.clicked.connect(lambda checked=False, c=cmd: self._execute_cmd(c))
            btn_layout.addWidget(btn)

        h_layout.addWidget(btn_container)
        h_layout.addStretch()

        vl.addWidget(wrapper)
        self.setWidget(self.container)

    def _execute_cmd(self, cmd_id):
        p = self.parentWidget()
        while p:
            if hasattr(p, "_execute_command"):
                p._execute_command(cmd_id)
                break
            p = p.parentWidget()

    def _open_recent_path(self, path):
        p = self.parentWidget()
        while p:
            if os.path.isfile(path) and hasattr(p, "_open_file_in_editor"):
                p._open_file_in_editor(path)
                return
            if os.path.isdir(path) and hasattr(p, "_file_explorer"):
                p._file_explorer.set_root(path)
                p._on_root_changed(path)
                return
            p = p.parentWidget()

    def refresh_recent(self):
        pass
            
    def contextMenuEvent(self, event):
        from PySide6.QtWidgets import QMenu
        from PySide6.QtGui import QAction
        menu = QMenu(self)
        menu.setStyleSheet("""
            QMenu {
                background-color: #1f1f1f;
                color: #cccccc;
                border: 1px solid #3c3c3c;
                padding: 4px 0px;
                font-size: 12px;
            }
            QMenu::item {
                padding: 5px 28px 5px 12px;
                min-width: 170px;
            }
            QMenu::item:selected {
                background-color: #04395e;
                color: #ffffff;
            }
            QMenu::item:disabled {
                color: #666666;
            }
            QMenu::separator {
                height: 1px;
                background: #343434;
                margin: 4px 0px;
            }
        """)
        new_file = QAction("New Text File", self)
        new_file.triggered.connect(lambda: self._execute_cmd("file.new"))
        menu.addAction(new_file)
        
        open_file = QAction("Open File...", self)
        open_file.triggered.connect(lambda: self._execute_cmd("file.open"))
        menu.addAction(open_file)
        
        open_folder = QAction("Open Folder...", self)
        open_folder.triggered.connect(lambda: self._execute_cmd("file.openFolder"))
        menu.addAction(open_folder)
        
        menu.addSeparator()
        
        open_terminal = menu.addAction("New Terminal")
        open_terminal.triggered.connect(lambda: self._execute_cmd("workbench.action.createTerminalEditor"))
        
        menu.addSeparator()
        for label in ("Split Up", "Split Down", "Split Left", "Split Right"):
            action = QAction(label, self)
            action.setEnabled(False)
            menu.addAction(action)

        menu.addSeparator()
        new_window = QAction("New Window", self)
        new_window.setEnabled(False)
        menu.addAction(new_window)

        menu.addSeparator()
        lock_group = QAction("Lock Group", self)
        lock_group.setEnabled(False)
        menu.addAction(lock_group)
        
        menu.exec(event.globalPos())



class EditorGroup(QWidget):
    """VS Code-style editor tab manager with Monaco instances (Single Group)."""

    tab_changed = Signal(str, str)  # file_path, language
    dirty_changed = Signal(bool)
    group_empty = Signal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._tabs = []
        self._current_idx = -1
        self._untitled_counter = 0
        self._preview_idx = -1  # Index of the current preview tab (-1 = none)
        self._setup_ui()
        self.setAcceptDrops(True)

    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat("application/x-dardcor-tab") or event.mimeData().hasUrls():
            event.acceptProposedAction()
            self._show_drop_overlay(event.position().toPoint())
        else:
            super().dragEnterEvent(event)

    def dragMoveEvent(self, event):
        if event.mimeData().hasFormat("application/x-dardcor-tab") or event.mimeData().hasUrls():
            event.acceptProposedAction()
            self._show_drop_overlay(event.position().toPoint())
        else:
            super().dragMoveEvent(event)

    def dragLeaveEvent(self, event):
        self._hide_drop_overlay()
        super().dragLeaveEvent(event)

    def dropEvent(self, event):
        self._hide_drop_overlay()
        if event.mimeData().hasFormat("application/x-dardcor-tab"):
            event.acceptProposedAction()
            
            info = json.loads(event.mimeData().data("application/x-dardcor-tab").data().decode('utf-8'))
            source_group_id = info.get("source_group_id")
            tab_idx = info.get("tab_index")
            
            direction = self._get_drop_direction(event.position().toPoint())
            
            win = self.window()
            source_group = None
            if win and hasattr(win, "_editor_tabs"):
                for g in win._editor_tabs._groups:
                    if id(g) == source_group_id:
                        source_group = g
                        break
            
            if not source_group or tab_idx >= len(source_group._tabs):
                return
                
            tab_to_move = source_group._tabs[tab_idx]
            
            if direction == "center":
                if source_group == self:
                    return
                # Move editor tab to this group
                editor = tab_to_move.editor
                source_group._tabs.pop(tab_idx)
                source_group._stack.removeWidget(editor)
                source_group._sync_tab_bar()
                if not source_group._tabs:
                    source_group._stack.setCurrentWidget(source_group._welcome)
                    source_group._current_idx = -1
                
                editor.setParent(self)
                self._tabs.append(tab_to_move)
                self._stack.addWidget(editor)
                self._current_idx = len(self._tabs) - 1
                self._sync_tab_bar()
                self._stack.setCurrentWidget(editor)
                self._emit_tab_changed(editor)
            else:
                # Split editor in target direction
                win = self.window()
                if win and hasattr(win, "_editor_tabs"):
                    new_group = win._editor_tabs._add_group()
                    editor = tab_to_move.editor
                    source_group._tabs.pop(tab_idx)
                    source_group._stack.removeWidget(editor)
                    source_group._sync_tab_bar()
                    if not source_group._tabs:
                        source_group._stack.setCurrentWidget(source_group._welcome)
                        source_group._current_idx = -1
                        
                    editor.setParent(new_group)
                    new_group._tabs.append(tab_to_move)
                    new_group._stack.addWidget(editor)
                    new_group._current_idx = 0
                    new_group._sync_tab_bar()
                    new_group._stack.setCurrentWidget(editor)
                    new_group._emit_tab_changed(editor)
                    
                    win._editor_tabs.grid_system.split(self, new_group, direction)
                    win._editor_tabs._active_group_idx = win._editor_tabs._groups.index(new_group)
                    
        elif event.mimeData().hasUrls():
            event.acceptProposedAction()
            for url in event.mimeData().urls():
                local_path = url.toLocalFile()
                if local_path and os.path.exists(local_path):
                    if os.path.isfile(local_path):
                        self.open_file(local_path)
                    elif os.path.isdir(local_path):
                        win = self.window()
                        if win and hasattr(win, "_open_folder"):
                            win._open_folder(local_path)

    def _get_drop_direction(self, pos: QPoint) -> str:
        w = self.width()
        h = self.height()
        x = pos.x()
        y = pos.y()
        margin_w = w * 0.25
        margin_h = h * 0.25
        
        if x < margin_w: return "left"
        if x > w - margin_w: return "right"
        if y < margin_h: return "up"
        if y > h - margin_h: return "down"
        return "center"

    def _show_drop_overlay(self, pos: QPoint):
        if not hasattr(self, "_drop_overlay") or self._drop_overlay is None:
            self._drop_overlay = DropTargetOverlay(self)
            
        direction = self._get_drop_direction(pos)
        w = self.width()
        h = self.height()
        
        if direction == "left":
            rect = QRect(0, 0, int(w * 0.5), h)
        elif direction == "right":
            rect = QRect(int(w * 0.5), 0, int(w * 0.5), h)
        elif direction == "up":
            rect = QRect(0, 0, w, int(h * 0.5))
        elif direction == "down":
            rect = QRect(0, int(h * 0.5), w, int(h * 0.5))
        else:
            rect = self.rect()
            
        self._drop_overlay.set_highlight(rect)

    def _hide_drop_overlay(self):
        if hasattr(self, "_drop_overlay") and self._drop_overlay:
            self._drop_overlay.hide()

    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # Debug Toolbar (hidden by default)
        self._debug_toolbar = QWidget()
        self._debug_toolbar.setFixedHeight(30)
        self._debug_toolbar.setStyleSheet("background-color: #1a0033; border-bottom: 1px solid #3c0068;")
        dt_lay = QHBoxLayout(self._debug_toolbar)
        dt_lay.setContentsMargins(10, 0, 10, 0)
        
        lbl = QLabel("DEBUGGING")
        lbl.setStyleSheet("color: #bbbbbb; font-size: 11px; font-weight: bold;")
        dt_lay.addWidget(lbl)
        
        for text, tooltip in [("⏸", "Pause"), ("⏭", "Step Over"), ("⬇", "Step Into"), ("⬆", "Step Out"), ("🔄", "Restart"), ("⏹", "Stop")]:
            btn = QPushButton(text)
            btn.setFixedSize(24, 24)
            btn.setToolTip(tooltip)
            btn.setStyleSheet("QPushButton { background: transparent; color: #cccccc; border: none; font-size: 14px;} QPushButton:hover { background: #2c004a; border-radius: 3px; }")
            dt_lay.addWidget(btn)
        
        dt_lay.addStretch()
        self._debug_toolbar.hide()
        layout.addWidget(self._debug_toolbar)

        # Tab bar row (dynamic height to support wrapping)
        self._tab_row = QWidget()
        self._tab_row.setStyleSheet("background-color: #000000; border-bottom: 1px solid #3c0068;")
        self._tab_row.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tab_row.customContextMenuRequested.connect(
            lambda pos: self._tab_bar._show_empty_tab_menu(self._tab_row.mapToGlobal(pos))
        )
        self._tab_row.hide()
        
        self._tab_row_layout = QVBoxLayout(self._tab_row)
        self._tab_row_layout.setContentsMargins(0, 0, 0, 0)
        self._tab_row_layout.setSpacing(0)

        # 1. Scroll Tab Widget
        self._scroll_tab_widget = QWidget()
        self._scroll_tab_widget.setFixedHeight(35)
        row_layout = QHBoxLayout(self._scroll_tab_widget)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(0)

        self._tab_bar = DardcorTabBar()
        self._tab_bar.tabCloseRequested.connect(self._close_tab)
        self._tab_bar.currentChanged.connect(self._on_tab_changed)
        self._tab_bar._double_click_callback = self._on_tab_double_clicked
        self._tab_scroll = TabScrollArea()
        self._tab_scroll.setWidget(self._tab_bar)
        self._tab_scroll.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tab_scroll.customContextMenuRequested.connect(
            lambda pos: self._tab_bar._show_empty_tab_menu(self._tab_scroll.mapToGlobal(pos))
        )
        self._tab_scroll.viewport().setContextMenuPolicy(Qt.CustomContextMenu)
        self._tab_scroll.viewport().customContextMenuRequested.connect(
            lambda pos: self._tab_bar._show_empty_tab_menu(self._tab_scroll.viewport().mapToGlobal(pos))
        )
        
        row_layout.addWidget(self._tab_scroll)
        
        from PySide6.QtWidgets import QToolButton
        self._scroll_left_btn = QToolButton()
        self._scroll_left_btn.setArrowType(Qt.LeftArrow)
        self._scroll_left_btn.setStyleSheet("QToolButton { background: transparent; border: none; padding: 4px; } QToolButton:hover { background: #1a0033; }")
        self._scroll_left_btn.clicked.connect(lambda: self._tab_scroll.horizontalScrollBar().setValue(self._tab_scroll.horizontalScrollBar().value() - 50))
        
        self._scroll_right_btn = QToolButton()
        self._scroll_right_btn.setArrowType(Qt.RightArrow)
        self._scroll_right_btn.setStyleSheet("QToolButton { background: transparent; border: none; padding: 4px; } QToolButton:hover { background: #1a0033; }")
        self._scroll_right_btn.clicked.connect(lambda: self._tab_scroll.horizontalScrollBar().setValue(self._tab_scroll.horizontalScrollBar().value() + 50))
        
        row_layout.addWidget(self._scroll_left_btn)
        row_layout.addWidget(self._scroll_right_btn)
        
        self._tab_row_layout.addWidget(self._scroll_tab_widget)

        # 2. Flow Tab Container (wrapping tabs)
        self._flow_tab_container = FlowTabContainer(self)
        self._flow_tab_container.tab_changed.connect(self._switch_tab)
        self._flow_tab_container.tab_close_requested.connect(self._close_tab)
        self._flow_tab_container.tab_double_clicked.connect(self._on_tab_double_clicked)
        self._flow_tab_container.context_menu_requested.connect(self.show_tab_context_menu)
        self._flow_tab_container.hide()
        
        self._tab_row_layout.addWidget(self._flow_tab_container)

        layout.addWidget(self._tab_row)

        # Breadcrumbs slot (populated by main_window via mount_breadcrumbs)
        self._breadcrumbs_bar = None
        self._breadcrumbs_slot = QWidget()
        self._breadcrumbs_slot.setFixedHeight(24)
        self._breadcrumbs_slot.hide()
        self._breadcrumbs_slot_layout = QVBoxLayout(self._breadcrumbs_slot)
        self._breadcrumbs_slot_layout.setContentsMargins(0, 0, 0, 0)
        self._breadcrumbs_slot_layout.setSpacing(0)
        layout.addWidget(self._breadcrumbs_slot)

        self._stack = QStackedWidget()
        from PySide6.QtWidgets import QStackedLayout
        self._stack.layout().setStackingMode(QStackedLayout.StackAll)
        layout.addWidget(self._stack, 1)

        # Welcome screen
        self._welcome = WelcomeWidget(self)
        self._stack.addWidget(self._welcome)
        self._stack.setCurrentWidget(self._welcome)



    def _update_tab_row_visibility(self):
        from ..core.config import get_config
        show_tabs = getattr(get_config(), "show_tabs", "multiple")
        if show_tabs == "none":
            self._tab_row.hide()
        else:
            self._tab_row.setVisible(len(self._tabs) > 0)

    def _sync_tab_bar(self):
        """Syncs the visual tab bar representation with the loaded _tabs metadata list,
        respecting 'show_tabs' and 'wrap_tabs' settings (multiple, single, none)."""
        from ..core.config import get_config
        config = get_config()
        show_tabs = getattr(config, "show_tabs", "multiple")
        wrap_tabs = getattr(config, "wrap_tabs", False)
        
        self._tab_bar.blockSignals(True)
        while self._tab_bar.count() > 0:
            self._tab_bar.removeTab(0)
        self._flow_tab_container.clear()
        
        if show_tabs == "none":
            self._tab_row.hide()
            self._tab_bar.blockSignals(False)
            return
            
        self._tab_row.show()
        
        if wrap_tabs and show_tabs == "multiple":
            self._scroll_tab_widget.hide()
            self._flow_tab_container.show()
            self._flow_tab_container.rebuild_tabs(self._tabs, self._current_idx)
        else:
            self._flow_tab_container.hide()
            self._scroll_tab_widget.show()
            
            if show_tabs == "single":
                if 0 <= self._current_idx < len(self._tabs):
                    tab = self._tabs[self._current_idx]
                    icon = get_file_icon(tab.file_path) if tab.file_path else get_file_icon("untitled.txt")
                    title = tab.title
                    if tab.editor.is_dirty() and not title.startswith("● "):
                        title = "● " + title
                    idx = self._tab_bar.addTab(icon, title)
                    self._tab_bar.setCurrentIndex(idx)
                    if tab.is_pinned:
                        self._tab_bar.setTabIcon(idx, get_file_icon("pin"))  # placeholder, text style follows
                        self._tab_bar.setTabTextColor(idx, QColor("#7c3aed"))
                    elif tab.is_preview:
                        font = self._tab_bar.tabFont(idx)
                        font.setItalic(True)
                        self._tab_bar.setTabFont(idx, font)
            else: # "multiple"
                for i, tab in enumerate(self._tabs):
                    icon = get_file_icon(tab.file_path) if tab.file_path else get_file_icon("untitled.txt")
                    title = tab.title
                    if tab.editor.is_dirty() and not title.startswith("● "):
                        title = "● " + title
                    idx = self._tab_bar.addTab(icon, title)
                    if tab.is_pinned:
                        self._tab_bar.setTabIcon(idx, icon)
                        self._tab_bar.setTabTextColor(idx, QColor("#7c3aed"))
                    elif tab.is_preview:
                        font = self._tab_bar.tabFont(idx)
                        font.setItalic(True)
                        self._tab_bar.setTabFont(idx, font)
                if 0 <= self._current_idx < len(self._tabs):
                    self._tab_bar.setCurrentIndex(self._current_idx)
                    
        self._tab_bar.blockSignals(False)
        self._update_tab_row_visibility()

    def show_tab_context_menu(self, idx: int, global_pos: QPoint):
        if idx < 0 or idx >= len(self._tabs):
            return
        from PySide6.QtWidgets import QMenu
        from PySide6.QtGui import QAction
        from ..app.theme_manager import ThemeManager

        menu = QMenu(self)
        c = ThemeManager.THEMES.get(ThemeManager.current_theme_id(), ThemeManager.THEMES["dardcor-purple"])["colors"]
        menu.setStyleSheet(f"""
            QMenu {{
                background-color: {c["background"]};
                color: {c["foreground"]};
                border: 1px solid {c["border"]};
                padding: 4px 0px;
                font-size: 12px;
            }}
            QMenu::item {{
                padding: 5px 28px 5px 12px;
                min-width: 150px;
            }}
            QMenu::item:selected {{
                background-color: {c["selection"]};
                color: {c["activity_bar_fg"]};
            }}
            QMenu::separator {{
                height: 1px;
                background: {c["border"]};
                margin: 4px 0px;
            }}
        """)
        
        tab_data = self._tabs[idx]
        
        pin_action = menu.addAction("Unpin Tab" if tab_data.is_pinned else "Pin Tab")
        close_action = menu.addAction("Close")
        close_other = menu.addAction("Close Others")
        close_right = menu.addAction("Close to the Right")
        close_saved = menu.addAction("Close Saved")
        
        menu.addSeparator()
        split_up = menu.addAction("Split Up")
        split_down = menu.addAction("Split Down")
        split_left = menu.addAction("Split Left")
        split_right = menu.addAction("Split Right")
        
        action = menu.exec_(global_pos)
        
        if action == pin_action:
            self.toggle_pin_tab(idx)
        elif action == close_action:
            self._close_tab(idx)
        elif action == close_other:
            for i in range(len(self._tabs) - 1, -1, -1):
                if i != idx:
                    self._close_tab(i)
        elif action == close_right:
            for i in range(len(self._tabs) - 1, idx, -1):
                self._close_tab(i)
        elif action == close_saved:
            for i in range(len(self._tabs) - 1, -1, -1):
                if i < len(self._tabs) and not self._tabs[i].editor.is_dirty():
                    self._close_tab(i)
        elif action == split_up:
            self._execute_cmd("view.splitEditorUp")
        elif action == split_down:
            self._execute_cmd("view.splitEditorDown")
        elif action == split_left:
            self._execute_cmd("view.splitEditorLeft")
        elif action == split_right:
            self._execute_cmd("view.splitEditorRight")

    def mount_breadcrumbs(self, bar):
        """Mount a shared BreadcrumbsBar below the tab row."""
        if self._breadcrumbs_bar is bar:
            return
        if self._breadcrumbs_bar is not None:
            self._breadcrumbs_slot_layout.removeWidget(self._breadcrumbs_bar)
            self._breadcrumbs_bar.hide()
        self._breadcrumbs_bar = bar
        if bar is not None:
            self._breadcrumbs_slot_layout.addWidget(bar)
            self._breadcrumbs_slot.show()
        else:
            self._breadcrumbs_slot.hide()

    def set_breadcrumbs_visible(self, visible: bool):
        if self._breadcrumbs_bar is None:
            return
        self._breadcrumbs_slot.setVisible(visible)
        self._breadcrumbs_bar.setVisible(visible)

    def refresh_welcome_recent(self):
        if hasattr(self, "_welcome") and hasattr(self._welcome, "refresh_recent"):
            self._welcome.refresh_recent()

    def _on_tab_double_clicked(self, idx: int):
        """Double-clicking a preview tab makes it permanent."""
        if 0 <= idx < len(self._tabs):
            self._make_tab_permanent(idx)

    def _make_tab_permanent(self, idx: int):
        """Convert a preview tab to a permanent tab (remove italic style)."""
        if 0 <= idx < len(self._tabs):
            tab = self._tabs[idx]
            if tab.is_preview:
                tab.is_preview = False
                self._preview_idx = -1
                self._sync_tab_bar()

    def _open_as_preview(self, file_path: str):
        """Open a file as a preview tab (italic). Replaces existing preview tab."""
        # Close existing preview tab if any
        if self._preview_idx >= 0 and self._preview_idx < len(self._tabs):
            old_preview = self._tabs[self._preview_idx]
            if old_preview.is_preview and not old_preview.editor.is_dirty():
                self._stack.removeWidget(old_preview.editor)
                if hasattr(old_preview.editor, "cleanup"):
                    old_preview.editor.cleanup()
                old_preview.editor.deleteLater()
                self._tabs.pop(self._preview_idx)
                self._preview_idx = -1

        editor = self.open_file(file_path)
        idx = self._find_tab_by_path(file_path)
        if idx >= 0:
            self._tabs[idx].is_preview = True
            self._preview_idx = idx
            self._sync_tab_bar()
        return editor

    def _find_tab_by_path(self, file_path: str) -> int:
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path:
                return i
        return -1

    def toggle_pin_tab(self, idx: int):
        if 0 <= idx < len(self._tabs):
            tab = self._tabs[idx]
            tab.is_pinned = not tab.is_pinned
            self._sync_tab_bar()

    def open_file(self, file_path):
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path and not isinstance(tab.editor, MonacoDiffEditorWidget):
                self._current_idx = i
                self._sync_tab_bar()
                self._switch_tab(i)
                return tab.editor

        if file_path.endswith(".ipynb"):
            from ..notebooks.editor import NotebookEditor
            editor = NotebookEditor(self)
            editor._file_path = file_path
            editor.load_ipynb(file_path)
            editor.content_changed.connect(lambda c: self._on_content_changed(editor))
            editor.save_requested.connect(lambda: self._save_editor(editor))
        elif file_path.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.webp', '.ico')):
            from .image_viewer import ImageViewer
            editor = ImageViewer(self)
            editor.load_image(file_path)
        else:
            from ..core.filesystem import is_binary
            if is_binary(file_path):
                from .hex_editor import HexEditorWidget
                editor = HexEditorWidget(self)
                editor.load_file(file_path)
            else:
                editor = MonacoEditorWidget(self)
                editor.open_file(file_path)
                editor.content_changed.connect(lambda c: self._on_content_changed(editor))
                editor.save_requested.connect(lambda: self._save_editor(editor))

        tab = EditorTab(editor, file_path)
        self._tabs.append(tab)
        self._stack.addWidget(editor)

        self._current_idx = len(self._tabs) - 1
        self._sync_tab_bar()
        self._switch_tab(self._current_idx)
        self._update_breadcrumb(file_path)
        return editor

    def _update_breadcrumb(self, file_path: str):
        if not hasattr(self, "_breadcrumb_label") or not self._breadcrumb_label:
            return
        if not file_path:
            self._breadcrumb_label.setText("No file open")
            return
            
        from ..core.config import get_config
        config = get_config()
        ws = config.workspace_path
        
        display_path = file_path
        if ws and file_path.startswith(ws):
            display_path = os.path.relpath(file_path, ws)
            display_path = display_path.replace(os.sep, " > ")
        else:
            display_path = os.path.basename(file_path)
            
        self._breadcrumb_label.setText(display_path)

    def add_custom_tab(self, widget, title, icon=None):
        if not hasattr(widget, 'get_file_path'): widget.get_file_path = lambda: ""
        if not hasattr(widget, 'is_dirty'): widget.is_dirty = lambda: False
        if not hasattr(widget, 'get_language'): widget.get_language = lambda: "terminal"
        
        tab = EditorTab(widget, "")
        tab.title = title
        self._tabs.append(tab)
        self._stack.addWidget(widget)
        
        self._current_idx = len(self._tabs) - 1
        self._sync_tab_bar()
        self._switch_tab(self._current_idx)
        self._update_breadcrumb("")
        return widget

    def open_diff(self, file_path, original_content, modified_content):
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path and isinstance(tab.editor, MonacoDiffEditorWidget):
                tab.editor.set_diff(original_content, modified_content, file_path)
                self._current_idx = i
                self._sync_tab_bar()
                self._switch_tab(i)
                return tab.editor
        from .diff_viewer import MonacoDiffEditorWidget
        editor = MonacoDiffEditorWidget(self)
        editor.set_diff(original_content, modified_content, file_path)

        tab = EditorTab(editor, file_path)
        tab.title = f"diff: {os.path.basename(file_path)}"
        self._tabs.append(tab)
        self._stack.addWidget(editor)

        self._current_idx = len(self._tabs) - 1
        self._sync_tab_bar()
        self._switch_tab(self._current_idx)
        self._update_breadcrumb(file_path)
        return editor

    def new_file(self):
        self._untitled_counter += 1
        editor = MonacoEditorWidget(self)
        editor.set_content("", "plaintext")
        editor.content_changed.connect(lambda c: self._on_content_changed(editor))
        editor.save_requested.connect(lambda: self._save_editor(editor))

        title = f"Untitled-{self._untitled_counter}"
        tab = EditorTab(editor, None)
        tab.title = title
        self._tabs.append(tab)
        self._stack.addWidget(editor)
        
        self._current_idx = len(self._tabs) - 1
        self._sync_tab_bar()
        self._switch_tab(self._current_idx)
        return editor

    def _on_content_changed(self, editor):
        idx = self._editor_index(editor)
        if idx >= 0:
            tab = self._tabs[idx]
            if tab.is_preview:
                self._make_tab_permanent(idx)
            self._sync_tab_bar()
            if tab.file_path:
                for other_tab in self._tabs:
                    if other_tab.file_path == tab.file_path and isinstance(other_tab.editor, MonacoDiffEditorWidget):
                        other_tab.editor.set_diff(other_tab.editor._original_content, editor.get_content(), tab.file_path)
        self.dirty_changed.emit(True)

    def _save_editor(self, editor):
        idx = self._editor_index(editor)
        if idx < 0:
            return
        tab = self._tabs[idx]
        if tab.file_path:
            editor.save()
        else:
            path, _ = QFileDialog.getSaveFileName(self, "Save File As")
            if path:
                tab.file_path = path
                tab.title = os.path.basename(path)
                editor.save_as(path)
        self._sync_tab_bar()
        self.dirty_changed.emit(False)

    def _close_tab(self, idx):
        from ..core.config import get_config
        if getattr(get_config(), "show_tabs", "multiple") == "single":
            idx = self._current_idx

        if idx < 0 or idx >= len(self._tabs):
            return False
        tab = self._tabs[idx]
        if tab.is_pinned:
            return False
        if tab.editor.is_dirty():
            result = QMessageBox.question(
                self, "Unsaved Changes",
                f"Save changes to '{tab.title}' before closing?",
                QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel
            )
            if result == QMessageBox.Cancel:
                return False
            if result == QMessageBox.Save:
                self._save_editor(tab.editor)

        self._stack.removeWidget(tab.editor)
        if hasattr(tab.editor, "cleanup"):
            tab.editor.cleanup()
        tab.editor.deleteLater()
        self._tabs.pop(idx)
        
        if self._current_idx >= len(self._tabs):
            self._current_idx = len(self._tabs) - 1
            
        self._sync_tab_bar()

        if not self._tabs:
            self.group_empty.emit(self)
            self.set_breadcrumbs_visible(False)
            self.refresh_welcome_recent()
            self._welcome.show()
            self._stack.setCurrentWidget(self._welcome)
            self._current_idx = -1
            self.tab_changed.emit("", "")
        elif self._current_idx >= 0:
            self._switch_tab(self._current_idx)
            
        return True

    def _on_tab_changed(self, idx):
        from ..core.config import get_config
        show_tabs = getattr(get_config(), "show_tabs", "multiple")
        if show_tabs == "single":
            idx = self._current_idx
        self._switch_tab(idx)
        QTimer.singleShot(0, self._tab_bar._update_close_buttons)

    def _switch_tab(self, idx):
        if 0 <= idx < len(self._tabs):
            self._current_idx = idx
            editor = self._tabs[idx].editor
            self._welcome.hide()
            self._stack.setCurrentWidget(editor)
            self._emit_tab_changed(editor)
            self._sync_tab_bar()

    def _emit_tab_changed(self, editor):
        fp = editor.get_file_path() or ""
        lang = editor.get_language()
        self.tab_changed.emit(fp, lang)

    def _editor_index(self, editor):
        for i, tab in enumerate(self._tabs):
            if tab.editor is editor:
                return i
        return -1

    def current_editor(self) -> MonacoEditorWidget:
        if 0 <= self._current_idx < len(self._tabs):
            return self._tabs[self._current_idx].editor
        return None

    def save_current(self):
        ed = self.current_editor()
        if ed:
            self._save_editor(ed)

    def save_all(self, is_auto_save=False):
        for i, tab in enumerate(self._tabs):
            if tab.editor.is_dirty():
                if is_auto_save and not tab.file_path:
                    continue
                self._save_editor(tab.editor)

    def close_current(self):
        if self._current_idx >= 0:
            self._close_tab(self._current_idx)

    def close_all(self):
        while self._tabs:
            if not self._close_tab(len(self._tabs) - 1):
                return False
        return True

    def open_file_at_line(self, file_path, line):
        ed = self.open_file(file_path)
        if ed:
            from PySide6.QtCore import QTimer
            QTimer.singleShot(300, lambda: ed.reveal_line(line))

    def set_font_size(self, size):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_font_size"):
                tab.editor.set_font_size(size)

    def set_word_wrap(self, enabled):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_word_wrap"):
                tab.editor.set_word_wrap(enabled)

    def set_minimap(self, enabled):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_minimap"):
                tab.editor.set_minimap(enabled)

    def set_tab_sizing(self, mode: str):
        """Set tab sizing mode: 'fit' (equal width) or 'shrink' (compact)."""
        if mode == 'fit':
            self._tab_bar.setExpanding(True)
            self._tab_bar.setUsesScrollButtons(True)
        else:
            self._tab_bar.setExpanding(False)
            self._tab_bar.setUsesScrollButtons(False)
        self._sync_tab_bar()

    def set_orientation(self, orientation: str):
        """Set editor group orientation: 'horizontal' or 'vertical'."""
        if orientation == 'vertical':
            self._scroll_tab_widget.setFixedHeight(1000)
            self._tab_bar.setShape(QTabBar.RoundedWest)
        else:
            self._scroll_tab_widget.setFixedHeight(35)
            self._tab_bar.setShape(QTabBar.RoundedNorth)

    def set_theme(self, is_dark: bool):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_theme"):
                tab.editor.set_theme(is_dark)

    def set_custom_theme(self, theme_data):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_custom_theme"):
                tab.editor.set_custom_theme(theme_data)

    def trigger_find(self):
        ed = self.current_editor()
        if ed: ed.trigger_find()

    def trigger_find_replace(self):
        ed = self.current_editor()
        if ed: ed.trigger_find_replace()

    def trigger_format(self):
        ed = self.current_editor()
        if ed: ed.trigger_format()

    def show_debug_toolbar(self, show: bool):
        self._debug_toolbar.setVisible(show)

    def expand_selection(self):
        ed = self.current_editor()
        if ed and hasattr(ed, "expand_selection"): ed.expand_selection()

    def shrink_selection(self):
        ed = self.current_editor()
        if ed and hasattr(ed, "shrink_selection"): ed.shrink_selection()

    def copy_line_up(self):
        ed = self.current_editor()
        if ed and hasattr(ed, "copy_line_up"): ed.copy_line_up()

    def copy_line_down(self):
        ed = self.current_editor()
        if ed and hasattr(ed, "copy_line_down"): ed.copy_line_down()

    def go_to_definition(self):
        ed = self.current_editor()
        if ed and hasattr(ed, "go_to_definition"): ed.go_to_definition()

    def toggle_breakpoint(self):
        ed = self.current_editor()
        if ed and hasattr(ed, "toggle_breakpoint"): ed.toggle_breakpoint()

    def revert_current_file(self):
        import os
        idx = self._current_idx
        if idx < 0 or idx >= len(self._tabs):
            return
        tab = self._tabs[idx]
        if tab.file_path and os.path.exists(tab.file_path):
            tab.editor.open_file(tab.file_path)
            self._sync_tab_bar()
            self.dirty_changed.emit(False)
