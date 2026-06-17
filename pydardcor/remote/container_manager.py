import json
import logging
import subprocess
from typing import List, Tuple, Optional
from .vfs import VirtualFileSystem, FileStat

logger = logging.getLogger(__name__)

class ContainerFileSystem(VirtualFileSystem):
    """Implementation of VFS for Docker/Dev Containers."""
    
    def __init__(self, container_id: str):
        self.container_id = container_id

    def _run_docker_exec(self, cmd: str) -> subprocess.CompletedProcess:
        full_cmd = ["docker", "exec", self.container_id, "sh", "-c", cmd]
        return subprocess.run(full_cmd, capture_output=True, text=True)

    def read_file(self, path: str) -> bytes:
        # docker cp is safer for binary files than docker exec cat
        import tempfile
        import os
        
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
        import os
        
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
        result = self._run_docker_exec(f"stat -c '%n|%F|%s|%Y' {path}/*")
        if result.returncode != 0:
            return []
            
        items = []
        for line in result.stdout.strip().split('\n'):
            if not line: continue
            parts = line.split('|')
            if len(parts) >= 4:
                import os
                name = os.path.basename(parts[0])
                is_dir = parts[1] == "directory"
                size = int(parts[2])
                mtime = float(parts[3])
                items.append((name, FileStat(is_dir, size, mtime)))
        return items

    def stat(self, path: str) -> Optional[FileStat]:
        result = self._run_docker_exec(f"stat -c '%F|%s|%Y' {path}")
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
        self._run_docker_exec(f"mkdir -p {path}")

    def delete(self, path: str, recursive: bool = False):
        if recursive:
            self._run_docker_exec(f"rm -rf {path}")
        else:
            self._run_docker_exec(f"rm {path}")
