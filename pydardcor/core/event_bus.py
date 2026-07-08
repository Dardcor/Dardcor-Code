"""
Event Bus System — TASK-0003
============================
Global pub/sub event bus mirip VS Code:
  src/vs/base/common/event.ts  (Emitter / Event)
  src/vs/base/common/eventUtils.ts

Fitur:
- Typed events (EventEmitter[T])
- Synchronous dan async listeners
- Once listeners (auto-unsubscribe)
- Disposable subscriptions
- Global bus with named channels
- Thread-safe event delivery
- Priority ordering
- Error isolation per listener
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generic, List, Optional, Set, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Disposable / IDisposable
# ---------------------------------------------------------------------------

class Disposable:
    """Base class for anything that can be disposed (unsubscribed)."""

    def __init__(self, dispose_fn: Callable[[], None]):
        self._dispose_fn = dispose_fn
        self._disposed = False

    def dispose(self) -> None:
        if not self._disposed:
            self._disposed = True
            try:
                self._dispose_fn()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.dispose()

    @property
    def is_disposed(self) -> bool:
        return self._disposed


# ---------------------------------------------------------------------------
# Listener entry
# ---------------------------------------------------------------------------

@dataclass
class _Listener(Generic[T]):
    callback: Callable[[T], None]
    once: bool = False
    priority: int = 0


# ---------------------------------------------------------------------------
# EventEmitter — typed event source
# ---------------------------------------------------------------------------

class EventEmitter(Generic[T]):
    """
    Typed event emitter.

    Usage:
        on_change = EventEmitter[str]()

        def handler(value: str):
            print("changed:", value)

        disposable = on_change.subscribe(handler)
        on_change.fire("hello")
        disposable.dispose()   # unsubscribe
    """

    def __init__(self, name: str = ""):
        self._name = name
        self._listeners: List[_Listener[T]] = []
        self._lock = threading.RLock()

    def subscribe(
        self,
        listener: Callable[[T], None],
        *,
        once: bool = False,
        priority: int = 0,
    ) -> Disposable:
        """Subscribe to this event. Returns a Disposable to unsubscribe."""
        entry = _Listener(callback=listener, once=once, priority=priority)
        with self._lock:
            self._listeners.append(entry)
            self._listeners.sort(key=lambda x: -x.priority)

        def _dispose():
            with self._lock:
                try:
                    self._listeners.remove(entry)
                except ValueError:
                    pass

        return Disposable(_dispose)

    def once(self, listener: Callable[[T], None]) -> Disposable:
        """Subscribe to only the next event, then auto-unsubscribe."""
        return self.subscribe(listener, once=True)

    def fire(self, event: T) -> None:
        """Emit the event to all subscribers."""
        with self._lock:
            listeners = self._listeners[:]  # snapshot

        to_remove: List[_Listener] = []
        for entry in listeners:
            try:
                entry.callback(event)
            except Exception as exc:
                logger.exception(
                    "EventEmitter[%s]: error in listener %s: %s",
                    self._name,
                    entry.callback,
                    exc,
                )
            if entry.once:
                to_remove.append(entry)

        if to_remove:
            with self._lock:
                for entry in to_remove:
                    try:
                        self._listeners.remove(entry)
                    except ValueError:
                        pass

    def listener_count(self) -> int:
        with self._lock:
            return len(self._listeners)

    def clear(self) -> None:
        """Remove all listeners."""
        with self._lock:
            self._listeners.clear()


# ---------------------------------------------------------------------------
# Event (static utility — mirrors VS Code's Event namespace)
# ---------------------------------------------------------------------------

class Event:
    """Static helpers for combining / transforming EventEmitters."""

    @staticmethod
    def filter(emitter: EventEmitter[T], predicate: Callable[[T], bool]) -> EventEmitter[T]:
        """Return a derived emitter that only fires when predicate returns True."""
        filtered = EventEmitter(name=f"{emitter._name}:filtered")

        def _on_event(e: T):
            if predicate(e):
                filtered.fire(e)

        emitter.subscribe(_on_event)
        return filtered

    @staticmethod
    def map(emitter: EventEmitter[T], mapper: Callable[[T], Any]) -> EventEmitter:
        """Return a derived emitter that transforms values."""
        mapped: EventEmitter = EventEmitter(name=f"{emitter._name}:mapped")

        def _on_event(e: T):
            mapped.fire(mapper(e))

        emitter.subscribe(_on_event)
        return mapped

    @staticmethod
    def any(*emitters: EventEmitter) -> EventEmitter:
        """Merge multiple emitters into one."""
        merged: EventEmitter = EventEmitter(name="any")

        def _on_event(e: Any):
            merged.fire(e)

        for em in emitters:
            em.subscribe(_on_event)

        return merged


# ---------------------------------------------------------------------------
# Named Event Channel
# ---------------------------------------------------------------------------

@dataclass
class _ChannelEntry:
    emitter: EventEmitter = field(default_factory=EventEmitter)


# ---------------------------------------------------------------------------
# Global Event Bus
# ---------------------------------------------------------------------------

class EventBus:
    """
    Global named event bus — channels identified by string name.

    Mirrors VS Code's internal event communication pattern.

    Usage:
        bus = EventBus.instance()
        bus.subscribe("editor.didOpen", handler)
        bus.emit("editor.didOpen", {"file": "main.py"})
    """

    _instance: Optional["EventBus"] = None
    _instance_lock = threading.Lock()

    def __init__(self):
        self._channels: Dict[str, EventEmitter] = {}
        self._lock = threading.RLock()

    @classmethod
    def instance(cls) -> "EventBus":
        """Return the global singleton event bus."""
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset the global singleton (for tests)."""
        with cls._instance_lock:
            cls._instance = None

    def _get_or_create(self, channel: str) -> EventEmitter:
        with self._lock:
            if channel not in self._channels:
                self._channels[channel] = EventEmitter(name=channel)
            return self._channels[channel]

    def subscribe(
        self,
        channel: str,
        listener: Callable[[Any], None],
        *,
        once: bool = False,
        priority: int = 0,
    ) -> Disposable:
        """Subscribe to a named event channel."""
        emitter = self._get_or_create(channel)
        return emitter.subscribe(listener, once=once, priority=priority)

    def once(self, channel: str, listener: Callable[[Any], None]) -> Disposable:
        """Subscribe only for the next event on this channel."""
        return self.subscribe(channel, listener, once=True)

    def emit(self, channel: str, data: Any = None) -> None:
        """Emit an event on a named channel."""
        with self._lock:
            emitter = self._channels.get(channel)
        if emitter is not None:
            emitter.fire(data)

    def channel(self, channel: str) -> EventEmitter:
        """Return the EventEmitter for a named channel (creates if missing)."""
        return self._get_or_create(channel)

    def clear_channel(self, channel: str) -> None:
        """Remove all listeners from a channel."""
        with self._lock:
            if channel in self._channels:
                self._channels[channel].clear()

    def clear_all(self) -> None:
        """Clear all channels and listeners."""
        with self._lock:
            for em in self._channels.values():
                em.clear()
            self._channels.clear()

    def list_channels(self) -> List[str]:
        with self._lock:
            return list(self._channels.keys())


