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
