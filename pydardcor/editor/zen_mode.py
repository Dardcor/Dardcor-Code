"""Zen Mode Manager for Dardcor Code.
Provides a distraction-free full-screen editor layout.
"""

from PySide6.QtCore import QObject, Qt, QEvent
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import QPushButton


class ExitZenButton(QPushButton):
    """Floating button to exit Zen Mode manually."""

    def __init__(self, parent=None):
        super().__init__("Exit Zen Mode (Esc)", parent)
        self.setFixedSize(160, 30)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QPushButton {
                background-color: rgba(30, 0, 50, 0.8);
                color: #d4b8ff;
                border: 1px solid #3c0068;
                border-radius: 15px;
                font-size: 11px;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(60, 0, 100, 0.95);
                border: 1px solid #8c00e8;
                color: #ffffff;
            }
        """)


class ZenModeManager(QObject):
    """Manages the VS Code-style distraction-free Zen Mode."""

    def __init__(self, main_window):
        super().__init__(main_window)
        self.main_window = main_window
        self.is_zen_active = False

        # Saved state to restore later
        self.saved_geometry = None
        self.was_maximized = False
        self.saved_visibilities = {}

        # Toggle Shortcut: Ctrl+K Z
        self.toggle_shortcut = QShortcut(QKeySequence("Ctrl+K, Z"), self.main_window)
        self.toggle_shortcut.activated.connect(self.toggle_zen_mode)

        # Esc Shortcut to exit (active only during Zen Mode)
        self.esc_shortcut = QShortcut(QKeySequence(Qt.Key_Escape), self.main_window)
        self.esc_shortcut.activated.connect(self.exit_zen_mode)
        self.esc_shortcut.setEnabled(False)

        # Floating Exit Button
        self.exit_btn = ExitZenButton(self.main_window)
        self.exit_btn.clicked.connect(self.exit_zen_mode)
        self.exit_btn.hide()

        # Monitor window resize/key events via event filter
        self.main_window.installEventFilter(self)

    def eventFilter(self, obj, event):
        if obj == self.main_window:
            if event.type() == QEvent.Resize:
                if self.is_zen_active:
                    self.reposition_exit_button()
            elif event.type() == QEvent.KeyPress:
                if event.key() == Qt.Key_Escape and self.is_zen_active:
                    self.exit_zen_mode()
                    return True
        return super().eventFilter(obj, event)

    def reposition_exit_button(self):
        """Keep the exit button centered at the top of the main window."""
        if self.exit_btn and self.is_zen_active:
            x = (self.main_window.width() - self.exit_btn.width()) // 2
            y = 15
            self.exit_btn.move(x, y)
            self.exit_btn.raise_()

    def toggle_zen_mode(self):
        """Toggle Zen Mode on/off."""
        if self.is_zen_active:
            self.exit_zen_mode()
        else:
            self.enter_zen_mode()

    def enter_zen_mode(self):
        """Enter full-screen distraction-free mode."""
        if self.is_zen_active:
            return

        self.is_zen_active = True

        # Store window state
        self.was_maximized = self.main_window.isMaximized()
        self.saved_geometry = self.main_window.geometry()

        # Track and hide panels
        panels = {
            '_title_bar': getattr(self.main_window, '_title_bar', None),
            '_activity_bar': getattr(self.main_window, '_activity_bar', None),
            '_sidebar_stack': getattr(self.main_window, '_sidebar_stack', None),
            '_status_bar': getattr(self.main_window, '_status_bar', None),
            '_chat_panel': getattr(self.main_window, '_chat_panel', None),
            '_bottom_panel': getattr(self.main_window, '_bottom_panel', None),
        }

        self.saved_visibilities.clear()
        for name, widget in panels.items():
            if widget is not None:
                self.saved_visibilities[name] = widget.isVisible()
                widget.setVisible(False)

        # Trigger true full screen
        self.main_window.showFullScreen()

        # Show exit floating indicator and enable Esc shortcut
        self.esc_shortcut.setEnabled(True)
        self.exit_btn.show()
        self.reposition_exit_button()

    def exit_zen_mode(self):
        """Exit Zen Mode and restore original layout and geometry."""
        if not self.is_zen_active:
            return

        self.is_zen_active = False

        # Hide exit indicator and disable Esc shortcut
        self.exit_btn.hide()
        self.esc_shortcut.setEnabled(False)

        # Restore window state
        if self.was_maximized:
            self.main_window.showMaximized()
        else:
            self.main_window.showNormal()
            if self.saved_geometry:
                self.main_window.setGeometry(self.saved_geometry)

        # Restore panels to their previous visibility
        panels = {
            '_title_bar': getattr(self.main_window, '_title_bar', None),
            '_activity_bar': getattr(self.main_window, '_activity_bar', None),
            '_sidebar_stack': getattr(self.main_window, '_sidebar_stack', None),
            '_status_bar': getattr(self.main_window, '_status_bar', None),
            '_chat_panel': getattr(self.main_window, '_chat_panel', None),
            '_bottom_panel': getattr(self.main_window, '_bottom_panel', None),
        }

        for name, widget in panels.items():
            if widget is not None and name in self.saved_visibilities:
                widget.setVisible(self.saved_visibilities[name])

        # Sync layout toggle button states
        if hasattr(self.main_window, '_sync_toggle_states'):
            self.main_window._sync_toggle_states()
