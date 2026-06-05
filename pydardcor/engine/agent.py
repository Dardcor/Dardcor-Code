"""AI Agent engine for Dardcor Code."""

import os
import json
import threading
from typing import Callable, Optional, List, Dict, Any

from .config import get_config, AppConfig
from .memory import Conversation, ConversationStore, Message
from .commands import CommandExecutor, CommandResult
from .filesystem import FileSystem


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
            "description": "Execute a shell command and return output",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run"},
                    "workdir": {"type": "string", "description": "Working directory (optional)"},
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
        self._fs = FileSystem()
        self._cmd = CommandExecutor()
        self._stream_callback = None
        self._lock = threading.Lock()

        # Add system message
        if self._config.ai.system_prompt:
            self._conversation.add_message("system", self._config.ai.system_prompt)

    @property
    def config(self) -> AppConfig:
        return self._config

    def on_stream(self, callback: Callable[[str], None]):
        self._stream_callback = callback

    def new_conversation(self):
        if self._conversation.messages:
            self._store.save(self._conversation)
        self._conversation = Conversation()
        if self._config.ai.system_prompt:
            self._conversation.add_message("system", self._config.ai.system_prompt)

    def send_message(
        self,
        message: str,
        on_tool_call: Callable[[str, str, str], None] = None,
    ) -> str:
        self._conversation.add_message("user", message)

        try:
            response_text = self._call_api(on_tool_call)
            self._store.save(self._conversation)
            return response_text
        except Exception as e:
            error_msg = f"Error: {str(e)}"
            self._conversation.add_message("assistant", error_msg)
            return error_msg

    def _call_api(self, on_tool_call=None, depth=0) -> str:
        if depth > 10:
            return "Maximum tool call depth reached."

        config = self._config.ai
        api_key = config.api_key
        provider = config.provider
        model = config.model
        base_url = _get_provider_url(provider, config.base_url)

        if not api_key and provider not in ("ollama",):
            return (
                "No API key configured. Go to Settings (Ctrl+,) to set your API key, "
                "or set the DARDCOR_CODE_API_KEY environment variable."
            )

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        # Anthropic uses different header
        if provider == "anthropic":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"

        messages = self._conversation.get_api_messages()

        payload = {
            "model": model or "gpt-4o",
            "messages": messages,
            "tools": TOOLS,
            "temperature": config.temperature,
            "max_tokens": min(config.max_tokens, 16384),
        }

        try:
            import urllib.request
            import urllib.error

            url = f"{base_url.rstrip('/')}/chat/completions"
            data = json.dumps(payload).encode("utf-8")

            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            choice = result["choices"][0]
            msg = choice["message"]
            content = msg.get("content", "") or ""
            tool_calls = msg.get("tool_calls", [])

            if tool_calls:
                # Add assistant message with tool calls
                self._conversation.add_message("assistant", content, tool_calls=tool_calls)

                # Execute each tool call
                for tc in tool_calls:
                    func_name = tc["function"]["name"]
                    try:
                        func_args = json.loads(tc["function"]["arguments"])
                    except json.JSONDecodeError:
                        func_args = {}

                    if on_tool_call:
                        on_tool_call(func_name, json.dumps(func_args)[:100], "running")

                    tool_result = self._execute_tool(func_name, func_args)

                    if on_tool_call:
                        status = "success" if not tool_result.startswith("Error") else "error"
                        on_tool_call(func_name, json.dumps(func_args)[:100], status)

                    self._conversation.add_message(
                        "tool",
                        tool_result,
                        tool_call_id=tc["id"],
                        name=func_name,
                    )

                # Recurse to get final response
                return self._call_api(on_tool_call, depth + 1)
            else:
                self._conversation.add_message("assistant", content)
                return content

        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            return f"API Error ({e.code}): {body[:500]}"
        except Exception as e:
            return f"Connection error: {str(e)}"

    def _execute_tool(self, name: str, args: dict) -> str:
        try:
            if name == "read_file":
                path = args.get("path", "")
                if not path or not os.path.isfile(path):
                    return f"Error: File not found: {path}"
                content = self._fs.read_file(path)
                if len(content) > 50000:
                    content = content[:50000] + "\n... (truncated)"
                return content

            elif name == "write_file":
                path = args.get("path", "")
                content = args.get("content", "")
                if not path:
                    return "Error: No path specified"
                self._fs.write_file(path, content)
                return f"File written successfully: {path}"

            elif name == "run_command":
                command = args.get("command", "")
                workdir = args.get("workdir", self._config.workspace_path or None)
                if not command:
                    return "Error: No command specified"
                result = self._cmd.execute(command, workdir=workdir, timeout=30)
                output = ""
                if result.stdout:
                    output += result.stdout
                if result.stderr:
                    output += "\n[stderr]\n" + result.stderr
                if result.timed_out:
                    output += "\n[timed out]"
                return output or "(no output)"

            elif name == "search_files":
                query = args.get("query", "")
                path = args.get("path", self._config.workspace_path or os.getcwd())
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
                path = args.get("path", self._config.workspace_path or os.getcwd())
                recursive = args.get("recursive", False)
                files = self._fs.list_dir(path, recursive=recursive)
                if not files:
                    return "No files found."
                return "\n".join(files[:200])

            else:
                return f"Unknown tool: {name}"

        except Exception as e:
            return f"Error executing {name}: {str(e)}"

    def get_conversation(self) -> Conversation:
        return self._conversation

    def list_conversations(self) -> list:
        return self._store.list_conversations()

    def load_conversation(self, conv_id: str) -> bool:
        conv = self._store.load(conv_id)
        if conv:
            self._conversation = conv
            return True
        return False
