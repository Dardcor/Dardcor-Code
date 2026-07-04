"""Hook registry — run shell/script hooks on agent lifecycle events."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


HOOK_EVENTS = frozenset({"before_tool", "after_tool", "on_start", "on_stop", "on_error"})


@dataclass
class HookDef:
    """A single hook bound to an event."""

    event: str
    command: str
    cwd: Optional[str] = None
    timeout_seconds: float = 30.0

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"event": self.event, "command": self.command}
        if self.cwd is not None:
            data["cwd"] = self.cwd
        if self.timeout_seconds != 30.0:
            data["timeout_seconds"] = self.timeout_seconds
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Optional[HookDef]:
        event = data.get("event")
        command = data.get("command")
        if not isinstance(event, str) or not isinstance(command, str):
            return None
        timeout = data.get("timeout_seconds", 30.0)
        try:
            timeout_f = float(timeout)
        except (TypeError, ValueError):
            timeout_f = 30.0
        cwd = data.get("cwd")
        return cls(
            event=event,
            command=command,
            cwd=cwd if isinstance(cwd, str) else None,
            timeout_seconds=timeout_f,
        )


@dataclass
class HookResult:
    """Outcome of executing one hook."""

    hook: HookDef
    returncode: int
    stdout: str
    stderr: str
    error: Optional[str] = None


class HookRegistry:
    """Registry of event hooks loaded from JSON config."""

    def __init__(self, config_path: str | Path) -> None:
        self.config_path = Path(config_path)
        self._hooks: list[HookDef] = []

    def load(self) -> None:
        """Load hooks from disk. Missing file yields an empty registry."""
        self._hooks = []
        if not self.config_path.is_file():
            return
        try:
            raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        if not isinstance(raw, dict):
            return
        entries = raw.get("hooks", [])
        if not isinstance(entries, list):
            return
        for entry in entries:
            if isinstance(entry, dict):
                hook = HookDef.from_dict(entry)
                if hook is not None:
                    self._hooks.append(hook)

    def save(self) -> None:
        """Persist hooks to disk."""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"hooks": [h.to_dict() for h in self._hooks]}
        self.config_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def register(self, hook: HookDef) -> None:
        self._hooks.append(hook)

    def list_hooks(self, event: Optional[str] = None) -> list[HookDef]:
        if event is None:
            return list(self._hooks)
        return [h for h in self._hooks if h.event == event]

    def run(self, event: str, env: Optional[dict[str, str]] = None) -> list[HookResult]:
        """Execute all hooks registered for *event*."""
        results: list[HookResult] = []
        for hook in self.list_hooks(event):
            results.append(self._execute(hook, env))
        return results

    def _execute(self, hook: HookDef, env: Optional[dict[str, str]]) -> HookResult:
        try:
            completed = subprocess.run(
                hook.command,
                shell=True,
                cwd=hook.cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=hook.timeout_seconds,
            )
            return HookResult(
                hook=hook,
                returncode=completed.returncode,
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
            )
        except subprocess.TimeoutExpired as exc:
            return HookResult(
                hook=hook,
                returncode=-1,
                stdout=exc.stdout or "" if isinstance(exc.stdout, str) else "",
                stderr=exc.stderr or "" if isinstance(exc.stderr, str) else "",
                error=f"timeout after {hook.timeout_seconds}s",
            )
        except OSError as exc:
            return HookResult(
                hook=hook,
                returncode=-1,
                stdout="",
                stderr="",
                error=str(exc),
            )
