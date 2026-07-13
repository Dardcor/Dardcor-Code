"""SSH Connection - Enhanced SSH/SFTP with terminal, port forwarding, and reconnection."""

import os
import sys
import stat
import time
import json
import socket
import logging
import threading
import subprocess
from typing import List, Tuple, Optional, Dict, Callable
from PySide6.QtCore import QObject, Signal

logger = logging.getLogger(__name__)

try:
    import paramiko
    HAS_PARAMIKO = True
except ImportError:
    HAS_PARAMIKO = False
    logger.warning("paramiko not installed; SSH connection features will be unavailable")


class RemoteTerminal(QObject):
    """Pseudo-terminal over SSH for remote shell access."""

    data_received = Signal(str)
    connection_lost = Signal()
    title_changed = Signal(str)

    def __init__(self, ssh_client, parent=None):
        super().__init__(parent)
        self._ssh_client = ssh_client
        self._channel = None
        self._reader_thread = None
        self._running = False

    def open(self, term_type: str = "xterm-256color", cols: int = 80, rows: int = 24):
        """Open an interactive shell channel."""
        if not HAS_PARAMIKO:
            raise RuntimeError("paramiko is required for remote terminals")
        if not self._ssh_client:
            raise RuntimeError("No SSH connection")
        self._channel = self._ssh_client.invoke_shell(
            term=term_type,
            width=cols,
            height=rows,
        )
        self._channel.setblocking(0)
        self._running = True
        self._reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
        self._reader_thread.start()

    def _reader_loop(self):
        """Read data from SSH channel in background."""
        while self._running and self._channel and self._channel.active:
            try:
                if self._channel.recv_ready():
                    data = self._channel.recv(4096)
                    if data:
                        text = data.decode("utf-8", errors="replace")
                        self.data_received.emit(text)
                elif self._channel.closed:
                    break
                else:
                    time.sleep(0.01)
            except (EOFError, OSError, paramiko.SSHException):
                break
            except Exception:
                time.sleep(0.01)
        self._running = False
        self.connection_lost.emit()

    def write(self, data: str):
        """Send data to the remote terminal."""
        if self._channel and self._channel.active:
            try:
                self._channel.send(data.encode("utf-8"))
            except Exception as e:
                logger.error(f"Failed to write to remote terminal: {e}")

    def resize(self, cols: int, rows: int):
        """Resize the remote terminal."""
        if self._channel and self._channel.active:
            try:
                self._channel.resize_pty(width=cols, height=rows)
            except Exception as e:
                logger.error(f"Failed to resize remote terminal: {e}")

    def close(self):
        """Close the remote terminal."""
        self._running = False
        if self._channel:
            try:
                self._channel.close()
            except Exception:
                pass
            self._channel = None


class SSHForwarder:
    """Local and remote port forwarding over SSH."""

    def __init__(self, ssh_client):
        self._ssh_client = ssh_client
        self._tunnels: List[Dict] = []

    def forward_local_port(self, local_port: int, remote_host: str, remote_port: int) -> bool:
        """Forward a local port to a remote host:port (ssh -L)."""
        if not self._ssh_client:
            return False
        try:
            transport = self._ssh_client.get_transport()
            if not transport:
                return False

            class ForwardHandler:
                def __init__(self, chan, rhost, rport):
                    self._chan = chan
                    self._rhost = rhost
                    self._rport = rport

                def run(self):
                    try:
                        dest = transport.open_channel(
                            "direct-tcpip",
                            (self._rhost, self._rport),
                            self._chan.getpeername(),
                        )
                        if dest:
                            self._exchange(self._chan, dest)
                    except Exception as e:
                        logger.error(f"Tunnel error: {e}")

                def _exchange(self, chan1, chan2):
                    import select
                    while chan1.active and chan2.active:
                        r, _, _ = select.select([chan1, chan2], [], [], 1)
                        if chan1 in r:
                            data = chan1.recv(4096)
                            if not data:
                                break
                            chan2.send(data)
                        if chan2 in r:
                            data = chan2.recv(4096)
                            if not data:
                                break
                            chan1.send(data)

            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("127.0.0.1", local_port))
            server.listen(10)

            def accept_loop():
                while True:
                    try:
                        client, addr = server.accept()
                        handler = ForwardHandler(client, remote_host, remote_port)
                        threading.Thread(target=handler.run, daemon=True).start()
                    except Exception:
                        break

            thread = threading.Thread(target=accept_loop, daemon=True)
            thread.start()

            self._tunnels.append({
                "type": "local",
                "local_port": local_port,
                "remote_host": remote_host,
                "remote_port": remote_port,
                "server": server,
                "thread": thread,
            })
            return True
        except Exception as e:
            logger.error(f"Failed to forward local port {local_port}: {e}")
            return False

    def forward_remote_port(self, remote_port: int, local_host: str, local_port: int) -> bool:
        """Forward a remote port to a local host:port (ssh -R)."""
        if not self._ssh_client:
            return False
        try:
            transport = self._ssh_client.get_transport()
            if not transport:
                return False

            def handler(chan, src_addr, dest_addr):
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.connect((local_host, local_port))
                    while chan.active and sock:
                        r, _, _ = select.select([chan, sock], [], [], 1)
                        if chan in r:
                            data = chan.recv(4096)
                            if not data:
                                break
                            sock.send(data)
                        if sock in r:
                            data = sock.recv(4096)
                            if not data:
                                break
                            chan.send(data)
                except Exception:
                    pass
                finally:
                    try:
                        sock.close()
                    except Exception:
                        pass

            transport.request_port_forward("127.0.0.1", remote_port, handler)

            self._tunnels.append({
                "type": "remote",
                "remote_port": remote_port,
                "local_host": local_host,
                "local_port": local_port,
            })
            return True
        except Exception as e:
            logger.error(f"Failed to forward remote port {remote_port}: {e}")
            return False

    def close_all(self):
        for tunnel in self._tunnels:
            if "server" in tunnel:
                try:
                    tunnel["server"].close()
                except Exception:
                    pass
        self._tunnels.clear()


