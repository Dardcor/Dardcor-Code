import os
import io
import stat
from abc import ABC, abstractmethod
from typing import List, Dict, Tuple, Optional

class FileStat:
    """Represents file metadata across different filesystems."""
    def __init__(self, is_dir: bool, size: int, mtime: float):
        self.is_dir = is_dir
        self.size = size
        self.mtime = mtime

class VirtualFileSystem(ABC):
    """Abstract base class for filesystem operations (Local, SSH, Container)."""
    
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
            import shutil
            if recursive:
                shutil.rmtree(path)
            else:
                os.rmdir(path)
        else:
            os.remove(path)

class SSHFileSystem(VirtualFileSystem):
    """Implementation of VFS for remote SSH servers using paramiko."""
    
    def __init__(self, hostname, username, password=None, key_filename=None, port=22):
        import paramiko
        self.ssh = paramiko.SSHClient()
        self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.ssh.connect(
            hostname=hostname,
            port=port,
            username=username,
            password=password,
            key_filename=key_filename
        )
        self.sftp = self.ssh.open_sftp()
        
    def read_file(self, path: str) -> bytes:
        import io
        buf = io.BytesIO()
        self.sftp.getfo(path, buf)
        return buf.getvalue()

    def write_file(self, path: str, content: bytes):
        import io
        import os
        # Ensure dir exists remotely is a bit complex, assuming it exists or creating parents
        dirname = os.path.dirname(path.replace('\\', '/'))
        try:
            self.sftp.stat(dirname)
        except IOError:
            self.sftp.mkdir(dirname)
            
        buf = io.BytesIO(content)
        self.sftp.putfo(buf, path)

    def list_dir(self, path: str) -> List[Tuple[str, FileStat]]:
        import stat
        result = []
        try:
            for entry in self.sftp.listdir_attr(path):
                is_dir = stat.S_ISDIR(entry.st_mode)
                fs = FileStat(is_dir, entry.st_size, entry.st_mtime)
                result.append((entry.filename, fs))
        except IOError:
            pass
        return result

    def stat(self, path: str) -> Optional[FileStat]:
        import stat
        try:
            st = self.sftp.stat(path)
            return FileStat(stat.S_ISDIR(st.st_mode), st.st_size, st.st_mtime)
        except IOError:
            return None

    def mkdir(self, path: str):
        self.sftp.mkdir(path)

    def delete(self, path: str, recursive: bool = False):
        import stat
        try:
            st = self.sftp.stat(path)
            if stat.S_ISDIR(st.st_mode):
                if recursive:
                    # Recursive deletion using shell command for simplicity
                    self.ssh.exec_command(f"rm -rf {path}")
                else:
                    self.sftp.rmdir(path)
            else:
                self.sftp.remove(path)
        except IOError:
            pass

    def close(self):
        try:
            self.sftp.close()
        finally:
            self.ssh.close()
