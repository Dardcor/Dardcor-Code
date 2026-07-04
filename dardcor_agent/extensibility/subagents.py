"""Subagent registry — named subagent definitions loaded from JSON config."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


@dataclass
class SubagentDef:
    """Definition for a delegatable subagent."""

    name: str
    description: str
    model: Optional[str] = None
    readonly: bool = False

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "description": self.description,
            "readonly": self.readonly,
        }
        if self.model is not None:
            data["model"] = self.model
        return data

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> SubagentDef:
        return cls(
            name=name,
            description=str(data.get("description", "")),
            model=data.get("model") if isinstance(data.get("model"), str) else None,
            readonly=bool(data.get("readonly", False)),
        )


class SubagentRegistry:
    """Registry of subagent definitions backed by a JSON config file."""

    def __init__(self, config_path: str | Path) -> None:
        self.config_path = Path(config_path)
        self._subagents: dict[str, SubagentDef] = {}

    def load(self) -> None:
        """Load subagents from disk. Missing file yields an empty registry."""
        self._subagents = {}
        if not self.config_path.is_file():
            return
        try:
            raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        if not isinstance(raw, dict):
            return
        entries = raw.get("subagents", raw)
        if not isinstance(entries, dict):
            return
        for name, entry in entries.items():
            if isinstance(name, str) and isinstance(entry, dict):
                self._subagents[name] = SubagentDef.from_dict(name, entry)

    def save(self) -> None:
        """Persist subagent definitions to disk."""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "subagents": {name: s.to_dict() for name, s in sorted(self._subagents.items())}
        }
        self.config_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def list_subagents(self) -> list[SubagentDef]:
        return [self._subagents[k] for k in sorted(self._subagents)]

    def get(self, name: str) -> Optional[SubagentDef]:
        return self._subagents.get(name)

    def set_subagent(self, subagent: SubagentDef) -> None:
        self._subagents[subagent.name] = subagent
