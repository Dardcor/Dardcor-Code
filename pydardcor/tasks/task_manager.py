"""Task Manager - VS Code style tasks.json support with auto-detection, variable substitution, and compound tasks."""

import os
import json
import re
import subprocess
import threading
import shlex
import glob
from typing import List, Dict, Optional, Any, Tuple
from pathlib import Path
from PySide6.QtCore import QObject, Signal


VARIABLE_PATTERN = re.compile(r'\$\{([^}]+)\}')


def resolve_variables(text: str, variables: Dict[str, str]) -> str:
    """Resolve VS Code style ${variable} placeholders."""
    def _replacer(m):
        var = m.group(1)
        val = variables.get(var)
        if val is not None:
            return val
        env_val = os.environ.get(var)
        if env_val is not None:
            return env_val
        return m.group(0)
    return VARIABLE_PATTERN.sub(_replacer, text)


def get_variable_context(workspace_path: str = "", active_file: str = "", active_line: int = 1, selected_text: str = "") -> Dict[str, str]:
    """Build the variable substitution context dictionary."""
    ctx = {}
    ws = workspace_path or ""
    ctx["workspaceFolder"] = ws
    ctx["workspaceFolderBasename"] = os.path.basename(ws) if ws else ""
    ctx["userHome"] = os.path.expanduser("~")
    ctx["pathSeparator"] = os.sep
    ctx["cwd"] = os.getcwd()
    if active_file:
        fpath = active_file
        ctx["file"] = fpath
        ctx["fileBasename"] = os.path.basename(fpath)
        ctx["fileDirname"] = os.path.dirname(fpath)
        name, ext = os.path.splitext(os.path.basename(fpath))
        ctx["fileBasenameNoExtension"] = name
        ctx["fileExtname"] = ext
        if ws:
            try:
                ctx["relativeFile"] = os.path.relpath(fpath, ws)
            except ValueError:
                ctx["relativeFile"] = fpath
            ctx["relativeFileDirname"] = os.path.dirname(ctx["relativeFile"])
        ctx["lineNumber"] = str(active_line)
        ctx["selectedText"] = selected_text
    return ctx


def parse_json_with_comments(text: str) -> dict:
    """Strip JS-style comments from JSON and parse."""
    result = []
    in_string = False
    in_line_comment = False
    in_block_comment = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == '\\' and i + 1 < len(text):
                result.append(ch)
                result.append(text[i + 1])
                i += 2
                continue
            elif ch == '"':
                in_string = False
            result.append(ch)
            i += 1
            continue
        if in_line_comment:
            if ch == '\n':
                in_line_comment = False
                result.append(ch)
            i += 1
            continue
        if in_block_comment:
            if ch == '*' and i + 1 < len(text) and text[i + 1] == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if ch == '"':
            in_string = True
            result.append(ch)
            i += 1
            continue
        if ch == '/' and i + 1 < len(text):
            if text[i + 1] == '/':
                in_line_comment = True
                i += 2
                continue
            elif text[i + 1] == '*':
                in_block_comment = True
                i += 2
                continue
        result.append(ch)
        i += 1
    return json.loads("".join(result))


def write_json_with_comments(data: dict) -> str:
    """Write tasks.json with VS Code style comments."""
    return json.dumps(data, indent=4)


class TaskShellConfiguration:
    """Shell configuration for a task (type: shell)."""
    def __init__(self, data: dict):
        self.executable: Optional[str] = data.get("executable")
        self.args: List[str] = data.get("args", [])
        self.env: Dict[str, str] = data.get("env", {})
        self.cwd: Optional[str] = data.get("cwd")


class TaskPresentationOptions:
    """Presentation options for task output."""
    def __init__(self, data: dict):
        self.echo: bool = data.get("echo", True)
        self.reveal: str = data.get("reveal", "always")
        self.focus: bool = data.get("focus", False)
        self.panel: str = data.get("panel", "shared")
        self.showReuseMessage: bool = data.get("showReuseMessage", True)
        self.clear: bool = data.get("clear", False)
        self.group: Optional[str] = data.get("group")

    def to_dict(self) -> dict:
        d = {}
        if not self.echo:
            d["echo"] = False
        if self.reveal != "always":
            d["reveal"] = self.reveal
        if self.focus:
            d["focus"] = True
        if self.panel != "shared":
            d["panel"] = self.panel
        if not self.showReuseMessage:
            d["showReuseMessage"] = False
        if self.clear:
            d["clear"] = True
        if self.group:
            d["group"] = self.group
        return d


