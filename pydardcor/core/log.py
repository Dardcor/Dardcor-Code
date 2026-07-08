"""
Logging Framework — TASK-0009
==============================
Structured logging dengan channel, level, dan file rotation.
Mirip VS Code: src/vs/platform/log/common/log.ts

Fitur:
- Named channels (output channels)
- Log levels: trace/debug/info/warn/error/critical
- File rotation dengan max size
- In-memory buffer per channel
- Qt signal-compatible (notifies UI)
- VS Code ILogService API
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
import threading
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Log Level enum (mirrors VS Code LogLevel)
# ---------------------------------------------------------------------------

class LogLevel(IntEnum):
    TRACE = 0
    DEBUG = 1
    INFO = 2
    WARNING = 3
    ERROR = 4
    CRITICAL = 5
    OFF = 6


_LEVEL_TO_PYTHON = {
    LogLevel.TRACE: logging.DEBUG,
    LogLevel.DEBUG: logging.DEBUG,
    LogLevel.INFO: logging.INFO,
    LogLevel.WARNING: logging.WARNING,
    LogLevel.ERROR: logging.ERROR,
    LogLevel.CRITICAL: logging.CRITICAL,
}


# ---------------------------------------------------------------------------
# Log Entry
# ---------------------------------------------------------------------------

@dataclass
class LogEntry:
    channel: str
    level: LogLevel
    message: str
    timestamp: float
    args: tuple = field(default_factory=tuple)

    def formatted(self) -> str:
        import datetime
        dt = datetime.datetime.fromtimestamp(self.timestamp).strftime("%H:%M:%S.%f")[:-3]
        level_name = self.level.name
        return f"[{dt}] [{level_name}] {self.message}"


# ---------------------------------------------------------------------------
# Log Channel
# ---------------------------------------------------------------------------

class LogChannel:
    """A named log output channel with in-memory buffer."""

    MAX_BUFFER = 10_000

    def __init__(self, name: str, level: LogLevel = LogLevel.INFO):
        self.name = name
        self._level = level
        self._buffer: List[LogEntry] = []
        self._lock = threading.Lock()
        self._listeners: List[Callable[[LogEntry], None]] = []
        self._python_logger = logging.getLogger(f"dardcor.{name}")

    def set_level(self, level: LogLevel) -> None:
        self._level = level
        self._python_logger.setLevel(_LEVEL_TO_PYTHON.get(level, logging.INFO))

    def get_level(self) -> LogLevel:
        return self._level

    def _log(self, level: LogLevel, message: str, *args) -> None:
        if level < self._level:
            return
        import time
        if args:
            try:
                message = message % args
            except Exception:
                message = f"{message} {args}"

        entry = LogEntry(
            channel=self.name,
            level=level,
            message=message,
            timestamp=time.time(),
        )
        with self._lock:
            self._buffer.append(entry)
            if len(self._buffer) > self.MAX_BUFFER:
                self._buffer = self._buffer[-self.MAX_BUFFER:]

        # Python logger
        py_level = _LEVEL_TO_PYTHON.get(level, logging.INFO)
        self._python_logger.log(py_level, message)

        # Notify listeners
        for cb in self._listeners:
            try:
                cb(entry)
            except Exception:
                pass

    def trace(self, msg: str, *args) -> None:
        self._log(LogLevel.TRACE, msg, *args)

    def debug(self, msg: str, *args) -> None:
        self._log(LogLevel.DEBUG, msg, *args)

    def info(self, msg: str, *args) -> None:
        self._log(LogLevel.INFO, msg, *args)

    def warn(self, msg: str, *args) -> None:
        self._log(LogLevel.WARNING, msg, *args)

    def error(self, msg: str, *args) -> None:
        self._log(LogLevel.ERROR, msg, *args)

    def critical(self, msg: str, *args) -> None:
        self._log(LogLevel.CRITICAL, msg, *args)

    def on_entry(self, callback: Callable[[LogEntry], None]) -> None:
        """Register a callback for new log entries."""
        self._listeners.append(callback)

    def get_entries(self, level: LogLevel = LogLevel.TRACE, limit: int = 500) -> List[LogEntry]:
        """Return recent log entries above the given level."""
        with self._lock:
            return [e for e in self._buffer if e.level >= level][-limit:]

    def clear(self) -> None:
        with self._lock:
            self._buffer.clear()


# ---------------------------------------------------------------------------
# Log Service
# ---------------------------------------------------------------------------

class LogService:
    """
    Central log service managing multiple named channels.
    Mirrors: ILogService in VS Code.
    """

    def __init__(self, log_dir: Optional[str] = None, global_level: LogLevel = LogLevel.INFO):
        self._channels: Dict[str, LogChannel] = {}
        self._global_level = global_level
        self._lock = threading.RLock()
        self._log_dir = log_dir
        self._main_channel = self._get_or_create("main")
        self._setup_root_logger()

    def _setup_root_logger(self) -> None:
        """Configure Python root logging."""
        root = logging.getLogger("dardcor")
        root.setLevel(_LEVEL_TO_PYTHON.get(self._global_level, logging.INFO))

        if not root.handlers:
            handler = logging.StreamHandler(sys.stderr)
            handler.setFormatter(
                logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
            )
            root.addHandler(handler)

        if self._log_dir:
            os.makedirs(self._log_dir, exist_ok=True)
            log_file = os.path.join(self._log_dir, "dardcor.log")
            file_handler = logging.handlers.RotatingFileHandler(
                log_file,
                maxBytes=5 * 1024 * 1024,  # 5MB
                backupCount=3,
                encoding="utf-8",
            )
            file_handler.setFormatter(
                logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
            )
            root.addHandler(file_handler)

    def _get_or_create(self, channel_name: str) -> LogChannel:
        with self._lock:
            if channel_name not in self._channels:
                ch = LogChannel(channel_name, self._global_level)
                self._channels[channel_name] = ch
            return self._channels[channel_name]

    def channel(self, name: str = "main") -> LogChannel:
        """Get or create a named log channel."""
        return self._get_or_create(name)

    # Convenience methods on main channel
    def trace(self, msg: str, *args) -> None:
        self._main_channel.trace(msg, *args)

    def debug(self, msg: str, *args) -> None:
        self._main_channel.debug(msg, *args)

    def info(self, msg: str, *args) -> None:
        self._main_channel.info(msg, *args)

    def warn(self, msg: str, *args) -> None:
        self._main_channel.warn(msg, *args)

    def error(self, msg: str, *args) -> None:
        self._main_channel.error(msg, *args)

    def critical(self, msg: str, *args) -> None:
        self._main_channel.critical(msg, *args)

    def set_level(self, level: LogLevel, channel: Optional[str] = None) -> None:
        """Set log level globally or for a specific channel."""
        if channel:
            self._get_or_create(channel).set_level(level)
        else:
            self._global_level = level
            with self._lock:
                for ch in self._channels.values():
                    ch.set_level(level)

    def get_channels(self) -> List[str]:
        with self._lock:
            return list(self._channels.keys())


# ---------------------------------------------------------------------------
# Global LogService singleton
# ---------------------------------------------------------------------------

_global_log_service: Optional[LogService] = None
_log_lock = threading.Lock()


def get_log_service(log_dir: Optional[str] = None) -> LogService:
    global _global_log_service
    if _global_log_service is None:
        with _log_lock:
            if _global_log_service is None:
                _global_log_service = LogService(log_dir=log_dir)
    return _global_log_service


def reset_log_service() -> None:
    global _global_log_service
    with _log_lock:
        _global_log_service = None
