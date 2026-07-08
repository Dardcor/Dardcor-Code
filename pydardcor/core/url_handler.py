"""URL Handler - Deep linking handler (dardcor-code:// and vscode:// protocols) for opening files and extensions."""

import urllib.parse
from PySide6.QtCore import QObject, Signal

class URLHandler(QObject):
    """Parses deep-link URIs and triggers corresponding application commands."""
    
    open_file_requested = Signal(str, int, int)  # filepath, line, col
    install_extension_requested = Signal(str)  # extension_id

    def __init__(self, parent=None):
        super().__init__(parent)

    def handle_uri(self, uri: str) -> bool:
        """Parses deep link schemes.
        
        Supported formats:
        - dardcor-code://file/C:/path/to/file#10:2
        - dardcor-code://extension/install?id=publisher.name
        """
        if not uri:
            return False
            
        try:
            parsed = urllib.parse.urlparse(uri)
            if parsed.scheme not in ["dardcor-code", "vscode"]:
                return False
                
            path_parts = parsed.path.strip("/").split("/")
            
            # Action matches: /file/...
            if parsed.netloc == "file" or (len(path_parts) > 0 and path_parts[0] == "file"):
                # Clean up target filepath
                file_path = parsed.path
                if parsed.netloc == "file":
                    file_path = parsed.path
                else:
                    file_path = "/".join(path_parts[1:])
                
                # Normalize windows drive letters (e.g. /C:/ -> C:/)
                if file_path.startswith("/") and len(file_path) > 2 and file_path[2] == ":":
                    file_path = file_path[1:]
                
                line, col = 1, 1
                fragment = parsed.fragment
                if fragment:
                    parts = fragment.split(":")
                    if len(parts) >= 1:
                        try:
                            line = int(parts[0])
                        except ValueError:
                            pass
                    if len(parts) >= 2:
                        try:
                            col = int(parts[1])
                        except ValueError:
                            pass
                            
                self.open_file_requested.emit(file_path, line, col)
                return True
                
            # Action matches: /extension/install?...
            elif parsed.netloc == "extension" or (len(path_parts) > 0 and path_parts[0] == "extension"):
                query = urllib.parse.parse_qs(parsed.query)
                ext_id = query.get("id", [None])[0]
                if ext_id:
                    self.install_extension_requested.emit(ext_id)
                    return True
                    
            return False
        except Exception:
            return False