class TaskGroup:
    """Task group (build/test)."""
    def __init__(self, data):
        if isinstance(data, str):
            self.kind = data
            self.is_default = False
        else:
            self.kind = data.get("kind", "")
            self.is_default = data.get("isDefault", False)

    def to_dict(self):
        if self.is_default:
            return {"kind": self.kind, "isDefault": True}
        return self.kind


class TaskRunOptions:
    """Run options for a task."""
    def __init__(self, data: dict):
        self.run_on: Optional[str] = data.get("runOn")


class TaskInput:
    """User input definition for tasks.json inputs section."""
    def __init__(self, data: dict):
        self.id: str = data.get("id", "")
        self.type: str = data.get("type", "promptString")
        self.description: str = data.get("description", "")
        self.default: str = data.get("default", "")
        self.options: Dict[str, str] = data.get("options", {})
        self.command: Optional[str] = data.get("command")


class ProblemMatcherConfig:
    """Problem matcher reference for a task."""
    def __init__(self, data):
        if isinstance(data, str):
            self.name = data
            self.owner = ""
            self.severity = ""
            self.file_location = ""
            self.pattern = None
            self.background = None
        else:
            self.name = data.get("name", "")
            self.owner = data.get("owner", "")
            self.severity = data.get("severity", "")
            self.file_location = data.get("fileLocation", [])
            self.pattern = data.get("pattern")
            self.background = data.get("background")
            self.base = data.get("base", "")


class TaskDefinition:
    """Full VS Code task definition."""
    def __init__(self, data: dict, inputs: Dict[str, TaskInput] = None):
        self._raw = data
        self.label: str = data.get("label", "Unnamed Task")
        self.type: str = data.get("type", "shell")
        self.command: str = data.get("command", "")
        self.args: List[str] = data.get("args", [])
        self.options: Optional[dict] = data.get("options")
        self.shell_config: Optional[TaskShellConfiguration] = None
        if self.options:
            self.shell_config = TaskShellConfiguration(self.options) if self.options.get("executable") else None
        self.presentation: TaskPresentationOptions = TaskPresentationOptions(data.get("presentation", {}))
        group_data = data.get("group", {})
        self.group: Optional[TaskGroup] = None
        if group_data:
            self.group = TaskGroup(group_data)
        self.is_background: bool = data.get("isBackground", False)
        self.is_watching: bool = data.get("isBackground", False)
        self.problem_matcher: List[Any] = data.get("problemMatcher", [])
        if isinstance(self.problem_matcher, (str, dict)):
            self.problem_matcher = [self.problem_matcher]
        self.problem_matcher_configs: List[ProblemMatcherConfig] = []
        for pm in self.problem_matcher:
            self.problem_matcher_configs.append(ProblemMatcherConfig(pm))
        self.depends_on: List[str] = data.get("dependsOn", [])
        if isinstance(self.depends_on, str):
            self.depends_on = [self.depends_on]
        self.depends_order: str = data.get("dependsOrder", "sequence")
        self.run_options: Optional[TaskRunOptions] = None
        if "runOptions" in data:
            self.run_options = TaskRunOptions(data["runOptions"])
        self.detail: str = data.get("detail", "")
        self.icon: Optional[dict] = data.get("icon")
        self.hide: bool = data.get("hide", False)
        self.prompt: Optional[bool] = data.get("prompt")
        self.inputs: Dict[str, TaskInput] = inputs or {}

    def get_resolved_command(self, var_context: Dict[str, str]) -> str:
        """Get the full command string with variables resolved."""
        cmd = self.command
        if var_context:
            cmd = resolve_variables(cmd, var_context)
            resolved_args = [resolve_variables(a, var_context) for a in self.args]
        else:
            resolved_args = list(self.args)

        if self.type == "shell":
            return " ".join([cmd] + resolved_args)
        else:
            parts = [cmd] + resolved_args
            return parts

    def get_resolved_args(self, var_context: Dict[str, str]) -> List[str]:
        return [resolve_variables(a, var_context) for a in self.args]

    def to_dict(self) -> dict:
        d = {"label": self.label}
        if self.type != "shell":
            d["type"] = self.type
        d["command"] = self.command
        if self.args:
            d["args"] = self.args
        if self.group:
            d["group"] = self.group.to_dict()
        if self.is_background:
            d["isBackground"] = True
        pres = self.presentation.to_dict()
        if pres:
            d["presentation"] = pres
        if self.depends_on:
            d["dependsOn"] = self.depends_on
        if self.depends_order != "sequence":
            d["dependsOrder"] = self.depends_order
        if self.detail:
            d["detail"] = self.detail
        if self.hide:
            d["hide"] = True
        if self.options:
            d["options"] = self.options
        if self.problem_matcher:
            d["problemMatcher"] = self.problem_matcher
        if self.run_options:
            d["runOptions"] = {"runOn": self.run_options.run_on}
        return d


