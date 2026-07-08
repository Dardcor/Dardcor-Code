"""
Keyboard Layout Detection — TASK-0007
=======================================
Deteksi keyboard layout (QWERTY, AZERTY, DVORAK, dll).
Mirip VS Code: src/vs/workbench/services/keybinding/browser/keyboardLayoutService.ts
"""

from __future__ import annotations

import sys
import threading
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class KeyboardLayout:
    name: str           # "QWERTY", "AZERTY", etc.
    locale: str         # "en-US", "fr-FR", etc.
    variant: str = ""   # keyboard variant


class KeyboardLayoutService:
    """Detects and caches the system keyboard layout."""

    _KNOWN_LAYOUTS: Dict[str, KeyboardLayout] = {
        # Windows layout IDs → name
        "00000409": KeyboardLayout("QWERTY", "en-US"),
        "0000040C": KeyboardLayout("AZERTY", "fr-FR"),
        "00000407": KeyboardLayout("QWERTZ", "de-DE"),
        "00000410": KeyboardLayout("QWERTY", "it-IT"),
        "0000040A": KeyboardLayout("QWERTY", "es-ES"),
        "00000416": KeyboardLayout("QWERTY", "pt-BR"),
        "00000419": KeyboardLayout("QWERTY", "ru-RU"),
        "00000411": KeyboardLayout("JIS", "ja-JP"),
        "00000404": KeyboardLayout("QWERTY", "zh-TW"),
        "00000412": KeyboardLayout("QWERTY", "ko-KR"),
        "00010409": KeyboardLayout("DVORAK", "en-US", "DVORAK"),
    }

    def __init__(self):
        self._layout: Optional[KeyboardLayout] = None
        self._lock = threading.Lock()

    def get_layout(self) -> KeyboardLayout:
        """Return the detected keyboard layout."""
        with self._lock:
            if self._layout is None:
                self._layout = self._detect()
            return self._layout

    def _detect(self) -> KeyboardLayout:
        """Detect system keyboard layout."""
        if sys.platform == "win32":
            return self._detect_windows()
        elif sys.platform == "darwin":
            return self._detect_macos()
        else:
            return self._detect_linux()

    def _detect_windows(self) -> KeyboardLayout:
        try:
            import ctypes
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            thread_id = ctypes.windll.user32.GetWindowThreadProcessId(hwnd, None)
            layout_id = ctypes.windll.user32.GetKeyboardLayout(thread_id)
            # Lower word is the locale identifier
            locale_id = layout_id & 0xFFFF
            locale_hex = f"{locale_id:08X}"
            if locale_hex in self._KNOWN_LAYOUTS:
                return self._KNOWN_LAYOUTS[locale_hex]

            # Try locale name
            buf = ctypes.create_unicode_buffer(85)
            ctypes.windll.kernel32.GetLocaleInfoW(locale_id, 0x0008, buf, 85)
            locale_name = buf.value or "en-US"
            return KeyboardLayout("QWERTY", locale_name)
        except Exception:
            return KeyboardLayout("QWERTY", "en-US")

    def _detect_macos(self) -> KeyboardLayout:
        try:
            import subprocess
            result = subprocess.run(
                ["defaults", "read", "com.apple.HIToolbox", "AppleCurrentKeyboardLayoutInputSourceID"],
                capture_output=True, text=True, timeout=3
            )
            layout_id = result.stdout.strip().lower()
            if "azerty" in layout_id or "french" in layout_id:
                return KeyboardLayout("AZERTY", "fr-FR")
            if "dvorak" in layout_id:
                return KeyboardLayout("DVORAK", "en-US", "DVORAK")
            if "qwertz" in layout_id or "german" in layout_id:
                return KeyboardLayout("QWERTZ", "de-DE")
            return KeyboardLayout("QWERTY", "en-US")
        except Exception:
            return KeyboardLayout("QWERTY", "en-US")

    def _detect_linux(self) -> KeyboardLayout:
        try:
            import subprocess
            # Try setxkbmap -query
            result = subprocess.run(
                ["setxkbmap", "-query"],
                capture_output=True, text=True, timeout=3
            )
            output = result.stdout.lower()
            if "azerty" in output or "fr" in output:
                return KeyboardLayout("AZERTY", "fr-FR")
            if "dvorak" in output:
                return KeyboardLayout("DVORAK", "en-US", "DVORAK")
            if "de" in output or "qwertz" in output:
                return KeyboardLayout("QWERTZ", "de-DE")
            return KeyboardLayout("QWERTY", "en-US")
        except Exception:
            return KeyboardLayout("QWERTY", "en-US")

    def is_qwerty(self) -> bool:
        return self.get_layout().name == "QWERTY"

    def is_azerty(self) -> bool:
        return self.get_layout().name == "AZERTY"

    def is_dvorak(self) -> bool:
        return self.get_layout().name == "DVORAK"

    def get_locale(self) -> str:
        return self.get_layout().locale


# Global singleton
_kb_layout_service: Optional[KeyboardLayoutService] = None
_kb_layout_lock = threading.Lock()


def get_keyboard_layout_service() -> KeyboardLayoutService:
    global _kb_layout_service
    if _kb_layout_service is None:
        with _kb_layout_lock:
            if _kb_layout_service is None:
                _kb_layout_service = KeyboardLayoutService()
    return _kb_layout_service


def get_keyboard_layout() -> KeyboardLayout:
    return get_keyboard_layout_service().get_layout()
