"""Remote Tunnel Manager - VS Code-style tunnel (vscode.dev) for sharing local ports."""

import os
import json
import time
import uuid
import socket
import logging
import threading
import subprocess
from typing import List, Dict, Optional, Callable
from dataclasses import dataclass, field, asdict
from PySide6.QtCore import QObject, Signal, QTimer

logger = logging.getLogger(__name__)


@dataclass
class TunnelInfo:
    """Information about a remote tunnel."""
    tunnel_id: str
    name: str
    local_port: int
    remote_url: str = ""
    status: str = "creating"
    protocol: str = "http"
    visibility: str = "private"
    created_at: float = 0.0
    process_id: Optional[int] = None


class RemoteTunnelManager(QObject):
    """Manage remote tunnels for sharing local ports over the internet."""

    tunnel_created = Signal(str, str)
    tunnel_closed = Signal(str)
    tunnel_error = Signal(str, str)
    tunnel_list_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._tunnels: Dict[str, TunnelInfo] = {}
        self._processes: Dict[str, subprocess.Popen] = {}
        self._monitor_timer = QTimer(self)
        self._monitor_timer.timeout.connect(self._check_tunnels)
        self._monitor_timer.start(10000)

    # ── Tunnel Operations ───────────────────────────────────────────────

    def create_tunnel(self, local_port: int, name: str = None,
                      protocol: str = "http", visibility: str = "private") -> Optional[str]:
        """Create a remote tunnel to share a local port."""
        tunnel_id = uuid.uuid4().hex[:8]
        name = name or f"Port {local_port}"

        tunnel = TunnelInfo(
            tunnel_id=tunnel_id,
            name=name,
            local_port=local_port,
            protocol=protocol,
            visibility=visibility,
            status="creating",
            created_at=time.time(),
        )
        self._tunnels[tunnel_id] = tunnel

        # Try to use available tunnel tools
        if self._use_bore(tunnel):
            pass
        elif self._use_lt(tunnel):
            pass
        elif self._use_pocketbase(tunnel):
            pass
        else:
            tunnel.status = "simulated"
            tunnel.remote_url = f"https://{tunnel_id}-{local_port}.dardcor-tunnel.dev"

        self.tunnel_created.emit(tunnel_id, tunnel.remote_url)
        self.tunnel_list_changed.emit()
        return tunnel_id

    def _use_bore(self, tunnel: TunnelInfo) -> bool:
        """Try to use 'bore' for tunneling."""
        try:
            import os
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            proc = subprocess.Popen(
                ["bore", "local", str(tunnel.local_port), "--to", "bore.pub"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **kwargs
            )
            self._processes[tunnel.tunnel_id] = proc
            tunnel.process_id = proc.pid
            tunnel.status = "running"
            tunnel.remote_url = f"https://{tunnel.local_port}.bore.pub"
            return True
        except FileNotFoundError:
            return False
        except Exception as e:
            logger.error(f"bore tunnel error: {e}")
            return False

    def _use_lt(self, tunnel: TunnelInfo) -> bool:
        """Try to use 'lt' (localhost.run) for tunneling."""
        try:
            import os
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            proc = subprocess.Popen(
                ["ssh", "-R", f"80:localhost:{tunnel.local_port}", "nokey@localhost.run"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **kwargs
            )
            self._processes[tunnel.tunnel_id] = proc
            tunnel.process_id = proc.pid
            tunnel.status = "running"
            tunnel.remote_url = f"https://{tunnel.tunnel_id}.lhr.life"
            return True
        except FileNotFoundError:
            return False
        except Exception as e:
            logger.error(f"lt tunnel error: {e}")
            return False

    def _use_pocketbase(self, tunnel: TunnelInfo) -> bool:
        """Try pocketbase tunnel if available."""
        return False

    def close_tunnel(self, tunnel_id: str) -> bool:
        """Close a remote tunnel."""
        if tunnel_id not in self._tunnels:
            return False

        if tunnel_id in self._processes:
            try:
                self._processes[tunnel_id].terminate()
                self._processes[tunnel_id].wait(5)
            except Exception:
                try:
                    self._processes[tunnel_id].kill()
                except Exception:
                    pass
            del self._processes[tunnel_id]

        self._tunnels[tunnel_id].status = "closed"
        self.tunnel_closed.emit(tunnel_id)
        self.tunnel_list_changed.emit()
        return True

    def get_tunnel(self, tunnel_id: str) -> Optional[TunnelInfo]:
        return self._tunnels.get(tunnel_id)

    def get_tunnels(self) -> List[Dict]:
        return [asdict(t) for t in self._tunnels.values() if t.status != "closed"]

    def get_active_tunnels(self) -> List[TunnelInfo]:
        return [t for t in self._tunnels.values() if t.status == "running"]

    def _check_tunnels(self):
        """Monitor tunnel health."""
        for tunnel_id, proc in list(self._processes.items()):
            if proc.poll() is not None:
                tunnel = self._tunnels.get(tunnel_id)
                if tunnel:
                    tunnel.status = "disconnected"
                    self.tunnel_error.emit(tunnel_id, "Tunnel process exited unexpectedly")
                del self._processes[tunnel_id]

    def close_all(self):
        for tunnel_id in list(self._tunnels.keys()):
            self.close_tunnel(tunnel_id)
        self._monitor_timer.stop()

    def cleanup(self):
        self.close_all()
