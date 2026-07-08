"""
Multi-Window Support — TASK-0016
==================================
Manages multiple independent editor windows.
Mirip VS Code: src/vs/workbench/electron-main/window.ts
"""

from __future__ import annotations

import os
import threading
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from pydardcor.app.main_window import MainWindow


class WindowState:
    """Saved state of a window (position, size, maximized, workspace)."""

    def __init__(self):
        self.x: int = 100
        self.y: int = 100
        self.width: int = 1280
        self.height: int = 800
        self.maximized: bool = False
        self.workspace_path: str = ""
        self.zoom_level: int = 0

    def to_dict(self) -> dict:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "maximized": self.maximized,
            "workspace_path": self.workspace_path,
            "zoom_level": self.zoom_level,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WindowState":
        ws = cls()
        ws.x = data.get("x", 100)
        ws.y = data.get("y", 100)
        ws.width = data.get("width", 1280)
        ws.height = data.get("height", 800)
        ws.maximized = data.get("maximized", False)
        ws.workspace_path = data.get("workspace_path", "")
        ws.zoom_level = data.get("zoom_level", 0)
        return ws


class MultiWindowManager:
    """
    Manages lifecycle of multiple editor windows.
    Mirrors VS Code's IWindowsMainService.
    """

    def __init__(self):
        self._windows: Dict[int, "MainWindow"] = {}
        self._lock = threading.RLock()
        self._window_factory: Optional[Callable[[Optional[str]], "MainWindow"]] = None
        self._active_window_id: Optional[int] = None
        self._listeners: List[Callable[[str, int], None]] = []  # (event, window_id)

    def set_factory(self, factory: Callable[[Optional[str]], "MainWindow"]) -> None:
        """Set the factory function that creates new windows."""
        self._window_factory = factory

    def open_window(self, workspace_path: Optional[str] = None, state: Optional[WindowState] = None) -> Optional["MainWindow"]:
        """Open a new window, optionally with a workspace."""
        if self._window_factory is None:
            return None

        win = self._window_factory(workspace_path)

        if state:
            self._apply_state(win, state)

        win_id = id(win)
        with self._lock:
            self._windows[win_id] = win

        # Connect closed signal
        try:
            win.destroyed.connect(lambda: self._on_window_destroyed(win_id))
        except Exception:
            pass

        self._notify("open", win_id)
        return win

    def close_window(self, window_id: int) -> bool:
        """Close a window by its ID."""
        with self._lock:
            win = self._windows.get(window_id)
        if win:
            try:
                win.close()
            except Exception:
                pass
            return True
        return False

    def _on_window_destroyed(self, window_id: int) -> None:
        with self._lock:
            self._windows.pop(window_id, None)
            if self._active_window_id == window_id:
                if self._windows:
                    self._active_window_id = next(iter(self._windows))
                else:
                    self._active_window_id = None
        self._notify("close", window_id)

    def get_focused_window(self) -> Optional["MainWindow"]:
        """Return the currently focused window."""
        with self._lock:
            return self._windows.get(self._active_window_id)

    def get_all_windows(self) -> List["MainWindow"]:
        with self._lock:
            return list(self._windows.values())

    def get_window_count(self) -> int:
        with self._lock:
            return len(self._windows)

    def set_active_window(self, window_id: int) -> None:
        with self._lock:
            self._active_window_id = window_id

    def _apply_state(self, win: "MainWindow", state: WindowState) -> None:
        """Apply a saved window state."""
        try:
            from PySide6.QtCore import QRect
            from PySide6.QtWidgets import QApplication
            screen = QApplication.primaryScreen()
            if screen:
                geo = screen.availableGeometry()
                # Clamp to screen
                x = max(0, min(state.x, geo.width() - 200))
                y = max(0, min(state.y, geo.height() - 100))
                win.setGeometry(x, y, state.width, state.height)
            if state.maximized:
                win.showMaximized()
        except Exception:
            pass

    def save_states(self) -> List[dict]:
        """Save state of all windows."""
        states = []
        with self._lock:
            for win in self._windows.values():
                try:
                    state = WindowState()
                    geo = win.geometry()
                    state.x = geo.x()
                    state.y = geo.y()
                    state.width = geo.width()
                    state.height = geo.height()
                    state.maximized = win.isMaximized()
                    states.append(state.to_dict())
                except Exception:
                    pass
        return states

    def on_window_event(self, callback: Callable[[str, int], None]) -> None:
        self._listeners.append(callback)

    def _notify(self, event: str, window_id: int) -> None:
        for cb in self._listeners:
            try:
                cb(event, window_id)
            except Exception:
                pass


# Global singleton
_multi_window_manager: Optional[MultiWindowManager] = None
_mwm_lock = threading.Lock()


def get_multi_window_manager() -> MultiWindowManager:
    global _multi_window_manager
    if _multi_window_manager is None:
        with _mwm_lock:
            if _multi_window_manager is None:
                _multi_window_manager = MultiWindowManager()
    return _multi_window_manager
