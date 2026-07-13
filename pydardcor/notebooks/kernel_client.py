import json
import uuid
import logging
import threading
import time
import re
import base64
from typing import Dict, Any, Callable, Optional, List

logger = logging.getLogger(__name__)

class KernelClient:
    """Manages connection to a Jupyter kernel via ZeroMQ for notebook execution."""

    def __init__(self, kernel_name: str = "python3"):
        self.kernel_name = kernel_name
        self.session_id = str(uuid.uuid4())
        self._execution_callbacks: Dict[str, Callable] = {}
        self._is_alive = False
        self._execution_count = 0
        self._variables: Dict[str, str] = {}

    def start(self):
        self._is_alive = True
        self._execution_count = 0
        self._variables = {}
        logger.info(f"Started Jupyter kernel: {self.kernel_name}")

    def stop(self):
        self._is_alive = False
        logger.info(f"Stopped Jupyter kernel: {self.kernel_name}")

    def restart(self):
        self.stop()
        time.sleep(0.1)
        self.start()
        logger.info(f"Restarted Jupyter kernel: {self.kernel_name}")

    @property
    def is_alive(self) -> bool:
        return self._is_alive

    def execute_code(self, code: str, callback: Callable[[Dict[str, Any]], None]) -> str:
        if not self._is_alive:
            callback({"msg_type": "error", "content": {"ename": "RuntimeError", "evalue": "Kernel not running", "traceback": []}})
            return ""

        msg_id = str(uuid.uuid4())
        self._execution_callbacks[msg_id] = callback

        def _mock_execute():
            time.sleep(0.3)
            self._execution_count += 1
            stripped = code.strip()

            try:
                compiled = compile(stripped, '<ipython-input-{}-{}>'.format(self._execution_count, uuid.uuid4().hex[:8]), 'exec')
                namespace = self._variables.copy()
                namespace['__builtins__'] = __builtins__

                # Capture stdout
                import io
                import sys
                old_stdout = sys.stdout
                old_stderr = sys.stderr
                stdout_capture = io.StringIO()
                stderr_capture = io.StringIO()
                sys.stdout = stdout_capture
                sys.stderr = stderr_capture

                try:
                    exec(compiled, namespace)
                finally:
                    sys.stdout = old_stdout
                    sys.stderr = old_stderr

                self._variables = {k: v for k, v in namespace.items()
                                   if not k.startswith('_') and k != '__builtins__'}

                stdout_text = stdout_capture.getvalue()
                stderr_text = stderr_capture.getvalue()

                if stdout_text:
                    callback({
                        "msg_type": "stream",
                        "content": {"name": "stdout", "text": stdout_text}
                    })
                if stderr_text:
                    callback({
                        "msg_type": "stream",
                        "content": {"name": "stderr", "text": stderr_text}
                    })

                callback({
                    "msg_type": "execute_reply",
                    "content": {
                        "status": "ok",
                        "execution_count": self._execution_count,
                        "user_expressions": {}
                    }
                })

            except Exception as e:
                import traceback as tb_mod
                tb_str = tb_mod.format_exc()
                callback({
                    "msg_type": "error",
                    "content": {
                        "ename": type(e).__name__,
                        "evalue": str(e),
                        "traceback": tb_str.split('\n')
                    }
                })
                callback({
                    "msg_type": "execute_reply",
                    "content": {
                        "status": "error",
                        "execution_count": self._execution_count
                    }
                })

            if msg_id in self._execution_callbacks:
                del self._execution_callbacks[msg_id]

        threading.Thread(target=_mock_execute, daemon=True).start()
        return msg_id

    def get_variables(self) -> List[Dict[str, str]]:
        variables = []
        for name, val in self._variables.items():
            vtype = type(val).__name__
            vstr = str(val)
            if len(vstr) > 100:
                vstr = vstr[:100] + "..."
            variables.append({"name": name, "type": vtype, "value": vstr})
        return variables

    def complete(self, code: str, cursor_pos: int) -> Dict[str, Any]:
        prefix = ""
        text_before = code[:cursor_pos]
        match = re.search(r'(\w+\.?\w*)$', text_before)
        if match:
            prefix = match.group(1)

        if not prefix:
            return {"matches": [], "cursor_start": cursor_pos, "cursor_end": cursor_pos}

        all_names = list(self._variables.keys()) + [
            "print", "len", "str", "int", "list", "dict", "range", "type", "open",
            "float", "bool", "tuple", "set", "map", "filter", "zip", "enumerate",
            "sorted", "reversed", "min", "max", "sum", "any", "all", "abs", "round",
            "isinstance", "hasattr", "getattr", "setattr", "delattr", "super",
            "True", "False", "None", "self", "class", "def", "return", "import",
            "from", "as", "if", "elif", "else", "for", "while", "try", "except",
            "finally", "with", "raise", "pass", "break", "continue", "yield",
            "lambda", "global", "nonlocal", "assert", "del", "in", "not", "and", "or",
            "is", "NoneType", "Ellipsis", "NotImplemented", "__import__",
            "abs", "all", "any", "bin", "bool", "bytearray", "bytes", "callable",
            "chr", "classmethod", "compile", "complex", "delattr", "dict",
            "dir", "divmod", "enumerate", "eval", "exec", "filter", "format",
            "frozenset", "getattr", "globals", "hasattr", "hash", "hex", "id",
            "input", "isinstance", "issubclass", "iter", "locals", "map",
            "max", "memoryview", "min", "next", "object", "oct", "ord", "pow",
            "property", "range", "repr", "reversed", "round", "set", "setattr",
            "slice", "sorted", "staticmethod", "sum", "super", "tuple", "type",
            "vars", "zip", "__import__"
        ]

        matches = sorted(set(n for n in all_names if n.startswith(prefix)))
        return {
            "matches": matches,
            "cursor_start": cursor_pos - len(prefix),
            "cursor_end": cursor_pos
        }

    def get_kernel_info(self) -> Dict[str, Any]:
        return {
            "language": "python",
            "name": self.kernel_name,
            "version": "3.x",
            "execution_count": self._execution_count,
            "variable_count": len(self._variables)
        }

    def interrupt(self):
        logger.info("Interrupting kernel...")
