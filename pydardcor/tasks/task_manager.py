import os
import json
import logging
import subprocess
import threading
from typing import Dict, List, Optional, Callable

logger = logging.getLogger(__name__)

class TaskManager:
    """Manages parsing and running workspace tasks (.vscode/tasks.json)."""

    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self.tasks: List[dict] = []
        self._running_tasks: Dict[str, subprocess.Popen] = {}
        self.on_task_output: List[Callable[[str, str], None]] = []
        self.on_task_end: List[Callable[[str, int], None]] = []

    def load_tasks(self):
        """Load tasks from .vscode/tasks.json."""
        tasks_path = os.path.join(self.workspace_path, ".vscode", "tasks.json")
        if not os.path.exists(tasks_path):
            self.tasks = []
            return

        try:
            with open(tasks_path, 'r', encoding='utf-8') as f:
                content = f.read()
                # Simple comment removal (real implementation needs full jsonc parser)
                lines = [line for line in content.split('\n') if not line.strip().startswith('//')]
                data = json.loads('\n'.join(lines))
                
                self.tasks = data.get("tasks", [])
                logger.info(f"Loaded {len(self.tasks)} tasks from {tasks_path}")
        except Exception as e:
            logger.error(f"Failed to load tasks.json: {e}")
            self.tasks = []

    def get_tasks(self) -> List[dict]:
        return self.tasks

    def get_task(self, label: str) -> Optional[dict]:
        for t in self.tasks:
            if t.get("label") == label:
                return t
        return None

    def run_task(self, label: str) -> bool:
        """Run a task by its label."""
        task = self.get_task(label)
        if not task:
            logger.error(f"Task not found: {label}")
            return False

        if label in self._running_tasks:
            logger.warning(f"Task {label} is already running")
            return False

        command = task.get("command")
        args = task.get("args", [])
        
        if not command:
            logger.error(f"Task {label} has no command")
            return False

        # In a real implementation we would handle "type": "shell" vs "process"
        cmd_list = [command] + args
        
        cwd = task.get("options", {}).get("cwd", self.workspace_path)
        cwd = cwd.replace("${workspaceFolder}", self.workspace_path)

        try:
            process = subprocess.Popen(
                cmd_list,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                shell=task.get("type") == "shell"
            )
            
            self._running_tasks[label] = process
            
            # Start reader thread
            threading.Thread(target=self._read_task_output, args=(label, process), daemon=True).start()
            return True
            
        except Exception as e:
            logger.error(f"Failed to start task {label}: {e}")
            return False

    def _read_task_output(self, label: str, process: subprocess.Popen):
        try:
            for line in process.stdout:
                for callback in self.on_task_output:
                    callback(label, line)
                    
            process.wait()
            exit_code = process.returncode
            
            for callback in self.on_task_end:
                callback(label, exit_code)
                
        except Exception as e:
            logger.error(f"Error reading task output: {e}")
        finally:
            if label in self._running_tasks:
                del self._running_tasks[label]

    def stop_task(self, label: str):
        """Stop a running task."""
        if label in self._running_tasks:
            process = self._running_tasks[label]
            if process.poll() is None:
                process.terminate()
