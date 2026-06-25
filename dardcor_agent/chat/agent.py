"""AI Agent engine for Dardcor Code."""

import os
import sys
import json
import threading
from typing import Callable, Optional, List, Dict, Any

from pydardcor.core.config import get_config, AppConfig
from .memory import Conversation, ConversationStore, Message, CoreMemory, ArchivalMemory
from .identity import get_identity_prompt
from pydardcor.core.commands import CommandExecutor, CommandResult
from pydardcor.core.filesystem import FileSystem

# Patch QMetaObject.invokeMethod for PySide6 compatibility with callables
import PySide6.QtCore
if not hasattr(PySide6.QtCore.QMetaObject, "_original_invokeMethod"):
    PySide6.QtCore.QMetaObject._original_invokeMethod = PySide6.QtCore.QMetaObject.invokeMethod
    
    def _patched_invokeMethod(obj, member, *args, **kwargs):
        if callable(member):
            from PySide6.QtCore import Qt, QThread, QCoreApplication, QTimer
            import threading
            
            connection_type = Qt.BlockingQueuedConnection
            remaining_args = []
            for arg in args:
                if isinstance(arg, Qt.ConnectionType):
                    connection_type = arg
                else:
                    remaining_args.append(arg)
            
            app = QCoreApplication.instance()
            if app is None or QThread.currentThread() == app.thread():
                return member(*remaining_args, **kwargs)
            
            result_holder = [None]
            exception_holder = [None]
            event = threading.Event()
            
            def run_in_main_thread():
                try:
                    result_holder[0] = member(*remaining_args, **kwargs)
                except Exception as e:
                    exception_holder[0] = e
                finally:
                    event.set()
            
            QTimer.singleShot(0, run_in_main_thread)
            
            if connection_type == Qt.BlockingQueuedConnection:
                event.wait()
                if exception_holder[0] is not None:
                    raise exception_holder[0]
                return result_holder[0]
            return True
            
        return PySide6.QtCore.QMetaObject._original_invokeMethod(obj, member, *args, **kwargs)

    PySide6.QtCore.QMetaObject.invokeMethod = _patched_invokeMethod


# Tool definitions for the AI agent
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path to read"},
                    "start_line": {"type": "integer", "description": "Start line (1-indexed, optional)"},
                    "end_line": {"type": "integer", "description": "End line (1-indexed, optional)"}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file (creates or overwrites)",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path to write"},
                    "content": {"type": "string", "description": "Content to write"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Execute a shell command and return stdout+stderr. "
                "stdin is /dev/null so interactive prompts are auto-skipped. "
                "Default timeout 120s; pass timeout=300 for slow installs/builds. "
                "Use for: tests, package installs, builds, git ops, any CLI task. "
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run"},
                    "workdir": {"type": "string", "description": "Working directory (optional)"},
                    "timeout": {"type": "integer", "description": "Max seconds before kill (default 120)"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "Search file contents for a pattern (grep)",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Text to search for"},
                    "path": {"type": "string", "description": "Directory to search in"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in a directory",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path"},
                    "recursive": {"type": "boolean", "description": "List recursively"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "replace_file_content",
            "description": "Replace a single contiguous block of lines in a file. The targetContent must match the file content exactly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file"},
                    "targetContent": {"type": "string", "description": "The exact string content to be replaced"},
                    "replacementContent": {"type": "string", "description": "The new content to replace targetContent with"}
                },
                "required": ["path", "targetContent", "replacementContent"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "multi_replace_file_content",
            "description": "Perform multiple non-contiguous replacements in a single file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path to the file"},
                    "replacements": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "targetContent": {"type": "string", "description": "The exact string to be replaced"},
                                "replacementContent": {"type": "string", "description": "The new replacement content"}
                            },
                            "required": ["targetContent", "replacementContent"]
                        },
                        "description": "List of search and replacement chunks"
                    }
                },
                "required": ["path", "replacements"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for programming questions, library docs, or error messages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_url",
            "description": "Read text content from a web URL/page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "semantic_search",
            "description": "Perform a semantic keyword/TF-IDF search over the workspace files to find relevant code blocks.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query (e.g. 'settings dialog', 'terminal setup')"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "invoke_subagent",
            "description": "Invoke a specialized subagent to perform a task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_type": {"type": "string", "description": "Type of agent (e.g. 'browser')"},
                    "task": {"type": "string", "description": "The task for the subagent to complete"}
                },
                "required": ["agent_type", "task"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "manage_task",
            "description": "Manage background tasks (list, status, kill, send_input).",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description": "list, status, kill, or send_input"},
                    "task_id": {"type": "string", "description": "ID of the task (for status/kill/send_input)"},
                    "input_text": {"type": "string", "description": "Text to send (for send_input)"}
                },
                "required": ["action"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_core_memory",
            "description": "Update the core memory with permanent facts, user preferences, or project status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "The category (e.g. 'user_preferences', 'project_context')"},
                    "fact": {"type": "string", "description": "The fact to save permanently"}
                },
                "required": ["category", "fact"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_archival_memory",
            "description": "Search past conversations for historical context or previous discussions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query keywords"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "glob_files",
            "description": "Find files matching a glob pattern (e.g. '**/*.py', 'src/**/*.ts'). Returns matching paths relative to the base directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern, e.g. '**/*.py'"},
                    "path": {"type": "string", "description": "Base directory to search (default: workspace)"},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "grep",
            "description": "Search file contents with a regex pattern, with optional context lines and file-type filter. More powerful than search_files.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regex pattern to search for"},
                    "path": {"type": "string", "description": "Directory or file to search"},
                    "context_lines": {"type": "integer", "description": "Lines of context before/after each match (default 0)"},
                    "file_pattern": {"type": "string", "description": "Glob filter for files, e.g. '*.py'"},
                    "case_insensitive": {"type": "boolean", "description": "Case-insensitive match (default false)"},
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "apply_patch",
            "description": "Apply a unified diff patch to modify a file. The patch must be in standard --- / +++ unified diff format.",
            "parameters": {
                "type": "object",
                "properties": {
                    "patch": {"type": "string", "description": "Unified diff content (--- a/file +++ b/file @@ ... format)"},
                },
                "required": ["patch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_directory",
            "description": "Create a directory and all parent directories as needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Directory path to create"},
                },
                "required": ["path"],
            },
        },
    },
]


