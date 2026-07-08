"""
Keybinding Resolver — TASK-0006
================================
Full keybinding system dengan conflict resolution dan priority.
Mirip VS Code: src/vs/platform/keybinding/common/keybindingResolver.ts

Fitur:
- Parse key combinations (Ctrl+K Ctrl+S style)
- Platform-aware (Windows Ctrl vs macOS Cmd)
- Priority-based conflict resolution
- When clause filtering
- Chord (multi-key) sequences
- Override / user keybindings
- Default keybindings
"""

from __future__ import annotations

import re
import sys
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

IS_MACOS = sys.platform == "darwin"
IS_WINDOWS = sys.platform == "win32"
IS_LINUX = sys.platform.startswith("linux")


# ---------------------------------------------------------------------------
# Key chord parsing
# ---------------------------------------------------------------------------

# Normalize common aliases
_KEY_ALIASES: Dict[str, str] = {
    "ctrl": "ctrl",
    "control": "ctrl",
    "cmd": "meta",
    "command": "meta",
    "win": "meta",
    "windows": "meta",
    "super": "meta",
    "alt": "alt",
    "option": "alt",
    "shift": "shift",
    "escape": "escape",
    "esc": "escape",
    "enter": "enter",
    "return": "enter",
    "backspace": "backspace",
    "delete": "delete",
    "del": "delete",
    "tab": "tab",
    "space": "space",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "insert": "insert",
    "ins": "insert",
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
}

_MODIFIERS = {"ctrl", "alt", "shift", "meta"}


@dataclass(frozen=True)
class KeyChord:
    """A single key chord, e.g. Ctrl+Shift+K."""
    ctrl: bool = False
    alt: bool = False
    shift: bool = False
    meta: bool = False
    key: str = ""

    def __str__(self) -> str:
        parts = []
        if self.ctrl:
            parts.append("Ctrl")
        if self.alt:
            parts.append("Alt")
        if self.shift:
            parts.append("Shift")
        if self.meta:
            parts.append("Meta")
        parts.append(self.key.upper() if len(self.key) == 1 else self.key.capitalize())
        return "+".join(parts)

    def to_canonical(self) -> str:
        """Canonical string for use as dict key."""
        mods = []
        if self.ctrl:
            mods.append("ctrl")
        if self.alt:
            mods.append("alt")
        if self.shift:
            mods.append("shift")
        if self.meta:
            mods.append("meta")
        mods.append(self.key.lower())
        return "+".join(mods)


def parse_key_chord(chord_str: str) -> Optional[KeyChord]:
    """
    Parse a key chord string like "Ctrl+Shift+K" or "ctrl+k".
    Returns None on parse error.
    """
    if not chord_str:
        return None

    parts = re.split(r"\+(?=[^+])", chord_str.strip())
    ctrl = alt = shift = meta = False
    key = ""

    for part in parts:
        normalized = _KEY_ALIASES.get(part.lower(), part.lower())
        if normalized == "ctrl":
            ctrl = True
        elif normalized == "alt":
            alt = True
        elif normalized == "shift":
            shift = True
        elif normalized == "meta":
            meta = True
        else:
            key = normalized

    if not key:
        return None

    return KeyChord(ctrl=ctrl, alt=alt, shift=shift, meta=meta, key=key)


def parse_keybinding(keybinding_str: str) -> List[KeyChord]:
    """
    Parse a keybinding string which may include chords (space separated).
    E.g. "Ctrl+K Ctrl+S" → [KeyChord(...), KeyChord(...)]
    """
    if not keybinding_str:
        return []

    chords = []
    for part in keybinding_str.strip().split():
        chord = parse_key_chord(part)
        if chord:
            chords.append(chord)
    return chords


def keybinding_to_qt(keybinding_str: str) -> str:
    """
    Convert a keybinding string to Qt key sequence format.
    E.g. "Ctrl+Shift+P" stays "Ctrl+Shift+P", "meta" → "Meta"
    """
    chords = parse_keybinding(keybinding_str)
    if not chords:
        return ""

    def chord_to_qt(c: KeyChord) -> str:
        parts = []
        if c.ctrl:
            parts.append("Ctrl")
        if c.alt:
            parts.append("Alt")
        if c.shift:
            parts.append("Shift")
        if c.meta:
            parts.append("Meta")
        k = c.key
        if len(k) == 1:
            parts.append(k.upper())
        else:
            parts.append(k.capitalize())
        return "+".join(parts)

    return ", ".join(chord_to_qt(c) for c in chords)


# ---------------------------------------------------------------------------
# Keybinding Entry
# ---------------------------------------------------------------------------

