"""Phase E: Debug Adapter Protocol client for Dardcor Code."""

import os
import json
import subprocess
import threading
from typing import Optional, Dict, Any, List, Callable


class DAPClient:
    def __init__(self, language_id: str, adapter_cmd: List[str], workspace_path: str = ""):
        self.language_id = language_id
        self._cmd = adapter_cmd
        self._workspace_path = workspace_path
        self._process: Optional[subprocess.Popen] = None
        self._seq = 0
        self._pending: Dict[int, threading.Event] = {}
        self._results: Dict[int, Any] = {}
        self._lock = threading.Lock()
        self._running = False
        self._event_handler: Optional[Callable] = None

    def start(self) -> bool:
        if self._process and self._process.poll() is None:
            return True

        try:
            self._process = subprocess.Popen(
                self._cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=0,
            )
            self._running = True
            reader = threading.Thread(target=self._read_loop, daemon=True)
            reader.start()
            return True
        except Exception:
            return False

    def _read_loop(self):
        try:
            while self._running:
                header = b""
                while True:
                    byte = self._process.stdout.read(1)
                    if not byte:
                        self._running = False
                        return
                    header += byte
                    if header.endswith(b"\r\n\r\n"):
                        break

                content_length = 0
                for part in header.decode("utf-8").strip().split("\r\n"):
                    if part.startswith("Content-Length:"):
                        content_length = int(part.split(":")[1].strip())
                        break

                if content_length > 0:
                    body = self._process.stdout.read(content_length)
                    msg = json.loads(body.decode("utf-8"))
                    self._handle_message(msg)
        except Exception:
            self._running = False

    def _handle_message(self, msg: dict):
        msg_type = msg.get("type", "")

        if msg_type == "response":
            seq = msg.get("request_seq", 0)
            with self._lock:
                if seq in self._pending:
                    self._results[seq] = msg
                    self._pending[seq].set()

        elif msg_type == "event":
            event_name = msg.get("event", "")
            body = msg.get("body", {})
            if self._event_handler:
                self._event_handler(event_name, body)

    def _send_message(self, msg_type: str, command: str = "", arguments: Any = None, request_seq: int = 0) -> int:
        if not self._process or self._process.poll() is not None:
            return -1

        self._seq += 1
        msg = {"type": msg_type, "seq": self._seq}
        if command:
            msg["command"] = command
        if arguments:
            msg["arguments"] = arguments
        if request_seq:
            msg["request_seq"] = request_seq

        body = json.dumps(msg)
        header = f"Content-Length: {len(body.encode('utf-8'))}\r\n\r\n"

        try:
            self._process.stdin.write(header.encode("utf-8") + body.encode("utf-8"))
            self._process.stdin.flush()
        except Exception:
            return -1

        return self._seq

    def _send_request(self, command: str, arguments: Any = None, timeout: float = 10.0) -> Optional[Dict]:
        seq = self._send_message("request", command, arguments)
        if seq < 0:
            return None

        event = threading.Event()
        with self._lock:
            self._pending[seq] = event

        event.wait(timeout=timeout)

        with self._lock:
            self._pending.pop(seq, None)
            return self._results.pop(seq, None)

    def initialize(self, adapter_id: str = "dardcor", adapter_version: str = "1.0.0") -> bool:
        resp = self._send_request("initialize", {
            "adapterID": adapter_id,
            "clientID": "dardcor-code",
            "clientName": "Dardcor Code",
            "locale": "en-US",
            "linesStartAt1": True,
            "columnsStartAt1": True,
            "supportsVariableType": True,
            "supportsVariablePaging": True,
            "supportsRunInTerminalRequest": True,
            "supportsProgressReports": True,
            "supportsInvalidatedEvent": True,
        }, timeout=15.0)
        if resp and resp.get("success"):
            self._send_message("request", "configurationDone")
            return True
        return False

    def launch(self, config: Dict[str, Any]) -> bool:
        resp = self._send_request("launch", config, timeout=30.0)
        return resp.get("success", False) if resp else False

    def attach(self, config: Dict[str, Any]) -> bool:
        resp = self._send_request("attach", config, timeout=30.0)
        return resp.get("success", False) if resp else False

    def set_breakpoints(self, file_path: str, breakpoints: List[Dict[str, Any]]) -> Optional[Dict]:
        uri = f"file:///{file_path}".replace("\\", "/")
        resp = self._send_request("setBreakpoints", {
            "source": {"path": file_path, "name": os.path.basename(file_path), "uri": uri},
            "breakpoints": breakpoints,
        })
        return resp.get("body") if resp else None

    def set_function_breakpoints(self, breakpoints: List[Dict[str, Any]]) -> Optional[Dict]:
        resp = self._send_request("setFunctionBreakpoints", {"breakpoints": breakpoints})
        return resp.get("body") if resp else None

    def continue_(self, thread_id: int = 0) -> bool:
        resp = self._send_request("continue", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def next(self, thread_id: int = 0) -> bool:
        resp = self._send_request("next", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def step_in(self, thread_id: int = 0) -> bool:
        resp = self._send_request("stepIn", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def step_out(self, thread_id: int = 0) -> bool:
        resp = self._send_request("stepOut", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def pause(self, thread_id: int = 0) -> bool:
        resp = self._send_request("pause", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def stop(self, thread_id: int = 0) -> bool:
        resp = self._send_request("stop", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def threads(self) -> List[Dict[str, Any]]:
        resp = self._send_request("threads")
        return resp.get("body", {}).get("threads", []) if resp else []

    def stack_trace(self, thread_id: int, start_frame: int = 0, levels: int = 20) -> List[Dict]:
        resp = self._send_request("stackTrace", {"threadId": thread_id, "startFrame": start_frame, "levels": levels})
        return resp.get("body", {}).get("stackFrames", []) if resp else []

    def scopes(self, frame_id: int) -> List[Dict]:
        resp = self._send_request("scopes", {"frameId": frame_id})
        return resp.get("body", {}).get("scopes", []) if resp else []

    def variables(self, variables_reference: int) -> List[Dict]:
        resp = self._send_request("variables", {"variablesReference": variables_reference})
        return resp.get("body", {}).get("variables", []) if resp else []

    def evaluate(self, expression: str, frame_id: int = 0, context: str = "repl") -> Optional[Dict]:
        resp = self._send_request("evaluate", {"expression": expression, "frameId": frame_id, "context": context})
        return resp.get("body") if resp else None

    def configuration_done(self):
        self._send_message("request", "configurationDone")

    def disconnect(self, restart: bool = False) -> bool:
        resp = self._send_request("disconnect", {"restart": restart}, timeout=5.0)
        self._running = False
        if self._process and self._process.poll() is None:
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
        return resp.get("success", False) if resp else False

    def on_event(self, handler: Callable):
        self._event_handler = handler


class DAPManager:
    def __init__(self):
        self._sessions: Dict[str, DAPClient] = {}
        self._workspace_path = ""
        self._event_handler: Optional[Callable] = None

    def set_workspace(self, path: str):
        self._workspace_path = path

    def on_event(self, handler: Callable):
        self._event_handler = handler

    def start_python_debug(self, config: Dict[str, Any]) -> Optional[DAPClient]:
        import shutil
        import sys

        python_path = shutil.which("python") or shutil.which("python3") or sys.executable
        if not python_path:
            return None

        cmd = [python_path, "-m", "debugpy.adapter"]
        launch_config = dict(config)
        program = launch_config.get("program", "")
        if program and not launch_config.get("cwd"):
            launch_config["cwd"] = self._workspace_path or os.path.dirname(program)

        client = DAPClient("python", cmd, self._workspace_path)
        if self._event_handler:
            client.on_event(self._event_handler)

        if client.start() and client.initialize("debugpy") and client.launch(launch_config):
            self._sessions["python"] = client
            return client
        client.disconnect()
        return None

    def start_node_debug(self, config: Dict[str, Any]) -> Optional[DAPClient]:
        import shutil
        node_path = shutil.which("node")
        if not node_path:
            return None

        file_path = config.get("program", "")
        cmd = ["node", "--inspect-brk" if config.get("stopOnEntry") else "--inspect", file_path] if file_path else [node_path]

        client = DAPClient("node", cmd, self._workspace_path)
        if self._event_handler:
            client.on_event(self._event_handler)

        if client.start() and client.initialize("node"):
            client.configuration_done()
            self._sessions["node"] = client
            return client
        return None

    def get_session(self, language_id: str) -> Optional[DAPClient]:
        return self._sessions.get(language_id)

    def stop_all(self):
        for client in self._sessions.values():
            try:
                client.disconnect()
            except Exception:
                pass
        self._sessions.clear()


_dap_manager_instance: Optional[DAPManager] = None


def get_dap_manager() -> DAPManager:
    global _dap_manager_instance
    if _dap_manager_instance is None:
        _dap_manager_instance = DAPManager()
    return _dap_manager_instance
