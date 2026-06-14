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
        self.permission_callback = None
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
                
                # Command execution safety check
                if self.permission_callback:
                    allowed = self.permission_callback(command)
                    if not allowed:
                        return "Error: Command execution denied by user."
                        
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

            elif name == "replace_file_content":
                path = args.get("path", "")
                target = args.get("targetContent", "")
                replacement = args.get("replacementContent", "")
                if not path or not os.path.isfile(path):
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
                if not path or not os.path.isfile(path):
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

            else:
                return f"Unknown tool: {name}"

        except Exception as e:
            return f"Error executing {name}: {str(e)}"

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

    def load_conversation(self, conv_id: str) -> bool:
        conv = self._store.load(conv_id)
        if conv:
            self._conversation = conv
            return True
        return False
