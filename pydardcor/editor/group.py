import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTabBar, QPushButton,
    QStackedWidget, QLabel, QMessageBox, QFileDialog
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


class DardcorTabBar(QTabBar):
    """Custom tab bar that shows close button only on selected/hovered tabs."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._hovered_tab = -1
        self.setMouseTracking(True)
        self.setTabsClosable(True)
        self.setMovable(True)
        self.setExpanding(False)
        self.setDrawBase(False)
        self.setElideMode(Qt.ElideRight)
        self.setIconSize(QSize(16, 16))
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
                max-width: 220px;
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

    def tabSizeHint(self, index):
        base_size = super().tabSizeHint(index)
        text = self.tabText(index)
        fm = self.fontMetrics()
        if hasattr(fm, 'horizontalAdvance'):
            text_width = fm.horizontalAdvance(text)
        else:
            text_width = fm.boundingRect(text).width()
        
        icon = self.tabIcon(index)
        icon_width = 0
        if not icon.isNull():
            icon_width = self.iconSize().width() + 6  # Icon + spacing
            
        btn = self.tabButton(index, QTabBar.RightSide)
        btn_width = 0
        if btn:
            btn_width = btn.width() + 4  # Button + spacing
        else:
            btn_width = 22 + 4  # Fallback based on 22px button size
            
        padding_left = 10
        padding_right = 6
        
        width = padding_left + icon_width + text_width + btn_width + padding_right
        width = min(max(width, 80), 220)
        return QSize(width, base_size.height())
        
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
        
    def _handle_close_clicked(self, btn):
        for i in range(self.count()):
            if self.tabButton(i, QTabBar.RightSide) is btn or self.tabButton(i, QTabBar.LeftSide) is btn:
                self.tabCloseRequested.emit(i)
                return
                
    def _update_close_buttons(self):
        current = self.currentIndex()
        for i in range(self.count()):
            btn = self.tabButton(i, QTabBar.RightSide) or self.tabButton(i, QTabBar.LeftSide)
            if btn and isinstance(btn, TabCloseButton):
                if i == current or i == self._hovered_tab:
                    btn.setVisible(True)
                else:
                    btn.setVisible(False)


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
        self._tab_row.hide()
        row_layout = QHBoxLayout(self._tab_row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(0)

        self._tab_bar = DardcorTabBar()
        self._tab_bar.tabCloseRequested.connect(self._close_tab)
        self._tab_bar.currentChanged.connect(self._on_tab_changed)
        row_layout.addWidget(self._tab_bar)

        layout.addWidget(self._tab_row)

        self._stack = QStackedWidget()
        layout.addWidget(self._stack)

        # Welcome screen
        self._welcome = self._make_welcome()
        self._stack.addWidget(self._welcome)
        self._stack.setCurrentWidget(self._welcome)

    def _make_welcome(self):
        w = QWidget()
        w.setStyleSheet("background-color: #000000;")
        vl = QVBoxLayout(w)
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

        for label, shortcut, action in [
            ("Open File...", "Ctrl+O", None),
            ("Open Folder...", "Ctrl+K", None),
            ("New File", "Ctrl+N", None),
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
            btn_layout.addWidget(btn)

        h_layout.addWidget(btn_container)
        h_layout.addStretch()

        vl.addWidget(wrapper)

        return w

    def _update_tab_row_visibility(self):
        has_tabs = len(self._tabs) > 0
        self._tab_row.setVisible(has_tabs)

    def open_file(self, file_path):
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path and not isinstance(tab.editor, MonacoDiffEditorWidget):
                self._tab_bar.setCurrentIndex(i)
                return tab.editor

        editor = MonacoEditorWidget(self)
        editor.open_file(file_path)
        editor.content_changed.connect(lambda c: self._on_content_changed(editor))
        editor.save_requested.connect(lambda: self._save_editor(editor))

        tab = EditorTab(editor, file_path)
        self._tabs.append(tab)
        self._stack.addWidget(editor)

        title = os.path.basename(file_path)
        icon = get_file_icon(file_path)
        idx = self._tab_bar.addTab(icon, title)
        self._tab_bar.setCurrentIndex(idx)
        self._stack.setCurrentWidget(editor)
        self._current_idx = idx
        self._emit_tab_changed(editor)
        self._update_tab_row_visibility()
        return editor

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
            title = self._tabs[idx].title
            if not title.startswith("● "):
                self._tab_bar.setTabText(idx, "● " + title)
        self.dirty_changed.emit(True)

    def _save_editor(self, editor):
        idx = self._editor_index(editor)
        if idx < 0:
            return
        tab = self._tabs[idx]
        if tab.file_path:
            editor.save()
            self._tab_bar.setTabText(idx, tab.title)
        else:
            path, _ = QFileDialog.getSaveFileName(self, "Save File As")
            if path:
                tab.file_path = path
                tab.title = os.path.basename(path)
                editor.save_as(path)
                self._tab_bar.setTabText(idx, tab.title)
                self._tab_bar.setTabIcon(idx, get_file_icon(path))
        self.dirty_changed.emit(False)

    def _close_tab(self, idx):
        if idx < 0 or idx >= len(self._tabs):
            return
        tab = self._tabs[idx]
        if tab.editor.is_dirty():
            result = QMessageBox.question(
                self, "Unsaved Changes",
                f"Save changes to '{tab.title}' before closing?",
                QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel
            )
            if result == QMessageBox.Cancel:
                return
            if result == QMessageBox.Save:
                self._save_editor(tab.editor)

        self._stack.removeWidget(tab.editor)
        tab.editor.deleteLater()
        self._tabs.pop(idx)
        self._tab_bar.removeTab(idx)
        self._update_tab_row_visibility()

        if not self._tabs:
            self._stack.setCurrentWidget(self._welcome)
            self._current_idx = -1
            self.tab_changed.emit("", "")

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

    def save_all(self):
        for i, tab in enumerate(self._tabs):
            if tab.editor.is_dirty():
                self._save_editor(tab.editor)

    def close_current(self):
        if self._current_idx >= 0:
            self._close_tab(self._current_idx)

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
            tab.editor.set_word_wrap(enabled)

    def set_theme(self, is_dark: bool):
        for tab in self._tabs:
            if hasattr(tab.editor, "set_theme"):
                tab.editor.set_theme(is_dark)

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
