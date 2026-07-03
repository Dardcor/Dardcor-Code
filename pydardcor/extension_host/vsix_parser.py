import os
import zipfile
import json
import shutil
from pathlib import Path
from typing import Dict, Any, Optional

from ..core.config import get_extensions_dir


class VsixParser:
    """Parser for Visual Studio Code extension (.vsix) files."""

    def __init__(self, extensions_dir: str = None):
        if extensions_dir is None:
            self.extensions_dir = get_extensions_dir()
        else:
            self.extensions_dir = extensions_dir
        
        os.makedirs(self.extensions_dir, exist_ok=True)

    def is_valid_vsix(self, vsix_path: str) -> bool:
        """Check if the given file is a valid VSIX archive."""
        if not zipfile.is_zipfile(vsix_path):
            return False
            
        with zipfile.ZipFile(vsix_path, 'r') as zf:
            namelist = zf.namelist()
            return 'extension/package.json' in namelist

    def extract_vsix(self, vsix_path: str) -> Optional[str]:
        """
        Extract a VSIX file to the extensions directory.
        Returns the path to the extracted extension directory, or None if invalid.
        """
        if not self.is_valid_vsix(vsix_path):
            return None

        # Read package.json to get publisher and name
        with zipfile.ZipFile(vsix_path, 'r') as zf:
            package_json_data = zf.read('extension/package.json')
            manifest = json.loads(package_json_data)
            
            publisher = manifest.get('publisher', 'unknown')
            name = manifest.get('name', 'unknown')
            version = manifest.get('version', '0.0.0')
            
            extension_id = f"{publisher}.{name}-{version}"
            target_dir = os.path.join(self.extensions_dir, extension_id)
            
            # Remove if exists
            if os.path.exists(target_dir):
                shutil.rmtree(target_dir)
                
            os.makedirs(target_dir)
            
            # Extract everything under 'extension/' to target_dir
            for member in zf.namelist():
                if member.startswith('extension/'):
                    # Strip 'extension/' prefix
                    relative_path = member[len('extension/'):]
                    if not relative_path:
                        continue
                        
                    target_path = os.path.join(target_dir, relative_path)
                    
                    if member.endswith('/'):
                        os.makedirs(target_path, exist_ok=True)
                    else:
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        with zf.open(member) as source, open(target_path, 'wb') as target:
                            shutil.copyfileobj(source, target)
                            
        return target_dir

    def read_manifest(self, extension_dir: str) -> Optional[Dict[str, Any]]:
        """Read the package.json manifest of an extracted extension."""
        package_json_path = os.path.join(extension_dir, "package.json")
        if not os.path.exists(package_json_path):
            return None
            
        try:
            with open(package_json_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None

    def list_installed_extensions(self) -> list[Dict[str, Any]]:
        """List all installed extensions with their manifest data."""
        extensions = []
        if not os.path.exists(self.extensions_dir):
            return extensions
            
        for d in os.listdir(self.extensions_dir):
            ext_dir = os.path.join(self.extensions_dir, d)
            if os.path.isdir(ext_dir):
                manifest = self.read_manifest(ext_dir)
                if manifest:
                    manifest['_path'] = ext_dir
                    extensions.append(manifest)
                    
        return extensions
