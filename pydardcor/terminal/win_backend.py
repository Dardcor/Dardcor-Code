"""Windows PTY Backend."""

import os
import sys
import site

# Ensure user site-packages in path so pywinpty is importable
user_site = site.getusersitepackages()
if user_site not in sys.path:
    sys.path.append(user_site)

HAS_WINPTY = False
try:
    try:
        from pywinpty import PTY
    except ImportError:
        from winpty import PTY
    HAS_WINPTY = True
except ImportError:
    pass

class WinPtyWrapper:
    def __init__(self, cols: int, rows: int, cmd: str, cwd: str):
        if not HAS_WINPTY:
            raise RuntimeError("pywinpty not installed")
        self.pty = PTY(cols, rows)
        exe = cmd if isinstance(cmd, str) else cmd[0]
        self.pty.spawn(exe, cwd=cwd, env=None)

    def read(self, blocking=True):
        return self.pty.read(blocking=blocking)

    def write(self, data):
        try:
            self.pty.write(data)
        except TypeError:
            self.pty.write(data.encode("utf-8"))

    def isalive(self):
        return self.pty.isalive()

    def iseof(self):
        return self.pty.iseof()

    def set_size(self, cols, rows):
        self.pty.set_size(cols, rows)

    def cancel_io(self):
        if hasattr(self.pty, 'cancel_io'):
            self.pty.cancel_io()

    def close(self):
        self.pty.close()
