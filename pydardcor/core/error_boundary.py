"""
Error Boundary — TASK-0012
===========================
Global error handler + per-component recovery.
Mirip VS Code: src/vs/platform/errorBoundary
"""

from __future__ import annotations

import sys
import traceback
import threading
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional, Type


logger = logging.getLogger("dardcor.error_boundary")


@dataclass
class ErrorReport:
    component: str
    error: Exception
    traceback_str: str
    context: dict = field(default_factory=dict)
    recovered: bool = False


class ErrorBoundary:
    """
    Wraps a component to catch and optionally recover from errors.
    Fires error listeners for logging/notification.
    """

    def __init__(self, component_name: str, recover_fn: Optional[Callable] = None):
        self._name = component_name
        self._recover_fn = recover_fn
        self._error_log: List[ErrorReport] = []
        self._listeners: List[Callable[[ErrorReport], None]] = []

    def run(self, fn: Callable, *args, **kwargs) -> Any:
        """Run a function inside this error boundary."""
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            tb = traceback.format_exc()
            report = ErrorReport(
                component=self._name,
                error=exc,
                traceback_str=tb,
            )
            self._error_log.append(report)
            logger.error("[%s] Unhandled error: %s\n%s", self._name, exc, tb)

            # Attempt recovery
            if self._recover_fn:
                try:
                    self._recover_fn(exc)
                    report.recovered = True
                except Exception:
                    pass

            # Notify listeners
            for cb in self._listeners:
                try:
                    cb(report)
                except Exception:
                    pass

            return None

    def on_error(self, callback: Callable[[ErrorReport], None]) -> None:
        self._listeners.append(callback)

    def get_errors(self) -> List[ErrorReport]:
        return self._error_log[:]

    def clear_errors(self) -> None:
        self._error_log.clear()


class GlobalErrorHandler:
    """
    Global uncaught exception handler.
    Installs sys.excepthook and threading.excepthook.
    """

    def __init__(self):
        self._listeners: List[Callable[[ErrorReport], None]] = []
        self._install()

    def _install(self) -> None:
        sys.excepthook = self._handle_excepthook
        if hasattr(threading, "excepthook"):
            threading.excepthook = self._handle_thread_excepthook

    def _handle_excepthook(self, exc_type, exc_value, exc_tb) -> None:
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        tb_str = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        logger.critical("Uncaught exception: %s\n%s", exc_value, tb_str)
        report = ErrorReport("global", exc_value, tb_str)
        for cb in self._listeners:
            try:
                cb(report)
            except Exception:
                pass

    def _handle_thread_excepthook(self, args) -> None:
        exc_type = args.exc_type
        exc_value = args.exc_value
        exc_tb = args.exc_traceback
        if issubclass(exc_type, SystemExit):
            return
        tb_str = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        thread_name = args.thread.name if args.thread else "unknown"
        logger.error("Uncaught exception in thread %s: %s\n%s", thread_name, exc_value, tb_str)
        report = ErrorReport(f"thread:{thread_name}", exc_value, tb_str)
        for cb in self._listeners:
            try:
                cb(report)
            except Exception:
                pass

    def on_error(self, callback: Callable[[ErrorReport], None]) -> None:
        self._listeners.append(callback)


# Global
_global_error_handler: Optional[GlobalErrorHandler] = None
_eh_lock = threading.Lock()


def get_error_handler() -> GlobalErrorHandler:
    global _global_error_handler
    if _global_error_handler is None:
        with _eh_lock:
            if _global_error_handler is None:
                _global_error_handler = GlobalErrorHandler()
    return _global_error_handler


def create_boundary(name: str, recover_fn: Optional[Callable] = None) -> ErrorBoundary:
    """Factory: create a named error boundary."""
    return ErrorBoundary(name, recover_fn)
