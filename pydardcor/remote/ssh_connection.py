import logging
import subprocess
import threading
import stat
from typing import List, Tuple, Optional
from .vfs import VirtualFileSystem, FileStat

logger = logging.getLogger(__name__)

class SshFileSystem(VirtualFileSystem):
    """Implementation of VFS via SSH (SFTP/SCP under the hood)."""
    
    def __init__(self, host: str, user: str, port: int = 22, key_path: str = None):
        self.host = host
        self.user = user
        self.port = port
        self.key_path = key_path
        
        # In a complete implementation, we would use paramiko or asyncssh here
        # For this prototype, we'll shell out to standard ssh/scp commands
        # which is very inefficient but proves the architecture.
        self._ssh_base_cmd = ["ssh", "-p", str(port)]
        if key_path:
            self._ssh_base_cmd.extend(["-i", key_path])
        self._ssh_base_cmd.append(f"{user}@{host}")

    def _run_ssh_cmd(self, remote_cmd: str) -> subprocess.CompletedProcess:
        cmd = self._ssh_base_cmd + [remote_cmd]
        return subprocess.run(cmd, capture_output=True, text=True)

    def read_file(self, path: str) -> bytes:
        # Better approach is SFTP. This is a naive placeholder.
        cmd = self._ssh_base_cmd + [f"cat {path}"]
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            raise FileNotFoundError(f"Remote file not found: {path}")
        return result.stdout

    def write_file(self, path: str, content: bytes):
        import tempfile
        import os
        
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            tf.write(content)
            temp_path = tf.name
            
        try:
            # First ensure directory exists remotely
            remote_dir = os.path.dirname(path)
            self._run_ssh_cmd(f"mkdir -p {remote_dir}")
            
            # SCP the file
            scp_cmd = ["scp", "-P", str(self.port)]
            if self.key_path:
                scp_cmd.extend(["-i", self.key_path])
            scp_cmd.extend([temp_path, f"{self.user}@{self.host}:{path}"])
            
            subprocess.run(scp_cmd, check=True)
        finally:
            os.remove(temp_path)

    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        # stat -c "%n|%F|%s|%Y"
        result = self._run_ssh_cmd(f"stat -c '%n|%F|%s|%Y' {path}/*")
        if result.returncode != 0:
            return []
            
        items = []
        for line in result.stdout.strip().split('\n'):
            if not line: continue
            parts = line.split('|')
            if len(parts) >= 4:
                name = os.path.basename(parts[0])
                is_dir = parts[1] == "directory"
                size = int(parts[2])
                mtime = float(parts[3])
                items.append((name, FileStat(is_dir, size, mtime)))
        return items

    def stat(self, path: str) -> Optional[FileStat]:
        result = self._run_ssh_cmd(f"stat -c '%F|%s|%Y' {path}")
        if result.returncode != 0:
            return None
            
        parts = result.stdout.strip().split('|')
        if len(parts) >= 3:
            is_dir = parts[0] == "directory"
            size = int(parts[1])
            mtime = float(parts[2])
            return FileStat(is_dir, size, mtime)
        return None

    def mkdir(self, path: str):
        self._run_ssh_cmd(f"mkdir -p {path}")

    def delete(self, path: str, recursive: bool = False):
        if recursive:
            self._run_ssh_cmd(f"rm -rf {path}")
        else:
            self._run_ssh_cmd(f"rm {path}")
