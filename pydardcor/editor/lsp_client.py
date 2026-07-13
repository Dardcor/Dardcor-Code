"""Language Server Protocol (LSP) Client for Dardcor Code with full feature support."""

import os
import json
import subprocess
import threading
from typing import Dict, Any, List, Optional, Callable, Tuple
from PySide6.QtCore import QObject, Signal, QThread, QMutex


class LSPClient(QObject):
    """A client for communicating with Language Servers via JSON-RPC.

    Emits Qt signals for all LSP features so that Qt-based UI components
    can react to server events.
    """

    diagnostics_ready = Signal(str, list)
    diagnostics_cleared = Signal(str)
    telemetry_event = Signal(dict)
    log_message = Signal(str, str)
    show_message = Signal(str, str)
    show_document = Signal(str, bool)
    progress_begin = Signal(str, str, dict)
    progress_report = Signal(str, str, dict)
    progress_end = Signal(str)
    server_capabilities_ready = Signal(dict)
    connected = Signal()
    disconnected = Signal(str)

    def __init__(self, command: list, parent=None):
        super().__init__(parent)
        self.command = command
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 1
        self._callbacks: Dict[int, Callable] = {}
        self._reader_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._initialized = False
        self._server_capabilities: Dict[str, Any] = {}
        self._request_seq = 0
        self._pending: Dict[int, threading.Event] = {}
        self._pending_results: Dict[int, Any] = {}

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start(self) -> bool:
        if self._process:
            return True
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                **kwargs
            )
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            success = self._initialize()
            if success:
                self._initialized = True
                self.server_capabilities_ready.emit(self._server_capabilities)
                self.connected.emit()
            return success
        except Exception as e:
            self.disconnected.emit(str(e))
            return False

    def _initialize(self) -> bool:
        result = self.send_request_sync("initialize", {
            "processId": os.getpid(),
            "rootUri": None,
            "capabilities": {
                "textDocument": {
                    "synchronization": {"didOpen": True, "didChange": True, "didSave": True, "willSave": True},
                    "completion": {"completionItem": {"snippetSupport": True, "documentationFormat": ["markdown", "plaintext"]}},
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                    "signatureHelp": {"signatureInformation": {"parameterInformation": {"labelOffsetSupport": True}}},
                    "declaration": {"linkSupport": True},
                    "definition": {"linkSupport": True},
                    "typeDefinition": {"linkSupport": True},
                    "implementation": {"linkSupport": True},
                    "references": {},
                    "documentHighlight": {},
                    "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                    "codeAction": {"codeActionLiteralSupport": {"codeActionKind": {"valueSet": ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports"]}}},
                    "codeLens": {},
                    "formatting": {},
                    "rangeFormatting": {},
                    "rename": {"prepareSupport": True},
                    "publishDiagnostics": {"relatedInformation": True, "versionSupport": True},
                    "semanticTokens": {"requests": {"full": {"delta": True}}},
                    "inlayHint": {},
                    "inlineValue": {},
                    "linkedEditingRange": {},
                    "callHierarchy": {},
                    "typeHierarchy": {},
                    "foldingRange": {"lineFoldingOnly": True},
                    "selectionRange": {},
                    "documentLink": {},
                    "documentColor": {},
                    "inlineCompletion": {},
                },
                "workspace": {
                    "workspaceFolders": True,
                    "didChangeConfiguration": {},
                    "symbol": {},
                    "diagnostics": {},
                },
                "window": {"workDoneProgress": True},
                "telemetry": {},
            },
        }, timeout=10.0)
        if result and "capabilities" in result:
            self._server_capabilities = result.get("capabilities", {})
            self.send_notification("initialized", {})
            return True
        return False

    def is_initialized(self) -> bool:
        return self._initialized

    def get_server_capability(self, key: str, default: Any = None) -> Any:
        return self._server_capabilities.get(key, default)

    def supports_semantic_tokens(self) -> bool:
        provider = self._server_capabilities.get("semanticTokensProvider") or {}
        return bool(provider.get("full") or provider.get("range"))

    def stop(self):
        if self._process:
            try:
                self.send_request_sync("shutdown", {}, timeout=2.0)
            except Exception:
                pass
            self.send_notification("exit", {})
            try:
                self._process.terminate()
                self._process.wait(timeout=3.0)
            except Exception:
                self._process.kill()
            self._process = None
            self._initialized = False
            self.disconnected.emit("shutdown")

    # ── Text Document Sync ─────────────────────────────────────────────────

    def did_open(self, uri: str, language_id: str, text: str):
        self.send_notification("textDocument/didOpen", {
            "textDocument": {"uri": uri, "languageId": language_id, "version": 1, "text": text},
        })

    def did_change(self, uri: str, version: int, changes: List[Dict]):
        self.send_notification("textDocument/didChange", {
            "textDocument": {"uri": uri, "version": version},
            "contentChanges": changes,
        })

    def did_save(self, uri: str, text: Optional[str] = None):
        params = {"textDocument": {"uri": uri}}
        if text is not None:
            params["text"] = text
        self.send_notification("textDocument/didSave", params)

    def did_close(self, uri: str):
        self.send_notification("textDocument/didClose", {"textDocument": {"uri": uri}})

    # ── Completion ─────────────────────────────────────────────────────────

    def request_completion(self, uri: str, line: int, character: int,
                           context: Optional[Dict] = None,
                           callback: Optional[Callable] = None):
        params = {"textDocument": {"uri": uri}, "position": {"line": line, "character": character}}
        if context:
            params["context"] = context
        self.send_request("textDocument/completion", params, callback)

    def request_completion_sync(self, uri: str, line: int, character: int,
                                context: Optional[Dict] = None) -> Optional[Dict]:
        params = {"textDocument": {"uri": uri}, "position": {"line": line, "character": character}}
        if context:
            params["context"] = context
        result = self.send_request_sync("textDocument/completion", params)
        if isinstance(result, list):
            return {"isIncomplete": False, "items": result}
        return result

    # ── Hover ──────────────────────────────────────────────────────────────

    def request_hover(self, uri: str, line: int, character: int,
                      callback: Optional[Callable] = None):
        self.send_request("textDocument/hover", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_hover_sync(self, uri: str, line: int, character: int) -> Optional[Dict]:
        return self.send_request_sync("textDocument/hover", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })

    # ── Signature Help ─────────────────────────────────────────────────────

    def request_signature_help(self, uri: str, line: int, character: int,
                               callback: Optional[Callable] = None):
        self.send_request("textDocument/signatureHelp", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_signature_help_sync(self, uri: str, line: int, character: int) -> Optional[Dict]:
        return self.send_request_sync("textDocument/signatureHelp", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })

    # ── Definition / Navigation ────────────────────────────────────────────

    def request_definition(self, uri: str, line: int, character: int,
                           callback: Optional[Callable] = None):
        self.send_request("textDocument/definition", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_definition_sync(self, uri: str, line: int, character: int) -> Any:
        return self.send_request_sync("textDocument/definition", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })

    def request_declaration(self, uri: str, line: int, character: int,
                            callback: Optional[Callable] = None):
        self.send_request("textDocument/declaration", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_type_definition(self, uri: str, line: int, character: int,
                                callback: Optional[Callable] = None):
        self.send_request("textDocument/typeDefinition", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_implementation(self, uri: str, line: int, character: int,
                               callback: Optional[Callable] = None):
        self.send_request("textDocument/implementation", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    # ── References ─────────────────────────────────────────────────────────

    def request_references(self, uri: str, line: int, character: int,
                           include_declaration: bool = True,
                           callback: Optional[Callable] = None):
        self.send_request("textDocument/references", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
            "context": {"includeDeclaration": include_declaration},
        }, callback)

    def request_references_sync(self, uri: str, line: int, character: int,
                                include_declaration: bool = True) -> List:
        result = self.send_request_sync("textDocument/references", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
            "context": {"includeDeclaration": include_declaration},
        })
        return result if isinstance(result, list) else []

    # ── Document Highlight ─────────────────────────────────────────────────

    def request_document_highlight(self, uri: str, line: int, character: int,
                                   callback: Optional[Callable] = None):
        self.send_request("textDocument/documentHighlight", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_document_highlight_sync(self, uri: str, line: int, character: int) -> List:
        result = self.send_request_sync("textDocument/documentHighlight", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })
        return result if isinstance(result, list) else []

    # ── Document Symbols ───────────────────────────────────────────────────

    def request_document_symbols(self, uri: str, callback: Optional[Callable] = None):
        self.send_request("textDocument/documentSymbol", {
            "textDocument": {"uri": uri},
        }, callback)

    def request_document_symbols_sync(self, uri: str) -> List:
        result = self.send_request_sync("textDocument/documentSymbol", {
            "textDocument": {"uri": uri},
        })
        return result if isinstance(result, list) else []

    # ── Workspace Symbols ──────────────────────────────────────────────────

    def request_workspace_symbols(self, query: str, callback: Optional[Callable] = None):
        self.send_request("workspace/symbol", {"query": query}, callback)

    def request_workspace_symbols_sync(self, query: str) -> List:
        result = self.send_request_sync("workspace/symbol", {"query": query})
        return result if isinstance(result, list) else []

    # ── Code Actions ───────────────────────────────────────────────────────

    def request_code_actions(self, uri: str, range: Dict, context: Dict,
                             callback: Optional[Callable] = None):
        self.send_request("textDocument/codeAction", {
            "textDocument": {"uri": uri},
            "range": range,
            "context": context,
        }, callback)

    def request_code_actions_sync(self, uri: str, range: Dict, context: Dict) -> List:
        result = self.send_request_sync("textDocument/codeAction", {
            "textDocument": {"uri": uri},
            "range": range,
            "context": context,
        })
        return result if isinstance(result, list) else []

    # ── Code Lens ──────────────────────────────────────────────────────────

    def request_code_lens(self, uri: str, callback: Optional[Callable] = None):
        self.send_request("textDocument/codeLens", {"textDocument": {"uri": uri}}, callback)

    def request_code_lens_sync(self, uri: str) -> List:
        result = self.send_request_sync("textDocument/codeLens", {"textDocument": {"uri": uri}})
        return result if isinstance(result, list) else []

    # ── Formatting ─────────────────────────────────────────────────────────

    def request_formatting(self, uri: str, options: Optional[Dict] = None,
                           callback: Optional[Callable] = None):
        self.send_request("textDocument/formatting", {
            "textDocument": {"uri": uri},
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }, callback)

    def request_formatting_sync(self, uri: str, options: Optional[Dict] = None) -> List:
        result = self.send_request_sync("textDocument/formatting", {
            "textDocument": {"uri": uri},
            "options": options or {"tabSize": 4, "insertSpaces": True},
        })
        return result if isinstance(result, list) else []

    def request_range_formatting(self, uri: str, range: Dict,
                                 options: Optional[Dict] = None,
                                 callback: Optional[Callable] = None):
        self.send_request("textDocument/rangeFormatting", {
            "textDocument": {"uri": uri},
            "range": range,
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }, callback)

    def request_range_formatting_sync(self, uri: str, range: Dict,
                                      options: Optional[Dict] = None) -> List:
        result = self.send_request_sync("textDocument/rangeFormatting", {
            "textDocument": {"uri": uri},
            "range": range,
            "options": options or {"tabSize": 4, "insertSpaces": True},
        })
        return result if isinstance(result, list) else []

    # ── Rename ─────────────────────────────────────────────────────────────

    def request_prepare_rename(self, uri: str, line: int, character: int,
                               callback: Optional[Callable] = None):
        self.send_request("textDocument/prepareRename", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_rename(self, uri: str, line: int, character: int, new_name: str,
                       callback: Optional[Callable] = None):
        self.send_request("textDocument/rename", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
            "newName": new_name,
        }, callback)

    def request_rename_sync(self, uri: str, line: int, character: int, new_name: str) -> Optional[Dict]:
        return self.send_request_sync("textDocument/rename", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
            "newName": new_name,
        })

    # ── Folding Range ──────────────────────────────────────────────────────

    def request_folding_range(self, uri: str, callback: Optional[Callable] = None):
        self.send_request("textDocument/foldingRange", {"textDocument": {"uri": uri}}, callback)

    def request_folding_range_sync(self, uri: str) -> List:
        result = self.send_request_sync("textDocument/foldingRange", {"textDocument": {"uri": uri}})
        return result if isinstance(result, list) else []

    # ── Selection Range ────────────────────────────────────────────────────

    def request_selection_range(self, uri: str, positions: List[Dict],
                                callback: Optional[Callable] = None):
        self.send_request("textDocument/selectionRange", {
            "textDocument": {"uri": uri},
            "positions": positions,
        }, callback)

    # ── Document Link ──────────────────────────────────────────────────────

    def request_document_links(self, uri: str, callback: Optional[Callable] = None):
        self.send_request("textDocument/documentLink", {"textDocument": {"uri": uri}}, callback)

    def request_document_links_sync(self, uri: str) -> List:
        result = self.send_request_sync("textDocument/documentLink", {"textDocument": {"uri": uri}})
        return result if isinstance(result, list) else []

    # ── Document Color ─────────────────────────────────────────────────────

    def request_document_color(self, uri: str, callback: Optional[Callable] = None):
        self.send_request("textDocument/documentColor", {"textDocument": {"uri": uri}}, callback)

    def request_color_presentation(self, uri: str, color: Dict, range: Dict,
                                   callback: Optional[Callable] = None):
        self.send_request("textDocument/colorPresentation", {
            "textDocument": {"uri": uri},
            "color": color,
            "range": range,
        }, callback)

    # ── Semantic Tokens ────────────────────────────────────────────────────

    def request_semantic_tokens_full(self, uri: str, callback: Optional[Callable] = None):
        if self.supports_semantic_tokens():
            self.send_request("textDocument/semanticTokens/full", {"textDocument": {"uri": uri}}, callback)

    def request_semantic_tokens_full_sync(self, uri: str) -> Optional[Dict]:
        if not self.supports_semantic_tokens():
            return None
        return self.send_request_sync("textDocument/semanticTokens/full", {"textDocument": {"uri": uri}})

    def request_semantic_tokens_delta(self, uri: str, previous_result_id: str,
                                      callback: Optional[Callable] = None):
        if self.supports_semantic_tokens():
            self.send_request("textDocument/semanticTokens/full/delta", {
                "textDocument": {"uri": uri},
                "previousResultId": previous_result_id,
            }, callback)

    def request_semantic_tokens_range(self, uri: str, range: Dict,
                                      callback: Optional[Callable] = None):
        if self.supports_semantic_tokens():
            self.send_request("textDocument/semanticTokens/range", {
                "textDocument": {"uri": uri},
                "range": range,
            }, callback)

    # ── Inlay Hints ────────────────────────────────────────────────────────

    def request_inlay_hints(self, uri: str, range: Dict,
                            callback: Optional[Callable] = None):
        self.send_request("textDocument/inlayHint", {
            "textDocument": {"uri": uri},
            "range": range,
        }, callback)

    def request_inlay_hints_sync(self, uri: str, range: Dict) -> List:
        result = self.send_request_sync("textDocument/inlayHint", {
            "textDocument": {"uri": uri},
            "range": range,
        })
        return result if isinstance(result, list) else []

    # ── Call Hierarchy ─────────────────────────────────────────────────────

    def request_prepare_call_hierarchy(self, uri: str, line: int, character: int,
                                       callback: Optional[Callable] = None):
        self.send_request("textDocument/prepareCallHierarchy", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_call_hierarchy_incoming(self, item: Dict,
                                        callback: Optional[Callable] = None):
        self.send_request("callHierarchy/incomingCalls", {"item": item}, callback)

    def request_call_hierarchy_outgoing(self, item: Dict,
                                        callback: Optional[Callable] = None):
        self.send_request("callHierarchy/outgoingCalls", {"item": item}, callback)

    # ── Type Hierarchy ─────────────────────────────────────────────────────

    def request_prepare_type_hierarchy(self, uri: str, line: int, character: int,
                                       callback: Optional[Callable] = None):
        self.send_request("textDocument/prepareTypeHierarchy", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    def request_type_hierarchy_supertypes(self, item: Dict,
                                          callback: Optional[Callable] = None):
        self.send_request("typeHierarchy/supertypes", {"item": item}, callback)

    def request_type_hierarchy_subtypes(self, item: Dict,
                                        callback: Optional[Callable] = None):
        self.send_request("typeHierarchy/subtypes", {"item": item}, callback)

    # ── Linked Editing Range ───────────────────────────────────────────────

    def request_linked_editing_range(self, uri: str, line: int, character: int,
                                     callback: Optional[Callable] = None):
        self.send_request("textDocument/linkedEditingRange", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }, callback)

    # ── Inline Completion ──────────────────────────────────────────────────

    def request_inline_completion(self, uri: str, position: Dict,
                                  context: Optional[Dict] = None,
                                  callback: Optional[Callable] = None):
        params = {"textDocument": {"uri": uri}, "position": position}
        if context:
            params["context"] = context
        self.send_request("textDocument/inlineCompletion", params, callback)

    # ── Inline Value ───────────────────────────────────────────────────────

    def request_inline_value(self, uri: str, range: Dict, context: Dict,
                             callback: Optional[Callable] = None):
        self.send_request("textDocument/inlineValue", {
            "textDocument": {"uri": uri},
            "range": range,
            "context": context,
        }, callback)

    # ── Workspace ──────────────────────────────────────────────────────────

    def did_change_configuration(self, settings: Dict):
        self.send_notification("workspace/didChangeConfiguration", {"settings": settings})

    def did_change_workspace_folders(self, added: List[Dict], removed: List[Dict]):
        self.send_notification("workspace/didChangeWorkspaceFolders", {
            "event": {"added": added, "removed": removed},
        })

    def execute_command(self, command: str, arguments: Optional[List] = None,
                        callback: Optional[Callable] = None):
        self.send_request("workspace/executeCommand", {
            "command": command,
            "arguments": arguments or [],
        }, callback)

    def apply_edit(self, edit: Dict, callback: Optional[Callable] = None):
        self.send_request("workspace/applyEdit", {"edit": edit}, callback)

    # ── Diagnostics Pull ───────────────────────────────────────────────────

    def request_diagnostic(self, uri: str, previous_result_id: Optional[str] = None,
                           callback: Optional[Callable] = None):
        params = {"textDocument": {"uri": uri}}
        if previous_result_id:
            params["previousResultId"] = previous_result_id
        self.send_request("textDocument/diagnostic", params, callback)

    # ── JSON-RPC Messaging ─────────────────────────────────────────────────

    def send_notification(self, method: str, params: dict):
        if not self._process:
            return
        message = {"jsonrpc": "2.0", "method": method, "params": params}
        self._write_message(message)

    def send_request(self, method: str, params: dict, callback: Callable = None):
        if not self._process:
            return
        with self._lock:
            req_id = self._request_id
            self._request_id += 1
            if callback:
                self._callbacks[req_id] = callback
        message = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        self._write_message(message)

    def send_request_sync(self, method: str, params: dict, timeout: float = 5.0) -> Any:
        if not self._process:
            return None
        event = threading.Event()
        result_box = [None]
        error_box = [None]

        def callback(result, error):
            result_box[0] = result
            error_box[0] = error
            event.set()

        self.send_request(method, params, callback)
        event.wait(timeout=timeout)
        if error_box[0]:
            return None
        return result_box[0]

    def _write_message(self, message: dict):
        body = json.dumps(message)
        header = f"Content-Length: {len(body)}\r\n\r\n"
        try:
            self._process.stdin.write(header.encode('utf-8'))
            self._process.stdin.write(body.encode('utf-8'))
            self._process.stdin.flush()
        except Exception:
            pass

    def _read_loop(self):
        buffer = b""
        while self._process and self._process.poll() is None:
            try:
                line = self._process.stdout.readline()
                if not line:
                    break
                line = line.decode('utf-8').strip()
                if line.startswith("Content-Length:"):
                    length = int(line.split(":")[1].strip())
                    self._process.stdout.readline()
                    body = self._process.stdout.read(length)
                    data = json.loads(body.decode('utf-8'))
                    self._handle_response(data)
            except Exception:
                break

    def _handle_response(self, data: Dict[str, Any]):
        if "id" in data:
            req_id = data["id"]
            with self._lock:
                callback = self._callbacks.pop(req_id, None)
            if callback:
                callback(data.get("result"), data.get("error"))
        elif "method" in data:
            method = data["method"]
            params = data.get("params", {})
            self._handle_server_notification(method, params)

    def _handle_server_notification(self, method: str, params: dict):
        if method == "textDocument/publishDiagnostics":
            uri = params.get("uri", "")
            diagnostics = params.get("diagnostics", [])
            markers = self._convert_diagnostics(diagnostics)
            if markers:
                self.diagnostics_ready.emit(uri, markers)
            else:
                self.diagnostics_cleared.emit(uri)

        elif method == "telemetry/event":
            self.telemetry_event.emit(params)

        elif method == "window/logMessage":
            msg_type = params.get("type", 2)
            message = params.get("message", "")
            type_names = {1: "error", 2: "warning", 3: "info", 4: "log"}
            self.log_message.emit(type_names.get(msg_type, "log"), message)

        elif method == "window/showMessage":
            msg_type = params.get("type", 3)
            message = params.get("message", "")
            type_names = {1: "error", 2: "warning", 3: "info", 4: "log"}
            self.show_message.emit(type_names.get(msg_type, "info"), message)

        elif method == "window/showDocument":
            uri = params.get("uri", "")
            take_focus = params.get("takeFocus", False)
            self.show_document.emit(uri, take_focus)

        elif method == "$/progress":
            token = params.get("token", "")
            value = params.get("value", {})
            kind = value.get("kind")
            if kind == "begin":
                self.progress_begin.emit(token, value.get("title", ""), value)
            elif kind == "report":
                self.progress_report.emit(token, value.get("message", ""), value)
            elif kind == "end":
                self.progress_end.emit(token)

        elif method == "window/workDoneProgress/create":
            token = params.get("token", "")
            self.progress_begin.emit(token, "", {})

    def _convert_diagnostics(self, diagnostics: List[dict]) -> List[dict]:
        markers = []
        for d in diagnostics:
            range_data = d.get("range", {})
            start = range_data.get("start", {})
            end = range_data.get("end", {})
            sev_num = d.get("severity", 1)
            severity = "error"
            if sev_num == 2:
                severity = "warning"
            elif sev_num in (3, 4):
                severity = "info"
            markers.append({
                "severity": severity,
                "startLine": start.get("line", 0) + 1,
                "startColumn": start.get("character", 0) + 1,
                "endLine": end.get("line", 0) + 1,
                "endColumn": end.get("character", 0) + 1,
                "message": d.get("message", ""),
                "source": d.get("source", "LSP"),
                "code": d.get("code", ""),
            })
        return markers
