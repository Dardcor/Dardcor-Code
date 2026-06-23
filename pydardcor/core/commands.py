"""Command execution engine for Dardcor Code terminal."""

import os
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class CommandResult:
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    timed_out: bool = False
    command: str = ""


class CommandExecutor:
    """Execute shell commands with streaming output support."""

    def __init__(self):
        self._processes = []

    def execute(
        self,
        command: str,
        workdir: str = None,
        timeout: int = 60,
        on_stdout: Callable[[str], None] = None,
        on_stderr: Callable[[str], None] = None,
        env: dict = None,
    ) -> CommandResult:
        result = CommandResult(command=command)

        if workdir and not os.path.isdir(workdir):
            workdir = None

        if os.name == 'nt':
            shell = False
            shell_cmd = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command]
        else:
            shell = True
            shell_cmd = command

        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)

        popen_kwargs = {
            "shell": shell,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "cwd": workdir,
            "env": merged_env,
            "text": True,
            "errors": "replace",
            "bufsize": 1,
        }
        if os.name == 'nt':
            popen_kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
        try:
            process = subprocess.Popen(
                shell_cmd,
                **popen_kwargs
            )
            self._processes.append(process)

            stdout_lines = []
            stderr_lines = []

            def read_stdout():
                try:
                    for line in iter(process.stdout.readline, ""):
                        stdout_lines.append(line)
                        if on_stdout:
                            on_stdout(line)
                except Exception:
                    pass

            def read_stderr():
                try:
                    for line in iter(process.stderr.readline, ""):
                        stderr_lines.append(line)
                        if on_stderr:
                            on_stderr(line)
                except Exception:
                    pass

            t1 = threading.Thread(target=read_stdout, daemon=True)
            t2 = threading.Thread(target=read_stderr, daemon=True)
            t1.start()
            t2.start()

            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                result.timed_out = True

            t1.join(timeout=2)
            t2.join(timeout=2)

            result.stdout = "".join(stdout_lines)
            result.stderr = "".join(stderr_lines)
            result.exit_code = process.returncode or 0

            if process in self._processes:
                self._processes.remove(process)

        except FileNotFoundError:
            result.stderr = f"Command not found: {command}"
            result.exit_code = 127
        except Exception as e:
            result.stderr = str(e)
            result.exit_code = 1

        return result

    def kill_all(self):
        for p in self._processes[:]:
            try:
                p.kill()
            except Exception:
                pass
        self._processes.clear()
