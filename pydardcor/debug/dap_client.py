import os
import json
import threading
import subprocess
import logging
from typing import Dict, Any, Callable, Optional, List

logger = logging.getLogger(__name__)


class DapClient:
    """Simplified DAP client for direct debug adapter communication."""

    def __init__(self, command: list[str]):
        self.command = command
        self._process: Optional[subprocess.Popen] = None
        self._request_seq = 1
        self._pending_requests: Dict[int, Any] = {}
        self._request_lock = threading.Lock()
        self._event_handlers: Dict[str, Callable] = {}
        self._is_running = False
        self._initialized = threading.Event()
        self._capabilities: Dict[str, Any] = {}
        self._thread_ids: List[int] = []
        self._current_thread_id: int = 0

    def start(self) -> bool:
        try:
            import os
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
            self._is_running = True

            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()

            resp = self.send_request("initialize", {
                "clientID": "dardcor-code",
                "clientName": "Dardcor Code",
                "adapterID": "python",
                "pathFormat": "path",
                "linesStartAt1": True,
                "columnsStartAt1": True,
                "supportsVariableType": True,
                "supportsVariablePaging": True,
                "supportsRunInTerminalRequest": True,
                "supportsMemoryReferences": True,
                "supportsInvalidatedEvent": True,
            }, timeout=10.0)

            if resp is not None:
                self._capabilities = resp
                self._initialized.wait(timeout=10.0)
                return True
            return False

        except Exception as e:
            logger.error(f"Failed to start DAP adapter {self.command}: {e}")
            return False

    def stop(self):
        self._is_running = False
        if self._process and self._process.poll() is None:
            try:
                self.send_request("disconnect", {
                    "restart": False,
                    "terminateDebuggee": True,
                }, timeout=2.0)
            except (Exception, TimeoutError):
                pass
            try:
                self._process.terminate()
                self._process.wait(timeout=3)
            except Exception:
                if self._process and self._process.poll() is None:
                    self._process.kill()
        self._event_handlers.clear()
        self._pending_requests.clear()
        self._thread_ids.clear()
        self._current_thread_id = 0

    def on_event(self, event_name: str, handler: Callable):
        self._event_handlers[event_name] = handler

    def on_any_event(self, handler: Callable):
        self._event_handlers["__any__"] = handler

    def capabilities(self) -> Dict[str, Any]:
        return dict(self._capabilities)

    def thread_ids(self) -> List[int]:
        return list(self._thread_ids)

    def current_thread_id(self) -> int:
        return self._current_thread_id

    def send_request(self, command: str, arguments: Any = None, timeout: float = 5.0) -> Any:
        if not self._is_running:
            raise RuntimeError("DAP Client is not running")

        with self._request_lock:
            seq = self._request_seq
            self._request_seq += 1

        msg = {
            "seq": seq,
            "type": "request",
            "command": command,
        }
        if arguments:
            msg["arguments"] = arguments

        result_holder = [None]
        exception_holder = [None]
        event = threading.Event()

        with self._request_lock:
            self._pending_requests[seq] = {"result": result_holder, "exception": exception_holder, "event": event}

        self._write_message(msg)

        if not event.wait(timeout=timeout):
            with self._request_lock:
                self._pending_requests.pop(seq, None)
            raise TimeoutError(f"DAP request {command} timed out")

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
            logger.error(f"Error writing to DAP adapter: {e}")

    def _read_loop(self):
        buf = b""
        while self._is_running and self._process.poll() is None:
            try:
                byte = self._process.stdout.read(1)
                if not byte:
                    self._is_running = False
                    return
                buf += byte
                if buf.endswith(b"\r\n\r\n"):
                    header = buf.decode("utf-8").strip()
                    content_length = 0
                    for part in header.split("\r\n"):
                        if part.lower().startswith("content-length:"):
                            content_length = int(part.split(":")[1].strip())
                            break
                    if content_length > 0:
                        content = self._process.stdout.read(content_length)
                        msg = json.loads(content.decode("utf-8"))
                        self._handle_message(msg)
                    buf = b""
            except Exception as e:
                logger.error(f"Error reading from DAP adapter: {e}")
                self._is_running = False

    def _handle_message(self, msg: dict):
        msg_type = msg.get("type")

        if msg_type == "response":
            request_seq = msg.get("request_seq")
            with self._request_lock:
                entry = self._pending_requests.get(request_seq)
            if entry:
                if not msg.get("success", False):
                    entry["exception"][0] = Exception(msg.get("message", "DAP Error"))
                else:
                    entry["result"][0] = msg.get("body", {})
                entry["event"].set()

        elif msg_type == "event":
            event_name = msg.get("event")
            body = msg.get("body", {})
            if event_name == "initialized":
                self._initialized.set()
            elif event_name == "thread":
                reason = body.get("reason", "")
                tid = body.get("threadId", 0)
                if reason == "started" and tid not in self._thread_ids:
                    self._thread_ids.append(tid)
                elif reason == "exited" and tid in self._thread_ids:
                    self._thread_ids.remove(tid)
            elif event_name == "stopped":
                tid = body.get("threadId", 0)
                if tid:
                    self._current_thread_id = tid
                    if tid not in self._thread_ids:
                        self._thread_ids.append(tid)

            handler = self._event_handlers.get(event_name)
            if handler:
                try:
                    handler(body)
                except Exception as e:
                    logger.error(f"Error in DAP event handler for {event_name}: {e}")

            any_handler = self._event_handlers.get("__any__")
            if any_handler:
                try:
                    any_handler(event_name, body)
                except Exception as e:
                    logger.error(f"Error in DAP any-event handler: {e}")

    def configuration_done(self) -> Optional[Dict]:
        return self.send_request("configurationDone")

    def launch(self, config: dict) -> bool:
        try:
            resp = self.send_request("launch", config, timeout=30.0)
            return resp is not None
        except Exception:
            return False

    def attach(self, config: dict) -> bool:
        try:
            resp = self.send_request("attach", config, timeout=30.0)
            return resp is not None
        except Exception:
            return False

    def disconnect(self, restart: bool = False, terminate: bool = True):
        try:
            self.send_request("disconnect", {
                "restart": restart,
                "terminateDebuggee": terminate,
            }, timeout=2.0)
        except Exception:
            pass

    def set_breakpoints(self, file_path: str, breakpoints: List[Dict]) -> Optional[Dict]:
        resp = self.send_request("setBreakpoints", {
            "source": {"path": file_path, "name": os.path.basename(file_path)},
            "breakpoints": breakpoints,
        })
        return resp

    def set_function_breakpoints(self, breakpoints: List[Dict]) -> Optional[Dict]:
        resp = self.send_request("setFunctionBreakpoints", {"breakpoints": breakpoints})
        return resp

    def set_exception_breakpoints(self, filters: List[str],
                                   filter_options: List[Dict] = None) -> Optional[Dict]:
        args = {"filters": filters}
        if filter_options:
            args["filterOptions"] = filter_options
        return self.send_request("setExceptionBreakpoints", args)

    def continue_(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        try:
            resp = self.send_request("continue", {"threadId": thread_id})
            if resp and resp.get("allThreadsContinued"):
                self._current_thread_id = 0
            return True
        except Exception:
            return False

    def next(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        try:
            self.send_request("next", {"threadId": thread_id})
            return True
        except Exception:
            return False

    def step_in(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        try:
            self.send_request("stepIn", {"threadId": thread_id})
            return True
        except Exception:
            return False

    def step_out(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        try:
            self.send_request("stepOut", {"threadId": thread_id})
            return True
        except Exception:
            return False

    def pause(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        try:
            self.send_request("pause", {"threadId": thread_id})
            return True
        except Exception:
            return False

    def stack_trace(self, thread_id: int = 0, start: int = 0, levels: int = 50) -> List[Dict]:
        if not thread_id:
            thread_id = self._current_thread_id
        try:
            resp = self.send_request("stackTrace", {
                "threadId": thread_id,
                "startFrame": start,
                "levels": levels,
            })
            return resp.get("stackFrames", []) if resp else []
        except Exception:
            return []

    def scopes(self, frame_id: int) -> List[Dict]:
        try:
            resp = self.send_request("scopes", {"frameId": frame_id})
            return resp.get("scopes", []) if resp else []
        except Exception:
            return []

    def variables(self, variables_reference: int) -> List[Dict]:
        try:
            resp = self.send_request("variables", {"variablesReference": variables_reference})
            return resp.get("variables", []) if resp else []
        except Exception:
            return []

    def evaluate(self, expression: str, frame_id: int = 0, context: str = "repl") -> Optional[Dict]:
        args = {"expression": expression, "context": context}
        if frame_id:
            args["frameId"] = frame_id
        try:
            return self.send_request("evaluate", args)
        except Exception:
            return None
