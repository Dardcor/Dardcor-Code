import os
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QTabBar, QPushButton,
    QStackedWidget, QLabel, QMessageBox, QFileDialog
)
from PySide6.QtCore import Signal, Qt

from .widget import MonacoEditorWidget

class EditorTab:
    """Metadata for a single editor tab."""
    def __init__(self, editor: MonacoEditorWidget, file_path: str = None):
        self.editor = editor
        self.file_path = file_path
        self.title = os.path.basename(file_path) if file_path else "Untitled"


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

        self._tab_bar = QTabBar()
        self._tab_bar.setTabsClosable(True)
        self._tab_bar.setMovable(True)
        self._tab_bar.setExpanding(False)
        self._tab_bar.setStyleSheet("""
            QTabBar {
                background: transparent;
                border: none;
            }
            QTabBar::tab {
                background: #000000;
                color: #969696;
                padding: 6px 14px;
                border: none;
                border-right: 1px solid #1a0033;
                min-width: 80px;
                max-width: 180px;
                font-size: 12px;
            }
            QTabBar::tab:selected {
                background: #000000;
                color: #cccccc;
                border-top: 1px solid #007acc;
                border-bottom: none;
            }
            QTabBar::tab:hover:!selected {
                background: #1a0033;
                color: #cccccc;
            }
            QTabBar::close-button {
                subcontrol-position: right;
            }
        """)
        self._tab_bar.tabCloseRequested.connect(self._close_tab)
        self._tab_bar.currentChanged.connect(self._switch_tab)
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

        title = QLabel("Dardcor Code")
        title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet("color: #4a0072; font-size: 42px; font-weight: bold; letter-spacing: 2px;")
        vl.addWidget(title)

        sub = QLabel("Editing evolved")
        sub.setAlignment(Qt.AlignCenter)
        sub.setStyleSheet("color: #555555; font-size: 16px;")
        vl.addWidget(sub)

        vl.addSpacing(24)

        for label, shortcut, action in [
            ("Open File...", "Ctrl+O", None),
            ("Open Folder...", "Ctrl+K", None),
            ("New File", "Ctrl+N", None),
        ]:
            btn = QPushButton(f"{label}  {shortcut}")
            btn.setFixedWidth(260)
            btn.setStyleSheet("""
                QPushButton {
                    background: transparent;
                    color: #4a90d9;
                    border: none;
                    font-size: 14px;
                    text-align: left;
                    padding: 4px 0;
                }
                QPushButton:hover { color: #7ab8f5; }
            """)
            vl.addWidget(btn, alignment=Qt.AlignCenter)

        return w

    def open_file(self, file_path):
        for i, tab in enumerate(self._tabs):
            if tab.file_path == file_path:
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
        idx = self._tab_bar.addTab(title)
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
        idx = self._tab_bar.addTab(title)
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
