"""WSL Manager - Windows Subsystem for Linux distribution management."""

import os
import sys
import stat
import json
import time
import signal
import shutil
import logging
import threading
import subprocess
from typing import List, Dict, Optional, Callable, Tuple
from dataclasses import dataclass, field, asdict
from PySide6.QtCore import QObject, Signal, QTimer

logger = logging.getLogger(__name__)


@dataclass
class WSLDistro:
    """Information about an installed WSL distribution."""
    name: str
    state: str = "Running"
    version: int = 2
    default: bool = False
    base_path: str = ""
    kernel_version: str = ""
    last_connected: float = 0.0


class WSLManager(QObject):
    """Manages WSL distributions and provides shell/file access."""

    distro_list_changed = Signal()
    distro_started = Signal(str)
    distro_stopped = Signal(str)
    distro_error = Signal(str, str)
    terminal_output = Signal(str, str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._distros: Dict[str, WSLDistro] = {}
        self._current_distro: Optional[str] = None
        self._refresh_timer = QTimer(self)
        self._refresh_timer.timeout.connect(self.refresh_distros)
        self._available = self._check_wsl()

    def _check_wsl(self) -> bool:
        if sys.platform != "win32":
            return False
        try:
            result = subprocess.run(["wsl", "--version"],
                                    capture_output=True, text=True, timeout=10)
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

    def is_available(self) -> bool:
        return self._available

    # ── Distribution Management ─────────────────────────────────────────

    def list_distributions(self) -> List[str]:
        """List installed WSL distributions."""
        if not self._available:
            return []
        try:
            result = subprocess.run(
                ["wsl", "-l", "-q"],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0:
                distros = [d.strip() for d in result.stdout.splitlines() if d.strip()]
                self._update_distro_info(distros)
                return distros
            return []
        except Exception as e:
            logger.error(f"Failed to list WSL distros: {e}")
            return []

    def _update_distro_info(self, distro_names: List[str]):
        """Update internal distro state with detailed info."""
        for name in distro_names:
            if name not in self._distros:
                self._distros[name] = WSLDistro(name=name)

        try:
            result = subprocess.run(
                ["wsl", "-l", "-v"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines()[1:]:
                    parts = line.split()
                    if len(parts) >= 4:
                        name = parts[0]
                        if name in self._distros:
                            self._distros[name].state = parts[1]
                            try:
                                self._distros[name].version = int(parts[2])
                            except (ValueError, IndexError):
                                pass
                        if "(Default)" in line:
                            for d in self._distros.values():
                                d.default = False
                            if name in self._distros:
                                self._distros[name].default = True
        except Exception:
            pass

    def refresh_distros(self):
        self.list_distributions()
        self.distro_list_changed.emit()

    def get_distro(self, name: str) -> Optional[WSLDistro]:
        return self._distros.get(name)

    def get_distros(self) -> List[WSLDistro]:
        return list(self._distros.values())

    def get_current_distro(self) -> Optional[str]:
        return self._current_distro

    def get_default_distro(self) -> Optional[str]:
        for d in self._distros.values():
            if d.default:
                return d.name
        if self._distros:
            return list(self._distros.keys())[0]
        return None

    # ── Distro Operations ───────────────────────────────────────────────

    def open_distro(self, name: str):
        """Open a terminal or mark a distro as current."""
        if name in self._distros:
            self._current_distro = name
            self._distros[name].state = "Running"
            self._distros[name].last_connected = time.time()

    def start_distro(self, name: str) -> bool:
        """Start a WSL distribution."""
        try:
            result = subprocess.run(
                ["wsl", "-d", name, "--", "echo", "ready"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                self._distros[name].state = "Running"
                self.distro_started.emit(name)
                return True
            self.distro_error.emit(name, result.stderr)
            return False
        except Exception as e:
            self.distro_error.emit(name, str(e))
            return False

    def stop_distro(self, name: str) -> bool:
        """Terminate a WSL distribution."""
        try:
            result = subprocess.run(
                ["wsl", "-t", name],
                capture_output=True, text=True, timeout=15
            )
            if result.returncode == 0:
                self._distros[name].state = "Stopped"
                self.distro_stopped.emit(name)
                if self._current_distro == name:
                    self._current_distro = None
                return True
            self.distro_error.emit(name, result.stderr)
            return False
        except Exception as e:
            self.distro_error.emit(name, str(e))
            return False

    def shutdown_all(self):
        """Shut down all WSL distributions."""
        try:
            subprocess.run(["wsl", "--shutdown"], capture_output=True, timeout=30)
            for name in self._distros:
                self._distros[name].state = "Stopped"
            self._current_distro = None
        except Exception as e:
            logger.error(f"WSL shutdown error: {e}")

    def set_default(self, name: str) -> bool:
        """Set a distribution as the default."""
        try:
            result = subprocess.run(
                ["wsl", "-s", name],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                for d in self._distros.values():
                    d.default = False
                self._distros[name].default = True
                return True
            return False
        except Exception:
            return False

    def install_distro(self, name: str, appx_path: str = None) -> bool:
        """Install a new WSL distribution."""
        try:
            if appx_path:
                result = subprocess.run(
                    ["wsl", "--import", name, "--appx", appx_path],
                    capture_output=True, text=True, timeout=300
                )
            else:
                result = subprocess.run(
                    ["wsl", "--install", "-d", name],
                    capture_output=True, text=True, timeout=300
                )
            if result.returncode == 0:
                self.refresh_distros()
                return True
            return False
        except Exception as e:
            logger.error(f"WSL install error: {e}")
            return False

    def uninstall_distro(self, name: str) -> bool:
        """Unregister a WSL distribution."""
        try:
            result = subprocess.run(
                ["wsl", "--unregister", name],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0:
                self._distros.pop(name, None)
                if self._current_distro == name:
                    self._current_distro = None
                self.distro_list_changed.emit()
                return True
            return False
        except Exception:
            return False

    def export_distro(self, name: str, output_path: str) -> bool:
        """Export a distribution to a tar file."""
        try:
            result = subprocess.run(
                ["wsl", "--export", name, output_path],
                capture_output=True, text=True, timeout=300
            )
            return result.returncode == 0
        except Exception:
            return False

    # ── File System ─────────────────────────────────────────────────────

    def get_path(self, linux_path: str, distro: str = None) -> str:
        """Convert a Linux path to a Windows \\\\wsl$\\ path."""
        distro = distro or self._current_distro or self.get_default_distro()
        if not distro:
            return ""
        linux_path = linux_path.replace("/", "\\").lstrip("\\")
        return f"\\\\wsl$\\{distro}\\{linux_path}"

    def read_file(self, linux_path: str, distro: str = None) -> Optional[bytes]:
        """Read a file from a WSL distribution."""
        win_path = self.get_path(linux_path, distro)
        if not win_path:
            return None
        try:
            with open(win_path, 'rb') as f:
                return f.read()
        except Exception:
            return None

    def write_file(self, linux_path: str, content: bytes, distro: str = None) -> bool:
        """Write a file to a WSL distribution."""
        win_path = self.get_path(linux_path, distro)
        if not win_path:
            return False
        try:
            os.makedirs(os.path.dirname(win_path), exist_ok=True)
            with open(win_path, 'wb') as f:
                f.write(content)
            return True
        except Exception:
            return False

    # ── Command Execution ───────────────────────────────────────────────

    def exec_command(self, command: str, distro: str = None) -> Dict:
        """Execute a command inside a WSL distribution."""
        distro = distro or self._current_distro or self.get_default_distro()
        if not distro:
            return {"exit_code": -1, "stdout": "", "stderr": "No WSL distro"}
        try:
            result = subprocess.run(
                ["wsl", "-d", distro, "-e", "sh", "-c", command],
                capture_output=True, text=True, timeout=60
            )
            return {
                "exit_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except subprocess.TimeoutExpired:
            return {"exit_code": -1, "stdout": "", "stderr": "Command timed out"}
        except Exception as e:
            return {"exit_code": -1, "stdout": "", "stderr": str(e)}

    def exec_interactive(self, command: str, distro: str = None):
        """Execute a command in a background thread, emitting output."""
        distro = distro or self._current_distro or self.get_default_distro()
        if not distro:
            return

        def _run():
            try:
                import os
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                proc = subprocess.Popen(
                    ["wsl", "-d", distro, "-e", "sh", "-c", command],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, bufsize=1,
                    **kwargs
                )
                for line in proc.stdout:
                    self.terminal_output.emit(distro, line.rstrip())
                proc.wait()
            except Exception as e:
                self.terminal_output.emit(distro, f"Error: {e}")

        threading.Thread(target=_run, daemon=True).start()

    # ── Utils ───────────────────────────────────────────────────────────

    def get_home_path(self, distro: str = None) -> str:
        """Get the home directory path inside a WSL distribution."""
        result = self.exec_command("echo $HOME", distro)
        return result.get("stdout", "").strip() or "/home"

    def get_wsl_ip(self, distro: str = None) -> str:
        """Get the IP address of the WSL network interface."""
        result = self.exec_command(
            "ip addr show eth0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1",
            distro,
        )
        return result.get("stdout", "").strip()

    def start_monitoring(self, interval_ms: int = 10000):
        self._refresh_timer.start(interval_ms)

    def stop_monitoring(self):
        self._refresh_timer.stop()

    def cleanup(self):
        self.stop_monitoring()