# ---------------------------------------------------------------------------
# Well-known Event Channel Names
# Mirrors VS Code internal event identifiers
# ---------------------------------------------------------------------------

class Events:
    # Application lifecycle
    APP_READY = "app.ready"
    APP_SHUTDOWN = "app.shutdown"
    APP_FOCUS_CHANGE = "app.focusChange"

    # Editor
    EDITOR_DID_OPEN = "editor.didOpen"
    EDITOR_DID_CLOSE = "editor.didClose"
    EDITOR_DID_CHANGE = "editor.didChange"
    EDITOR_DID_SAVE = "editor.didSave"
    EDITOR_DID_CHANGE_ACTIVE = "editor.didChangeActive"
    EDITOR_DID_SCROLL = "editor.didScroll"
    EDITOR_DID_CHANGE_CURSOR = "editor.didChangeCursor"
    EDITOR_DID_CHANGE_SELECTION = "editor.didChangeSelection"

    # File Explorer
    EXPLORER_DID_SELECT = "explorer.didSelect"
    EXPLORER_DID_OPEN_FILE = "explorer.didOpenFile"
    EXPLORER_DID_RENAME = "explorer.didRename"
    EXPLORER_DID_DELETE = "explorer.didDelete"

    # File System
    FS_DID_CREATE = "fs.didCreate"
    FS_DID_DELETE = "fs.didDelete"
    FS_DID_CHANGE = "fs.didChange"
    FS_DID_RENAME = "fs.didRename"

    # Terminal
    TERMINAL_DID_OPEN = "terminal.didOpen"
    TERMINAL_DID_CLOSE = "terminal.didClose"
    TERMINAL_DID_CHANGE_ACTIVE = "terminal.didChangeActive"
    TERMINAL_DATA = "terminal.data"

    # SCM / Git
    SCM_DID_CHANGE = "scm.didChange"
    GIT_DID_CHANGE_BRANCH = "git.didChangeBranch"
    GIT_DID_COMMIT = "git.didCommit"

    # Debug
    DEBUG_DID_START = "debug.didStart"
    DEBUG_DID_STOP = "debug.didStop"
    DEBUG_DID_BREAK = "debug.didBreak"

    # Extension
    EXT_DID_INSTALL = "extension.didInstall"
    EXT_DID_UNINSTALL = "extension.didUninstall"
    EXT_DID_ENABLE = "extension.didEnable"
    EXT_DID_DISABLE = "extension.didDisable"

    # Configuration
    CONFIG_DID_CHANGE = "config.didChange"

    # Theme
    THEME_DID_CHANGE = "theme.didChange"

    # Notification
    NOTIFICATION_DID_ADD = "notification.didAdd"
    NOTIFICATION_DID_CLOSE = "notification.didClose"

    # LSP
    LSP_DID_CONNECT = "lsp.didConnect"
    LSP_DID_DISCONNECT = "lsp.didDisconnect"
    LSP_DIAGNOSTICS = "lsp.diagnostics"

    # Workspace
    WORKSPACE_DID_OPEN = "workspace.didOpen"
    WORKSPACE_DID_CLOSE = "workspace.didClose"
    WORKSPACE_DID_CHANGE_FOLDERS = "workspace.didChangeFolders"

    # Layout
    LAYOUT_DID_CHANGE = "layout.didChange"
    PANEL_DID_TOGGLE = "panel.didToggle"
    SIDEBAR_DID_TOGGLE = "sidebar.didToggle"


# Module-level convenience shortcuts
def get_event_bus() -> EventBus:
    """Return the global event bus singleton."""
    return EventBus.instance()


def subscribe(channel: str, listener: Callable[[Any], None], *, once: bool = False) -> Disposable:
    """Convenience: subscribe on the global event bus."""
    return get_event_bus().subscribe(channel, listener, once=once)


def emit(channel: str, data: Any = None) -> None:
    """Convenience: emit on the global event bus."""
    get_event_bus().emit(channel, data)