class ReconnectableSSHClient:
    """SSH client with automatic reconnection and built-in SFTP."""

    def __init__(self, hostname: str, username: str, password: str = None,
                 key_filename: str = None, port: int = 22):
        if not HAS_PARAMIKO:
            raise RuntimeError("paramiko is required")
        self.hostname = hostname
        self.username = username
        self.password = password
        self.key_filename = key_filename
        self.port = port
        self._client = None
        self._sftp = None
        self._forwarder = None
        self._connect()

    def _connect(self):
        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_kwargs = dict(hostname=self.hostname, port=self.port,
                              username=self.username, timeout=15, banner_timeout=30)
        if self.password:
            connect_kwargs["password"] = self.password
        if self.key_filename:
            connect_kwargs["key_filename"] = self.key_filename
        self._client.connect(**connect_kwargs)
        self._sftp = self._client.open_sftp()
        self._forwarder = SSHForwarder(self._client)

    def reconnect(self):
        try:
            self.close()
        except Exception:
            pass
        self._connect()

    def get_client(self):
        return self._client

    def get_sftp(self):
        return self._sftp

    def get_forwarder(self):
        return self._forwarder

    def exec_command(self, command: str, timeout: int = 30) -> Tuple[int, str, str]:
        stdin, stdout, stderr = self._client.exec_command(command, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()

    def create_terminal(self) -> RemoteTerminal:
        return RemoteTerminal(self._client)

    def is_connected(self) -> bool:
        if not self._client:
            return False
        transport = self._client.get_transport()
        return transport is not None and transport.is_active()

    def close(self):
        if self._forwarder:
            self._forwarder.close_all()
        if self._sftp:
            try:
                self._sftp.close()
            except Exception:
                pass
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass


class SshFileSystem:
    """SFTP-based filesystem operations using paramiko (shell-out fallback)."""

    def __init__(self, host: str, user: str, port: int = 22, key_path: str = None):
        self.host = host
        self.user = user
        self.port = port
        self.key_path = key_path
        self._ssh_base_cmd = ["ssh", "-p", str(port)]
        if key_path:
            self._ssh_base_cmd.extend(["-i", key_path])
        self._ssh_base_cmd.append(f"{user}@{host}")

    def _run_ssh_cmd(self, remote_cmd: str) -> subprocess.CompletedProcess:
        cmd = self._ssh_base_cmd + [remote_cmd]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30)

    def read_file(self, path: str) -> bytes:
        cmd = self._ssh_base_cmd + [f"cat {path}"]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0:
            raise FileNotFoundError(f"Remote file not found: {path}")
        return result.stdout

    def write_file(self, path: str, content: bytes):
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            tf.write(content)
            temp_path = tf.name
        try:
            remote_dir = os.path.dirname(path)
            self._run_ssh_cmd(f"mkdir -p {remote_dir}")
            scp_cmd = ["scp", "-P", str(self.port)]
            if self.key_path:
                scp_cmd.extend(["-i", self.key_path])
            scp_cmd.extend([temp_path, f"{self.user}@{self.host}:{path}"])
            subprocess.run(scp_cmd, check=True, timeout=30)
        finally:
            os.remove(temp_path)

    def list_dir(self, path: str) -> List[Tuple[str, dict]]:
        result = self._run_ssh_cmd(f"stat -c '%n|%F|%s|%Y' {path}/* 2>/dev/null; stat -c '%n|%F|%s|%Y' {path}/.* 2>/dev/null")
        if result.returncode != 0 or not result.stdout.strip():
            return []
        items = []
        seen = set()
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            parts = line.split('|')
            if len(parts) >= 4:
                name = os.path.basename(parts[0])
                if name in (".", "..") or name in seen:
                    continue
                seen.add(name)
                is_dir = parts[1] == "directory"
                size = int(parts[2])
                mtime = float(parts[3])
                items.append((name, {"is_dir": is_dir, "size": size, "mtime": mtime}))
        return items

    def stat(self, path: str) -> Optional[dict]:
        result = self._run_ssh_cmd(f"stat -c '%F|%s|%Y' {path} 2>/dev/null")
        if result.returncode != 0 or not result.stdout.strip():
            return None
        parts = result.stdout.strip().split('|')
        if len(parts) >= 3:
            is_dir = parts[0] == "directory"
            size = int(parts[1])
            mtime = float(parts[2])
            return {"is_dir": is_dir, "size": size, "mtime": mtime}
        return None

    def mkdir(self, path: str):
        self._run_ssh_cmd(f"mkdir -p {path}")

    def delete(self, path: str, recursive: bool = False):
        if recursive:
            self._run_ssh_cmd(f"rm -rf {path}")
        else:
            self._run_ssh_cmd(f"rm {path}")

    def exists(self, path: str) -> bool:
        result = self._run_ssh_cmd(f"test -e {path} && echo yes || echo no")
        return result.stdout.strip() == "yes"

    def glob(self, pattern: str) -> List[str]:
        result = self._run_ssh_cmd(f"ls -d {pattern} 2>/dev/null || true")
        if result.stdout.strip():
            return result.stdout.strip().split('\n')
        return []
