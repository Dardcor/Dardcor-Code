"""Icon Theme Manager - applies VS Code file icon themes from extensions.

Reads `contributes.iconThemes` from installed extensions (e.g. Material Icon
Theme), loads the icon theme JSON (iconDefinitions / fileNames / fileExtensions
/ folderNames) and serves QIcons to the file explorer and editor tabs.
"""

import os
import json
from typing import Optional, Dict, Any, List, Callable

from PySide6.QtGui import QIcon, QImage, QPainter, QPixmap
from PySide6.QtCore import Qt, QByteArray
from PySide6.QtSvg import QSvgRenderer


_SVG_ICON_CACHE: Dict[str, Optional[QIcon]] = {}


def _render_svg_file(svg_path: str) -> Optional[QIcon]:
    cached = _SVG_ICON_CACHE.get(svg_path)
    if cached is not None or svg_path in _SVG_ICON_CACHE:
        return cached

    try:
        with open(svg_path, "rb") as f:
            svg_bytes = f.read()
    except OSError:
        _SVG_ICON_CACHE[svg_path] = None
        return None

    icon = QIcon()
    renderer = QSvgRenderer(QByteArray(svg_bytes))
    if not renderer.isValid():
        _SVG_ICON_CACHE[svg_path] = None
        return None

    # Same size sets the builtin explorer (18px base) and tabs (16px base) use
    for base, sizes in ((18, (18, 36, 54, 72)), (16, (16, 32, 48, 64))):
        for size in sizes:
            image = QImage(size, size, QImage.Format_ARGB32)
            image.fill(Qt.transparent)
            painter = QPainter(image)
            painter.setRenderHint(QPainter.Antialiasing)
            renderer.render(painter)
            painter.end()
            pixmap = QPixmap.fromImage(image)
            pixmap.setDevicePixelRatio(size / float(base))
            icon.addPixmap(pixmap)
    _SVG_ICON_CACHE[svg_path] = icon
    return icon


