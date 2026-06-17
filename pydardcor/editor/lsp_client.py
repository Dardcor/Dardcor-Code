"""Language Server Protocol (LSP) Client for Dardcor Code."""

import os
import json
import threading
from typing import Dict, Any, Callable
from PySide6.QtCore import QObject, Signal

class LSPClient(QObject):
    """A client for communicating with Language Servers via JSON-RPC."""
    
    # Emits (uri, list_of_diagnostic_dicts)
    diagnostics_ready = Signal(str, list)

    def __init__(self, command: list, parent=None):
        super().__init__(parent)
        self.command = command
        self._process = None
        self._request_id = 1
        self._callbacks = {}
        self._reader_thread = None
        self._lock = threading.Lock()
        
    def start(self):
        """Starts the language server process."""
        if self._process:
            return True
            
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
                
            import subprocess
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                **kwargs
            )
            
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            
            # Send initialize request
            root_uri = None # could pass workspace root here
            self.send_request_sync("initialize", {
                "processId": os.getpid(),
                "rootUri": root_uri,
                "capabilities": {
                    "textDocument": {
                        "completion": {"completionItem": {"snippetSupport": True}},
                        "hover": {"contentFormat": ["markdown", "plaintext"]}
                    }
                }
            })
            # Send initialized notification
            self.send_notification("initialized", {})
            return True
        except Exception as e:
            print(f"LSP Error starting {self.command}: {e}")
            return False
            
    def _read_loop(self):
        """Read loop to parse JSON-RPC headers and bodies."""
        while self._process and self._process.poll() is None:
            try:
                line = self._process.stdout.readline()
                if not line:
                    break
                line = line.decode('utf-8').strip()
                if not line:
                    continue
                    
                if line.startswith("Content-Length:"):
                    length = int(line.split(":")[1].strip())
                    # Skip empty line
                    self._process.stdout.readline()
                    
                    body = self._process.stdout.read(length)
                    data = json.loads(body.decode('utf-8'))
                    self._handle_response(data)
            except Exception as e:
                print(f"LSP Read Error: {e}")
                break
                
    def _handle_response(self, data: Dict[str, Any]):
        # Check if it is a response to a request
        if "id" in data:
            req_id = data["id"]
            with self._lock:
                callback = self._callbacks.pop(req_id, None)
            if callback:
                callback(data.get("result"), data.get("error"))
        # Check if it is a notification
        elif "method" in data:
            method = data["method"]
            params = data.get("params", {})
            if method == "textDocument/publishDiagnostics":
                self._handle_diagnostics(params)

    def _handle_diagnostics(self, params: dict):
        uri = params.get("uri", "")
        diagnostics = params.get("diagnostics", [])
        
        markers = []
        for d in diagnostics:
            range_data = d.get("range", {})
            start = range_data.get("start", {})
            end = range_data.get("end", {})
            
            # Severity: 1=Error, 2=Warning, 3=Info, 4=Hint
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
                "source": d.get("source", "LSP")
            })
            
        self.diagnostics_ready.emit(uri, markers)

    def send_notification(self, method: str, params: dict):
        """Send a JSON-RPC notification (no ID, no response expected)."""
        if not self._process:
            return
            
        message = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        self._write_message(message)
                
    def send_request(self, method: str, params: dict, callback: Callable = None):
        """Send a JSON-RPC request to the server."""
        if not self._process:
            return
            
        with self._lock:
            req_id = self._request_id
            self._request_id += 1
            if callback:
                self._callbacks[req_id] = callback
            
        message = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params
        }
        self._write_message(message)
        
    def send_request_sync(self, method: str, params: dict, timeout: float = 2.0) -> dict:
        """Send a request and block until response or timeout."""
        if not self._process:
            return {}
            
        event = threading.Event()
        result_box = {}
        
        def callback(result, error):
            if error:
                result_box["error"] = error
            else:
                result_box["result"] = result
            event.set()
            
        self.send_request(method, params, callback)
        event.wait(timeout)
        return result_box

    def _write_message(self, message: dict):
        body = json.dumps(message)
        header = f"Content-Length: {len(body)}\r\n\r\n"
        
        try:
            self._process.stdin.write(header.encode('utf-8'))
            self._process.stdin.write(body.encode('utf-8'))
            self._process.stdin.flush()
        except Exception as e:
            print(f"LSP Write Error: {e}")
            
    def stop(self):
        """Stops the language server."""
        if self._process:
            self.send_notification("exit", {})
            self._process.terminate()
            self._process = None
