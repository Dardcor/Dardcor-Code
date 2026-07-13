"""Remote SSH Manager - Full SSH connection manager with status persistence."""

import os
import json
import time
import threading
import logging
from typing import Optional, List, Dict, Callable
from dataclasses import dataclass, field, asdict
from PySide6.QtCore import QObject, Signal, QTimer
from ..core.config import get_user_data_dir

logger = logging.getLogger(__name__)

SSH_CONFIG_DIR = os.path.join(get_user_data_dir(), "remote", "ssh")
HOSTS_FILE = os.path.join(SSH_CONFIG_DIR, "hosts.json")
STATE_FILE = os.path.join(SSH_CONFIG_DIR, "state.json")


@dataclass
class SSHHostConfig:
    """Configuration for a single SSH host."""
    hostname: str
    label: str = ""
    user: str = ""
    port: int = 22
    identity_file: str = ""
    proxy_jump: str = ""
    forward_agent: bool = False
    forward_x11: bool = False
    extra_args: str = ""
    group: str = "Default"


@dataclass
class SSHConnectionState:
    """Persistent connection state."""
    current_host: Optional[str] = None
    last_connected_host: Optional[str] = None
    last_connected_time: Optional[float] = None
    auto_reconnect: bool = False
    recent_hosts: List[str] = field(default_factory=list)