class IconThemeManager:
    """Loads and applies a VS Code style file icon theme."""

    BUILTIN_ID = "builtin"

    def __init__(self):
        self._themes: List[Dict[str, str]] = []
        self._active_id: str = ""
        self._data: Optional[Dict[str, Any]] = None
        self._json_dir: str = ""
        self._icon_cache: Dict[str, Optional[QIcon]] = {}
        self._listeners: List[Callable] = []
        self.reload()

    # ── Discovery ────────────────────────────────────────────────────

    def reload(self):
        """Rescan installed extensions for icon theme contributions."""
        from .extension_manager import get_extension_manager

        self._themes = []
        for ext in get_extension_manager().get_installed_extensions():
            if not ext.enabled:
                continue
            contributes = (ext.manifest or {}).get("contributes", {})
            for it in contributes.get("iconThemes", []):
                rel = it.get("path", "")
                json_path = os.path.normpath(os.path.join(ext.path, rel)) if rel else ""
                if json_path and os.path.exists(json_path):
                    self._themes.append({
                        "id": it.get("id", ext.name),
                        "label": it.get("label", ext.display_name),
                        "ext_name": ext.name,
                        "path": json_path,
                    })

        self._apply_config_selection()
        self._notify()

    def _apply_config_selection(self):
        from .config import get_config

        wanted = getattr(get_config(), "file_icon_theme", "") or ""
        if wanted == self.BUILTIN_ID:
            self._activate(None)
            return

        theme = next((t for t in self._themes if t["id"] == wanted), None)
        if theme is None and self._themes:
            # Auto: use the first available icon theme so a freshly installed
            # icon theme extension works immediately, like VS Code's prompt.
            theme = self._themes[0]
        self._activate(theme)

    def _activate(self, theme: Optional[Dict[str, str]]):
        self._icon_cache.clear()
        if theme is None:
            self._active_id = self.BUILTIN_ID
            self._data = None
            self._json_dir = ""
            return
        try:
            with open(theme["path"], "r", encoding="utf-8") as f:
                self._data = json.load(f)
            self._json_dir = os.path.dirname(theme["path"])
            self._active_id = theme["id"]
        except Exception:
            self._data = None
            self._json_dir = ""
            self._active_id = self.BUILTIN_ID

    # ── Public API ───────────────────────────────────────────────────

    def available_themes(self) -> List[Dict[str, str]]:
        return list(self._themes)

    def active_theme_id(self) -> str:
        return self._active_id

    def set_active(self, theme_id: str):
        """Select an icon theme by id ('builtin' disables extension icons)."""
        from .config import get_config

        cfg = get_config()
        cfg.file_icon_theme = theme_id
        cfg.save()
        self._apply_config_selection()
        self._notify()

    def on_changed(self, listener: Callable):
        self._listeners.append(listener)

    def _notify(self):
        for listener in list(self._listeners):
            try:
                listener()
            except Exception:
                pass

    # ── Icon lookup ──────────────────────────────────────────────────

    def _icon_for_definition(self, def_id: str) -> Optional[QIcon]:
        if not def_id or self._data is None:
            return None
        if def_id in self._icon_cache:
            return self._icon_cache[def_id]

        icon = None
        definition = self._data.get("iconDefinitions", {}).get(def_id)
        if definition:
            icon_path = definition.get("iconPath", "")
            if icon_path:
                full = os.path.normpath(os.path.join(self._json_dir, icon_path))
                if os.path.exists(full):
                    if full.lower().endswith(".svg"):
                        icon = _render_svg_file(full)
                    else:
                        loaded = QIcon(full)
                        icon = loaded if not loaded.isNull() else None

        self._icon_cache[def_id] = icon
        return icon

    def _first_renderable(self, def_ids: List[str]) -> Optional[QIcon]:
        """Return the icon for the first definition that actually renders.

        Icon themes routinely map files to font-glyph definitions (which we
        cannot render) or to stale iconPaths. Walking the candidate chain and
        skipping the ones that produce no QIcon means a specific match that
        happens to be unrenderable still falls back to the generic file/folder
        icon instead of showing nothing.
        """
        for def_id in def_ids:
            if not def_id:
                continue
            icon = self._icon_for_definition(def_id)
            if icon is not None:
                return icon
        return None

    def file_icon(self, filepath: str) -> Optional[QIcon]:
        """Return the themed icon for a file, or None to use builtin icons."""
        if self._data is None:
            return None

        name = os.path.basename(filepath).lower()

        candidates: List[str] = []

        by_name = self._data.get("fileNames", {}).get(name)
        if by_name:
            candidates.append(by_name)

        # Longest multi-dot suffix wins: "component.spec.ts" tries
        # "component.spec.ts" -> "spec.ts" -> "ts".
        file_exts = self._data.get("fileExtensions", {})
        parts = name.split(".")
        for i in range(1, len(parts)):
            suffix = ".".join(parts[i:])
            if suffix in file_exts:
                candidates.append(file_exts[suffix])
                break

        # Generic default so a glyph-only or stale specific match still yields
        # a visible icon rather than nothing.
        candidates.append(self._data.get("file", ""))

        return self._first_renderable(candidates)

    def folder_icon(self, foldername: str = "", is_open: bool = False) -> Optional[QIcon]:
        """Return the themed icon for a folder, or None to use builtin icons."""
        if self._data is None:
            return None

        name = (foldername or "").lower()
        candidates: List[str] = []

        if name:
            key = "folderNamesExpanded" if is_open else "folderNames"
            candidates.append(self._data.get(key, {}).get(name, ""))
            if is_open:
                candidates.append(self._data.get("folderNames", {}).get(name, ""))

        candidates.append(self._data.get("folderExpanded" if is_open else "folder", ""))
        if is_open:
            candidates.append(self._data.get("folder", ""))

        return self._first_renderable(candidates)


_instance: Optional[IconThemeManager] = None


def get_icon_theme_manager() -> IconThemeManager:
    global _instance
    if _instance is None:
        _instance = IconThemeManager()
    return _instance
