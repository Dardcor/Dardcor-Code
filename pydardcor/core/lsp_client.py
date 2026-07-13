"""Comprehensive Language Server Protocol client for Dardcor Code."""

import os
import json
import subprocess
import threading
from typing import Optional, Dict, Any, List, Callable, Tuple

from .config import get_global_home_dir


class LSPClient:
    """Full LSP client supporting all major protocol features."""

    def __init__(self, language_id: str, server_cmd: List[str], workspace_path: str = ""):
        self.language_id = language_id
        self._cmd = server_cmd
        self._workspace_path = workspace_path
        self._process: Optional[subprocess.Popen] = None
        self._request_seq = 0
        self._pending: Dict[int, Any] = {}
        self._lock = threading.Lock()
        self._initialized = False
        self._server_capabilities: Dict[str, Any] = {}

        self._diagnostics_handler: Optional[Callable] = None
        self._telemetry_handler: Optional[Callable] = None
        self._log_message_handler: Optional[Callable] = None
        self._show_message_handler: Optional[Callable] = None
        self._show_document_handler: Optional[Callable] = None
        self._progress_handler: Optional[Callable] = None
        self._tokens_handler: Optional[Callable] = None

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start(self) -> bool:
        if self._process and self._process.poll() is None:
            return True
        try:
            import os
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            self._process = subprocess.Popen(
                self._cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                cwd=self._workspace_path or None,
                **kwargs
            )
            reader = threading.Thread(target=self._read_loop, daemon=True)
            reader.start()
            self._initialize()
            return True
        except Exception:
            return False

    def _initialize(self):
        root_uri = f"file:///{self._workspace_path}" if self._workspace_path else None
        params = {
            "processId": os.getpid(),
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "synchronization": {"didOpen": True, "didChange": True, "didSave": True, "willSave": True, "willSaveWaitUntil": True},
                    "completion": {"completionItem": {"snippetSupport": True, "documentationFormat": ["markdown", "plaintext"]}, "contextSupport": True},
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                    "signatureHelp": {"signatureInformation": {"parameterInformation": {"labelOffsetSupport": True}}},
                    "declaration": {"linkSupport": True},
                    "definition": {"linkSupport": True},
                    "typeDefinition": {"linkSupport": True},
                    "implementation": {"linkSupport": True},
                    "references": {},
                    "documentHighlight": {},
                    "documentSymbol": {"hierarchicalDocumentSymbolSupport": True, "symbolKind": {"valueSet": list(range(1, 27))}},
                    "codeAction": {"dynamicRegistration": True, "codeActionLiteralSupport": {"codeActionKind": {"valueSet": ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports"]}}, "isPreferredSupport": True},
                    "codeLens": {},
                    "formatting": {},
                    "rangeFormatting": {},
                    "onTypeFormatting": {},
                    "rename": {"prepareSupport": True},
                    "publishDiagnostics": {"relatedInformation": True, "versionSupport": True, "codeDescriptionSupport": True},
                    "diagnostic": {},
                    "semanticTokens": {"requests": {"full": {"delta": True}, "range": True}, "multilineTokenSupport": True, "overlappingTokenSupport": True},
                    "inlayHint": {},
                    "inlineValue": {},
                    "inlineCompletion": {},
                    "linkedEditingRange": {},
                    "callHierarchy": {},
                    "typeHierarchy": {},
                    "foldingRange": {"lineFoldingOnly": True, "rangeLimit": 5000},
                    "selectionRange": {},
                    "documentLink": {},
                    "documentColor": {},
                    "colorProvider": {},
                    "moniker": {},
                },
                "workspace": {
                    "workspaceFolders": True,
                    "didChangeConfiguration": {},
                    "didChangeWatchedFiles": {},
                    "symbol": {"symbolKind": {"valueSet": list(range(1, 27))}},
                    "diagnostics": {},
                    "codeLens": {"refreshSupport": True},
                    "inlayHint": {"refreshSupport": True},
                    "inlineValue": {"refreshSupport": True},
                    "semanticTokens": {"refreshSupport": True},
                },
                "window": {"workDoneProgress": True, "showDocument": True},
                "general": {"positionEncodings": ["utf-16"]},
                "telemetry": {},
            },
        }
        if self._workspace_path:
            params["workspaceFolders"] = [{"uri": root_uri, "name": os.path.basename(self._workspace_path)}]

        resp = self._send_request_sync("initialize", params, timeout=15.0)
        if resp is not None:
            self._initialized = True
            if isinstance(resp, dict):
                self._server_capabilities = resp.get("capabilities", {})
            self._send_notification("initialized", {})

    def is_initialized(self) -> bool:
        return self._initialized

    def get_server_capability(self, key: str, default: Any = None) -> Any:
        return self._server_capabilities.get(key, default)

    def supports_semantic_tokens(self) -> bool:
        provider = self._server_capabilities.get("semanticTokensProvider") or {}
        return bool(provider.get("full") or provider.get("range"))

    def semantic_tokens_legend(self) -> Optional[Dict]:
        provider = self._server_capabilities.get("semanticTokensProvider") or {}
        return provider.get("legend")

    def stop(self):
        if self._process and self._process.poll() is None:
            self._send_notification("shutdown", {})
            self._send_notification("exit", {})
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
        self._process = None
        self._initialized = False

    # ── URI Helper ─────────────────────────────────────────────────────────

    def _uri(self, file_path: str) -> str:
        return f"file:///{file_path}".replace("\\", "/")

    # ── Text Document Sync ─────────────────────────────────────────────────

    def did_open(self, file_path: str, language_id: str, content: str):
        if not self._initialized:
            return
        self._send_notification("textDocument/didOpen", {
            "textDocument": {"uri": self._uri(file_path), "languageId": language_id, "version": 1, "text": content},
        })

    def did_change(self, file_path: str, changes: List[Dict], version: int = 1):
        if not self._initialized:
            return
        self._send_notification("textDocument/didChange", {
            "textDocument": {"uri": self._uri(file_path), "version": version},
            "contentChanges": changes,
        })

    def did_change_full(self, file_path: str, text: str, version: int = 1):
        self.did_change(file_path, [{"text": text}], version)

    def did_save(self, file_path: str, content: str = ""):
        if not self._initialized:
            return
        params = {"textDocument": {"uri": self._uri(file_path)}}
        if content:
            params["text"] = content
        self._send_notification("textDocument/didSave", params)

    def will_save(self, file_path: str, reason: int = 0):
        if not self._initialized:
            return
        self._send_notification("textDocument/willSave", {"textDocument": {"uri": self._uri(file_path)}, "reason": reason})

    def will_save_wait_until(self, file_path: str, reason: int = 0) -> Optional[List]:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/willSaveWaitUntil", {"textDocument": {"uri": self._uri(file_path)}, "reason": reason})

    def did_close(self, file_path: str):
        if not self._initialized:
            return
        self._send_notification("textDocument/didClose", {"textDocument": {"uri": self._uri(file_path)}})

    # ── Completion ─────────────────────────────────────────────────────────

    def completion(self, file_path: str, line: int, character: int,
                   context: Optional[Dict] = None) -> List[Dict]:
        if not self._initialized:
            return []
        params = {"textDocument": {"uri": self._uri(file_path)}, "position": {"line": line, "character": character}}
        if context:
            params["context"] = context
        result = self._send_request_sync("textDocument/completion", params)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "items" in result:
            return result["items"]
        return []

    def resolve_completion_item(self, item: Dict) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("completionItem/resolve", item)

    # ── Hover ──────────────────────────────────────────────────────────────

    def hover(self, file_path: str, line: int, character: int) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/hover", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    # ── Signature Help ─────────────────────────────────────────────────────

    def signature_help(self, file_path: str, line: int, character: int,
                       context: Optional[Dict] = None) -> Optional[Dict]:
        if not self._initialized:
            return None
        params = {"textDocument": {"uri": self._uri(file_path)}, "position": {"line": line, "character": character}}
        if context:
            params["context"] = context
        return self._send_request_sync("textDocument/signatureHelp", params)

    # ── Go To / Navigation ─────────────────────────────────────────────────

    def definition(self, file_path: str, line: int, character: int) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/definition", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    def declaration(self, file_path: str, line: int, character: int) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/declaration", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    def type_definition(self, file_path: str, line: int, character: int) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/typeDefinition", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    def implementation(self, file_path: str, line: int, character: int) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/implementation", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    # ── References ─────────────────────────────────────────────────────────

    def references(self, file_path: str, line: int, character: int,
                   include_declaration: bool = True) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/references", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
            "context": {"includeDeclaration": include_declaration},
        }) or []

    # ── Document Highlight ─────────────────────────────────────────────────

    def document_highlight(self, file_path: str, line: int, character: int) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/documentHighlight", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        }) or []

    # ── Document Symbols ───────────────────────────────────────────────────

    def document_symbols(self, file_path: str) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/documentSymbol", {
            "textDocument": {"uri": self._uri(file_path)},
        }) or []

    # ── Workspace Symbols ──────────────────────────────────────────────────

    def workspace_symbols(self, query: str) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("workspace/symbol", {"query": query}) or []

    # ── Code Actions ───────────────────────────────────────────────────────

    def code_actions(self, file_path: str, range: Dict, context: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/codeAction", {
            "textDocument": {"uri": self._uri(file_path)},
            "range": range,
            "context": context,
        }) or []

    def resolve_code_action(self, action: Dict) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("codeAction/resolve", action)

    # ── Code Lens ──────────────────────────────────────────────────────────

    def code_lens(self, file_path: str) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/codeLens", {
            "textDocument": {"uri": self._uri(file_path)},
        }) or []

    def resolve_code_lens(self, lens: Dict) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("codeLens/resolve", lens)

    # ── Formatting ─────────────────────────────────────────────────────────

    def formatting(self, file_path: str, options: Optional[Dict] = None) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/formatting", {
            "textDocument": {"uri": self._uri(file_path)},
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }) or []

    def range_formatting(self, file_path: str, range: Dict,
                         options: Optional[Dict] = None) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/rangeFormatting", {
            "textDocument": {"uri": self._uri(file_path)},
            "range": range,
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }) or []

    def on_type_formatting(self, file_path: str, position: Dict, ch: str,
                           options: Optional[Dict] = None) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/onTypeFormatting", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": position,
            "ch": ch,
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }) or []

    # ── Rename ─────────────────────────────────────────────────────────────

    def prepare_rename(self, file_path: str, line: int, character: int) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/prepareRename", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    def rename(self, file_path: str, line: int, character: int, new_name: str) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/rename", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
            "newName": new_name,
        })

    # ── Folding Range ──────────────────────────────────────────────────────

    def folding_range(self, file_path: str) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/foldingRange", {
            "textDocument": {"uri": self._uri(file_path)},
        }) or []

    # ── Selection Range ────────────────────────────────────────────────────

    def selection_range(self, file_path: str, positions: List[Dict]) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/selectionRange", {
            "textDocument": {"uri": self._uri(file_path)},
            "positions": positions,
        }) or []

    # ── Document Link ──────────────────────────────────────────────────────

    def document_links(self, file_path: str) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/documentLink", {
            "textDocument": {"uri": self._uri(file_path)},
        }) or []

    def resolve_document_link(self, link: Dict) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("documentLink/resolve", link)

    # ── Document Color ─────────────────────────────────────────────────────

    def document_color(self, file_path: str) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/documentColor", {
            "textDocument": {"uri": self._uri(file_path)},
        }) or []

    def color_presentation(self, file_path: str, color: Dict, range: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/colorPresentation", {
            "textDocument": {"uri": self._uri(file_path)},
            "color": color,
            "range": range,
        }) or []

    # ── Semantic Tokens ────────────────────────────────────────────────────

    def semantic_tokens_full(self, file_path: str) -> Optional[Dict]:
        if not self._initialized or not self.supports_semantic_tokens():
            return None
        return self._send_request_sync("textDocument/semanticTokens/full", {
            "textDocument": {"uri": self._uri(file_path)},
        })

    def semantic_tokens_delta(self, file_path: str, previous_result_id: str) -> Optional[Dict]:
        if not self._initialized or not self.supports_semantic_tokens():
            return None
        return self._send_request_sync("textDocument/semanticTokens/full/delta", {
            "textDocument": {"uri": self._uri(file_path)},
            "previousResultId": previous_result_id,
        })

    def semantic_tokens_range(self, file_path: str, range: Dict) -> Optional[Dict]:
        if not self._initialized or not self.supports_semantic_tokens():
            return None
        return self._send_request_sync("textDocument/semanticTokens/range", {
            "textDocument": {"uri": self._uri(file_path)},
            "range": range,
        })

    # ── Inlay Hints ────────────────────────────────────────────────────────

    def inlay_hints(self, file_path: str, range: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/inlayHint", {
            "textDocument": {"uri": self._uri(file_path)},
            "range": range,
        }) or []

    def resolve_inlay_hint(self, hint: Dict) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("inlayHint/resolve", hint)

    # ── Inline Value ───────────────────────────────────────────────────────

    def inline_values(self, file_path: str, range: Dict, context: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("textDocument/inlineValue", {
            "textDocument": {"uri": self._uri(file_path)},
            "range": range,
            "context": context,
        }) or []

    # ── Inline Completion ──────────────────────────────────────────────────

    def inline_completion(self, file_path: str, position: Dict,
                          context: Optional[Dict] = None) -> Optional[Dict]:
        if not self._initialized:
            return None
        params = {"textDocument": {"uri": self._uri(file_path)}, "position": position}
        if context:
            params["context"] = context
        return self._send_request_sync("textDocument/inlineCompletion", params)

    # ── Linked Editing Range ───────────────────────────────────────────────

    def linked_editing_range(self, file_path: str, line: int, character: int) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/linkedEditingRange", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    # ── Call Hierarchy ─────────────────────────────────────────────────────

    def prepare_call_hierarchy(self, file_path: str, line: int, character: int) -> Optional[List]:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/prepareCallHierarchy", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    def call_hierarchy_incoming(self, item: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("callHierarchy/incomingCalls", {"item": item}) or []

    def call_hierarchy_outgoing(self, item: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("callHierarchy/outgoingCalls", {"item": item}) or []

    # ── Type Hierarchy ─────────────────────────────────────────────────────

    def prepare_type_hierarchy(self, file_path: str, line: int, character: int) -> Optional[List]:
        if not self._initialized:
            return None
        return self._send_request_sync("textDocument/prepareTypeHierarchy", {
            "textDocument": {"uri": self._uri(file_path)},
            "position": {"line": line, "character": character},
        })

    def type_hierarchy_supertypes(self, item: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("typeHierarchy/supertypes", {"item": item}) or []

    def type_hierarchy_subtypes(self, item: Dict) -> List[Dict]:
        if not self._initialized:
            return []
        return self._send_request_sync("typeHierarchy/subtypes", {"item": item}) or []

    # ── Diagnostics ────────────────────────────────────────────────────────

    def diagnostic_pull(self, file_path: str, previous_result_id: Optional[str] = None) -> Optional[Dict]:
        if not self._initialized:
            return None
        params = {"textDocument": {"uri": self._uri(file_path)}}
        if previous_result_id:
            params["previousResultId"] = previous_result_id
        return self._send_request_sync("textDocument/diagnostic", params)

    def workspace_diagnostic(self, previous_result_id: Optional[str] = None,
                             identifiers: Optional[List[Dict]] = None) -> Optional[Dict]:
        if not self._initialized:
            return None
        params = {}
        if previous_result_id:
            params["previousResultId"] = previous_result_id
        if identifiers:
            params["identifiers"] = identifiers
        return self._send_request_sync("workspace/diagnostic", params)

    # ── Workspace ──────────────────────────────────────────────────────────

    def did_change_workspace_folders(self, added: List[Dict], removed: List[Dict]):
        if not self._initialized:
            return
        self._send_notification("workspace/didChangeWorkspaceFolders", {
            "event": {"added": added, "removed": removed},
        })

    def did_change_configuration(self, settings: Dict):
        if not self._initialized:
            return
        self._send_notification("workspace/didChangeConfiguration", {"settings": settings})

    def did_change_watched_files(self, changes: List[Dict]):
        if not self._initialized:
            return
        self._send_notification("workspace/didChangeWatchedFiles", {"changes": changes})

    def execute_command(self, command: str, arguments: Optional[List] = None) -> Any:
        if not self._initialized:
            return None
        return self._send_request_sync("workspace/executeCommand", {
            "command": command,
            "arguments": arguments or [],
        })

    def apply_edit(self, edit: Dict) -> Optional[Dict]:
        if not self._initialized:
            return None
        return self._send_request_sync("workspace/applyEdit", {"edit": edit})

    # ── Event Handlers ─────────────────────────────────────────────────────

    def on_diagnostics(self, handler: Callable):
        self._diagnostics_handler = handler

    def on_telemetry(self, handler: Callable):
        self._telemetry_handler = handler

    def on_log_message(self, handler: Callable):
        self._log_message_handler = handler

    def on_show_message(self, handler: Callable):
        self._show_message_handler = handler

    def on_show_document(self, handler: Callable):
        self._show_document_handler = handler

    # ── Raw Request ────────────────────────────────────────────────────────

    def send_request_sync(self, method: str, params: Any = None, timeout: float = 10.0) -> Any:
        return self._send_request_sync(method, params, timeout)

    # ── Internal Messaging ─────────────────────────────────────────────────

    def _send_request_sync(self, method: str, params: Any = None, timeout: float = 10.0) -> Any:
        if not self._process or self._process.poll() is not None:
            return None
        self._request_seq += 1
        seq = self._request_seq
        msg = {"jsonrpc": "2.0", "id": seq, "method": method, "params": params or {}}
        body = json.dumps(msg)
        header = f"Content-Length: {len(body.encode('utf-8'))}\r\n\r\n"
        try:
            self._process.stdin.write(header + body)
            self._process.stdin.flush()
        except Exception:
            return None
        result_holder = [None]
        event = threading.Event()

        class Future:
            def set_result(self, r):
                result_holder[0] = r
                event.set()

        future = Future()
        with self._lock:
            self._pending[seq] = future
        event.wait(timeout=timeout)
        with self._lock:
            self._pending.pop(seq, None)
        return result_holder[0]

    def _send_notification(self, method: str, params: Any = None):
        if not self._process or self._process.poll() is not None:
            return
        msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        body = json.dumps(msg)
        header = f"Content-Length: {len(body.encode('utf-8'))}\r\n\r\n"
        try:
            self._process.stdin.write(header + body)
            self._process.stdin.flush()
        except Exception:
            pass

    def _read_loop(self):
        try:
            content_length = None
            while True:
                line = self._process.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if line.startswith("Content-Length:"):
                    content_length = int(line.split(":")[1].strip())
                elif line == "" and content_length is not None:
                    body = self._process.stdout.read(content_length)
                    content_length = None
                    if body:
                        msg = json.loads(body)
                        self._handle_message(msg)
        except Exception:
            pass

    def _handle_message(self, msg: dict):
        if "id" in msg and "method" not in msg:
            with self._lock:
                if msg["id"] in self._pending:
                    self._pending[msg["id"]].set_result(msg.get("result"))
            return

        method = msg.get("method")
        if not method:
            return

        params = msg.get("params", {})

        if method == "textDocument/publishDiagnostics":
            uri = params.get("uri", "")
            diagnostics = params.get("diagnostics", [])
            if self._diagnostics_handler:
                self._diagnostics_handler(uri, diagnostics)

        elif method == "telemetry/event":
            if self._telemetry_handler:
                self._telemetry_handler(params)

        elif method == "window/logMessage":
            if self._log_message_handler:
                self._log_message_handler(params)

        elif method == "window/showMessage":
            if self._show_message_handler:
                self._show_message_handler(params)

        elif method == "window/showDocument":
            if self._show_document_handler:
                self._show_document_handler(params)

        elif method == "$/progress":
            if self._progress_handler:
                self._progress_handler(params)

        elif method == "textDocument/semanticTokens/full":
            if self._tokens_handler:
                self._tokens_handler(params)


class LSPManager:
    """Manages multiple LSP clients for different languages."""

    def __init__(self):
        self._clients: Dict[str, LSPClient] = {}
        self._workspace_path = ""

    def set_workspace(self, path: str):
        self._workspace_path = path

    def start_python_lsp(self) -> Optional[LSPClient]:
        if "python" in self._clients and self._clients["python"].is_initialized():
            return self._clients["python"]
        cmd = self._find_python_lsp()
        if not cmd:
            return None
        client = LSPClient("python", cmd, self._workspace_path)
        if client.start():
            self._clients["python"] = client
            return client
        return None

    def start_dart_lsp(self) -> Optional[LSPClient]:
        if "dart" in self._clients and self._clients["dart"].is_initialized():
            return self._clients["dart"]
        dart_path = self._find_dart()
        if not dart_path:
            return None
        cmd = [dart_path, "language-server"]
        client = LSPClient("dart", cmd, self._workspace_path)
        if client.start():
            self._clients["dart"] = client
            return client
        return None

    def start_generic_lsp(self, language_id: str, cmd: List[str]) -> Optional[LSPClient]:
        if language_id in self._clients and self._clients[language_id].is_initialized():
            return self._clients[language_id]
        client = LSPClient(language_id, cmd, self._workspace_path)
        if client.start():
            self._clients[language_id] = client
            return client
        return None

    def start_default_lsp(self, language_id: str) -> Optional[LSPClient]:
        if language_id in self._clients and self._clients[language_id].is_initialized():
            return self._clients[language_id]
        for cmd in self._configured_lsp_commands(language_id):
            client = self.start_generic_lsp(language_id, cmd)
            if client:
                return client
        return None

    def get_client(self, language_id: str) -> Optional[LSPClient]:
        return self._clients.get(language_id)

    def get_or_create_language(self, language_id: str) -> Optional[LSPClient]:
        client = self.get_client(language_id)
        if client and client.is_initialized():
            return client
        if language_id == "python":
            return self.start_python_lsp()
        if language_id == "dart":
            return self.start_dart_lsp()
        return self.start_default_lsp(language_id)

    def on_diagnostics(self, language_id: str, handler: Callable):
        client = self._clients.get(language_id)
        if client:
            client.on_diagnostics(handler)

    def on_all_diagnostics(self, handler: Callable):
        for client in self._clients.values():
            client.on_diagnostics(handler)

    def stop_all(self):
        for client in self._clients.values():
            client.stop()
        self._clients.clear()

    def get_active_languages(self) -> List[str]:
        return [lid for lid, c in self._clients.items() if c.is_initialized()]

    # ── Server Discovery ───────────────────────────────────────────────────

    def _find_python_lsp(self) -> Optional[List[str]]:
        import shutil
        for name in ["pylsp", "pyright-langserver", "pyls", "python-lsp-server"]:
            path = shutil.which(name)
            if path:
                return [path]
        return None

    def _find_dart(self) -> Optional[str]:
        import shutil
        dart_path = shutil.which("dart")
        if dart_path:
            return dart_path
        flutter_path = shutil.which("flutter")
        if flutter_path:
            return flutter_path
        return None

    def _configured_lsp_commands(self, language_id: str) -> list[list[str]]:
        servers_path = os.path.join(get_global_home_dir(), "lsp", "servers.json")
        try:
            with open(servers_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, json.JSONDecodeError):
            return []
        servers = raw.get("servers", raw) if isinstance(raw, dict) else {}
        entry = servers.get(language_id) if isinstance(servers, dict) else None
        if not isinstance(entry, dict) or not entry.get("enabled", True):
            return []
        commands = entry.get("commands") or []
        return [cmd for cmd in commands if self._is_command_available(cmd)]

    def _is_command_available(self, cmd: Any) -> bool:
        if not isinstance(cmd, list) or not cmd or not all(isinstance(part, str) for part in cmd):
            return False
        import shutil
        return shutil.which(cmd[0]) is not None


_lsp_manager_instance: Optional[LSPManager] = None


def get_lsp_manager() -> LSPManager:
    global _lsp_manager_instance
    if _lsp_manager_instance is None:
        _lsp_manager_instance = LSPManager()
    return _lsp_manager_instance
