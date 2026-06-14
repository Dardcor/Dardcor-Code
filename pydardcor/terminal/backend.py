"""Terminal Backend - Platform-agnostic PTY factory."""

import platform
import os
import time
from PySide6.QtCore import Signal, QThread

def get_shell_cmd() -> str:
    """Return the best available shell executable path."""
    if platform.system() == "Windows":
        for candidate in ("pwsh.exe", "powershell.exe", "cmd.exe"):
            for base in os.environ.get("PATH", "").split(os.pathsep):
                p = os.path.join(base, candidate)
                if os.path.isfile(p):
                    return p
        return "cmd.exe"
    return os.environ.get("SHELL", "/bin/bash")

HAS_PTY = True

def create_pty(cols: int, rows: int, cmd: str, cwd: str, env: dict = None):
    """Factory method to create the appropriate PTY wrapper for the current OS."""
    if platform.system() == "Windows":
        from .win_backend import WinPtyWrapper, HAS_WINPTY
        if not HAS_WINPTY:
            raise RuntimeError("pywinpty not installed")
        return WinPtyWrapper(cols, rows, cmd, cwd, env)
    else:
        from .unix_backend import UnixPtyWrapper, HAS_UNIX_PTY
        if not HAS_UNIX_PTY:
            raise RuntimeError("POSIX pty not available")
        return UnixPtyWrapper(cols, rows, cmd, cwd, env)


class PtyReaderThread(QThread):
    """
    Background thread that continuously reads PTY output.
    """

    data_ready = Signal(str)

    def __init__(self, pty_instance, parent=None):
        super().__init__(parent)
        self.pty = pty_instance
        self._running = True

    def run(self):
        while self._running:
            if not self.pty.isalive() and self.pty.iseof():
                break

            try:
                # blocking=True waits until data is available or timeout
                raw = self.pty.read(blocking=True)
            except Exception:
                time.sleep(0.005)
                continue

            if not raw:
                if not self.pty.isalive():
                    break
                time.sleep(0.001)
                continue

            if isinstance(raw, bytes):
                text = raw.decode("utf-8", errors="replace")
            else:
                text = str(raw)

            if text:
                self.data_ready.emit(text)

    def stop(self):
        self._running = False
        try:
            self.pty.cancel_io()
        except Exception:
            pass
        self.quit()
        self.wait(2000)
