"""Virtual File System - Abstract filesystem layer supporting Local, SSH, Container, and WSL."""

import os
import io
import stat
import shutil
import platform
import logging
import subprocess
from abc import ABC, abstractmethod
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)


class FileStat:
    """Represents file metadata across different filesystems."""
    def __init__(self, is_dir: bool, size: int, mtime: float):
        self.is_dir = is_dir
        self.size = size
        self.mtime = mtime


class VirtualFileSystem(ABC):
    """Abstract base class for filesystem operations (Local, SSH, Container, WSL)."""

    @abstractmethod
    def read_file(self, path: str) -> bytes:
        pass

    @abstractmethod
    def write_file(self, path: str, content: bytes):
        pass

    @abstractmethod
    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        pass

    @abstractmethod
    def stat(self, path: str) -> Optional[FileStat]:
        pass

    @abstractmethod
    def mkdir(self, path: str):
        pass

    @abstractmethod
    def delete(self, path: str, recursive: bool = False):
        pass


class LocalFileSystem(VirtualFileSystem):
    """Implementation of VFS for local filesystem."""

    def read_file(self, path: str) -> bytes:
        with open(path, 'rb') as f:
            return f.read()

    def write_file(self, path: str, content: bytes):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(content)

    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        result = []
        for entry in os.scandir(path):
            st = entry.stat()
            fs = FileStat(entry.is_dir(), st.st_size, st.st_mtime)
            result.append((entry.name, fs))
        return result

    def stat(self, path: str) -> Optional[FileStat]:
        if not os.path.exists(path):
            return None
        st = os.stat(path)
        return FileStat(stat.S_ISDIR(st.st_mode), st.st_size, st.st_mtime)

    def mkdir(self, path: str):
        os.makedirs(path, exist_ok=True)

    def delete(self, path: str, recursive: bool = False):
        if os.path.isdir(path):
            if recursive:
                shutil.rmtree(path)
            else:
                os.rmdir(path)
        else:
            os.remove(path)


class SSHFileSystem(VirtualFileSystem):
    """Implementation of VFS for remote SSH servers using paramiko."""

    def __init__(self, hostname, username, password=None, key_filename=None, port=22):
        self._hostname = hostname
        self._username = username
        self._port = port
        self._ssh = None
        self._sftp = None
        self._connect(hostname, username, password, key_filename, port)

    def _connect(self, hostname, username, password=None, key_filename=None, port=22):
        import paramiko
        self._ssh = paramiko.SSHClient()
        self._ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        connect_kwargs = dict(hostname=hostname, port=port, username=username, timeout=10)
        if password:
            connect_kwargs["password"] = password
        if key_filename:
            connect_kwargs["key_filename"] = key_filename
        self._ssh.connect(**connect_kwargs)
        self._sftp = self._ssh.open_sftp()

    def reconnect(self):
        try:
            self.close()
        except Exception:
            pass
        self._connect(self._hostname, self._username, port=self._port)

    def read_file(self, path: str) -> bytes:
        buf = io.BytesIO()
        self._sftp.getfo(path, buf)
        return buf.getvalue()

    def write_file(self, path: str, content: bytes):
        dirname = os.path.dirname(path.replace('\\', '/'))
        try:
            self._sftp.stat(dirname)
        except IOError:
            self._mkdir_parents(dirname)
        buf = io.BytesIO(content)
        self._sftp.putfo(buf, path)

    def _mkdir_parents(self, path: str):
        parts = path.strip('/').split('/')
        acc = ""
        for p in parts:
            acc += "/" + p
            try:
                self._sftp.stat(acc)
            except IOError:
                self._sftp.mkdir(acc)

    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        result = []
        try:
            for entry in self._sftp.listdir_attr(path):
                is_dir = stat.S_ISDIR(entry.st_mode)
                fs = FileStat(is_dir, entry.st_size, entry.st_mtime)
                result.append((entry.filename, fs))
        except IOError:
            pass
        return result

    def stat(self, path: str) -> Optional[FileStat]:
        try:
            st = self._sftp.stat(path)
            return FileStat(stat.S_ISDIR(st.st_mode), st.st_size, st.st_mtime)
        except IOError:
            return None

    def mkdir(self, path: str):
        self._mkdir_parents(path)

    def delete(self, path: str, recursive: bool = False):
        try:
            st = self._sftp.stat(path)
            if stat.S_ISDIR(st.st_mode):
                if recursive:
                    self._ssh.exec_command(f"rm -rf {path}")
                else:
                    self._sftp.rmdir(path)
            else:
                self._sftp.remove(path)
        except IOError:
            pass

    def exec_command(self, command: str) -> Tuple[int, str, str]:
        stdin, stdout, stderr = self._ssh.exec_command(command, timeout=30)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()

    def close(self):
        try:
            if self._sftp:
                self._sftp.close()
        finally:
            if self._ssh:
                self._ssh.close()


