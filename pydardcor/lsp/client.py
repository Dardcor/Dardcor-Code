import os
import json
import threading
import subprocess
import logging
from typing import Dict, Any, List, Callable, Optional, Union
from enum import IntEnum

logger = logging.getLogger(__name__)


class LSPErrorCode(IntEnum):
    ParseError = -32700
    InvalidRequest = -32600
    MethodNotFound = -32601
    InvalidParams = -32602
    InternalError = -32603
    ServerNotInitialized = -32002
    UnknownErrorCode = -32001
    RequestFailed = -32803
    ServerCancelled = -32802
    ContentModified = -32801
    RequestCancelled = -32800


class LspClient:
    """Full-featured LSP client with comprehensive protocol support."""

    def __init__(self, command: list[str], root_uri: str, workspace_folders: Optional[List[Dict]] = None):
        self.command = command
        self.root_uri = root_uri
        self._workspace_folders = workspace_folders or []
        self._process: Optional[subprocess.Popen] = None
        self._request_seq = 0
        self._pending_requests: Dict[int, Any] = {}
        self._request_lock = threading.Lock()
        self._notification_handlers: Dict[str, Callable] = {}
        self._is_running = False
        self._initialized = False
        self._server_capabilities: Dict[str, Any] = {}
        self._dynamic_registrations: Dict[str, Any] = {}
        self._progress_tokens: Dict[str, Callable] = {}

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start(self):
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                **kwargs
            )
            self._is_running = True
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            self._initialize()
        except Exception as e:
            logger.error(f"Failed to start LSP server {self.command}: {e}")

    def stop(self):
        if not self._is_running:
            return
        try:
            if self._process and self._process.poll() is None:
                try:
                    self.send_request("shutdown", timeout=1.0)
                except Exception:
                    pass
                self.send_notification("exit")
        except Exception:
            pass
        self._is_running = False
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                self._process.kill()

    def _initialize(self):
        params = {
            "processId": os.getpid(),
            "rootUri": self.root_uri,
            "capabilities": {
                "textDocument": {
                    "completion": {
                        "completionItem": {
                            "snippetSupport": True,
                            "commitCharactersSupport": True,
                            "documentationFormat": ["markdown", "plaintext"],
                            "resolveSupport": {"properties": ["documentation", "detail", "additionalTextEdits"]},
                        },
                        "contextSupport": True,
                    },
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                    "signatureHelp": {"signatureInformation": {"parameterInformation": {"labelOffsetSupport": True}}},
                    "declaration": {"linkSupport": True},
                    "definition": {"linkSupport": True},
                    "typeDefinition": {"linkSupport": True},
                    "implementation": {"linkSupport": True},
                    "references": {"dynamicRegistration": True},
                    "documentHighlight": {"dynamicRegistration": True},
                    "documentSymbol": {
                        "symbolKind": {
                            "valueSet": list(range(1, 27)),
                        },
                        "hierarchicalDocumentSymbolSupport": True,
                    },
                    "codeAction": {
                        "dynamicRegistration": True,
                        "codeActionLiteralSupport": {
                            "codeActionKind": {
                                "valueSet": [
                                    "",
                                    "quickfix",
                                    "refactor",
                                    "refactor.extract",
                                    "refactor.inline",
                                    "refactor.rewrite",
                                    "source",
                                    "source.organizeImports",
                                ]
                            }
                        },
                        "isPreferredSupport": True,
                        "dataSupport": True,
                        "resolveSupport": {"properties": ["edit"]},
                    },
                    "codeLens": {"dynamicRegistration": True},
                    "formatting": {"dynamicRegistration": True},
                    "rangeFormatting": {"dynamicRegistration": True},
                    "onTypeFormatting": {"dynamicRegistration": True},
                    "rename": {"dynamicRegistration": True, "prepareSupport": True},
                    "documentLink": {"dynamicRegistration": True, "tooltipSupport": True},
                    "documentColor": {"dynamicRegistration": True},
                    "colorProvider": {"dynamicRegistration": True},
                    "foldingRange": {
                        "dynamicRegistration": True,
                        "rangeLimit": 5000,
                        "lineFoldingOnly": True,
                    },
                    "selectionRange": {"dynamicRegistration": True},
                    "publishDiagnostics": {
                        "relatedInformation": True,
                        "versionSupport": True,
                        "codeDescriptionSupport": True,
                        "dataSupport": True,
                    },
                    "diagnostic": {
                        "dynamicRegistration": True,
                        "relatedDocumentSupport": True,
                    },
                    "semanticTokens": {
                        "dynamicRegistration": True,
                        "requests": {
                            "full": {"delta": True},
                            "range": True,
                        },
                        "multilineTokenSupport": True,
                        "overlappingTokenSupport": True,
                        "serverCancelSupport": True,
                        "augmentsSyntaxTokens": True,
                    },
                    "inlayHint": {"dynamicRegistration": True, "resolveSupport": {"properties": ["label"]}},
                    "inlineValue": {"dynamicRegistration": True},
                    "inlineCompletion": {"dynamicRegistration": True},
                    "linkedEditingRange": {"dynamicRegistration": True},
                    "callHierarchy": {"dynamicRegistration": True},
                    "typeHierarchy": {"dynamicRegistration": True},
                    "moniker": {"dynamicRegistration": True},
                    "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                },
                "workspace": {
                    "workspaceFolders": True,
                    "didChangeConfiguration": {"dynamicRegistration": True},
                    "didChangeWatchedFiles": {"dynamicRegistration": True},
                    "symbol": {
                        "dynamicRegistration": True,
                        "symbolKind": {"valueSet": list(range(1, 27))},
                    },
                    "codeLens": {"refreshSupport": True},
                    "diagnostics": {"refreshSupport": True},
                    "inlayHint": {"refreshSupport": True},
                    "inlineValue": {"refreshSupport": True},
                    "semanticTokens": {"refreshSupport": True},
                },
                "window": {
                    "workDoneProgress": True,
                    "showMessage": {"messageActionItem": {"additionalPropertiesSupport": True}},
                    "showDocument": {"support": True},
                },
                "general": {
                    "positionEncodings": ["utf-16"],
                    "regularExpressions": {"engine": "ECMAScript", "version": "ES2020"},
                    "markdown": {"version": "3.0"},
                },
                "telemetry": {},
                "experimental": {},
            },
        }
        if self._workspace_folders:
            params["workspaceFolders"] = self._workspace_folders

        try:
            response = self.send_request("initialize", params, timeout=15.0)
            if isinstance(response, dict):
                self._server_capabilities = response.get("capabilities", {})
            self.send_notification("initialized")
            self._initialized = True
            self._process_registered_capabilities()
            logger.info("LSP server initialized successfully")
        except Exception as e:
            logger.error(f"LSP initialize failed: {e}")

    def _process_registered_capabilities(self):
        for method, options in self._dynamic_registrations.items():
            if options.get("registerOptions"):
                self.send_request("client/registerCapability", {
                    "registrations": [{
                        "id": method,
                        "method": method,
                        "registerOptions": options["registerOptions"],
                    }]
                })

    def is_initialized(self) -> bool:
        return self._initialized

    def get_server_capability(self, key: str, default: Any = None) -> Any:
        return self._server_capabilities.get(key, default)

    def supports(self, feature: str) -> bool:
        return feature in self._server_capabilities

    # ── Text Document Sync ─────────────────────────────────────────────────

    def did_open(self, uri: str, language_id: str, text: str, version: int = 1):
        self.send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": version,
                "text": text,
            }
        })

    def did_change(self, uri: str, version: int, changes: List[Dict[str, Any]]):
        self.send_notification("textDocument/didChange", {
            "textDocument": {"uri": uri, "version": version},
            "contentChanges": changes,
        })

    def did_change_full(self, uri: str, version: int, text: str):
        self.did_change(uri, version, [{"text": text}])

    def did_change_incremental(self, uri: str, version: int, range: Dict, text: str):
        self.did_change(uri, version, [{"range": range, "text": text}])

    def will_save(self, uri: str, reason: int = 0):
        self.send_notification("textDocument/willSave", {
            "textDocument": {"uri": uri},
            "reason": reason,
        })

    def will_save_wait_until(self, uri: str, reason: int = 0):
        return self.send_request("textDocument/willSaveWaitUntil", {
            "textDocument": {"uri": uri},
            "reason": reason,
        })

    def did_save(self, uri: str, text: Optional[str] = None):
        params = {"textDocument": {"uri": uri}}
        if text is not None:
            params["text"] = text
        self.send_notification("textDocument/didSave", params)

    def did_close(self, uri: str):
        self.send_notification("textDocument/didClose", {
            "textDocument": {"uri": uri}
        })

    # ── Completion ─────────────────────────────────────────────────────────

    def get_completion(self, uri: str, line: int, character: int,
                       context: Optional[Dict] = None, timeout: float = 5.0) -> Optional[Dict]:
        params = {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }
        if context:
            params["context"] = context
        try:
            return self.send_request("textDocument/completion", params, timeout=timeout)
        except Exception:
            return None

    def resolve_completion_item(self, item: Dict, timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("completionItem/resolve", item, timeout=timeout)
        except Exception:
            return None

    # ── Hover ──────────────────────────────────────────────────────────────

    def get_hover(self, uri: str, line: int, character: int, timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("textDocument/hover", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    # ── Signature Help ─────────────────────────────────────────────────────

    def get_signature_help(self, uri: str, line: int, character: int,
                           context: Optional[Dict] = None, timeout: float = 5.0) -> Optional[Dict]:
        params = {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        }
        if context:
            params["context"] = context
        try:
            return self.send_request("textDocument/signatureHelp", params, timeout=timeout)
        except Exception:
            return None

    # ── Goto / Navigation ──────────────────────────────────────────────────

    def goto_definition(self, uri: str, line: int, character: int, timeout: float = 5.0) -> Any:
        try:
            return self.send_request("textDocument/definition", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    def goto_declaration(self, uri: str, line: int, character: int, timeout: float = 5.0) -> Any:
        try:
            return self.send_request("textDocument/declaration", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    def goto_type_definition(self, uri: str, line: int, character: int, timeout: float = 5.0) -> Any:
        try:
            return self.send_request("textDocument/typeDefinition", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    def goto_implementation(self, uri: str, line: int, character: int, timeout: float = 5.0) -> Any:
        try:
            return self.send_request("textDocument/implementation", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    # ── References ─────────────────────────────────────────────────────────

    def find_references(self, uri: str, line: int, character: int,
                        include_declaration: bool = True, timeout: float = 5.0) -> List:
        try:
            result = self.send_request("textDocument/references", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
                "context": {"includeDeclaration": include_declaration},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Document Highlight ─────────────────────────────────────────────────

    def get_document_highlight(self, uri: str, line: int, character: int, timeout: float = 5.0) -> List:
        try:
            result = self.send_request("textDocument/documentHighlight", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Document Symbols ───────────────────────────────────────────────────

    def get_document_symbols(self, uri: str, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/documentSymbol", {
                "textDocument": {"uri": uri},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Workspace Symbols ──────────────────────────────────────────────────

    def get_workspace_symbols(self, query: str, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("workspace/symbol", {
                "query": query,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Code Actions ───────────────────────────────────────────────────────

    def get_code_actions(self, uri: str, range: Dict, context: Dict,
                         timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/codeAction", {
                "textDocument": {"uri": uri},
                "range": range,
                "context": context,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def resolve_code_action(self, action: Dict, timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("codeAction/resolve", action, timeout=timeout)
        except Exception:
            return None

    # ── Code Lens ──────────────────────────────────────────────────────────

    def get_code_lens(self, uri: str, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/codeLens", {
                "textDocument": {"uri": uri},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def resolve_code_lens(self, lens: Dict, timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("codeLens/resolve", lens, timeout=timeout)
        except Exception:
            return None

    # ── Formatting ─────────────────────────────────────────────────────────

    def get_formatting(self, uri: str, options: Optional[Dict] = None,
                       timeout: float = 10.0) -> List:
        params = {
            "textDocument": {"uri": uri},
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }
        try:
            result = self.send_request("textDocument/formatting", params, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def get_range_formatting(self, uri: str, range: Dict,
                             options: Optional[Dict] = None,
                             timeout: float = 10.0) -> List:
        params = {
            "textDocument": {"uri": uri},
            "range": range,
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }
        try:
            result = self.send_request("textDocument/rangeFormatting", params, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def get_on_type_formatting(self, uri: str, position: Dict, ch: str,
                               options: Optional[Dict] = None,
                               timeout: float = 5.0) -> List:
        params = {
            "textDocument": {"uri": uri},
            "position": position,
            "ch": ch,
            "options": options or {"tabSize": 4, "insertSpaces": True},
        }
        try:
            result = self.send_request("textDocument/onTypeFormatting", params, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Rename ─────────────────────────────────────────────────────────────

    def prepare_rename(self, uri: str, line: int, character: int, timeout: float = 5.0) -> Any:
        try:
            return self.send_request("textDocument/prepareRename", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    def rename(self, uri: str, line: int, character: int, new_name: str,
               timeout: float = 10.0) -> Optional[Dict]:
        try:
            return self.send_request("textDocument/rename", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
                "newName": new_name,
            }, timeout=timeout)
        except Exception:
            return None

    # ── Folding Range ──────────────────────────────────────────────────────

    def get_folding_range(self, uri: str, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/foldingRange", {
                "textDocument": {"uri": uri},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Selection Range ────────────────────────────────────────────────────

    def get_selection_range(self, uri: str, positions: List[Dict],
                            timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/selectionRange", {
                "textDocument": {"uri": uri},
                "positions": positions,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Document Link ──────────────────────────────────────────────────────

    def get_document_links(self, uri: str, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/documentLink", {
                "textDocument": {"uri": uri},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def resolve_document_link(self, link: Dict, timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("documentLink/resolve", link, timeout=timeout)
        except Exception:
            return None

    # ── Document Color ─────────────────────────────────────────────────────

    def get_document_color(self, uri: str, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/documentColor", {
                "textDocument": {"uri": uri},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def get_color_presentation(self, uri: str, color: Dict, range: Dict,
                               timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/colorPresentation", {
                "textDocument": {"uri": uri},
                "color": color,
                "range": range,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Semantic Tokens ────────────────────────────────────────────────────

    def get_semantic_tokens_full(self, uri: str, timeout: float = 10.0) -> Optional[Dict]:
        try:
            return self.send_request("textDocument/semanticTokens/full", {
                "textDocument": {"uri": uri},
            }, timeout=timeout)
        except Exception:
            return None

    def get_semantic_tokens_delta(self, uri: str, previous_result_id: str,
                                  timeout: float = 10.0) -> Optional[Dict]:
        try:
            return self.send_request("textDocument/semanticTokens/full/delta", {
                "textDocument": {"uri": uri},
                "previousResultId": previous_result_id,
            }, timeout=timeout)
        except Exception:
            return None

    def get_semantic_tokens_range(self, uri: str, range: Dict,
                                  timeout: float = 10.0) -> Optional[Dict]:
        try:
            return self.send_request("textDocument/semanticTokens/range", {
                "textDocument": {"uri": uri},
                "range": range,
            }, timeout=timeout)
        except Exception:
            return None

    # ── Inlay Hints ────────────────────────────────────────────────────────

    def get_inlay_hints(self, uri: str, range: Dict, timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/inlayHint", {
                "textDocument": {"uri": uri},
                "range": range,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def resolve_inlay_hint(self, hint: Dict, timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("inlayHint/resolve", hint, timeout=timeout)
        except Exception:
            return None

    # ── Inline Value ───────────────────────────────────────────────────────

    def get_inline_values(self, uri: str, range: Dict, context: Dict,
                          timeout: float = 10.0) -> List:
        try:
            result = self.send_request("textDocument/inlineValue", {
                "textDocument": {"uri": uri},
                "range": range,
                "context": context,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Inline Completion ──────────────────────────────────────────────────

    def get_inline_completion(self, uri: str, position: Dict,
                              context: Optional[Dict] = None,
                              timeout: float = 5.0) -> Optional[Dict]:
        params = {
            "textDocument": {"uri": uri},
            "position": position,
        }
        if context:
            params["context"] = context
        try:
            return self.send_request("textDocument/inlineCompletion", params, timeout=timeout)
        except Exception:
            return None

    # ── Linked Editing Range ───────────────────────────────────────────────

    def get_linked_editing_range(self, uri: str, line: int, character: int,
                                 timeout: float = 5.0) -> Optional[Dict]:
        try:
            return self.send_request("textDocument/linkedEditingRange", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
        except Exception:
            return None

    # ── Call Hierarchy ─────────────────────────────────────────────────────

    def prepare_call_hierarchy(self, uri: str, line: int, character: int,
                               timeout: float = 5.0) -> Optional[List]:
        try:
            result = self.send_request("textDocument/prepareCallHierarchy", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return None

    def get_call_hierarchy_incoming(self, uri: str, item_id: Dict,
                                    timeout: float = 10.0) -> List:
        try:
            result = self.send_request("callHierarchy/incomingCalls", {
                "item": item_id,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def get_call_hierarchy_outgoing(self, uri: str, item_id: Dict,
                                    timeout: float = 10.0) -> List:
        try:
            result = self.send_request("callHierarchy/outgoingCalls", {
                "item": item_id,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Type Hierarchy ─────────────────────────────────────────────────────

    def prepare_type_hierarchy(self, uri: str, line: int, character: int,
                               timeout: float = 5.0) -> Optional[List]:
        try:
            result = self.send_request("textDocument/prepareTypeHierarchy", {
                "textDocument": {"uri": uri},
                "position": {"line": line, "character": character},
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return None

    def get_type_hierarchy_supertypes(self, item_id: Dict,
                                      timeout: float = 10.0) -> List:
        try:
            result = self.send_request("typeHierarchy/supertypes", {
                "item": item_id,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def get_type_hierarchy_subtypes(self, item_id: Dict,
                                    timeout: float = 10.0) -> List:
        try:
            result = self.send_request("typeHierarchy/subtypes", {
                "item": item_id,
            }, timeout=timeout)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    # ── Diagnostics ────────────────────────────────────────────────────────

    def get_diagnostic(self, uri: str, previous_result_id: Optional[str] = None,
                       timeout: float = 10.0) -> Optional[Dict]:
        params = {
            "textDocument": {"uri": uri},
            "identifier": "default",
        }
        if previous_result_id:
            params["previousResultId"] = previous_result_id
        try:
            return self.send_request("textDocument/diagnostic", params, timeout=timeout)
        except Exception:
            return None

    def get_workspace_diagnostic(self, previous_result_id: Optional[str] = None,
                                 identifiers: Optional[List[Dict]] = None,
                                 timeout: float = 30.0) -> Optional[Dict]:
        params = {}
        if previous_result_id:
            params["previousResultId"] = previous_result_id
        if identifiers:
            params["identifiers"] = identifiers
        try:
            return self.send_request("workspace/diagnostic", params, timeout=timeout)
        except Exception:
            return None

    # ── Workspace ──────────────────────────────────────────────────────────

    def did_change_workspace_folders(self, added: List[Dict], removed: List[Dict]):
        self.send_notification("workspace/didChangeWorkspaceFolders", {
            "event": {
                "added": added,
                "removed": removed,
            }
        })

    def did_change_configuration(self, settings: Dict):
        self.send_notification("workspace/didChangeConfiguration", {
            "settings": settings,
        })

    def did_change_watched_files(self, changes: List[Dict]):
        self.send_notification("workspace/didChangeWatchedFiles", {
            "changes": changes,
        })

    def execute_command(self, command: str, arguments: Optional[List] = None,
                        timeout: float = 10.0) -> Any:
        try:
            return self.send_request("workspace/executeCommand", {
                "command": command,
                "arguments": arguments or [],
            }, timeout=timeout)
        except Exception:
            return None

    def apply_edit(self, edit: Dict, timeout: float = 10.0) -> Optional[Dict]:
        try:
            return self.send_request("workspace/applyEdit", {
                "edit": edit,
            }, timeout=timeout)
        except Exception:
            return None

    # ── Progress ───────────────────────────────────────────────────────────

    def on_progress(self, token: str, handler: Callable[[Dict], None]):
        self._progress_tokens[token] = handler

    # ── Event Handlers ─────────────────────────────────────────────────────

    def on_notification(self, method: str, handler: Callable):
        self._notification_handlers[method] = handler

    def set_diagnostics_handler(self, handler: Callable[[str, List], None]):
        self._notification_handlers["textDocument/publishDiagnostics"] = handler

    def set_telemetry_handler(self, handler: Callable[[Dict], None]):
        self._notification_handlers["telemetry/event"] = handler

    def set_log_message_handler(self, handler: Callable[[Dict], None]):
        self._notification_handlers["window/logMessage"] = handler

    def set_show_message_handler(self, handler: Callable[[Dict], None]):
        self._notification_handlers["window/showMessage"] = handler

    def set_show_message_request_handler(self, handler: Callable[[Dict], None]):
        self._notification_handlers["window/showMessageRequest"] = handler

    def set_show_document_handler(self, handler: Callable[[Dict], None]):
        self._notification_handlers["window/showDocument"] = handler

    def set_work_done_progress_handler(self, handler: Callable[[Dict], None]):
        self._notification_handlers["window/workDoneProgress/create"] = handler

    # ── JSON-RPC Messaging ─────────────────────────────────────────────────

    def send_notification(self, method: str, params: Any = None):
        if not self._is_running:
            return
        msg = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
        }
        self._write_message(msg)

    def send_request(self, method: str, params: Any = None,
                     timeout: float = 5.0) -> Any:
        if not self._is_running:
            raise RuntimeError("LSP Client is not running")

        with self._request_lock:
            self._request_seq += 1
            seq = self._request_seq

        msg = {
            "jsonrpc": "2.0",
            "id": seq,
            "method": method,
            "params": params or {},
        }

        result_holder = [None]
        exception_holder = [None]
        event = threading.Event()

        class ResultFuture:
            def set_result(self, r):
                result_holder[0] = r
                event.set()
            def set_exception(self, e):
                exception_holder[0] = e
                event.set()

        with self._request_lock:
            self._pending_requests[seq] = ResultFuture()

        self._write_message(msg)

        if not event.wait(timeout=timeout):
            with self._request_lock:
                self._pending_requests.pop(seq, None)
            raise TimeoutError(f"LSP request {method} timed out")

        with self._request_lock:
            self._pending_requests.pop(seq, None)

        if exception_holder[0]:
            raise exception_holder[0]

        return result_holder[0]

    def _write_message(self, msg: dict):
        try:
            content = json.dumps(msg).encode('utf-8')
            header = f"Content-Length: {len(content)}\r\n\r\n".encode('utf-8')
            self._process.stdin.write(header + content)
            self._process.stdin.flush()
        except Exception as e:
            logger.error(f"Error writing to LSP server: {e}")

    def _read_loop(self):
        try:
            buffer = b""
            while self._is_running and self._process and self._process.poll() is None:
                try:
                    content_length = 0
                    while True:
                        line = self._process.stdout.readline()
                        if not line or line == b'\r\n':
                            break
                        line_str = line.decode('utf-8').strip()
                        if line_str.startswith("Content-Length:"):
                            content_length = int(line_str.split(":")[1].strip())

                    if content_length == 0:
                        if not line:
                            break
                        continue

                    content = self._process.stdout.read(content_length)
                    if not content:
                        break
                    msg = json.loads(content.decode('utf-8'))
                    self._handle_message(msg)

                except Exception as e:
                    logger.error(f"Error reading from LSP server: {e}")
        finally:
            self._is_running = False

    def _handle_message(self, msg: dict):
        if "id" in msg and "method" not in msg:
            seq = msg["id"]
            with self._request_lock:
                future = self._pending_requests.get(seq)
            if future:
                if "error" in msg:
                    err = msg["error"]
                    code = err.get("code", 0)
                    message = err.get("message", "LSP Error")
                    future.set_exception(Exception(f"[{code}] {message}"))
                else:
                    future.set_result(msg.get("result"))
            return

        method = msg.get("method")
        if method:
            params = msg.get("params", {})
            handler = self._notification_handlers.get(method)
            if handler:
                try:
                    handler(params)
                except Exception as e:
                    logger.error(f"Error in LSP notification handler for {method}: {e}")
