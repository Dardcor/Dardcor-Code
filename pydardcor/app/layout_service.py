"""
Layout Service — TASK-0018
============================
Save/restore layout state lengkap.
Mirip VS Code: src/vs/workbench/services/layout/browser/layoutService.ts

Menyimpan:
- Panel sizes (sidebar width, panel height)
- Panel visibility (sidebar, bottom panel, activity bar)
- Editor layout (split states)
- Panel positions
- Activity bar items
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class PanelLayout:
    visible: bool = True
    width: int = 0
    height: int = 0
    position: str = "left"  # "left" | "right" | "bottom"
    min_size: int = 100
    max_size: int = 2000


@dataclass
class LayoutState:
    """Complete layout state snapshot."""
    # Sidebar
    sidebar_visible: bool = True
    sidebar_width: int = 240
    sidebar_position: str = "left"  # "left" | "right"
    active_view: str = "explorer"   # active activity bar view

    # Activity bar
    activity_bar_visible: bool = True
    activity_bar_position: str = "default"  # "default" (left/right same as sidebar)

    # Auxiliary sidebar (right sidebar)
    aux_sidebar_visible: bool = False
    aux_sidebar_width: int = 240

    # Bottom panel
    panel_visible: bool = True
    panel_height: int = 300
    panel_position: str = "bottom"  # "bottom" | "left" | "right"
    active_panel: str = "terminal"

    # Editor layout
    editor_layout: str = "single"  # "single" | "columns2" | "columns3" | "rows2" | "grid"

    # Status bar
    status_bar_visible: bool = True

    # Breadcrumbs
    breadcrumbs_visible: bool = True

    # Zen mode
    zen_mode_active: bool = False

    # Centered layout
    centered_layout_active: bool = False

    # Window
    window_maximized: bool = False
    window_x: int = 100
    window_y: int = 100
    window_width: int = 1280
    window_height: int = 800

    # Extra custom data
    extra: Dict[str, Any] = field(default_factory=dict)


class LayoutService:
    """
    Manages layout save/restore and emits layout change events.
    """

    def __init__(self, storage_path: Optional[str] = None):
        self._state = LayoutState()
        self._storage_path = storage_path or self._default_path()
        self._lock = threading.RLock()
        self._listeners: List[Callable[[str, Any], None]] = []
        self._load()

    def _default_path(self) -> str:
        from pydardcor.core.config import get_user_data_dir
        return os.path.join(get_user_data_dir(), "layout.json")

    def _load(self) -> None:
        """Load layout state from disk."""
        if not os.path.exists(self._storage_path):
            return
        try:
            with open(self._storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            with self._lock:
                for k, v in data.items():
                    if hasattr(self._state, k):
                        setattr(self._state, k, v)
        except Exception:
            pass

    def save(self) -> None:
        """Save layout state to disk."""
        try:
            os.makedirs(os.path.dirname(self._storage_path), exist_ok=True)
            with self._lock:
                data = asdict(self._state)
            with open(self._storage_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Getters / setters that emit events
    # ------------------------------------------------------------------

    def get_state(self) -> LayoutState:
        with self._lock:
            return self._state

    def set(self, key: str, value: Any) -> None:
        """Update a single layout property."""
        with self._lock:
            if hasattr(self._state, key):
                setattr(self._state, key, value)
        self._notify(key, value)
        self.save()

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return getattr(self._state, key, default)

    # ------------------------------------------------------------------
    # Sidebar
    # ------------------------------------------------------------------

    def toggle_sidebar(self) -> bool:
        visible = not self._state.sidebar_visible
        self.set("sidebar_visible", visible)
        return visible

    def set_sidebar_width(self, width: int) -> None:
        self.set("sidebar_width", max(100, width))

    def set_sidebar_position(self, position: str) -> None:
        """position: 'left' or 'right'"""
        self.set("sidebar_position", position)

    # ------------------------------------------------------------------
    # Panel
    # ------------------------------------------------------------------

    def toggle_panel(self) -> bool:
        visible = not self._state.panel_visible
        self.set("panel_visible", visible)
        return visible

    def set_panel_height(self, height: int) -> None:
        self.set("panel_height", max(50, height))

    def set_panel_position(self, position: str) -> None:
        """position: 'bottom' | 'left' | 'right'"""
        self.set("panel_position", position)

    def set_active_panel(self, panel_id: str) -> None:
        self.set("active_panel", panel_id)

    # ------------------------------------------------------------------
    # Activity bar
    # ------------------------------------------------------------------

    def toggle_activity_bar(self) -> bool:
        visible = not self._state.activity_bar_visible
        self.set("activity_bar_visible", visible)
        return visible

    def set_active_view(self, view_id: str) -> None:
        self.set("active_view", view_id)

    # ------------------------------------------------------------------
    # Zen / centered
    # ------------------------------------------------------------------

    def toggle_zen_mode(self) -> bool:
        active = not self._state.zen_mode_active
        self.set("zen_mode_active", active)
        return active

    def toggle_centered_layout(self) -> bool:
        active = not self._state.centered_layout_active
        self.set("centered_layout_active", active)
        return active

    # ------------------------------------------------------------------
    # Editor layout
    # ------------------------------------------------------------------

    def set_editor_layout(self, layout: str) -> None:
        """layout: 'single' | 'columns2' | 'columns3' | 'rows2' | 'grid'"""
        self.set("editor_layout", layout)

    # ------------------------------------------------------------------
    # Window
    # ------------------------------------------------------------------

    def save_window_state(self, x: int, y: int, w: int, h: int, maximized: bool) -> None:
        with self._lock:
            self._state.window_x = x
            self._state.window_y = y
            self._state.window_width = w
            self._state.window_height = h
            self._state.window_maximized = maximized
        self.save()

    # ------------------------------------------------------------------
    # Listeners
    # ------------------------------------------------------------------

    def on_change(self, callback: Callable[[str, Any], None]) -> None:
        """Register a callback for any layout change: callback(key, value)."""
        self._listeners.append(callback)

    def _notify(self, key: str, value: Any) -> None:
        from pydardcor.core.event_bus import get_event_bus, Events
        get_event_bus().emit(Events.LAYOUT_DID_CHANGE, {"key": key, "value": value})
        for cb in self._listeners:
            try:
                cb(key, value)
            except Exception:
                pass


# Global singleton
_layout_service: Optional[LayoutService] = None
_ls_lock = threading.Lock()


def get_layout_service() -> LayoutService:
    global _layout_service
    if _layout_service is None:
        with _ls_lock:
            if _layout_service is None:
                _layout_service = LayoutService()
    return _layout_service


def reset_layout_service() -> None:
    global _layout_service
    with _ls_lock:
        _layout_service = None
