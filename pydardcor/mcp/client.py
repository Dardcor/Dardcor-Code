"""MCP Client - Connects to Model Context Protocol (MCP) servers and handles tool execution."""

import json
import subprocess
import threading
from typing import Dict, Any, List, Optional
from PySide6.QtCore import QObject, Signal

class MCPClient(QObject):
    """Client for Model Context Protocol servers."""
    message_received = Signal(dict)

    def __init__(self, server_name: str, command: List[str], parent=None):
        super().__init__(parent)
        self.server_name = server_name
        self._command = command
        self._process: Optional[subprocess.Popen] = None
        self._request_id = 0
        self._pending_requests: Dict[int, threading.Event] = {}
        self._responses: Dict[int, Any] = {}
        self._lock = threading.Lock()

    def start(self) -> bool:
        try:
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            self._process = subprocess.Popen(
                self._command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
                **kwargs
            )
            # Start standard reader loop
            threading.Thread(target=self._reader_loop, daemon=True).start()
            # Send standard initialization request
            self._initialize()
            return True
        except Exception:
            return False

    def _initialize(self):
        self.send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "Dardcor-Code-MCP-Client", "version": "1.0.0"}
        })

    def _reader_loop(self):
        while self._process and self._process.poll() is None:
            try:
                line = self._process.stdout.readline()
                if not line:
                    break
                data = json.loads(line)
                self._handle_incoming(data)
            except Exception:
                break

    def _handle_incoming(self, msg: dict):
        if "id" in msg:
            req_id = msg["id"]
            with self._lock:
                if req_id in self._pending_requests:
                    self._responses[req_id] = msg
                    self._pending_requests[req_id].set()
        self.message_received.emit(msg)

    def send_request(self, method: str, params: dict = None, timeout=5.0) -> Optional[dict]:
        if not self._process or self._process.poll() is not None:
            return None

        with self._lock:
            self._request_id += 1
            req_id = self._request_id
            event = threading.Event()
            self._pending_requests[req_id] = event

        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {}
        }

        try:
            self._process.stdin.write(json.dumps(payload) + "\n")
            self._process.stdin.flush()
        except Exception:
            return None

        completed = event.wait(timeout)
        with self._lock:
            self._pending_requests.pop(req_id, None)
            res = self._responses.pop(req_id, None)

        if completed and res:
            return res.get("result")
        return None

    def list_tools(self) -> List[Dict[str, Any]]:
        res = self.send_request("tools/list")
        if res:
            return res.get("tools", [])
        return []

    def call_tool(self, name: str, arguments: dict = None) -> Optional[dict]:
        res = self.send_request("tools/call", {
            "name": name,
            "arguments": arguments or {}
        })
        return res

    def list_resources(self) -> List[Dict[str, Any]]:
        res = self.send_request("resources/list")
        if res:
            return res.get("resources", [])
        return []

    def stop(self):
        if self._process:
            self._process.terminate()
            self._process = None
