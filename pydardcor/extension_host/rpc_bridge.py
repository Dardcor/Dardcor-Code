import json
import threading
import subprocess
from typing import Dict, Any, Callable, Optional
import traceback
import logging

logger = logging.getLogger(__name__)

class RpcBridge:
    """JSON-RPC Bridge for communicating with the Node.js Extension Host."""

    def __init__(self, process: subprocess.Popen):
        self._process = process
        self._pending_requests: Dict[int, Any] = {}
        self._request_lock = threading.Lock()
        self._request_seq = 0
        self._notification_handlers: Dict[str, Callable] = {}
        self._request_handlers: Dict[str, Callable] = {}
        self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self._is_running = True

    def start(self):
        self._reader_thread.start()

    def stop(self):
        self._is_running = False

    def register_notification_handler(self, method: str, handler: Callable):
        """Register a handler for incoming notifications (no response expected)."""
        self._notification_handlers[method] = handler

    def register_request_handler(self, method: str, handler: Callable):
        """Register a handler for incoming requests (response expected)."""
        self._request_handlers[method] = handler

    def send_notification(self, method: str, params: Any = None):
        """Send a notification to the extension host."""
        if not self._process or self._process.poll() is not None:
            return

        msg = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        self._write_msg(msg)

    def send_request_sync(self, method: str, params: Any = None, timeout: float = 5.0) -> Any:
        """Send a request to the extension host and wait for the response."""
        if not self._process or self._process.poll() is not None:
            raise Exception("Extension host process is not running")

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

        self._write_msg(msg)

        if not event.wait(timeout=timeout):
            with self._request_lock:
                self._pending_requests.pop(seq, None)
            raise TimeoutError(f"Request {method} timed out after {timeout}s")

        with self._request_lock:
            self._pending_requests.pop(seq, None)

        if exception_holder[0]:
            raise exception_holder[0]
        
        return result_holder[0]

    def _write_msg(self, msg: dict):
        try:
            self._process.stdin.write(json.dumps(msg) + "\n")
            self._process.stdin.flush()
        except Exception as e:
            logger.error(f"Failed to write to extension host: {e}")

    def _read_loop(self):
        try:
            for line in self._process.stdout:
                if not self._is_running:
                    break
                    
                line = line.strip()
                if not line:
                    continue
                    
                try:
                    msg = json.loads(line)
                    self._handle_message(msg)
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from extension host: {line}")
                except Exception as e:
                    logger.error(f"Error handling message from extension host: {e}")
                    traceback.print_exc()
        except Exception as e:
            logger.error(f"Extension host reader thread error: {e}")

    def _handle_message(self, msg: dict):
        # Is it a response to a request we sent?
        if "id" in msg and ("result" in msg or "error" in msg) and "method" not in msg:
            seq = msg["id"]
            with self._request_lock:
                future = self._pending_requests.get(seq)
                
            if future:
                if "error" in msg:
                    future.set_exception(Exception(msg["error"].get("message", "Unknown RPC error")))
                else:
                    future.set_result(msg.get("result"))
            return

        method = msg.get("method")
        
        # Is it a request from the host to us?
        if "id" in msg and method:
            params = msg.get("params", {})
            handler = self._request_handlers.get(method)
            
            if handler:
                try:
                    result = handler(params)
                    self._write_msg({
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "result": result
                    })
                except Exception as e:
                    self._write_msg({
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "error": {"code": -32000, "message": str(e)}
                    })
            else:
                self._write_msg({
                    "jsonrpc": "2.0",
                    "id": msg["id"],
                    "error": {"code": -32601, "message": f"Method not found: {method}"}
                })
            return

        # It's a notification
        if method:
            params = msg.get("params", {})
            handler = self._notification_handlers.get(method)
            if handler:
                try:
                    handler(params)
                except Exception as e:
                    logger.error(f"Error in notification handler for {method}: {e}")
            else:
                pass # Unhandled notification
