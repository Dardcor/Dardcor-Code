from PySide6.QtWidgets import QWidget, QVBoxLayout
from PySide6.QtCore import Signal, Qt

from .group import EditorGroup
from ..windows.grid_layout import GridLayoutSystem

class EditorTabs(QWidget):
    """Manager for multiple EditorGroups, allowing grid layout split views."""

    tab_changed = Signal(str, str)
    dirty_changed = Signal(bool)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._layout = QVBoxLayout(self)
        self._layout.setContentsMargins(0, 0, 0, 0)
        self._layout.setSpacing(0)
        
        self.grid_system = GridLayoutSystem(self)
        self._layout.addWidget(self.grid_system)
        
        self._groups = []
        self._active_group_idx = 0
        
        # Add the first group
        first_group = EditorGroup(self)
        first_group.tab_changed.connect(self.tab_changed.emit)
        first_group.dirty_changed.connect(self.dirty_changed.emit)
        self._groups.append(first_group)
        self.grid_system.set_central_widget(first_group)

    def _add_group(self):
        group = EditorGroup(self)
        group.tab_changed.connect(self.tab_changed.emit)
        group.dirty_changed.connect(self.dirty_changed.emit)
        self._groups.append(group)
        return group

    def split_editor(self, direction="right"):
        """Split the current editor group in the specified direction ('up', 'down', 'left', 'right')."""
        if not self._groups:
            first = self._add_group()
            self.grid_system.set_central_widget(first)
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
        
        self.grid_system.split(current, new_group, direction)

    def active_group(self):
        if 0 <= self._active_group_idx < len(self._groups):
            return self._groups[self._active_group_idx]
        return self._groups[0] if self._groups else None

    def get_open_files(self) -> list:
        files = []
        for g in self._groups:
            for tab in g._tabs:
                if tab.file_path and tab.file_path not in files:
                    files.append(tab.file_path)
        return files

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

    def add_custom_tab(self, widget, title, icon=None):
        g = self.active_group()
        if g: return g.add_custom_tab(widget, title, icon)
        return None

    def save_current(self):
        g = self.active_group()
        if g: g.save_current()

    def save_all(self, is_auto_save=False):
        for g in self._groups:
            g.save_all(is_auto_save)

    def close_current(self):
        g = self.active_group()
        if g: g.close_current()

    def close_all(self):
        for g in list(self._groups):
            if hasattr(g, "close_all") and not g.close_all():
                return False
        return True

    def mount_breadcrumbs(self, bar):
        """Mount the shared BreadcrumbsBar into the active editor group."""
        group = self.active_group()
        if group:
            group.mount_breadcrumbs(bar)

    def refresh_welcome_recent(self):
        for g in self._groups:
            if hasattr(g, "refresh_welcome_recent"):
                g.refresh_welcome_recent()

    def open_file_at_line(self, file_path, line):
        g = self.active_group()
        if g: g.open_file_at_line(file_path, line)

    def activate_tab_by_key(self, tab_key: str) -> bool:
        for gi, g in enumerate(self._groups):
            for ti, tab in enumerate(g._tabs):
                key = tab.file_path or f"__untitled__:{gi}:{ti}"
                if key == tab_key:
                    self._active_group_idx = gi
                    g._tab_bar.setCurrentIndex(ti)
                    return True
        return False

    def get_tab_entries(self) -> list:
        entries = []
        for gi, g in enumerate(self._groups):
            for ti, tab in enumerate(g._tabs):
                entries.append({
                    "key": tab.file_path or f"__untitled__:{gi}:{ti}",
                    "title": tab.title or "Untitled",
                })
        return entries

    def set_font_size(self, size):
        for g in self._groups: g.set_font_size(size)

    def set_word_wrap(self, enabled):
        for g in self._groups: g.set_word_wrap(enabled)

    def set_minimap(self, enabled):
        for g in self._groups: g.set_minimap(enabled)

    def refresh_extension_context_menus(self):
        for g in self._groups:
            for tab in getattr(g, "_tabs", []):
                editor = getattr(tab, "editor", None)
                if editor and hasattr(editor, "refresh_extension_context_menu"):
                    editor.refresh_extension_context_menu()

    def set_theme(self, theme_name: str):
        is_dark = (theme_name != "light")
        for g in self._groups: g.set_theme(is_dark)

    def set_custom_theme(self, theme_data):
        from .widget import set_global_custom_theme
        set_global_custom_theme(theme_data)
        for g in self._groups:
            if hasattr(g, "set_custom_theme"):
                g.set_custom_theme(theme_data)

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

    def toggle_inline_diff(self, inline: bool):
        for g in self._groups:
            for tab in g._tabs:
                from .diff_viewer import MonacoDiffEditorWidget
                if isinstance(tab.editor, MonacoDiffEditorWidget):
                    tab.editor.toggle_inline_view(inline)
