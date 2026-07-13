"""Focus Manager for Dardcor Code.
Handles cycling focus between different workbench parts (Editor, Terminal, Sidebar) using F6,
and Focus Mode which toggles sidebar/panel visibility for distraction-free editing.
"""

from PySide6.QtCore import QObject

class FocusManager(QObject):
    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.current_index = -1
        self._focus_mode = False
        self._saved_sidebar_visible = True
        self._saved_panel_visible = True

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

    def toggle_focus_mode(self):
        """Toggle Focus Mode - hide sidebar and panel for distraction-free editing."""
        self._focus_mode = not self._focus_mode
        
        if self._focus_mode:
            self._enter_focus_mode()
        else:
            self._exit_focus_mode()

    def _enter_focus_mode(self):
        """Save visibility states and hide sidebar and panel."""
        mw = self.main_window
        
        if hasattr(mw, '_sidebar_stack'):
            self._saved_sidebar_visible = mw._sidebar_stack.isVisible()
            mw._sidebar_stack.hide()
        
        if hasattr(mw, '_bottom_panel'):
            self._saved_panel_visible = mw._bottom_panel.isVisible()
            mw._bottom_panel.hide()
        
        if hasattr(mw, '_activity_bar'):
            mw._activity_bar.hide()
        
        if hasattr(mw, '_status_bar'):
            mw._status_bar.hide()

    def _exit_focus_mode(self):
        """Restore saved visibility states."""
        mw = self.main_window
        
        if hasattr(mw, '_sidebar_stack'):
            mw._sidebar_stack.setVisible(self._saved_sidebar_visible)
        
        if hasattr(mw, '_bottom_panel'):
            mw._bottom_panel.setVisible(self._saved_panel_visible)
        
        if hasattr(mw, '_activity_bar'):
            mw._activity_bar.show()
        
        if hasattr(mw, '_status_bar'):
            mw._status_bar.show()

    def is_focus_mode(self) -> bool:
        return self._focus_mode
