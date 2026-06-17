import os
import json
import logging
from typing import Dict, List, Optional, Callable
from PySide6.QtGui import QKeySequence

logger = logging.getLogger(__name__)

class KeybindingsManager:
    """Manages custom keybindings with 'when' clause context evaluation."""

    def __init__(self, config_dir: str):
        self.config_dir = config_dir
        self.keybindings_path = os.path.join(config_dir, "keybindings.json")
        self.bindings: List[dict] = []
        self._contexts: Dict[str, bool] = {
            "editorTextFocus": True,
            "inDebugMode": False,
            "sideBarVisible": True,
            "panelFocus": False,
        }
        
        self.load()

    def load(self):
        """Load keybindings from keybindings.json."""
        if not os.path.exists(self.keybindings_path):
            self.bindings = []
            return

        try:
            with open(self.keybindings_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Simple comment removal
                lines = [line for line in content.split('\n') if not line.strip().startswith('//')]
                self.bindings = json.loads('\n'.join(lines))
                logger.info(f"Loaded {len(self.bindings)} keybindings.")
        except Exception as e:
            logger.error(f"Failed to load keybindings: {e}")
            self.bindings = []

    def set_context(self, key: str, value: bool):
        """Update a context value for 'when' clause evaluation."""
        self._contexts[key] = value

    def evaluate_when(self, when_clause: str) -> bool:
        """
        Evaluate a simple 'when' clause expression.
        E.g., "editorTextFocus && !inDebugMode"
        """
        if not when_clause:
            return True
            
        parts = [p.strip() for p in when_clause.split("&&")]
        for part in parts:
            if part.startswith("!"):
                key = part[1:]
                if self._contexts.get(key, False):
                    return False
            else:
                if not self._contexts.get(part, False):
                    return False
        return True

    def get_command_for_key(self, key_sequence: QKeySequence) -> Optional[str]:
        """Find the command bound to the given key sequence, considering active contexts."""
        key_str = key_sequence.toString()
        # VS Code uses e.g. "ctrl+c", Qt uses "Ctrl+C"
        key_str = key_str.lower().replace("+", "")
        
        for binding in reversed(self.bindings): # Last one wins
            b_key = binding.get("key", "").lower().replace("+", "")
            if b_key == key_str:
                when = binding.get("when", "")
                if self.evaluate_when(when):
                    return binding.get("command")
        return None
