"""Main Window - VS Code style main application window."""

import os
import threading
from pathlib import Path
import shutil

from ..browser.chrome_launcher import open_agent_chrome

import ctypes
if os.name == "nt":
    from ctypes import wintypes

from PySide6.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QSplitter, QStackedWidget, QMessageBox, QApplication,
    QFileDialog, QInputDialog, QLabel, QMenuBar, QPushButton,
    QPlainTextEdit, QTextEdit, QLineEdit, QDialog, QFontDialog, QSizePolicy,
)
from PySide6.QtCore import Qt, QTimer, QPoint, QEvent, Signal

# Patch QMetaObject.invokeMethod for PySide6 compatibility with callables
import PySide6.QtCore
if not hasattr(PySide6.QtCore.QMetaObject, "_original_invokeMethod"):
    PySide6.QtCore.QMetaObject._original_invokeMethod = PySide6.QtCore.QMetaObject.invokeMethod
    
    def _patched_invokeMethod(obj, member, *args, **kwargs):
        if callable(member):
            from PySide6.QtCore import Qt, QThread, QCoreApplication, QTimer
            import threading
            
            connection_type = Qt.BlockingQueuedConnection
            remaining_args = []
            for arg in args:
                if isinstance(arg, Qt.ConnectionType):
                    connection_type = arg
                else:
                    remaining_args.append(arg)
            
            app = QCoreApplication.instance()
            if app is None or QThread.currentThread() == app.thread():
                return member(*remaining_args, **kwargs)
            
            result_holder = [None]
            exception_holder = [None]
            event = threading.Event()
            
            def run_in_main_thread():
                try:
                    result_holder[0] = member(*remaining_args, **kwargs)
                except Exception as e:
                    exception_holder[0] = e
                finally:
                    event.set()
            
            QTimer.singleShot(0, run_in_main_thread)
            
            if connection_type == Qt.BlockingQueuedConnection:
                event.wait()
                if exception_holder[0] is not None:
                    raise exception_holder[0]
                return result_holder[0]
            return True
            
        return PySide6.QtCore.QMetaObject._original_invokeMethod(obj, member, *args, **kwargs)

    PySide6.QtCore.QMetaObject.invokeMethod = _patched_invokeMethod
from PySide6.QtGui import (
    QAction, QKeySequence, QShortcut, QMouseEvent, QFont,
    QPixmap, QIcon, QPainter, QColor
)

from ..ui_shared.breadcrumbs import BreadcrumbsBar
from ..editor.markdown_preview import MarkdownPreviewWidget
from ..editor.zen_mode import ZenModeManager
from ..settings.keybindings_dialog import KeybindingsDialog, KeybindingsManager

class ChromeButton(QPushButton):
    """Button that paints the Chrome logo and opens agent Chrome on click."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(38, 35)
        self.setToolTip("Open Agent in Chrome")
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton { background-color: transparent; border: none; }
            QPushButton:hover { background-color: #1a0033; }
        """)

    def paintEvent(self, event):
        super().paintEvent(event)
        from PySide6.QtCore import QRect
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        cx = self.width() // 2
        cy = self.height() // 2
        r = 8   # outer radius
        rw = 5  # dark ring radius
        ri = 4  # blue center radius
        outer = QRect(cx - r, cy - r, r * 2, r * 2)
        painter.setPen(Qt.NoPen)
        # Red segment (top)
        painter.setBrush(QColor("#EA4335"))
        painter.drawPie(outer, 30 * 16, 120 * 16)
        # Yellow segment (bottom-left)
        painter.setBrush(QColor("#FBBC05"))
        painter.drawPie(outer, 150 * 16, 120 * 16)
        # Green segment (bottom-right)
        painter.setBrush(QColor("#34A853"))
        painter.drawPie(outer, 270 * 16, 120 * 16)
        # Dark separator ring
        painter.setBrush(QColor("#0d0d0d"))
        painter.drawEllipse(QRect(cx - rw, cy - rw, rw * 2, rw * 2))
        # Blue center circle
        painter.setBrush(QColor("#4285F4"))
        painter.drawEllipse(QRect(cx - ri, cy - ri, ri * 2, ri * 2))
        painter.end()


