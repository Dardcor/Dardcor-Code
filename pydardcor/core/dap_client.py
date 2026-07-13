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
        self._initialized_event = threading.Event()
        self._capabilities: Dict[str, Any] = {}
        self._thread_ids: List[int] = []
        self._current_thread_id: int = 0

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
                bufsize=0,
                **kwargs
            )
            self._running = True
            reader = threading.Thread(target=self._read_loop, daemon=True)
            reader.start()
            return True
        except Exception:
            return False

    def _read_loop(self):
        try:
            buf = b""
            while self._running:
                byte = self._process.stdout.read(1)
                if not byte:
                    self._running = False
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
                        body = self._process.stdout.read(content_length)
                        msg = json.loads(body.decode("utf-8"))
                        self._handle_message(msg)
                    buf = b""
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
            if event_name == "initialized":
                self._initialized_event.set()
            elif event_name == "thread":
                reason = body.get("reason", "")
                thread_id = body.get("threadId", 0)
                if reason == "started" and thread_id not in self._thread_ids:
                    self._thread_ids.append(thread_id)
                elif reason == "exited" and thread_id in self._thread_ids:
                    self._thread_ids.remove(thread_id)
            elif event_name == "stopped":
                tid = body.get("threadId", 0)
                if tid:
                    self._current_thread_id = tid
                    if tid not in self._thread_ids:
                        self._thread_ids.append(tid)
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

    def capabilities(self) -> Dict[str, Any]:
        return dict(self._capabilities)

    def initialize(self, adapter_id: str = "dardcor", adapter_version: str = "1.0.0") -> bool:
        self._initialized_event.clear()
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
            "supportsMemoryReferences": True,
            "supportsArgsCanBeInterpretedByShell": True,
        }, timeout=15.0)
        if resp and resp.get("success"):
            self._capabilities = resp.get("body", {})
            return True
        return False

    def wait_for_initialized(self, timeout: float = 15.0) -> bool:
        return self._initialized_event.wait(timeout=timeout)

    def configuration_done(self, timeout: float = 10.0) -> Optional[Dict]:
        return self._send_request("configurationDone", timeout=timeout)

    def launch(self, config: Dict[str, Any], timeout: float = 30.0) -> bool:
        resp = self._send_request("launch", config, timeout=timeout)
        return resp.get("success", False) if resp else False

    def attach(self, config: Dict[str, Any], timeout: float = 30.0) -> bool:
        resp = self._send_request("attach", config, timeout=timeout)
        return resp.get("success", False) if resp else False

    def restart(self, config: Dict[str, Any] = None, timeout: float = 30.0) -> bool:
        args = {}
        if config:
            args["arguments"] = config
        resp = self._send_request("restart", args, timeout=timeout)
        return resp.get("success", False) if resp else False

    def terminate(self, restart: bool = False, timeout: float = 5.0) -> bool:
        resp = self._send_request("terminate", {"restart": restart}, timeout=timeout)
        return resp.get("success", False) if resp else False

    def disconnect(self, restart: bool = False, terminate_debuggee: bool = True, timeout: float = 5.0) -> bool:
        resp = self._send_request("disconnect", {
            "restart": restart,
            "terminateDebuggee": terminate_debuggee,
        }, timeout=timeout)
        self._running = False
        if self._process and self._process.poll() is None:
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
        self._thread_ids.clear()
        self._current_thread_id = 0
        return resp.get("success", False) if resp else False

    def set_breakpoints(self, file_path: str, breakpoints: List[Dict[str, Any]]) -> Optional[Dict]:
        bp_list = []
        for bp in breakpoints:
            entry = {"line": bp.get("line", 1)}
            if "column" in bp:
                entry["column"] = bp["column"]
            if "condition" in bp and bp["condition"]:
                entry["condition"] = bp["condition"]
            if "hitCondition" in bp and bp["hitCondition"]:
                entry["hitCondition"] = bp["hitCondition"]
            if "logMessage" in bp and bp["logMessage"]:
                entry["logMessage"] = bp["logMessage"]
            bp_list.append(entry)
        resp = self._send_request("setBreakpoints", {
            "source": {
                "path": file_path,
                "name": os.path.basename(file_path),
            },
            "breakpoints": bp_list,
        })
        return resp.get("body") if resp else None

    def set_function_breakpoints(self, breakpoints: List[Dict[str, Any]]) -> Optional[Dict]:
        bp_list = []
        for bp in breakpoints:
            entry = {"name": bp.get("name", "")}
            if "condition" in bp and bp["condition"]:
                entry["condition"] = bp["condition"]
            if "hitCondition" in bp and bp["hitCondition"]:
                entry["hitCondition"] = bp["hitCondition"]
            bp_list.append(entry)
        resp = self._send_request("setFunctionBreakpoints", {"breakpoints": bp_list})
        return resp.get("body") if resp else None

    def set_data_breakpoints(self, breakpoints: List[Dict[str, Any]]) -> Optional[Dict]:
        resp = self._send_request("setDataBreakpoints", {"breakpoints": breakpoints})
        return resp.get("body") if resp else None

    def set_exception_breakpoints(self, filters: List[str], filter_options: List[Dict[str, Any]] = None) -> Optional[Dict]:
        args = {"filters": filters}
        if filter_options:
            args["filterOptions"] = filter_options
        resp = self._send_request("setExceptionBreakpoints", args)
        return resp.get("body") if resp else None

    def get_thread_ids(self) -> List[int]:
        return list(self._thread_ids)

    def get_current_thread_id(self) -> int:
        return self._current_thread_id

    def continue_(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        resp = self._send_request("continue", {"threadId": thread_id})
        if resp and resp.get("success"):
            if resp.get("body", {}).get("allThreadsContinued"):
                self._current_thread_id = 0
            return True
        return False

    def next(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        resp = self._send_request("next", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def step_in(self, thread_id: int = 0, target_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        args = {"threadId": thread_id}
        if target_id:
            args["targetId"] = target_id
        resp = self._send_request("stepIn", args)
        return resp.get("success", False) if resp else False

    def step_out(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        resp = self._send_request("stepOut", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def pause(self, thread_id: int = 0) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        resp = self._send_request("pause", {"threadId": thread_id})
        return resp.get("success", False) if resp else False

    def threads(self) -> List[Dict[str, Any]]:
        resp = self._send_request("threads")
        if resp and resp.get("success"):
            threads = resp.get("body", {}).get("threads", [])
            self._thread_ids = [t.get("id", 0) for t in threads]
            return threads
        return []

    def stack_trace(self, thread_id: int, start_frame: int = 0, levels: int = 50,
                    format_params: Dict[str, Any] = None) -> List[Dict]:
        if not thread_id:
            thread_id = self._current_thread_id
        args = {"threadId": thread_id, "startFrame": start_frame, "levels": levels}
        if format_params:
            args["format"] = format_params
        resp = self._send_request("stackTrace", args)
        return resp.get("body", {}).get("stackFrames", []) if resp else []

    def scopes(self, frame_id: int) -> List[Dict]:
        resp = self._send_request("scopes", {"frameId": frame_id})
        return resp.get("body", {}).get("scopes", []) if resp else []

    def variables(self, variables_reference: int, filter: str = "",
                  start: int = 0, count: int = 0) -> List[Dict]:
        args = {"variablesReference": variables_reference}
        if filter:
            args["filter"] = filter
        if start:
            args["start"] = start
        if count:
            args["count"] = count
        resp = self._send_request("variables", args)
        return resp.get("body", {}).get("variables", []) if resp else []

    def evaluate(self, expression: str, frame_id: int = 0, context: str = "repl",
                 format_spec: Dict[str, Any] = None) -> Optional[Dict]:
        args = {"expression": expression, "context": context}
        if frame_id:
            args["frameId"] = frame_id
        if format_spec:
            args["format"] = format_spec
        resp = self._send_request("evaluate", args)
        return resp.get("body") if resp else None

    def set_variable(self, variables_reference: int, name: str, value: str,
                     format_spec: Dict[str, Any] = None) -> Optional[Dict]:
        args = {"variablesReference": variables_reference, "name": name, "value": value}
        if format_spec:
            args["format"] = format_spec
        resp = self._send_request("setVariable", args)
        return resp.get("body") if resp else None

    def exception_info(self, thread_id: int = 0) -> Optional[Dict]:
        if not thread_id:
            thread_id = self._current_thread_id
        resp = self._send_request("exceptionInfo", {"threadId": thread_id})
        return resp.get("body") if resp else None

    def gotoTargets(self, source_path: str, line: int, column: int = 0) -> Optional[Dict]:
        args = {"source": {"path": source_path}, "line": line}
        if column:
            args["column"] = column
        resp = self._send_request("gotoTargets", args)
        return resp.get("body") if resp else None

    def goto(self, thread_id: int, target_id: int) -> bool:
        if not thread_id:
            thread_id = self._current_thread_id
        resp = self._send_request("goto", {"threadId": thread_id, "targetId": target_id})
        return resp.get("success", False) if resp else False

    def source(self, source_reference: int, source_path: str = "") -> Optional[Dict]:
        args = {"sourceReference": source_reference}
        if source_path:
            args["source"] = {"path": source_path}
        resp = self._send_request("source", args)
        return resp.get("body") if resp else None

    def loaded_sources(self) -> Optional[Dict]:
        resp = self._send_request("loadedSources", {})
        return resp.get("body") if resp else None

    def modules(self, start_module: int = 0, module_count: int = 0) -> Optional[Dict]:
        args = {}
        if start_module:
            args["startModule"] = start_module
        if module_count:
            args["moduleCount"] = module_count
        resp = self._send_request("modules", args)
        return resp.get("body") if resp else None

    def completions(self, text: str, column: int, line: int = 0,
                    frame_id: int = 0) -> Optional[Dict]:
        args = {"text": text, "column": column}
        if line:
            args["line"] = line
        if frame_id:
            args["frameId"] = frame_id
        resp = self._send_request("completions", args)
        return resp.get("body") if resp else None

    def disassemble(self, memory_reference: str, offset: int = 0,
                    instruction_count: int = 50, resolution: int = 0) -> Optional[Dict]:
        args = {
            "memoryReference": memory_reference,
            "offset": offset,
            "instructionCount": instruction_count,
        }
        if resolution:
            args["resolution"] = resolution
        resp = self._send_request("disassemble", args)
        return resp.get("body") if resp else None

    def read_memory(self, memory_reference: str, offset: int = 0, count: int = 0) -> Optional[Dict]:
        args = {"memoryReference": memory_reference}
        if offset:
            args["offset"] = offset
        if count:
            args["count"] = count
        resp = self._send_request("readMemory", args)
        return resp.get("body") if resp else None

    def step_filters(self) -> List[Dict]:
        caps = self._capabilities
        if caps.get("supportsStepFilters"):
            resp = self._send_request("stepFilters")
            if resp and resp.get("success"):
                return resp.get("body", {}).get("stepFilters", [])
        return []

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

    def get_session(self, language_id: str) -> Optional[DAPClient]:
        return self._sessions.get(language_id)

    def get_active_sessions(self) -> List[DAPClient]:
        return list(self._sessions.values())

    def session_count(self) -> int:
        return len(self._sessions)

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
            def chained(evt, body):
                self._event_handler(evt, body)
                client._event_handler = chained

        if not client.start():
            return None
        if not client.initialize("debugpy"):
            client.disconnect()
            return None

        ok = client.wait_for_initialized(timeout=15.0)
        if not ok:
            client.disconnect()
            return None

        bp_list = launch_config.pop("breakpoints", [])
        if bp_list:
            for bp in bp_list:
                path = bp.get("path", "")
                points = bp.get("points", [])
                if path and points:
                    client.set_breakpoints(path, points)

        if launch_config.get("exceptionBreakpoints"):
            client.set_exception_breakpoints(
                launch_config["exceptionBreakpoints"]
            )

        client.configuration_done()

        if not client.launch(launch_config, timeout=30.0):
            client.disconnect()
            return None

        self._sessions["python"] = client
        return client

    def start_node_debug(self, config: Dict[str, Any]) -> Optional[DAPClient]:
        import shutil
        node_path = shutil.which("node")
        if not node_path:
            return None

        file_path = config.get("program", "")
        cmd = [node_path, "--inspect-brk" if config.get("stopOnEntry") else "--inspect",
               file_path] if file_path else [node_path]

        client = DAPClient("node", cmd, self._workspace_path)
        if self._event_handler:
            def chained(evt, body):
                self._event_handler(evt, body)
            client.on_event(chained)

        if client.start() and client.initialize("node"):
            client.wait_for_initialized(timeout=15.0)
            client.configuration_done()
            self._sessions["node"] = client
            return client
        return None

    def start_chrome_debug(self, port: int = 9222) -> Optional[DAPClient]:
        cmd = ["node", os.path.join(os.path.dirname(__file__), "..", "..", "node_modules",
               "vscode-chrome-debug-core", "out", "src", "chromeDebugAdapter.js")]
        client = DAPClient("chrome", cmd, self._workspace_path)
        if self._event_handler:
            client.on_event(self._event_handler)
        if client.start() and client.initialize("chrome"):
            client.wait_for_initialized(timeout=15.0)
            client.configuration_done()
            if client.attach({"port": port, "sourceMaps": True}):
                self._sessions["chrome"] = client
                return client
        client.disconnect()
        return None

    def stop_session(self, language_id: str):
        client = self._sessions.pop(language_id, None)
        if client:
            try:
                client.disconnect()
            except Exception:
                pass

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
