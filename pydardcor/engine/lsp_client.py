"""Phase C: Language Server Protocol client for Dardcor Code."""

import os
import json
import subprocess
import threading
from typing import Optional, Dict, Any, List, Callable


class LSPClient:
    def __init__(self, language_id: str, server_cmd: List[str], workspace_path: str = ""):
        self.language_id = language_id
        self._cmd = server_cmd
        self._workspace_path = workspace_path
        self._process: Optional[subprocess.Popen] = None
        self._request_seq = 0
        self._pending: Dict[int, Any] = {}
        self._lock = threading.Lock()
        self._initialized = False
        self._diagnostics_handler: Optional[Callable] = None
        self._completion_handler: Optional[Callable] = None
        self._hover_handler: Optional[Callable] = None

    def start(self) -> bool:
        if self._process and self._process.poll() is None:
            return True

        try:
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
            )
            reader = threading.Thread(target=self._read_loop, daemon=True)
            reader.start()
            self._initialize()
            return True
        except Exception:
            return False

    def _initialize(self):
        params = {
            "processId": os.getpid(),
            "rootUri": f"file:///{self._workspace_path}" if self._workspace_path else None,
            "capabilities": {
                "textDocument": {
                    "synchronization": {"didOpen": True, "didChange": True, "didSave": True, "willSave": False},
                    "completion": {"completionItem": {"snippetSupport": True}},
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                    "definition": {"dynamicRegistration": False},
                    "references": {"dynamicRegistration": False},
                    "publishDiagnostics": {"relatedInformation": True},
                },
                "workspace": {"workspaceFolders": True},
            },
            "workspaceFolders": [{"uri": f"file:///{self._workspace_path}", "name": os.path.basename(self._workspace_path)}] if self._workspace_path else [],
        }
        resp = self._send_request_sync("initialize", params)
        if resp is not None:
            self._initialized = True
            self._send_notification("initialized", {})

    def _read_loop(self):
        try:
            content_length = None
            buffer = ""
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
        elif "method" in msg:
            if msg["method"] == "textDocument/publishDiagnostics":
                uri = msg.get("params", {}).get("uri", "")
                diagnostics = msg.get("params", {}).get("diagnostics", [])
                if self._diagnostics_handler:
                    self._diagnostics_handler(uri, diagnostics)

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

    def did_open(self, file_path: str, language_id: str, content: str):
        if not self._initialized:
            return
        uri = f"file:///{file_path}".replace("\\", "/")
        self._send_notification("textDocument/didOpen", {
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": 1,
                "text": content,
            }
        })

    def did_change(self, file_path: str, changes: List[Dict[str, Any]], version: int = 1):
        if not self._initialized:
            return
        uri = f"file:///{file_path}".replace("\\", "/")
        self._send_notification("textDocument/didChange", {
            "textDocument": {"uri": uri, "version": version},
            "contentChanges": changes,
        })

    def did_save(self, file_path: str, content: str = ""):
        if not self._initialized:
            return
        uri = f"file:///{file_path}".replace("\\", "/")
        params = {"textDocument": {"uri": uri}}
        if content:
            params["text"] = content
        self._send_notification("textDocument/didSave", params)

    def did_close(self, file_path: str):
        if not self._initialized:
            return
        uri = f"file:///{file_path}".replace("\\", "/")
        self._send_notification("textDocument/didClose", {"textDocument": {"uri": uri}})

    def completion(self, file_path: str, line: int, character: int) -> List[Dict[str, Any]]:
        if not self._initialized:
            return []
        uri = f"file:///{file_path}".replace("\\", "/")
        result = self._send_request_sync("textDocument/completion", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "items" in result:
            return result["items"]
        return []

    def hover(self, file_path: str, line: int, character: int) -> Optional[Dict[str, Any]]:
        if not self._initialized:
            return None
        uri = f"file:///{file_path}".replace("\\", "/")
        return self._send_request_sync("textDocument/hover", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })

    def definition(self, file_path: str, line: int, character: int) -> Any:
        if not self._initialized:
            return None
        uri = f"file:///{file_path}".replace("\\", "/")
        return self._send_request_sync("textDocument/definition", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
        })

    def references(self, file_path: str, line: int, character: int) -> List[Dict[str, Any]]:
        if not self._initialized:
            return []
        uri = f"file:///{file_path}".replace("\\", "/")
        return self._send_request_sync("textDocument/references", {
            "textDocument": {"uri": uri},
            "position": {"line": line, "character": character},
            "context": {"includeDeclaration": True},
        }) or []

    def formatting(self, file_path: str) -> List[Dict[str, Any]]:
        if not self._initialized:
            return []
        uri = f"file:///{file_path}".replace("\\", "/")
        return self._send_request_sync("textDocument/formatting", {
            "textDocument": {"uri": uri},
            "options": {"tabSize": 4, "insertSpaces": True},
        }) or []

    def on_diagnostics(self, handler: Callable):
        self._diagnostics_handler = handler

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


class LSPManager:
    def __init__(self):
        self._clients: Dict[str, LSPClient] = {}
        self._workspace_path = ""

    def set_workspace(self, path: str):
        self._workspace_path = path

    def start_python_lsp(self) -> Optional[LSPClient]:
        if "python" in self._clients and self._clients["python"]._initialized:
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
        if "dart" in self._clients and self._clients["dart"]._initialized:
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
        if language_id in self._clients and self._clients[language_id]._initialized:
            return self._clients[language_id]

        client = LSPClient(language_id, cmd, self._workspace_path)
        if client.start():
            self._clients[language_id] = client
            return client
        return None

    def get_client(self, language_id: str) -> Optional[LSPClient]:
        return self._clients.get(language_id)

    def on_diagnostics(self, language_id: str, handler: Callable):
        client = self._clients.get(language_id)
        if client:
            client.on_diagnostics(handler)

    def stop_all(self):
        for client in self._clients.values():
            client.stop()
        self._clients.clear()

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


_lsp_manager_instance: Optional[LSPManager] = None


def get_lsp_manager() -> LSPManager:
    global _lsp_manager_instance
    if _lsp_manager_instance is None:
        _lsp_manager_instance = LSPManager()
    return _lsp_manager_instance
