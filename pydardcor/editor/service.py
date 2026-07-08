"""
Editor Service — TASK-0059
============================
Central editor management service.
Mirip VS Code: src/vs/workbench/services/editor/common/editorService.ts

Manages:
- Opening/closing/switching editors
- Editor groups
- Recent files history
- Dirty state tracking
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set


@dataclass
class EditorInput:
    """Represents a file/resource to open in the editor."""
    uri: str             # file path or URI
    language_id: str = ""
    encoding: str = "utf-8"
    read_only: bool = False
    preview: bool = True   # single-click = preview mode
    pinned: bool = False
    column: int = 1        # editor group column


@dataclass
class EditorState:
    """Persisted state for an editor (cursor, scroll, folding)."""
    uri: str
    cursor_line: int = 1
    cursor_column: int = 1
    scroll_top: int = 0
    scroll_left: int = 0
    selection_start_line: int = 0
    selection_start_col: int = 0
    selection_end_line: int = 0
    selection_end_col: int = 0
    folded_regions: List[int] = field(default_factory=list)


class EditorService:
    """
    Central service for editor lifecycle management.
    Tracks open editors, groups, dirty state, and history.
    """

    def __init__(self):
        self._open_editors: List[str] = []          # ordered list of URIs
        self._dirty_editors: Set[str] = set()
        self._active_editor: Optional[str] = None
        self._pinned: Set[str] = set()
        self._preview: Optional[str] = None          # currently previewed URI
        self._states: Dict[str, EditorState] = {}   # uri → state
        self._history: List[str] = []               # recently opened, LIFO
        self._max_history = 50
        self._lock = threading.RLock()

        # Callbacks
        self._on_open: List[Callable[[str], None]] = []
        self._on_close: List[Callable[[str], None]] = []
        self._on_active_change: List[Callable[[Optional[str]], None]] = []
        self._on_dirty_change: List[Callable[[str, bool], None]] = []

    # ------------------------------------------------------------------
    # Open / close
    # ------------------------------------------------------------------

    def open_editor(
        self,
        uri: str,
        *,
        preview: bool = True,
        pinned: bool = False,
        column: int = 1,
        reveal: bool = True,
    ) -> None:
        """Open or reveal an editor."""
        with self._lock:
            # If already open, just activate
            if uri in self._open_editors:
                if reveal:
                    self._set_active(uri)
                # Promote from preview to permanent if needed
                if not preview or pinned:
                    self._preview = None
                    if pinned:
                        self._pinned.add(uri)
                return

            # Replace preview if any
            if preview and self._preview and self._preview not in self._pinned:
                old_preview = self._preview
                self._open_editors.remove(old_preview)
                self._notify_close(old_preview)

            self._open_editors.append(uri)

            if preview and not pinned:
                self._preview = uri
            else:
                self._preview = None
                if pinned:
                    self._pinned.add(uri)

            if reveal:
                self._set_active(uri)

        self._add_history(uri)
        self._notify_open(uri)

    def close_editor(self, uri: str) -> None:
        """Close an editor by URI."""
        with self._lock:
            if uri not in self._open_editors:
                return
            self._open_editors.remove(uri)
            self._dirty_editors.discard(uri)
            self._pinned.discard(uri)
            if self._preview == uri:
                self._preview = None

            # Activate next available
            if self._active_editor == uri:
                if self._open_editors:
                    self._set_active(self._open_editors[-1])
                else:
                    self._active_editor = None
                    self._notify_active(None)

        self._notify_close(uri)

    def close_all(self) -> None:
        """Close all editors."""
        with self._lock:
            uris = list(self._open_editors)
        for uri in uris:
            self.close_editor(uri)

    def close_others(self, keep_uri: str) -> None:
        """Close all editors except the specified one."""
        with self._lock:
            uris = [u for u in self._open_editors if u != keep_uri]
        for uri in uris:
            self.close_editor(uri)

    # ------------------------------------------------------------------
    # Active editor
    # ------------------------------------------------------------------

    def _set_active(self, uri: str) -> None:
        old = self._active_editor
        self._active_editor = uri
        if old != uri:
            self._notify_active(uri)

    @property
    def active_editor(self) -> Optional[str]:
        with self._lock:
            return self._active_editor

    def set_active_editor(self, uri: str) -> None:
        with self._lock:
            if uri in self._open_editors:
                self._set_active(uri)

    # ------------------------------------------------------------------
    # Dirty state
    # ------------------------------------------------------------------

    def mark_dirty(self, uri: str) -> None:
        with self._lock:
            was_dirty = uri in self._dirty_editors
            self._dirty_editors.add(uri)
        if not was_dirty:
            self._notify_dirty(uri, True)

    def mark_clean(self, uri: str) -> None:
        with self._lock:
            was_dirty = uri in self._dirty_editors
            self._dirty_editors.discard(uri)
        if was_dirty:
            self._notify_dirty(uri, False)

    def is_dirty(self, uri: str) -> bool:
        with self._lock:
            return uri in self._dirty_editors

    def get_dirty_editors(self) -> List[str]:
        with self._lock:
            return list(self._dirty_editors)

    # ------------------------------------------------------------------
    # Pin / preview
    # ------------------------------------------------------------------

    def pin_editor(self, uri: str) -> None:
        with self._lock:
            self._pinned.add(uri)
            if self._preview == uri:
                self._preview = None

    def unpin_editor(self, uri: str) -> None:
        with self._lock:
            self._pinned.discard(uri)

    def is_pinned(self, uri: str) -> bool:
        with self._lock:
            return uri in self._pinned

    def is_preview(self, uri: str) -> bool:
        with self._lock:
            return self._preview == uri

    # ------------------------------------------------------------------
    # State persistence
    # ------------------------------------------------------------------

    def save_state(self, uri: str, state: EditorState) -> None:
        with self._lock:
            self._states[uri] = state

    def get_state(self, uri: str) -> Optional[EditorState]:
        with self._lock:
            return self._states.get(uri)

    # ------------------------------------------------------------------
    # Open editors list
    # ------------------------------------------------------------------

    def get_open_editors(self) -> List[str]:
        with self._lock:
            return list(self._open_editors)

    def get_editor_count(self) -> int:
        with self._lock:
            return len(self._open_editors)

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def _add_history(self, uri: str) -> None:
        if uri in self._history:
            self._history.remove(uri)
        self._history.insert(0, uri)
        self._history = self._history[:self._max_history]

    def get_history(self) -> List[str]:
        return self._history[:]

    # ------------------------------------------------------------------
    # Event listeners
    # ------------------------------------------------------------------

    def on_open(self, cb: Callable[[str], None]) -> None:
        self._on_open.append(cb)

    def on_close(self, cb: Callable[[str], None]) -> None:
        self._on_close.append(cb)

    def on_active_change(self, cb: Callable[[Optional[str]], None]) -> None:
        self._on_active_change.append(cb)

    def on_dirty_change(self, cb: Callable[[str, bool], None]) -> None:
        self._on_dirty_change.append(cb)

    def _notify_open(self, uri: str) -> None:
        from pydardcor.core.event_bus import get_event_bus, Events
        get_event_bus().emit(Events.EDITOR_DID_OPEN, uri)
        for cb in self._on_open:
            try:
                cb(uri)
            except Exception:
                pass

    def _notify_close(self, uri: str) -> None:
        from pydardcor.core.event_bus import get_event_bus, Events
        get_event_bus().emit(Events.EDITOR_DID_CLOSE, uri)
        for cb in self._on_close:
            try:
                cb(uri)
            except Exception:
                pass

    def _notify_active(self, uri: Optional[str]) -> None:
        from pydardcor.core.event_bus import get_event_bus, Events
        get_event_bus().emit(Events.EDITOR_DID_CHANGE_ACTIVE, uri)
        for cb in self._on_active_change:
            try:
                cb(uri)
            except Exception:
                pass

    def _notify_dirty(self, uri: str, dirty: bool) -> None:
        for cb in self._on_dirty_change:
            try:
                cb(uri, dirty)
            except Exception:
                pass


# Global singleton
_editor_service: Optional[EditorService] = None
_es_lock = threading.Lock()


def get_editor_service() -> EditorService:
    global _editor_service
    if _editor_service is None:
        with _es_lock:
            if _editor_service is None:
                _editor_service = EditorService()
    return _editor_service


def reset_editor_service() -> None:
    global _editor_service
    with _es_lock:
        _editor_service = None
