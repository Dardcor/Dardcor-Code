from PySide6.QtWidgets import QWidget, QHBoxLayout, QSplitter
from PySide6.QtCore import Signal, Qt

from .group import EditorGroup

class EditorTabs(QWidget):
    """Manager for multiple EditorGroups, allowing split views."""

    tab_changed = Signal(str, str)
    dirty_changed = Signal(bool)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._layout = QHBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(0)
        
        self._splitter = QSplitter(Qt.Horizontal)
        self._splitter.setHandleWidth(1)
        self._splitter.setStyleSheet("""
            QSplitter::handle {
                background-color: #1a0033;
            }
            QSplitter::handle:hover {
                background-color: #4a0072;
            }
        """)
        self._layout.addWidget(self._splitter)
        
        self._groups = []
        self._active_group_idx = 0
        
        self._add_group()

    def _add_group(self):
        group = EditorGroup(self)
        group.tab_changed.connect(self.tab_changed.emit)
        group.dirty_changed.connect(self.dirty_changed.emit)
        self._groups.append(group)
        self._splitter.addWidget(group)
        return group

    def split_editor(self, direction="right"):
        """Split the current editor group."""
        if not self._groups:
            self._add_group()
            return
            
        current = self.active_group()
        ed = current.current_editor()
        
        new_group = self._add_group()
        if ed and ed.get_file_path():
            new_group.open_file(ed.get_file_path())
        elif ed:
            # Clone content if untitled
            new_ed = new_group.new_file()
            new_ed.set_content(ed.get_content(), ed.get_language())
            
        self._active_group_idx = self._groups.index(new_group)
        
        # Adjust sizes evenly
        count = len(self._groups)
        width = self.width() // count if count > 0 else 100
        self._splitter.setSizes([width] * count)

    def active_group(self):
        if 0 <= self._active_group_idx < len(self._groups):
            return self._groups[self._active_group_idx]
        return self._groups[0] if self._groups else None

    # Delegate methods to active group
    def open_file(self, file_path):
        g = self.active_group()
        return g.open_file(file_path) if g else None

    def open_diff(self, file_path, original_content, modified_content):
        g = self.active_group()
        return g.open_diff(file_path, original_content, modified_content) if g else None

    def new_file(self):
        g = self.active_group()
        return g.new_file() if g else None

    def current_editor(self):
        g = self.active_group()
        return g.current_editor() if g else None

    def save_current(self):
        g = self.active_group()
        if g: g.save_current()

    def save_all(self):
        for g in self._groups:
            g.save_all()

    def close_current(self):
        g = self.active_group()
        if g: g.close_current()

    def open_file_at_line(self, file_path, line):
        g = self.active_group()
        if g: g.open_file_at_line(file_path, line)

    def set_font_size(self, size):
        for g in self._groups: g.set_font_size(size)

    def set_word_wrap(self, enabled):
        for g in self._groups: g.set_word_wrap(enabled)

    def set_theme(self, theme_name: str):
        is_dark = (theme_name != "light")
        for g in self._groups: g.set_theme(is_dark)

    def trigger_find(self):
        g = self.active_group()
        if g: g.trigger_find()

    def trigger_find_replace(self):
        g = self.active_group()
        if g: g.trigger_find_replace()

    def trigger_format(self):
        g = self.active_group()
        if g: g.trigger_format()

    def show_debug_toolbar(self, show: bool):
        for g in self._groups: g.show_debug_toolbar(show)

    def expand_selection(self):
        g = self.active_group()
        if g: g.expand_selection()

    def shrink_selection(self):
        g = self.active_group()
        if g: g.shrink_selection()

    def copy_line_up(self):
        g = self.active_group()
        if g: g.copy_line_up()

    def copy_line_down(self):
        g = self.active_group()
        if g: g.copy_line_down()

    def go_to_definition(self):
        g = self.active_group()
        if g: g.go_to_definition()

    def toggle_breakpoint(self):
        g = self.active_group()
        if g: g.toggle_breakpoint()
