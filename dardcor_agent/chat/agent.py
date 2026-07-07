"""AI Agent engine for Dardcor Code."""

import os
import sys
import json
import threading
import urllib.error
from typing import Callable, Optional, List, Dict, Any

# Fix Windows cp1252 encoding crash for Unicode chars (arrows, emoji, etc.)
import io as _io
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, 'buffer') and sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
            sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
        if hasattr(sys.stderr, 'buffer') and sys.stderr.encoding and sys.stderr.encoding.lower() not in ('utf-8', 'utf8'):
            sys.stderr = _io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)
    except Exception:
        pass

from pydardcor.core.config import get_config, AppConfig, get_user_data_dir
from .memory import Conversation, ConversationStore, Message, CoreMemory, ArchivalMemory
from .identity import get_identity_prompt
from dardcor_agent.extensibility.hooks import HookRegistry
from dardcor_agent.extensibility.rules import load_rules
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
                "Execute a shell command. "
                "Use WaitMsBeforeAsync to run in the background if the command is interactive or long-running. "
                "Use manage_task to interact with background tasks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run"},
                    "workdir": {"type": "string", "description": "Working directory (optional)"},
                    "timeout": {"type": "integer", "description": "Max seconds before kill (default 120)"},
                    "WaitMsBeforeAsync": {"type": "integer", "description": "Milliseconds to wait before sending task to background (default 0)"}
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
            "name": "web_search",
            "description": "Search the web and return compact result snippets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                    "max_results": {"type": "integer", "description": "Maximum results"}
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
            "name": "web_fetch",
            "description": "Fetch and extract readable text from a web URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch"},
                    "allow_local": {"type": "boolean", "description": "Allow localhost/private URLs"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_embedding",
            "description": "Create an embedding vector for text using configured provider or local hashing fallback.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to embed"},
                    "save_as": {"type": "string", "description": "Optional local cache name"}
                },
                "required": ["text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_image",
            "description": "Generate an image from a prompt using a configured image-capable provider.",
            "parameters": {
                "type": "object",
                "properties": {"prompt": {"type": "string", "description": "Image prompt"}},
                "required": ["prompt"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "speech_to_text",
            "description": "Transcribe an audio file with a configured speech-to-text provider.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Audio file path"}},
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "text_to_speech",
            "description": "Generate speech audio from text using a configured text-to-speech provider.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to speak"},
                    "voice": {"type": "string", "description": "Voice name"}
                },
                "required": ["text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_skills",
            "description": "List built-in Dardcor skills and prompt helpers.",
            "parameters": {"type": "object", "properties": {}}
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
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file or empty directory from the filesystem.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file or directory to delete"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_file",
            "description": "Move or rename a file or directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_path": {"type": "string", "description": "Source file or directory path"},
                    "dest_path": {"type": "string", "description": "Destination path"},
                },
                "required": ["source_path", "dest_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "append_to_file",
            "description": "Append content to the end of an existing file without overwriting it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path to append to"},
                    "content": {"type": "string", "description": "Content to append"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_file_exists",
            "description": "Check whether a file or directory exists at the given path.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to check"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_artifact",
            "description": "Create a Markdown artifact (e.g. for long explanations, code design, tables, or architecture plans) and display it to the user in the UI.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short title for the artifact file (e.g. 'architecture_plan')"},
                    "content": {"type": "string", "description": "The markdown content of the artifact"},
                },
                "required": ["title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_question",
            "description": "Ask the user a question to clarify underspecified requirements, request approval for destructive actions, or resolve ambiguity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The question or confirmation message to ask the user."}
                },
                "required": ["question"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "open_browser",
            "description": "Open a URL (e.g. localhost) in a new Browser Tab inside the Editor.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to open, e.g. http://localhost:3000"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_open",
            "description": "Open an AI-controlled isolated Chrome window for inspecting a URL.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "URL to open"}},
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_observe",
            "description": "Observe the current AI-controlled Chrome tabs through local DevTools metadata.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_eval",
            "description": "Evaluate JavaScript in the controlled browser when CDP WebSocket support is available.",
            "parameters": {
                "type": "object",
                "properties": {"script": {"type": "string", "description": "JavaScript source"}},
                "required": ["script"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click coordinates in the AI-controlled Chrome page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "Viewport X coordinate"},
                    "y": {"type": "integer", "description": "Viewport Y coordinate"}
                },
                "required": ["x", "y"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "Type text into the currently focused element in the AI-controlled Chrome page.",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string", "description": "Text to type"}},
                "required": ["text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_screenshot",
            "description": "Capture a PNG screenshot from the AI-controlled Chrome page.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_status",
            "description": "Show git working tree status for the workspace.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_diff",
            "description": "Show git diff for unstaged and staged changes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Optional file or directory path"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "git_log",
            "description": "Show recent git commits.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Number of commits to show, default 10"}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_syntax",
            "description": "Compile a Python file or package to catch syntax errors.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File or directory path to check"}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "detect_project",
            "description": "Detect project type, package manager, key config files, and likely test commands.",
            "parameters": {"type": "object", "properties": {}},
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

    def _get_system_prompt(self, workspace_path: str = None) -> str:
        if workspace_path is None:
            workspace_path = self._config.workspace_path
        prompt = get_identity_prompt(self._core_memory.get_summary(), workspace_path)
        rules = load_rules(workspace_path or os.getcwd())
        if rules:
            prompt = f"{prompt}\n\n{rules}"
        return prompt

    def _hooks_config_path(self) -> str:
        ws = self._config.workspace_path or os.getcwd()
        return os.path.join(ws, ".dardcor", "hooks.json")

    def _run_hooks(self, event: str, env: Optional[dict] = None) -> None:
        registry = getattr(self, "_hook_registry", None)
        if registry is None:
            return
        try:
            merged = os.environ.copy()
            if env:
                merged.update({str(k): str(v) for k, v in env.items()})
            registry.run(event, merged)
        except Exception:
            pass

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
        self._bg_msg_callback = None
        self._bg_tasks = {}
        self._lock = threading.Lock()
        self._abort_flag = False
        self._current_process = None
        self._hook_registry = HookRegistry(self._hooks_config_path())
        self._hook_registry.load()

        # Add system message with Core Memory
        sys_prompt = self._get_system_prompt()
        self._conversation.add_message("system", sys_prompt)
        self._run_hooks("on_start")

    @property
    def config(self) -> AppConfig:
        return self._config

    def set_workspace(self, path: str):
        """Called when the user opens a different folder mid-session."""
        if not path:
            return
        # Update config so all tool calls use the correct root
        self._config.workspace_path = path

        # Rebuild the system prompt so the LLM knows the new path immediately
        sys_prompt = self._get_system_prompt(path)
        # Replace the existing system message (always index 0)
        msgs = self._conversation.messages
        if msgs and msgs[0].role == "system":
            msgs[0].content = sys_prompt
        else:
            # No system message yet — prepend it
            self._conversation.add_message("system", sys_prompt)

        # Only inject a change notification if there are already user messages
        has_user = any(m.role == "user" for m in msgs)
        if has_user:
            self._conversation.add_message(
                "system",
                f"[WORKSPACE CHANGED] Switched to: {path}. "
                f"Use this as the root for all file operations.",
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

        # Abort active provider API request
        provider = getattr(self, '_current_provider', None)
        if provider and hasattr(provider, 'abort'):
            try:
                provider.abort()
            except Exception:
                pass
    def on_stream(self, callback: Callable[[str], None]):
        self._stream_callback = callback
        
    def set_background_message_callback(self, callback: Callable[[str], None]):
        self._bg_msg_callback = callback

    def new_conversation(self):
        has_user_message = any(m.role == "user" for m in self._conversation.messages)
        if has_user_message:
            self._store.save(self._conversation)
        self._conversation = Conversation()
        sys_prompt = self._get_system_prompt()
        self._conversation.add_message("system", sys_prompt)

    def send_message(
        self,
        message: str,
        model_override: Optional[str] = None,
        on_tool_call: Optional[Callable[[str, str, str], None]] = None,
        on_system_message: Optional[Callable[[str], None]] = None,
        on_tool_output: Optional[Callable[[str, str], None]] = None,
        on_notification: Optional[Callable[[str], None]] = None,
        on_agent_message: Optional[Callable[[str], None]] = None,
        on_title_changed: Optional[Callable[[str], None]] = None,
        ephemeral_state: str = "",
    ) -> str:
        with self._lock:
            self._abort_flag = False
            self._conversation.add_message("user", message)
            
            user_msgs = [m for m in self._conversation.messages if m.role == "user"]
            if len(user_msgs) == 1:
                def _generate_title():
                    try:
                        import os
                        from dataclasses import dataclass
                        @dataclass
                        class _DummyAIConfig:
                            provider: str = "openai"
                            model: str = "gpt-4o"
                            api_key: str = os.environ.get("DARDCOR_CODE_API_KEY", os.environ.get("OPENAI_API_KEY", ""))
                            base_url: str = ""
                            max_tokens: int = 15
                            temperature: float = 0.3
                            system_prompt: str = ""
                        
                        from dardcor_agent.models.providers.factory import ProviderFactory
                        dummy = _DummyAIConfig()
                        provider = ProviderFactory.create(dummy, model_override=model_override)
                        msgs = [
                            {"role": "system", "content": "You are a title generator. Generate a concise 3-5 word title for this prompt. No quotes."},
                            {"role": "user", "content": message}
                        ]
                        res = provider.generate_turn(msgs, [], config=dummy, model_override=model_override, abort_check_fn=lambda: False, conversation_callback=lambda r, m: None)
                        if res and res.content:
                            title = res.content.strip().strip('"').strip("'")
                            if title:
                                self.rename_conversation(self._conversation.id, title)
                                if on_title_changed:
                                    on_title_changed(title)
                    except Exception as e:
                        print("Background title generation failed:", e)
                import threading
                threading.Thread(target=_generate_title, daemon=True).start()
            elif on_title_changed:
                on_title_changed(self._conversation.title)

            try:
                response_text = self._call_api(
                    on_tool_call, on_system_message, 
                    model_override=model_override, 
                    on_tool_output=on_tool_output, 
                    on_notification=on_notification,
                    on_agent_message=on_agent_message,
                    ephemeral_state=ephemeral_state
                )
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

    def _call_api(self, on_tool_call=None, on_system_message=None, depth=0, model_override=None, on_tool_output=None, on_notification=None, on_agent_message=None, ephemeral_state="") -> str:
        from dataclasses import dataclass
        @dataclass
        class _DummyAIConfig:
            provider: str = "openai"
            model: str = "gpt-4o"
            api_key: str = os.environ.get("DARDCOR_CODE_API_KEY", os.environ.get("OPENAI_API_KEY", ""))
            base_url: str = ""
            max_tokens: int = 128000
            temperature: float = 0.7
            system_prompt: str = ""
            
        from dardcor_agent.models.providers.factory import ProviderFactory
        dummy_config = _DummyAIConfig()
        provider = ProviderFactory.create(dummy_config, model_override)
        self._current_provider = provider
        
        consecutive_read_turns = 0
        READ_ONLY_TOOLS = {"search_files", "list_files", "read_file", "semantic_search", "search_web", "web_search", "read_url", "web_fetch", "create_embedding", "list_skills", "glob_files", "grep"}

        def abort_check():
            return getattr(self, '_abort_flag', False)
            
        def on_conversation_sys_msg(role, msg):
            if role == "notification":
                if on_notification:
                    on_notification(msg)
                return
            self._conversation.add_message(role, msg)
            self._store.save(self._conversation)
            if role == "system" and on_system_message:
                on_system_message(msg)

        try:
          iterations = 0
          MAX_ITERATIONS = 999999
          while True:
            iterations += 1
            if iterations > MAX_ITERATIONS:
                return f"Agent stopped: exceeded maximum {MAX_ITERATIONS} tool-call iterations. Please rephrase or break the task into smaller steps."
            if abort_check():
                return "Agent dihentikan oleh pengguna."
                
            messages = self._conversation.get_api_messages()

            # Always reflect the current open workspace in the system context.
            # This is injected per-call only — not persisted in conversation history.
            _ws = self._config.workspace_path or os.getcwd()
            _ws_note = f"\n\n[ACTIVE WORKSPACE]: {_ws}\nAll file operations and shell commands run relative to this directory."
            if ephemeral_state:
                _ws_note += f"\n\n[EPHEMERAL STATE]:\n{ephemeral_state}"
                
            _patched = False
            for _i, _m in enumerate(messages):
                if _m.get("role") == "system":
                    messages[_i] = dict(_m)
                    messages[_i]["content"] = self._get_system_prompt() + _ws_note
                    _patched = True
                    break
            if not _patched:
                messages.insert(0, {"role": "system", "content": _ws_note.strip()})

            # Action bias warning if consecutive read turns
            if consecutive_read_turns >= 10:
                # We append a warning to the end of the messages silently after 10 turns
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
                config=dummy_config,
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
                self._store.save(self._conversation)
                
                # IMPORTANT: Emit the content (which contains the <thought> block) to the UI!
                if on_agent_message and response.content.strip():
                    on_agent_message(response.content)
                
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
                        import time
                        time.sleep(0.12)

                    tool_result = self._execute_tool(func_name, func_args, on_tool_call, on_tool_output, tool_id)

                    if tool_result.startswith("__AWAIT_USER_INPUT__:"):
                        question = tool_result.split("__AWAIT_USER_INPUT__:", 1)[1]
                        self._conversation.add_message(
                            "tool",
                            "Tolong berikan respons Anda.",
                            tool_call_id=tc["id"],
                            name=func_name,
                        )
                        self._store.save(self._conversation)
                        if on_agent_message:
                            on_agent_message("\n\n**[HitL Gate] Membutuhkan Konfirmasi:**\n" + question)
                        return question

                    if "ARTIFACT_CREATED:" in tool_result:
                        if on_notification:
                            path = tool_result.split("ARTIFACT_CREATED:")[1].strip()
                            on_notification(f"ARTIFACT_CREATED:{path}")

                    if "BROWSER_OPENED:" in tool_result:
                        if on_notification:
                            url = tool_result.split("BROWSER_OPENED:")[1].strip()
                            on_notification(f"BROWSER_OPENED:{url}")

                    if tool_result.startswith("Error"):
                        tool_result += "\n\n[SYSTEM WARNING]: Tool execution failed. Do not stop. Analyze the error, fix the parameters, and try again or use a different approach. You must complete the objective."


                    if on_tool_call:
                        is_bg = tool_result.startswith("Background task started.")
                        if not is_bg:
                            status = "success" if not tool_result.startswith("Error") else "error"
                            import time
                            time.sleep(0.10)  # Give Qt event loop time to process the "running" card
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
                    self._store.save(self._conversation)
                # Loop again with the new tool results
                continue
            else:
                if getattr(response, "usage", None):
                    usage = response.usage
                    response.content = (
                        f"{response.content}\n\n"
                        f"`{usage.get('model', 'Model')}` usage: "
                        f"{usage.get('attempts', 0)} call(s), "
                        f"{usage.get('billed_units', 0):.1f}x strongest mode."
                    )
                self._conversation.add_message("assistant", response.content)
                self._store.save(self._conversation)
                return response.content
        finally:
            self._current_provider = None

    def _backup_file(self, path: str):
        if not os.path.exists(path):
            return
        try:
            import shutil
            import time
            backup_dir = os.path.join(get_user_data_dir(), "backups")
            os.makedirs(backup_dir, exist_ok=True)
            fname = os.path.basename(path)
            ts = int(time.time())
            backup_path = os.path.join(backup_dir, f"{fname}.{ts}.bak")
            shutil.copy2(path, backup_path)
        except Exception:
            pass

    def _tfidf_search(self, root: str, query: str) -> str:
        import os
        import re
        from collections import Counter
        
        def get_words(text):
            return set(re.findall(r'\w+', text.lower()))
            
        query_words = get_words(query)
        if not query_words:
            return "No valid search terms in query."
            
        results = []
        for dirpath, dirnames, filenames in os.walk(root):
            # Exclude common dirs
            dirnames[:] = [d for d in dirnames if d not in {'.git', 'node_modules', '__pycache__', '.pytest_cache', 'venv', 'env', '.dardcor', 'build', 'dist'}]
            
            for file in filenames:
                if not file.endswith(('.py', '.js', '.ts', '.html', '.css', '.md', '.json', '.txt', '.go', '.cpp', '.c', '.h', '.java')):
                    continue
                path = os.path.join(dirpath, file)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                    
                    # AST/Symbol extraction (for Python)
                    symbols = []
                    if path.endswith(".py"):
                        import ast
                        try:
                            tree = ast.parse(content)
                            for node in ast.walk(tree):
                                if isinstance(node, ast.FunctionDef) or isinstance(node, ast.ClassDef):
                                    symbols.append(node.name)
                        except Exception:
                            pass
                            
                    file_words = get_words(content)
                    file_words.update(set(s.lower() for s in symbols))
                    
                    overlap = len(query_words.intersection(file_words))
                    if overlap > 0:
                        results.append({"path": path, "score": overlap, "symbols": symbols})
                except Exception:
                    pass
                    
        results.sort(key=lambda x: x["score"], reverse=True)
        top = results[:10]
        
        if not top:
            return "No matching files found for semantic search."
            
        res = "Semantic Search Results (Workspace AST & Keyword Index):\n"
        for i, item in enumerate(top):
            rel_path = os.path.relpath(item["path"], root)
            syms = ", ".join(item["symbols"][:5]) if item["symbols"] else "None"
            res += f"{i+1}. {rel_path} (Score: {item['score']}) - Found Symbols: {syms}\n"
        return res

    def _execute_tool(self, name: str, args: dict, on_tool_call=None, on_tool_output=None, tool_id: str = "") -> str:
        hook_env = {
            "DARDCOR_TOOL_NAME": name,
            "DARDCOR_TOOL_ARGS": json.dumps(args, ensure_ascii=False),
        }
        self._run_hooks("before_tool", hook_env)
        try:
            result = self._execute_tool_impl(name, args, on_tool_call, on_tool_output, tool_id)
        except Exception as exc:
            self._run_hooks("on_error", {**hook_env, "DARDCOR_ERROR": str(exc)})
            raise
        hook_env["DARDCOR_TOOL_RESULT"] = result[:2000] if isinstance(result, str) else str(result)[:2000]
        self._run_hooks("after_tool", hook_env)
        return result

    def _execute_tool_impl(self, name: str, args: dict, on_tool_call=None, on_tool_output=None, tool_id: str = "") -> str:
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
                self._backup_file(path)
                self._fs.write_file(path, content)
                return f"File written successfully: {path}"

            elif name == "run_command":
                import subprocess
                import time as _time
                import queue as _queue
                import uuid as _uuid

                command = args.get("command", "")
                _ws = self._config.workspace_path or os.getcwd()
                workdir = args.get("workdir", _ws)
                if workdir and not os.path.isabs(workdir):
                    workdir = os.path.join(_ws, workdir)
                timeout_secs = int(args.get("timeout", 120))
                # WaitMsBeforeAsync: how many ms to wait before offloading to background
                # 0 = wait synchronously (old behaviour), >0 = go async after that delay
                wait_ms = int(args.get("WaitMsBeforeAsync", 0))
                if not command:
                    return "Error: No command specified"

                # Permission check removed for full autonomy (Antigravity-level capability)
                allowed = True

                def _kill_proc(p):
                    try:
                        if sys.platform == "win32":
                            subprocess.call(
                                ["taskkill", "/F", "/T", "/PID", str(p.pid)],
                                shell=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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

                def _chunk_reader(pipe, q):
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
                        # stdin as PIPE so manage_task send_input can feed interactive prompts
                        stdin=subprocess.PIPE,
                    )
                    if sys.platform == "win32":
                        popen_kwargs["creationflags"] = (
                            subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
                        )
                    else:
                        popen_kwargs["start_new_session"] = True

                    proc = subprocess.Popen(command, **popen_kwargs)
                    self._current_process = proc

                    stdout_q: _queue.Queue = _queue.Queue()
                    stderr_q: _queue.Queue = _queue.Queue()
                    t_out = threading.Thread(target=_chunk_reader, args=(proc.stdout, stdout_q), daemon=True)
                    t_err = threading.Thread(target=_chunk_reader, args=(proc.stderr, stderr_q), daemon=True)
                    t_out.start()
                    t_err.start()

                    task_id = _uuid.uuid4().hex[:8]
                    task_data = {
                        "id": task_id,
                        "proc": proc,
                        "stdout_q": stdout_q,
                        "stderr_q": stderr_q,
                        "t_out": t_out,
                        "t_err": t_err,
                        "command": command,
                        "workdir": workdir,
                        "start_time": _time.monotonic(),
                        "timeout": timeout_secs,
                        "aborted": False,
                        "status": "running",
                        "cumulative_out": b"",
                        "cumulative_err": b"",
                    }
                    self._bg_tasks[task_id] = task_data

                    # Synchronous wait period
                    sync_wait = (wait_ms / 1000.0) if wait_ms > 0 else timeout_secs
                    start = _time.monotonic()
                    last_stream_time = _time.monotonic()
                    while proc.poll() is None:
                        if getattr(self, "_abort_flag", False):
                            _kill_proc(proc)
                            t_out.join(1.0)
                            t_err.join(1.0)
                            self._current_process = None
                            task_data["status"] = "aborted"
                            return "Agent dihentikan oleh pengguna."

                        # Drain stdout and stderr from queue to cumulative buffers
                        changed = False
                        while not stdout_q.empty():
                            try:
                                task_data["cumulative_out"] += stdout_q.get_nowait()
                                changed = True
                            except Exception:
                                break
                        while not stderr_q.empty():
                            try:
                                task_data["cumulative_err"] += stderr_q.get_nowait()
                                changed = True
                            except Exception:
                                break

                        # Stream cumulative output every 0.5s
                        if changed and (_time.monotonic() - last_stream_time > 0.5):
                            last_stream_time = _time.monotonic()
                            if on_tool_output and tool_id:
                                out_s = task_data["cumulative_out"].decode("utf-8", errors="replace")
                                err_s = task_data["cumulative_err"].decode("utf-8", errors="replace")
                                combined = out_s
                                if err_s:
                                    combined += "\n[stderr]\n" + err_s
                                if len(combined) > 3000:
                                    combined = combined[:1000] + "\n...[truncated]...\n" + combined[-1800:]
                                try:
                                    on_tool_output(tool_id, combined)
                                except Exception:
                                    pass

                        if _time.monotonic() - start > sync_wait:
                            break
                        _time.sleep(0.05)

                    # Do final sync drain
                    while not stdout_q.empty():
                        try:
                            task_data["cumulative_out"] += stdout_q.get_nowait()
                        except Exception:
                            break
                    while not stderr_q.empty():
                        try:
                            task_data["cumulative_err"] += stderr_q.get_nowait()
                        except Exception:
                            break

                    finished_sync = proc.poll() is not None

                    if finished_sync:
                        # Process finished within sync window — return output directly
                        t_out.join(3.0)
                        t_err.join(3.0)
                        self._current_process = None
                        task_data["status"] = "done"

                        raw_out = task_data["cumulative_out"] + b"".join(list(stdout_q.queue))
                        raw_err = task_data["cumulative_err"] + b"".join(list(stderr_q.queue))
                        stdout_s = raw_out.decode("utf-8", errors="replace")
                        stderr_s = raw_err.decode("utf-8", errors="replace")
                        rc = proc.returncode

                        out_all = stdout_s
                        if stderr_s:
                            out_all += "\n[stderr]\n" + stderr_s
                        if rc not in (None, 0):
                            out_all += f"\n[exit code: {rc}]"

                        if len(out_all) > 8000:
                            head = out_all[:2000]
                            tail = out_all[-5000:]
                            out_all = f"{head}\n\n... [truncated] ...\n\n{tail}"

                        # Remove completed task
                        self._bg_tasks.pop(task_id, None)
                        return out_all or "(no output)"

                    else:
                        # Still running — hand off to background monitor thread
                        self._current_process = None

                        def _bg_monitor(td, agent_ref):
                            p = td["proc"]
                            last_stream_time_bg = _time.monotonic()
                            last_output_time = _time.monotonic()
                            last_notified_idle = False
                            
                            while p.poll() is None:
                                if td["aborted"] or getattr(agent_ref, "_abort_flag", False):
                                    _kill_proc(p)
                                    break
                                if _time.monotonic() - td["start_time"] > td["timeout"]:
                                    _kill_proc(p)
                                    td["status"] = "timeout"
                                    break

                                # Drain stdout and stderr from queue to cumulative buffers
                                changed_bg = False
                                while not td["stdout_q"].empty():
                                    try:
                                        td["cumulative_out"] += td["stdout_q"].get_nowait()
                                        changed_bg = True
                                    except Exception:
                                        break
                                while not td["stderr_q"].empty():
                                    try:
                                        td["cumulative_err"] += td["stderr_q"].get_nowait()
                                        changed_bg = True
                                    except Exception:
                                        break
                                        
                                if changed_bg:
                                    last_output_time = _time.monotonic()
                                    last_notified_idle = False

                                # Stream output from background task every 0.5s
                                if changed_bg and (_time.monotonic() - last_stream_time_bg > 0.5):
                                    last_stream_time_bg = _time.monotonic()
                                    if on_tool_output and tool_id:
                                        out_s = td["cumulative_out"].decode("utf-8", errors="replace")
                                        err_s = td["cumulative_err"].decode("utf-8", errors="replace")
                                        combined = out_s
                                        if err_s:
                                            combined += "\n[stderr]\n" + err_s
                                        if len(combined) > 3000:
                                            combined = combined[:1000] + "\n...[truncated]...\n" + combined[-1800:]
                                        try:
                                            on_tool_output(tool_id, combined)
                                        except Exception:
                                            pass

                                # Idle detection: if 8 seconds pass with no output, notify agent and try auto-input
                                _INTERACTIVE_PATTERNS = (
                                    b"? ", b"(y/n)", b"(yes/no)", b"[Y/n]", b"[y/N]",
                                    b"Press Enter", b"Continue?", b"Proceed?",
                                    b" > ", b":\n", b"confirm", b"password:",
                                    b"Do you want", b"Would you like",
                                )
                                if not last_notified_idle and (_time.monotonic() - last_output_time > 8.0):
                                    last_notified_idle = True
                                    # Check if process is waiting for input
                                    recent_out = td["cumulative_out"][-512:] + td["cumulative_err"][-256:]
                                    recent_lower = recent_out.lower()
                                    is_interactive = any(pat.lower() in recent_lower for pat in _INTERACTIVE_PATTERNS)
                                    if is_interactive:
                                        # Auto-send 'y\n' to unblock interactive prompt
                                        try:
                                            if p.stdin and not p.stdin.closed:
                                                p.stdin.write(b"y\n")
                                                p.stdin.flush()
                                                last_output_time = _time.monotonic()  # reset so we don't spam
                                                last_notified_idle = False
                                        except Exception:
                                            pass
                                    else:
                                        cb = getattr(agent_ref, "_bg_msg_callback", None)
                                        if cb:
                                            out_so_far = td["cumulative_out"].decode("utf-8", errors="replace")[-500:]
                                            msg = (
                                                f"<SYSTEM_MESSAGE>\n"
                                                f"[Background Task Idle] task_id={td['id']} is still running but has produced no new output for 8 seconds.\n"
                                                f"Command: {td['command']}\n"
                                                f"It might be waiting for user input (like 'y/n'). Use manage_task action='send_input' to feed input, or 'kill' to stop it.\n"
                                                f"Output so far:\n{out_so_far or '(no output)'}\n"
                                                f"</SYSTEM_MESSAGE>"
                                            )
                                            try:
                                                cb(msg)
                                            except Exception:
                                                pass

                                _time.sleep(0.1)

                            td["t_out"].join(3.0)
                            td["t_err"].join(3.0)

                            # Final background drain
                            while not td["stdout_q"].empty():
                                try:
                                    td["cumulative_out"] += td["stdout_q"].get_nowait()
                                except Exception:
                                    break
                            while not td["stderr_q"].empty():
                                try:
                                    td["cumulative_err"] += td["stderr_q"].get_nowait()
                                except Exception:
                                    break

                            raw_out = td["cumulative_out"] + b"".join(list(td["stdout_q"].queue))
                            raw_err = td["cumulative_err"] + b"".join(list(td["stderr_q"].queue))
                            out_s = raw_out.decode("utf-8", errors="replace")
                            err_s = raw_err.decode("utf-8", errors="replace")
                            combined = out_s
                            if err_s:
                                combined += "\n[stderr]\n" + err_s
                            if len(combined) > 6000:
                                combined_short = combined[:1500] + "\n...[truncated]...\n" + combined[-3500:]
                            else:
                                combined_short = combined

                            td["status"] = "done"
                            td["output"] = combined

                            # Update final output on the tool card
                            if on_tool_output and tool_id:
                                try:
                                    on_tool_output(tool_id, combined_short)
                                except Exception:
                                    pass

                            # Update tool card status to success/error
                            if on_tool_call and tool_id:
                                status = "success" if p.returncode == 0 else "error"
                                cmd_preview = json.dumps({"command": td["command"]})[:100]
                                try:
                                    # Must use the original API tool_id to resolve the UI card!
                                    on_tool_call("run_command", cmd_preview, status, tool_id)
                                except Exception:
                                    pass

                            # Fire callback → injects system message into chat and wakes agent
                            cb = getattr(agent_ref, "_bg_msg_callback", None)
                            if cb:
                                msg = (
                                    f"<SYSTEM_MESSAGE>\n"
                                    f"[Background Task Completed] task_id={td['id']}\n"
                                    f"Command: {td['command']}\n"
                                    f"Exit Code: {p.returncode}\n\n"
                                    f"Output:\n{combined or '(no output)'}\n"
                                    f"</SYSTEM_MESSAGE>"
                                )
                                try:
                                    cb(msg)
                                except Exception:
                                    pass

                            # Cleanup
                            agent_ref._bg_tasks.pop(td["id"], None)

                        threading.Thread(
                            target=_bg_monitor, args=(task_data, self), daemon=True
                        ).start()

                        running_cmds = "\n".join(
                            f"  - [{t['id']}] {t['command']}" for t in self._bg_tasks.values()
                        )
                        return (
                            f"Background task started. Task ID: {task_id}\n"
                            f"Command: {command}\n"
                            f"Running tasks:\n{running_cmds}\n\n"
                            f"Use manage_task with action='send_input' to feed interactive prompts (e.g. 'y\\n'), "
                            f"action='status' to check progress, or action='kill' to stop it."
                        )

                except FileNotFoundError:
                    self._current_process = None
                    return f"Error: command not found: {command.split()[0] if command else ''}"
                except Exception as ex:
                    self._current_process = None
                    return f"Error running command: {str(ex)}"



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
                        
                    self._backup_file(path)
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
                        
                    self._backup_file(path)
                    
                    for r in replacements:
                        target = r.get("targetContent", "")
                        replacement = r.get("replacementContent", "")
                        content = content.replace(target, replacement, 1)
                        
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(content)
                    return f"Successfully applied {len(replacements)} replacements in {path}"
                except Exception as e:
                    return f"Error applying multi-replace: {str(e)}"

            elif name == "web_search":
                from dardcor_agent.capabilities.web import web_search
                query = args.get("query", "")
                if not query:
                    return "Error: No query specified"
                return json.dumps(web_search(query, max_results=int(args.get("max_results", 5) or 5)), indent=2)

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

            elif name == "web_fetch":
                from dardcor_agent.capabilities.web import web_fetch
                result = web_fetch(args.get("url", ""), allow_local=bool(args.get("allow_local", False)))
                return json.dumps(result, indent=2)

            elif name == "create_embedding":
                from dardcor_agent.capabilities.embeddings import create_embedding, save_embedding
                text = args.get("text", "")
                if not text:
                    return "Error: No text specified"
                result = create_embedding(text)
                save_as = args.get("save_as", "")
                if save_as:
                    result["saved_path"] = save_embedding(save_as, result)
                return json.dumps(result, indent=2)

            elif name == "generate_image":
                from dardcor_agent.capabilities.media import generate_image
                ai = getattr(self._config, "ai", None)
                result = generate_image(
                    args.get("prompt", ""),
                    api_key=getattr(ai, "api_key", ""),
                    base_url=getattr(ai, "base_url", "") or "https://api.openai.com/v1",
                )
                return json.dumps(result, indent=2)

            elif name == "speech_to_text":
                from dardcor_agent.capabilities.media import speech_to_text
                ai = getattr(self._config, "ai", None)
                result = speech_to_text(
                    args.get("path", ""),
                    api_key=getattr(ai, "api_key", ""),
                    base_url=getattr(ai, "base_url", "") or "https://api.openai.com/v1",
                )
                return json.dumps(result, indent=2)

            elif name == "text_to_speech":
                from dardcor_agent.capabilities.media import text_to_speech
                ai = getattr(self._config, "ai", None)
                result = text_to_speech(
                    args.get("text", ""),
                    api_key=getattr(ai, "api_key", ""),
                    base_url=getattr(ai, "base_url", "") or "https://api.openai.com/v1",
                    voice=args.get("voice", "alloy"),
                )
                return json.dumps(result, indent=2)

            elif name == "list_skills":
                from dardcor_agent.capabilities.skills import list_skills
                return json.dumps(list_skills(), indent=2)

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
                import time as _mt
                action = args.get("action", "").strip().lower()
                task_id = args.get("task_id", "").strip()
                input_text = args.get("input_text", "")

                if action == "list":
                    tasks = self._bg_tasks
                    if not tasks:
                        return "No background tasks currently running."
                    lines = ["Running Background Tasks:"]
                    for tid, td in tasks.items():
                        elapsed = _mt.monotonic() - td["start_time"]
                        lines.append(
                            f"  [{tid}] status={td['status']} elapsed={elapsed:.1f}s cmd={td['command']}"
                        )
                    return "\n".join(lines)

                elif action == "status":
                    if not task_id:
                        return "Error: task_id is required for action='status'"
                    td = self._bg_tasks.get(task_id)
                    if td is None:
                        return f"Task '{task_id}' not found or already completed."
                    proc = td["proc"]
                    elapsed = _mt.monotonic() - td["start_time"]
                    rc = proc.poll()
                    status = td.get("status", "running")
                    # Collect partial output buffered so far
                    import queue as _q2
                    partial = b""
                    q = td["stdout_q"]
                    try:
                        while True:
                            partial += q.get_nowait()
                    except _q2.Empty:
                        pass
                    out_so_far = partial.decode("utf-8", errors="replace")
                    return (
                        f"Task {task_id} — status={status} elapsed={elapsed:.1f}s "
                        f"exit_code={rc}\nPartial output so far:\n{out_so_far[-2000:] or '(none yet)'}"
                    )

                elif action == "kill":
                    if not task_id:
                        return "Error: task_id is required for action='kill'"
                    td = self._bg_tasks.get(task_id)
                    if td is None:
                        return f"Task '{task_id}' not found or already completed."
                    td["aborted"] = True
                    try:
                        import subprocess as _sp
                        p = td["proc"]
                        if sys.platform == "win32":
                            _sp.call(
                                ["taskkill", "/F", "/T", "/PID", str(p.pid)],
                                shell=False, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL,
                            )
                        else:
                            p.kill()
                    except Exception as _ke:
                        return f"Task {task_id}: attempted kill, result: {_ke}"
                    td["status"] = "killed"
                    return f"Task {task_id} killed successfully."

                elif action == "send_input":
                    if not task_id:
                        return "Error: task_id is required for action='send_input'"
                    td = self._bg_tasks.get(task_id)
                    if td is None:
                        return f"Task '{task_id}' not found or already completed."
                    proc = td["proc"]
                    if proc.stdin is None or proc.stdin.closed:
                        return f"Task {task_id}: stdin is not available (process may have exited)."
                    try:
                        # Ensure newline so the process sees a complete line
                        data = input_text if input_text.endswith("\n") else input_text + "\n"
                        proc.stdin.write(data.encode("utf-8"))
                        proc.stdin.flush()
                        return f"Sent input to task {task_id}: {repr(data)}"
                    except Exception as _se:
                        return f"Error sending input to task {task_id}: {_se}"

                else:
                    return f"Error: Unknown manage_task action '{action}'. Valid: list, status, kill, send_input"

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

            elif name in ("git_status", "git_diff", "git_log", "check_syntax"):
                import subprocess as _subprocess2

                workspace = self._config.workspace_path or os.getcwd()
                if name == "git_status":
                    cmd = ["git", "status", "--short"]
                elif name == "git_diff":
                    target = args.get("path", "")
                    cmd = ["git", "diff", "--"] + ([target] if target else [])
                elif name == "git_log":
                    limit = str(int(args.get("limit", 10)))
                    cmd = ["git", "log", f"-{limit}", "--oneline"]
                else:
                    target = args.get("path", "")
                    if not target:
                        return "Error: No path specified"
                    if not os.path.isabs(target):
                        target = os.path.join(workspace, target)
                    cmd = [sys.executable, "-m", "py_compile", target] if os.path.isfile(target) else [sys.executable, "-m", "compileall", "-q", target]

                proc = _subprocess2.run(
                    cmd,
                    cwd=workspace,
                    text=True,
                    stdout=_subprocess2.PIPE,
                    stderr=_subprocess2.STDOUT,
                    timeout=60,
                )
                output = proc.stdout.strip()
                if proc.returncode != 0:
                    output = (output + f"\n[exit code: {proc.returncode}]").strip()
                return output or "(no output)"

            elif name == "detect_project":
                workspace = self._config.workspace_path or os.getcwd()
                markers = {
                    "package.json": "Node/JavaScript",
                    "pyproject.toml": "Python",
                    "requirements.txt": "Python",
                    "Cargo.toml": "Rust",
                    "go.mod": "Go",
                    "pom.xml": "Java/Maven",
                    "build.gradle": "Java/Gradle",
                }
                found = [f"{fname}: {kind}" for fname, kind in markers.items() if os.path.exists(os.path.join(workspace, fname))]
                tests = []
                if os.path.exists(os.path.join(workspace, "pytest.ini")) or os.path.isdir(os.path.join(workspace, "tests")):
                    tests.append(f"{sys.executable} -m unittest discover -s tests")
                if os.path.exists(os.path.join(workspace, "package.json")):
                    tests.append("npm test")
                if not found:
                    return "No common project markers found."
                return "Project markers:\n" + "\n".join(found) + ("\nLikely tests:\n" + "\n".join(tests) if tests else "")

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

            elif name == "delete_file":
                path = args.get("path", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                if os.path.isfile(path):
                    os.remove(path)
                    return f"File deleted: {path}"
                elif os.path.isdir(path):
                    import shutil
                    shutil.rmtree(path)
                    return f"Directory deleted: {path}"
                else:
                    return f"Error: Path not found: {path}"

            elif name == "move_file":
                src = args.get("source_path", "")
                dst = args.get("dest_path", "")
                if not src or not dst:
                    return "Error: source_path and dest_path are required"
                ws = self._config.workspace_path
                if not os.path.isabs(src) and ws:
                    src = os.path.join(ws, src)
                if not os.path.isabs(dst) and ws:
                    dst = os.path.join(ws, dst)
                if not os.path.exists(src):
                    return f"Error: Source not found: {src}"
                import shutil
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.move(src, dst)
                return f"Moved: {src} -> {dst}"

            elif name == "append_to_file":
                path = args.get("path", "")
                content = args.get("content", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "a", encoding="utf-8") as f:
                    f.write(content)
                return f"Content appended to: {path}"

            elif name == "check_file_exists":
                path = args.get("path", "")
                if not path:
                    return "Error: No path specified"
                if not os.path.isabs(path) and self._config.workspace_path:
                    path = os.path.join(self._config.workspace_path, path)
                exists = os.path.exists(path)
                kind = "file" if os.path.isfile(path) else ("directory" if os.path.isdir(path) else "unknown")
                return f"Exists: {exists}" + (f" (type: {kind})" if exists else "")

            elif name == "create_artifact":
                title = args.get("title", "artifact").replace(" ", "_").lower()
                if not title.endswith(".md"):
                    title += ".md"
                content = args.get("content", "")
                
                artifacts_dir = os.path.join(get_user_data_dir(), "artifacts")
                os.makedirs(artifacts_dir, exist_ok=True)
                
                path = os.path.join(artifacts_dir, title)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
                    
                if on_tool_output:
                    # We can use on_notification but _execute_tool signature doesn't take it directly in all versions
                    # We'll rely on the agent to emit a message, or we can use sys.stdout
                    pass
                    
                return f"Artifact created at {path} and opened in UI. ARTIFACT_CREATED:{path}"

            elif name == "ask_question":
                question = args.get("question", "")
                return "__AWAIT_USER_INPUT__:" + question
                
            elif name == "open_browser":
                url = args.get("url", "")
                return f"Browser opened at {url}. BROWSER_OPENED:{url}"

            elif name == "browser_open":
                from dardcor_agent.chat.browser_control import open_controlled_browser
                url = args.get("url", "")
                if not url:
                    return "Error: No URL specified"
                result = open_controlled_browser(url)
                return json.dumps(result, indent=2) + f"\nBROWSER_OPENED:{url}"

            elif name == "browser_observe":
                from dardcor_agent.chat.browser_control import observe_browser
                return json.dumps(observe_browser(), indent=2)

            elif name == "browser_eval":
                from dardcor_agent.chat.browser_control import browser_eval
                return json.dumps(browser_eval(args.get("script", "")), indent=2)

            elif name == "browser_click":
                from dardcor_agent.chat.browser_control import browser_click
                return json.dumps(browser_click(int(args.get("x", 0)), int(args.get("y", 0))), indent=2)

            elif name == "browser_type":
                from dardcor_agent.chat.browser_control import browser_type
                return json.dumps(browser_type(args.get("text", "")), indent=2)

            elif name == "browser_screenshot":
                from dardcor_agent.chat.browser_control import browser_screenshot
                return json.dumps(browser_screenshot(), indent=2)

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
