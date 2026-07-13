"""Interactive Code Execution for AI — run Python/JS snippets and return results."""

from __future__ import annotations

import sys
import io
import textwrap
import threading
from PySide6.QtCore import QObject, Signal


class InteractiveExecutor(QObject):
    """Execute code snippets interactively and return results to the AI."""

    result_ready = Signal(str, str)
    execution_error = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)

    def execute_python(self, code: str):
        """Execute Python code and capture stdout/stderr."""
        threading.Thread(target=self._run_python, args=(code,), daemon=True).start()

    def _run_python(self, code: str):
        try:
            old_stdout = sys.stdout
            old_stderr = sys.stderr
            sys.stdout = io.StringIO()
            sys.stderr = io.StringIO()

            try:
                compiled = compile(textwrap.dedent(code), "<interactive>", "exec")
                exec(compiled, {"__builtins__": __builtins__})
                stdout = sys.stdout.getvalue()
                stderr = sys.stderr.getvalue()
            except Exception as e:
                stdout = sys.stdout.getvalue()
                stderr = sys.stderr.getvalue() + str(e)
            finally:
                sys.stdout = old_stdout
                sys.stderr = old_stderr

            result = stdout
            if stderr:
                result += f"\n[stderr]\n{stderr}"
            self.result_ready.emit(code, result.strip() if result.strip() else "(no output)")

        except Exception as e:
            self.execution_error.emit(str(e))

    def execute_javascript(self, code: str):
        """Execute JavaScript code using Node.js."""
        threading.Thread(target=self._run_js, args=(code,), daemon=True).start()

    def _run_js(self, code: str):
        try:
            import subprocess
            proc = subprocess.run(
                ["node", "-e", code],
                capture_output=True,
                text=True,
                timeout=10,
            )
            result = proc.stdout
            if proc.stderr:
                result += f"\n[stderr]\n{proc.stderr}"
            self.result_ready.emit(code, result.strip() or "(no output)")
        except FileNotFoundError:
            self.execution_error.emit("Node.js not found. Install Node.js to run JavaScript.")
        except subprocess.TimeoutExpired:
            self.execution_error.emit("JavaScript execution timed out.")
        except Exception as e:
            self.execution_error.emit(str(e))
