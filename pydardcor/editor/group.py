import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTabBar, QPushButton,
    QStackedWidget, QLabel, QMessageBox, QFileDialog, QScrollArea
)
from PySide6.QtCore import Signal, Qt, QSize, QTimer, QByteArray
from PySide6.QtGui import QPixmap, QIcon, QPainter, QColor, QFont, QImage
from PySide6.QtSvg import QSvgRenderer

from .widget import MonacoEditorWidget
from .diff_viewer import MonacoDiffEditorWidget
from ..file_explorer.panel import get_file_icon




class EditorTab:
    """Metadata for a single editor tab."""
    def __init__(self, editor: MonacoEditorWidget, file_path: str = None):
        self.editor = editor
        self.file_path = file_path
        self.title = os.path.basename(file_path) if file_path else "Untitled"
        self.is_pinned = False


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
        
    def mouseMoveEvent(self, event):
        super().mouseMoveEvent(event)
        idx = self.tabAt(event.pos())
        if idx != self._hovered_tab:
            self._hovered_tab = idx
            self._update_close_buttons()
            
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

    def mouseReleaseEvent(self, event):
        super().mouseReleaseEvent(event)
        if event.button() == Qt.MiddleButton:
            idx = self.tabAt(event.pos())
            if idx >= 0:
                self._request_close_tab(idx)

    def contextMenuEvent(self, event):
        idx = self.tabAt(event.pos())
        if idx < 0:
            self._show_empty_tab_menu(event.globalPos())
            return
            
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        
        group = self._editor_group()
        if group is not None and idx < len(group._tabs):
            tab_data = group._tabs[idx]
            
            pin_action = menu.addAction("Unpin Tab" if tab_data.is_pinned else "Pin Tab")
            close_action = menu.addAction("Close")
            close_other = menu.addAction("Close Others")
            close_right = menu.addAction("Close to the Right")
            close_saved = menu.addAction("Close Saved")
            if tab_data.is_pinned:
                close_action.setEnabled(False)
            
            action = menu.exec_(self.mapToGlobal(event.pos()))
            
            if action == pin_action:
                group.toggle_pin_tab(idx)
            elif action == close_action:
                self._request_close_tab(idx)
            elif action == close_other:
                for i in range(self.count() - 1, -1, -1):
                    if i != idx:
                        self._request_close_tab(i)
            elif action == close_right:
                for i in range(self.count() - 1, idx, -1):
                    self._request_close_tab(i)
            elif action == close_saved:
                for i in range(self.count() - 1, -1, -1):
                    if i < len(group._tabs) and not group._tabs[i].editor.is_dirty():
                        self._request_close_tab(i)

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
                min-width: 210px;
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
        terminal.triggered.connect(lambda: self._execute_cmd("terminal.new"))
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
            action.setEnabled(False)
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

        self._recent_widget = QWidget()
        self._recent_widget.setFixedWidth(220)
        self._recent_layout = QVBoxLayout(self._recent_widget)
        self._recent_layout.setContentsMargins(0, 14, 0, 0)
        self._recent_layout.setSpacing(4)
        btn_layout.addWidget(self._recent_widget)

        h_layout.addWidget(btn_container)
        h_layout.addStretch()

        vl.addWidget(wrapper)
        self.refresh_recent()
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
        from ..core.config import get_config

        while self._recent_layout.count():
            item = self._recent_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()

        config = get_config()
        if getattr(config, "workspace_path", ""):
            self._recent_widget.hide()
            return
        recent_files = [p for p in getattr(config, "recent_files", []) if p and os.path.isfile(p)]
        recent_folders = [p for p in getattr(config, "recent_folders", []) if p and os.path.isdir(p)]
        recent = [("file", p) for p in recent_files[:5]] + [("folder", p) for p in recent_folders[:5]]
        self._recent_widget.setVisible(bool(recent))
        if not recent:
            return

        heading = QLabel("Recent")
        heading.setStyleSheet("color:#858585;font-size:11px;border:none;background:transparent;")
        heading.setAlignment(Qt.AlignCenter)
        self._recent_layout.addWidget(heading)

        for kind, path in recent[:8]:
            name = os.path.basename(path.rstrip("/\\")) or path
            btn = QPushButton(f"{name}  {kind}")
            btn.setFixedWidth(220)
            btn.setToolTip(path)
            btn.setCursor(Qt.PointingHandCursor)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    color: #cccccc;
                    border: none;
                    padding: 3px 8px;
                    text-align: left;
                    font-size: 12px;
                }
                QPushButton:hover {
                    background-color: rgba(168, 85, 247, 0.16);
                    color: #ffffff;
                }
            """)
            btn.clicked.connect(lambda checked=False, p=path: self._open_recent_path(p))
            self._recent_layout.addWidget(btn)
            
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
        
        open_terminal = QAction("Open Terminal", self)
        open_terminal.triggered.connect(lambda: self._execute_cmd("terminal.new"))
        menu.addAction(open_terminal)

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

    def __init__(self, parent=None):
        super().__init__(parent)
        self._tabs = []
        self._current_idx = -1
        self._untitled_counter = 0
        self._setup_ui()
        self.setAcceptDrops(True)

    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            super().dragEnterEvent(event)

    def dropEvent(self, event):
        if event.mimeData().hasUrls():
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

        # Tab bar row
        self._tab_row = QWidget()
        self._tab_row.setFixedHeight(35)
        self._tab_row.setStyleSheet("background-color: #000000; border-bottom: 1px solid #3c0068;")
        self._tab_row.setContextMenuPolicy(Qt.CustomContextMenu)
        self._tab_row.customContextMenuRequested.connect(
            lambda pos: self._tab_bar._show_empty_tab_menu(self._tab_row.mapToGlobal(pos))
        )
        self._tab_row.hide()
        row_layout = QHBoxLayout(self._tab_row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(0)

        self._tab_bar = DardcorTabBar()
        self._tab_bar.tabCloseRequested.connect(self._close_tab)
        self._tab_bar.currentChanged.connect(self._on_tab_changed)
        self._tab_bar.tabMoved.connect(self._on_tab_moved)
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
        
        # Native-style scroll buttons in the corner
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
        layout.addWidget(self._stack)

        # Welcome screen
        self._welcome = WelcomeWidget(self)
        self._stack.addWidget(self._welcome)
        self._stack.setCurrentWidget(self._welcome)



    def _update_tab_row_visibility(self):
        has_tabs = len(self._tabs) > 0
        self._tab_row.setVisible(has_tabs)

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

    def _refresh_tab_title(self, idx: int):
        if idx < 0 or idx >= len(self._tabs):
            return
        tab = self._tabs[idx]
        title = tab.title
        if tab.editor.is_dirty():
            title = "● " + title
        if tab.is_pinned:
            title = "📌 " + title
        self._tab_bar.setTabText(idx, title)

    def _is_valid_tab_order(self):
        seen_unpinned = False
        for tab in self._tabs:
            if not tab.is_pinned:
                seen_unpinned = True
            elif seen_unpinned:
                return False
        return True

    def _move_tab_data(self, from_idx: int, to_idx: int) -> int:
        if from_idx == to_idx or not (0 <= from_idx < len(self._tabs)):
            return from_idx
        to_idx = max(0, min(to_idx, len(self._tabs) - 1))
        self._tab_bar.blockSignals(True)
        try:
            tab = self._tabs.pop(from_idx)
            self._tabs.insert(to_idx, tab)
            self._tab_bar.moveTab(from_idx, to_idx)
            if self._current_idx == from_idx:
                self._current_idx = to_idx
            elif from_idx < self._current_idx <= to_idx:
                self._current_idx -= 1
            elif to_idx <= self._current_idx < from_idx:
                self._current_idx += 1
        finally:
            self._tab_bar.blockSignals(False)
        return to_idx

    def _on_tab_moved(self, from_idx: int, to_idx: int):
        if from_idx == to_idx or not (0 <= from_idx < len(self._tabs) and 0 <= to_idx < len(self._tabs)):
            return
        tab = self._tabs.pop(from_idx)
        self._tabs.insert(to_idx, tab)
        if not self._is_valid_tab_order():
            self._tabs.pop(to_idx)
            self._tabs.insert(from_idx, tab)
            self._tab_bar.blockSignals(True)
            try:
                self._tab_bar.moveTab(to_idx, from_idx)
            finally:
                self._tab_bar.blockSignals(False)
            return
        if self._current_idx == from_idx:
            self._current_idx = to_idx
        elif from_idx < self._current_idx <= to_idx:
            self._current_idx -= 1
        elif to_idx <= self._current_idx < from_idx:
            self._current_idx += 1

    def toggle_pin_tab(self, idx: int):
        if not (0 <= idx < len(self._tabs)):
            return
        tab = self._tabs[idx]
        tab.is_pinned = not tab.is_pinned
        if tab.is_pinned:
            target = sum(1 for t in self._tabs if t.is_pinned) - 1
        else:
            target = sum(1 for t in self._tabs if t.is_pinned)
        idx = self._move_tab_data(idx, target)
        self._refresh_tab_title(idx)
        QTimer.singleShot(0, self._tab_bar._update_close_buttons)

    def open_file(self, file_path):
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path and not isinstance(tab.editor, MonacoDiffEditorWidget):
                self._tab_bar.setCurrentIndex(i)
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

        title = os.path.basename(file_path)
        icon = get_file_icon(file_path)
        
        self._tab_bar.addTab(icon, title)
        self._tab_bar.setCurrentIndex(len(self._tabs) - 1)
        self._update_tab_row_visibility()
        return editor

    def add_custom_tab(self, widget, title, icon=None):
        # Provide dummy methods for Monaco duck-typing
        if not hasattr(widget, 'get_file_path'): widget.get_file_path = lambda: ""
        if not hasattr(widget, 'is_dirty'): widget.is_dirty = lambda: False
        if not hasattr(widget, 'get_language'): widget.get_language = lambda: "terminal"
        
        tab = EditorTab(widget, "")
        tab.title = title
        self._tabs.append(tab)
        self._stack.addWidget(widget)
        
        if not icon:
            icon = QIcon()
            
        self._tab_bar.addTab(icon, title)
        self._tab_bar.setCurrentIndex(len(self._tabs) - 1)
        self._stack.setCurrentWidget(widget)
        self._update_tab_row_visibility()
        return widget

    def open_diff(self, file_path, original_content, modified_content):
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path and isinstance(tab.editor, MonacoDiffEditorWidget):
                tab.editor.set_diff(original_content, modified_content, file_path)
                self._tab_bar.setCurrentIndex(i)
                return tab.editor

        editor = MonacoDiffEditorWidget(self)
        editor.set_diff(original_content, modified_content, file_path)

        tab = EditorTab(editor, file_path)
        tab.title = f"diff: {os.path.basename(file_path)}"
        self._tabs.append(tab)
        self._stack.addWidget(editor)

        icon = get_file_icon(file_path)
        idx = self._tab_bar.addTab(icon, tab.title)
        self._tab_bar.setCurrentIndex(idx)
        self._stack.setCurrentWidget(editor)
        self._current_idx = idx
        self._emit_tab_changed(editor)
        self._update_tab_row_visibility()
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
        idx = self._tab_bar.addTab(get_file_icon("untitled.txt"), title)
        self._tab_bar.setCurrentIndex(idx)
        self._stack.setCurrentWidget(editor)
        self._current_idx = idx
        self._update_tab_row_visibility()
        return editor

    def _on_content_changed(self, editor):
        idx = self._editor_index(editor)
        if idx >= 0:
            self._refresh_tab_title(idx)
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
                self._tab_bar.setTabIcon(idx, get_file_icon(path))
        self._refresh_tab_title(idx)
        self.dirty_changed.emit(False)

    def _close_tab(self, idx):
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
        tab.editor.deleteLater()
        self._tabs.pop(idx)
        self._tab_bar.removeTab(idx)
        self._update_tab_row_visibility()

        if not self._tabs:
            self.set_breadcrumbs_visible(False)
            self.refresh_welcome_recent()
            self._stack.setCurrentWidget(self._welcome)
            self._current_idx = -1
            self.tab_changed.emit("", "")
        return True

    def _on_tab_changed(self, idx):
        self._switch_tab(idx)
        QTimer.singleShot(0, self._tab_bar._update_close_buttons)

    def _switch_tab(self, idx):
        if 0 <= idx < len(self._tabs):
            self._current_idx = idx
            editor = self._tabs[idx].editor
            self._stack.setCurrentWidget(editor)
            self._emit_tab_changed(editor)

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
            tab.editor.set_font_size(size)

    def set_word_wrap(self, enabled):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_word_wrap"):
                tab.editor.set_word_wrap(enabled)

    def set_minimap(self, enabled):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_minimap"):
                tab.editor.set_minimap(enabled)

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