@dataclass
class KeybindingEntry:
    """A single keybinding rule."""
    key: str                   # raw string like "Ctrl+Shift+P"
    command: str               # command ID
    when: str = ""             # VS Code when clause
    args: Any = None           # optional arguments for the command
    source: str = "default"    # "default" | "user" | "extension"
    priority: int = 0          # higher = wins conflicts
    chords: List[KeyChord] = field(default_factory=list)

    def __post_init__(self):
        if not self.chords:
            self.chords = parse_keybinding(self.key)


# ---------------------------------------------------------------------------
# Keybinding Conflict
# ---------------------------------------------------------------------------

@dataclass
class KeybindingConflict:
    key: str
    winner: KeybindingEntry
    losers: List[KeybindingEntry]
    reason: str = ""


# ---------------------------------------------------------------------------
# Keybinding Resolver
# ---------------------------------------------------------------------------

class KeybindingResolver:
    """
    Resolves keybindings with proper priority-based conflict resolution.

    Priority order (VS Code style, highest first):
      1. User keybindings (source="user")
      2. Extension keybindings (source="extension")
      3. Default keybindings (source="default")
      Within same source: later registrations win.
    """

    _SOURCE_PRIORITY = {"user": 100, "extension": 50, "default": 0}

    def __init__(self):
        self._entries: List[KeybindingEntry] = []
        self._lock = threading.RLock()
        # Map from first chord canonical → list of entries (for O(1) lookup)
        self._chord_index: Dict[str, List[KeybindingEntry]] = {}
        self._conflicts: List[KeybindingConflict] = []

    def add(self, entry: KeybindingEntry) -> None:
        """Add a keybinding entry and rebuild the index."""
        with self._lock:
            # Set source-based priority if not explicitly set
            if entry.priority == 0:
                entry.priority = self._SOURCE_PRIORITY.get(entry.source, 0)
            self._entries.append(entry)
            self._rebuild_index()

    def add_many(self, entries: List[KeybindingEntry]) -> None:
        """Bulk add keybinding entries."""
        with self._lock:
            for entry in entries:
                if entry.priority == 0:
                    entry.priority = self._SOURCE_PRIORITY.get(entry.source, 0)
                self._entries.append(entry)
            self._rebuild_index()

    def remove_by_command(self, command_id: str, source: str = "user") -> None:
        """Remove all keybindings for a command from a specific source."""
        with self._lock:
            self._entries = [
                e for e in self._entries
                if not (e.command == command_id and e.source == source)
            ]
            self._rebuild_index()

    def remove_all_from_source(self, source: str) -> None:
        """Remove all keybindings from a given source."""
        with self._lock:
            self._entries = [e for e in self._entries if e.source != source]
            self._rebuild_index()

    def _rebuild_index(self) -> None:
        """Rebuild the chord-to-entries lookup table."""
        self._chord_index = {}
        for entry in self._entries:
            if entry.chords:
                first = entry.chords[0].to_canonical()
                if first not in self._chord_index:
                    self._chord_index[first] = []
                self._chord_index[first].append(entry)

    def resolve(
        self,
        chord_sequence: List[KeyChord],
        when_context: Optional[Dict[str, Any]] = None,
    ) -> Optional[KeybindingEntry]:
        """
        Resolve a key chord sequence to a command.

        Args:
            chord_sequence: The pressed chords.
            when_context: Current context for when-clause evaluation.

        Returns:
            The winning KeybindingEntry or None.
        """
        from pydardcor.core.context_keys import get_context_key_service

        if not chord_sequence:
            return None

        first_key = chord_sequence[0].to_canonical()

        with self._lock:
            candidates = self._chord_index.get(first_key, [])

        if not candidates:
            return None

        ctx_service = get_context_key_service()
        matching = []

        for entry in candidates:
            # Check chord sequence length matches
            if len(entry.chords) != len(chord_sequence):
                continue

            # Check all chords match
            if any(ec.to_canonical() != sc.to_canonical()
                   for ec, sc in zip(entry.chords, chord_sequence)):
                continue

            # Check when clause
            if entry.when and not ctx_service.evaluate(entry.when):
                continue

            matching.append(entry)

        if not matching:
            return None

        # Sort by priority (highest first), then by insertion order (last wins)
        matching.sort(key=lambda e: (e.priority, self._entries.index(e)), reverse=True)
        winner = matching[0]

        # Record conflict if multiple matched
        if len(matching) > 1:
            conflict = KeybindingConflict(
                key=first_key,
                winner=winner,
                losers=matching[1:],
                reason=f"Priority conflict resolved: {winner.source} > others",
            )
            self._conflicts.append(conflict)

        return winner

    def get_bindings_for_command(self, command_id: str) -> List[KeybindingEntry]:
        """Return all keybindings registered for a command."""
        with self._lock:
            return [e for e in self._entries if e.command == command_id]

    def get_all(self) -> List[KeybindingEntry]:
        """Return all registered keybindings."""
        with self._lock:
            return self._entries[:]

    def get_conflicts(self) -> List[KeybindingConflict]:
        """Return detected conflicts."""
        return self._conflicts[:]

    def get_command_title(self, command_id: str) -> str:
        """Try to get a display name for a command keybinding."""
        entries = self.get_bindings_for_command(command_id)
        if entries:
            return entries[-1].key  # user override last
        return ""


