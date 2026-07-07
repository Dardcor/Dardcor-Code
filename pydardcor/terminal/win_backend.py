"""Windows PTY Backend."""

import os
import sys
import site

HAS_WINPTY = False
# Try direct import first; fall back to appending user site-packages only if missing
try:
    try:
        from pywinpty import PTY
    except ImportError:
        from winpty import PTY
    HAS_WINPTY = True
except ImportError:
    user_site = site.getusersitepackages()
    _appended = user_site not in sys.path
    if _appended:
        sys.path.append(user_site)
    try:
        try:
            from pywinpty import PTY
        except ImportError:
            from winpty import PTY
        HAS_WINPTY = True
    except ImportError:
        PTY = None
    finally:
        if _appended and os.environ.get("DARDCOR_KEEP_PATHS") is None:
            try:
                sys.path.remove(user_site)
            except ValueError:
                pass

class WinPtyWrapper:
    def __init__(self, cols: int, rows: int, cmd: str, cwd: str, env: dict = None):
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
