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
from ..editor.centered_layout import CenteredLayoutManager
from .focus_manager import FocusManager
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


class SearchButton(QPushButton):
    """Custom button for the Command Center that allows window dragging and double-click to maximize."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self._start_pos = None
        self._is_dragging = False

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._start_pos = event.globalPosition().toPoint()
            self._is_dragging = False
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._start_pos is not None:
            delta = event.globalPosition().toPoint() - self._start_pos
            if delta.manhattanLength() > 3:
                self._is_dragging = True
                window = self.window()
                if not window.isMaximized():
                    window.move(window.pos() + delta)
                    self._start_pos = event.globalPosition().toPoint()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._start_pos is not None:
            self._start_pos = None
        if not self._is_dragging:
            super().mouseReleaseEvent(event)

    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.LeftButton:
            window = self.window()
            if hasattr(window, 'toggle_max_restore'):
                window.toggle_max_restore()
            elif window.isMaximized():
                window.showNormal()
            else:
                window.showMaximized()
            event.accept()


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
                background-color: #080808;
                border: 1px solid #3c0068;
                border-radius: 6px;
            }
            #SearchBox:hover {
                background-color: #1a0033;
                border: 1px solid #4a0072;
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
                background-color: #1a0033;
                color: #ffffff;
            }
            QLabel {
                background: transparent;
                border: none;
                color: #cccccc;
                font-size: 12px;
            }
        """)
        
        self.btn_back = QPushButton("\uea9b") # arrow-left
        self.btn_back.setToolTip("Go Back")
        self.btn_back.setFixedSize(28, 24)
        
        self.btn_forward = QPushButton("\uea9c") # arrow-right
        self.btn_forward.setToolTip("Go Forward")
        self.btn_forward.setFixedSize(28, 24)
        
        self.search_btn = SearchButton()
        self.search_btn.setObjectName("SearchBox")
        self.search_btn.setCursor(Qt.PointingHandCursor)
        self.search_btn.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        
        sc_layout = QHBoxLayout(self.search_btn)
        sc_layout.setContentsMargins(10, 0, 8, 0)
        sc_layout.setSpacing(6)
        
        self.lbl_title = QLabel("Dardcor Code")
        self.lbl_title.setStyleSheet("color: #cccccc;")
        self.lbl_title.setAlignment(Qt.AlignCenter)
        self.lbl_title.setAttribute(Qt.WA_TransparentForMouseEvents)
        
        separator = QLabel("|")
        separator.setStyleSheet("color: rgba(255, 255, 255, 0.15); font-size: 14px;")
        separator.setAttribute(Qt.WA_TransparentForMouseEvents)
        
        # Copilot/Chat sparkle icon
        copilot_icon = QLabel("\uec4f") # chat-sparkle codicon
        copilot_icon.setFont(QFont("codicon", 12))
        copilot_icon.setFixedWidth(16)
        copilot_icon.setAlignment(Qt.AlignCenter)
        copilot_icon.setStyleSheet("color: #cccccc;")
        copilot_icon.setAttribute(Qt.WA_TransparentForMouseEvents)
        
        chevron_down = QLabel("\ueab4") # chevron-down
        chevron_down.setFont(QFont("codicon", 10))
        chevron_down.setFixedWidth(12)
        chevron_down.setAlignment(Qt.AlignCenter)
        chevron_down.setStyleSheet("color: #858585;")
        chevron_down.setAttribute(Qt.WA_TransparentForMouseEvents)
        
        # Centering the title, keeping right icons fixed
        sc_layout.addStretch(1)
        sc_layout.addWidget(self.lbl_title)
        sc_layout.addStretch(1)
        
        sc_layout.addWidget(separator)
        sc_layout.addWidget(copilot_icon)
        sc_layout.addWidget(chevron_down)
        
        layout.addWidget(self.btn_back)
        layout.addWidget(self.btn_forward)
        layout.addWidget(self.search_btn, 1)

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
                self.app_icon.setContentsMargins(0, 0, 4, 0)
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
                padding: 4px 0px 0px 0px;
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

        # Command Center
        self.command_center = CommandCenterWidget()
        self.command_center.setMinimumWidth(400)
        self.command_center.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        
        # Connect buttons
        self.command_center.btn_back.clicked.connect(self.parent._navigate_back)
        self.command_center.btn_forward.clicked.connect(self.parent._navigate_forward)
        self.command_center.search_btn.clicked.connect(self.parent._show_command_center_quick_open)
        self.command_center.search_btn.setToolTip("Search (Ctrl+P)")
        
        self.layout.addWidget(self.command_center, 1)
        
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
        if getattr(self, "_is_custom_maximized", False) or self.parent.isMaximized():
            if getattr(self, "_is_custom_maximized", False) and hasattr(self, "_normal_geometry"):
                self.parent.setGeometry(self._normal_geometry)
            else:
                self.parent.showNormal()
            self._is_custom_maximized = False
            # Update icon to maximize
            self.max_btn.setText("\ueab9")
            self.parent.setStyleSheet("#MainWindow { border: 1px solid #3c0068; }")
        else:
            self._normal_geometry = self.parent.geometry()
            if os.name == 'nt':
                from PySide6.QtWidgets import QApplication
                screen = QApplication.screenAt(self.parent.geometry().center())
                if screen:
                    avail = screen.availableGeometry()
                    self.parent.setGeometry(avail)
                    self._is_custom_maximized = True
                else:
                    self.parent.showMaximized()
            else:
                self.parent.showMaximized()
            # Update icon to restore
            self.max_btn.setText("\ueabb") # chrome-restore
            self.parent.setStyleSheet("#MainWindow { border: none; }")
            
    # Native event handling in MainWindow takes care of dragging and double click on Windows
    # Fallback for Linux:
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            from PySide6.QtWidgets import QPushButton, QMenuBar
            child = self.childAt(event.position().toPoint())
            if child is not None:
                if isinstance(child, QPushButton) or isinstance(child, QMenuBar) or child.parent() == self.search_btn:
                    return super().mousePressEvent(event)
            self.start_pos = event.globalPosition().toPoint() - self.parent.frameGeometry().topLeft()
            event.accept()
        else:
            super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton and self.start_pos is not None:
            from PySide6.QtCore import QPoint
            if getattr(self, "_is_custom_maximized", False) or self.parent.isMaximized():
                self.toggle_max_restore()
                # Recalculate start_pos to be roughly centered relative to new width
                self.start_pos = QPoint(self.parent.width() // 2, self.start_pos.y())
                self.parent.move(event.globalPosition().toPoint() - self.start_pos)
                event.accept()
            else:
                self.parent.move(event.globalPosition().toPoint() - self.start_pos)
                event.accept()
        else:
            super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self.start_pos = None
        super().mouseReleaseEvent(event)
        
    def mouseDoubleClickEvent(self, event):
        if event.button() == Qt.LeftButton:
            from PySide6.QtWidgets import QPushButton, QMenuBar
            child = self.childAt(event.position().toPoint())
            if child is not None:
                if isinstance(child, QPushButton) or isinstance(child, QMenuBar) or child.parent() == self.search_btn:
                    return super().mouseDoubleClickEvent(event)
            self.toggle_max_restore()
            event.accept()
        else:
            super().mouseDoubleClickEvent(event)

from dardcor_agent.chat.agent import Agent
from ..core.config import get_config, CONFIG_FILE
from dardcor_agent.chat.memory import Conversation
from ..ui_shared.activity_bar import (
    ActivityBar, VIEW_EXPLORER, VIEW_SEARCH, VIEW_SOURCE_CONTROL,
    VIEW_EXTENSIONS, VIEW_TESTING, EXT_VIEW_BASE
)
from ..file_explorer.panel import FileExplorer
from ..file_explorer.open_editors_panel import OpenEditorsPanel
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
from ..file_explorer.outline_panel import OutlinePanel, parse_outline_symbols
from ..file_explorer.timeline_panel import TimelinePanel
from ..debug.panel import DebugPanel
from ..ui_shared.bottom_panel import BottomPanel
from ..ui_shared.extensions_panel import ExtensionsPanel
from ..core.extension_manager import get_extension_manager

# --- Phase 13 Injections ---
from ..workspace.multi_root import MultiRootWorkspace
from ..tasks.task_manager import TaskManager
from ..testing.panel import TestExplorerPanel
# --- Phase 14 Injections ---
from ..ui_shared.screencast_mode import ScreencastMode
from ..ui_shared.notification_service import NotificationService
from ..editor.hex_editor import HexEditorWidget
from ..editor.snippet_manager import get_snippet_manager
from ..workspace.workspace_trust import WorkspaceTrust, WorkspaceTrustDialog
from ..debug.launch_config import LaunchConfigManager
from ..git.clone_dialog import GitCloneDialog
from ..remote.ports_panel import PortForwardingPanel
from ..remote.live_server import LiveServerManager
# --- Phase 5 Injections ---
from ..sync.settings_sync import SettingsSyncManager
from ..remote.ssh_manager import RemoteSSHManager
from ..git.git_graph import GitGraphPanel
# ---------------------------


def build_default_commands() -> list:
    """Default command palette entries for the workbench."""
    return [
        {"id": "file.new", "label": "File: New File", "shortcut": "Ctrl+N"},
        {"id": "file.open", "label": "File: Open File...", "shortcut": "Ctrl+O"},
        {"id": "file.save", "label": "File: Save", "shortcut": "Ctrl+S"},
        {"id": "file.saveAs", "label": "File: Save As...", "shortcut": "Ctrl+Shift+S"},
        {"id": "file.saveAll", "label": "File: Save All", "shortcut": "Ctrl+K S"},
        {"id": "file.close", "label": "File: Close Editor", "shortcut": "Ctrl+W"},
        {"id": "workbench.action.showCommands", "label": "Show All Commands", "category": "Preferences"},
        {"id": "workbench.action.openSettings", "label": "Preferences: Open Settings (UI)", "shortcut": "Ctrl+,"},
        {"id": "workbench.action.openGlobalKeybindings", "label": "Preferences: Open Keyboard Shortcuts", "shortcut": "Ctrl+K Ctrl+S"},
        {"id": "workbench.action.selectTheme", "label": "Preferences: Color Theme", "shortcut": "Ctrl+K Ctrl+T"},
        {"id": "workbench.action.navigateBack", "label": "Go: Back", "shortcut": "Alt+Left"},
        {"id": "workbench.action.navigateForward", "label": "Go: Forward", "shortcut": "Alt+Right"},
        {"id": "editor.action.formatDocument", "label": "Format Document", "shortcut": "Shift+Alt+F"},
        {"id": "editor.action.revealDefinition", "label": "Go to Definition", "shortcut": "F12"},
        {"id": "editor.action.colorPicker", "label": "Show Color Picker", "category": "Editor"},
        {"id": "editor.action.commentLine", "label": "Toggle Line Comment", "shortcut": "Ctrl+/"},
        {"id": "editor.action.blockComment", "label": "Toggle Block Comment", "shortcut": "Shift+Alt+A"},
        {"id": "editor.action.triggerSuggest", "label": "Trigger Suggest", "shortcut": "Ctrl+Space"},
        {"id": "editor.action.formatSelection", "label": "Format Selection", "shortcut": "Ctrl+K Ctrl+F"},
        {"id": "editor.fold", "label": "Fold", "shortcut": "Ctrl+Shift+["},
        {"id": "editor.unfold", "label": "Unfold", "shortcut": "Ctrl+Shift+]"},
        {"id": "editor.foldAll", "label": "Fold All", "shortcut": "Ctrl+K Ctrl+0"},
        {"id": "editor.unfoldAll", "label": "Unfold All", "shortcut": "Ctrl+K Ctrl+J"},
        {"id": "editor.action.peekDefinition", "label": "Peek Definition", "shortcut": "Alt+F12"},
        {"id": "editor.action.goToReferences", "label": "Go to References", "shortcut": "Shift+F12"},
        {"id": "editor.action.rename", "label": "Rename Symbol", "shortcut": "F2"},
        {"id": "editor.action.changeAll", "label": "Change All Occurrences", "shortcut": "Ctrl+F2"},
        {"id": "editor.action.addSelectionToNextFindMatch", "label": "Add Selection to Next Find Match", "shortcut": "Ctrl+D"},
        {"id": "editor.action.copyLinesUpAction", "label": "Copy Line Up", "shortcut": "Shift+Alt+Up"},
        {"id": "editor.action.copyLinesDownAction", "label": "Copy Line Down", "shortcut": "Shift+Alt+Down"},
        {"id": "editor.action.moveLinesUpAction", "label": "Move Line Up", "shortcut": "Alt+Up"},
        {"id": "editor.action.moveLinesDownAction", "label": "Move Line Down", "shortcut": "Alt+Down"},
        {"id": "editor.action.deleteLines", "label": "Delete Line", "shortcut": "Ctrl+Shift+K"},
        {"id": "editor.action.insertLineBefore", "label": "Insert Line Above", "shortcut": "Ctrl+Shift+Enter"},
        {"id": "editor.action.insertLineAfter", "label": "Insert Line Below", "shortcut": "Ctrl+Enter"},
        {"id": "editor.action.quickFix", "label": "Quick Fix...", "shortcut": "Ctrl+."},
        {"id": "workbench.action.splitEditor", "label": "View: Split Editor", "shortcut": "Ctrl+\\"},
        {"id": "view.toggleInlineDiff", "label": "View: Toggle Inline Diff", "category": "View"},
        {"id": "workbench.action.addRootFolder", "label": "Add Folder to Workspace...", "category": "Workspaces"},
        {"id": "workbench.action.saveWorkspaceAs", "label": "Save Workspace As...", "category": "Workspaces"},
        {"id": "workbench.action.duplicateWorkspaceInNewWindow", "label": "Duplicate As Workspace in New Window", "category": "Workspaces"},
        {"id": "workbench.action.toggleFullScreen", "label": "View: Toggle Full Screen", "shortcut": "F11"},
        {"id": "workbench.action.toggleCenteredLayout", "label": "View: Toggle Centered Layout", "category": "View"},
        {"id": "workbench.action.toggleSidebarVisibility", "label": "View: Toggle Primary Side Bar Visibility", "shortcut": "Ctrl+B"},
        {"id": "workbench.action.toggleSecondarySidebar", "label": "View: Toggle Secondary Side Bar", "category": "View"},
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
        {"id": "view.testing", "label": "View: Show Testing", "shortcut": ""},
        {"id": "view.models", "label": "View: Models", "shortcut": ""},
        {"id": "status.gitBranch", "label": "Git: Checkout Branch...", "shortcut": ""},
        {"id": "view.zoomIn", "label": "View: Zoom In", "shortcut": "Ctrl+="},
        {"id": "view.zoomOut", "label": "View: Zoom Out", "shortcut": "Ctrl+-"},
        {"id": "view.wordWrap", "label": "View: Toggle Word Wrap", "shortcut": "Alt+Z"},
        {"id": "view.splitEditorRight", "label": "View: Split Editor Right", "shortcut": "Ctrl+\\"},
        {"id": "view.splitEditorDown", "label": "View: Split Editor Down", "shortcut": "Ctrl+K Ctrl+\\"},
        {"id": "view.splitEditorUp", "label": "View: Split Editor Up", "shortcut": ""},
        {"id": "view.splitEditorLeft", "label": "View: Split Editor Left", "shortcut": ""},
        {"id": "view.zenMode", "label": "View: Toggle Zen Mode", "shortcut": "Ctrl+K, Z"},
        {"id": "view.customizeLayout", "label": "View: Customize Layout...", "shortcut": ""},
        {"id": "markdown.preview", "label": "Markdown: Open Preview", "shortcut": "Ctrl+Shift+V"},
        {"id": "terminal.new", "label": "Terminal: Create New Terminal", "shortcut": "Ctrl+Shift+`"},
        {"id": "terminal.split", "label": "Terminal: Split Terminal", "shortcut": "Ctrl+Shift+5"},
        {"id": "debug.start", "label": "Debug: Start Debugging", "shortcut": "F5"},
        {"id": "debug.run", "label": "Run: Run Without Debugging", "shortcut": "Ctrl+F5"},
        {"id": "debug.toggleBreakpoint", "label": "Debug: Toggle Breakpoint", "shortcut": "F9"},
        {"id": "git.clone", "label": "Git: Clone", "shortcut": ""},
        {"id": "git.init", "label": "Git: Initialize Repository", "shortcut": ""},
        {"id": "screencast.toggle", "label": "Developer: Toggle Screencast Mode", "shortcut": ""},
        {"id": "task.run", "label": "Tasks: Run Task", "shortcut": ""},
        {"id": "workspace.trust", "label": "Workspaces: Manage Workspace Trust", "shortcut": ""},
        {"id": "agent.newConversation", "label": "Dardcor AI: New Conversation", "shortcut": ""},
        {"id": "help.about", "label": "Help: About Dardcor Code", "shortcut": ""},
        {"id": "help.shortcuts", "label": "Help: Keyboard Shortcuts Reference", "shortcut": ""},
    ]


class ThemeLoadingOverlay(QWidget):
    def __init__(self, parent):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, False)
        self.setStyleSheet("background-color: rgba(0, 0, 0, 150);")
        
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignCenter)
        
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._animate_spinner)
        self.angle = 0
        self.hide()
        
    def _animate_spinner(self):
        self.angle = (self.angle + 15) % 360
        self.update()
        
    def showEvent(self, event):
        super().showEvent(event)
        if self.parentWidget():
            self.setGeometry(self.parentWidget().rect())
        self.angle = 0
        self.timer.start(30)
        
    def hideEvent(self, event):
        super().hideEvent(event)
        self.timer.stop()

    def paintEvent(self, event):
        from PySide6.QtWidgets import QStyleOption, QStyle
        from PySide6.QtGui import QPainter, QColor, QPen
        from PySide6.QtCore import QRectF, Qt
        
        opt = QStyleOption()
        opt.initFrom(self)
        painter = QPainter(self)
        self.style().drawPrimitive(QStyle.PE_Widget, opt, painter, self)
        
        painter.setRenderHint(QPainter.Antialiasing)
        
        rect_size = 40
        x = (self.width() - rect_size) / 2
        y = (self.height() - rect_size) / 2
        rect = QRectF(x, y, rect_size, rect_size)
        
        pen = QPen(QColor(255, 255, 255, 40))
        pen.setWidth(4)
        pen.setCapStyle(Qt.RoundCap)
        painter.setPen(pen)
        painter.drawArc(rect, 0, 360 * 16)
        
        pen.setColor(QColor(168, 85, 247)) # Purple accent
        painter.setPen(pen)
        painter.drawArc(rect, -self.angle * 16, 120 * 16)


