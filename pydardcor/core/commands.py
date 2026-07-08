from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

@dataclass
class CommandCategory:
    id: str
    label: str


@dataclass
class CommandDefinition:
    id: str
    handler: Callable[..., Any]
    title: str = ""
    category: str = ""
    icon: str = ""
    description: str = ""
    when: str = ""  # VS Code when clause
    keybinding: str = ""
    precondition: str = ""
    toggle_condition: str = ""


# ---------------------------------------------------------------------------
# Command Result
# ---------------------------------------------------------------------------

@dataclass
class CommandResult:
    command_id: str
    success: bool
    value: Any = None
    error: Optional[Exception] = None
    duration_ms: float = 0.0


# ---------------------------------------------------------------------------
# Command Progress Reporter
# ---------------------------------------------------------------------------

class CommandProgressReporter:
    """Allows a command handler to report incremental progress."""

    def __init__(self, on_progress: Optional[Callable[[str, float], None]] = None):
        self._on_progress = on_progress
        self._message = ""
        self._percent = 0.0
        self._cancelled = False

    def report(self, message: str = "", percent: float = -1.0) -> None:
        self._message = message
        if percent >= 0:
            self._percent = min(100.0, max(0.0, percent))
        if self._on_progress:
            self._on_progress(message, self._percent)

    def cancel(self) -> None:
        self._cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    @property
    def message(self) -> str:
        return self._message

    @property
    def percent(self) -> float:
        return self._percent


# ---------------------------------------------------------------------------
# Command Registry
# ---------------------------------------------------------------------------

class CommandRegistry:
    """
    Central registry for all application commands.
    Mirrors: ICommandService in VS Code.
    """

    def __init__(self):
        self._commands: Dict[str, CommandDefinition] = {}
        self._history: List[Tuple[str, Any]] = []  # (command_id, args)
        self._lock = threading.RLock()
        self._listeners: List[Callable[[str], None]] = []
        self._max_history = 100

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(
        self,
        command_id: str,
        handler: Callable[..., Any],
        *,
        title: str = "",
        category: str = "",
        icon: str = "",
        description: str = "",
        when: str = "",
        keybinding: str = "",
        precondition: str = "",
        toggle_condition: str = "",
    ) -> None:
        """Register a new command."""
        cmd = CommandDefinition(
            id=command_id,
            handler=handler,
            title=title,
            category=category,
            icon=icon,
            description=description,
            when=when,
            keybinding=keybinding,
            precondition=precondition,
            toggle_condition=toggle_condition,
        )
        with self._lock:
            self._commands[command_id] = cmd
        logger.debug("Registered command: %s", command_id)

    def unregister(self, command_id: str) -> None:
        """Unregister a command."""
        with self._lock:
            self._commands.pop(command_id, None)

    def register_many(self, definitions: List[Dict[str, Any]]) -> None:
        """Bulk register commands from a list of dicts."""
        for defn in definitions:
            cmd_id = defn.get("id")
            handler = defn.get("handler")
            if cmd_id and handler:
                self.register(
                    cmd_id,
                    handler,
                    title=defn.get("title", ""),
                    category=defn.get("category", ""),
                    icon=defn.get("icon", ""),
                    description=defn.get("description", ""),
                    when=defn.get("when", ""),
                    keybinding=defn.get("keybinding", ""),
                )

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    def execute(
        self,
        command_id: str,
        *args: Any,
        progress: Optional[CommandProgressReporter] = None,
        **kwargs: Any,
    ) -> CommandResult:
        """
        Execute a registered command.

        Args:
            command_id: The command ID to run.
            *args: Positional arguments passed to the handler.
            progress: Optional progress reporter.
            **kwargs: Keyword arguments passed to the handler.

        Returns:
            CommandResult with success status, return value, and timing.
        """
        with self._lock:
            cmd = self._commands.get(command_id)

        if cmd is None:
            err = KeyError(f"Command not found: {command_id!r}")
            logger.warning("Command not found: %s", command_id)
            return CommandResult(
                command_id=command_id,
                success=False,
                error=err,
            )

        start = time.perf_counter()
        try:
            # Inject progress if handler accepts it
            import inspect
            sig = inspect.signature(cmd.handler)
            params = list(sig.parameters.values())
            has_progress_param = any(
                p.name == "progress" for p in params
            )

            if has_progress_param and progress is not None:
                value = cmd.handler(*args, progress=progress, **kwargs)
            else:
                value = cmd.handler(*args, **kwargs)

            elapsed = (time.perf_counter() - start) * 1000

            # Record in history
            self._record_history(command_id, args)

            # Notify listeners
            self._notify_executed(command_id)

            return CommandResult(
                command_id=command_id,
                success=True,
                value=value,
                duration_ms=elapsed,
            )

        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            logger.exception("Command %s raised: %s", command_id, exc)
            return CommandResult(
                command_id=command_id,
                success=False,
                error=exc,
                duration_ms=elapsed,
            )

    def execute_if_registered(self, command_id: str, *args: Any, **kwargs: Any) -> Optional[CommandResult]:
        """Execute command only if registered. Returns None if not found."""
        with self._lock:
            exists = command_id in self._commands
        if exists:
            return self.execute(command_id, *args, **kwargs)
        return None

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get(self, command_id: str) -> Optional[CommandDefinition]:
        """Return the CommandDefinition for a command ID."""
        with self._lock:
            return self._commands.get(command_id)

    def has(self, command_id: str) -> bool:
        """Check if a command is registered."""
        with self._lock:
            return command_id in self._commands

    def get_all(self) -> List[CommandDefinition]:
        """Return all registered commands (sorted by ID)."""
        with self._lock:
            return sorted(self._commands.values(), key=lambda c: c.id)

    def search(self, query: str) -> List[CommandDefinition]:
        """Fuzzy search commands by title or ID."""
        query = query.lower()
        with self._lock:
            cmds = list(self._commands.values())
        results = []
        for cmd in cmds:
            searchable = f"{cmd.id} {cmd.title} {cmd.category}".lower()
            if query in searchable:
                results.append(cmd)
        return results

    def get_by_category(self, category: str) -> List[CommandDefinition]:
        """Return all commands in a category."""
        with self._lock:
            return [c for c in self._commands.values() if c.category == category]

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def _record_history(self, command_id: str, args: tuple) -> None:
        self._history.append((command_id, args))
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    def get_history(self) -> List[Tuple[str, Any]]:
        """Return recent command history."""
        return self._history[:]

    def get_recently_used(self, limit: int = 10) -> List[str]:
        """Return most recently used command IDs (deduplicated, order preserved)."""
        seen: List[str] = []
        for cmd_id, _ in reversed(self._history):
            if cmd_id not in seen:
                seen.append(cmd_id)
            if len(seen) >= limit:
                break
        return seen

    # ------------------------------------------------------------------
    # Listeners (on command executed)
    # ------------------------------------------------------------------

    def on_execute(self, callback: Callable[[str], None]) -> None:
        """Register a callback that fires after each command execution."""
        self._listeners.append(callback)

    def _notify_executed(self, command_id: str) -> None:
        for cb in self._listeners:
            try:
                cb(command_id)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Global Command Registry singleton
