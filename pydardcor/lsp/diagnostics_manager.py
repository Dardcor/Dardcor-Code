import logging
import threading
from typing import Dict, List, Any, Callable, Optional, Set

logger = logging.getLogger(__name__)

class DiagnosticsManager:
    """Manages diagnostics (errors/warnings) reported by the Language Server."""

    def __init__(self, debounce_ms: int = 100):
        # Maps URI -> list of diagnostics
        self._diagnostics: Dict[str, List[dict]] = {}
        # Callbacks to notify UI when diagnostics change
        self._listeners: List[Callable[[str, List[dict]], None]] = []
        self._debounce_ms = max(0, debounce_ms) / 1000.0
        self._pending_uris: Set[str] = set()
        self._debounce_lock = threading.Lock()
        self._debounce_timer: Optional[threading.Timer] = None

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
        self._schedule_notify(uri)

    def get_diagnostics(self, uri: str) -> List[dict]:
        """Get the current diagnostics for a file."""
        return self._diagnostics.get(uri, [])

    def clear_diagnostics(self, uri: str):
        """Clear diagnostics for a file."""
        if uri in self._diagnostics:
            del self._diagnostics[uri]
            self._schedule_notify(uri)

    def _schedule_notify(self, uri: str):
        if not self._listeners:
            return
        if self._debounce_ms <= 0:
            self._notify_uri(uri)
            return

        with self._debounce_lock:
            self._pending_uris.add(uri)
            if self._debounce_timer is not None:
                self._debounce_timer.cancel()
            self._debounce_timer = threading.Timer(
                self._debounce_ms, self._flush_pending
            )
            self._debounce_timer.daemon = True
            self._debounce_timer.start()

    def _flush_pending(self):
        with self._debounce_lock:
            uris = list(self._pending_uris)
            self._pending_uris.clear()
            self._debounce_timer = None
        for uri in uris:
            self._notify_uri(uri)

    def _notify_uri(self, uri: str):
        markers = self._diagnostics.get(uri, [])
        for listener in self._listeners:
            try:
                listener(uri, markers)
            except Exception as e:
                logger.error(f"Error in diagnostics listener: {e}")

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
