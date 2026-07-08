"""
Editor Group Model — TASK-0060
================================
Model untuk editor groups, tabs, dan split states.
Mirip VS Code: src/vs/workbench/common/editor/editorGroupModel.ts
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional


class GroupOrientation(Enum):
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"


@dataclass
class TabEntry:
    """A single tab in an editor group."""
    uri: str
    title: str = ""
    language_id: str = ""
    dirty: bool = False
    pinned: bool = False
    preview: bool = False
    icon: str = ""

    def __post_init__(self):
        if not self.title:
            import os
            self.title = os.path.basename(self.uri) or self.uri


@dataclass
class EditorGroupModel:
    """Model for a single editor group (a tab container)."""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    tabs: List[TabEntry] = field(default_factory=list)
    active_uri: Optional[str] = None
    label: str = ""

    def open(self, entry: TabEntry, preview: bool = True) -> None:
        """Open a tab in this group."""
        existing = self._find(entry.uri)
        if existing:
            self.active_uri = entry.uri
            if not preview:
                existing.preview = False
            return

        # Replace preview tab
        if preview:
            preview_tabs = [t for t in self.tabs if t.preview]
            for pt in preview_tabs:
                self.tabs.remove(pt)

        entry.preview = preview
        self.tabs.append(entry)
        self.active_uri = entry.uri

    def close(self, uri: str) -> Optional[str]:
        """Close a tab. Returns new active URI or None."""
        tab = self._find(uri)
        if not tab:
            return self.active_uri
        idx = self.tabs.index(tab)
        self.tabs.remove(tab)

        if self.active_uri == uri:
            if self.tabs:
                new_idx = min(idx, len(self.tabs) - 1)
                self.active_uri = self.tabs[new_idx].uri
            else:
                self.active_uri = None
        return self.active_uri

    def pin(self, uri: str) -> None:
        tab = self._find(uri)
        if tab:
            tab.pinned = True
            tab.preview = False

    def unpin(self, uri: str) -> None:
        tab = self._find(uri)
        if tab:
            tab.pinned = False

    def mark_dirty(self, uri: str, dirty: bool) -> None:
        tab = self._find(uri)
        if tab:
            tab.dirty = dirty

    def move_tab(self, uri: str, to_index: int) -> None:
        """Move a tab to a different position."""
        tab = self._find(uri)
        if tab:
            self.tabs.remove(tab)
            self.tabs.insert(to_index, tab)

    def get_active_tab(self) -> Optional[TabEntry]:
        if self.active_uri:
            return self._find(self.active_uri)
        return None

    def _find(self, uri: str) -> Optional[TabEntry]:
        for tab in self.tabs:
            if tab.uri == uri:
                return tab
        return None

    def __len__(self) -> int:
        return len(self.tabs)

    def __contains__(self, uri: str) -> bool:
        return self._find(uri) is not None


class EditorGroupsModel:
    """
    Model for the entire editor area with multiple groups.
    Supports split horizontal/vertical layouts.
    """

    def __init__(self):
        self._groups: Dict[str, EditorGroupModel] = {}
        self._active_group_id: Optional[str] = None
        self._lock = threading.RLock()
        # Create default group
        default = self._create_group()
        self._active_group_id = default.id

    def _create_group(self, label: str = "") -> EditorGroupModel:
        group = EditorGroupModel(label=label)
        self._groups[group.id] = group
        return group

    def get_active_group(self) -> Optional[EditorGroupModel]:
        with self._lock:
            return self._groups.get(self._active_group_id)

    def set_active_group(self, group_id: str) -> None:
        with self._lock:
            if group_id in self._groups:
                self._active_group_id = group_id

    def get_group(self, group_id: str) -> Optional[EditorGroupModel]:
        with self._lock:
            return self._groups.get(group_id)

    def create_group(self, label: str = "") -> EditorGroupModel:
        with self._lock:
            return self._create_group(label)

    def close_group(self, group_id: str) -> None:
        with self._lock:
            self._groups.pop(group_id, None)
            if self._active_group_id == group_id:
                self._active_group_id = next(iter(self._groups), None)

    def get_all_groups(self) -> List[EditorGroupModel]:
        with self._lock:
            return list(self._groups.values())

    def get_group_count(self) -> int:
        with self._lock:
            return len(self._groups)

    def get_all_open_uris(self) -> List[str]:
        """Return all open URIs across all groups."""
        with self._lock:
            seen = []
            for group in self._groups.values():
                for tab in group.tabs:
                    if tab.uri not in seen:
                        seen.append(tab.uri)
            return seen


# Global singleton
_groups_model: Optional[EditorGroupsModel] = None
_gm_lock = threading.Lock()


def get_editor_groups_model() -> EditorGroupsModel:
    global _groups_model
    if _groups_model is None:
        with _gm_lock:
            if _groups_model is None:
                _groups_model = EditorGroupsModel()
    return _groups_model
