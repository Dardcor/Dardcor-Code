import os
import json
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class WorkspaceFolder:
    def __init__(self, name: str, path: str):
        self.name = name
        self.path = os.path.abspath(path)
        
    def __repr__(self):
        return f"WorkspaceFolder(name={self.name}, path={self.path})"


class MultiRootWorkspace:
    """Manages multi-root workspace (.code-workspace file) semantics."""

    def __init__(self):
        self.workspace_file: Optional[str] = None
        self.folders: List[WorkspaceFolder] = []
        self.settings: Dict[str, Any] = {}

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
                
                logger.info(f"Loaded multi-root workspace with {len(self.folders)} folders.")
                return True
                
        except Exception as e:
            logger.error(f"Failed to parse workspace file {workspace_file_path}: {e}")
            return False

    def get_folders(self) -> List[WorkspaceFolder]:
        return self.folders

    def get_settings(self) -> Dict[str, Any]:
        """Get settings defined at the multi-root workspace level."""
        return self.settings

    def is_multi_root(self) -> bool:
        return len(self.folders) > 1

    def save_workspace(self, save_path: str) -> bool:
        """Save current folders and settings to a new .code-workspace file."""
        try:
            data = {
                "folders": [{"path": f.path, "name": f.name} for f in self.folders],
                "settings": self.settings
            }
            with open(save_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
            self.workspace_file = os.path.abspath(save_path)
            return True
        except Exception as e:
            logger.error(f"Failed to save workspace to {save_path}: {e}")
            return False
