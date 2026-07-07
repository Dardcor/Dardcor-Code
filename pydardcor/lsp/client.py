import os
import json
import threading
import subprocess
import logging
from typing import Dict, Any, Callable, Optional

logger = logging.getLogger(__name__)

class LspClient:
    """Client for Language Server Protocol (LSP)."""

    def __init__(self, command: list[str], root_uri: str):
        self.command = command
        self.root_uri = root_uri
        self._process: Optional[subprocess.Popen] = None
        self._request_seq = 0
        self._pending_requests: Dict[int, Any] = {}
        self._request_lock = threading.Lock()
        self._notification_handlers: Dict[str, Callable] = {}
        self._is_running = False

    def start(self):
        try:
            self._process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            self._is_running = True
            
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            
            # Send initialize request
            self._initialize()
            
        except Exception as e:
            logger.error(f"Failed to start LSP server {self.command}: {e}")

    def stop(self):
        if not self._is_running:
            return
        
        # Graceful shutdown sequence
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
                    "completion": {"completionItem": {"snippetSupport": True}},
                    "hover": {"dynamicRegistration": True},
                    "definition": {"dynamicRegistration": True},
                    "references": {"dynamicRegistration": True},
                    "formatting": {"dynamicRegistration": True},
                    "publishDiagnostics": {"relatedInformation": True}
                }
            }
        }
        
        try:
            response = self.send_request("initialize", params)
            self.send_notification("initialized")
            logger.info("LSP server initialized successfully")
        except Exception as e:
            logger.error(f"LSP initialize failed: {e}")

    def on_notification(self, method: str, handler: Callable):
        self._notification_handlers[method] = handler

    def send_notification(self, method: str, params: Any = None):
        if not self._is_running:
            return
            
        msg = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        self._write_message(msg)

    def send_request(self, method: str, params: Any = None, timeout: float = 5.0) -> Any:
        if not self._is_running:
            raise RuntimeError("LSP Client is not running")

        with self._request_lock:
            self._request_seq += 1
            seq = self._request_seq

        msg = {
            "jsonrpc": "2.0",
            "id": seq,
            "method": method,
            "params": params or {}
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
            while self._is_running and self._process and self._process.poll() is None:
                try:
                    # Read header
                    content_length = 0
                    while True:
                        line = self._process.stdout.readline()
                        if not line or line == b'\r\n':
                            break
                        line_str = line.decode('utf-8').strip()
                        if line_str.startswith("Content-Length:"):
                            content_length = int(line_str.split(":")[1].strip())
                    
                    if content_length == 0:
                        if not line: # EOF
                            break
                        continue
                        
                    # Read content
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
        # Is it a response?
        if "id" in msg and "method" not in msg:
            seq = msg["id"]
            with self._request_lock:
                future = self._pending_requests.get(seq)
                
            if future:
                if "error" in msg:
                    future.set_exception(Exception(msg["error"].get("message", "LSP Error")))
                else:
                    future.set_result(msg.get("result"))
            return

        # It's a notification from server
        method = msg.get("method")
        if method:
            params = msg.get("params", {})
            handler = self._notification_handlers.get(method)
            if handler:
                try:
                    handler(params)
                except Exception as e:
                    logger.error(f"Error in LSP notification handler for {method}: {e}")
