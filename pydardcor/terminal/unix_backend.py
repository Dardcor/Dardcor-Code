"""Unix POSIX PTY Backend."""

import os
import signal
import time

try:
    import pty
    import termios
    import struct
    import fcntl
    import select
    HAS_UNIX_PTY = True
except ImportError:
    HAS_UNIX_PTY = False

class UnixPtyWrapper:
    def __init__(self, cols: int, rows: int, cmd: str, cwd: str, env: dict = None):
        if not HAS_UNIX_PTY:
            raise RuntimeError("POSIX pty not available")
            
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            # Child process
            try:
                if cwd:
                    os.chdir(cwd)
            except Exception as e:
                import logging
                logging.error(f"unix_backend: Failed to chdir to {cwd}: {e}")
            
            # Use provided env or parent's env
            process_env = env if env is not None else os.environ.copy()
            process_env["TERM"] = "xterm-256color"
            
            # Execute shell
            shell = cmd if isinstance(cmd, str) else cmd[0]
            os.execve(shell, [shell], process_env)
        else:
            # Parent process
            self._alive = True
            self._eof = False
            self.set_size(cols, rows)
            
            # Make fd non-blocking to allow select/read loop
            flags = fcntl.fcntl(self.fd, fcntl.F_GETFL)
            fcntl.fcntl(self.fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def read(self, blocking=True):
        if blocking:
            r, _, _ = select.select([self.fd], [], [], 0.1)
            if not r:
                return b""
        try:
            data = os.read(self.fd, 4096)
            if not data:
                self._eof = True
                self._alive = False
            return data
        except BlockingIOError:
            return b""
        except OSError:
            self._eof = True
            self._alive = False
            return b""

    def write(self, data):
        if isinstance(data, str):
            data = data.encode('utf-8')
        try:
            os.write(self.fd, data)
        except OSError as e:
            import logging
            logging.error(f"unix_backend: Failed to write to pty: {e}")

    def isalive(self):
        if not self._alive:
            return False
        # Check if child process is still alive
        pid, status = os.waitpid(self.pid, os.WNOHANG)
        if pid == self.pid:
            self._alive = False
        return self._alive

    def iseof(self):
        return self._eof

    def set_size(self, cols, rows):
        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, winsize)
        except OSError as e:
            import logging
            logging.error(f"unix_backend: Failed to set size: {e}")

    def cancel_io(self):
        pass

    def close(self):
        self._alive = False
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError as e:
            import logging
            logging.error(f"unix_backend: Failed to kill process: {e}")
            
        try:
            os.close(self.fd)
        except OSError as e:
            import logging
            logging.error(f"unix_backend: Failed to close fd: {e}")
