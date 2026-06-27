"""Focus Manager for Dardcor Code.
Handles cycling focus between different workbench parts (Editor, Terminal, Sidebar) using F6.
"""

from PySide6.QtCore import QObject

class FocusManager(QObject):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.current_index = -1

    def cycle_focus(self):
        """Cycle focus through the main UI components."""
        # Define the cycle dynamically in case visibility changes
        cycle = []
        
        # 1. Editor
        if self.main_window._editor_tabs.count() > 0:
            cycle.append(self.main_window._editor_tabs.currentWidget())
        
        # 2. Bottom Panel (Terminal, Output, etc.)
        if hasattr(self.main_window, '_bottom_panel') and self.main_window._bottom_panel.isVisible():
            # Try to get the active widget in bottom panel
            active_bottom = self.main_window._bottom_panel.current_widget()
            if active_bottom:
                cycle.append(active_bottom)
            else:
                cycle.append(self.main_window._bottom_panel)
                
        # 3. Sidebar (Explorer, Git, etc.)
        if hasattr(self.main_window, '_sidebar_stack') and self.main_window._sidebar_stack.isVisible():
            cycle.append(self.main_window._sidebar_stack.currentWidget())
            
        # 4. Activity Bar
        if hasattr(self.main_window, '_activity_bar') and self.main_window._activity_bar.isVisible():
            cycle.append(self.main_window._activity_bar)
            
        if not cycle:
            return
            
        # Find current focus to determine next index
        focused = self.main_window.focusWidget()
        self.current_index = -1
        
        for i, widget in enumerate(cycle):
            if widget == focused or widget.isAncestorOf(focused):
                self.current_index = i
                break
                
        self.current_index = (self.current_index + 1) % len(cycle)
        cycle[self.current_index].setFocus()
