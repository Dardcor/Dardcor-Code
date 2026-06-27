"""Centered Layout Manager for Dardcor Code.
Provides a centered editor layout similar to VS Code's Centered Layout Mode.
"""

from PySide6.QtCore import QObject, Qt, QEvent

class CenteredLayoutManager(QObject):
    """Manages the VS Code-style Centered Layout Mode."""

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.is_centered = False
        
        # Install event filter to watch for resize events on the editor container
        if hasattr(self.main_window, '_editor_container'):
            self.main_window._editor_container.installEventFilter(self)

    def toggle(self):
        """Toggle Centered Layout Mode on/off."""
        self.is_centered = not self.is_centered
        self.update_margins()

    def update_margins(self):
        """Update the margins of the editor container based on its width."""
        if not hasattr(self.main_window, '_editor_container'):
            return
            
        container = self.main_window._editor_container
        layout = container.layout()
        if layout is None:
            return

        if not self.is_centered:
            layout.setContentsMargins(0, 0, 0, 0)
        else:
            w = container.width()
            target_w = 900
            if w > target_w + 100:
                margin = (w - target_w) // 2
                layout.setContentsMargins(margin, 0, margin, 0)
            else:
                layout.setContentsMargins(0, 0, 0, 0)

    def eventFilter(self, obj, event):
        if hasattr(self.main_window, '_editor_container') and obj == self.main_window._editor_container:
            if event.type() == QEvent.Resize:
                if self.is_centered:
                    self.update_margins()
        return super().eventFilter(obj, event)