class RemoteSSHManager(QObject):
    """Manages Remote - SSH connections with persistence."""

    connection_state_changed = Signal(str)
    host_list_changed = Signal()
    host_connected = Signal(str)
    host_disconnected = Signal(str)
    connection_error = Signal(str, str)
    ssh_config_loaded = Signal()

    STATE_DISCONNECTED = "disconnected"
    STATE_CONNECTING = "connecting"
    STATE_CONNECTED = "connected"
    STATE_ERROR = "error"

    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_host: Optional[str] = None
        self._state = self.STATE_DISCONNECTED
        self._hosts: Dict[str, SSHHostConfig] = {}
        self._connection_state = SSHConnectionState()
        self._ssh_client = None
        self._reconnect_timer = QTimer(self)
        self._reconnect_timer.timeout.connect(self._try_reconnect)
        self._reconnect_attempts = 0
        self._max_reconnect_attempts = 5
        self._reconnect_delay = 2

        os.makedirs(SSH_CONFIG_DIR, exist_ok=True)
        self._load_hosts()
        self._load_state()

    # ── Host Management ──────────────────────────────────────────────────

    def add_host(self, host: SSHHostConfig) -> bool:
        """Add or update a host configuration."""
        key = host.hostname
        self._hosts[key] = host
        self._save_hosts()
        self.host_list_changed.emit()
        return True

    def remove_host(self, hostname: str) -> bool:
        """Remove a host configuration."""
        if hostname in self._hosts:
            del self._hosts[hostname]
            self._save_hosts()
            self.host_list_changed.emit()
            if self._current_host == hostname:
                self.disconnect()
            return True
        return False

    def get_host(self, hostname: str) -> Optional[SSHHostConfig]:
        return self._hosts.get(hostname)

    def get_hosts(self) -> List[SSHHostConfig]:
        return list(self._hosts.values())

    def get_hosts_by_group(self) -> Dict[str, List[SSHHostConfig]]:
        groups: Dict[str, List[SSHHostConfig]] = {}
        for host in self._hosts.values():
            group = host.group or "Default"
            groups.setdefault(group, []).append(host)
        return groups

    # ── SSH Config Parsing ───────────────────────────────────────────────

    def parse_ssh_config(self, config_path: Optional[str] = None) -> int:
        """Parse ~/.ssh/config and import hosts."""
        if config_path is None:
            config_path = os.path.expanduser("~/.ssh/config")
        if not os.path.exists(config_path):
            return 0
        imported = 0
        current_host = None
        current_config: Dict[str, str] = {}
        try:
            with open(config_path, 'r') as f:
                for line in f:
                    stripped = line.strip()
                    if not stripped or stripped.startswith('#'):
                        continue
                    if stripped.lower().startswith('host '):
                        if current_host and current_host != '*':
                            self._import_host_config(current_host, current_config)
                            imported += 1
                        parts = stripped.split()
                        current_host = parts[1] if len(parts) > 1 else None
                        current_config = {}
                    elif current_host and '=' in stripped:
                        key, _, val = stripped.partition('=')
                        current_config[key.strip().lower()] = val.strip()
                    elif current_host and ' ' in stripped:
                        idx = stripped.index(' ')
                        key = stripped[:idx].strip().lower()
                        val = stripped[idx:].strip()
                        current_config[key] = val
            if current_host and current_host != '*':
                self._import_host_config(current_host, current_config)
                imported += 1
        except Exception as e:
            logger.error(f"Failed to parse SSH config: {e}")
        self._save_hosts()
        if imported > 0:
            self.host_list_changed.emit()
            self.ssh_config_loaded.emit()
        return imported

    def _import_host_config(self, hostname: str, config: Dict[str, str]):
        if hostname in self._hosts:
            return
        host = SSHHostConfig(hostname=hostname)
        host.user = config.get("user", "")
        try:
            host.port = int(config.get("port", "22"))
        except ValueError:
            host.port = 22
        host.identity_file = config.get("identityfile", config.get("identityfile", ""))
        host.proxy_jump = config.get("proxyjump", "")
        host.forward_agent = config.get("forwardagent", "no").lower() in ("yes", "true")
        self._hosts[hostname] = host

    # ── Connection Lifecycle ─────────────────────────────────────────────

    def connect_to_host(self, hostname: str):
        """Initiate SSH connection."""
        host = self._hosts.get(hostname)
        if not host:
            self._set_state(self.STATE_ERROR)
            self.connection_error.emit(hostname, "Host not configured")
            return

        self._current_host = hostname
        self._set_state(self.STATE_CONNECTING)
        self._reconnect_attempts = 0

        def _connector():
            try:
                result = self._do_connect(host)
                if result:
                    self._on_connect_success(hostname)
                else:
                    self._on_connect_failure(hostname, "Connection failed")
            except Exception as e:
                self._on_connect_failure(hostname, str(e))

        threading.Thread(target=_connector, daemon=True).start()

    def _do_connect(self, host: SSHHostConfig) -> bool:
        """Actual SSH connection logic."""
        import paramiko
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.set_missing_host_key_policy(paramiko.WarningPolicy())
        connect_kwargs = {
            "hostname": host.hostname,
            "port": host.port,
            "username": host.user or os.environ.get("USER", os.environ.get("USERNAME", "")),
            "timeout": 15,
            "banner_timeout": 30,
        }
        if host.identity_file:
            connect_kwargs["key_filename"] = host.identity_file
        if host.proxy_jump:
            jump_config = self._parse_proxy_jump(host.proxy_jump)
            if jump_config:
                import paramiko
                proxy = paramiko.ProxyCommand(
                    f"ssh -W {host.hostname}:{host.port} "
                    f"{jump_config['user']}@{jump_config['hostname']} "
                    f"-p {jump_config['port']}"
                )
                connect_kwargs["sock"] = proxy

        client.connect(**connect_kwargs)
        if host.forward_agent:
            client.get_transport().set_keepalive(30)
        self._ssh_client = client
        return True

    def _parse_proxy_jump(self, jump: str) -> Optional[Dict]:
        """Parse user@host:port from proxy jump string."""
        try:
            if "@" in jump:
                user, rest = jump.split("@", 1)
            else:
                user, rest = None, jump
            if ":" in rest:
                hostname, port_str = rest.split(":", 1)
                port = int(port_str)
            else:
                hostname = rest
                port = 22
            return {"user": user or os.environ.get("USER", ""), "hostname": hostname, "port": port}
        except Exception:
            return None

    def _on_connect_success(self, hostname: str):
        self._set_state(self.STATE_CONNECTED)
        self._connection_state.current_host = hostname
        self._connection_state.last_connected_host = hostname
        self._connection_state.last_connected_time = time.time()
        if hostname not in self._connection_state.recent_hosts:
            self._connection_state.recent_hosts.insert(0, hostname)
        self._connection_state.recent_hosts = self._connection_state.recent_hosts[:10]
        self._save_state()
        self.host_connected.emit(hostname)

    def _on_connect_failure(self, hostname: str, error: str):
        self._set_state(self.STATE_ERROR)
        self.connection_error.emit(hostname, error)
        if self._connection_state.auto_reconnect and self._reconnect_attempts < self._max_reconnect_attempts:
            self._reconnect_attempts += 1
            delay = self._reconnect_delay * (2 ** (self._reconnect_attempts - 1))
            self._reconnect_timer.start(int(delay * 1000))

    def _try_reconnect(self):
        self._reconnect_timer.stop()
        if self._current_host:
            self.connect_to_host(self._current_host)

    def disconnect(self):
        """Disconnect current SSH session."""
        hostname = self._current_host
        self._reconnect_timer.stop()
        self._reconnect_attempts = 0
        if self._ssh_client:
            try:
                self._ssh_client.close()
            except Exception:
                pass
            self._ssh_client = None
        self._current_host = None
        self._connection_state.current_host = None
        self._save_state()
        self._set_state(self.STATE_DISCONNECTED)
        if hostname:
            self.host_disconnected.emit(hostname)

    def get_ssh_client(self):
        """Get the active paramiko SSHClient for direct use."""
        return self._ssh_client

    def is_connected(self) -> bool:
        return self._state == self.STATE_CONNECTED and self._ssh_client is not None

    def test_connection(self, hostname: str) -> bool:
        """Quick connectivity test without full connection state changes."""
        host = self._hosts.get(hostname)
        if not host:
            return False
        try:
            import paramiko
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            connect_kwargs = {
                "hostname": host.hostname,
                "port": host.port,
                "username": host.user or os.environ.get("USER", ""),
                "timeout": 5,
            }
            if host.identity_file:
                connect_kwargs["key_filename"] = host.identity_file
            client.connect(**connect_kwargs)
            client.close()
            return True
        except Exception:
            return False

    # ── State Management ─────────────────────────────────────────────────

    def _set_state(self, state: str):
        if self._state != state:
            self._state = state
            self.connection_state_changed.emit(state)

    def get_state(self) -> str:
        return self._state

    def get_current_host(self) -> Optional[str]:
        return self._current_host

    def get_last_connected_host(self) -> Optional[str]:
        return self._connection_state.last_connected_host

    def get_recent_hosts(self) -> List[str]:
        return self._connection_state.recent_hosts

    def set_auto_reconnect(self, enabled: bool):
        self._connection_state.auto_reconnect = enabled
        self._save_state()

    def get_auto_reconnect(self) -> bool:
        return self._connection_state.auto_reconnect

    # ── Persistence ──────────────────────────────────────────────────────

    def _load_hosts(self):
        try:
            if os.path.exists(HOSTS_FILE):
                with open(HOSTS_FILE, 'r') as f:
                    data = json.load(f)
                for item in data:
                    host = SSHHostConfig(**item)
                    self._hosts[host.hostname] = host
        except Exception as e:
            logger.error(f"Failed to load SSH hosts: {e}")

    def _save_hosts(self):
        try:
            data = [asdict(h) for h in self._hosts.values()]
            with open(HOSTS_FILE, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save SSH hosts: {e}")

    def _load_state(self):
        try:
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, 'r') as f:
                    data = json.load(f)
                self._connection_state = SSHConnectionState(**data)
        except Exception as e:
            logger.error(f"Failed to load SSH state: {e}")

    def _save_state(self):
        try:
            with open(STATE_FILE, 'w') as f:
                json.dump(asdict(self._connection_state), f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save SSH state: {e}")

    def get_remote_file_content(self, path: str) -> str:
        """Fetch file from remote host via SFTP."""
        if not self.is_connected() or not self._ssh_client:
            return ""
        try:
            sftp = self._ssh_client.open_sftp()
            with sftp.open(path, 'r') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Failed to read remote file {path}: {e}")
            return ""

    def exec_command(self, command: str) -> Optional[Dict]:
        """Execute a command on the remote host."""
        if not self.is_connected() or not self._ssh_client:
            return None
        try:
            stdin, stdout, stderr = self._ssh_client.exec_command(command, timeout=30)
            exit_code = stdout.channel.recv_exit_status()
            return {
                "exit_code": exit_code,
                "stdout": stdout.read().decode(),
                "stderr": stderr.read().decode(),
            }
        except Exception as e:
            logger.error(f"Remote exec failed: {e}")
            return None

    def cleanup(self):
        self.disconnect()
