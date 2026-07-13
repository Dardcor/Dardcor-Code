"""Node Extension Host - Spawns and manages Node.js process for VS Code extensions."""

import os
import json
import subprocess
import threading
import time
from typing import Optional, Dict, Any, Callable


class NodeExtensionHost:
    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        self._handlers: Dict[str, Callable] = {}
        self._host_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "script", "script")
        self._host_js = os.path.join(self._host_dir, "host.js")
        self._pending_requests: Dict[int, Any] = {}
        self._request_lock = threading.Lock()
        self._request_seq = 0
        self._ready = False
        self._callback_handlers: Dict[str, Callable] = {}
        self._crash_count = 0
        self._max_restarts = 3
        self._health_check_timer: Optional[threading.Timer] = None
        self._health_interval = 30.0
        self._loaded_extensions: list = []
        self._crash_handlers: List[Callable] = []

    def on_crash(self, handler: Callable):
        self._crash_handlers.append(handler)

    def start(self, workspace_path: str = ""):
        if self._process and self._process.poll() is None:
            return

        node_cmd = "node"
        try:
            import os
            kwargs = {}
            if os.name == 'nt':
                kwargs['creationflags'] = 0x08000000
            self._process = subprocess.Popen(
                [node_cmd, self._host_js],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                cwd=workspace_path or None,
                **kwargs
            )
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()

            self._stderr_thread = threading.Thread(target=self._read_stderr_loop, daemon=True)
            self._stderr_thread.start()

            self._send_request("initialize", {
                "workspaceFolders": [workspace_path] if workspace_path else [],
                "extensionRoot": self._host_dir,
            })

            self._ready = True
            self._crash_count = 0
            self._start_health_checks()
        except Exception:
            self._ready = False

    def _read_loop(self):
        try:
            for line in self._process.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    if "id" in msg and "result" in msg:
                        seq = msg["id"]
                        with self._request_lock:
                            if seq in self._pending_requests:
                                self._pending_requests[seq].set_result(msg.get("result"))
                    elif "id" in msg and "error" in msg:
                        seq = msg["id"]
                        with self._request_lock:
                            if seq in self._pending_requests:
                                self._pending_requests[seq].set_exception(
                                    Exception(msg["error"].get("message", "Extension host error"))
                                )
                    elif "method" in msg:
                        self._handle_notification(msg)
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass

    def _read_stderr_loop(self):
        try:
            for line in self._process.stderr:
                pass
        except Exception:
            pass

    def _handle_notification(self, msg: dict):
        method = msg.get("method", "")
        params = msg.get("params", {})

        if method == "host.ready":
            self._ready = True
            return

        if method == "commands.registerCommand":
            command = params.get("command", "")
            if command and "commands.registerCommand" in self._callback_handlers:
                self._callback_handlers["commands.registerCommand"](command)

        if method == "commands.unregisterCommand":
            command = params.get("command", "")
            if command and "commands.unregisterCommand" in self._callback_handlers:
                self._callback_handlers["commands.unregisterCommand"](command)

        if method == "window.showInformationMessage":
            if "window.showInformationMessage" in self._callback_handlers:
                self._callback_handlers["window.showInformationMessage"](params.get("message", ""))

        if method == "window.showWarningMessage":
            if "window.showWarningMessage" in self._callback_handlers:
                self._callback_handlers["window.showWarningMessage"](params.get("message", ""))

        if method == "window.showErrorMessage":
            if "window.showErrorMessage" in self._callback_handlers:
                self._callback_handlers["window.showErrorMessage"](params.get("message", ""))

        if method == "window.outputAppend":
            if "window.outputAppend" in self._callback_handlers:
                self._callback_handlers["window.outputAppend"](params)

        if method == "window.statusBarShow":
            if "window.statusBarShow" in self._callback_handlers:
                self._callback_handlers["window.statusBarShow"](params)

        if method == "window.statusBarHide":
            if "window.statusBarHide" in self._callback_handlers:
                self._callback_handlers["window.statusBarHide"](params)

        if method == "window.registerTreeDataProvider":
            if "window.registerTreeDataProvider" in self._callback_handlers:
                self._callback_handlers["window.registerTreeDataProvider"](params.get("viewId", ""))

        if method == "window.treeDataChanged":
            if "window.treeDataChanged" in self._callback_handlers:
                self._callback_handlers["window.treeDataChanged"](params.get("viewId", ""))

        if method == "log":
            pass

    def _send_request(self, method: str, params: Any = None) -> Any:
        if not self._process or self._process.poll() is not None:
            return None

        self._request_seq += 1
        seq = self._request_seq

        msg = {
            "jsonrpc": "2.0",
            "id": seq,
            "method": method,
            "params": params or {},
        }

        try:
            self._process.stdin.write(json.dumps(msg) + "\n")
            self._process.stdin.flush()
        except Exception:
            return None

        return seq

    def send_request_sync(self, method: str, params: Any = None, timeout: float = 5.0) -> Any:
        if not self._ready:
            return None

        seq = self._send_request(method, params)
        if seq is None:
            return None

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

        future = ResultFuture()
        with self._request_lock:
            self._pending_requests[seq] = future

        event.wait(timeout=timeout)

        with self._request_lock:
            self._pending_requests.pop(seq, None)

        if exception_holder[0]:
            return None
        return result_holder[0]

    def load_extension(self, extension_path: str) -> Optional[dict]:
        return self.send_request_sync("loadExtension", {"extensionPath": extension_path})

    def get_tree_children(self, view_id: str, element_id: Optional[str] = None,
                          timeout: float = 8.0) -> list:
        result = self.send_request_sync(
            "treeView.getChildren",
            {"viewId": view_id, "elementId": element_id},
            timeout=timeout,
        )
        if isinstance(result, dict):
            return result.get("children", []) or []
        return []

    def deactivate_extension(self, name: str) -> bool:
        result = self.send_request_sync("deactivateExtension", {"name": name})
        return result.get("ok", False) if result else False

    def fire_event(self, event_name: str, data: Any = None):
        self._send_request("fireEvent", {"event": event_name, "data": data})

    def execute_command(self, command: str, args: Any = None):
        self._send_request("executeCommand", {"command": command, "args": args or []})

    def register_callback(self, event_name: str, handler: Callable):
        self._callback_handlers[event_name] = handler

    def _start_health_checks(self):
        def check():
            while self._process and self._process.poll() is None:
                import time
                time.sleep(self._health_interval)
                if self._process and self._process.poll() is None:
                    self.send_request_sync("ping", {}, timeout=2.0)
        thread = threading.Thread(target=check, daemon=True)
        thread.start()

    def _handle_crash(self):
        self._ready = False
        self._crash_count += 1
        for handler in self._crash_handlers:
            try:
                handler()
            except Exception:
                pass
        if self._crash_count <= self._max_restarts:
            import time
            time.sleep(1)
            self.start()
            for ext_path in self._loaded_extensions:
                self.load_extension(ext_path)

    def stop(self):
        self._ready = False
        if self._health_check_timer:
            self._health_check_timer.cancel()
            self._health_check_timer = None
        if self._process and self._process.poll() is None:
            try:
                self._process.stdin.close()
            except Exception:
                pass
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None
        self._pending_requests.clear()
        self._loaded_extensions.clear()
        self._handlers.clear()
        self._callback_handlers.clear()


_host_instance: Optional[NodeExtensionHost] = None


def get_extension_host() -> NodeExtensionHost:
    global _host_instance
    if _host_instance is None:
        _host_instance = NodeExtensionHost()
    return _host_instance
