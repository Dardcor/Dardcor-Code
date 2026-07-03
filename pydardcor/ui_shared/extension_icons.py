"""Extension icon loading — local files, cached remote URLs, SVG/PNG rendering."""

import hashlib
import os
import threading
import urllib.request
from typing import Optional, Callable

from PySide6.QtCore import QByteArray, Qt, QObject, Signal
from PySide6.QtGui import QPixmap, QImage, QPainter, QIcon
from PySide6.QtSvg import QSvgRenderer

from ..core.config import get_global_home_dir

_DEFAULT_SVG = b"""<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="#161616"/>
  <path d="M24 8l4 4-4 4-4-4 4-4zm-8 8l4 4-4 4-4-4 4-4zm16 0l4 4-4 4-4-4 4-4zm-8 8l4 4-4 4-4-4 4-4z"
        fill="#888888" fill-rule="evenodd"/>
</svg>"""


def get_icon_cache_dir() -> str:
    path = os.path.join(get_global_home_dir(), "cache", "icons")
    os.makedirs(path, exist_ok=True)
    return path


def _render_svg_bytes(data: bytes, size: int) -> Optional[QPixmap]:
    renderer = QSvgRenderer(QByteArray(data))
    if not renderer.isValid():
        return None
    image = QImage(size, size, QImage.Format_ARGB32)
    image.fill(Qt.transparent)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing)
    renderer.render(painter)
    painter.end()
    return QPixmap.fromImage(image)


def load_pixmap_from_file(path: str, size: int = 48) -> Optional[QPixmap]:
    """Load an extension icon from a local SVG or PNG path."""
    if not path or not os.path.isfile(path):
        return None
    try:
        if path.lower().endswith(".svg"):
            with open(path, "rb") as f:
                pm = _render_svg_bytes(f.read(), size)
        else:
            pm = QPixmap(path)
            if pm.isNull():
                return None
            pm = pm.scaled(size, size, Qt.KeepAspectRatio, Qt.SmoothTransformation)
        return pm
    except OSError:
        return None


def default_extension_pixmap(size: int = 48) -> QPixmap:
    pm = _render_svg_bytes(_DEFAULT_SVG, size)
    if pm is not None:
        return pm
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    return pm


def default_extension_icon(size: int = 48) -> QIcon:
    return QIcon(default_extension_pixmap(size))


def installed_extension_icon_path(ext_path: str, manifest: dict) -> Optional[str]:
    """Resolve the icon file path from an installed extension manifest."""
    icon_rel = manifest.get("icon", "")
    if not icon_rel:
        return None
    full = os.path.normpath(os.path.join(ext_path, icon_rel))
    return full if os.path.isfile(full) else None


def _cache_path_for_url(url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    ext = ".svg" if url.lower().endswith(".svg") else ".png"
    return os.path.join(get_icon_cache_dir(), f"{digest}{ext}")


class ExtensionIconLoader(QObject):
    """Download marketplace icons on a background thread; emit on the UI thread."""

    icon_ready = Signal(str, object)  # cache_key, QPixmap

    def __init__(self, parent=None):
        super().__init__(parent)
        self._memory: dict[str, QPixmap] = {}

    def pixmap_for_url(self, url: str, size: int = 48) -> QPixmap:
        if not url:
            return default_extension_pixmap(size)
        key = f"{url}@{size}"
        if key in self._memory:
            return self._memory[key]
        cached = _cache_path_for_url(url)
        if os.path.isfile(cached):
            pm = load_pixmap_from_file(cached, size)
            if pm is not None:
                self._memory[key] = pm
                return pm
        threading.Thread(target=self._download, args=(url, size, key), daemon=True).start()
        return default_extension_pixmap(size)

    def _download(self, url: str, size: int, key: str):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DardcorCode/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            cached = _cache_path_for_url(url)
            with open(cached, "wb") as f:
                f.write(data)
            if cached.lower().endswith(".svg"):
                pm = _render_svg_bytes(data, size)
            else:
                pm = QPixmap()
                pm.loadFromData(data)
                if not pm.isNull():
                    pm = pm.scaled(size, size, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            if pm is not None and not pm.isNull():
                self._memory[key] = pm
                self.icon_ready.emit(key, pm)
        except Exception:
            pass