class AutoDetectedTask:
    """Represents a task auto-detected from project files."""
    def __init__(self, source: str, label: str, command: str, args: List[str] = None,
                 group: str = "", detail: str = ""):
        self.source = source
        self.label = label
        self.command = command
        self.args = args or []
        self.group = group
        self.detail = detail

    def to_task_definition(self, workspace_path: str) -> dict:
        d = {
            "label": self.label,
            "type": "shell",
            "command": self.command,
            "args": self.args,
            "detail": self.detail or f"Auto-detected from {self.source}",
        }
        if self.group:
            d["group"] = self.group
        return d


def auto_detect_npm_tasks(workspace_path: str) -> List[AutoDetectedTask]:
    """Auto-detect npm scripts from package.json."""
    tasks = []
    pkg_json = os.path.join(workspace_path, "package.json")
    if os.path.isfile(pkg_json):
        try:
            with open(pkg_json, "r", encoding="utf-8") as f:
                pkg = json.load(f)
            scripts = pkg.get("scripts", {})
            for name, cmd in scripts.items():
                detail = f"npm script: {cmd}"
                if name in ("build", "compile", "bundle"):
                    group = "build"
                elif name in ("test", "coverage"):
                    group = "test"
                else:
                    group = ""
                tasks.append(AutoDetectedTask(
                    source="npm",
                    label=f"npm: {name}",
                    command="npm",
                    args=["run", name],
                    group=group,
                    detail=detail,
                ))
        except Exception:
            pass
    return tasks


def auto_detect_pipenv_tasks(workspace_path: str) -> List[AutoDetectedTask]:
    """Auto-detect pipenv scripts from Pipfile."""
    tasks = []
    pipfile = os.path.join(workspace_path, "Pipfile")
    if os.path.isfile(pipfile):
        try:
            import configparser
            config = configparser.ConfigParser()
            config.read(pipfile)
            scripts = config.get("scripts", {}) if config.has_section("scripts") else {}
            if isinstance(scripts, dict):
                for name, cmd in scripts.items():
                    tasks.append(AutoDetectedTask(
                        source="pipenv",
                        label=f"pipenv: {name}",
                        command="pipenv",
                        args=["run", name],
                        group="build" if name in ("build",) else "",
                        detail=f"pipenv script: {cmd}",
                    ))
        except Exception:
            pass
    return tasks


def auto_detect_msbuild_tasks(workspace_path: str) -> List[AutoDetectedTask]:
    """Auto-detect MSBuild targets from .csproj files."""
    tasks = []
    csproj_files = glob.glob(os.path.join(workspace_path, "*.csproj"))
    if csproj_files:
        tasks.append(AutoDetectedTask(
            source="msbuild",
            label="build",
            command="dotnet",
            args=["build"],
            group="build",
            detail="Build the .NET project",
        ))
    return tasks


def auto_detect_grunt_tasks(workspace_path: str) -> List[AutoDetectedTask]:
    tasks = []
    gf = os.path.join(workspace_path, "Gruntfile.js")
    if os.path.isfile(gf):
        tasks.append(AutoDetectedTask(
            source="grunt",
            label="grunt: default",
            command="npx",
            args=["grunt"],
            group="build",
            detail="Run grunt default task",
        ))
    return tasks


def auto_detect_gulp_tasks(workspace_path: str) -> List[AutoDetectedTask]:
    tasks = []
    gf = os.path.join(workspace_path, "gulpfile.js")
    if os.path.isfile(gf):
        tasks.append(AutoDetectedTask(
            source="gulp",
            label="gulp: default",
            command="npx",
            args=["gulp"],
            group="build",
            detail="Run gulp default task",
        ))
    return tasks


def auto_detect_makefile_tasks(workspace_path: str) -> List[AutoDetectedTask]:
    tasks = []
    for mf_name in ("Makefile", "makefile", "GNUmakefile"):
        if os.path.isfile(os.path.join(workspace_path, mf_name)):
            tasks.append(AutoDetectedTask(
                source="make",
                label="make: all",
                command="make",
                args=[],
                group="build",
                detail="Run make all",
            ))
            break
    return tasks


