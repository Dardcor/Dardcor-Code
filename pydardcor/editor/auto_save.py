"""
Auto Save — TASK-0074
=======================
Configurable auto-save with multiple modes.
Mirip VS Code: src/vs/workbench/services/filesConfiguration/common/filesConfigurationService.ts

Modes:
- off: manual save only
- afterDelay: save after X ms of no changes
- onFocusChange: save when editor loses focus
- onWindowChange: save when window loses focus
"""

from __future__ import annotations

import threading
import time
from enum import Enum
from typing import Callable, Dict, Optional, Set


class AutoSaveMode(Enum):
    OFF = "off"
    AFTER_DELAY = "afterDelay"
    ON_FOCUS_CHANGE = "onFocusChange"
    ON_WINDOW_CHANGE = "onWindowChange"


class AutoSaveService:
    """
    Manages auto-saving of dirty editors.
    """

    DEFAULT_DELAY_MS = 1000

    def __init__(self):
        self._mode = AutoSaveMode.OFF
        self._delay_ms = self.DEFAULT_DELAY_MS
        self._pending: Dict[str, threading.Timer] = {}
        self._save_callback: Optional[Callable[[str], None]] = None
        self._lock = threading.Lock()

    def configure(self, mode: str, delay_ms: int = 1000) -> None:
        """Configure auto-save mode."""
        try:
            self._mode = AutoSaveMode(mode)
        except ValueError:
            self._mode = AutoSaveMode.OFF
        self._delay_ms = max(100, delay_ms)

    def set_save_callback(self, callback: Callable[[str], None]) -> None:
        """Set the function to call when auto-save triggers."""
        self._save_callback = callback

    def on_change(self, uri: str) -> None:
        """Called when a document changes."""
        if self._mode == AutoSaveMode.AFTER_DELAY:
            self._schedule_save(uri)

    def on_editor_blur(self, uri: str) -> None:
        """Called when editor loses focus."""
        if self._mode == AutoSaveMode.ON_FOCUS_CHANGE:
            self._save_now(uri)

    def on_window_blur(self) -> None:
        """Called when the window loses focus."""
        if self._mode == AutoSaveMode.ON_WINDOW_CHANGE:
            # Save all dirty documents
            with self._lock:
                pending = list(self._pending.keys())
            for uri in pending:
                self._save_now(uri)

    def _schedule_save(self, uri: str) -> None:
        """Schedule a delayed save."""
        with self._lock:
            if uri in self._pending:
                self._pending[uri].cancel()
            timer = threading.Timer(
                self._delay_ms / 1000.0,
                self._trigger_save,
                args=[uri],
            )
            self._pending[uri] = timer
            timer.daemon = True
            timer.start()

    def _trigger_save(self, uri: str) -> None:
        with self._lock:
            self._pending.pop(uri, None)
        self._save_now(uri)

    def _save_now(self, uri: str) -> None:
        if self._save_callback:
            try:
                self._save_callback(uri)
            except Exception:
                pass

    def cancel(self, uri: str) -> None:
        """Cancel pending auto-save for a URI."""
        with self._lock:
            timer = self._pending.pop(uri, None)
        if timer:
            timer.cancel()

    def cancel_all(self) -> None:
        with self._lock:
            for timer in self._pending.values():
                timer.cancel()
            self._pending.clear()

    @property
    def mode(self) -> AutoSaveMode:
        return self._mode

    @property
    def delay_ms(self) -> int:
        return self._delay_ms

    def is_enabled(self) -> bool:
        return self._mode != AutoSaveMode.OFF


# Global singleton
_auto_save: Optional[AutoSaveService] = None
_as_lock = threading.Lock()


def get_auto_save_service() -> AutoSaveService:
    global _auto_save
    if _auto_save is None:
        with _as_lock:
            if _auto_save is None:
                _auto_save = AutoSaveService()
    return _auto_save
