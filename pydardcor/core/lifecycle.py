"""
Lifecycle Management — TASK-0011
=================================
Application lifecycle dengan startup, ready, dan shutdown phases.
Mirip VS Code: src/vs/platform/lifecycle/common/lifecycle.ts

Phases: Starting → Ready → ShuttingDown → Quit
"""

from __future__ import annotations

import sys
import threading
import atexit
from enum import Enum
from typing import Callable, Dict, List, Optional


class LifecyclePhase(Enum):
    STARTING = "starting"
    READY = "ready"
    SHUTTING_DOWN = "shuttingDown"
    QUIT = "quit"


class ShutdownReason(Enum):
    QUIT = "quit"
    RELOAD = "reload"
    LOAD = "load"
    CLOSE = "close"


class WillShutdownEvent:
    def __init__(self, reason: ShutdownReason):
        self.reason = reason
        self._vetoes: List[str] = []
        self._callbacks: List[Callable[[], None]] = []

    def veto(self, reason: str) -> None:
        """Veto the shutdown (e.g., unsaved files)."""
        self._vetoes.append(reason)

    def join(self, callback: Callable[[], None]) -> None:
        """Register async operation to complete before shutdown."""
        self._callbacks.append(callback)

    @property
    def vetoed(self) -> bool:
        return len(self._vetoes) > 0

    @property
    def veto_reasons(self) -> List[str]:
        return self._vetoes[:]

    def run_callbacks(self) -> None:
        for cb in self._callbacks:
            try:
                cb()
            except Exception:
                pass


class LifecycleService:
    """
    Application lifecycle manager.
    Handles phase transitions and shutdown veto.
    """

    def __init__(self):
        self._phase = LifecyclePhase.STARTING
        self._lock = threading.RLock()
        self._phase_listeners: Dict[LifecyclePhase, List[Callable]] = {
            p: [] for p in LifecyclePhase
        }
        self._will_shutdown_listeners: List[Callable[[WillShutdownEvent], None]] = []
        self._did_shutdown_listeners: List[Callable] = []
        atexit.register(self._atexit_shutdown)

    @property
    def phase(self) -> LifecyclePhase:
        with self._lock:
            return self._phase

    def set_phase(self, phase: LifecyclePhase) -> None:
        """Advance to a lifecycle phase."""
        with self._lock:
            if self._phase == phase:
                return
            self._phase = phase

        for cb in self._phase_listeners.get(phase, []):
            try:
                cb()
            except Exception:
                pass

    def when(self, phase: LifecyclePhase, callback: Callable) -> None:
        """Register a callback that fires when a phase is entered."""
        with self._lock:
            current = self._phase
        # If already in or past this phase, fire immediately
        phases = list(LifecyclePhase)
        if phases.index(phase) <= phases.index(current):
            try:
                callback()
            except Exception:
                pass
        else:
            self._phase_listeners[phase].append(callback)

    def on_will_shutdown(self, callback: Callable[[WillShutdownEvent], None]) -> None:
        self._will_shutdown_listeners.append(callback)

    def on_did_shutdown(self, callback: Callable) -> None:
        self._did_shutdown_listeners.append(callback)

    def request_quit(self, reason: ShutdownReason = ShutdownReason.QUIT) -> bool:
        """
        Initiate application shutdown.
        Returns False if vetoed (e.g., unsaved changes).
        """
        event = WillShutdownEvent(reason)
        for cb in self._will_shutdown_listeners:
            try:
                cb(event)
            except Exception:
                pass

        if event.vetoed:
            return False

        event.run_callbacks()
        self.set_phase(LifecyclePhase.SHUTTING_DOWN)

        for cb in self._did_shutdown_listeners:
            try:
                cb()
            except Exception:
                pass

        self.set_phase(LifecyclePhase.QUIT)
        return True

    def _atexit_shutdown(self) -> None:
        """Called by atexit if not already shut down."""
        if self._phase not in (LifecyclePhase.SHUTTING_DOWN, LifecyclePhase.QUIT):
            self.request_quit(ShutdownReason.QUIT)

    def is_ready(self) -> bool:
        return self._phase in (LifecyclePhase.READY,)

    def mark_ready(self) -> None:
        """Mark the application as fully started."""
        self.set_phase(LifecyclePhase.READY)


# Global singleton
_lifecycle: Optional[LifecycleService] = None
_lc_lock = threading.Lock()


def get_lifecycle_service() -> LifecycleService:
    global _lifecycle
    if _lifecycle is None:
        with _lc_lock:
            if _lifecycle is None:
                _lifecycle = LifecycleService()
    return _lifecycle


def reset_lifecycle_service() -> None:
    global _lifecycle
    with _lc_lock:
        _lifecycle = None