def auto_detect_all(workspace_path: str) -> List[AutoDetectedTask]:
    """Run all auto-detection providers."""
    tasks = []
    tasks.extend(auto_detect_npm_tasks(workspace_path))
    tasks.extend(auto_detect_pipenv_tasks(workspace_path))
    tasks.extend(auto_detect_msbuild_tasks(workspace_path))
    tasks.extend(auto_detect_grunt_tasks(workspace_path))
    tasks.extend(auto_detect_gulp_tasks(workspace_path))
    tasks.extend(auto_detect_makefile_tasks(workspace_path))
    return tasks


class TaskManager(QObject):
    """Parses tasks.json, auto-detects tasks, and manages execution of tasks."""

    task_started = Signal(str)
    task_finished = Signal(str, int)
    task_output = Signal(str, str)
    task_problem = Signal(dict)

    def __init__(self, workspace_path: str, parent=None):
        super().__init__(parent)
        self._workspace = workspace_path
        self._tasks: List[TaskDefinition] = []
        self._auto_detected: List[AutoDetectedTask] = []
        self._running_processes: Dict[str, subprocess.Popen] = {}
        self._running_tasks: Dict[str, TaskDefinition] = {}
        self._inputs: Dict[str, TaskInput] = {}
        self._var_context: Dict[str, str] = {}
        self._background_watchers: Dict[str, threading.Thread] = {}
        self._active_file: str = ""
        self._active_line: int = 1
        self._selected_text: str = ""
        self.reload_tasks()

    def set_workspace(self, workspace_path: str):
        self._workspace = workspace_path
        self.reload_tasks()

    def set_active_file_context(self, file_path: str = "", line: int = 1, selected: str = ""):
        self._active_file = file_path
        self._active_line = line
        self._selected_text = selected

    def get_var_context(self) -> Dict[str, str]:
        return get_variable_context(self._workspace, self._active_file, self._active_line, self._selected_text)

    def reload_tasks(self):
        self._tasks.clear()
        self._auto_detected.clear()
        self._inputs.clear()
        if not self._workspace:
            return

        tasks_file = os.path.join(self._workspace, ".vscode", "tasks.json")
        if os.path.exists(tasks_file):
            try:
                with open(tasks_file, "r", encoding="utf-8") as f:
                    content = f.read()
                data = parse_json_with_comments(content)

                inputs_data = data.get("inputs", [])
                for inp in inputs_data:
                    inp_obj = TaskInput(inp)
                    self._inputs[inp_obj.id] = inp_obj

                for t_data in data.get("tasks", []):
                    self._tasks.append(TaskDefinition(t_data, self._inputs))

                self._process_compound_tasks(data)
            except Exception as e:
                import logging
                logging.error(f"Failed to load tasks.json: {e}")

        self._auto_detected = auto_detect_all(self._workspace)

    def _process_compound_tasks(self, data: dict):
        """Process compound tasks (dependsOn at top level)."""
        compounds = data.get("compoundTasks", [])
        for ct in compounds:
            if isinstance(ct, dict):
                label = ct.get("label", "")
                depends_on = ct.get("dependsOn", [])
                if label and depends_on:
                    existing = next((t for t in self._tasks if t.label == label), None)
                    if existing:
                        existing.depends_on = depends_on
                        existing.depends_order = ct.get("dependsOrder", "sequence")

    def save_tasks(self):
        """Write current tasks back to tasks.json."""
        if not self._workspace:
            return
        vscode_dir = os.path.join(self._workspace, ".vscode")
        os.makedirs(vscode_dir, exist_ok=True)
        tasks_file = os.path.join(vscode_dir, "tasks.json")

        data = {
            "version": "2.0.0",
            "tasks": [t.to_dict() for t in self._tasks],
        }
        if self._inputs:
            data["inputs"] = [
                {"id": inp.id, "type": inp.type, "description": inp.description,
                 "default": inp.default}
                for inp in self._inputs.values()
            ]
        with open(tasks_file, "w", encoding="utf-8") as f:
            f.write(write_json_with_comments(data))

    def get_tasks(self) -> List[TaskDefinition]:
        """Return configured tasks (from tasks.json)."""
        return self._tasks

    def get_all_tasks(self) -> List[dict]:
        """Return all available tasks (configured + auto-detected), as serializable dicts."""
        result = []
        for t in self._tasks:
            d = t.to_dict()
            d["source"] = "tasks.json"
            result.append(d)
        for ad in self._auto_detected:
            d = ad.to_task_definition(self._workspace)
            d["source"] = ad.source
            d["_auto_detected"] = True
            result.append(d)
        return result

    def get_task_by_label(self, label: str) -> Optional[TaskDefinition]:
        for t in self._tasks:
            if t.label == label:
                return t
        for ad in self._auto_detected:
            if ad.label == label:
                d = ad.to_task_definition(self._workspace)
                return TaskDefinition(d, self._inputs)
        return None

    def get_build_tasks(self) -> List[TaskDefinition]:
        return [t for t in self._tasks if t.group and t.group.kind == "build"]

    def get_test_tasks(self) -> List[TaskDefinition]:
        return [t for t in self._tasks if t.group and t.group.kind == "test"]

    def get_auto_detected_tasks(self) -> List[dict]:
        return [ad.to_task_definition(self._workspace) for ad in self._auto_detected]

    def add_task(self, data: dict) -> TaskDefinition:
        td = TaskDefinition(data, self._inputs)
        self._tasks.append(td)
        self.save_tasks()
        return td

    def remove_task(self, label: str) -> bool:
        for i, t in enumerate(self._tasks):
            if t.label == label:
                self._tasks.pop(i)
                self.save_tasks()
                return True
        return False

    def run_task(self, task: TaskDefinition, on_input_request=None):
        """Run a task, handling dependsOn, compound, and inputs."""
        if task.label in self._running_tasks:
            return

        var_context = self.get_var_context()

        if task.depends_on:
            self._run_depends_chain(task, var_context, on_input_request)
            return

        if task.is_background:
            self._start_background_task(task, var_context)
            return

        self._execute_task(task, var_context)

    def _collect_input_values(self, task: TaskDefinition, on_input_request=None) -> Optional[Dict[str, str]]:
        """Collect input values for any ${input:xxx} variables in the task."""
        values = {}
        var_context = self.get_var_context()

        def find_input_refs(text: str) -> List[str]:
            return re.findall(r'\$\{input:([^}]+)\}', text)

        texts_to_check = [task.command] + task.args + [task.detail]
        if task.options:
            texts_to_check.append(str(task.options))

        input_ids = set()
        for text in texts_to_check:
            if isinstance(text, str):
                for rid in find_input_refs(text):
                    input_ids.add(rid)

        for inp_id in input_ids:
            inp = self._inputs.get(inp_id)
            if not inp:
                continue
            if on_input_request:
                value = on_input_request(inp)
                if value is None:
                    value = inp.default
                values[inp_id] = value
            else:
                values[inp_id] = inp.default
        return values

    def _run_depends_chain(self, task: TaskDefinition, var_context: Dict[str, str], on_input_request=None):
        """Run task dependencies before the task itself."""
        deps = task.depends_on
        order = task.depends_order or "sequence"

        if order == "parallel":
            threads = []
            for dep_label in deps:
                dep_task = self.get_task_by_label(dep_label)
                if dep_task and dep_task.label not in self._running_tasks:
                    self.task_output.emit(task.label, f"[dependsOn] Starting dependency: {dep_label}")
                    t = threading.Thread(target=self._execute_task, args=(dep_task, var_context), daemon=True)
                    t.start()
                    threads.append(t)
            for t in threads:
                t.join()
            self.task_output.emit(task.label, f"[dependsOn] All dependencies completed, running: {task.label}")
            self._execute_task(task, var_context)
        else:
            self._run_deps_sequential(deps, task, var_context, on_input_request, 0)

    def _run_deps_sequential(self, deps: List[str], task: TaskDefinition,
                              var_context: Dict[str, str], on_input_request, idx: int):
        if idx >= len(deps):
            self._execute_task(task, var_context)
            return
        dep_label = deps[idx]
        dep_task = self.get_task_by_label(dep_label)
        if not dep_task:
            self.task_output.emit(task.label, f"[dependsOn] Dependency not found: {dep_label}")
            self._run_deps_sequential(deps, task, var_context, on_input_request, idx + 1)
            return
        self.task_output.emit(task.label, f"[dependsOn] Running dependency: {dep_label}")

        original_finished = dep_task.label
        def on_dep_finished(label: str, rc: int):
            if label == dep_label:
                try:
                    self.task_finished.disconnect(on_dep_finished)
                except TypeError:
                    pass
                self._run_deps_sequential(deps, task, var_context, on_input_request, idx + 1)

        self.task_finished.connect(on_dep_finished)
        self._execute_task(dep_task, var_context)

    def _execute_task(self, task: TaskDefinition, var_context: Dict[str, str]):
        """Execute a single task (no dependency handling)."""
        cmd_parts = task.get_resolved_command(var_context)

        self.task_started.emit(task.label)
        self._running_tasks[task.label] = task

        def _runner():
            try:
                kwargs = {}
                if os.name == 'nt':
                    kwargs['creationflags'] = 0x08000000

                env = None
                cwd = self._workspace
                shell = True if task.type == "shell" else False

                if task.shell_config:
                    if task.shell_config.cwd:
                        cwd = resolve_variables(task.shell_config.cwd, var_context)
                    if task.shell_config.env:
                        env = os.environ.copy()
                        for k, v in task.shell_config.env.items():
                            env[k] = resolve_variables(v, var_context)

                if task.type == "shell" and isinstance(cmd_parts, list):
                    cmd = " ".join(cmd_parts)
                elif isinstance(cmd_parts, list):
                    cmd = cmd_parts
                elif isinstance(cmd_parts, str):
                    cmd = cmd_parts
                else:
                    cmd = str(cmd_parts)

                process = subprocess.Popen(
                    cmd,
                    cwd=cwd,
                    shell=shell,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    **kwargs
                )
                self._running_processes[task.label] = process

                for line in process.stdout:
                    self.task_output.emit(task.label, line.rstrip("\n"))

                process.wait()
                rc = process.returncode
                self._running_processes.pop(task.label, None)
                self._running_tasks.pop(task.label, None)
                self.task_finished.emit(task.label, rc)

            except Exception as e:
                self.task_output.emit(task.label, f"Error: {e}")
                self._running_processes.pop(task.label, None)
                self._running_tasks.pop(task.label, None)
                self.task_finished.emit(task.label, 1)

        threading.Thread(target=_runner, daemon=True).start()

    def _start_background_task(self, task: TaskDefinition, var_context: Dict[str, str]):
        """Start a background/watching task."""
        cmd = task.get_resolved_command(var_context)
        self.task_started.emit(task.label)
        self._running_tasks[task.label] = task

        def _bg_runner():
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
                self._background_watchers[task.label] = threading.current_thread()

                for line in process.stdout:
                    self.task_output.emit(task.label, line.rstrip("\n"))

                process.wait()
                rc = process.returncode
                self._running_processes.pop(task.label, None)
                self._running_tasks.pop(task.label, None)
                self._background_watchers.pop(task.label, None)
                self.task_finished.emit(task.label, rc)
            except Exception as e:
                self.task_output.emit(task.label, f"Error: {e}")
                self._running_processes.pop(task.label, None)
                self._running_tasks.pop(task.label, None)
                self._background_watchers.pop(task.label, None)
                self.task_finished.emit(task.label, 1)

        t = threading.Thread(target=_bg_runner, daemon=True)
        t.start()
        self._background_watchers[task.label] = t

    def rerun_task(self, label: str):
        """Re-run a previously finished task."""
        task = self._running_tasks.get(label)
        if task:
            self.terminate_task(label)
        task_def = self.get_task_by_label(label)
        if task_def:
            self.run_task(task_def)

    def terminate_task(self, label: str):
        proc = self._running_processes.get(label)
        if proc:
            try:
                proc.terminate()
            except Exception as e:
                import logging
                logging.error(f"Failed to terminate task {label}: {e}")
            self._running_processes.pop(label, None)
            self._running_tasks.pop(label, None)
            self._background_watchers.pop(label, None)

    def terminate_all(self):
        for label in list(self._running_processes.keys()):
            self.terminate_task(label)

    def is_task_running(self, label: str) -> bool:
        return label in self._running_tasks

    def get_running_tasks(self) -> List[str]:
        return list(self._running_tasks.keys())

    def create_default_tasks(self):
        """Creates a default tasks.json if it doesn't exist."""
        if not self._workspace:
            return
        vscode_dir = os.path.join(self._workspace, ".vscode")
        os.makedirs(vscode_dir, exist_ok=True)
        tasks_file = os.path.join(vscode_dir, "tasks.json")
        if not os.path.exists(tasks_file):
            self._tasks = []
            default_task = TaskDefinition({
                "label": "Echo Workspace",
                "type": "shell",
                "command": "echo",
                "args": ["Workspace is ${workspaceFolder}"],
                "group": {
                    "kind": "build",
                    "isDefault": True
                }
            })
            self._tasks.append(default_task)
            self.save_tasks()
            self.reload_tasks()
