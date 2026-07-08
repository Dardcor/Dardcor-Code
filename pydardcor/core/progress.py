"""
Progress Service — TASK-0013
=============================
Progress reporting dengan cancellable operation.
Mirip VS Code: src/vs/platform/progress/common/progress.ts
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


class ProgressLocation(Enum):
    NOTIFICATION = "notification"
    STATUS_BAR = "statusBar"
    EXPLORER = "explorer"
    SCM = "scm"
    EXTENSIONS = "extensions"
    WINDOW = "window"
    DIALOG = "dialog"


@dataclass
class ProgressOptions:
    location: ProgressLocation = ProgressLocation.WINDOW
    title: str = ""
    source: str = ""
    total: int = 0
    cancellable: bool = False


@dataclass
class ProgressStep:
    message: str = ""
    increment: float = 0
    total: float = 100


class Progress:
    """
    Progress reporter for a single operation.
    """

    def __init__(
        self,
        options: ProgressOptions,
        on_report: Optional[Callable[[ProgressStep], None]] = None,
    ):
        self._id = str(uuid.uuid4())
        self.options = options
        self._on_report = on_report
        self._current = 0.0
        self._message = ""
        self._cancelled = False
        self._done = False

    def report(self, step: ProgressStep) -> None:
        """Report progress."""
        if self._done:
            return
        self._message = step.message
        if step.increment:
            self._current = min(100.0, self._current + step.increment)
        if self._on_report:
            self._on_report(step)

    def cancel(self) -> None:
        self._cancelled = True

    def done(self) -> None:
        self._done = True
        self._current = 100.0

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    @property
    def is_done(self) -> bool:
        return self._done

    @property
    def current(self) -> float:
        return self._current

    @property
    def message(self) -> str:
        return self._message

    @property
    def id(self) -> str:
        return self._id


@dataclass
class ProgressTask:
    id: str
    options: ProgressOptions
    progress: Progress
    listeners: List[Callable[[ProgressStep], None]] = field(default_factory=list)


class ProgressService:
    """
    Central service for managing progress indicators.
    Mirrors VS Code IProgressService.
    """

    def __init__(self):
        self._tasks: Dict[str, ProgressTask] = {}
        self._lock = threading.RLock()
        self._global_listeners: List[Callable[[str, ProgressStep], None]] = []

    def with_progress(
        self,
        options: ProgressOptions,
        task: Callable[[Progress], Any],
    ) -> Any:
        """
        Run a task with progress reporting.

        Args:
            options: Progress display options.
            task: Callable receiving a Progress reporter.

        Returns:
            The return value of task.
        """
        def _on_report(step: ProgressStep):
            for cb in self._global_listeners:
                try:
                    cb(prog_task.id, step)
                except Exception:
                    pass

        progress = Progress(options, on_report=_on_report)
        prog_task = ProgressTask(
            id=progress.id,
            options=options,
            progress=progress,
        )

        with self._lock:
            self._tasks[progress.id] = prog_task

        try:
            result = task(progress)
        finally:
            progress.done()
            with self._lock:
                self._tasks.pop(progress.id, None)
            # Final report
            _on_report(ProgressStep(message="", increment=0))

        return result

    def on_progress(self, callback: Callable[[str, ProgressStep], None]) -> None:
        """Listen to all active progress updates."""
        self._global_listeners.append(callback)

    def get_active_tasks(self) -> List[ProgressTask]:
        with self._lock:
            return list(self._tasks.values())

    def cancel(self, task_id: str) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
        if task:
            task.progress.cancel()


# Global singleton
_global_progress: Optional[ProgressService] = None
_progress_lock = threading.Lock()


def get_progress_service() -> ProgressService:
    global _global_progress
    if _global_progress is None:
        with _progress_lock:
            if _global_progress is None:
                _global_progress = ProgressService()
    return _global_progress