# ---------------------------------------------------------------------------

_global_registry: Optional[CommandRegistry] = None
_registry_lock = threading.Lock()


def get_command_registry() -> CommandRegistry:
    """Return the global CommandRegistry singleton."""
    global _global_registry
    if _global_registry is None:
        with _registry_lock:
            if _global_registry is None:
                _global_registry = CommandRegistry()
    return _global_registry


def reset_command_registry() -> None:
    """Reset for tests."""
    global _global_registry
    with _registry_lock:
        _global_registry = None


# ---------------------------------------------------------------------------
# Decorator API — @command("workbench.action.openFile")
# ---------------------------------------------------------------------------

def command(
    command_id: str,
    *,
    title: str = "",
    category: str = "",
    icon: str = "",
    description: str = "",
    when: str = "",
    keybinding: str = "",
) -> Callable:
    """
    Decorator to register a function as a command.

    Usage:
        @command("editor.action.formatDocument", title="Format Document", keybinding="Shift+Alt+F")
        def format_document():
            ...
    """
    def decorator(fn: Callable) -> Callable:
        get_command_registry().register(
            command_id,
            fn,
            title=title,
            category=category,
            icon=icon,
            description=description,
            when=when,
            keybinding=keybinding,
        )
        return fn
    return decorator


# ---------------------------------------------------------------------------
# Convenience: execute command on global registry
# ---------------------------------------------------------------------------

def execute_command(command_id: str, *args: Any, **kwargs: Any) -> CommandResult:
    """Execute a command on the global registry."""
    return get_command_registry().execute(command_id, *args, **kwargs)


# ---------------------------------------------------------------------------
# Command Executor
# ---------------------------------------------------------------------------

class CommandExecutor:
    """Helper to execute system/shell commands."""
    def __init__(self, workspace_path: str = ""):
        self.workspace_path = workspace_path

    def run(self, cmd: str, timeout: float = 30.0) -> CommandResult:
        import subprocess
        import time
        import os
        start = time.perf_counter()
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            res = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=self.workspace_path or None,
                **kwargs
            )
            elapsed = (time.perf_counter() - start) * 1000
            return CommandResult(
                command_id=cmd,
                success=(res.returncode == 0),
                value=res.stdout + res.stderr,
                duration_ms=elapsed
            )
        except Exception as e:
            elapsed = (time.perf_counter() - start) * 1000
            return CommandResult(
                command_id=cmd,
                success=False,
                error=e,
                duration_ms=elapsed
            )
