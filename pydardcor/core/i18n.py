from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, Optional


class I18n:
    """
    Minimal i18n system for Dardcor Code.
    Loads locale strings from JSON files.
    """

    _strings: Dict[str, str] = {}
    _locale: str = "en"
    _fallback: Dict[str, str] = {}
    _loaded: bool = False

    @classmethod
    def load(cls, locale: str, locale_dir: Optional[str] = None) -> None:
        cls._locale = locale
        if locale_dir is None:
            locale_dir = str(
                Path(__file__).parent.parent / "assets" / "i18n"
            )

        # Load English fallback
        en_path = os.path.join(locale_dir, "en.json")
        if os.path.isfile(en_path):
            try:
                with open(en_path, encoding="utf-8") as f:
                    cls._fallback = json.load(f)
            except Exception:
                cls._fallback = {}

        # Load requested locale
        loc_path = os.path.join(locale_dir, f"{locale}.json")
        if os.path.isfile(loc_path):
            try:
                with open(loc_path, encoding="utf-8") as f:
                    cls._strings = json.load(f)
            except Exception:
                cls._strings = {}
        else:
            cls._strings = {}

        cls._loaded = True

    @classmethod
    def t(cls, key: str, default: str = "") -> str:
        """Translate a string key."""
        if not cls._loaded:
            return default or key
        return cls._strings.get(key) or cls._fallback.get(key) or default or key

    @classmethod
    def locale(cls) -> str:
        return cls._locale


def t(key: str, default: str = "") -> str:
    """Convenience function for translation."""
    return I18n.t(key, default)