class CommandCenterWidget(QWidget):
    """VS Code style Command Center (Search bar) in the Title Bar."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(28)
        self.setCursor(Qt.PointingHandCursor)
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(4, 2, 4, 2)
        layout.setSpacing(4)
        
        self.setStyleSheet("""
            QWidget {
                background-color: transparent;
            }
            #SearchBox {
                background-color: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
            }
            #SearchBox:hover {
                background-color: rgba(255, 255, 255, 0.12);
            }
            QPushButton {
                background: transparent;
                border: none;
                color: #cccccc;
                font-family: codicon;
                font-size: 14px;
                padding: 0px;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.1);
                color: #ffffff;
            }
            QLabel {
                background: transparent;
                border: none;
                color: #cccccc;
                font-size: 12px;
            }
        """)
        
        self.btn_back = QPushButton("\ueab6") # arrow-left
        self.btn_back.setToolTip("Go Back")
        self.btn_back.setFixedSize(28, 24)
        
        self.btn_forward = QPushButton("\ueab7") # arrow-right
        self.btn_forward.setToolTip("Go Forward")
        self.btn_forward.setFixedSize(28, 24)
        
        self.search_btn = QPushButton()
        self.search_btn.setObjectName("SearchBox")
        self.search_btn.setCursor(Qt.PointingHandCursor)
        sc_layout = QHBoxLayout(self.search_btn)
        sc_layout.setContentsMargins(10, 0, 10, 0)
        sc_layout.setSpacing(8)
        
        search_icon = QLabel("\uea6d")
        search_icon.setFont(QFont("codicon", 11))
        search_icon.setStyleSheet("color: #858585;")
        
        self.lbl_title = QLabel("Dardcor Code")
        self.lbl_title.setStyleSheet("color: #cccccc;")
        
        sc_layout.addWidget(search_icon)
        sc_layout.addWidget(self.lbl_title)
        sc_layout.addStretch()
        
        layout.addWidget(self.btn_back)
        layout.addWidget(self.btn_forward)
        layout.addWidget(self.search_btn)

    def set_title(self, text):
        self.lbl_title.setText(text)


class LayoutToggleButton(QPushButton):
    """Button to toggle layout panels (sidebar, bottom panel, right sidebar)."""
    
    def __init__(self, layout_type, parent=None):
        super().__init__(parent)
        self.layout_type = layout_type # 'left', 'bottom', 'right'
        self.setFixedSize(30, 28)
        self.setCursor(Qt.PointingHandCursor)
        self._is_active = True  # Track state manually
        self.setStyleSheet("""
            QPushButton { 
                background-color: transparent; 
                border: none; 
                border-radius: 4px; 
                margin: 0px 2px;
            }
            QPushButton:hover { 
                background-color: rgba(255, 255, 255, 0.1); 
            }
            QPushButton:checked { 
                background-color: transparent; 
            }
            QPushButton:checked:hover { 
                background-color: rgba(255, 255, 255, 0.1); 
            }
        """)

    def setChecked(self, checked):
        self._is_active = checked
        self.update()

    def isChecked(self):
        return self._is_active

    def paintEvent(self, event):
        super().paintEvent(event)
        from PySide6.QtCore import QRectF, QPointF
        from PySide6.QtGui import QPainterPath, QPen
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        w, h = 14, 12
        x = (self.width() - w) / 2.0
        y = (self.height() - h) / 2.0
        
        path = QPainterPath()
        path.addRoundedRect(QRectF(x, y, w, h), 2, 2)
        
        color = QColor("#cccccc")
        pen = QPen(color)
        pen.setWidth(1)
        painter.setPen(pen)
        painter.drawPath(path)
        
        if self._is_active:
            painter.setBrush(color)
            painter.setPen(Qt.NoPen)
            if self.layout_type == "left":
                p = QPainterPath()
                p.addRoundedRect(QRectF(x, y, w*0.4, h), 2, 2)
                p.addRect(QRectF(x + w*0.4 - 2, y, 2, h))
                painter.drawPath(p)
            elif self.layout_type == "bottom":
                p = QPainterPath()
                p.addRoundedRect(QRectF(x, y + h*0.6, w, h*0.4), 2, 2)
                p.addRect(QRectF(x, y + h*0.6, w, 2))
                painter.drawPath(p)
            elif self.layout_type == "right":
                p = QPainterPath()
                p.addRoundedRect(QRectF(x + w*0.6, y, w*0.4, h), 2, 2)
                p.addRect(QRectF(x + w*0.6, y, 2, h))
                painter.drawPath(p)
            elif self.layout_type == "customize":
                p = QPainterPath()
                p.addRoundedRect(QRectF(x, y, w, h), 2, 2)
                p.addRect(QRectF(x + w*0.3, y, 2, h))
                p.addRect(QRectF(x + w*0.3, y + h*0.6, w*0.7, 2))
                painter.drawPath(p)
        else:
            painter.setPen(pen)
            if self.layout_type == "left":
                painter.drawLine(QPointF(x + w*0.4, y), QPointF(x + w*0.4, y + h))
            elif self.layout_type == "bottom":
                painter.drawLine(QPointF(x, y + h*0.6), QPointF(x + w, y + h*0.6))
            elif self.layout_type == "right":
                painter.drawLine(QPointF(x + w*0.6, y), QPointF(x + w*0.6, y + h))
            elif self.layout_type == "customize":
                p = QPainterPath()
                p.addRoundedRect(QRectF(x, y, w, h), 2, 2)
                painter.drawPath(p)

        painter.end()


class CustomTitleBar(QWidget):
    """VS Code style custom title bar combining window controls, title, and menu."""
    def __init__(self, parent: QMainWindow):
        super().__init__(parent)
        self.parent = parent
        self.setFixedHeight(35)
        self.setStyleSheet("""
            #CustomTitleBar {
                background-color: #000000; 
                color: #cccccc;
                border-bottom: 1px solid #3c0068;
            }
        """)
        self.setObjectName("CustomTitleBar")
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.layout = QHBoxLayout(self)
        self.layout.setContentsMargins(8, 0, 0, 0)
        self.layout.setSpacing(0)
        
        # App Icon
        self.app_icon = QLabel()
        self.app_icon.setStyleSheet("background: transparent; border: none;")
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        logo_path = os.path.join(base_dir, "image", "dardcor.png")
        if os.path.exists(logo_path):
            pixmap = QPixmap(logo_path)
            if not pixmap.isNull():
                self.app_icon.setPixmap(pixmap.scaled(20, 20, Qt.KeepAspectRatio, Qt.SmoothTransformation))
                self.app_icon.setContentsMargins(0, 0, 10, 0)
            else:
                self.app_icon.setText("D")
        else:
            self.app_icon.setText("D")
        self.layout.addWidget(self.app_icon, 0, Qt.AlignVCenter)
        
        # Menu Bar
        self.menu_bar = QMenuBar()
        self.menu_bar.setStyleSheet("""
            QMenuBar {
                background-color: transparent;
                color: #cccccc;
                padding: 8px 0px 0px 0px;
            }
            QMenuBar::item {
                padding: 2px 6px;
                background-color: transparent;
            }
            QMenuBar::item:selected {
                background-color: #1a0033;
                border-radius: 4px;
            }
        """)
        self.layout.addWidget(self.menu_bar)

        self.layout.addStretch(1)  # left stretch
        
        # Command Center
        self.command_center = CommandCenterWidget()
        self.command_center.setFixedWidth(500)
        
        # Connect buttons
        self.command_center.search_btn.clicked.connect(self.parent._show_command_palette)
        # Assuming we can connect back/forward to navigation (for now just print or no-op)
        
        self.layout.addWidget(self.command_center)

        self.layout.addStretch(2)  # larger right stretch shifts title left
        
        # Window controls (compact 38px width)
        btn_style = """
            QPushButton {
                background-color: transparent;
                border: none;
                color: #cccccc;
                font-family: codicon;
                font-size: 16px;
                width: 38px;
                height: 35px;
                padding: 0px;
            }
            QPushButton:hover {
                background-color: #1a0033;
            }
        """
        close_btn_style = """
            QPushButton {
                background-color: transparent;
                border: none;
                color: #cccccc;
                font-family: codicon;
                font-size: 16px;
                width: 38px;
                height: 35px;
                padding: 0px;
            }
            QPushButton:hover {
                background-color: #e81123;
                color: white;
            }
        """
        
        self.min_btn = QPushButton("\ueaba")
        self.min_btn.setFixedSize(38, 35)
        self.min_btn.setStyleSheet(btn_style)
        self.min_btn.clicked.connect(self.parent.showMinimized)

        self.max_btn = QPushButton("\ueab9")
        self.max_btn.setFixedSize(38, 35)
        self.max_btn.setStyleSheet(btn_style)
        self.max_btn.clicked.connect(self.toggle_max_restore)

        self.close_btn = QPushButton("\ueab8")
        self.close_btn.setFixedSize(38, 35)
        self.close_btn.setStyleSheet(close_btn_style)
        self.close_btn.clicked.connect(self.parent.close)

        # Layout toggles
        self.layout_controls = QWidget()
        lc_layout = QHBoxLayout(self.layout_controls)
        lc_layout.setContentsMargins(0, 0, 8, 0)
        lc_layout.setSpacing(0)
        
        self.btn_left_sidebar = LayoutToggleButton("left")
        self.btn_left_sidebar.setToolTip("Toggle Primary Sidebar")
        self.btn_left_sidebar.clicked.connect(lambda: self.parent._toggle_sidebar())
        
        self.btn_bottom_panel = LayoutToggleButton("bottom")
        self.btn_bottom_panel.setToolTip("Toggle Panel")
        self.btn_bottom_panel.clicked.connect(lambda: self.parent._toggle_terminal())
        
        self.btn_right_sidebar = LayoutToggleButton("right")
        self.btn_right_sidebar.setToolTip("Toggle Secondary Sidebar")
        self.btn_right_sidebar.clicked.connect(lambda: self.parent._toggle_chat())
        
        self.btn_customize = LayoutToggleButton("customize")
        self.btn_customize.setToolTip("Customize Layout")
        
        lc_layout.addWidget(self.btn_left_sidebar)
        lc_layout.addWidget(self.btn_bottom_panel)
        lc_layout.addWidget(self.btn_right_sidebar)
        lc_layout.addWidget(self.btn_customize)
        
        self.layout.addWidget(self.layout_controls, 0, Qt.AlignVCenter)

        # Chrome button — left of minimize
        self.chrome_btn = ChromeButton()
        self.chrome_btn.clicked.connect(self._open_chrome)

        self.layout.addWidget(self.chrome_btn, 0, Qt.AlignVCenter)
        self.layout.addWidget(self.min_btn)
        self.layout.addWidget(self.max_btn)
        self.layout.addWidget(self.close_btn)
        
        self.start_pos = None

    def _open_chrome(self):
        """Open Chrome with agent-specific profile."""
        success, msg = open_agent_chrome()
        if not success:
            from PySide6.QtWidgets import QMessageBox
            QMessageBox.warning(self, "Chrome", msg)

    def toggle_max_restore(self):
        if self.parent.isMaximized():
            self.parent.showNormal()
        else:
            self.parent.showMaximized()
            
    # Native event handling in MainWindow takes care of dragging and double click on Windows
    # Fallback for Linux:
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            from PySide6.QtWidgets import QApplication, QPushButton, QMenuBar
            widget = QApplication.widgetAt(event.globalPosition().toPoint())
            if isinstance(widget, QPushButton) or isinstance(widget, QMenuBar):
                return super().mousePressEvent(event)
            self.start_pos = event.globalPosition().toPoint() - self.parent.frameGeometry().topLeft()
            event.accept()
        else:
            super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton and self.start_pos is not None:
            if not self.parent.isMaximized():
                self.parent.move(event.globalPosition().toPoint() - self.start_pos)
                event.accept()
            else:
                super().mouseMoveEvent(event)
        else:
            super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self.start_pos = None
        super().mouseReleaseEvent(event)
        
    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.LeftButton:
            from PySide6.QtWidgets import QApplication, QPushButton, QMenuBar
            widget = QApplication.widgetAt(event.globalPosition().toPoint())
            if isinstance(widget, QPushButton) or isinstance(widget, QMenuBar):
                return super().mouseDoubleClickEvent(event)
            self.toggle_max_restore()
            event.accept()
        else:
            super().mouseDoubleClickEvent(event)

from dardcor_agent.chat.agent import Agent
from ..core.config import get_config, CONFIG_FILE
from dardcor_agent.chat.memory import Conversation
from ..core.filesystem import parse_python_symbols
from ..ui_shared.activity_bar import (
    ActivityBar, VIEW_EXPLORER, VIEW_SEARCH, VIEW_SOURCE_CONTROL,
    VIEW_EXTENSIONS,
)
from ..file_explorer.panel import FileExplorer
from ..editor import EditorTabs
from dardcor_agent.chat.panel import ChatPanel
from ..ui_shared.status_bar import StatusBar
from ..terminal import TerminalPanel
from ..search.panel import SearchPanel
from ..settings.settings_dialog import SettingsDialog
from ..ui_shared.command_palette import CommandPalette, GoToLineDialog, QuickOpenDialog
from ..git.panel import GitPanel
from ..ui_shared.problems_panel import ProblemsPanel
from ..ui_shared.output_panel import OutputPanel
from ..file_explorer.outline_panel import OutlinePanel
from ..file_explorer.timeline_panel import TimelinePanel
from ..debug.panel import DebugPanel
from ..ui_shared.bottom_panel import BottomPanel
from ..ui_shared.extensions_panel import ExtensionsPanel
from ..core.extension_manager import get_extension_manager

# --- Phase 13 Injections ---
from ..workspace.multi_root import MultiRootWorkspace
from ..tasks.task_manager import TaskManager
# ---------------------------

class MainWindow(QMainWindow):
    """Main application window matching VS Code layout exactly."""

    _run_queued_chat_signal = Signal()
    pending_messages_changed = Signal(int)

    def __init__(self):
        super().__init__()
        self._config = get_config()
        self._agent = Agent()
        self._chat_generation_active = False
        self._queued_chat_messages = []
        self._current_conversation_id = None
        self._font_size = self._config.font_size
        self._current_active_editor = None
        self._ext_manager = get_extension_manager()
        
        # --- Phase 13 Instantiations ---
        self._task_manager = TaskManager(self._config.workspace_path or "")
        # -------------------------------
        
        self._setup_agent()
        self._run_queued_chat_signal.connect(self._run_next_queued_chat_message)
        self._setup_ui()
        self._zen_mode = ZenModeManager(self)
        self._setup_breadcrumbs()
        self._setup_keybindings()
        self._setup_menu()
        self._setup_shortcuts()
        self._setup_command_palette()
        self._setup_extensions()

    # ── Window Events (Native Resizing & Maximize Icon) ──

    def changeEvent(self, event):
        if event.type() == QEvent.WindowStateChange:
            if self.isMaximized():
                self._title_bar.max_btn.setText("\ueabb") # chrome-restore
            else:
                self._title_bar.max_btn.setText("\ueab9") # chrome-maximize
        super().changeEvent(event)

    def nativeEvent(self, eventType, message):
        if os.name == "nt":
            msg = wintypes.MSG.from_address(message.__int__())
            if msg.message == 0x0084: # WM_NCHITTEST
                from PySide6.QtGui import QCursor
                logical_global_pos = QCursor.pos()
                pos = self.mapFromGlobal(logical_global_pos)
                
                w, h = self.width(), self.height()
                b = 8 # Border size for resizing
                
                # Check corners
                if pos.x() < b and pos.y() < b: return True, 13 # HTTOPLEFT
                if pos.x() > w - b and pos.y() < b: return True, 14 # HTTOPRIGHT
                if pos.x() < b and pos.y() > h - b: return True, 16 # HTBOTTOMLEFT
                if pos.x() > w - b and pos.y() > h - b: return True, 17 # HTBOTTOMRIGHT
                
                # Check edges
                if pos.x() < b: return True, 10 # HTLEFT
                if pos.x() > w - b: return True, 11 # HTRIGHT
                if pos.y() < b: return True, 12 # HTTOP
                if pos.y() > h - b: return True, 15 # HTBOTTOM
                
                # Check title bar
                if self._title_bar and self._title_bar.geometry().contains(pos):
                    # Use global logical cursor to check widgets exactly (fixes high DPI button clicks)
                    from PySide6.QtWidgets import QApplication, QPushButton, QMenuBar
                    widget = QApplication.widgetAt(logical_global_pos)
                    
                    if isinstance(widget, QPushButton) or isinstance(widget, QMenuBar):
                        # Let Qt handle mouse events for buttons/menus
                        return False, 0
                        
                    return True, 2 # HTCAPTION
        
        return super().nativeEvent(eventType, message)

    # ── Agent ──────────────────────────────────────────────

    def _setup_agent(self):
        self._agent.on_stream(self._on_agent_stream)
        self._agent.permission_callback = self._ask_command_permission

    def _ask_command_permission(self, command: str) -> bool:
        """Prompt user in a thread-safe blocking popup before running terminal commands."""
        import threading
        from PySide6.QtCore import QMetaObject, Qt, QTimer, QThread, QCoreApplication
        from PySide6.QtWidgets import QMessageBox
        
        result_holder = [False]
        event = threading.Event()
        
        def show_dialog():
            reply = QMessageBox.question(
                self, "AI Agent Command Authorization",
                f"The AI Agent wants to execute the following command:\n\n"
                f"{command}\n\n"
                f"Do you authorize this?",
                QMessageBox.Yes | QMessageBox.No
            )
            result_holder[0] = (reply == QMessageBox.Yes)
            event.set()
            
        app = QCoreApplication.instance()
        if app is None or QThread.currentThread() == app.thread():
            show_dialog()
            return result_holder[0]
            
        QTimer.singleShot(0, show_dialog)
        event.wait()
        return result_holder[0]

    # ── UI Layout ─────────────────────────────────────────

    def _setup_ui(self):
        # ── Window Settings ──
        self.setWindowTitle("Dardcor Code")
        self.setMinimumSize(600, 400)
        
        from PySide6.QtWidgets import QApplication
        screen_obj = QApplication.primaryScreen()
        if screen_obj:
            avail = screen_obj.availableGeometry()
            width = min(1440, int(avail.width() * 0.9))
            height = min(900, int(avail.height() * 0.9))
            self.resize(width, height)
            self.move(avail.x() + (avail.width() - width) // 2, avail.y() + (avail.height() - height) // 2)
        else:
            self.resize(1000, 700)
        
        # Set frameless window hint to hide native OS title bar, but keep system menu and minimize/maximize buttons hints so Windows taskbar clicks and Aero Snap work
        self.setWindowFlags(
            Qt.Window |
            Qt.FramelessWindowHint |
            Qt.WindowSystemMenuHint |
            Qt.WindowMinimizeButtonHint |
            Qt.WindowMaximizeButtonHint
        )
        
        self.setObjectName("MainWindow")
        self.setStyleSheet("#MainWindow { border: 1px solid #3c0068; }")
        
        # Set Window Icon
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        logo_path = os.path.join(base_dir, "image", "dardcor.png")
        if os.path.exists(logo_path):
            self.setWindowIcon(QIcon(logo_path))
        
        # Add custom title bar
        self._title_bar = CustomTitleBar(self)
        self.setMenuWidget(self._title_bar)

        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # ── Activity Bar (leftmost) ──
        self._activity_bar = ActivityBar()
        self._activity_bar.view_changed.connect(self._on_view_changed)
        main_layout.addWidget(self._activity_bar)

        # ── Sidebar Stack ──
        self._sidebar_stack = QStackedWidget()
        self._sidebar_stack.setMinimumWidth(200)

        explorer_wrapper = QWidget()
        explorer_wrapper.setStyleSheet("background-color: #000000;")
        explorer_layout = QVBoxLayout(explorer_wrapper)
        explorer_layout.setContentsMargins(0, 0, 0, 0)
        explorer_layout.setSpacing(0)

        self._file_explorer = FileExplorer(root_path=None)
        self._file_explorer.file_selected.connect(self._open_file_in_editor)
        self._file_explorer.root_changed.connect(self._on_root_changed)

        self._outline_panel = OutlinePanel()
        self._outline_panel.item_selected.connect(self._on_outline_item_selected)

        self._timeline_panel = TimelinePanel()

        explorer_layout.addWidget(self._file_explorer, 1)
        explorer_layout.addWidget(self._outline_panel, 0)
        explorer_layout.addWidget(self._timeline_panel, 0)
        explorer_layout.addStretch(0)

        self._sidebar_stack.addWidget(explorer_wrapper)

        self._search_panel = SearchPanel(root_path="")
        self._search_panel.file_selected.connect(
            lambda f, l: self._open_file_at_line(f, l)
        )
        self._sidebar_stack.addWidget(self._search_panel)

        self._git_panel = GitPanel(root_path="")
        self._git_panel.file_open_requested.connect(self._open_file_in_editor)
        self._git_panel.diff_open_requested.connect(self._open_diff_in_editor)
        self._git_panel.refreshed.connect(self._file_explorer._refresh)
        self._sidebar_stack.addWidget(self._git_panel)

        # Run and Debug Panel
        self._debug_panel = DebugPanel(self)
        self._debug_panel.debug_requested.connect(self._start_debugging)
        self._debug_panel.run_requested.connect(self._run_current_file)
        self._sidebar_stack.addWidget(self._debug_panel)

        self._extensions_panel = ExtensionsPanel()
        self._extensions_panel.extension_installed.connect(self._on_extension_installed)
        self._sidebar_stack.addWidget(self._extensions_panel)

        self._sidebar_stack.setCurrentIndex(0)

        # ── Editor Tabs ──
        self._editor_tabs = EditorTabs()

        # ── Breadcrumbs Navigation Bar (Disabled/Hidden) ──
        self._breadcrumbs_bar = None

        # Container: editor tabs stacked vertically
        self._editor_container = QWidget()
        self._editor_container.setStyleSheet("background-color: #3c0068;")
        self._editor_container_layout = QVBoxLayout(self._editor_container)
        self._editor_container_layout.setSizeConstraint(QVBoxLayout.SetNoConstraint)
        self._editor_container_layout.setContentsMargins(0, 0, 0, 0)
        self._editor_container_layout.setSpacing(0)
        self._editor_container_layout.addWidget(self._editor_tabs)

        # ── Chat Panel ──
        self._chat_panel = ChatPanel()
        self._chat_panel.message_sent.connect(self._on_chat_message)
        self._chat_panel.new_chat_requested.connect(self._new_conversation)
        self._chat_panel.history_requested.connect(self._show_chat_history)
        self._chat_panel.select_file_requested.connect(self._upload_chat_file)
        self._chat_panel.files_pasted.connect(self._attach_files_to_chat)
        self._chat_panel.stop_requested.connect(self._on_stop_requested)
        self._chat_panel.set_close_callback(self._toggle_chat)
        self._chat_panel.set_workspace_name("")

        # ── Bottom Panels ──
        self._problems_panel = ProblemsPanel()
        self._problems_panel.problem_selected.connect(self._open_file_at_line)
        self._output_panel = OutputPanel()
        self._debug_console = OutputPanel()
        self._terminal_panel = TerminalPanel(root_path=os.path.expanduser("~"))

        self._bottom_panel = BottomPanel()
        self._bottom_panel.set_panels(
            self._problems_panel,
            self._output_panel,
            self._debug_console,
            self._terminal_panel
        )
        self._bottom_panel.hide()

        # ── Layout assembly ──

        # Editor + Terminal vertical splitter
        self._editor_term_split = QSplitter(Qt.Vertical)
        self._editor_term_split.addWidget(self._editor_container)
        self._editor_term_split.addWidget(self._bottom_panel)
        self._editor_term_split.setStretchFactor(0, 1)
        self._editor_term_split.setStretchFactor(1, 0)
        self._editor_term_split.setSizes([600, 250])
        self._editor_term_split.setChildrenCollapsible(False)
        self._editor_term_split.setCollapsible(0, False)
        self._editor_term_split.setCollapsible(1, False)
        self._editor_tabs.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Ignored)
        self._editor_container.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.Ignored)
        self._editor_tabs.setMinimumHeight(1)
        self._editor_container.setMinimumHeight(1)
        self._bottom_panel.setMinimumHeight(80)
        self._editor_term_split.setHandleWidth(1)
        self._editor_term_split.setStyleSheet("""
            QSplitter::handle {
                background-color: #3c0068;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)

        # Center area + Chat horizontal splitter
        self._center_chat_split = QSplitter(Qt.Horizontal)
        self._center_chat_split.addWidget(self._editor_term_split)
        self._center_chat_split.addWidget(self._chat_panel)
        self._center_chat_split.setStretchFactor(0, 3)
        self._center_chat_split.setStretchFactor(1, 1)
        self._center_chat_split.setSizes([800, 350])
        self._center_chat_split.setHandleWidth(1)
        self._center_chat_split.setStyleSheet("""
            QSplitter::handle {
                background-color: #3c0068;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)

        # Sidebar + Main horizontal splitter
        self._horiz_split = QSplitter(Qt.Horizontal)
        self._horiz_split.addWidget(self._sidebar_stack)
        self._horiz_split.addWidget(self._center_chat_split)
        self._horiz_split.setStretchFactor(0, 0)
        self._horiz_split.setStretchFactor(1, 1)
        self._horiz_split.setSizes([260, 1000])
        self._horiz_split.setHandleWidth(1)
        self._horiz_split.setStyleSheet("""
            QSplitter::handle {
                background-color: #3c0068;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)

        main_layout.addWidget(self._horiz_split)

        # ── Status Bar ──
        self._status_bar = StatusBar()
        self.setStatusBar(self._status_bar)
        self._status_bar.go_to_line_requested.connect(self._show_go_to_line)
        self._status_bar.models_requested.connect(self._show_models_dialog)
        
        # ── Add QSizeGrip for Linux resizing ──
        import platform
        if platform.system() != "Windows":
            from PySide6.QtWidgets import QSizeGrip
            self.size_grip = QSizeGrip(self)
            self._status_bar.layout().addWidget(self.size_grip)

        # ── Connections ──
        self._editor_tabs.tab_changed.connect(self._on_tab_changed)

        # ── Initialize ──
        self._agent.new_conversation()
        QTimer.singleShot(500, self._check_engine)

        # Detect git branch
        QTimer.singleShot(1000, self._detect_git_branch)

        self._title_bar.btn_left_sidebar.setChecked(True)
        self._title_bar.btn_right_sidebar.setChecked(True)
        self._title_bar.btn_bottom_panel.setChecked(False)
        self._chat_panel.show()

        QTimer.singleShot(100, self._sync_toggle_states)

        if self._config.workspace_path and os.path.exists(self._config.workspace_path):
            def init_workspace():
                self._file_explorer.set_root(self._config.workspace_path)
                self._on_root_changed(self._config.workspace_path)
            QTimer.singleShot(200, init_workspace)

    # ── Menu Bar ──────────────────────────────────────────

    def _setup_menu(self):
        menubar = self._title_bar.menu_bar

        # ── File menu ──
        file_menu = menubar.addMenu("&File")

        new_file = QAction("New Text File", self)
        new_file.setShortcut(QKeySequence("Ctrl+N"))
        new_file.triggered.connect(self._new_file)
        file_menu.addAction(new_file)
        
        new_file_ellipses = QAction("New File...", self)
        new_file_ellipses.setShortcut(QKeySequence("Ctrl+Alt+Windows+N"))
        new_file_ellipses.triggered.connect(self._show_command_palette)
        file_menu.addAction(new_file_ellipses)

        new_window = QAction("New Window", self)
        new_window.setShortcut(QKeySequence("Ctrl+Shift+N"))
        new_window.triggered.connect(self._new_window)
        file_menu.addAction(new_window)

        file_menu.addSeparator()

        open_file = QAction("Open File...", self)
        open_file.setShortcut(QKeySequence("Ctrl+O"))
        open_file.triggered.connect(self._open_file_dialog)
        file_menu.addAction(open_file)

        open_folder = QAction("Open Folder...", self)
        open_folder.setShortcut(QKeySequence("Ctrl+K, Ctrl+O"))
        open_folder.triggered.connect(lambda: self._file_explorer._open_folder())
        file_menu.addAction(open_folder)

        open_workspace = QAction("Open Workspace from File...", self)
        open_workspace.triggered.connect(lambda: QMessageBox.information(self, "Workspace", "Workspace files support coming soon."))
        file_menu.addAction(open_workspace)

        open_recent_menu = file_menu.addMenu("Open Recent")
        clear_recent = QAction("Clear Recently Opened", self)
        clear_recent.triggered.connect(lambda: QMessageBox.information(self, "Recent", "History tracking coming soon."))
        open_recent_menu.addAction(clear_recent)

        file_menu.addSeparator()
        
        add_folder_ws = QAction("Add Folder to Workspace...", self)
        add_folder_ws.triggered.connect(self._show_command_palette)
        file_menu.addAction(add_folder_ws)
        
        save_ws_as = QAction("Save Workspace As...", self)
        save_ws_as.triggered.connect(self._show_command_palette)
        file_menu.addAction(save_ws_as)
        
        duplicate_ws = QAction("Duplicate Workspace", self)
        duplicate_ws.triggered.connect(self._show_command_palette)
        file_menu.addAction(duplicate_ws)

        file_menu.addSeparator()

        save_action = QAction("Save", self)
        save_action.setShortcut(QKeySequence("Ctrl+S"))
        save_action.triggered.connect(self._save_current_file)
        file_menu.addAction(save_action)

        save_as = QAction("Save As...", self)
        save_as.setShortcut(QKeySequence("Ctrl+Shift+S"))
        save_as.triggered.connect(self._save_as)
        file_menu.addAction(save_as)

        save_all = QAction("Save All", self)
        save_all.setShortcut(QKeySequence("Ctrl+K, S"))
        save_all.triggered.connect(self._save_all)
        file_menu.addAction(save_all)

        file_menu.addSeparator()
        
        share_menu = file_menu.addMenu("Share")
        share_export = QAction("Export Profile...", self)
        share_export.triggered.connect(self._show_command_palette)
        share_menu.addAction(share_export)
        
        file_menu.addSeparator()

        auto_save = QAction("Auto Save", self)
        auto_save.setCheckable(True)
        auto_save.setChecked(self._config.auto_save)
        auto_save.toggled.connect(self._on_auto_save_toggle)
        file_menu.addAction(auto_save)

        preferences_menu = file_menu.addMenu("Preferences")
        
        settings_action = QAction("Settings", self)
        settings_action.setShortcut(QKeySequence("Ctrl+,"))
        settings_action.triggered.connect(self._show_command_palette)
        preferences_menu.addAction(settings_action)
        
        extensions_action = QAction("Extensions", self)
        extensions_action.setShortcut(QKeySequence("Ctrl+Shift+X"))
        extensions_action.triggered.connect(lambda: self._switch_sidebar(VIEW_EXTENSIONS))
        preferences_menu.addAction(extensions_action)

        keyboard_shortcuts = QAction("Keyboard Shortcuts", self)
        keyboard_shortcuts.setShortcut(QKeySequence("Ctrl+K, Ctrl+S"))
        keyboard_shortcuts.triggered.connect(self._show_keyboard_shortcuts)
        preferences_menu.addAction(keyboard_shortcuts)
        
        keymaps = QAction("Keymaps", self)
        keymaps.setShortcut(QKeySequence("Ctrl+K, Ctrl+M"))
        keymaps.triggered.connect(self._show_command_palette)
        preferences_menu.addAction(keymaps)
        
        user_snippets = QAction("User Snippets", self)
        user_snippets.triggered.connect(self._show_command_palette)
        preferences_menu.addAction(user_snippets)
        
        preferences_menu.addSeparator()

        color_theme = QAction("Color Theme", self)
        color_theme.setShortcut(QKeySequence("Ctrl+K, Ctrl+T"))
        color_theme.triggered.connect(self._show_command_palette)
        preferences_menu.addAction(color_theme)
        
        file_icon_theme = QAction("File Icon Theme", self)
        file_icon_theme.triggered.connect(self._show_command_palette)
        preferences_menu.addAction(file_icon_theme)
        
        product_icon_theme = QAction("Product Icon Theme", self)
        product_icon_theme.triggered.connect(self._show_command_palette)
        preferences_menu.addAction(product_icon_theme)

        file_menu.addSeparator()

        revert_file = QAction("Revert File", self)
        revert_file.triggered.connect(self._show_command_palette)
        file_menu.addAction(revert_file)

        close_editor = QAction("Close Editor", self)
        close_editor.setShortcut(QKeySequence("Ctrl+W"))
        close_editor.triggered.connect(self._close_current_editor)
        file_menu.addAction(close_editor)

        close_folder = QAction("Close Folder", self)
        close_folder.setShortcut(QKeySequence("Ctrl+K, F"))
        close_folder.triggered.connect(self._close_folder)
        file_menu.addAction(close_folder)

        close_window = QAction("Close Window", self)
        close_window.setShortcut(QKeySequence("Alt+F4"))
        close_window.triggered.connect(self.close)
        file_menu.addAction(close_window)

        file_menu.addSeparator()

        exit_action = QAction("Exit", self)
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

        # ── Edit menu ──
        edit_menu = menubar.addMenu("&Edit")
        
        undo_action = QAction("Undo", self)
        undo_action.setShortcut(QKeySequence("Ctrl+Z"))
        undo_action.triggered.connect(lambda: self._editor_tabs.current_editor().undo() if self._editor_tabs.current_editor() else None)
        edit_menu.addAction(undo_action)
        
        redo_action = QAction("Redo", self)
        redo_action.setShortcut(QKeySequence("Ctrl+Y"))
        redo_action.triggered.connect(lambda: self._editor_tabs.current_editor().redo() if self._editor_tabs.current_editor() else None)
        edit_menu.addAction(redo_action)
        
        edit_menu.addSeparator()
        
        cut_action = QAction("Cut", self)
        cut_action.setShortcut(QKeySequence("Ctrl+X"))
        cut_action.triggered.connect(lambda: self._editor_tabs.current_editor().cut() if self._editor_tabs.current_editor() else None)
        edit_menu.addAction(cut_action)
        
        copy_action = QAction("Copy", self)
        copy_action.setShortcut(QKeySequence("Ctrl+C"))
        copy_action.triggered.connect(self._copy_from_focused_widget)
        edit_menu.addAction(copy_action)
        
        paste_action = QAction("Paste", self)
        paste_action.setShortcut(QKeySequence("Ctrl+V"))
        paste_action.triggered.connect(self._paste_into_focused_widget)
        edit_menu.addAction(paste_action)
        
        edit_menu.addSeparator()

        find_action = QAction("Find", self)
        find_action.setShortcut(QKeySequence("Ctrl+F"))
        find_action.triggered.connect(self._show_find)
        edit_menu.addAction(find_action)

        find_replace = QAction("Replace", self)
        find_replace.setShortcut(QKeySequence("Ctrl+H"))
        find_replace.triggered.connect(self._show_find_replace)
        edit_menu.addAction(find_replace)
        
        edit_menu.addSeparator()
        
        find_files = QAction("Find in Files", self)
        find_files.setShortcut(QKeySequence("Ctrl+Shift+F"))
        find_files.triggered.connect(lambda: self._switch_sidebar(VIEW_SEARCH))
        edit_menu.addAction(find_files)
        
        replace_files = QAction("Replace in Files", self)
        replace_files.setShortcut(QKeySequence("Ctrl+Shift+H"))
        replace_files.triggered.connect(lambda: self._switch_sidebar(VIEW_SEARCH))
        edit_menu.addAction(replace_files)

        edit_menu.addSeparator()
        
        toggle_line_comment = QAction("Toggle Line Comment", self)
        toggle_line_comment.setShortcut(QKeySequence("Ctrl+/"))
        toggle_line_comment.triggered.connect(lambda: self._run_editor_action("editor.action.commentLine"))
        edit_menu.addAction(toggle_line_comment)
        
        toggle_block_comment = QAction("Toggle Block Comment", self)
        toggle_block_comment.setShortcut(QKeySequence("Shift+Alt+A"))
        toggle_block_comment.triggered.connect(lambda: self._run_editor_action("editor.action.blockComment"))
        edit_menu.addAction(toggle_block_comment)
        
        emmet_expand = QAction("Emmet: Expand Abbreviation", self)
        emmet_expand.setShortcut(QKeySequence("Tab"))
        emmet_expand.triggered.connect(self._show_command_palette)
        edit_menu.addAction(emmet_expand)

        edit_menu.addSeparator()

        format_doc = QAction("Format Document", self)
        format_doc.setShortcut(QKeySequence("Shift+Alt+F"))
        format_doc.triggered.connect(lambda: self._editor_tabs.trigger_format() if self._editor_tabs.current_editor() else None)
        edit_menu.addAction(format_doc)

        edit_menu.addSeparator()

        # ── Selection menu ──
        sel_menu = menubar.addMenu("&Selection")

        select_all = QAction("Select All", self)
        select_all.setShortcut(QKeySequence("Ctrl+A"))
        select_all.triggered.connect(self._select_all)
        sel_menu.addAction(select_all)

        expand_sel = QAction("Expand Selection", self)
        expand_sel.setShortcut(QKeySequence("Shift+Alt+Right"))
        expand_sel.triggered.connect(self._editor_tabs.expand_selection)
        sel_menu.addAction(expand_sel)

        shrink_sel = QAction("Shrink Selection", self)
        shrink_sel.setShortcut(QKeySequence("Shift+Alt+Left"))
        shrink_sel.triggered.connect(self._editor_tabs.shrink_selection)
        sel_menu.addAction(shrink_sel)

        sel_menu.addSeparator()

        copy_up = QAction("Copy Line Up", self)
        copy_up.setShortcut(QKeySequence("Shift+Alt+Up"))
        copy_up.triggered.connect(self._editor_tabs.copy_line_up)
        sel_menu.addAction(copy_up)

        copy_down = QAction("Copy Line Down", self)
        copy_down.setShortcut(QKeySequence("Shift+Alt+Down"))
        copy_down.triggered.connect(self._editor_tabs.copy_line_down)
        sel_menu.addAction(copy_down)
        
        move_line_up = QAction("Move Line Up", self)
        move_line_up.setShortcut(QKeySequence("Alt+Up"))
        move_line_up.triggered.connect(lambda: self._run_editor_action("editor.action.moveLinesUpAction"))
        sel_menu.addAction(move_line_up)
        
        move_line_down = QAction("Move Line Down", self)
        move_line_down.setShortcut(QKeySequence("Alt+Down"))
        move_line_down.triggered.connect(lambda: self._run_editor_action("editor.action.moveLinesDownAction"))
        sel_menu.addAction(move_line_down)
        
        duplicate_selection = QAction("Duplicate Selection", self)
        duplicate_selection.triggered.connect(lambda: self._run_editor_action("editor.action.duplicateSelection"))
        sel_menu.addAction(duplicate_selection)
        
        sel_menu.addSeparator()
        
        add_cursor_above = QAction("Add Cursor Above", self)
        add_cursor_above.setShortcut(QKeySequence("Ctrl+Alt+Up"))
        add_cursor_above.triggered.connect(lambda: self._run_editor_action("editor.action.insertCursorAbove"))
        sel_menu.addAction(add_cursor_above)

        add_cursor_below = QAction("Add Cursor Below", self)
        add_cursor_below.setShortcut(QKeySequence("Ctrl+Alt+Down"))
        add_cursor_below.triggered.connect(lambda: self._run_editor_action("editor.action.insertCursorBelow"))
        sel_menu.addAction(add_cursor_below)
        
        add_cursors_to_line_ends = QAction("Add Cursors to Line Ends", self)
        add_cursors_to_line_ends.setShortcut(QKeySequence("Shift+Alt+I"))
        add_cursors_to_line_ends.triggered.connect(lambda: self._run_editor_action("editor.action.insertCursorAtEndOfEachLineSelected"))
        sel_menu.addAction(add_cursors_to_line_ends)
        
        add_next_occurrence = QAction("Add Next Occurrence", self)
        add_next_occurrence.setShortcut(QKeySequence("Ctrl+D"))
        add_next_occurrence.triggered.connect(lambda: self._run_editor_action("editor.action.addSelectionToNextFindMatch"))
        sel_menu.addAction(add_next_occurrence)
        
        add_previous_occurrence = QAction("Add Previous Occurrence", self)
        add_previous_occurrence.triggered.connect(lambda: self._run_editor_action("editor.action.addSelectionToPreviousFindMatch"))
        sel_menu.addAction(add_previous_occurrence)

        select_all_occur = QAction("Select All Occurrences", self)
        select_all_occur.setShortcut(QKeySequence("Ctrl+Shift+L"))
        select_all_occur.triggered.connect(lambda: self._run_editor_action("editor.action.selectHighlights"))
        sel_menu.addAction(select_all_occur)

        sel_menu.addSeparator()

        switch_ctrl_click = QAction("Switch to Ctrl+Click for Multi-Cursor", self)
        switch_ctrl_click.triggered.connect(self._show_command_palette)
        sel_menu.addAction(switch_ctrl_click)

        column_sel_mode = QAction("Column Selection Mode", self)
        column_sel_mode.triggered.connect(lambda: self._run_editor_action("editor.action.toggleColumnSelection"))
        sel_menu.addAction(column_sel_mode)

        # ── View menu ──
        view_menu = menubar.addMenu("&View")

        cmd_palette = QAction("Command Palette...", self)
        cmd_palette.setShortcut(QKeySequence("Ctrl+Shift+P"))
        cmd_palette.triggered.connect(self._show_command_palette)
        view_menu.addAction(cmd_palette)

        open_view = QAction("Open View...", self)
        open_view.triggered.connect(self._show_command_palette)
        view_menu.addAction(open_view)

        view_menu.addSeparator()

        # ── Appearance submenu ──
        appearance_menu = view_menu.addMenu("Appearance")
        
        full_screen = QAction("Full Screen", self)
        full_screen.setShortcut(QKeySequence("F11"))
        full_screen.triggered.connect(self._show_command_palette)
        appearance_menu.addAction(full_screen)
        
        zen_mode = QAction("Zen Mode", self)
        zen_mode.setShortcut(QKeySequence("Ctrl+K, Z"))
        zen_mode.triggered.connect(self._zen_mode.toggle_zen_mode)
        appearance_menu.addAction(zen_mode)
        
        centered_layout = QAction("Centered Layout", self)
        centered_layout.triggered.connect(self._show_command_palette)
        appearance_menu.addAction(centered_layout)
        
        appearance_menu.addSeparator()
        
        toggle_menu_bar = QAction("Menu Bar", self)
        toggle_menu_bar.triggered.connect(self._toggle_menu_bar)
        appearance_menu.addAction(toggle_menu_bar)
        
        primary_sidebar = QAction("Primary Side Bar", self)
        primary_sidebar.setShortcut(QKeySequence("Ctrl+B"))
        primary_sidebar.triggered.connect(self._toggle_sidebar)
        appearance_menu.addAction(primary_sidebar)
        
        secondary_sidebar = QAction("Secondary Side Bar", self)
        secondary_sidebar.triggered.connect(self._toggle_chat)
        appearance_menu.addAction(secondary_sidebar)
        
        status_bar = QAction("Status Bar", self)
        status_bar.triggered.connect(self._show_command_palette)
        appearance_menu.addAction(status_bar)
        
        activity_bar = QAction("Activity Bar", self)
        activity_bar.triggered.connect(self._show_command_palette)
        appearance_menu.addAction(activity_bar)
        
        panel = QAction("Panel", self)
        panel.setShortcut(QKeySequence("Ctrl+`"))
        panel.triggered.connect(self._toggle_terminal)
        appearance_menu.addAction(panel)

        layout_menu = view_menu.addMenu("Editor Layout")
        split_up = QAction("Split Up", self)
        split_up.triggered.connect(self._show_command_palette)
        layout_menu.addAction(split_up)
        
        split_down = QAction("Split Down", self)
        split_down.triggered.connect(self._show_command_palette)
        layout_menu.addAction(split_down)
        
        split_left = QAction("Split Left", self)
        split_left.triggered.connect(self._show_command_palette)
        layout_menu.addAction(split_left)
        
        split_right = QAction("Split Right", self)
        split_right.setShortcut(QKeySequence("Ctrl+\\\\"))
        split_right.triggered.connect(lambda: self._editor_tabs.split_editor("right"))
        layout_menu.addAction(split_right)

        view_menu.addSeparator()

        explorer_view = QAction("Explorer", self)
        explorer_view.setShortcut(QKeySequence("Ctrl+Shift+E"))
        explorer_view.triggered.connect(lambda: self._switch_sidebar(VIEW_EXPLORER))
        view_menu.addAction(explorer_view)

        search_view = QAction("Search", self)
        search_view.setShortcut(QKeySequence("Ctrl+Shift+F"))
        search_view.triggered.connect(lambda: self._switch_sidebar(VIEW_SEARCH))
        view_menu.addAction(search_view)

        scm_view = QAction("Source Control", self)
        scm_view.setShortcut(QKeySequence("Ctrl+Shift+G"))
        scm_view.triggered.connect(lambda: self._switch_sidebar(VIEW_SOURCE_CONTROL))
        view_menu.addAction(scm_view)
        
        run_view = QAction("Run", self)
        run_view.setShortcut(QKeySequence("Ctrl+Shift+D"))
        run_view.triggered.connect(self._show_command_palette)
        view_menu.addAction(run_view)

        ext_view = QAction("Extensions", self)
        ext_view.setShortcut(QKeySequence("Ctrl+Shift+X"))
        ext_view.triggered.connect(lambda: self._switch_sidebar(VIEW_EXTENSIONS))
        view_menu.addAction(ext_view)

        view_menu.addSeparator()

        problems_panel = QAction("Problems", self)
        problems_panel.setShortcut(QKeySequence("Ctrl+Shift+M"))
        problems_panel.triggered.connect(self._open_problems_panel)
        view_menu.addAction(problems_panel)

        output_panel = QAction("Output", self)
        output_panel.setShortcut(QKeySequence("Ctrl+Shift+U"))
        output_panel.triggered.connect(self._open_output_panel)
        view_menu.addAction(output_panel)

        debug_console = QAction("Debug Console", self)
        debug_console.setShortcut(QKeySequence("Ctrl+Shift+Y"))
        debug_console.triggered.connect(self._open_debug_console)
        view_menu.addAction(debug_console)
        
        terminal_panel = QAction("Terminal", self)
        terminal_panel.setShortcut(QKeySequence("Ctrl+`"))
        terminal_panel.triggered.connect(self._toggle_terminal)
        view_menu.addAction(terminal_panel)

        view_menu.addSeparator()

        toggle_word_wrap = QAction("Word Wrap", self)
        toggle_word_wrap.setShortcut(QKeySequence("Alt+Z"))
        toggle_word_wrap.triggered.connect(self._toggle_word_wrap)
        view_menu.addAction(toggle_word_wrap)

        view_menu.addSeparator()

        zoom_in = QAction("Zoom In", self)
        zoom_in.setShortcut(QKeySequence("Ctrl+="))
        zoom_in.triggered.connect(self._zoom_in)
        view_menu.addAction(zoom_in)

        zoom_out = QAction("Zoom Out", self)
        zoom_out.setShortcut(QKeySequence("Ctrl+-"))
        zoom_out.triggered.connect(self._zoom_out)
        view_menu.addAction(zoom_out)

        view_menu.addSeparator()

        md_preview_action = QAction("Markdown Preview", self)
        md_preview_action.setShortcut(QKeySequence("Ctrl+Shift+V"))
        md_preview_action.triggered.connect(self._open_markdown_preview)
        view_menu.addAction(md_preview_action)

        # ── Go menu ──
        go_menu = menubar.addMenu("&Go")

        back_action = QAction("Back", self)
        back_action.setShortcut(QKeySequence("Alt+Left"))
        back_action.triggered.connect(lambda: self._status_bar.set_connected(True))
        go_menu.addAction(back_action)

        forward_action = QAction("Forward", self)
        forward_action.setShortcut(QKeySequence("Alt+Right"))
        forward_action.triggered.connect(lambda: self._status_bar.set_connected(True))
        go_menu.addAction(forward_action)
        
        last_edit_location = QAction("Last Edit Location", self)
        last_edit_location.setShortcut(QKeySequence("Ctrl+K, Ctrl+Q"))
        last_edit_location.triggered.connect(self._show_command_palette)
        go_menu.addAction(last_edit_location)
        
        go_menu.addSeparator()
        
        switch_editor_menu = go_menu.addMenu("Switch Editor")
        next_editor = QAction("Next Editor", self)
        next_editor.triggered.connect(self._show_command_palette)
        switch_editor_menu.addAction(next_editor)
        prev_editor = QAction("Previous Editor", self)
        prev_editor.triggered.connect(self._show_command_palette)
        switch_editor_menu.addAction(prev_editor)
        
        switch_group_menu = go_menu.addMenu("Switch Group")
        next_group = QAction("Next Group", self)
        next_group.triggered.connect(self._show_command_palette)
        switch_group_menu.addAction(next_group)
        prev_group = QAction("Previous Group", self)
        prev_group.triggered.connect(self._show_command_palette)
        switch_group_menu.addAction(prev_group)

        go_menu.addSeparator()

        go_to_file = QAction("Go to File...", self)
        go_to_file.setShortcut(QKeySequence("Ctrl+P"))
        go_to_file.triggered.connect(self._show_quick_open)
        go_menu.addAction(go_to_file)
        
        go_to_symbol_ws = QAction("Go to Symbol in Workspace...", self)
        go_to_symbol_ws.setShortcut(QKeySequence("Ctrl+T"))
        go_to_symbol_ws.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_symbol_ws)

        go_to_symbol = QAction("Go to Symbol in Editor...", self)
        go_to_symbol.setShortcut(QKeySequence("Ctrl+Shift+O"))
        go_to_symbol.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_symbol)
        
        go_menu.addSeparator()

        go_to_def = QAction("Go to Definition", self)
        go_to_def.setShortcut(QKeySequence("F12"))
        go_to_def.triggered.connect(self._editor_tabs.go_to_definition)
        go_menu.addAction(go_to_def)
        
        go_to_decl = QAction("Go to Declaration", self)
        go_to_decl.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_decl)
        
        go_to_type_def = QAction("Go to Type Definition", self)
        go_to_type_def.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_type_def)
        
        go_to_impl = QAction("Go to Implementations", self)
        go_to_impl.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_impl)
        
        go_to_ref = QAction("Go to References", self)
        go_to_ref.setShortcut(QKeySequence("Shift+F12"))
        go_to_ref.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_ref)

        go_menu.addSeparator()

        go_to_line = QAction("Go to Line/Column...", self)
        go_to_line.setShortcut(QKeySequence("Ctrl+G"))
        go_to_line.triggered.connect(self._show_go_to_line)
        go_menu.addAction(go_to_line)
        
        go_to_bracket = QAction("Go to Bracket", self)
        go_to_bracket.setShortcut(QKeySequence("Ctrl+Shift+\\\\"))
        go_to_bracket.triggered.connect(self._show_command_palette)
        go_menu.addAction(go_to_bracket)

        go_menu.addSeparator()

        next_prob = QAction("Next Problem", self)
        next_prob.setShortcut(QKeySequence("F8"))
        go_menu.addAction(next_prob)
        
        prev_prob = QAction("Previous Problem", self)
        prev_prob.setShortcut(QKeySequence("Shift+F8"))
        go_menu.addAction(prev_prob)
        
        go_menu.addSeparator()
        
        next_change = QAction("Next Change", self)
        next_change.triggered.connect(self._show_command_palette)
        go_menu.addAction(next_change)
        
        prev_change = QAction("Previous Change", self)
        prev_change.triggered.connect(self._show_command_palette)
        go_menu.addAction(prev_change)

        # ── Run menu ──
        run_menu = menubar.addMenu("&Run")

        start_debug = QAction("Start Debugging", self)
        start_debug.setShortcut(QKeySequence("F5"))
        start_debug.triggered.connect(self._start_debugging)
        run_menu.addAction(start_debug)

        run_no_debug = QAction("Run Without Debugging", self)
        run_no_debug.setShortcut(QKeySequence("Ctrl+F5"))
        run_no_debug.triggered.connect(self._run_current_file)
        run_menu.addAction(run_no_debug)
        
        stop_debug = QAction("Stop Debugging", self)
        stop_debug.setShortcut(QKeySequence("Shift+F5"))
        stop_debug.triggered.connect(self._show_command_palette)
        run_menu.addAction(stop_debug)
        
        restart_debug = QAction("Restart Debugging", self)
        restart_debug.setShortcut(QKeySequence("Ctrl+Shift+F5"))
        restart_debug.triggered.connect(self._show_command_palette)
        run_menu.addAction(restart_debug)

        run_menu.addSeparator()
        
        open_configs = QAction("Open Configurations", self)
        open_configs.triggered.connect(self._show_command_palette)
        run_menu.addAction(open_configs)
        
        add_config = QAction("Add Configuration...", self)
        add_config.triggered.connect(self._show_command_palette)
        run_menu.addAction(add_config)
        
        run_menu.addSeparator()
        
        step_over = QAction("Step Over", self)
        step_over.setShortcut(QKeySequence("F10"))
        step_over.triggered.connect(self._show_command_palette)
        run_menu.addAction(step_over)
        
        step_into = QAction("Step Into", self)
        step_into.setShortcut(QKeySequence("F11"))
        step_into.triggered.connect(self._show_command_palette)
        run_menu.addAction(step_into)
        
        step_out = QAction("Step Out", self)
        step_out.setShortcut(QKeySequence("Shift+F11"))
        step_out.triggered.connect(self._show_command_palette)
        run_menu.addAction(step_out)
        
        continue_debug = QAction("Continue", self)
        continue_debug.setShortcut(QKeySequence("F5"))
        continue_debug.triggered.connect(self._show_command_palette)
        run_menu.addAction(continue_debug)

        run_menu.addSeparator()

        toggle_break = QAction("Toggle Breakpoint", self)
        toggle_break.setShortcut(QKeySequence("F9"))
        toggle_break.triggered.connect(self._editor_tabs.toggle_breakpoint)
        run_menu.addAction(toggle_break)
        
        new_break_menu = run_menu.addMenu("New Breakpoint")
        cond_break = QAction("Conditional Breakpoint...", self)
        cond_break.triggered.connect(self._show_command_palette)
        new_break_menu.addAction(cond_break)
        inline_break = QAction("Inline Breakpoint", self)
        inline_break.triggered.connect(self._show_command_palette)
        new_break_menu.addAction(inline_break)
        
        run_menu.addSeparator()
        
        enable_all_breakpoints = QAction("Enable All Breakpoints", self)
        enable_all_breakpoints.triggered.connect(self._show_command_palette)
        run_menu.addAction(enable_all_breakpoints)
        
        disable_all_breakpoints = QAction("Disable All Breakpoints", self)
        disable_all_breakpoints.triggered.connect(self._show_command_palette)
        run_menu.addAction(disable_all_breakpoints)
        
        remove_all_breakpoints = QAction("Remove All Breakpoints", self)
        remove_all_breakpoints.triggered.connect(self._show_command_palette)
        run_menu.addAction(remove_all_breakpoints)

        # ── Terminal menu ──
        terminal_menu = menubar.addMenu("&Terminal")

        new_terminal = QAction("New Terminal", self)
        new_terminal.setShortcut(QKeySequence("Ctrl+Shift+`"))
        new_terminal.triggered.connect(self._new_terminal)
        terminal_menu.addAction(new_terminal)

        split_terminal = QAction("Split Terminal", self)
        split_terminal.setShortcut(QKeySequence("Ctrl+Shift+5"))
        split_terminal.triggered.connect(self._split_terminal)
        terminal_menu.addAction(split_terminal)
        
        terminal_menu.addSeparator()

        run_task = QAction("Run Task...", self)
        run_task.triggered.connect(self._show_run_task)
        terminal_menu.addAction(run_task)
        
        run_build_task = QAction("Run Build Task...", self)
        run_build_task.setShortcut(QKeySequence("Ctrl+Shift+B"))
        run_build_task.triggered.connect(self._show_command_palette)
        terminal_menu.addAction(run_build_task)
        
        run_active_file = QAction("Run Active File", self)
        run_active_file.triggered.connect(self._run_current_file)
        terminal_menu.addAction(run_active_file)
        
        run_selected_text = QAction("Run Selected Text", self)
        run_selected_text.triggered.connect(self._show_command_palette)
        terminal_menu.addAction(run_selected_text)

        # ── Help menu ──
        help_menu = menubar.addMenu("&Help")

        welcome_action = QAction("Welcome", self)
        welcome_action.triggered.connect(lambda: self._new_conversation())
        help_menu.addAction(welcome_action)
        
        show_all_commands = QAction("Show All Commands", self)
        show_all_commands.triggered.connect(self._show_command_palette)
        help_menu.addAction(show_all_commands)
        
        documentation = QAction("Documentation", self)
        documentation.triggered.connect(self._show_command_palette)
        help_menu.addAction(documentation)
        
        editor_playground = QAction("Editor Playground", self)
        editor_playground.triggered.connect(self._show_command_palette)
        help_menu.addAction(editor_playground)
        
        release_notes = QAction("Show Release Notes", self)
        release_notes.triggered.connect(self._show_command_palette)
        help_menu.addAction(release_notes)

        help_menu.addSeparator()

        keyboard_ref = QAction("Keyboard Shortcuts Reference", self)
        keyboard_ref.setShortcut(QKeySequence("Ctrl+K, Ctrl+R"))
        keyboard_ref.triggered.connect(self._show_keyboard_shortcuts)
        help_menu.addAction(keyboard_ref)
        
        video_tutorials = QAction("Video Tutorials", self)
        video_tutorials.triggered.connect(self._show_command_palette)
        help_menu.addAction(video_tutorials)
        
        tips_tricks = QAction("Tips and Tricks", self)
        tips_tricks.triggered.connect(self._show_command_palette)
        help_menu.addAction(tips_tricks)

        help_menu.addSeparator()
        
        join_youtube = QAction("Join Us on YouTube", self)
        join_youtube.triggered.connect(self._show_command_palette)
        help_menu.addAction(join_youtube)
        
        search_feature_reqs = QAction("Search Feature Requests", self)
        search_feature_reqs.triggered.connect(self._show_command_palette)
        help_menu.addAction(search_feature_reqs)

        report_issue = QAction("Report Issue", self)
        report_issue.triggered.connect(self._report_issue)
        help_menu.addAction(report_issue)

        help_menu.addSeparator()
        
        view_license = QAction("View License", self)
        view_license.triggered.connect(self._show_command_palette)
        help_menu.addAction(view_license)
        
        privacy_statement = QAction("Privacy Statement", self)
        privacy_statement.triggered.connect(self._show_command_palette)
        help_menu.addAction(privacy_statement)
        
        help_menu.addSeparator()
        
        toggle_dev_tools = QAction("Toggle Developer Tools", self)
        toggle_dev_tools.triggered.connect(self._show_command_palette)
        help_menu.addAction(toggle_dev_tools)
        
        process_explorer = QAction("Open Process Explorer", self)
        process_explorer.triggered.connect(self._show_command_palette)
        help_menu.addAction(process_explorer)
        
        help_menu.addSeparator()
        
        check_updates = QAction("Check for Updates...", self)
        check_updates.triggered.connect(self._show_command_palette)
        help_menu.addAction(check_updates)

        about_action = QAction("About Dardcor Code", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)

    def _copy_from_focused_widget(self):
        focused_widget = QApplication.focusWidget()
        if isinstance(focused_widget, (QTextEdit, QPlainTextEdit, QLineEdit)):
            focused_widget.copy()
            return
        if hasattr(focused_widget, 'page') and hasattr(focused_widget, 'triggerAction'):
            try:
                from PySide6.QtWebEngineWidgets import QWebEnginePage
                focused_widget.page().triggerAction(QWebEnginePage.WebAction.Copy)
                return
            except Exception:
                pass
        parent = focused_widget
        while parent:
            if hasattr(parent, 'page') and hasattr(parent, 'triggerAction'):
                try:
                    from PySide6.QtWebEngineWidgets import QWebEnginePage
                    parent.page().triggerAction(QWebEnginePage.WebAction.Copy)
                    return
                except Exception:
                    break
            parent = parent.parentWidget() if hasattr(parent, 'parentWidget') else None
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.copy()

    def _paste_into_focused_widget(self):
        focused_widget = QApplication.focusWidget()
        if isinstance(focused_widget, (QTextEdit, QPlainTextEdit, QLineEdit)):
            focused_widget.paste()
            return
        if hasattr(focused_widget, 'page') and hasattr(focused_widget, 'triggerAction'):
            try:
                from PySide6.QtWebEngineWidgets import QWebEnginePage
                focused_widget.page().triggerAction(QWebEnginePage.WebAction.Paste)
                return
            except Exception:
                pass
        parent = focused_widget
        while parent:
            if hasattr(parent, 'page') and hasattr(parent, 'triggerAction'):
                try:
                    from PySide6.QtWebEngineWidgets import QWebEnginePage
                    parent.page().triggerAction(QWebEnginePage.WebAction.Paste)
                    return
                except Exception:
                    break
            parent = parent.parentWidget() if hasattr(parent, 'parentWidget') else None
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.paste()

    # ── Shortcuts ─────────────────────────────────────────

    def _setup_shortcuts(self):
        # Additional shortcuts not covered by menu
        pass

    # ── Command Palette ───────────────────────────────────

    def _setup_command_palette(self):
        self._command_palette = CommandPalette(self)
        self._command_palette.command_selected.connect(self._execute_command)

        root_path = self._config.workspace_path or os.path.expanduser("~")
        self._quick_open = QuickOpenDialog(root_path, self)
        self._quick_open.file_selected.connect(self._open_file_in_editor)

        self._commands = [
            {"id": "file.new", "label": "File: New File", "shortcut": "Ctrl+N"},
            {"id": "file.open", "label": "File: Open File...", "shortcut": "Ctrl+O"},
            {"id": "file.openFolder", "label": "File: Open Folder...", "shortcut": "Ctrl+K"},
            {"id": "file.save", "label": "File: Save", "shortcut": "Ctrl+S"},
            {"id": "file.saveAs", "label": "File: Save As...", "shortcut": "Ctrl+Shift+S"},
            {"id": "edit.find", "label": "Edit: Find", "shortcut": "Ctrl+F"},
            {"id": "edit.replace", "label": "Edit: Find and Replace", "shortcut": "Ctrl+H"},
            {"id": "edit.format", "label": "Format Document", "shortcut": "Shift+Alt+F"},
            {"id": "edit.settings", "label": "Preferences: Open Settings", "shortcut": ""},
            {"id": "view.toggleSidebar", "label": "View: Toggle Sidebar Visibility", "shortcut": "Ctrl+B"},
            {"id": "view.toggleChat", "label": "View: Toggle Chat Panel", "shortcut": "Ctrl+Shift+J"},
            {"id": "view.toggleTerminal", "label": "View: Toggle Terminal", "shortcut": "Ctrl+`"},
            {"id": "view.quickOpen", "label": "Go to File...", "shortcut": "Ctrl+P"},
            {"id": "view.goToLine", "label": "Go to Line...", "shortcut": "Ctrl+G"},
            {"id": "view.commandPalette", "label": "Show All Commands", "shortcut": "Ctrl+Shift+P"},
            {"id": "view.explorer", "label": "View: Show Explorer", "shortcut": "Ctrl+Shift+E"},
            {"id": "view.search", "label": "View: Show Search", "shortcut": "Ctrl+Shift+F"},
            {"id": "view.sourceControl", "label": "View: Show Source Control", "shortcut": "Ctrl+Shift+G"},
            {"id": "view.zoomIn", "label": "View: Zoom In", "shortcut": "Ctrl+="},
            {"id": "view.zoomOut", "label": "View: Zoom Out", "shortcut": "Ctrl+-"},
            {"id": "view.wordWrap", "label": "View: Toggle Word Wrap", "shortcut": "Alt+Z"},
            {"id": "view.zenMode", "label": "View: Toggle Zen Mode", "shortcut": "Ctrl+K, Z"},
            {"id": "markdown.preview", "label": "Markdown: Open Preview", "shortcut": "Ctrl+Shift+V"},
            {"id": "terminal.new", "label": "Terminal: Create New Terminal", "shortcut": "Ctrl+Shift+`"},
            {"id": "agent.newConversation", "label": "Dardcor AI: New Conversation", "shortcut": ""},
            {"id": "help.about", "label": "Help: About Dardcor Code", "shortcut": ""},
            {"id": "help.shortcuts", "label": "Help: Keyboard Shortcuts Reference", "shortcut": ""},
        ]

    # ── Breadcrumbs ───────────────────────────────────────

    def _setup_breadcrumbs(self):
        """Connect breadcrumbs signals to handlers."""
        if self._breadcrumbs_bar:
            self._breadcrumbs_bar.segment_clicked.connect(self._on_breadcrumb_clicked)
            self._breadcrumbs_bar.symbol_selected.connect(self._on_breadcrumb_symbol)

    def _on_breadcrumb_clicked(self, path: str):
        """Open QuickOpen filtered to the clicked breadcrumb path."""
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.show_quick_open(path)

    def _on_breadcrumb_symbol(self, line: int):
        """Jump to the selected symbol line in the editor."""
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.reveal_line(line)

    # ── Keybindings ────────────────────────────────────────

    def _setup_keybindings(self):
        """Initialize keybindings manager with defaults from command palette."""
        defaults = [
            {"id": k, "label": v, "shortcut": s}
            for k, v, s in [
                ("file.new", "File: New File", "Ctrl+N"),
                ("file.open", "File: Open File...", "Ctrl+O"),
                ("file.openFolder", "File: Open Folder...", "Ctrl+K"),
                ("file.save", "File: Save", "Ctrl+S"),
                ("file.saveAs", "File: Save As...", "Ctrl+Shift+S"),
                ("edit.find", "Edit: Find", "Ctrl+F"),
                ("edit.replace", "Edit: Find and Replace", "Ctrl+H"),
                ("edit.format", "Format Document", "Shift+Alt+F"),
                ("edit.settings", "Preferences: Open Settings", ""),
                ("view.toggleSidebar", "View: Toggle Sidebar Visibility", "Ctrl+B"),
                ("view.toggleChat", "View: Toggle Chat Panel", "Ctrl+Shift+J"),
                ("view.toggleTerminal", "View: Toggle Terminal", "Ctrl+`"),
                ("view.quickOpen", "Go to File...", "Ctrl+P"),
                ("view.goToLine", "Go to Line...", "Ctrl+G"),
                ("view.commandPalette", "Show All Commands", "Ctrl+Shift+P"),
                ("view.explorer", "View: Show Explorer", "Ctrl+Shift+E"),
                ("view.search", "View: Show Search", "Ctrl+Shift+F"),
                ("view.sourceControl", "View: Show Source Control", "Ctrl+Shift+G"),
                ("view.zoomIn", "View: Zoom In", "Ctrl+="),
                ("view.zoomOut", "View: Zoom Out", "Ctrl+-"),
                ("view.wordWrap", "View: Toggle Word Wrap", "Alt+Z"),
                ("terminal.new", "Terminal: Create New Terminal", "Ctrl+Shift+`"),
                ("agent.newConversation", "Dardcor AI: New Conversation", ""),
                ("help.about", "Help: About Dardcor Code", ""),
                ("help.shortcuts", "Help: Keyboard Shortcuts Reference", ""),
            ]
        ]
        self._keybindings_manager = KeybindingsManager(defaults)

    def _execute_command(self, cmd_id: str):
        handlers = {
            "file.new": self._new_file,
            "file.open": self._open_file_dialog,
            "file.openFolder": lambda: self._file_explorer._open_folder(),
            "file.save": self._save_current_file,
            "file.saveAs": self._save_as,
            "edit.find": self._show_find,
            "edit.replace": self._show_find_replace,
            "edit.format": lambda: self._editor_tabs.trigger_format() if self._editor_tabs.current_editor() else None,
            "view.toggleSidebar": self._toggle_sidebar,
            "view.toggleChat": self._toggle_chat,
            "view.toggleTerminal": self._toggle_terminal,
            "view.quickOpen": self._show_quick_open,
            "view.goToLine": self._show_go_to_line,
            "view.commandPalette": self._show_command_palette,
            "view.explorer": lambda: self._switch_sidebar(VIEW_EXPLORER),
            "view.search": lambda: self._switch_sidebar(VIEW_SEARCH),
            "view.sourceControl": lambda: self._switch_sidebar(VIEW_SOURCE_CONTROL),
            "view.zoomIn": self._zoom_in,
            "view.zoomOut": self._zoom_out,
            "view.wordWrap": self._toggle_word_wrap,
            "view.zenMode": self._zen_mode.toggle_zen_mode,
            "markdown.preview": self._open_markdown_preview,
            "terminal.new": self._new_terminal,
            "agent.newConversation": self._new_conversation,
            "help.about": self._show_about,
            "help.shortcuts": self._show_keyboard_shortcuts,
        }
        handler = handlers.get(cmd_id)
        if handler:
            handler()
        else:
            self._ext_manager.execute_command(cmd_id)

    def _setup_extensions(self):
        from ..core.lsp_client import get_lsp_manager
        from ..core.dap_client import get_dap_manager
        self._lsp_manager = get_lsp_manager()
        self._dap_manager = get_dap_manager()

        self._ext_manager.set_event_handler("get_active_editor_content", lambda _: self._editor_tabs.current_editor().get_content() if self._editor_tabs.current_editor() else "")
        self._ext_manager.set_event_handler("get_active_editor_path", lambda _: self._editor_tabs.current_editor().get_file_path() if self._editor_tabs.current_editor() else "")
        self._ext_manager.set_event_handler("set_active_editor_content", lambda c: self._editor_tabs.current_editor().set_content(c) if self._editor_tabs.current_editor() else None)
        self._ext_manager.set_event_handler("insert_text_at_cursor", lambda t: self._editor_tabs.current_editor().insert_text(t) if self._editor_tabs.current_editor() else None)
        self._ext_manager.set_event_handler("open_file", lambda p: self._open_file_in_editor(p))
        self._ext_manager.set_event_handler("get_config", lambda d: self._config.__dict__.get(d["key"], d["default"]))
        self._ext_manager.set_event_handler("set_config", lambda d: setattr(self._config, d["key"], d["value"]) or self._config.save())
        self._ext_manager.set_event_handler("get_workspace_path", lambda _: self._config.workspace_path or "")
        self._ext_manager.set_event_handler("notification", lambda d: QMessageBox.information(self, "Extension", d["message"]) if d["type"] == "info" else QMessageBox.warning(self, "Extension", d["message"]))

        from ..core.extension_host import get_extension_host
        host = get_extension_host()
        host.register_callback("commands.registerCommand", lambda cmd: None)
        host.register_callback("commands.unregisterCommand", lambda cmd: None)
        host.register_callback("window.showInformationMessage", lambda msg: QMessageBox.information(self, "Extension", msg))
        host.register_callback("window.showWarningMessage", lambda msg: QMessageBox.warning(self, "Extension", msg))
        host.register_callback("window.showErrorMessage", lambda msg: QMessageBox.critical(self, "Extension", msg))
        host.register_callback("window.statusBarShow", lambda p: self._status_bar.set_ext_status(p.get("text", ""), p.get("tooltip", "")))
        host.register_callback("window.createTerminal", lambda p: self._new_terminal())
        host.register_callback("window.createOutputChannel", lambda p: None)
        host.register_callback("window.outputAppend", lambda p: None)

        self._ext_manager.activate_all_enabled()
        self._apply_extension_menu_items()

    def _apply_extension_menu_items(self):
        ext_menu = self._title_bar.menu_bar.addMenu("Extensions")
        for item in self._ext_manager.get_menu_items():
            action = QAction(item.label, self)
            if item.shortcut:
                action.setShortcut(QKeySequence(item.shortcut))
            action.triggered.connect(lambda checked=False, cmd=item.command_id: self._ext_manager.execute_command(cmd))
            ext_menu.addAction(action)

    def _on_extension_installed(self, ext_name: str):
        self._ext_manager.activate_extension(ext_name)
        self._apply_extension_menu_items()
        for cmd_id, cmd in self._ext_manager.get_all_commands().items():
            found = any(c["id"] == cmd_id for c in self._commands)
            if not found:
                self._commands.append({"id": cmd_id, "label": cmd.label, "shortcut": cmd.shortcut})

    def _on_lsp_diagnostics(self, uri: str, diagnostics: list):
        markers = []
        for d in diagnostics:
            rng = d.get("range", {})
            start = rng.get("start", {})
            end = rng.get("end", {})
            sev = d.get("severity", 1)
            markers_map = {1: "error", 2: "warning", 3: "information", 4: "hint"}
            markers.append({
                "severity": markers_map.get(sev, "warning"),
                "startLine": start.get("line", 0) + 1,
                "startColumn": start.get("character", 0),
                "endLine": end.get("line", 0) + 1,
                "endColumn": end.get("character", 0),
                "message": d.get("message", ""),
                "source": d.get("source", "lsp"),
            })
        editor = self._editor_tabs.current_editor()
        if editor and uri.replace("\\", "/").endswith((editor.get_file_path() or "").replace("\\", "/").split("/")[-1]):
            editor.set_diagnostics(markers)
        errors = sum(1 for m in markers if m["severity"] == "error")
        warnings = sum(1 for m in markers if m["severity"] == "warning")
        self._status_bar.set_errors_warnings(errors, warnings)

    # ── File operations ───────────────────────────────────

    def _show_models_dialog(self):
        try:
            from dardcor_agent.models.main_dialog import ModelsQuotaDialog
            self._models_dialog = ModelsQuotaDialog(parent=self)
            self._models_dialog.setAttribute(Qt.WA_DeleteOnClose)
            self._models_dialog.show()
        except Exception as e:
            print(f"Error opening Models Dashboard: {e}")

    def _new_file(self):
        """Create a new untitled file."""
        self._editor_tabs.new_file()

    def _new_window(self):
        """Open a new application window."""
        import subprocess
        import sys
        import os
        try:
            exe = sys.executable
            if sys.platform == "win32" and exe.lower().endswith("python.exe"):
                # Use pythonw.exe to avoid Windows console allocation entirely
                pythonw = exe[:-10] + "pythonw.exe"
                if os.path.exists(pythonw):
                    exe = pythonw

            cmd = [exe, sys.argv[0]]
            
            flags = 0
            if sys.platform == "win32":
                flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
                
            # Disconnect standard I/O to prevent blocking/lagging the current process
            subprocess.Popen(
                cmd, 
                creationflags=flags,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True
            )
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Failed to open new window: {e}")

    def _open_file_dialog(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open File")
        if path:
            self._open_file_in_editor(path)

    def _open_file_in_editor(self, path: str):
        if os.path.isfile(path):
            editor = self._editor_tabs.open_file(path)
            if editor:
                self._status_bar.set_language(editor.get_language())
                lang_id = "python" if path.endswith(".py") else ""
                if lang_id and hasattr(self, "_lsp_manager"):
                    client = self._lsp_manager.get_client(lang_id)
                    if not client:
                        if lang_id == "python":
                            client = self._lsp_manager.start_python_lsp()
                    if client:
                        editor.set_lsp_client(client)
                        client.on_diagnostics(self._on_lsp_diagnostics)
            self._status_bar.set_cursor_position(1, 1)

    def _open_diff_in_editor(self, path: str, original: str, modified: str):
        editor = self._editor_tabs.open_diff(path, original, modified)
        if editor:
            self._status_bar.set_language(editor.get_language())
        self._status_bar.set_cursor_position(1, 1)

    def _open_file_at_line(self, path: str, line: int):
        self._open_file_in_editor(path)
        editor = self._editor_tabs.current_editor()
        if editor:
            QTimer.singleShot(300, lambda: editor.reveal_line(line))

    def _save_current_file(self):
        self._editor_tabs.save_current()

    def _save_as(self):
        editor = self._editor_tabs.current_editor()
        if not editor:
            return
        path, _ = QFileDialog.getSaveFileName(self, "Save As")
        if path:
            editor.save_as(path)

    def _save_all(self):
        self._editor_tabs.save_all()

    def _on_auto_save_toggle(self, checked: bool):
        self._config.auto_save = checked
        self._config.save()

    def _close_current_editor(self):
        """Close the currently active editor tab (Ctrl+W)."""
        self._editor_tabs.close_current()

    def _close_folder(self):
        self._config.workspace_path = ""
        self._config.save()
        self._file_explorer.set_root(None)
        self._on_root_changed(None)

    def _select_all(self):
        """Select all text via Monaco's built-in command."""
        editor = self._editor_tabs.current_editor()
        if editor:
            editor._view.page().runJavaScript("editor && editor.trigger('', 'selectAll', {});")

    def _set_theme(self, theme_name: str):
        """Switch between Dark+, Light+, and High Contrast themes."""
        from .theme_manager import ThemeManager
        from PySide6.QtWidgets import QApplication
        
        app = QApplication.instance()
        if app:
            theme_id = "dark+"
            if theme_name == "light":
                theme_id = "light+"
            ThemeManager.apply_theme(app, theme_id)
            
        # Propagate theme changes to Monaco editor instances
        self._editor_tabs.set_theme(theme_name)

    def _toggle_menu_bar(self):
        """Toggle the visibility of the menu bar."""
        menu_bar = self._title_bar.menu_bar
        menu_bar.setVisible(not menu_bar.isVisible())

    def _open_problems_panel(self):
        self._bottom_panel.set_active_view("problems")
        self._status_bar.set_connected(True)

    def _open_output_panel(self):
        self._bottom_panel.set_active_view("output")

    def _open_debug_console(self):
        self._bottom_panel.set_active_view("debug")
        
    def _start_debugging(self):
        editor = self._editor_tabs.current_editor()
        if not editor or not editor.get_file_path():
            return
        self._bottom_panel.set_active_view("debug")
        file_path = editor.get_file_path()
        self._dap_manager.set_workspace(self._config.workspace_path or os.path.dirname(file_path))
        self._dap_manager.on_event(self._on_dap_event)

        def worker():
            config = {"type": "python", "request": "launch", "name": "Debug", "program": file_path, "console": "integratedTerminal"}
            client = self._dap_manager.start_python_debug(config)
            if client:
                self._debug_panel.set_dap_client(client)
            else:
                self._debug_panel._status_label.setText("Failed to start debugger")

        threading.Thread(target=worker, daemon=True).start()

    def _on_dap_event(self, event_name: str, body: dict):
        pass
        
    def _run_current_file(self):
        """Run the currently open file."""
        editor = self._editor_tabs.current_editor()
        if not editor or not editor.get_file_path():
            return
        filepath = editor.get_file_path()
        ext = os.path.splitext(filepath)[1]
        if ext == ".py":
            self._terminal_panel._new_terminal()
            from PySide6.QtCore import QTimer
            QTimer.singleShot(500, lambda: self._terminal_panel._terminals[-1].write_input(
                f'python "{filepath}"\r\n'
            ))
        else:
            self._terminal_panel._new_terminal()
            from PySide6.QtCore import QTimer
            QTimer.singleShot(500, lambda: self._terminal_panel._terminals[-1].write_input(
                f'start "" "{filepath}"\r\n'
            ))


    def _kill_terminal(self):
        """Kill the current terminal process."""
        self._terminal_panel._kill_current()

    def _split_terminal(self):
        """Split the current terminal."""
        if hasattr(self._terminal_panel, '_split_terminal'):
            self._terminal_panel._split_terminal()
        else:
            self._terminal_panel._new_terminal()

    def _run_editor_action(self, action_id: str):
        """Run a Monaco editor action by its ID on the currently active editor."""
        editor = self._editor_tabs.current_editor()
        if editor and editor._view_ready:
            import json
            js = f"editor.trigger('menu', {json.dumps(action_id)}, null);"
            editor._view.page().runJavaScript(js)

    def _report_issue(self):
        """Open the GitHub issues page."""
        import webbrowser
        webbrowser.open("https://github.com/Dardcor/dardcor-code/issues")

    # ── Tab events ────────────────────────────────────────

    def _on_tab_changed(self, file_path: str, language: str):
        self._status_bar.set_language(language)
        self._update_window_title(file_path)

        if self._current_active_editor:
            try:
                self._current_active_editor.cursor_position_changed.disconnect(self._on_cursor_moved)
                self._current_active_editor.content_changed.disconnect(self._on_editor_content_changed)
            except (TypeError, RuntimeError):
                pass

        self._timeline_panel.update_timeline(file_path)
        self._update_outline(file_path)

        # Update Breadcrumbs
        if self._breadcrumbs_bar:
            if file_path:
                self._breadcrumbs_bar.show()
                self._breadcrumbs_bar.update_breadcrumbs(file_path)
            else:
                self._breadcrumbs_bar.hide()

        editor = self._editor_tabs.current_editor()
        self._current_active_editor = editor
        if editor:
            editor.cursor_position_changed.connect(self._on_cursor_moved)
            editor.content_changed.connect(self._on_editor_content_changed)
            self._ext_manager.fire_event("active_editor_changed", file_path)

    def _on_cursor_moved(self, line: int, col: int):
        self._status_bar.set_cursor_position(line, col)
        if self._breadcrumbs_bar:
            self._breadcrumbs_bar.update_current_symbol(line)

    def _on_outline_item_selected(self, line: int):
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.reveal_line(line)
            editor.focus()

    def _update_outline(self, file_path: str):
        if not file_path or not file_path.endswith(".py"):
            self._outline_panel.set_symbols([])
            return

        editor = self._editor_tabs.current_editor()
        if editor:
            content = editor.get_content()
            symbols = parse_python_symbols(content)
            self._outline_panel.set_symbols(symbols)
        else:
            self._outline_panel.set_symbols([])

    def _on_editor_content_changed(self, content: str):
        editor = self._editor_tabs.current_editor()
        if editor:
            file_path = editor.get_file_path()
            if file_path and file_path.endswith(".py"):
                symbols = parse_python_symbols(content)
                self._outline_panel.set_symbols(symbols)

    # ── Root / workspace ──────────────────────────────────

    def _on_root_changed(self, path: str):
        effective = path or ""
        self._search_panel.set_root(effective)
        self._terminal_panel.set_workdir(effective or os.path.expanduser("~"))
        self._quick_open.set_root(effective)
        self._quick_open._all_files = []
        basename = os.path.basename(effective.rstrip("/\\")) if effective else ""
        self._chat_panel.set_workspace_name(basename.lower())
        self._git_panel.set_root(effective)
        self._config.workspace_path = effective
        self._config.save()
        self._update_window_title()
        QTimer.singleShot(100, self._detect_git_branch)

    def _update_window_title(self, file_path: str = None):
        """Update window title dynamically based on active file and workspace."""
        file_name = ""
        if file_path:
            file_name = os.path.basename(file_path)
        elif self._editor_tabs and self._editor_tabs.current_editor():
            fp = self._editor_tabs.current_editor().file_path
            if fp:
                file_name = os.path.basename(fp)
                
        workspace_name = ""
        if self._config.workspace_path:
            workspace_name = os.path.basename(self._config.workspace_path.rstrip("/\\\\"))
            
        if file_name and workspace_name:
            title = f"{file_name} - {workspace_name} - Dardcor Code"
            cc_title = f"{workspace_name}"
        elif workspace_name:
            title = f"{workspace_name} - Dardcor Code"
            cc_title = f"{workspace_name}"
        elif file_name:
            title = f"{file_name} - Dardcor Code"
            cc_title = "Dardcor Code"
        else:
            title = "Dardcor Code"
            cc_title = "Dardcor Code"
            
        self.setWindowTitle(title)
        
        if hasattr(self, '_title_bar') and hasattr(self._title_bar, 'command_center'):
            self._title_bar.command_center.set_title(cc_title)

    # ── Sidebar ───────────────────────────────────────────

    def _on_view_changed(self, view_id: int):
        if view_id < self._sidebar_stack.count():
            self._sidebar_stack.setCurrentIndex(view_id)
            if not self._sidebar_stack.isVisible():
                self._sidebar_stack.show()
            self._activity_bar.set_active(view_id)

    def _switch_sidebar(self, view_id: int):
        self._sidebar_stack.setCurrentIndex(view_id)
        self._activity_bar.set_active(view_id)
        if not self._sidebar_stack.isVisible():
            self._sidebar_stack.show()

    # ── Chat / Agent ──────────────────────────────────────

    def _on_chat_message(self, message: str):
        if self._chat_generation_active:
            if message in self._queued_chat_messages:
                return
            self._queued_chat_messages.append(message)
            self.pending_messages_changed.emit(len(self._queued_chat_messages))
            return

        self._start_chat_message(message)

    def _start_chat_message(self, message: str):
        self._chat_generation_active = True
        self._chat_panel.set_enabled(False)

        selected_model = None
        if self._chat_panel.model_dropdown.isVisible():
            selected_model = self._chat_panel.model_dropdown.currentText()

        def process():
            try:
                response = self._agent.send_message(
                    message,
                    model_override=selected_model,
                    on_tool_call=self._chat_panel.append_tool_call,
                    on_system_message=self._chat_panel.append_system_message,
                )
                if response and response != "Agent dihentikan oleh pengguna.":
                    self._chat_panel.append_agent_message(response)
                elif response == "Agent dihentikan oleh pengguna.":
                    self._chat_panel.append_system_message("⛔ Generation stopped.")
            except Exception as e:
                self._chat_panel.append_system_message(f"Error: {e}")
            finally:
                self._chat_generation_active = False
                self._chat_panel.show_typing(False)
                if self._queued_chat_messages:
                    self._run_queued_chat_signal.emit()
                else:
                    self._chat_panel.set_enabled(True)

        threading.Thread(target=process, daemon=True).start()

    def _run_next_queued_chat_message(self):
        if self._chat_generation_active or not self._queued_chat_messages:
            return
        next_message = self._queued_chat_messages.pop(0)
        self.pending_messages_changed.emit(len(self._queued_chat_messages))
        self._start_chat_message(next_message)

    def _on_stop_requested(self):
        self._agent.abort()

    def _on_agent_stream(self, text: str):
        pass

    def _new_conversation(self):
        self._queued_chat_messages.clear()
        self.pending_messages_changed.emit(0)
        self._chat_generation_active = False
        self._agent.new_conversation()
        self._chat_panel.clear()

    def _show_chat_history(self):
        convs = self._agent.list_conversations()
        if not convs:
            QMessageBox.information(self, "Chat History", "No chat history found.")
            return
            
        import sys
        sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
        from dardcor_agent.chat.history_dialog import ChatHistoryDialog
        
        dialog = ChatHistoryDialog(self._agent, self)
        
        def on_conversation_selected(conv_id: str):
            if self._agent.load_conversation(conv_id):
                self._chat_panel.clear()
                for msg in self._agent.get_conversation().messages:
                    if msg.role == "user":
                        self._chat_panel._append_user_message(msg.content)
                    elif msg.role == "assistant":
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                fn_name = tc.get("function", {}).get("name", "tool")
                                fn_args = tc.get("function", {}).get("arguments", "{}")
                                fn_id = tc.get("id", f"hist-{fn_name}-{hash(fn_args) & 0xFFFFFFFF:x}")
                                self._chat_panel._safe_append_tool_call(fn_id, fn_name, fn_args, status="success")
                        if msg.content:
                            self._chat_panel.append_agent_message(msg.content)
                    elif msg.role == "system":
                        # Only show system messages if it's not the identity prompt
                        if "You are Dardcor Code" not in msg.content:
                            self._chat_panel.append_system_message(msg.content)
                            
        dialog.conversation_selected.connect(on_conversation_selected)
        dialog.exec()

    def _upload_chat_file(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "Select File to Attach")
        if file_path:
            self._attach_files_to_chat([file_path])

    def _attach_files_to_chat(self, file_paths: list):
        if not file_paths:
            return
            
        conv = self._agent.get_conversation()
        if not conv or not conv.id:
            return
            
        store_dir = getattr(self._agent._store, '_store_dir', None)
        if not store_dir:
            return
            
        conv_dir = os.path.join(store_dir, conv.id)
        os.makedirs(conv_dir, exist_ok=True)
        
        for file_path in file_paths:
            if not os.path.exists(file_path):
                continue
                
            filename = os.path.basename(file_path)
            dest_path = os.path.join(conv_dir, filename)
            
            try:
                # Copy file into conversation folder
                import shutil
                if file_path != dest_path:
                    shutil.copy2(file_path, dest_path)
                
                # Add visual pill to the chat panel
                self._chat_panel.add_attachment(dest_path)
                
            except Exception as e:
                QMessageBox.warning(self, "Attachment Error", f"Failed to attach file {filename}: {e}")

    # ── Engine check ──────────────────────────────────────

    def _check_engine(self):
        if self._agent and self._agent.config:
            self._status_bar.set_connected(True)

    def _detect_git_branch(self):
        """Detect current git branch and update status bar."""
        from ..core.commands import CommandExecutor
        cmd = CommandExecutor()
        root = self._config.workspace_path or os.path.expanduser("~")
        result = cmd.execute("git rev-parse --abbrev-ref HEAD", workdir=root, timeout=5)
        branch = result.stdout.strip() if result.stdout else "main"
        if branch and result.exit_code == 0:
            self._status_bar.set_git_branch(branch)

    # ── Dialogs ───────────────────────────────────────────

    def _show_command_palette(self):
        self._command_palette.set_commands(self._commands)
        self._command_palette.show_palette()

    def _show_quick_open(self):
        self._quick_open.show_dialog()

    def _show_go_to_line(self):
        editor = self._editor_tabs.current_editor()
        if not editor:
            return
        dialog = GoToLineDialog(9999, self)
        dialog.line_selected.connect(lambda line: editor.reveal_line(line))
        dialog.show_dialog()

    def _show_find(self):
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.trigger_find()

    def _show_find_replace(self):
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.trigger_find_replace()

    def _show_about(self):
        QMessageBox.about(
            self,
            "About Dardcor Code",
            "Dardcor Code v1.0.8\n\n"
            "Full Desktop AI Coding Assistant\n\n"
            "A VS Code-like IDE with integrated AI pair programming.\n"
            "Built with Python + PySide6 (Qt)\n\n"
            "License: MIT\n"
            "https://github.com/Dardcor/dardcor-code",
        )

    def _show_keyboard_shortcuts(self):
        dialog = KeybindingsDialog(self._keybindings_manager, self)
        dialog.exec()

    # ── Markdown Preview ──────────────────────────────────

    def _open_markdown_preview(self):
        """Open a markdown preview dialog for the current file."""
        editor = self._editor_tabs.current_editor()
        if not editor:
            return
        file_path = editor.get_file_path()
        if not file_path:
            return
        if not file_path.lower().endswith(('.md', '.markdown')):
            QMessageBox.information(self, "Markdown Preview",
                "The current file is not a Markdown file.")
            return
        dialog = QDialog(self)
        dialog.setWindowTitle(f"Preview: {os.path.basename(file_path)}")
        dialog.resize(800, 600)
        preview = MarkdownPreviewWidget(file_path, dialog)
        layout = QVBoxLayout(dialog)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(preview)
        dialog.setStyleSheet("QDialog { background-color: #1e1b2e; }")
        dialog.exec()

    # ── Show/hide Git status ──────────────────────────────

    def _show_git_status(self):
        from ..core.commands import CommandExecutor
        cmd = CommandExecutor()
        root = self._config.workspace_path or os.path.expanduser("~")
        result = cmd.execute("git status", workdir=root, timeout=10)
        if result.stdout:
            self._chat_panel.append_system_message(f"Git Status:\n{result.stdout}")
        else:
            self._chat_panel.append_system_message(
                "Not a git repository or git not available."
            )

    # ── Toggle panels ─────────────────────────────────────

    def _sync_toggle_states(self):
        """Sync toggle button states with actual panel visibility after window is shown."""
        self._title_bar.btn_left_sidebar.setChecked(self._sidebar_stack.isVisible())
        self._title_bar.btn_right_sidebar.setChecked(self._chat_panel.isVisible())
        self._title_bar.btn_bottom_panel.setChecked(self._bottom_panel.isVisible())

    def _toggle_sidebar(self):
        visible = self._sidebar_stack.isVisible()
        self._sidebar_stack.setVisible(not visible)
        self._title_bar.btn_left_sidebar.setChecked(not visible)

    def _toggle_chat(self):
        visible = self._chat_panel.isVisible()
        self._chat_panel.setVisible(not visible)
        self._title_bar.btn_right_sidebar.setChecked(not visible)

    def _toggle_terminal(self):
        if self._bottom_panel.isVisible():
            if self._bottom_panel.current_view_name() != "terminal":
                self._bottom_panel.set_active_view("terminal")
                self._title_bar.btn_bottom_panel.setChecked(True)
            else:
                self._bottom_panel.hide()
                self._title_bar.btn_bottom_panel.setChecked(False)
        else:
            self._bottom_panel.set_active_view("terminal")
            self._title_bar.btn_bottom_panel.setChecked(True)

    def _new_terminal(self):
        if not self._bottom_panel.isVisible() or self._bottom_panel.current_view_name() != "terminal":
            self._bottom_panel.set_active_view("terminal")
            self._title_bar.btn_bottom_panel.setChecked(True)
        self._terminal_panel._new_terminal()

    def _show_run_task(self):
        if not self._task_manager:
            QMessageBox.information(self, "Tasks", "No workspace opened for tasks.")
            return
            
        tasks = self._task_manager.get_tasks()
        if not tasks:
            QMessageBox.information(self, "Tasks", "No tasks found in .vscode/tasks.json.")
            return
            
        labels = [t.get("label", "Unknown Task") for t in tasks]
        from PySide6.QtWidgets import QInputDialog
        task_label, ok = QInputDialog.getItem(self, "Run Task", "Select a task to run:", labels, 0, False)
        if ok and task_label:
            task = next((t for t in tasks if t.get("label") == task_label), None)
            if task:
                self._new_terminal()
                # Run via terminal output (placeholder logic for task)
                cmd = self._task_manager._build_command(task)
                if cmd:
                    from PySide6.QtCore import QTimer
                    QTimer.singleShot(500, lambda: self._terminal_panel._terminals[-1].write_input(f"{cmd}\r\n"))

    def _toggle_word_wrap(self):
        self._word_wrap = not getattr(self, '_word_wrap', False)
        self._editor_tabs.set_word_wrap(self._word_wrap)

    def _apply_font_size_to_all(self, size: int):
        """Apply font size to all Monaco editors via JS."""
        self._editor_tabs.set_font_size(size)

    def _zoom_in(self):
        self._font_size = min(self._font_size + 1, 32)
        self._apply_font_size_to_all(self._font_size)
        self._config.font_size = self._font_size
        self._config.save()

    def _zoom_out(self):
        self._font_size = max(self._font_size - 1, 8)
        self._apply_font_size_to_all(self._font_size)
        self._config.font_size = self._font_size
        self._config.save()

    # ── Close ─────────────────────────────────────────────

    def closeEvent(self, event):
        # Clean up terminal processes
        for term in self._terminal_panel._terminals:
            term.kill_all()
        # Save config
        self._config.save()
        super().closeEvent(event)