# ---------------------------------------------------------------------------
# Global Keybinding Manager
# ---------------------------------------------------------------------------

class KeybindingManager:
    """
    High-level keybinding manager that wraps KeybindingResolver.
    Handles loading/saving user keybindings, registering defaults, etc.
    """

    def __init__(self):
        self._resolver = KeybindingResolver()
        self._chord_state: List[KeyChord] = []  # for multi-key chords
        self._chord_timeout_id = None
        self._chord_timeout_s = 1.5  # seconds before chord resets
        self._lock = threading.RLock()
        self._execute_callback: Optional[Callable[[str, Any], None]] = None
        self._chord_pending_callback: Optional[Callable[[bool], None]] = None

    def set_execute_callback(self, cb: Callable[[str, Any], None]) -> None:
        """Set the function to call when a command should be executed."""
        self._execute_callback = cb

    def set_chord_pending_callback(self, cb: Callable[[bool], None]) -> None:
        """Set callback for when a chord is pending (true) or resolved (false)."""
        self._chord_pending_callback = cb

    def load_defaults(self, entries: List[KeybindingEntry]) -> None:
        """Load default keybindings."""
        self._resolver.add_many(entries)

    def load_user_keybindings(self, path: str) -> int:
        """Load user keybindings from keybindings.json. Returns count loaded."""
        import json
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            entries = []
            for item in data:
                if isinstance(item, dict) and "key" in item and "command" in item:
                    entry = KeybindingEntry(
                        key=item["key"],
                        command=item["command"],
                        when=item.get("when", ""),
                        args=item.get("args"),
                        source="user",
                    )
                    entries.append(entry)
            self._resolver.remove_all_from_source("user")
            self._resolver.add_many(entries)
            return len(entries)
        except Exception:
            return 0

    def save_user_keybindings(self, path: str) -> None:
        """Save current user keybindings to keybindings.json."""
        import json
        user = self._resolver.get_all()
        user_entries = [e for e in user if e.source == "user"]
        data = []
        for e in user_entries:
            item = {"key": e.key, "command": e.command}
            if e.when:
                item["when"] = e.when
            if e.args is not None:
                item["args"] = e.args
            data.append(item)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def register_user_keybinding(
        self,
        key: str,
        command: str,
        when: str = "",
        args: Any = None,
    ) -> None:
        """Register/override a single user keybinding."""
        entry = KeybindingEntry(
            key=key, command=command, when=when, args=args, source="user"
        )
        self._resolver.add(entry)

    def handle_key(self, chord: KeyChord) -> bool:
        """
        Process a pressed key chord. Returns True if event was consumed.
        Handles multi-chord sequences (e.g. Ctrl+K Ctrl+S).
        """
        with self._lock:
            self._chord_state.append(chord)
            entry = self._resolver.resolve(self._chord_state)

            if entry is not None:
                # Command matched
                cmd_id = entry.command
                args = entry.args
                self._chord_state.clear()
                if self._chord_pending_callback:
                    self._chord_pending_callback(False)
                if self._execute_callback:
                    self._execute_callback(cmd_id, args)
                return True

            # Check if any partial chord matches exist
            first_key = self._chord_state[0].to_canonical()
            has_partial = first_key in self._resolver._chord_index

            if has_partial and len(self._chord_state) == 1:
                # Waiting for second chord
                if self._chord_pending_callback:
                    self._chord_pending_callback(True)
                return True  # consumed, waiting for next key

            # No match — clear state
            self._chord_state.clear()
            if self._chord_pending_callback:
                self._chord_pending_callback(False)
            return False

    def get_resolver(self) -> KeybindingResolver:
        return self._resolver


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

_global_kb_manager: Optional[KeybindingManager] = None
_kb_lock = threading.Lock()


def get_keybinding_manager() -> KeybindingManager:
    global _global_kb_manager
    if _global_kb_manager is None:
        with _kb_lock:
            if _global_kb_manager is None:
                _global_kb_manager = KeybindingManager()
    return _global_kb_manager


def reset_keybinding_manager() -> None:
    global _global_kb_manager
    with _kb_lock:
        _global_kb_manager = None