class WSLFileSystem(VirtualFileSystem):
    """Access Linux files inside a WSL distribution via \\\\wsl$\\ mount."""

    def __init__(self, distro: str = "Ubuntu"):
        self.distro = distro
        if platform.system() != "Windows":
            raise RuntimeError("WSL is only available on Windows")
        self._mount_prefix = f"\\\\wsl$\\{distro}"

    def _to_wsl_path(self, path: str) -> str:
        """Convert a Linux path like /home/user/file to wsl mount path."""
        path = path.replace("/", "\\").lstrip("\\")
        return f"{self._mount_prefix}\\{path}"

    def _from_wsl_path(self, wsl_path: str) -> str:
        """Convert a WSL mount path back to a Linux path."""
        rel = wsl_path[len(self._mount_prefix):].lstrip("\\")
        return "/" + rel.replace("\\", "/")

    def read_file(self, path: str) -> bytes:
        win_path = self._to_wsl_path(path)
        with open(win_path, 'rb') as f:
            return f.read()

    def write_file(self, path: str, content: bytes):
        win_path = self._to_wsl_path(path)
        os.makedirs(os.path.dirname(win_path), exist_ok=True)
        with open(win_path, 'wb') as f:
            f.write(content)

    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        win_path = self._to_wsl_path(path)
        if not os.path.exists(win_path):
            return []
        result = []
        for entry in os.scandir(win_path):
            st = entry.stat()
            fs = FileStat(entry.is_dir(), st.st_size, st.st_mtime)
            result.append((entry.filename, fs))
        return result

    def stat(self, path: str) -> Optional[FileStat]:
        win_path = self._to_wsl_path(path)
        if not os.path.exists(win_path):
            return None
        st = os.stat(win_path)
        return FileStat(stat.S_ISDIR(st.st_mode), st.st_size, st.st_mtime)

    def mkdir(self, path: str):
        win_path = self._to_wsl_path(path)
        os.makedirs(win_path, exist_ok=True)

    def delete(self, path: str, recursive: bool = False):
        win_path = self._to_wsl_path(path)
        if os.path.isdir(win_path):
            if recursive:
                shutil.rmtree(win_path)
            else:
                os.rmdir(win_path)
        else:
            os.remove(win_path)

    def exec_wsl(self, command: str) -> str:
        """Execute a command inside WSL and return output."""
        full_cmd = ["wsl", "-d", self.distro, "-e", "sh", "-c", command]
        result = subprocess.run(full_cmd, capture_output=True, text=True, timeout=30)
        return result.stdout

    @staticmethod
    def list_distributions() -> List[str]:
        """List installed WSL distributions."""
        try:
            result = subprocess.run(["wsl", "-l", "-q"], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return [d.strip() for d in result.stdout.splitlines() if d.strip()]
        except Exception:
            pass
        return []


class ContainerFileSystem(VirtualFileSystem):
    """Access files inside a Docker container via docker cp / exec."""

    def __init__(self, container_id: str):
        self.container_id = container_id

    def _run_docker_exec(self, cmd: str) -> subprocess.CompletedProcess:
        full_cmd = ["docker", "exec", self.container_id, "sh", "-c", cmd]
        return subprocess.run(full_cmd, capture_output=True, text=True)

    def read_file(self, path: str) -> bytes:
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            temp_path = tf.name
        try:
            cmd = ["docker", "cp", f"{self.container_id}:{path}", temp_path]
            result = subprocess.run(cmd, capture_output=True)
            if result.returncode != 0:
                raise FileNotFoundError(f"Container file not found: {path}")
            with open(temp_path, 'rb') as f:
                return f.read()
        finally:
            os.remove(temp_path)

    def write_file(self, path: str, content: bytes):
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            tf.write(content)
            temp_path = tf.name
        try:
            remote_dir = os.path.dirname(path)
            self._run_docker_exec(f"mkdir -p {remote_dir}")
            cmd = ["docker", "cp", temp_path, f"{self.container_id}:{path}"]
            subprocess.run(cmd, check=True)
        finally:
            os.remove(temp_path)

    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        result = self._run_docker_exec(f"stat -c '%n|%F|%s|%Y' {path}/* 2>/dev/null; stat -c '%n|%F|%s|%Y' {path}/.* 2>/dev/null")
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
                if name in (".", ".."):
                    continue
                if name in seen:
                    continue
                seen.add(name)
                is_dir = parts[1] == "directory"
                size = int(parts[2])
                mtime = float(parts[3])
                items.append((name, FileStat(is_dir, size, mtime)))
        return items

    def stat(self, path: str) -> Optional[FileStat]:
        result = self._run_docker_exec(f"stat -c '%F|%s|%Y' {path} 2>/dev/null")
        if result.returncode != 0 or not result.stdout.strip():
            return None
        parts = result.stdout.strip().split('|')
        if len(parts) >= 3:
            is_dir = parts[0] == "directory"
            size = int(parts[1])
            mtime = float(parts[2])
            return FileStat(is_dir, size, mtime)
        return None

    def mkdir(self, path: str):
        self._run_docker_exec(f"mkdir -p {path}")

    def delete(self, path: str, recursive: bool = False):
        if recursive:
            self._run_docker_exec(f"rm -rf {path}")
        else:
            self._run_docker_exec(f"rm {path}")