def _get_provider_url(provider: str, base_url: str) -> str:
    if base_url:
        return base_url
    urls = {
        "openai": "https://api.openai.com/v1",
        "anthropic": "https://api.anthropic.com/v1",
        "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
        "deepseek": "https://api.deepseek.com/v1",
        "openrouter": "https://openrouter.ai/api/v1",
        "ollama": "http://localhost:11434/v1",
        "nvidia": "https://integrate.api.nvidia.com/v1",
    }
    return urls.get(provider, "https://api.openai.com/v1")


class Agent:
    """AI Agent with tool-calling capabilities."""

    def __init__(self):
        self._config = get_config()
        self._conversation = Conversation()
        self._store = ConversationStore()
        self._core_memory = CoreMemory()
        self._archival_memory = ArchivalMemory(self._store)
        self._fs = FileSystem()
        self._cmd = CommandExecutor()
        self._stream_callback = None
        self.permission_callback = None
        self._lock = threading.Lock()
        self._abort_flag = False
        self._current_process = None

        # Add system message with Core Memory
        sys_prompt = self._config.ai.system_prompt if self._config.ai.system_prompt else get_identity_prompt(self._core_memory.get_summary())
        self._conversation.add_message("system", sys_prompt)

    @property
    def config(self) -> AppConfig:
        return self._config

    def set_workspace(self, path: str):
        """Called when the user opens a different folder mid-session."""
        if not path:
            return
        # Only inject if the conversation already has user messages (not at cold start)
        msgs = self._conversation.get_api_messages()
        has_user = any(m.get("role") == "user" for m in msgs)
        if has_user:
            self._conversation.add_message(
                "system",
                f"[WORKSPACE CHANGED] The user switched workspace to: {path}. "
                f"Use this directory for all file operations going forward."
            )

    def abort(self):
        self._abort_flag = True
        proc = self._current_process
        if proc and proc.poll() is None:
            try:
                if sys.platform == "win32":
                    import subprocess as _sub
                    _sub.call(
                        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        shell=False,
                        stdout=_sub.DEVNULL,
                        stderr=_sub.DEVNULL,
                    )
                else:
                    import os as _os, signal as _signal
                    try:
                        _os.killpg(_os.getpgid(proc.pid), _signal.SIGKILL)
                    except Exception:
                        proc.kill()
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

    def on_stream(self, callback: Callable[[str], None]):
        self._stream_callback = callback

    def new_conversation(self):
        has_user_message = any(m.role == "user" for m in self._conversation.messages)
        if has_user_message:
            self._store.save(self._conversation)
        self._conversation = Conversation()
        sys_prompt = self._config.ai.system_prompt if self._config.ai.system_prompt else get_identity_prompt(self._core_memory.get_summary())
        self._conversation.add_message("system", sys_prompt)

    def send_message(
        self,
        message: str,
        model_override: Optional[str] = None,
        on_tool_call: Optional[Callable[[str, str, str], None]] = None,
        on_system_message: Optional[Callable[[str], None]] = None,
        on_tool_output: Optional[Callable[[str, str], None]] = None,
    ) -> str:
        self._abort_flag = False
        with self._lock:
            self._conversation.add_message("user", message)

        try:
            response_text = self._call_api(on_tool_call, on_system_message, model_override=model_override, on_tool_output=on_tool_output)
            self._store.save(self._conversation)
            return response_text
        except urllib.error.URLError as e:
            if "10061" in str(e) or "Connection refused" in str(e):
                error_msg = "🚨 Koneksi Gagal!\n\nTidak dapat terhubung ke server API Google. Periksa koneksi internet Anda atau pastikan Google API tidak diblokir oleh firewall."
            else:
                error_msg = f"Network error: {str(e)}"
            self._conversation.add_message("assistant", error_msg)
            self._store.save(self._conversation)
            return error_msg
        except Exception as e:
            error_msg = f"Connection error: {str(e)}"
            if "10061" in str(e):
                error_msg = "🚨 Koneksi Gagal!\n\nTidak dapat terhubung ke server API Google. Periksa koneksi internet Anda atau pastikan Google API tidak diblokir oleh firewall."
            self._conversation.add_message("assistant", error_msg)
            self._store.save(self._conversation)
            return error_msg

    def _call_api(self, on_tool_call=None, on_system_message=None, depth=0, model_override=None, on_tool_output=None) -> str:
        from dardcor_agent.models.providers.factory import ProviderFactory
        provider = ProviderFactory.create(self._config.ai, model_override)
        
        consecutive_read_turns = 0
        READ_ONLY_TOOLS = {"search_files", "list_files", "read_file", "semantic_search", "search_web", "read_url", "glob_files", "grep"}

        def abort_check():
            return getattr(self, '_abort_flag', False)
            
        def on_conversation_sys_msg(role, msg):
            self._conversation.add_message(role, msg)
            if role == "system" and on_system_message:
                on_system_message(msg)

        while True:
            if abort_check():
                return "Agent dihentikan oleh pengguna."
                
            messages = self._conversation.get_api_messages()

            # Always reflect the current open workspace in the system context.
            # This is injected per-call only — not persisted in conversation history.
            _ws = self._config.workspace_path or os.getcwd()
            _ws_note = f"\n\n[ACTIVE WORKSPACE]: {_ws}\nAll file operations and shell commands run relative to this directory."
            _patched = False
            for _i, _m in enumerate(messages):
                if _m.get("role") == "system":
                    messages[_i] = dict(_m)
                    messages[_i]["content"] = _m["content"] + _ws_note
                    _patched = True
                    break
            if not _patched:
                messages.insert(0, {"role": "system", "content": _ws_note.strip()})

            # Action bias warning if consecutive read turns
            if consecutive_read_turns >= 4:
                print(f"[Agent] Consecutive read-only turns is {consecutive_read_turns}. Injecting action bias warning to messages.")
                # We append a warning to the end of the messages
                messages.append({
                    "role": "system",
                    "content": (
                        "Warning: You have performed search/read operations multiple times. "
                        "You MUST start writing files or running commands now to complete the task. "
                        "Do NOT perform any more search/list operations. Prefer using write_file or run_command."
                    )
                })

            response = provider.generate_turn(
                messages=messages,
                tools=TOOLS,
                config=self._config.ai,
                model_override=model_override,
                abort_check_fn=abort_check,
                conversation_callback=on_conversation_sys_msg
            )

            if response.error:
                return response.error

            if response.tool_calls:
                all_read_only = all(tc.get("function", {}).get("name") in READ_ONLY_TOOLS for tc in response.tool_calls)
                if all_read_only:
                    consecutive_read_turns += 1
                else:
                    consecutive_read_turns = 0

                self._conversation.add_message("assistant", response.content, tool_calls=response.tool_calls)
                
                for tc in response.tool_calls:
                    if abort_check(): break
                    func_name = tc["function"]["name"]
                    tool_id = tc.get("id", f"tc-{func_name}-{id(tc):x}")
                    try:
                        func_args = json.loads(tc["function"]["arguments"])
                    except json.JSONDecodeError:
                        func_args = {}

                    args_preview = json.dumps(func_args)[:100]
                    if on_tool_call:
                        try:
                            on_tool_call(func_name, args_preview, "running", tool_id)
                        except TypeError:
                            on_tool_call(func_name, args_preview, "running")

                    tool_result = self._execute_tool(func_name, func_args)

                    if tool_result.startswith("Error"):
                        tool_result += "\n\n[SYSTEM WARNING]: Tool execution failed. Do not stop. Analyze the error, fix the parameters, and try again or use a different approach. You must complete the objective."

                    if on_tool_call:
                        status = "success" if not tool_result.startswith("Error") else "error"
                        try:
                            on_tool_call(func_name, args_preview, status, tool_id)
                        except TypeError:
                            on_tool_call(func_name, args_preview, status)

                    # Show result preview in the tool card (like Claude Code does)
                    if on_tool_output and tool_id:
                        preview = (tool_result or "(no output)")[:1500]
                        try:
                            on_tool_output(tool_id, preview)
                        except Exception:
                            pass

                    self._conversation.add_message(
                        "tool",
                        tool_result,
                        tool_call_id=tc["id"],
                        name=func_name,
                    )
                # Loop again with the new tool results
                continue
            else:
                self._conversation.add_message("assistant", response.content)
                return response.content

    def _execute_tool(self, name: str, args: dict) -> str:
        try:
            if name == "read_file":
                path = args.get("path", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                if not os.path.isfile(path):
                    return f"Error: File not found: {path}"
                content = self._fs.read_file(path)
                
                # Chunking logic for token optimization
                start_line = args.get("start_line")
                end_line = args.get("end_line")
                if start_line is not None or end_line is not None:
                    lines = content.splitlines()
                    s = max(1, start_line) if start_line is not None else 1
                    e = min(len(lines), end_line) if end_line is not None else len(lines)
                    content = "\n".join(lines[s-1:e])
                    return f"--- Showing lines {s} to {e} ---\n{content}"
                
                if len(content) > 15000:
                    content = content[:15000] + "\n\n... (truncated to save tokens. Use start_line/end_line to read specific parts)"
                return content

            elif name == "write_file":
                path = args.get("path", "")
                content = args.get("content", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                self._fs.write_file(path, content)
                return f"File written successfully: {path}"

            elif name == "run_command":
                import subprocess
                import time as _time
                import queue as _queue

                command = args.get("command", "")
                _ws = self._config.workspace_path or os.getcwd()
                workdir = args.get("workdir", _ws)
                if workdir and not os.path.isabs(workdir):
                    workdir = os.path.join(_ws, workdir)
                timeout_secs = int(args.get("timeout", 120))
                if not command:
                    return "Error: No command specified"

                # Permission check
                if self.permission_callback:
                    try:
                        allowed = self.permission_callback(command)
                    except TypeError as te:
                        main_window = getattr(self.permission_callback, "__self__", None)
                        if main_window is not None:
                            from PySide6.QtCore import QTimer
                            from PySide6.QtWidgets import QMessageBox
                            result_holder = [False]
                            event = threading.Event()
                            def show_dialog():
                                try:
                                    reply = QMessageBox.question(
                                        main_window, "AI Agent Command Authorization",
                                        f"The AI Agent wants to execute:\n\n{command}\n\nAuthorize?",
                                        QMessageBox.Yes | QMessageBox.No,
                                    )
                                    result_holder[0] = (reply == QMessageBox.Yes)
                                finally:
                                    event.set()
                            QTimer.singleShot(0, show_dialog)
                            event.wait()
                            allowed = result_holder[0]
                        else:
                            raise te
                    if not allowed:
                        return "Error: Command execution denied by user."

                def _kill_proc(p):
                    """Kill process and its children reliably on all platforms."""
                    try:
                        if sys.platform == "win32":
                            subprocess.call(
                                ["taskkill", "/F", "/T", "/PID", str(p.pid)],
                                shell=False,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                            )
                        else:
                            import signal as _sig
                            try:
                                os.killpg(os.getpgid(p.pid), _sig.SIGKILL)
                            except Exception:
                                p.kill()
                    except Exception:
                        try:
                            p.kill()
                        except Exception:
                            pass
                    try:
                        p.wait(3)
                    except Exception:
                        pass

                def _reader(pipe, q):
                    """Read pipe in 4096-byte chunks — avoids blocking on partial lines."""
                    try:
                        while True:
                            chunk = pipe.read(4096)
                            if not chunk:
                                break
                            q.put(chunk)
                    except Exception:
                        pass
                    finally:
                        try:
                            pipe.close()
                        except Exception:
                            pass

                try:
                    popen_kwargs = dict(
                        shell=True,
                        cwd=workdir,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        # KEY FIX: never block waiting for stdin input
                        stdin=subprocess.DEVNULL,
                    )
                    if sys.platform == "win32":
                        # No console window; new process group so taskkill /T works
                        popen_kwargs["creationflags"] = (
                            subprocess.CREATE_NO_WINDOW
                            | subprocess.CREATE_NEW_PROCESS_GROUP
                        )
                    else:
                        # Own session → own process group for killpg
                        popen_kwargs["start_new_session"] = True

                    proc = subprocess.Popen(**popen_kwargs)
                    self._current_process = proc

                    stdout_q: _queue.Queue = _queue.Queue()
                    stderr_q: _queue.Queue = _queue.Queue()
                    t_out = threading.Thread(target=_reader, args=(proc.stdout, stdout_q), daemon=True)
                    t_err = threading.Thread(target=_reader, args=(proc.stderr, stderr_q), daemon=True)
                    t_out.start()
                    t_err.start()

                    start = _time.monotonic()
                    timed_out = False
                    while proc.poll() is None:
                        if getattr(self, '_abort_flag', False):
                            _kill_proc(proc)
                            t_out.join(1.0)
                            t_err.join(1.0)
                            self._current_process = None
                            return "Agent dihentikan oleh pengguna."
                        if _time.monotonic() - start > timeout_secs:
                            timed_out = True
                            _kill_proc(proc)
                            break
                        _time.sleep(0.05)

                    t_out.join(3.0)
                    t_err.join(3.0)
                    self._current_process = None

                    raw_out = b"".join(list(stdout_q.queue))
                    raw_err = b"".join(list(stderr_q.queue))
                    stdout = raw_out.decode("utf-8", errors="replace")
                    stderr = raw_err.decode("utf-8", errors="replace")
                    rc = proc.returncode

                    if timed_out:
                        output = stdout + f"\n[TIMEOUT after {timeout_secs}s — process killed]"
                        if stderr:
                            output += "\n[stderr]\n" + stderr
                    else:
                        output = stdout
                        if stderr:
                            output += "\n[stderr]\n" + stderr
                        if rc not in (None, 0):
                            output += f"\n[exit code: {rc}]"

                except FileNotFoundError:
                    self._current_process = None
                    output = f"Error: command not found: {command.split()[0] if command else ''}"
                except Exception as ex:
                    self._current_process = None
                    output = f"Error running command: {str(ex)}"

                # Smart truncation: keep head + tail so context is preserved
                if len(output) > 8000:
                    head = output[:2000]
                    tail = output[-5000:]
                    skipped = len(output) - 7000
                    output = f"{head}\n\n... [{skipped} chars truncated] ...\n\n{tail}"

                return output or "(no output)"

            elif name == "update_core_memory":
                category = args.get("category", "")
                fact = args.get("fact", "")
                if not category or not fact:
                    return "Error: category and fact are required."
                self._core_memory.add_fact(category, fact)
                return f"Successfully added fact to Core Memory [{category}]: {fact}"

            elif name == "search_archival_memory":
                query = args.get("query", "")
                if not query:
                    return "Error: query is required."
                results = self._archival_memory.search(query, top_k=5)
                if not results:
                    return "No historical records found for that query."
                
                out = "Found relevant past discussions:\n"
                for i, r in enumerate(results):
                    out += f"\n[{i+1}] Session: {r['conversation']} | Role: {r['role']} | Time: {r['timestamp']}\nMessage: {r['content']}\n"
                return out

            elif name == "search_files":
                query = args.get("query", "")
                workspace = self._config.workspace_path or os.getcwd()
                path = args.get("path", workspace)
                if not os.path.isabs(path):
                    path = os.path.join(workspace, path)
                if not query:
                    return "Error: No query specified"
                results = self._fs.grep(query, path, max_results=50)
                if not results:
                    return "No results found."
                lines = []
                for r in results:
                    lines.append(f"{r['relative']}:{r['line']}: {r['content'][:200]}")
                return "\n".join(lines)

            elif name == "list_files":
                workspace = self._config.workspace_path or os.getcwd()
                path = args.get("path", workspace)
                if not os.path.isabs(path):
                    path = os.path.join(workspace, path)
                recursive = args.get("recursive", False)
                files = self._fs.list_dir(path, recursive=recursive)
                if not files:
                    return "No files found."
                return "\n".join(files[:200])

            elif name == "replace_file_content":
                path = args.get("path", "")
                target = args.get("targetContent", "")
                replacement = args.get("replacementContent", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                if not os.path.isfile(path):
                    return f"Error: File not found: {path}"
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                    
                    count = content.count(target)
                    if count == 0:
                        return "Error: targetContent not found in the file. Make sure it matches exactly, including indentation."
                    elif count > 1:
                        return f"Error: targetContent found {count} times in the file. Specify a unique block of lines."
                        
                    new_content = content.replace(target, replacement, 1)
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    return f"Successfully replaced content in {path}"
                except Exception as e:
                    return f"Error replacing content: {str(e)}"

            elif name == "multi_replace_file_content":
                path = args.get("path", "")
                replacements = args.get("replacements", [])
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                if not os.path.isfile(path):
                    return f"Error: File not found: {path}"
                if not replacements:
                    return "Error: No replacements specified"
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read()
                        
                    for r in replacements:
                        target = r.get("targetContent", "")
                        replacement = r.get("replacementContent", "")
                        count = content.count(target)
                        if count == 0:
                            return f"Error: targetContent '{target}' not found in the file."
                        elif count > 1:
                            return f"Error: targetContent '{target}' found {count} times. Make search block unique."
                        content = content.replace(target, replacement, 1)
                        
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    return f"Successfully applied {len(replacements)} replacements in {path}"
                except Exception as e:
                    return f"Error applying multi-replace: {str(e)}"

            elif name == "search_web":
                query = args.get("query", "")
                if not query:
                    return "Error: No query specified"
                try:
                    import urllib.request
                    import urllib.parse
                    import html
                    import re
                    
                    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote_plus(query)
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    )
                    with urllib.request.urlopen(req, timeout=10) as response:
                        html_content = response.read().decode("utf-8", errors="replace")
                    
                    matches = re.findall(r'<a class="result__a"\s+href="([^"]+)"[^>]*>(.*?)</a>', html_content)
                    snips = re.findall(r'<a class="result__snippet"\s+href="[^"]+"[^>]*>(.*?)</a>', html_content)
                    
                    results = []
                    for i in range(min(5, len(matches))):
                        href, title = matches[i]
                        title = re.sub(r'<[^>]+>', '', title).strip()
                        title = html.unescape(title)
                        
                        if "uddg=" in href:
                            parsed_url = urllib.parse.urlparse(href)
                            queries = urllib.parse.parse_qs(parsed_url.query)
                            if "uddg" in queries:
                                href = queries["uddg"][0]
                                
                        snippet = ""
                        if i < len(snips):
                            snippet = re.sub(r'<[^>]+>', '', snips[i]).strip()
                            snippet = html.unescape(snippet)
                            
                        results.append(f"- **[{title}]({href})**\n  {snippet}")
                        
                    return "\n\n".join(results) or "No web results found."
                except Exception as e:
                    return f"Error searching the web: {str(e)}"

            elif name == "read_url":
                url = args.get("url", "")
                if not url:
                    return "Error: No URL specified"
                try:
                    import urllib.request
                    import html
                    import re
                    
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                    )
                    with urllib.request.urlopen(req, timeout=10) as response:
                        body = response.read().decode("utf-8", errors="replace")
                        
                    body = re.sub(r'<script[^>]*>([\s\S]*?)</script>', '', body, flags=re.I)
                    body = re.sub(r'<style[^>]*>([\s\S]*?)</style>', '', body, flags=re.I)
                    body = re.sub(r'<[^>]+>', ' ', body)
                    body = html.unescape(body)
                    body = re.sub(r'\s+', ' ', body).strip()
                    
                    return body[:12000]
                except Exception as e:
                    return f"Error reading URL: {str(e)}"

            elif name == "semantic_search":
                query = args.get("query", "")
                if not query:
                    return "Error: No query specified"
                root = self._config.workspace_path or os.getcwd()
                return self._tfidf_search(root, query)

            elif name == "invoke_subagent":
                agent_type = args.get("agent_type", "")
                task = args.get("task", "")
                if not agent_type or not task:
                    return "Error: Missing agent_type or task"
                if agent_type == "browser":
                    from .browser_agent import BrowserAgent
                    agent = BrowserAgent(self)
                    return agent.run_task(task)
                else:
                    return f"Error: Unknown agent type '{agent_type}'"

            elif name == "manage_task":
                # Stub implementation for task management
                action = args.get("action", "")
                task_id = args.get("task_id", "")
                if action == "list":
                    return "Running Tasks:\n- (None)"
                elif action == "status":
                    return f"Task {task_id} not found."
                elif action == "kill":
                    return f"Task {task_id} killed."
                elif action == "send_input":
                    return f"Input sent to task {task_id}."
                return "Unknown action."

            elif name == "glob_files":
                import fnmatch as _fnmatch2
                pattern = args.get("pattern", "")
                base = args.get("path", self._config.workspace_path or os.getcwd())
                if not pattern:
                    return "Error: No pattern specified"
                if not os.path.isabs(base) and self._config.workspace_path:
                    base = os.path.join(self._config.workspace_path, base)
                skip = {".git", "__pycache__", "node_modules", ".venv", "venv", "dist", "build"}
                results = []
                for root, dirs, files in os.walk(base):
                    dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]
                    for fname in files:
                        full = os.path.join(root, fname)
                        rel = os.path.relpath(full, base).replace(os.sep, "/")
                        if _fnmatch2.fnmatch(rel, pattern) or _fnmatch2.fnmatch(fname, pattern):
                            results.append(rel)
                        if len(results) >= 200:
                            break
                    if len(results) >= 200:
                        break
                if not results:
                    return "No files matched."
                results.sort()
                return "\n".join(results)

            elif name == "grep":
                import re as _re2
                import fnmatch as _fnmatch3
                pattern = args.get("pattern", "")
                path = args.get("path", self._config.workspace_path or os.getcwd())
                context = int(args.get("context_lines", 0))
                file_pat = args.get("file_pattern", "")
                ci = args.get("case_insensitive", False)
                if not pattern:
                    return "Error: No pattern specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                flags = _re2.IGNORECASE if ci else 0
                try:
                    regex = _re2.compile(pattern, flags)
                except _re2.error as e:
                    return f"Error: Invalid regex: {e}"
                output_lines = []
                skip2 = {".git", "__pycache__", "node_modules", ".venv", "venv"}

                def _grep_file(fpath, base_dir):
                    try:
                        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                            lines = f.readlines()
                        rel = os.path.relpath(fpath, base_dir).replace(os.sep, "/")
                        for i, line in enumerate(lines):
                            if regex.search(line):
                                s, e2 = max(0, i - context), min(len(lines), i + context + 1)
                                if context > 0:
                                    output_lines.append(f"--- {rel} ---")
                                for j in range(s, e2):
                                    prefix = ">" if j == i else " "
                                    output_lines.append(f"{rel}:{j+1}{prefix} {lines[j].rstrip()}")
                                if len(output_lines) >= 500:
                                    return True
                    except Exception:
                        pass
                    return False

                if os.path.isfile(path):
                    _grep_file(path, os.path.dirname(path))
                else:
                    for root, dirs, files in os.walk(path):
                        dirs[:] = [d for d in dirs if d not in skip2 and not d.startswith(".")]
                        for fname in files:
                            if file_pat and not _fnmatch3.fnmatch(fname, file_pat):
                                continue
                            if _grep_file(os.path.join(root, fname), path):
                                break
                if not output_lines:
                    return "No matches found."
                return "\n".join(output_lines[:500])

            elif name == "apply_patch":
                patch_text = args.get("patch", "")
                if not patch_text:
                    return "Error: No patch provided"

                # Parse unified diff into per-hunk (old, new) pairs
                plines = patch_text.splitlines()
                target_file = None
                hunks = []
                cur_old: list = []
                cur_new: list = []
                in_hunk = False

                for ln in plines:
                    if ln.startswith("+++ "):
                        fname = ln[4:].split("\t")[0].strip()
                        for pfx in ("b/", "a/"):
                            if fname.startswith(pfx):
                                fname = fname[len(pfx):]
                                break
                        target_file = fname
                        in_hunk = False
                    elif ln.startswith("--- "):
                        pass
                    elif ln.startswith("@@"):
                        # New hunk boundary — save previous hunk
                        if in_hunk:
                            hunks.append((list(cur_old), list(cur_new)))
                        cur_old, cur_new = [], []
                        in_hunk = True
                    elif in_hunk:
                        if ln.startswith("-"):
                            cur_old.append(ln[1:])
                        elif ln.startswith("+"):
                            cur_new.append(ln[1:])
                        else:
                            # Context line (space prefix or bare)
                            ctx = ln[1:] if ln.startswith(" ") else ln
                            cur_old.append(ctx)
                            cur_new.append(ctx)

                if in_hunk:
                    hunks.append((cur_old, cur_new))

                if not target_file:
                    return "Error: Could not parse patch — expected unified diff (--- / +++ format)"
                if not hunks:
                    return "Error: No hunks found in patch"

                if not os.path.isabs(target_file) and self._config.workspace_path:
                    target_file = os.path.join(self._config.workspace_path, target_file)
                if not os.path.isfile(target_file):
                    return f"Error: File not found: {target_file}"

                with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()

                # Apply hunks sequentially; each replaces first occurrence
                applied, failed = 0, []
                for idx, (old_ls, new_ls) in enumerate(hunks):
                    old_text = "\n".join(old_ls)
                    new_text = "\n".join(new_ls)
                    if old_text in content:
                        content = content.replace(old_text, new_text, 1)
                        applied += 1
                    else:
                        failed.append(idx + 1)

                if applied == 0:
                    preview = "\n".join(hunks[0][0][:5]) if hunks else ""
                    return (
                        f"Error: No hunks applied — old content not found in {target_file}.\n"
                        f"First hunk expected:\n{preview}"
                    )

                with open(target_file, "w", encoding="utf-8") as f:
                    f.write(content)

                if failed:
                    return f"Partial patch: {applied}/{len(hunks)} hunks applied to {target_file}. Skipped hunks: {failed}"
                return f"Patch applied: {applied} hunk(s) → {target_file}"

            elif name == "create_directory":
                path = args.get("path", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                os.makedirs(path, exist_ok=True)
                return f"Directory created: {path}"

            else:
                return f"Error: Unknown tool {name}"

        except Exception as e:
            return f"Error executing tool {name}: {str(e)}"

    def _tfidf_search(self, root_path: str, query: str, max_results: int = 5) -> str:
        import math
        import re
        from collections import Counter
        
        # Tokenizer helper
        def tokenize(text):
            return re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", text.lower())

        skip_dirs = {".git", "__pycache__", "node_modules", ".venv", "venv", "dist", "build"}
        files_to_index = []

        for dirpath, dirnames, filenames in os.walk(root_path):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
            for f in filenames:
                ext = os.path.splitext(f)[1].lower()
                if ext in (".py", ".js", ".html", ".css", ".json", ".md", ".toml", ".yml", ".yaml"):
                    files_to_index.append(os.path.join(dirpath, f))
                    if len(files_to_index) >= 500:
                        break
            if len(files_to_index) >= 500:
                break
                
        if not files_to_index:
            return "No files found to search."

        docs = {}
        doc_freqs = Counter()
        
        for fpath in files_to_index:
            try:
                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                tokens = tokenize(content)
                if tokens:
                    docs[fpath] = (content, Counter(tokens), len(tokens))
                    for t in set(tokens):
                        doc_freqs[t] += 1
            except Exception:
                continue
                
        query_tokens = tokenize(query)
        if not query_tokens:
            return "Empty query after tokenization."
            
        scores = []
        num_docs = len(docs)
        
        for fpath, (content, term_counts, doc_len) in docs.items():
            score = 0.0
            for qt in query_tokens:
                if term_counts[qt] > 0:
                    tf = term_counts[qt] / doc_len
                    df = doc_freqs[qt]
                    idf = math.log((1 + num_docs) / (1 + df)) + 1
                    score += tf * idf
            if score > 0:
                snippet = ""
                lines = content.splitlines()
                for line in lines:
                    if any(qt in line.lower() for qt in query_tokens):
                        snippet = line.strip()
                        if len(snippet) > 120:
                            snippet = snippet[:117] + "..."
                        break
                rel_path = os.path.relpath(fpath, root_path)
                scores.append((score, rel_path, snippet))
                
        scores.sort(reverse=True, key=lambda x: x[0])
        
        if not scores:
            return "No semantically matching files found."
            
        output = []
        for score, rel_path, snippet in scores[:max_results]:
            output.append(f"- **{rel_path}** (relevance: {score:.4f})\n  *Match snippet:* `{snippet}`")
            
        return "\n\n".join(output)

    def get_conversation(self) -> Conversation:
        return self._conversation

    def list_conversations(self) -> list:
        return self._store.list_conversations()

    def delete_conversation(self, conv_id: str):
        """Delete a conversation by ID."""
        self._store.delete(conv_id)
        if self._conversation and self._conversation.id == conv_id:
            self.new_conversation()

    def rename_conversation(self, conv_id: str, new_title: str):
        """Rename a conversation."""
        # Find it
        convs = self.list_conversations()
        for c in convs:
            if c["id"] == conv_id:
                # Load, rename, save
                conv = self._store.load(conv_id)
                if conv:
                    conv.title = new_title
                    self._store.save(conv)
                break
        
        # Also update current if it's the active one
        if self._conversation and self._conversation.id == conv_id:
            self._conversation.title = new_title

    def load_conversation(self, conv_id: str) -> bool:
        conv = self._store.load(conv_id)
        if conv:
            self._conversation = conv
            return True
        return False
