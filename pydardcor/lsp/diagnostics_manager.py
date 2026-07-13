import logging
import threading
from typing import Dict, List, Any, Callable, Optional, Set
from datetime import datetime

logger = logging.getLogger(__name__)


# Monaco marker severity constants
MONACO_SEVERITY = {
    "hint": 1,
    "info": 2,
    "warning": 4,
    "error": 8,
}

# LSP DiagnosticSeverity
LSP_SEVERITY_ERROR = 1
LSP_SEVERITY_WARNING = 2
LSP_SEVERITY_INFO = 3
LSP_SEVERITY_HINT = 4


class DiagnosticsManager:
    """Manages diagnostics (errors/warnings) reported by the Language Server.

    Supports:
    - Debounced notifications
    - Multiple URI tracking
    - Monaco marker conversion
    - Related information / code descriptions
    - Diagnostic tags
    - Version tracking
    - Diagnostic pull model integration
    - Workspace diagnostics
    """

    def __init__(self, debounce_ms: int = 100):
        self._diagnostics: Dict[str, List[dict]] = {}
        self._diagnostic_versions: Dict[str, int] = {}
        self._last_result_ids: Dict[str, str] = {}
        self._listeners: List[Callable[[str, List[dict], Optional[int]], None]] = []
        self._workspace_listeners: List[Callable[[Dict], None]] = []
        self._debounce_ms = max(0, debounce_ms) / 1000.0
        self._pending_uris: Set[str] = set()
        self._debounce_lock = threading.Lock()
        self._debounce_timer: Optional[threading.Timer] = None

    # ── Registration ───────────────────────────────────────────────────────

    def on_diagnostics_update(self, callback: Callable[[str, List[dict], Optional[int]], None]):
        self._listeners.append(callback)

    def on_workspace_diagnostics(self, callback: Callable[[Dict], None]):
        self._workspace_listeners.append(callback)

    # ── Handling LSP Notifications ─────────────────────────────────────────

    def handle_publish_diagnostics(self, params: dict):
        uri = params.get("uri")
        diagnostics = params.get("diagnostics", [])
        version = params.get("version")

        if not uri:
            return

        monaco_markers = self._convert_to_monaco_markers(diagnostics)
        self._diagnostics[uri] = monaco_markers
        if version is not None:
            self._diagnostic_versions[uri] = version
        self._schedule_notify(uri)

    def handle_workspace_diagnostics(self, params: dict):
        items = params.get("items", [])
        for listener in self._workspace_listeners:
            try:
                listener(params)
            except Exception as e:
                logger.error(f"Error in workspace diagnostics listener: {e}")

        for item in items:
            uri = item.get("uri")
            diagnostics = item.get("diagnostics", [])
            version = item.get("version")
            if uri:
                monaco_markers = self._convert_to_monaco_markers(diagnostics)
                self._diagnostics[uri] = monaco_markers
                if version is not None:
                    self._diagnostic_versions[uri] = version
                self._schedule_notify(uri)

    def handle_diagnostic_result(self, params: dict):
        kind = params.get("kind")
        if kind == "full":
            items = params.get("items", [])
            for item in items:
                uri = item.get("uri")
                diagnostics = item.get("diagnostics", [])
                result_id = item.get("resultId")
                version = item.get("version")
                if uri:
                    monaco_markers = self._convert_to_monaco_markers(diagnostics)
                    self._diagnostics[uri] = monaco_markers
                    if result_id:
                        self._last_result_ids[uri] = result_id
                    if version is not None:
                        self._diagnostic_versions[uri] = version
                    self._schedule_notify(uri)
        elif kind == "unChanged":
            pass

    # ── Query ──────────────────────────────────────────────────────────────

    def get_diagnostics(self, uri: str) -> List[dict]:
        return self._diagnostics.get(uri, [])

    def get_all_diagnostics(self) -> Dict[str, List[dict]]:
        return dict(self._diagnostics)

    def get_diagnostic_version(self, uri: str) -> Optional[int]:
        return self._diagnostic_versions.get(uri)

    def get_last_result_id(self, uri: str) -> Optional[str]:
        return self._last_result_ids.get(uri)

    def get_error_count(self, uri: str) -> int:
        return sum(
            1 for m in self._diagnostics.get(uri, [])
            if m.get("severity") == MONACO_SEVERITY["error"]
        )

    def get_warning_count(self, uri: str) -> int:
        return sum(
            1 for m in self._diagnostics.get(uri, [])
            if m.get("severity") == MONACO_SEVERITY["warning"]
        )

    def get_info_count(self, uri: str) -> int:
        return sum(
            1 for m in self._diagnostics.get(uri, [])
            if m.get("severity") == MONACO_SEVERITY["info"]
        )

    def has_diagnostics(self, uri: str) -> bool:
        return len(self._diagnostics.get(uri, [])) > 0

    def clear_diagnostics(self, uri: str):
        self._diagnostics.pop(uri, None)
        self._diagnostic_versions.pop(uri, None)
        self._last_result_ids.pop(uri, None)
        self._schedule_notify(uri)

    def clear_all(self):
        uris = list(self._diagnostics.keys())
        self._diagnostics.clear()
        self._diagnostic_versions.clear()
        self._last_result_ids.clear()
        for uri in uris:
            self._schedule_notify(uri)

    # ── Debounce / Notify ──────────────────────────────────────────────────

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
        version = self._diagnostic_versions.get(uri)
        for listener in self._listeners:
            try:
                listener(uri, markers, version)
            except Exception as e:
                logger.error(f"Error in diagnostics listener: {e}")

    # ── LSP → Monaco Conversion ────────────────────────────────────────────

    def _convert_to_monaco_markers(self, lsp_diagnostics: List[dict]) -> List[dict]:
        markers = []
        for diag in lsp_diagnostics:
            try:
                range_obj = diag.get("range", {})
                start = range_obj.get("start", {})
                end = range_obj.get("end", {})

                severity = diag.get("severity", LSP_SEVERITY_HINT)
                monaco_severity = MONACO_SEVERITY["hint"]
                if severity == LSP_SEVERITY_ERROR:
                    monaco_severity = MONACO_SEVERITY["error"]
                elif severity == LSP_SEVERITY_WARNING:
                    monaco_severity = MONACO_SEVERITY["warning"]
                elif severity == LSP_SEVERITY_INFO:
                    monaco_severity = MONACO_SEVERITY["info"]

                marker = {
                    "severity": monaco_severity,
                    "message": diag.get("message", ""),
                    "startLineNumber": start.get("line", 0) + 1,
                    "startColumn": start.get("character", 0) + 1,
                    "endLineNumber": end.get("line", 0) + 1,
                    "endColumn": end.get("character", 0) + 1,
                    "source": diag.get("source", "LSP"),
                    "code": diag.get("code", ""),
                }

                tags = diag.get("tags", [])
                if tags:
                    marker["tags"] = tags

                related_info = diag.get("relatedInformation")
                if related_info:
                    marker["relatedInformation"] = related_info

                code_description = diag.get("codeDescription")
                if code_description:
                    marker["codeDescription"] = code_description

                data = diag.get("data")
                if data:
                    marker["data"] = data

                markers.append(marker)
            except Exception as e:
                logger.warning(f"Failed to convert diagnostic: {e}")

        return markers
