"""Terminal Backend - PTY process management for pywinpty 3.x and shell detection."""

import os
import platform
import sys
import site
import time

from PySide6.QtCore import Signal, QThread

# Ensure user site-packages in path so pywinpty is importable
user_site = site.getusersitepackages()
if user_site not in sys.path:
    sys.path.append(user_site)

try:
    # pywinpty 3.x exposes PTY under both 'pywinpty' and 'winpty'
    try:
        from pywinpty import PTY
    except ImportError:
        from winpty import PTY
    HAS_PTY = True
except ImportError:
    HAS_PTY = False


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


class PtyReaderThread(QThread):
    """
    Background thread that continuously reads PTY output.

    pywinpty 3.x API:
        PTY.read(blocking=False) -> bytes   (non-blocking by default)
        PTY.isalive() -> bool
        PTY.iseof()   -> bool
    """

    data_ready = Signal(str)

    def __init__(self, pty_instance, parent=None):
        super().__init__(parent)
        self.pty = pty_instance
        self._running = True

    def run(self):
        while self._running:
            # Stop if process is dead and output drained
            if not self.pty.isalive() and self.pty.iseof():
                break

            try:
                # blocking=True waits until data is available
                raw = self.pty.read(blocking=True)
            except Exception:
                time.sleep(0.005)
                continue

            if not raw:
                # blocking=True returned empty → process likely just exited
                if not self.pty.isalive():
                    break
                time.sleep(0.001)
                continue

            # raw is bytes in pywinpty 3.x
            if isinstance(raw, bytes):
                text = raw.decode("utf-8", errors="replace")
            else:
                text = str(raw)

            if text:
                self.data_ready.emit(text)

    def stop(self):
        self._running = False
        # Unblock a stuck read() by cancelling pending I/O
        try:
            self.pty.cancel_io()
        except Exception:
            pass
        self.quit()
        self.wait(2000)
