"""Task Manager - VS Code style tasks.json support."""

import os
import json
import subprocess
import threading
from typing import List, Dict, Optional
from PySide6.QtCore import QObject, Signal


class TaskDefinition:
    def __init__(self, data: dict):
        self.label = data.get("label", "Unnamed Task")
        self.type = data.get("type", "shell")
        self.command = data.get("command", "")
        self.args = data.get("args", [])
        self.group = data.get("group", {})
        if isinstance(self.group, str):
            self.group = {"kind": self.group}
        self.is_background = data.get("isBackground", False)
        self.presentation = data.get("presentation", {})
        self.problem_matcher = data.get("problemMatcher", [])
        self._raw = data


class TaskManager(QObject):
    """Parses tasks.json and manages execution of tasks."""

    task_started = Signal(str)  # label
    task_finished = Signal(str, int)  # label, exit_code
    task_output = Signal(str, str)  # label, output_line

    def __init__(self, workspace_path: str, parent=None):
        super().__init__(parent)
        self._workspace = workspace_path
        self._tasks: List[TaskDefinition] = []
        self._running_processes: Dict[str, subprocess.Popen] = {}
        self.reload_tasks()

    def set_workspace(self, workspace_path: str):
        self._workspace = workspace_path
        self.reload_tasks()

    def reload_tasks(self):
        self._tasks.clear()
        if not self._workspace:
            return
        
        tasks_file = os.path.join(self._workspace, ".vscode", "tasks.json")
        if not os.path.exists(tasks_file):
            return

        try:
            with open(tasks_file, "r", encoding="utf-8") as f:
                content = f.read()
                # Strip simple comments
                lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                data = json.loads("\n".join(lines))
                
            for t_data in data.get("tasks", []):
                self._tasks.append(TaskDefinition(t_data))
        except Exception as e:
            import logging
            logging.error(f"Failed to load tasks.json: {e}")

    def get_tasks(self) -> List[TaskDefinition]:
        return self._tasks

    def get_build_tasks(self) -> List[TaskDefinition]:
        return [t for t in self._tasks if t.group.get("kind") == "build"]

    def get_test_tasks(self) -> List[TaskDefinition]:
        return [t for t in self._tasks if t.group.get("kind") == "test"]

    def run_task(self, task: TaskDefinition):
        if task.label in self._running_processes:
            return  # Already running

        cmd = [task.command] + task.args
        if task.type == "shell":
            # Flatten for shell execution
            cmd = " ".join([task.command] + task.args)

        self.task_started.emit(task.label)
        
        def _runner():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000
                
                process = subprocess.Popen(
                    cmd,
                    cwd=self._workspace,
                    shell=(task.type == "shell"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    **kwargs
                )
                self._running_processes[task.label] = process

                for line in process.stdout:
                    self.task_output.emit(task.label, line.rstrip("\n"))
                
                process.wait()
                rc = process.returncode
                self._running_processes.pop(task.label, None)
                self.task_finished.emit(task.label, rc)

            except Exception as e:
                self.task_output.emit(task.label, f"Error: {e}")
                self._running_processes.pop(task.label, None)
                self.task_finished.emit(task.label, 1)

        threading.Thread(target=_runner, daemon=True).start()

    def terminate_task(self, label: str):
        if label in self._running_processes:
            proc = self._running_processes[label]
            try:
                proc.terminate()
            except Exception as e:
                import logging
                logging.error(f"Failed to terminate task {label}: {e}")

    def create_default_tasks(self):
        """Creates a default tasks.json if it doesn't exist."""
        if not self._workspace:
            return
            
        vscode_dir = os.path.join(self._workspace, ".vscode")
        os.makedirs(vscode_dir, exist_ok=True)
        tasks_file = os.path.join(vscode_dir, "tasks.json")
        
        if not os.path.exists(tasks_file):
            default_data = {
                "version": "2.0.0",
                "tasks": [
                    {
                        "label": "Echo Workspace",
                        "type": "shell",
                        "command": "echo",
                        "args": ["Workspace is ${workspaceFolder}"],
                        "group": {
                            "kind": "build",
                            "isDefault": True
                        }
                    }
                ]
            }
            with open(tasks_file, "w", encoding="utf-8") as f:
                json.dump(default_data, f, indent=4)
            self.reload_tasks()
