import os
import json
import logging
from typing import List, Dict, Optional, Any
from PySide6.QtCore import QObject, Signal, QFileSystemWatcher, QTimer

logger = logging.getLogger(__name__)

class WorkspaceFolder:
    def __init__(self, name: str, path: str):
        self.name = name
        self.path = os.path.abspath(path)
        
    def __repr__(self):
        return f"WorkspaceFolder(name={self.name}, path={self.path})"


class MultiRootWorkspace(QObject):
    """Manages multi-root workspace (.code-workspace file) semantics."""
    
    workspace_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.workspace_file: Optional[str] = None
        self.folders: List[WorkspaceFolder] = []
        self.settings: Dict[str, Any] = {}
        self.extensions: Dict[str, Any] = {}
        self.launch: Dict[str, Any] = {}
        self._watcher = QFileSystemWatcher(self)
        self._watcher.fileChanged.connect(self._on_file_changed)
        self._debounce_timer = QTimer(self)
        self._debounce_timer.setSingleShot(True)
        self._debounce_timer.setInterval(500)
        self._debounce_timer.timeout.connect(self._reload_workspace)

    def _on_file_changed(self, path: str):
        if path == self.workspace_file:
            self._debounce_timer.start()

    def _reload_workspace(self):
        if self.workspace_file:
            if self.load_from_file(self.workspace_file):
                self.workspace_changed.emit()

    def load_from_file(self, workspace_file_path: str) -> bool:
        """Load a .code-workspace JSON file."""
        if not os.path.exists(workspace_file_path):
            logger.error(f"Workspace file not found: {workspace_file_path}")
            return False
            
        try:
            with open(workspace_file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Naive JSONC parsing (stripping // comments)
                lines = [line for line in content.split('\n') if not line.strip().startswith('//')]
                data = json.loads('\n'.join(lines))
                
                self.workspace_file = os.path.abspath(workspace_file_path)
                workspace_dir = os.path.dirname(self.workspace_file)
                
                self.folders = []
                for folder_data in data.get("folders", []):
                    path = folder_data.get("path")
                    if path:
                        # Path can be absolute or relative to the workspace file
                        if not os.path.isabs(path):
                            path = os.path.join(workspace_dir, path)
                            
                        name = folder_data.get("name", os.path.basename(path))
                        self.folders.append(WorkspaceFolder(name, path))
                
                self.settings = data.get("settings", {})
                self.extensions = data.get("extensions", {})
                self.launch = data.get("launch", {})
                
                logger.info(f"Loaded multi-root workspace with {len(self.folders)} folders.")
                
                # Update watcher
                if self.workspace_file not in self._watcher.files():
                    self._watcher.addPath(self.workspace_file)
                    
                return True
                
        except Exception as e:
            logger.error(f"Failed to parse workspace file {workspace_file_path}: {e}")
            return False

    def get_folders(self) -> List[WorkspaceFolder]:
        return self.folders

    def get_settings(self) -> Dict[str, Any]:
        """Get settings defined at the multi-root workspace level."""
        return self.settings

    def get_extensions(self) -> Dict[str, Any]:
        """Get extension recommendations at the multi-root workspace level."""
        return self.extensions

    def get_launch(self) -> Dict[str, Any]:
        """Get launch configurations at the multi-root workspace level."""
        return self.launch

    def add_folder(self, path: str, name: Optional[str] = None) -> bool:
        """Add a folder to the workspace."""
        path = os.path.abspath(path)
        for f in self.folders:
            if f.path == path:
                return False
        
        folder_name = name or os.path.basename(path)
        self.folders.append(WorkspaceFolder(folder_name, path))
        return True

    def remove_folder(self, path: str) -> bool:
        """Remove a folder from the workspace by path."""
        path = os.path.abspath(path)
        for i, f in enumerate(self.folders):
            if f.path == path:
                self.folders.pop(i)
                return True
        return False

    def is_multi_root(self) -> bool:
        return len(self.folders) > 1

    def save_workspace(self, save_path: str) -> bool:
        """Save current folders and settings to a new .code-workspace file."""
        try:
            data = {
                "folders": [{"path": f.path, "name": f.name} for f in self.folders],
                "settings": self.settings,
                "extensions": self.extensions,
                "launch": self.launch
            }
            tmp = save_path + ".tmp"
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
                
            if self.workspace_file and self.workspace_file in self._watcher.files():
                self._watcher.removePath(self.workspace_file)
                
            os.replace(tmp, save_path)
            self.workspace_file = os.path.abspath(save_path)
            self._watcher.addPath(self.workspace_file)
            return True
        except Exception as e:
            logger.error(f"Failed to save workspace to {save_path}: {e}")
            return False
