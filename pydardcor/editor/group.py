import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTabBar, QPushButton,
    QStackedWidget, QLabel, QMessageBox, QFileDialog
)
from PySide6.QtCore import Signal, Qt, QSize
from PySide6.QtGui import QPixmap, QIcon, QPainter, QColor, QFont

from .widget import MonacoEditorWidget
from .diff_viewer import MonacoDiffEditorWidget

# File extension to icon color mapping (VS Code style)
_ICON_COLORS = {
    ".py": "#3572A5",
    ".js": "#F7DF1E",
    ".mjs": "#F7DF1E",
    ".cjs": "#F7DF1E",
    ".jsx": "#61DAFB",
    ".ts": "#3178C6",
    ".tsx": "#3178C6",
    ".html": "#E34F26",
    ".htm": "#E34F26",
    ".css": "#1572B6",
    ".scss": "#CC6699",
    ".less": "#1D365D",
    ".json": "#F5A623",
    ".jsonc": "#F5A623",
    ".md": "#519ABA",
    ".xml": "#F16529",
    ".svg": "#FFB13B",
    ".yaml": "#CB171E",
    ".yml": "#CB171E",
    ".toml": "#9C4121",
    ".ini": "#9C4121",
    ".go": "#00ADD8",
    ".rs": "#DEA584",
    ".java": "#B07219",
    ".cpp": "#F34B7D",
    ".cc": "#F34B7D",
    ".c": "#555555",
    ".h": "#555555",
    ".cs": "#178600",
    ".rb": "#CC342D",
    ".php": "#777BB4",
    ".swift": "#F05138",
    ".kt": "#A97BFF",
    ".dart": "#00B4AB",
    ".lua": "#000080",
    ".sh": "#89E051",
    ".bash": "#89E051",
    ".bat": "#C1F12E",
    ".ps1": "#012456",
    ".sql": "#E38C00",
    ".r": "#198CE7",
    ".vue": "#4FC08D",
    ".dockerfile": "#384D54",
    ".gitignore": "#F05032",
    ".txt": "#888888",
    ".log": "#888888",
}

def _make_file_icon(filename):
    """Create a small colored icon based on file extension."""
    ext = os.path.splitext(filename)[1].lower()
    name_lower = filename.lower()
    color = _ICON_COLORS.get(ext, "#888888")
    if name_lower == ".gitignore":
        color = _ICON_COLORS[".gitignore"]
    elif name_lower == "dockerfile":
        color = _ICON_COLORS[".dockerfile"]

    # Build a 16x16 pixmap with the first letter of extension
    pixmap = QPixmap(16, 16)
    pixmap.fill(QColor(0, 0, 0, 0))  # transparent
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    painter.setBrush(QColor(color))
    painter.setPen(Qt.NoPen)
    painter.drawRoundedRect(1, 1, 14, 14, 3, 3)
    # Draw letter
    painter.setPen(QColor("#ffffff"))
    font = QFont("Segoe UI", 8, QFont.Bold)
    painter.setFont(font)
    letter = ext[1:2].upper() if ext else "?"
    painter.drawText(pixmap.rect(), Qt.AlignCenter, letter)
    painter.end()
    return QIcon(pixmap)


class EditorTab:
    """Metadata for a single editor tab."""
    def __init__(self, editor: MonacoEditorWidget, file_path: str = None):
        self.editor = editor
        self.file_path = file_path
        self.title = os.path.basename(file_path) if file_path else "Untitled"


class DardcorTabBar(QTabBar):
    """Custom tab bar that shows close button only on selected/hovered tabs."""
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._hovered_tab = -1
        self.setMouseTracking(True)
        self.setTabsClosable(True)
        self.setMovable(True)
        self.setExpanding(False)
        self.setIconSize(QSize(16, 16))
        self.setStyleSheet("""
            QTabBar {
                background: transparent;
                border: none;
            }
            QTabBar::tab {
                background: #0d0d0d;
                color: #969696;
                padding: 6px 12px 6px 8px;
                border: none;
                border-right: 1px solid #1a0033;
                min-width: 80px;
                max-width: 200px;
                font-size: 12px;
            }
            QTabBar::tab:selected {
                background: #000000;
                color: #cccccc;
                border-top: 2px solid #007acc;
                border-bottom: none;
            }
            QTabBar::tab:hover:!selected {
                background: #1a0033;
                color: #cccccc;
            }
            QTabBar::close-button {
                background: transparent;
                border: none;
                padding: 0px;
                margin: 2px;
                subcontrol-position: right;
            }
            QTabBar::close-button:hover {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 3px;
            }
        """)
    
    def tabInserted(self, index):
        super().tabInserted(index)
        self._update_close_buttons()
    
    def tabRemoved(self, index):
        super().tabRemoved(index)
        self._update_close_buttons()
    
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
    
    def _update_close_buttons(self):
        """Show close button only on selected or hovered tab."""
        current = self.currentIndex()
        for i in range(self.count()):
            btn = self.tabButton(i, QTabBar.RightSide)
            if btn:
                if i == current or i == self._hovered_tab:
                    btn.setFixedSize(16, 16)
                    btn.show()
                else:
                    btn.setFixedSize(0, 0)
                    btn.hide()


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
        tab_row = QWidget()
        tab_row.setFixedHeight(35)
        tab_row.setStyleSheet("background-color: #000000;")
        row_layout = QHBoxLayout(tab_row)
        row_layout.setContentsMargins(0, 0, 0, 0)
        row_layout.setSpacing(0)

        self._tab_bar = DardcorTabBar()
        self._tab_bar.tabCloseRequested.connect(self._close_tab)
        self._tab_bar.currentChanged.connect(self._on_tab_changed)
        row_layout.addWidget(self._tab_bar)
        row_layout.addStretch()

        layout.addWidget(tab_row)

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
        icon = _make_file_icon(title)
        idx = self._tab_bar.addTab(icon, title)
        self._tab_bar.setCurrentIndex(idx)
        self._stack.setCurrentWidget(editor)
        self._current_idx = idx
        self._emit_tab_changed(editor)
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

        icon = _make_file_icon(os.path.basename(file_path))
        idx = self._tab_bar.addTab(icon, tab.title)
        self._tab_bar.setCurrentIndex(idx)
        self._stack.setCurrentWidget(editor)
        self._current_idx = idx
        self._emit_tab_changed(editor)
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
        idx = self._tab_bar.addTab(_make_file_icon("untitled.txt"), title)
        self._tab_bar.setCurrentIndex(idx)
        self._stack.setCurrentWidget(editor)
        self._current_idx = idx
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

        if not self._tabs:
            self._stack.setCurrentWidget(self._welcome)
            self._current_idx = -1

    def _on_tab_changed(self, idx):
        self._switch_tab(idx)
        self._tab_bar._update_close_buttons()

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
