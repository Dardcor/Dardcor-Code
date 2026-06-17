import logging
from typing import Dict, List, Any, Callable

logger = logging.getLogger(__name__)

class DiagnosticsManager:
    """Manages diagnostics (errors/warnings) reported by the Language Server."""

    def __init__(self):
        # Maps URI -> list of diagnostics
        self._diagnostics: Dict[str, List[dict]] = {}
        # Callbacks to notify UI when diagnostics change
        self._listeners: List[Callable[[str, List[dict]], None]] = []

    def on_diagnostics_update(self, callback: Callable[[str, List[dict]], None]):
        """Register a callback for when diagnostics for a file change."""
        self._listeners.append(callback)

    def handle_publish_diagnostics(self, params: dict):
        """Handle textDocument/publishDiagnostics notification from LSP server."""
        uri = params.get("uri")
        diagnostics = params.get("diagnostics", [])
        
        if not uri:
            return
            
        # Convert LSP diagnostics to Monaco marker format
        monaco_markers = self._convert_to_monaco_markers(diagnostics)
        self._diagnostics[uri] = monaco_markers
        
        for listener in self._listeners:
            try:
                listener(uri, monaco_markers)
            except Exception as e:
                logger.error(f"Error in diagnostics listener: {e}")

    def get_diagnostics(self, uri: str) -> List[dict]:
        """Get the current diagnostics for a file."""
        return self._diagnostics.get(uri, [])

    def clear_diagnostics(self, uri: str):
        """Clear diagnostics for a file."""
        if uri in self._diagnostics:
            del self._diagnostics[uri]
            for listener in self._listeners:
                listener(uri, [])

    def _convert_to_monaco_markers(self, lsp_diagnostics: List[dict]) -> List[dict]:
        """
        Convert LSP Diagnostic to Monaco IMarkerData.
        LSP is 0-indexed, Monaco is 1-indexed.
        """
        markers = []
        for diag in lsp_diagnostics:
            try:
                range_obj = diag.get("range", {})
                start = range_obj.get("start", {})
                end = range_obj.get("end", {})
                
                # Monaco Marker Severity:
                # 8 = Error, 4 = Warning, 2 = Info, 1 = Hint
                severity = diag.get("severity", 1)
                monaco_severity = 1
                if severity == 1: monaco_severity = 8 # Error
                elif severity == 2: monaco_severity = 4 # Warning
                elif severity == 3: monaco_severity = 2 # Information
                elif severity == 4: monaco_severity = 1 # Hint

                markers.append({
                    "severity": monaco_severity,
                    "message": diag.get("message", ""),
                    "startLineNumber": start.get("line", 0) + 1,
                    "startColumn": start.get("character", 0) + 1,
                    "endLineNumber": end.get("line", 0) + 1,
                    "endColumn": end.get("character", 0) + 1,
                    "source": diag.get("source", "LSP"),
                })
            except Exception as e:
                logger.warning(f"Failed to convert diagnostic: {e}")
                
        return markers