class MainWindow(QMainWindow):
    """Main application window matching VS Code layout exactly."""

    _run_queued_chat_signal = Signal()
    pending_messages_changed = Signal(int)

    def __init__(self):
        super().__init__()
        self._config = get_config()
        self._quick_open = None
        self._quick_open_root = ""
        self._agent = Agent()
        self._chat_generation_active = False
        self._queued_chat_messages = []
        self._current_conversation_id = None
        self._font_size = self._config.font_size
        self._current_active_editor = None
        self._ext_manager = get_extension_manager()
        self._nav_back_stack: list[str] = []
        
        import concurrent.futures
        self._thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=5)
        self._nav_forward_stack: list[str] = []
        self._navigating = False
        
        # --- Phase 13 Instantiations ---
        self._task_manager = TaskManager(self._config.workspace_path or "")
        
        # --- Phase 14 Instantiations ---
        self._screencast = ScreencastMode(self)
        self._notifications = NotificationService(self)
        self._workspace_trust = WorkspaceTrust()
        self._launch_config = LaunchConfigManager(self._config.workspace_path or "")
        self._snippet_manager = get_snippet_manager()
        
        # --- Phase 5 Instantiations ---
        self._settings_sync = SettingsSyncManager(self)
        self._ssh_manager = RemoteSSHManager(self)
        self._live_server = LiveServerManager()
        self._live_server_preferred_port = 5500
        # -------------------------------
        
        self._setup_agent()
        self._run_queued_chat_signal.connect(self._run_next_queued_chat_message)
        self._setup_ui()
        self._zen_mode = ZenModeManager(self)
        self._centered_layout = CenteredLayoutManager(self)
        self._focus_manager = FocusManager(self)
        self._theme_overlay = ThemeLoadingOverlay(self)
        self._setup_breadcrumbs()
        self._setup_keybindings()
        self._setup_menu()
        self._setup_shortcuts()
        self._setup_command_palette()
        self._setup_extensions()
        
        # Apply theme again now that all panels (search, git, etc) are instantiated
        # so they get patched from their hardcoded styles and editors are updated
        self._set_theme(self._config.color_theme or "dardcor-purple")

        # Log session start telemetry
        try:
            from ..core.telemetry import get_telemetry_service
            telemetry = get_telemetry_service()
            telemetry.public_log("session.start", {
                "workspace": self._config.workspace_path or "",
                "theme": getattr(self._config, "ui_theme", "dark+"),
            })
        except Exception:
            pass

    # ── Window Events (Native Resizing & Maximize Icon) ──

    def changeEvent(self, event):
        if event.type() == QEvent.WindowStateChange:
            if self.isMaximized():
                self._title_bar.max_btn.setText("\ueabb") # chrome-restore
            else:
                self._title_bar.max_btn.setText("\ueab9") # chrome-maximize
        super().changeEvent(event)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "_notifications"):
            self._notifications.reposition()

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
                    # Use local coordinates for reliable hit testing (avoids high DPI issues with widgetAt)
                    tb_pos = self._title_bar.mapFrom(self, pos)
                    child = self._title_bar.childAt(tb_pos)
                    
                    from PySide6.QtWidgets import QPushButton, QMenuBar
                    # We check if the child itself or any of its parents up to title bar is a button
                    is_clickable = False
                    curr = child
                    while curr and curr != self._title_bar:
                        if isinstance(curr, QPushButton) or isinstance(curr, QMenuBar):
                            is_clickable = True
                            break
                        curr = curr.parentWidget()

                    if is_clickable:
                        # Let Qt handle mouse events for buttons/menus
                        return False, 0
                        
                    return True, 2 # HTCAPTION
        
        return super().nativeEvent(eventType, message)

    # ── Agent ──────────────────────────────────────────────

    def _setup_agent(self):
        self._agent.on_stream(self._on_agent_stream)
        self._agent.permission_callback = self._ask_command_permission
        self._agent.set_background_message_callback(self._on_background_task_complete)

    def _on_background_task_complete(self, system_message: str):
        """Called from a background thread when a bg task finishes.
        Injects the task output into the chat as a system message, then
        re-invokes the agent so it can continue its workflow."""
        from PySide6.QtCore import QTimer

        def _run_in_main():
            # Show the result in the chat panel as a system message
            self._chat_panel.append_system_message(system_message)
            # Only auto-continue if no other generation is active
            if not self._chat_generation_active:
                # Inject the message into conversation history so agent sees it
                self._agent._conversation.add_message("user", f"[Background Task Result]\n{system_message}\n\nContinue with the next step of the task based on this output. Do not stop.")
                # Wake the agent — pass empty string so _start_chat_message re-uses conversation
                self._chat_panel.show_native_notification("Task selesai, melanjutkan...")
                # Directly invoke the API without adding another user message
                import threading
                def _continue():
                    import uuid
                    exec_id = str(uuid.uuid4())
                    self._current_chat_exec_id = exec_id
                    self._chat_generation_active = True
                    self._chat_panel.set_enabled(False)
                    self._chat_panel.show_typing(True)
                    try:
                        selected_model = None
                        if self._chat_panel.model_dropdown.isVisible():
                            selected_model = self._chat_panel.selected_model_id()
                        def _on_notification(msg: str):
                            self._chat_panel.show_native_notification(msg)
                        response = self._agent._call_api(
                            on_tool_call=self._chat_panel.append_tool_call,
                            on_system_message=self._chat_panel.append_system_message,
                            on_tool_output=self._chat_panel.append_tool_output,
                            on_notification=_on_notification,
                            model_override=selected_model,
                        )
                        if getattr(self, "_current_chat_exec_id", None) != exec_id:
                            return
                        if response and response != "Agent dihentikan oleh pengguna.":
                            self._chat_panel.append_agent_message(response)
                    except Exception as e:
                        self._chat_panel.append_system_message(f"Error (bg continue): {e}")
                    finally:
                        if getattr(self, "_current_chat_exec_id", None) == exec_id:
                            self._chat_generation_active = False
                            self._chat_panel.show_typing(False)
                            self._chat_panel.set_enabled(True)
                threading.Thread(target=_continue, daemon=True).start()

        QTimer.singleShot(0, _run_in_main)

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
        self._file_explorer.find_in_folder_requested.connect(self._find_in_folder)
        self._file_explorer.open_in_terminal_requested.connect(self._open_in_terminal)
        self._file_explorer.open_to_side_requested.connect(self._open_to_side)
        self._file_explorer.open_with_live_server_requested.connect(self._open_with_live_server)

        self._outline_panel = OutlinePanel()
        self._outline_panel.item_selected.connect(self._on_outline_item_selected)

        self._timeline_panel = TimelinePanel()

        self._open_editors_panel = OpenEditorsPanel()
        self._open_editors_panel.file_selected.connect(self._open_file_in_editor)
        
        # We will pass the toggle function to FileExplorer if needed, or handle it here
        # But we must hide it by default if user wants to toggle it.
        # Actually, let's keep it visible and let the ... menu toggle it.

        # Add top subpanels inside FileExplorer (below the global EXPLORER label)
        self._file_explorer.add_subpanel(self._open_editors_panel)
        self._file_explorer.setup_explorer_menu(self._open_editors_panel, self._outline_panel, self._timeline_panel)

        self._explorer_layout = explorer_layout
        self._explorer_layout.addWidget(self._file_explorer, 0)
        self._explorer_layout.addWidget(self._outline_panel, 0)
        self._explorer_layout.addWidget(self._timeline_panel, 0)

        # Bottom spacer absorbs leftover space when all collapsible sections are closed
        # so headers stick together with no empty gaps between them.
        self._bottom_spacer = QWidget()
        self._bottom_spacer.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self._bottom_spacer.setStyleSheet("background: transparent;")
        self._explorer_layout.addWidget(self._bottom_spacer, 0)
        self._explorer_layout.setStretchFactor(self._bottom_spacer, 1)

        def _update_explorer_stretches():
            exp_open = bool(
                self._file_explorer.get_root()
                and not getattr(self._file_explorer, '_workspace_collapsed', False)
            )
            out_open = not getattr(self._outline_panel, '_collapsed', True)
            tim_open = not getattr(self._timeline_panel, '_collapsed', True)

            any_open = exp_open or out_open or tim_open

            # Stretch only the open section(s). Spacer stays at 0 stretch when something
            # is open, and takes 1 stretch when everything is collapsed to push the headers
            # to the bottom of the panel.
            self._explorer_layout.setStretchFactor(self._file_explorer, 1 if exp_open else 0)
            self._explorer_layout.setStretchFactor(self._outline_panel, 1 if out_open else 0)
            self._explorer_layout.setStretchFactor(self._timeline_panel, 1 if tim_open else 0)
            self._explorer_layout.setStretchFactor(self._bottom_spacer, 0 if any_open else 1)
            

        self._file_explorer.workspace_toggled.connect(lambda _: _update_explorer_stretches())
        self._file_explorer.root_changed.connect(lambda _: _update_explorer_stretches())
        self._outline_panel.toggled.connect(lambda _: _update_explorer_stretches())
        self._timeline_panel.toggled.connect(lambda _: _update_explorer_stretches())
        _update_explorer_stretches()

        self._sidebar_stack.addWidget(explorer_wrapper)

        self._search_panel = SearchPanel(root_path="")
        self._search_panel.file_selected.connect(
            lambda f, l: self._open_file_at_line(f, l)
        )
        self._sidebar_stack.addWidget(self._search_panel)

        # Source Control
        git_wrapper = QWidget()
        git_wrapper.setStyleSheet("background-color: #000000;")
        git_layout = QVBoxLayout(git_wrapper)
        git_layout.setContentsMargins(0, 0, 0, 0)
        git_layout.setSpacing(0)
        
        self._git_panel = GitPanel(root_path="")
        self._git_panel.set_app(self)
        
        def _update_git_badge(count):
            if count > 0:
                self._activity_bar.set_badge(VIEW_SOURCE_CONTROL, str(count))
            else:
                self._activity_bar.set_badge(VIEW_SOURCE_CONTROL, "")
        self._git_panel.bridge.counts_changed.connect(_update_git_badge)
        
        git_layout.addWidget(self._git_panel)
        
        self._sidebar_stack.addWidget(git_wrapper)

        # Run and Debug Panel
        self._debug_panel = DebugPanel(self)
        self._debug_panel.debug_requested.connect(self._start_debugging)
        self._debug_panel.run_requested.connect(self._run_current_file)
        self._debug_panel.set_config_names(self._launch_config.get_config_names())
        self._sidebar_stack.addWidget(self._debug_panel)

        self._extensions_panel = ExtensionsPanel()
        self._extensions_panel.extension_installed.connect(self._on_extension_installed)
        self._extensions_panel.extensions_changed.connect(self._update_extensions_badge)
        self._extensions_panel.extensions_changed.connect(self._sync_extension_status_bar)
        self._sidebar_stack.addWidget(self._extensions_panel)
        self._update_extensions_badge()
        
        self._testing_panel = TestExplorerPanel(root_path="")
        self._testing_panel.file_open_requested.connect(self._open_file_in_editor)
        self._sidebar_stack.addWidget(self._testing_panel)

        self._sidebar_stack.setCurrentIndex(0)

        # ── Editor Tabs ──
        self._editor_tabs = EditorTabs()

        # ── Breadcrumbs Navigation Bar ──
        self._breadcrumbs_bar = None

        # Container: editor tabs stacked vertically
        self._editor_container = QWidget()
        self._editor_container.setStyleSheet("background: transparent; border: none;")
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
        self._chat_panel.link_clicked.connect(self._on_chat_link_clicked)
        self._chat_panel.set_close_callback(self._toggle_chat)
        self._chat_panel.set_workspace_name("")

        # ── Bottom Panels ──
        self._problems_panel = ProblemsPanel()
        self._problems_panel.problem_selected.connect(self._open_file_at_line)
        self._diag_pending = {}
        self._diag_debounce_timer = QTimer(self)
        self._diag_debounce_timer.setSingleShot(True)
        self._diag_debounce_timer.setInterval(100)
        self._diag_debounce_timer.timeout.connect(self._flush_lsp_diagnostics)
        self._output_panel = OutputPanel()
        self._debug_console = OutputPanel()
        self._debug_console.add_channel("Debug Console")
        self._terminal_panel = TerminalPanel(root_path=os.path.expanduser("~"))
        
        self._ports_panel = PortForwardingPanel(self)

        self._bottom_panel = BottomPanel()
        self._bottom_panel.set_panels(
            self._problems_panel,
            self._output_panel,
            self._debug_console,
            self._terminal_panel,
            self._ports_panel
        )
        self._bottom_panel.hide()
        
        # Connect Task Manager to Output Panel
        self._task_manager.task_started.connect(
            lambda name: self._output_panel.append(f"> Executing task: {name} <\n", "Tasks")
        )
        self._task_manager.task_output.connect(
            lambda name, out: self._output_panel.append(out, "Tasks")
        )
        self._task_manager.task_finished.connect(
            lambda name, code: self._output_panel.append(f"Terminal will be reused by tasks, press any key to close it.\n", "Tasks")
        )

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
        
        # ── Secondary Sidebar ──
        self._secondary_sidebar_stack = QStackedWidget()
        self._secondary_sidebar_stack.setMinimumWidth(200)
        self._secondary_sidebar_stack.hide()
        
        self._center_chat_split.addWidget(self._secondary_sidebar_stack)
        self._center_chat_split.addWidget(self._chat_panel)
        self._center_chat_split.setStretchFactor(0, 1)
        self._center_chat_split.setStretchFactor(1, 0)
        self._center_chat_split.setCollapsible(0, False)
        self._center_chat_split.setCollapsible(1, True)
        self._center_chat_split.setHandleWidth(1)
        self._center_chat_split.setStyleSheet("""
            QSplitter::handle {
                background-color: #3c0068;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)

        # Panel Position tracking
        self._panel_position = "bottom"

        # Main horizontal splitter
        self._main_split = QSplitter(Qt.Horizontal)
        self._main_split.addWidget(self._sidebar_stack)
        self._main_split.addWidget(self._center_chat_split)
        self._main_split.setStretchFactor(0, 0)
        self._main_split.setStretchFactor(1, 1)
        self._main_split.setCollapsible(0, True)
        self._main_split.setCollapsible(1, False)
        self._main_split.setSizes([250, 800])
        self._main_split.setHandleWidth(1)
        self._main_split.setStyleSheet("""
            QSplitter::handle {
                background-color: #3c0068;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)
        main_layout.addWidget(self._main_split, 1)

        # ── Status Bar ──
        self._status_bar = StatusBar()
        self.setStatusBar(self._status_bar)
        self._status_bar.go_to_line_requested.connect(self._show_go_to_line)
        self._status_bar.models_requested.connect(self._show_models_dialog)
        self._status_bar.git_branch_requested.connect(self._show_git_branch_menu)
        self._status_bar.command_palette_requested.connect(self._show_command_palette)
        self._status_bar.problems_requested.connect(self._open_problems_panel)
        self._status_bar.ext_status_clicked.connect(self._execute_command)
        self._status_bar._ai_btn.clicked.connect(self._show_settings)
        self._notifications.count_changed.connect(self._status_bar.set_notifications)
        self._status_bar.set_notifications(0)
        
        # ── Add QSizeGrip for Linux resizing ──
        import platform
        if platform.system() != "Windows":
            from PySide6.QtWidgets import QSizeGrip
            self.size_grip = QSizeGrip(self)
            self._status_bar.layout().addWidget(self.size_grip)

        # ── Connections ──
        self._editor_tabs.tab_changed.connect(self._on_tab_changed)
        self._editor_tabs.dirty_changed.connect(self._on_editor_dirty_changed)
        
        # Setup Auto Save Timer
        self._auto_save_timer = QTimer(self)
        self._auto_save_timer.setInterval(1000)
        self._auto_save_timer.timeout.connect(self._save_all_dirty_if_auto_save)
        self._auto_save_timer.setSingleShot(True)

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

        # ── Customize Layout popup (lazy, created once) ──
        self._primary_sidebar_position = 'left'
        self._panel_position = 'panel_bottom'
        self._title_bar.btn_customize.clicked.connect(self._show_customize_layout)

        if self._config.workspace_path and os.path.exists(self._config.workspace_path):
            self._file_explorer.set_root(self._config.workspace_path)
            self._on_root_changed(self._config.workspace_path)
        elif self._config.workspace_path:
            self._config.workspace_path = ""
            self._config.save()





    def set_panel_position(self, position: str):
        """Move the bottom panel to 'bottom', 'left', or 'right' of the editor."""
        if position == self._panel_position:
            return
            
        self._bottom_panel.setParent(None)
        
        if position == "bottom":
            self._editor_term_split.setOrientation(Qt.Vertical)
            self._editor_term_split.insertWidget(1, self._bottom_panel)
            self._editor_term_split.setSizes([600, 250])
        elif position == "right":
            self._editor_term_split.setOrientation(Qt.Horizontal)
            self._editor_term_split.insertWidget(1, self._bottom_panel)
            self._editor_term_split.setSizes([600, 350])
        elif position == "left":
            self._editor_term_split.setOrientation(Qt.Horizontal)
            self._editor_term_split.insertWidget(0, self._bottom_panel)
            self._editor_term_split.setSizes([350, 600])
            
        self._panel_position = position
        if not self._bottom_panel.isVisible():
            self._bottom_panel.show()


    def changeEvent(self, event):
        if event.type() == QEvent.WindowStateChange:
            if self.isMaximized():
                self.setStyleSheet("#MainWindow { border: none; }")
            else:
                self.setStyleSheet("#MainWindow { border: 1px solid #3c0068; }")
        super().changeEvent(event)

    # ── Menu Bar ──────────────────────────────────────────

    def _setup_menu(self):
        menubar = self._title_bar.menu_bar

        # ── File menu ──
        file_menu = menubar.addMenu("File")

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
        auto_save.setChecked(bool(self._config.auto_save))
        auto_save.toggled.connect(self._on_auto_save_toggle)
        file_menu.addAction(auto_save)

        preferences_menu = file_menu.addMenu("Preferences")
        
        settings_action = QAction("Settings", self)
        settings_action.setShortcut(QKeySequence("Ctrl+,"))
        settings_action.triggered.connect(self._show_settings)
        preferences_menu.addAction(settings_action)
        
        extensions_action = QAction("Extensions", self)
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
        color_theme.triggered.connect(self._show_theme_switcher)
        preferences_menu.addAction(color_theme)
        
        file_icon_theme = QAction("File Icon Theme", self)
        file_icon_theme.triggered.connect(self._show_icon_theme_switcher)
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
        edit_menu = menubar.addMenu("Edit")
        
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
        sel_menu = menubar.addMenu("Selection")

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
        view_menu = menubar.addMenu("View")

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
        
        panel_position_menu = appearance_menu.addMenu("Panel Position")
        
        panel_bottom = QAction("Bottom", self)
        panel_bottom.triggered.connect(lambda: self.set_panel_position("bottom"))
        panel_position_menu.addAction(panel_bottom)
        
        panel_right = QAction("Right", self)
        panel_right.triggered.connect(lambda: self.set_panel_position("right"))
        panel_position_menu.addAction(panel_right)
        
        panel_left = QAction("Left", self)
        panel_left.triggered.connect(lambda: self.set_panel_position("left"))
        panel_position_menu.addAction(panel_left)

        appearance_menu.addSeparator()
        
        zen_mode = QAction("Zen Mode", self)
        zen_mode.setShortcut(QKeySequence("Ctrl+K, Z"))
        zen_mode.triggered.connect(self._zen_mode.toggle_zen_mode)
        appearance_menu.addAction(zen_mode)
        
        centered_layout = QAction("Centered Layout", self)
        centered_layout.triggered.connect(self._centered_layout.toggle)
        appearance_menu.addAction(centered_layout)
        
        appearance_menu.addSeparator()
        
        self.toggle_menu_bar_act = QAction("Menu Bar", self)
        self.toggle_menu_bar_act.setCheckable(True)
        self.toggle_menu_bar_act.setChecked(True)
        self.toggle_menu_bar_act.triggered.connect(self._toggle_menu_bar_force)
        appearance_menu.addAction(self.toggle_menu_bar_act)
        
        self.primary_sidebar_act = QAction("Primary Side Bar", self)
        self.primary_sidebar_act.setCheckable(True)
        self.primary_sidebar_act.setChecked(True)
        self.primary_sidebar_act.setShortcut(QKeySequence("Ctrl+B"))
        self.primary_sidebar_act.triggered.connect(self._toggle_primary_sidebar_force)
        appearance_menu.addAction(self.primary_sidebar_act)
        
        self.secondary_sidebar_act = QAction("Secondary Side Bar", self)
        self.secondary_sidebar_act.setCheckable(True)
        self.secondary_sidebar_act.setChecked(False)
        self.secondary_sidebar_act.triggered.connect(self._toggle_secondary_sidebar_force)
        appearance_menu.addAction(self.secondary_sidebar_act)
        
        self.status_bar_act = QAction("Status Bar", self)
        self.status_bar_act.setCheckable(True)
        self.status_bar_act.setChecked(True)
        self.status_bar_act.triggered.connect(self._toggle_status_bar_force)
        appearance_menu.addAction(self.status_bar_act)
        
        self.activity_bar_act = QAction("Activity Bar", self)
        self.activity_bar_act.setCheckable(True)
        self.activity_bar_act.setChecked(True)
        self.activity_bar_act.triggered.connect(self._toggle_activity_bar_force)
        appearance_menu.addAction(self.activity_bar_act)
        
        self.panel_act = QAction("Panel", self)
        self.panel_act.setCheckable(True)
        self.panel_act.setChecked(False)
        self.panel_act.setShortcut(QKeySequence("Ctrl+J"))
        self.panel_act.triggered.connect(self._toggle_panel_force)
        appearance_menu.addAction(self.panel_act)

        layout_menu = view_menu.addMenu("Editor Layout")
        split_up = QAction("Split Up", self)
        split_up.triggered.connect(lambda: self._editor_tabs.split_editor("up"))
        layout_menu.addAction(split_up)
        
        split_down = QAction("Split Down", self)
        split_down.setShortcut(QKeySequence("Ctrl+K, Ctrl+\\"))
        split_down.triggered.connect(lambda: self._editor_tabs.split_editor("down"))
        layout_menu.addAction(split_down)
        
        split_left = QAction("Split Left", self)
        split_left.triggered.connect(lambda: self._editor_tabs.split_editor("left"))
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
        terminal_panel.setShortcuts([QKeySequence("Ctrl+`"), QKeySequence("Ctrl+~")])
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
        go_menu = menubar.addMenu("Go")

        back_action = QAction("Back", self)
        back_action.setShortcut(QKeySequence("Alt+Left"))
        back_action.triggered.connect(self._navigate_back)
        go_menu.addAction(back_action)

        forward_action = QAction("Forward", self)
        forward_action.setShortcut(QKeySequence("Alt+Right"))
        forward_action.triggered.connect(self._navigate_forward)
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
        run_menu = menubar.addMenu("Run")

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
        stop_debug.triggered.connect(self._stop_debugging)
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
        step_over.triggered.connect(self._debug_step_over)
        run_menu.addAction(step_over)
        
        step_into = QAction("Step Into", self)
        step_into.setShortcut(QKeySequence("F11"))
        step_into.triggered.connect(self._debug_step_in)
        run_menu.addAction(step_into)
        
        step_out = QAction("Step Out", self)
        step_out.setShortcut(QKeySequence("Shift+F11"))
        step_out.triggered.connect(self._debug_step_out)
        run_menu.addAction(step_out)
        
        continue_debug = QAction("Continue", self)
        continue_debug.setShortcut(QKeySequence("F5"))
        continue_debug.triggered.connect(self._debug_continue)
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
        terminal_menu = menubar.addMenu("Terminal")

        new_terminal = QAction("New Terminal", self)
        new_terminal.setShortcuts([QKeySequence("Ctrl+Shift+`"), QKeySequence("Ctrl+Shift+~")])
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
        help_menu = menubar.addMenu("Help")

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
        # Focus Management
        f6_shortcut = QShortcut(QKeySequence("F6"), self)
        f6_shortcut.activated.connect(self._focus_manager.cycle_focus)
        
        # Additional shortcuts not covered by menu
        pass

    # ── Command Palette ───────────────────────────────────

    def _setup_command_palette(self):
        self._command_palette = CommandPalette(self)
        self._command_palette.command_selected.connect(self._execute_command)

        root_path = (
            getattr(self, "_quick_open_root", None)
            or self._config.workspace_path
            or os.path.expanduser("~")
        )
        self._quick_open = QuickOpenDialog(root_path, self)
        self._quick_open.file_selected.connect(self._open_file_in_editor)

        self._commands = build_default_commands()

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
            "editor.action.revealDefinition": lambda: self._editor_tabs.go_to_definition() if self._editor_tabs.current_editor() else None,
            "editor.action.colorPicker": self._show_color_picker,
            "workbench.action.showCommands": self._show_command_palette,
            "workbench.action.openSettings": self._show_settings,
            "workbench.action.openGlobalKeybindings": self._show_keyboard_shortcuts,
            "workbench.action.addRootFolder": lambda: self._show_command_palette(),
            "workbench.action.saveWorkspaceAs": lambda: self._show_command_palette(),
            "workbench.action.duplicateWorkspaceInNewWindow": lambda: self._show_command_palette(),
            "workbench.action.toggleFullScreen": lambda: self.showNormal() if self.isFullScreen() else self.showFullScreen(),
            "workbench.action.toggleCenteredLayout": lambda: self._show_command_palette(),
            "workbench.action.toggleSidebarVisibility": self._toggle_sidebar,
            "workbench.action.toggleSecondarySidebar": self._toggle_chat,
            "workbench.action.navigateBack": self._navigate_back,
            "workbench.action.navigateForward": self._navigate_forward,
            "view.toggleSidebar": self._toggle_sidebar,
            "view.toggleChat": self._toggle_chat,
            "view.toggleTerminal": self._toggle_terminal,
            "view.quickOpen": self._show_quick_open,
            "view.goToLine": self._show_go_to_line,
            "view.commandPalette": self._show_command_palette,
            "view.explorer": lambda: self._switch_sidebar(VIEW_EXPLORER),
            "view.search": lambda: self._switch_sidebar(VIEW_SEARCH),
            "view.sourceControl": lambda: self._switch_sidebar(VIEW_SOURCE_CONTROL),
            "view.testing": lambda: self._switch_sidebar(VIEW_TESTING),
            "view.models": self._show_models_dialog,
            "status.gitBranch": self._show_git_branch_menu,
            "view.zoomIn": self._zoom_in,
            "view.zoomOut": self._zoom_out,
            "view.wordWrap": self._toggle_word_wrap,
            "view.toggleInlineDiff": self._toggle_inline_diff,
            "workbench.action.splitEditor": lambda: self._editor_tabs.split_editor("right"),
            "editor.action.formatDocument": lambda: self._editor_tabs.trigger_format() if self._editor_tabs.current_editor() else None,
            "editor.action.formatSelection": lambda: self._run_editor_action("editor.action.formatSelection"),
            "editor.action.blockComment": lambda: self._run_editor_action("editor.action.blockCommentAction"),
            "editor.action.commentLine": lambda: self._run_editor_action("editor.action.commentLine"),
            "editor.action.triggerSuggest": lambda: self._run_editor_action("editor.action.triggerSuggest"),
            "editor.fold": lambda: self._run_editor_action("editor.fold"),
            "editor.unfold": lambda: self._run_editor_action("editor.unfold"),
            "editor.foldAll": lambda: self._run_editor_action("editor.foldAll"),
            "editor.unfoldAll": lambda: self._run_editor_action("editor.unfoldAll"),
            "editor.action.peekDefinition": lambda: self._run_editor_action("editor.action.peekDefinition"),
            "editor.action.goToReferences": lambda: self._run_editor_action("editor.action.goToReferences"),
            "editor.action.rename": lambda: self._run_editor_action("editor.action.rename"),
            "editor.action.changeAll": lambda: self._run_editor_action("editor.action.changeAll"),
            "editor.action.addSelectionToNextFindMatch": lambda: self._run_editor_action("editor.action.addSelectionToNextFindMatch"),
            "editor.action.copyLinesUpAction": lambda: self._run_editor_action("editor.action.copyLinesUpAction"),
            "editor.action.copyLinesDownAction": lambda: self._run_editor_action("editor.action.copyLinesDownAction"),
            "editor.action.moveLinesUpAction": lambda: self._run_editor_action("editor.action.moveLinesUpAction"),
            "editor.action.moveLinesDownAction": lambda: self._run_editor_action("editor.action.moveLinesDownAction"),
            "editor.action.deleteLines": lambda: self._run_editor_action("editor.action.deleteLines"),
            "editor.action.insertLineBefore": lambda: self._run_editor_action("editor.action.insertLineBefore"),
            "editor.action.insertLineAfter": lambda: self._run_editor_action("editor.action.insertLineAfter"),
            "editor.action.quickFix": lambda: self._run_editor_action("editor.action.quickFix"),
            "workbench.action.zoomIn": self._zoom_in,
            "view.splitEditorRight": lambda: self._editor_tabs.split_editor("right"),
            "view.splitEditorDown": lambda: self._editor_tabs.split_editor("down"),
            "view.splitEditorUp": lambda: self._editor_tabs.split_editor("up"),
            "view.splitEditorLeft": lambda: self._editor_tabs.split_editor("left"),
            "view.zenMode": lambda: self._zen_mode.toggle_zen_mode(),
            "view.customizeLayout": self._show_customize_layout,
            "markdown.preview": self._open_markdown_preview,
            "terminal.new": self._new_terminal,
            "terminal.split": self._split_terminal,
            "file.close": self._close_current_editor,
            "file.saveAll": self._save_all,
            "workbench.action.selectTheme": self._show_theme_switcher,
            "editor.action.formatDocument": lambda: self._editor_tabs.trigger_format() if self._editor_tabs.current_editor() else None,
            "editor.action.commentLine": lambda: self._run_editor_action("editor.action.commentLine"),
            "editor.action.blockComment": lambda: self._run_editor_action("editor.action.blockCommentAction"),
            "debug.start": self._start_debugging,
            "debug.run": self._run_current_file,
            "debug.toggleBreakpoint": lambda: self._editor_tabs.toggle_breakpoint(),
            "git.clone": lambda: GitCloneDialog(self._config.workspace_path or "", self).exec(),
            "git.init": lambda: self._show_command_palette(),
            "screencast.toggle": lambda: self._screencast.toggle(),
            "task.run": self._show_run_task,
            "workspace.trust": lambda: WorkspaceTrustDialog(self._workspace_trust, self._config.workspace_path or "", self).exec(),
            "agent.newConversation": self._new_conversation,
            "help.about": self._show_about,
            "help.shortcuts": self._show_keyboard_shortcuts,
        }
        handler = handlers.get(cmd_id)
        if handler:
            handler()
        elif not self._ext_manager.execute_command(cmd_id):
            # Route to the Node extension host (VS Code JS extension commands)
            from ..core.extension_host import get_extension_host
            host = get_extension_host()
            if host._ready:
                host.execute_command(cmd_id)

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
        self._ext_manager.set_event_handler("notification", self._on_extension_notification)

        from ..core.extension_host import get_extension_host
        host = get_extension_host()
        self._node_commands = set()
        host.register_callback("commands.registerCommand", self._on_node_command_registered)
        host.register_callback("commands.unregisterCommand", self._on_node_command_unregistered)
        host.register_callback("window.showInformationMessage", lambda msg: self._notifications.show_info(msg))
        host.register_callback("window.showWarningMessage", lambda msg: self._notifications.show_warning(msg))
        host.register_callback("window.showErrorMessage", lambda msg: self._notifications.show_error(msg))
        host.register_callback("window.statusBarShow", self._on_ext_status_bar_show)
        host.register_callback("window.statusBarHide", self._on_ext_status_bar_hide)
        host.register_callback("window.createTerminal", lambda p: self._new_terminal())
        host.register_callback("window.createOutputChannel", lambda p: None)
        host.register_callback("window.outputAppend", lambda p: None)
        host.register_callback("window.registerTreeDataProvider", self._on_tree_provider_registered)
        host.register_callback("window.treeDataChanged", self._on_tree_data_changed)

        self._ext_view_stack_index = {}
        self._ext_view_panels = {}

        self._ext_manager.activate_all_enabled()
        self._sync_extension_status_bar()
        self._apply_extension_menu_items()

        # Apply extension contributions: color themes, commands, saved selections
        from .theme_manager import ThemeManager
        ThemeManager.register_extension_themes()
        self._merge_manifest_commands()
        self._rebuild_extension_view_containers()

        saved_theme = self._config.color_theme
        if saved_theme and saved_theme.startswith("ext:") and saved_theme in ThemeManager.EXT_THEMES:
            self._set_theme(saved_theme)
        elif saved_theme and saved_theme in ThemeManager.THEMES and saved_theme != "dark+":
            self._set_theme(saved_theme)

    def _merge_manifest_commands(self):
        """Add commands declared in extension package.json to the command palette."""
        from ..core.extension_contributions import get_contribution_parser
        try:
            for cmd in get_contribution_parser().get_all_commands():
                if not any(c["id"] == cmd.command for c in self._commands):
                    label = f"{cmd.category}: {cmd.title}" if cmd.category else cmd.title
                    self._commands.append({"id": cmd.command, "label": label, "shortcut": ""})
        except Exception:
            pass

    def _on_node_command_registered(self, cmd_id: str):
        """A JS extension registered a command at runtime in the Node host."""
        self._node_commands.add(cmd_id)
        if not any(c["id"] == cmd_id for c in self._commands):
            self._commands.append({"id": cmd_id, "label": cmd_id, "shortcut": ""})

    def _on_node_command_unregistered(self, cmd_id: str):
        self._node_commands.discard(cmd_id)

    def _on_tree_provider_registered(self, view_id: str):
        """A JS extension registered a TreeDataProvider; refresh its panel."""
        for panel in getattr(self, "_ext_view_panels", {}).values():
            if view_id in getattr(panel, "_sections", {}):
                panel.refresh()

    def _on_tree_data_changed(self, view_id: str):
        """The extension fired onDidChangeTreeData; reload the affected view."""
        for panel in getattr(self, "_ext_view_panels", {}).values():
            if view_id in getattr(panel, "_sections", {}):
                panel.refresh()

    def _rebuild_extension_view_containers(self):
        """Create activity-bar icons + sidebar panels for extension view containers."""
        if not hasattr(self, "_ext_view_stack_index"):
            self._ext_view_stack_index = {}
            self._ext_view_panels = {}

        # Remove previous extension buttons + panels
        self._activity_bar.clear_extension_buttons()
        for view_id, panel in list(self._ext_view_panels.items()):
            self._sidebar_stack.removeWidget(panel)
            panel.setParent(None)
            panel.deleteLater()
        self._ext_view_panels.clear()
        self._ext_view_stack_index.clear()

        try:
            from ..core.extension_contributions import get_contribution_parser
            from ..ui_shared.extension_view_panel import ExtensionViewPanel
            containers = get_contribution_parser().get_activitybar_containers()
        except Exception:
            containers = []

        next_view_id = EXT_VIEW_BASE
        for info in containers:
            container = info["container"]
            panel = ExtensionViewPanel(info, execute_command_cb=self._run_extension_command)
            stack_index = self._sidebar_stack.addWidget(panel)

            self._ext_view_stack_index[next_view_id] = stack_index
            self._ext_view_panels[next_view_id] = panel
            self._activity_bar.add_extension_button(
                next_view_id,
                tooltip=getattr(container, "title", "") or info.get("ext_name", "Extension"),
                icon_path=getattr(container, "icon", ""),
            )
            next_view_id += 1

    def _run_extension_command(self, command_id: str, args=None):
        """Execute an extension command triggered from a tree view item."""
        try:
            if self._ext_manager.execute_command(command_id):
                return
        except Exception:
            pass
        try:
            from ..core.extension_host import get_extension_host
            host = get_extension_host()
            if host._ready:
                host.execute_command(command_id, args or [])
        except Exception:
            pass

    def _on_extension_notification(self, data: dict):
        """Route Python extension notifications to the toast service."""
        message = data.get("message", "")
        severity = data.get("type", "info")
        actions = data.get("actions")
        if severity == "warning":
            self._notifications.show_warning(message, actions=actions)
        elif severity == "error":
            self._notifications.show_error(message, actions=actions)
        else:
            self._notifications.show_info(message, actions=actions)

    def _on_ext_status_bar_show(self, params: dict):
        item_id = params.get("id", "default")
        self._status_bar.set_ext_status_item(
            item_id,
            params.get("text", ""),
            params.get("tooltip", ""),
            params.get("command", ""),
        )

    def _on_ext_status_bar_hide(self, params: dict):
        item_id = params.get("id", "default")
        self._status_bar.remove_ext_status_item(item_id)

    def _sync_extension_status_bar(self):
        """Render all Python-registered status bar items from active extensions."""
        for sid, entry in self._ext_manager.get_status_bar_items().items():
            self._status_bar.set_ext_status_item(
                sid, entry.text, entry.tooltip, entry.command_id,
            )

    def _apply_extension_menu_items(self):
        pass  # In VS Code, extensions don't add a top-level "Extensions" menu. They add to command palette or specific menus.

    def _on_extension_installed(self, ext_name: str):
        self._ext_manager.activate_extension(ext_name)
        self._sync_extension_status_bar()
        self._apply_extension_menu_items()
        for cmd_id, cmd in self._ext_manager.get_all_commands().items():
            found = any(c["id"] == cmd_id for c in self._commands)
            if not found:
                self._commands.append({"id": cmd_id, "label": cmd.label, "shortcut": cmd.shortcut})
        self._update_extensions_badge()

    def _update_extensions_badge(self):
        """Show the number of installed extensions on the activity bar icon."""
        try:
            count = len(self._ext_manager.get_installed_extensions())
            self._activity_bar.set_badge(VIEW_EXTENSIONS, str(count) if count > 0 else "")
        except Exception:
            pass
        self._refresh_extension_contributions()

    def _refresh_extension_contributions(self):
        """Re-apply icon themes, color themes, and commands after extensions change."""
        try:
            from ..core.icon_theme_manager import get_icon_theme_manager
            get_icon_theme_manager().reload()
            self._refresh_file_icons()
        except Exception:
            pass
        try:
            from .theme_manager import ThemeManager
            ThemeManager.register_extension_themes()
        except Exception:
            pass
        try:
            from ..core.extension_contributions import get_contribution_parser
            get_contribution_parser().clear_cache()
            self._merge_manifest_commands()
        except Exception:
            pass
        try:
            if hasattr(self, "_editor_tabs"):
                self._editor_tabs.refresh_extension_context_menus()
        except Exception:
            pass
        try:
            self._rebuild_extension_view_containers()
        except Exception:
            pass

    def _uri_to_path(self, uri: str) -> str:
        if not uri:
            return ""
        if uri.startswith("file:///"):
            path = uri[8:] if os.name == "nt" else uri[7:]
            return path.replace("/", os.sep)
        return uri

    def _markers_to_problems(self, markers: list) -> list:
        problems = []
        for marker in markers:
            severity = marker.get("severity", "warning")
            if severity == "information":
                severity = "info"
            if severity not in ("error", "warning", "info"):
                severity = "warning"
            problems.append({
                "severity": severity,
                "line": marker.get("startLine", 1),
                "col": marker.get("startColumn", 1),
                "message": marker.get("message", ""),
                "source": marker.get("source", ""),
            })
        return problems

    def _refresh_problems_summary(self):
        errors = self._problems_panel.get_error_count()
        warnings = self._problems_panel.get_warning_count()
        self._status_bar.set_errors_warnings(errors, warnings)
        self._bottom_panel.update_problems_badge(errors, warnings)

    def _on_editor_diagnostics(self, markers: list):
        editor = self._editor_tabs.current_editor()
        if not editor:
            return
        file_path = editor.get_file_path() or ""
        if not file_path:
            return
        self._problems_panel.set_problems(file_path, self._markers_to_problems(markers))
        self._refresh_problems_summary()

    def _on_lsp_diagnostics(self, uri: str, diagnostics: list):
        self._diag_pending[uri] = diagnostics
        self._diag_debounce_timer.start()

    def _flush_lsp_diagnostics(self):
        pending = dict(self._diag_pending)
        self._diag_pending.clear()
        for uri, diagnostics in pending.items():
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
                    "startColumn": start.get("character", 0) + 1,
                    "endLine": end.get("line", 0) + 1,
                    "endColumn": end.get("character", 0) + 1,
                    "message": d.get("message", ""),
                    "source": d.get("source", "lsp"),
                })
            editor = self._editor_tabs.current_editor()
            if editor and uri.replace("\\", "/").endswith((editor.get_file_path() or "").replace("\\", "/").split("/")[-1]):
                editor.set_diagnostics(markers)
            file_path = self._uri_to_path(uri) or (editor.get_file_path() if editor else "")
            if file_path:
                self._problems_panel.set_problems(file_path, self._markers_to_problems(markers))
        if pending:
            self._refresh_problems_summary()

    # ── File operations ───────────────────────────────────

    def _show_models_dialog(self):
        try:
            if hasattr(self, '_models_dialog') and self._models_dialog is not None:
                try:
                    if self._models_dialog.isVisible():
                        self._models_dialog.activateWindow()
                        self._models_dialog.raise_()
                        return
                except RuntimeError:
                    pass
            from dardcor_agent.models.main_dialog import ModelsQuotaDialog
            self._models_dialog = ModelsQuotaDialog(parent=None)
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

    def _current_nav_path(self) -> str | None:
        editor = getattr(self, "_editor_tabs", None)
        if not editor:
            return None
        current = editor.current_editor()
        if not current:
            return None
        return (
            getattr(current, "file_path", None)
            or (current.get_file_path() if hasattr(current, "get_file_path") else None)
        )

    def _record_file_navigation(self, path: str):
        if self._navigating:
            return
        current = self._current_nav_path()
        if current and current != path:
            if not self._nav_back_stack or self._nav_back_stack[-1] != current:
                self._nav_back_stack.append(current)
            self._nav_forward_stack.clear()

    def _navigate_back(self):
        if not self._nav_back_stack:
            return
        path = self._nav_back_stack.pop(0)
        if self._nav_back_stack:
            self._nav_forward_stack = list(self._nav_back_stack) + list(self._nav_forward_stack)
            self._nav_back_stack.clear()
        current = self._current_nav_path()
        if current and current != path:
            self._nav_forward_stack.insert(0, current)
        self._open_file_in_editor(path, False)

    def _navigate_forward(self):
        if not self._nav_forward_stack:
            return
        path = self._nav_forward_stack.pop(0)
        self._open_file_in_editor(path, False)

    def _open_file_in_editor(self, path: str, record_nav: bool = True):
        if path.startswith("line:"):
            try:
                line = int(path.split(":")[1])
                editor = self._editor_tabs.current_editor()
                if editor:
                    editor.reveal_line(line)
            except ValueError:
                pass
            return

        if os.path.isfile(path):
            if record_nav:
                self._record_file_navigation(path)
            self._navigating = True
            try:
                # Track as recently opened file
                recent = [
                    os.path.normpath(p)
                    for p in getattr(self._config, "recent_files", [])
                    if p and os.path.isfile(p)
                ]
                norm_path = os.path.normpath(path)
                recent = [p for p in recent if os.path.normcase(p) != os.path.normcase(norm_path)]
                self._config.recent_files = [norm_path, *recent][:20]
                self._config.save()
                self._editor_tabs.refresh_welcome_recent()
                if hasattr(self, '_quick_open'):
                    self._quick_open.add_recent_file(path)
                editor = self._editor_tabs.open_file(path)
            finally:
                self._navigating = False
            if editor:
                self._status_bar.set_language(editor.get_language())
                if hasattr(editor, "diagnostics_ready"):
                    try:
                        import warnings
                        with warnings.catch_warnings():
                            warnings.simplefilter("ignore", RuntimeWarning)
                            editor.diagnostics_ready.disconnect(self._on_editor_diagnostics)
                    except (RuntimeError, TypeError):
                        pass
                    editor.diagnostics_ready.connect(self._on_editor_diagnostics)
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

    def _close_workspace(self):
        self._config.workspace_path = None
        self._config.save()
        self._file_explorer.set_root(None)
        self._git_panel.set_workspace_path(None)
        self._update_window_title()

    def _find_in_folder(self, path: str):
        self._switch_sidebar(VIEW_SEARCH)
        if hasattr(self._search_panel, '_include_input'):
            import os
            root = self._config.workspace_path or ""
            include_path = path
            if root:
                try:
                    include_path = os.path.relpath(path, root)
                except ValueError:
                    include_path = path
            self._search_panel._include_input.setText(include_path.replace('\\', '/') + "/**")
            self._search_panel._query_input.setFocus()

    def _open_in_terminal(self, path: str):
        import os
        if os.path.isfile(path):
            path = os.path.dirname(path)
        
        # We need to create a new terminal in this specific path
        if not self._terminal_panel.isVisible():
            self._toggle_terminal()
            
        self._terminal_panel._create_new_terminal(cwd=path)

    def _open_with_live_server(self, path: str):
        import webbrowser
        from ..remote.live_server import is_frontend_file, localhost_url, resolve_serve_root

        if not path or not is_frontend_file(path):
            QMessageBox.information(
                self,
                "Live Server",
                "Live Server works with HTML and other frontend files.",
            )
            return

        root = resolve_serve_root(path, self._config.workspace_path)
        try:
            port = self._live_server.start(root, preferred_port=self._live_server_preferred_port)
            self._live_server_preferred_port = port
        except OSError as exc:
            QMessageBox.warning(self, "Live Server", f"Could not start server: {exc}")
            return
        except FileNotFoundError:
            QMessageBox.warning(self, "Live Server", f"Serve folder not found: {root}")
            return

        url = localhost_url(root, path, port)
        self._ports_panel.register_port(port, source="Live Server", status="Running")
        if not self._bottom_panel.isVisible():
            self._toggle_panel_force(True)
        self._bottom_panel.set_active_view("ports")
        self._title_bar.btn_bottom_panel.setChecked(True)
        if hasattr(self, "panel_act"):
            self.panel_act.setChecked(True)

        self._output_panel.append(f"Live Server started at {url}\n", "Live Server")
        try:
            webbrowser.open(url)
        except Exception:
            pass

    def _open_to_side(self, path: str):
        if not os.path.isfile(path):
            return
            
        # If we only have one group, split it
        if len(self._editor_tabs._groups) == 1:
            self._editor_tabs.split_editor("right")
            
        # Open the file in the right-most group (which is likely the newly created or secondary one)
        target_group = self._editor_tabs._groups[-1]
        target_group.open_file(path)

    def _save_all(self):
        self._editor_tabs.save_all()

    def _on_editor_dirty_changed(self, is_dirty: bool):
        if is_dirty and getattr(self._config, 'auto_save', False):
            self._auto_save_timer.start()

    def _save_all_dirty_if_auto_save(self):
        if getattr(self._config, 'auto_save', False):
            self._editor_tabs.save_all(is_auto_save=True)

    def _on_auto_save_toggle(self, checked: bool):
        self._config.auto_save = checked
        self._config.save()
        if checked:
            # Trigger immediate save if turning on
            self._save_all_dirty_if_auto_save()

    def _close_current_editor(self):
        """Close the currently active editor tab (Ctrl+W)."""
        self._editor_tabs.close_current()

    def _close_folder(self):
        if not self._editor_tabs.close_all():
            return
        self._config.workspace_path = ""
        self._config.save()
        self._file_explorer.set_root(None)
        self._on_root_changed(None)

    def _select_all(self):
        """Select all text via Monaco's built-in command."""
        editor = self._editor_tabs.current_editor()
        if editor:
            editor._view.page().runJavaScript("editor && editor.trigger('', 'selectAll', {});")

    def _show_theme_switcher(self):
        """Show theme preview picker with all available themes."""
        from .theme_manager import ThemeManager
        cmd_palette = CommandPalette(self)
        
        original_theme_id = ThemeManager.current_theme_id()
        
        themes = [
            {"id": f"theme:{t['id']}", "label": f"{t['name']}  ({t['type']})", "shortcut": ""}
            for t in ThemeManager.get_theme_list()
        ]
        
        cmd_palette.set_commands(themes)
        
        # Real-time preview when hovering
        def preview_theme(current, previous):
            if current:
                cmd_id = current.data(Qt.UserRole)
                if isinstance(cmd_id, str) and cmd_id.startswith("theme:"):
                    tid = cmd_id[6:]
                    self._set_theme(tid)
                    
        cmd_palette._list.currentItemChanged.connect(preview_theme)
        
        def confirm_theme(cmd_id):
            if cmd_id.startswith("theme:"):
                tid = cmd_id[6:]
                self._set_theme(tid, persist=True)
                
        def cancel_theme():
            self._set_theme(original_theme_id)
                
        cmd_palette.command_selected.connect(confirm_theme)
        cmd_palette.rejected.connect(cancel_theme)
        cmd_palette.show_palette()

    def _show_icon_theme_switcher(self):
        """Pick a file icon theme (builtin or contributed by extensions)."""
        from ..core.icon_theme_manager import get_icon_theme_manager

        mgr = get_icon_theme_manager()
        cmd_palette = CommandPalette(self)

        entries = [{"id": "icontheme:builtin", "label": "Dardcor Default Icons", "shortcut": ""}]
        entries.extend(
            {"id": f"icontheme:{t['id']}", "label": f"{t['label']}  [Extension]", "shortcut": ""}
            for t in mgr.available_themes()
        )
        cmd_palette.set_commands(entries)

        def confirm(cmd_id):
            if cmd_id.startswith("icontheme:"):
                mgr.set_active(cmd_id[len("icontheme:"):])
                self._refresh_file_icons()

        cmd_palette.command_selected.connect(confirm)
        cmd_palette.show_palette()

    def _refresh_file_icons(self):
        """Rebuild explorer tree so file/folder icons reflect the icon theme."""
        try:
            self._file_explorer._refresh()
        except Exception:
            pass

    def _set_theme(self, theme_id: str, persist: bool = False):
        """Apply a theme by its ID from ThemeManager (builtin or extension)."""
        if hasattr(self, "_theme_overlay") and self.isVisible():
            self._theme_overlay.show()
            self._theme_overlay.raise_()
            QApplication.processEvents()
            QTimer.singleShot(600, lambda: self._do_set_theme(theme_id, persist))
        else:
            self._do_set_theme(theme_id, persist)

    def _do_set_theme(self, theme_id: str, persist: bool):
        from .theme_manager import ThemeManager
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance()
        if app:
            ThemeManager.apply_theme(app, theme_id)

        monaco_theme = ThemeManager.get_monaco_theme()
        if monaco_theme is not None:
            # Extension theme: define + activate custom Monaco theme
            self._editor_tabs.set_custom_theme(monaco_theme)
        else:
            self._editor_tabs.set_custom_theme(None)
            is_dark = ThemeManager.THEMES.get(theme_id, {}).get("type", "dark") == "dark"
            self._editor_tabs.set_theme("dark" if is_dark else "light")

        if hasattr(self, "_chat_panel") and hasattr(self._chat_panel, "apply_theme"):
            self._chat_panel.apply_theme()

        if hasattr(self, "_git_panel") and hasattr(self._git_panel, "apply_theme"):
            colors = ThemeManager.THEMES.get(theme_id, {}).get("colors", {})
            if colors:
                self._git_panel.apply_theme(colors)

        if persist:
            self._config.color_theme = theme_id
            self._config.save()
            
        if hasattr(self, "_theme_overlay"):
            self._theme_overlay.hide()

    def _toggle_menu_bar(self):
        """Toggle the visibility of the menu bar."""
        menu_bar = self._title_bar.menu_bar
        menu_bar.setVisible(not menu_bar.isVisible())

    def _open_problems_panel(self):
        self._bottom_panel.set_active_view("problems")
        self._title_bar.btn_bottom_panel.setChecked(True)

    def _open_output_panel(self):
        self._bottom_panel.set_active_view("output")
        self._title_bar.btn_bottom_panel.setChecked(True)

    def _open_debug_console(self):
        self._bottom_panel.set_active_view("debug")
        self._title_bar.btn_bottom_panel.setChecked(True)

    def _show_bottom_panel(self):
        self._bottom_panel.show()
        self._title_bar.btn_bottom_panel.setChecked(True)
        if hasattr(self, "panel_act"):
            self.panel_act.setChecked(True)

    def _build_debug_config(self, file_path: str) -> dict:
        workspace = self._config.workspace_path or os.path.dirname(file_path)
        config_name = self._debug_panel.get_selected_config_name()
        launch_cfg = self._launch_config.get_config_by_name(config_name)
        if launch_cfg:
            resolved = launch_cfg.resolve(workspace, file_path)
            if resolved.get("program") or resolved.get("module"):
                return resolved
        return {
            "type": "python",
            "request": "launch",
            "name": "Python: Current File",
            "program": file_path,
            "console": "integratedTerminal",
            "cwd": workspace,
            "justMyCode": True,
        }

    def _start_debugging(self):
        editor = self._editor_tabs.current_editor()
        if not editor or not editor.get_file_path():
            self._output_panel.append("No file open to debug.", "Dardcor")
            self._open_output_panel()
            return

        file_path = editor.get_file_path()
        config = self._build_debug_config(file_path)
        self._open_debug_console()
        self._debug_console.append(f"Starting debug session: {config.get('name', 'Debug')}\n", "Debug Console")
        self._debug_panel._status_label.setText("Starting...")
        self._dap_manager.set_workspace(self._config.workspace_path or os.path.dirname(file_path))

        def worker():
            self._dap_manager.on_event(self._on_dap_event)
            client = self._dap_manager.start_python_debug(config)
            if client:
                QTimer.singleShot(0, lambda: self._debug_panel.set_dap_client(client))
            else:
                def on_fail():
                    self._debug_panel._status_label.setText("Failed to start debugger")
                    self._debug_console.append(
                        "Could not start debugpy adapter. Install debugpy: pip install debugpy\n",
                        "Debug Console",
                    )
                QTimer.singleShot(0, on_fail)

        threading.Thread(target=worker, daemon=True).start()

    def _on_dap_event(self, event_name: str, body: dict):
        def handle():
            if event_name == "output":
                text = body.get("output", "")
                if not text:
                    return
                category = body.get("category", "stdout")
                prefix = "[stderr] " if category == "stderr" else ""
                self._debug_console.append(prefix + text, "Debug Console")
            elif event_name == "terminated":
                self._debug_console.append("Debug session ended.\n", "Debug Console")
            elif event_name == "exited":
                code = body.get("exitCode", 0)
                self._debug_console.append(f"Process exited with code {code}.\n", "Debug Console")

        QTimer.singleShot(0, handle)

    def _stop_debugging(self):
        if hasattr(self, "_debug_panel"):
            self._debug_panel._on_stop()
        if hasattr(self, "_dap_manager"):
            self._dap_manager.stop_all()
        self._debug_console.append("Debug session stopped.\n", "Debug Console")

    def _debug_continue(self):
        client = getattr(self._debug_panel, "_dap_client", None)
        if client:
            threading.Thread(target=client.continue_, daemon=True).start()
        else:
            self._start_debugging()

    def _debug_step_over(self):
        client = getattr(self._debug_panel, "_dap_client", None)
        if client:
            threading.Thread(target=client.next, daemon=True).start()

    def _debug_step_in(self):
        client = getattr(self._debug_panel, "_dap_client", None)
        if client:
            threading.Thread(target=client.step_in, daemon=True).start()

    def _debug_step_out(self):
        client = getattr(self._debug_panel, "_dap_client", None)
        if client:
            threading.Thread(target=client.step_out, daemon=True).start()

    def _run_current_file(self):
        """Run the currently open file."""
        editor = self._editor_tabs.current_editor()
        if not editor or not editor.get_file_path():
            self._output_panel.append("No file open to run.", "Dardcor")
            self._open_output_panel()
            return
        filepath = editor.get_file_path()
        ext = os.path.splitext(filepath)[1]
        self._show_bottom_panel()
        self._bottom_panel.set_active_view("terminal")
        self._terminal_panel._new_terminal()
        self._output_panel.append(f"Running: {filepath}\n", "Dardcor")
        if ext == ".py":
            QTimer.singleShot(500, lambda: self._terminal_panel._terminals[-1].write_input(
                f'python "{filepath}"\r\n'
            ))
        else:
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
        
        # Sync Open Editors Panel
        open_files = self._editor_tabs.get_open_files()
        self._open_editors_panel.update_editors(open_files, file_path)
        
        # Auto-reveal in file explorer
        if file_path:
            self._file_explorer.reveal_and_select_file(file_path)

        if self._current_active_editor:
            try:
                if hasattr(self._current_active_editor, "cursor_position_changed"):
                    self._current_active_editor.cursor_position_changed.disconnect(self._on_cursor_moved)
                if hasattr(self._current_active_editor, "content_changed"):
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
            if hasattr(editor, "cursor_position_changed"):
                editor.cursor_position_changed.connect(self._on_cursor_moved)
            if hasattr(editor, "content_changed"):
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
        if not file_path:
            self._outline_panel.set_symbols([])
            return

        editor = self._editor_tabs.current_editor()
        if editor:
            content = editor.get_content()
            symbols = parse_outline_symbols(content, file_path)
            self._outline_panel.set_symbols(symbols)
        else:
            self._outline_panel.set_symbols([])

    def _on_editor_content_changed(self, content: str):
        editor = self._editor_tabs.current_editor()
        if editor:
            file_path = editor.get_file_path()
            if file_path:
                symbols = parse_outline_symbols(content, file_path)
                self._outline_panel.set_symbols(symbols)

    # ── Root / workspace ──────────────────────────────────

    def _on_root_changed(self, path: str):
        effective = path or ""
        self._quick_open_root = effective
        if hasattr(self, "_search_panel"):
            self._search_panel.set_root(effective)
        if hasattr(self, "_terminal_panel"):
            self._terminal_panel.set_workdir(effective or os.path.expanduser("~"))
        quick_open = getattr(self, "_quick_open", None)
        if quick_open is not None:
            quick_open.set_root(effective)
            quick_open._all_files = []
        basename = os.path.basename(effective.rstrip("/\\")) if effective else ""
        if hasattr(self, "_chat_panel"):
            self._chat_panel.set_workspace_name(basename.lower())
        if hasattr(self, "_git_panel"):
            self._git_panel.set_root(effective)
        if hasattr(self, "_launch_config"):
            self._launch_config.set_workspace(effective)
            if hasattr(self, "_debug_panel"):
                self._debug_panel.set_config_names(self._launch_config.get_config_names())
        self._config.workspace_path = effective
        if effective and os.path.isdir(effective):
            recent = [
                os.path.normpath(p)
                for p in getattr(self._config, "recent_folders", [])
                if p and os.path.isdir(p)
            ]
            norm_effective = os.path.normpath(effective)
            recent = [p for p in recent if os.path.normcase(p) != os.path.normcase(norm_effective)]
            self._config.recent_folders = [norm_effective, *recent][:10]
        self._config.save()
        if hasattr(self, "_editor_tabs"):
            self._editor_tabs.refresh_welcome_recent()
        self._update_window_title()
        if effective and hasattr(self, '_agent'):
            self._agent.set_workspace(effective)
        QTimer.singleShot(100, self._detect_git_branch)

    def _update_window_title(self, file_path: str = None):
        """Update window title dynamically based on active file and workspace."""
        file_name = ""
        if file_path:
            file_name = os.path.basename(file_path)
        elif self._editor_tabs.current_editor() and hasattr(self._editor_tabs.current_editor(), 'get_file_path'):
            fp = self._editor_tabs.current_editor().get_file_path()
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

    def _resolve_stack_index(self, view_id: int) -> int:
        """Map an activity-bar view id to a sidebar stack index.

        Builtin views (0-5) map to their own index; extension view containers
        are registered in self._ext_view_stack_index.
        """
        mapping = getattr(self, "_ext_view_stack_index", {})
        if view_id in mapping:
            return mapping[view_id]
        if view_id < self._sidebar_stack.count():
            return view_id
        return -1

    def _on_view_changed(self, view_id: int):
        idx = self._resolve_stack_index(view_id)
        if idx >= 0:
            self._sidebar_stack.setCurrentIndex(idx)
            if not self._sidebar_stack.isVisible():
                self._sidebar_stack.show()
            self._activity_bar.set_active(view_id)

    def _switch_sidebar(self, view_id: int):
        idx = self._resolve_stack_index(view_id)
        if idx < 0:
            return
        self._sidebar_stack.setCurrentIndex(idx)
        self._activity_bar.set_active(view_id)
        if not self._sidebar_stack.isVisible():
            self._sidebar_stack.show()
        if view_id == VIEW_SEARCH and hasattr(self._search_panel, "focus_query"):
            QTimer.singleShot(0, self._search_panel.focus_query)
        elif view_id == VIEW_SOURCE_CONTROL and hasattr(self._git_panel, "bridge"):
            QTimer.singleShot(0, self._git_panel.bridge.requestRefresh)

    # ── Chat / Agent ──────────────────────────────────────

    def _on_chat_link_clicked(self, url: str):
        def open_browser_tab():
            from ..editor.browser_widget import BrowserWidget
            from PySide6.QtGui import QIcon
            browser = BrowserWidget(url, self)
            self._editor_tabs.add_custom_tab(browser, "Browser", QIcon())
        QTimer.singleShot(0, open_browser_tab)

    def _on_chat_message(self, message: str):
        if self._chat_generation_active:
            if message in self._queued_chat_messages:
                return
            self._queued_chat_messages.append(message)
            self.pending_messages_changed.emit(len(self._queued_chat_messages))
            return

        # Inject real-time project context into agent BEFORE sending the message
        self._inject_project_context_to_agent()

        self._start_chat_message(message)

    def _inject_project_context_to_agent(self):
        """Build a real-time snapshot of the current IDE state and inject it
        as a system message so the Agent always knows exactly what project is open."""
        ctx_parts = []

        # 1. Workspace / folder
        ws = self._config.workspace_path
        if ws:
            ctx_parts.append(f"WORKSPACE: {ws}")

        # 2. Active (focused) editor file
        active_editor = self._editor_tabs.current_editor() if self._editor_tabs else None
        active_path = None
        if active_editor:
            # Support both .file_path attribute and .get_file_path() method
            active_path = (
                getattr(active_editor, "file_path", None)
                or (active_editor.get_file_path() if hasattr(active_editor, "get_file_path") else None)
            )
        if active_path:
            ctx_parts.append(f"ACTIVE FILE: {active_path}")

        # 3. All open editor files (across all groups)
        open_files = []
        if self._editor_tabs and hasattr(self._editor_tabs, "_groups"):
            for group in self._editor_tabs._groups:
                ed = group.current_editor() if hasattr(group, "current_editor") else None
                if ed:
                    fp = (
                        getattr(ed, "file_path", None)
                        or (ed.get_file_path() if hasattr(ed, "get_file_path") else None)
                    )
                    if fp and fp not in open_files:
                        open_files.append(fp)
        if open_files:
            ctx_parts.append("OPEN FILES:\n" + "\n".join(f"  - {f}" for f in open_files))

        if not ctx_parts:
            return

        ctx_msg = "[REAL-TIME IDE CONTEXT]\n" + "\n".join(ctx_parts)

        # Only inject if the context has actually changed since last time
        last_ctx = getattr(self, "_last_injected_context", None)
        if ctx_msg == last_ctx:
            return

        self._last_injected_context = ctx_msg
        # Update agent's workspace path silently
        if ws:
            self._agent._config.workspace_path = ws
        # Insert as a system message into agent conversation (not shown in chat UI)
        self._agent._conversation.add_message("system", ctx_msg)





    def _start_chat_message(self, message: str):
        self._chat_generation_active = True
        self._chat_panel.set_enabled(False)
        import uuid
        current_exec_id = str(uuid.uuid4())
        self._current_chat_exec_id = current_exec_id

        # Slash Commands Processing
        original_message = message
        if message.startswith("/fix"):
            message = "Tolong perbaiki kode di file aktif saya. Temukan bug atau error sintaks dan perbaiki. " + message[4:].strip()
        elif message.startswith("/explain"):
            message = "Tolong jelaskan kode di file aktif saya secara mendetail. " + message[8:].strip()
        elif message.startswith("/plan"):
            message = "Tolong buatkan rencana arsitektur untuk fitur ini: " + message[5:].strip()
        self._current_chat_exec_id = current_exec_id

        selected_model = None
        if self._chat_panel.model_dropdown.isVisible():
            selected_model = self._chat_panel.selected_model_id()

        def _on_notification(msg: str):
            if msg.startswith("ARTIFACT_CREATED:"):
                path = msg.split("ARTIFACT_CREATED:")[1]
                QTimer.singleShot(0, lambda: self._editor_tabs.open_file(path))
                return
            if msg.startswith("BROWSER_OPENED:"):
                url = msg.split("BROWSER_OPENED:")[1]
                def open_browser_tab():
                    from ..editor.browser_widget import BrowserWidget
                    from PySide6.QtGui import QIcon
                    browser = BrowserWidget(url, self, controlled_by_ai=True)
                    self._editor_tabs.add_custom_tab(browser, "AI Browser", QIcon())
                QTimer.singleShot(0, open_browser_tab)
                return
            self._chat_panel.show_native_notification(msg)

        # Collect ephemeral state
        ephemeral_state = ""
        try:
            editor = self._editor_tabs.current_editor()
            if editor:
                fpath = editor.get_file_path()
                if fpath:
                    ephemeral_state += f"Active File: {fpath}\n"
                    line, col = editor.get_cursor_position()
                    ephemeral_state += f"Cursor Position: Line {line}, Column {col}\n"
        except Exception:
            pass

        def process():
            try:
                response = self._agent.send_message(
                    message,
                    model_override=selected_model,
                    on_tool_call=self._chat_panel.append_tool_call,
                    on_system_message=self._chat_panel.append_system_message,
                    on_tool_output=self._chat_panel.append_tool_output,
                    on_notification=_on_notification,
                    on_agent_message=self._chat_panel.append_agent_message,
                    on_title_changed=self._chat_panel.set_conversation_title,
                    ephemeral_state=ephemeral_state,
                )
                if getattr(self, "_current_chat_exec_id", None) != current_exec_id:
                    return # A new generation started or stopped
                if response and response != "Agent dihentikan oleh pengguna.":
                    self._chat_panel.append_agent_message(response)
            except Exception as e:
                if getattr(self, "_current_chat_exec_id", None) == current_exec_id:
                    self._chat_panel.append_system_message(f"Error: {e}")
            finally:
                if getattr(self, "_current_chat_exec_id", None) == current_exec_id:
                    self._chat_generation_active = False
                    self._chat_panel.show_typing(False)
                    if self._queued_chat_messages:
                        self._run_queued_chat_signal.emit()
                    else:
                        self._chat_panel.set_enabled(True)

        self._thread_pool.submit(process)

    def _run_next_queued_chat_message(self):
        if self._chat_generation_active or not self._queued_chat_messages:
            return
        next_message = self._queued_chat_messages.pop(0)
        self.pending_messages_changed.emit(len(self._queued_chat_messages))
        self._start_chat_message(next_message)

    def _on_stop_requested(self):
        self._agent.abort()
        self._chat_generation_active = False
        self._chat_panel.show_typing(False)
        self._chat_panel.append_system_message("Generation stopped.")
        if self._queued_chat_messages:
            self._run_queued_chat_signal.emit()
        else:
            self._chat_panel.set_enabled(True)

    def _on_agent_stream(self, text: str):
        pass

    def _new_conversation(self):
        self._queued_chat_messages.clear()
        self.pending_messages_changed.emit(0)
        self._chat_generation_active = False
        self._agent.new_conversation()
        self._chat_panel.clear()
        self._chat_panel.set_conversation_title("Dardcor Agent")

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
                conv = self._agent.get_conversation()
                self._chat_panel.set_conversation_title(conv.title if conv.title else "Dardcor Agent")
                for msg in conv.messages:
                    if msg.role == "user":
                        self._chat_panel._append_user_message(msg.content)
                    elif msg.role == "assistant":
                        if hasattr(msg, "tool_calls") and msg.tool_calls:
                            for tc in msg.tool_calls:
                                fn_name = tc.get("function", {}).get("name", "tool")
                                fn_args = tc.get("function", {}).get("arguments", "{}")
                                fn_id = tc.get("id", f"hist-{fn_name}-{hash(fn_args) & 0xFFFFFFFF:x}")
                                self._chat_panel._safe_append_tool_call(fn_id, fn_name, fn_args, status="running")
                                self._chat_panel._safe_append_tool_call(fn_id, fn_name, fn_args, status="success")
                        if msg.content:
                            self._chat_panel.append_agent_message(msg.content)
                    elif msg.role == "system":
                        # Only show system messages if it's not the identity prompt
                        if "You are" not in msg.content and "Dardcor Code" not in msg.content:
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
        root = self._config.workspace_path or os.path.expanduser("~")
        if not os.path.exists(os.path.join(root, ".git")):
            if hasattr(self, "_status_bar") and self._status_bar:
                self._status_bar.set_git_branch("")
            return

        from ..core.commands import CommandExecutor
        cmd = CommandExecutor()
        result = cmd.execute("git rev-parse --abbrev-ref HEAD", workdir=root, timeout=5)
        branch = result.stdout.strip() if result.stdout else "main"
        if branch and result.exit_code == 0:
            if hasattr(self, "_status_bar") and self._status_bar:
                self._status_bar.set_git_branch(branch)
        else:
            if hasattr(self, "_status_bar") and self._status_bar:
                self._status_bar.set_git_branch("")

    # ── Dialogs ───────────────────────────────────────────

    def _show_command_palette(self):
        self._command_palette.set_commands(self._commands)
        self._command_palette.show_palette()

    def _show_quick_open(self):
        self._quick_open.show_dialog(from_command_center=False)

    def _show_command_center_quick_open(self):
        """Open Quick Open in Command Center mode (shows help picks first)."""
        self._quick_open.show_dialog(from_command_center=True)

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

    def _show_git_branch_menu(self):
        from PySide6.QtWidgets import QMenu, QInputDialog
        import subprocess, os
        menu = QMenu(self)
        menu.setStyleSheet("QMenu { background: #1a0033; color: #cccccc; border: 1px solid #3c0068; } QMenu::item:selected { background: #2c004a; }")
        
        cwd = self._config.workspace_path or "."
        kwargs = {}
        if os.name == 'nt':
            kwargs['creationflags'] = 0x08000000
        try:
            out = subprocess.check_output(["git", "branch"], cwd=cwd, text=True, **kwargs)
            branches = [b.strip().lstrip("* ") for b in out.splitlines() if b.strip()]
            for b in branches:
                act = menu.addAction(f"Checkout {b}")
                act.triggered.connect(lambda checked=False, branch=b: subprocess.run(["git", "checkout", branch], cwd=cwd, **kwargs))
        except Exception:
            menu.addAction("No Git Repository").setEnabled(False)
            
        menu.addSeparator()
        create_act = menu.addAction("Create Branch...")
        def create_branch():
            name, ok = QInputDialog.getText(self, "Create Branch", "Branch name:")
            if ok and name:
                try:
                    subprocess.run(["git", "checkout", "-b", name], cwd=cwd, **kwargs)
                except Exception:
                    pass
        create_act.triggered.connect(create_branch)
        
        if hasattr(self._status_bar, "_git_btn"):
            pos = self._status_bar._git_btn.mapToGlobal(self._status_bar._git_btn.rect().topLeft())
            # Move up slightly so it appears above status bar
            pos.setY(pos.y() - menu.sizeHint().height() - 20)
            menu.exec(pos)

    def _show_find_replace(self):
        editor = self._editor_tabs.current_editor()
        if editor:
            editor.trigger_find_replace()

    def _show_color_picker(self):
        from PySide6.QtWidgets import QColorDialog
        color = QColorDialog.getColor(self._config.ui_theme_base if hasattr(self._config, 'ui_theme_base') else Qt.white, self, "Color Picker")
        if color.isValid():
            editor = self._editor_tabs.current_editor()
            if editor:
                editor.insert_text(color.name())

    def _show_settings(self):
        from ..settings.settings_ui import SettingsUIWidget
        widget = SettingsUIWidget(self)
        self._editor_tabs.add_custom_tab(widget, "⚙ Settings")

    def _apply_settings(self):
        from ..core.config import get_config
        self._config = get_config()
        
        # Apply to editor tabs
        if hasattr(self, '_editor_tabs') and self._editor_tabs:
            self._editor_tabs.set_font_size(self._config.font_size)
            self._editor_tabs.set_word_wrap(self._config.word_wrap)
            self._editor_tabs.set_minimap(self._config.minimap_enabled)
            
        # Apply to file explorer (to pick up files.exclude changes)
        if hasattr(self, '_sidebar') and hasattr(self._sidebar, '_explorer'):
            if self._sidebar._explorer._root_path:
                self._sidebar._explorer.set_root(self._sidebar._explorer._root_path)

    def _show_about(self):
        QMessageBox.about(
            self,
            "About Dardcor Code",
            "Dardcor Code v1.0.0\n\n"
            "Full Desktop AI Coding Assistant\n\n"
            "A VS Code-like IDE with integrated AI pair programming.\n"
            "Built with Python + PySide6 (Qt)\n\n"
            "License: MIT\n"
            "https://github.com/Dardcor/dardcor-code",
        )

    def _show_keyboard_shortcuts(self):
        from ..settings.keybindings_ui import KeybindingsUIWidget
        widget = KeybindingsUIWidget(self)
        self._editor_tabs.add_custom_tab(widget, "⌨ Keyboard Shortcuts")

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
        
        if hasattr(self, 'primary_sidebar_act'):
            self.primary_sidebar_act.setChecked(self._sidebar_stack.isVisible())
        if hasattr(self, 'secondary_sidebar_act'):
            self.secondary_sidebar_act.setChecked(self._chat_panel.isVisible())
        if hasattr(self, 'panel_act'):
            self.panel_act.setChecked(self._bottom_panel.isVisible())
        if hasattr(self, 'status_bar_act'):
            self.status_bar_act.setChecked(self._status_bar.isVisible())
        if hasattr(self, 'activity_bar_act'):
            self.activity_bar_act.setChecked(self._activity_bar.isVisible())
        if hasattr(self, 'toggle_menu_bar_act'):
            self.toggle_menu_bar_act.setChecked(self._title_bar.menu_bar.isVisible())

    def _toggle_menu_bar(self):
        self._toggle_menu_bar_force(not self._title_bar.menu_bar.isVisible())
        self._refresh_customize_popup()

    def _toggle_status_bar(self):
        self._toggle_status_bar_force(not self._status_bar.isVisible())
        self._refresh_customize_popup()

    def _toggle_activity_bar(self):
        self._toggle_activity_bar_force(not self._activity_bar.isVisible())
        self._refresh_customize_popup()

    def _toggle_sidebar(self):
        self._toggle_primary_sidebar_force(not self._sidebar_stack.isVisible())
        self._refresh_customize_popup()

    def _toggle_chat(self):
        self._toggle_secondary_sidebar_force(not self._chat_panel.isVisible())
        self._refresh_customize_popup()

    def _toggle_terminal(self):
        if self._bottom_panel.isVisible():
            if self._bottom_panel.current_view_name() != "terminal":
                self._bottom_panel.set_active_view("terminal")
                self._title_bar.btn_bottom_panel.setChecked(True)
                if hasattr(self, 'panel_act'):
                    self.panel_act.setChecked(True)
            else:
                self._toggle_panel_force(False)
        else:
            self._bottom_panel.set_active_view("terminal")
            self._toggle_panel_force(True)
        self._refresh_customize_popup()

    def _refresh_customize_popup(self):
        """If the popup is open, update its toggle states."""


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
        self._config.ui_zoom = getattr(self._config, 'ui_zoom', 0) + 1
        app = QApplication.instance()
        font = app.font()
        font.setPointSize(9 + self._config.ui_zoom)
        app.setFont(font)
        
        self._font_size = min(self._font_size + 1, 32)
        self._apply_font_size_to_all(self._font_size)
        self._config.font_size = self._font_size
        self._config.save()

    def _zoom_out(self):
        self._config.ui_zoom = getattr(self._config, 'ui_zoom', 0) - 1
        app = QApplication.instance()
        font = app.font()
        new_size = max(6, 9 + self._config.ui_zoom)
        font.setPointSize(new_size)
        app.setFont(font)
        
        self._font_size = max(self._font_size - 1, 8)
        self._apply_font_size_to_all(self._font_size)
        self._config.font_size = self._font_size
        self._config.save()

    def _toggle_inline_diff(self):
        self._diff_inline_view = not getattr(self, '_diff_inline_view', False)
        self._editor_tabs.toggle_inline_diff(self._diff_inline_view)

    # ── Close ─────────────────────────────────────────────

    def closeEvent(self, event):
        try:
            if hasattr(self, "_live_server"):
                self._live_server.stop()
        except Exception:
            pass
            
        if hasattr(self, '_thread_pool'):
            self._thread_pool.shutdown(wait=False)

        # Log session end telemetry
        try:
            from ..core.telemetry import get_telemetry_service
            telemetry = get_telemetry_service()
            telemetry.public_log("session.end", {
                "workspace": self._config.workspace_path or "",
                "open_tabs": sum(len(g._tabs) for g in self._editor_tabs._groups),
            })
        except Exception:
            pass

        # Handle unsaved files
        if getattr(self._config, 'auto_save', False):
            self._editor_tabs.save_all(is_auto_save=True)
        else:
            dirty_count = 0
            for group in self._editor_tabs._groups:
                for tab in group._tabs:
                    if tab.editor and hasattr(tab.editor, 'is_dirty') and tab.editor.is_dirty():
                        dirty_count += 1
            if dirty_count > 0:
                reply = QMessageBox.question(
                    self, "Unsaved Files",
                    f"You have {dirty_count} unsaved file(s). Do you want to save them before closing?",
                    QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel
                )
                if reply == QMessageBox.Save:
                    self._editor_tabs.save_all()
                elif reply == QMessageBox.Cancel:
                    event.ignore()
                    return

        # Clean up terminal processes
        for term in getattr(self._terminal_panel, '_terminals', []):
            if hasattr(term, 'kill_all'):
                term.kill_all()
                
        # Clean up language servers
        if hasattr(self, '_lsp_manager'):
            self._lsp_manager.stop_all()

        # Save config
        self._config.save()
        super().closeEvent(event)

    # ── Customize Layout ───────────────────────────────────

    def _show_customize_layout(self):
        """Show the Customize Layout via Quick Pick Command Palette."""
        self._quick_open.show_customize_layout()

    # --- Force-visibility helpers (accept explicit bool) ------

    def _toggle_activity_bar_force(self, show: bool):
        self._activity_bar.setVisible(show)
        if hasattr(self, 'activity_bar_act'):
            self.activity_bar_act.setChecked(show)
        self._refresh_customize_popup()

    def _toggle_primary_sidebar_force(self, show: bool):
        self._sidebar_stack.setVisible(show)
        self._title_bar.btn_left_sidebar.setChecked(show)
        if hasattr(self, 'primary_sidebar_act'):
            self.primary_sidebar_act.setChecked(show)
        self._refresh_customize_popup()

    def _toggle_secondary_sidebar_force(self, show: bool):
        self._chat_panel.setVisible(show)
        self._title_bar.btn_right_sidebar.setChecked(show)
        if hasattr(self, 'secondary_sidebar_act'):
            self.secondary_sidebar_act.setChecked(show)
        self._refresh_customize_popup()

    def _toggle_panel_force(self, show: bool):
        if show:
            self._bottom_panel.show()
            self._title_bar.btn_bottom_panel.setChecked(True)
        else:
            self._bottom_panel.hide()
            self._title_bar.btn_bottom_panel.setChecked(False)
        if hasattr(self, 'panel_act'):
            self.panel_act.setChecked(show)
        self._refresh_customize_popup()

    def _toggle_status_bar_force(self, show: bool):
        self._status_bar.setVisible(show)
        if hasattr(self, 'status_bar_act'):
            self.status_bar_act.setChecked(show)
        self._refresh_customize_popup()

    def _toggle_menu_bar_force(self, show: bool):
        self._title_bar.menu_bar.setVisible(show)
        if hasattr(self, 'toggle_menu_bar_act'):
            self.toggle_menu_bar_act.setChecked(show)
        self._refresh_customize_popup()

    # --- Primary Sidebar Position ----------------------

    def _set_primary_sidebar_position(self, position: str):
        """Move the Primary Sidebar to 'left' or 'right'."""
        self._primary_sidebar_position = position
        # _horiz_split has [sidebar_stack, center_chat_split]
        # For 'right' we swap the order; for 'left' we restore it.
        splitter = self._horiz_split
        sidebar = self._sidebar_stack
        center = self._center_chat_split
        activity = self._activity_bar

        if position == 'right':
            # Move activity bar to right of center
            splitter.insertWidget(0, center)
            splitter.insertWidget(1, sidebar)
            # Move activity bar widget inside main layout
            main_lay = self.centralWidget().layout()
            main_lay.removeWidget(activity)
            main_lay.addWidget(activity)
        else:
            # Restore left
            splitter.insertWidget(0, sidebar)
            splitter.insertWidget(1, center)
            main_lay = self.centralWidget().layout()
            main_lay.removeWidget(activity)
            main_lay.insertWidget(0, activity)

        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)

    # --- Panel Position --------------------------------

    def _set_panel_position(self, position: str):
        """Reposition the bottom panel: panel_bottom, panel_top, panel_left, panel_right."""
        self._panel_position = position
        panel = self._bottom_panel
        editor_term = self._editor_term_split
        center_chat = self._center_chat_split

        if position == 'panel_bottom':
            # Standard: vertical splitter editor | panel
            editor_term.setOrientation(Qt.Vertical)
            idx = editor_term.indexOf(panel)
            if idx == -1:
                editor_term.addWidget(panel)
            elif idx == 0:
                # It's at top, move to bottom
                editor_term.insertWidget(1, panel)
            editor_term.setStretchFactor(0, 1)
            editor_term.setStretchFactor(1, 0)

        elif position == 'panel_top':
            editor_term.setOrientation(Qt.Vertical)
            idx = editor_term.indexOf(panel)
            if idx == -1:
                editor_term.insertWidget(0, panel)
            elif idx != 0:
                editor_term.insertWidget(0, panel)
            editor_term.setStretchFactor(0, 0)
            editor_term.setStretchFactor(1, 1)

        elif position == 'panel_left':
            editor_term.setOrientation(Qt.Horizontal)
            idx = editor_term.indexOf(panel)
            if idx == -1:
                editor_term.insertWidget(0, panel)
            elif idx != 0:
                editor_term.insertWidget(0, panel)
            editor_term.setStretchFactor(0, 0)
            editor_term.setStretchFactor(1, 1)

        elif position == 'panel_right':
            editor_term.setOrientation(Qt.Horizontal)
            idx = editor_term.indexOf(panel)
            if idx == -1:
                editor_term.addWidget(panel)
            elif idx == 0:
                editor_term.insertWidget(1, panel)
            editor_term.setStretchFactor(0, 1)
            editor_term.setStretchFactor(1, 0)

    def toggle_activity_bar_position(self):
        """Toggle Activity Bar between left and right side of the main layout."""
        layout = self.centralWidget().layout()
        layout.removeWidget(self._activity_bar)
        
        if getattr(self, "_activity_bar_on_right", False):
            layout.insertWidget(0, self._activity_bar)
            self._activity_bar_on_right = False
        else:
            layout.addWidget(self._activity_bar)
            self._activity_bar_on_right = True
