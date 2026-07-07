<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0017,40:1a0033,80:2d0055,100:3d006e&height=240&section=header&text=DARDCOR%20CODE&fontSize=72&fontColor=d4b8ff&animation=fadeIn&fontAlignY=42&desc=The%20AI%20That%20Doesn%27t%20Just%20Talk%20%E2%80%94%20It%20Acts.&descAlignY=64&descSize=22&fontStyle=bold" width="100%"/>

<br/>

**Full Desktop AI Coding Assistant — VS Code-like IDE built entirely in Python**

[![PyPI](https://img.shields.io/pypi/v/dardcor-code?color=%234f8ff7&label=version&style=for-the-badge&logo=python&logoColor=ffffff&labelColor=1a1a24)](https://pypi.org/project/dardcor-code/)
[![License: MIT](https://img.shields.io/badge/License-MIT-111118?style=for-the-badge&labelColor=0a0a0f&color=4f8ff7)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?style=for-the-badge&logo=python&logoColor=ffffff&labelColor=1a1a24)](https://python.org)
[![PySide6](https://img.shields.io/badge/UI-PySide6-41CD52?style=for-the-badge&logo=qt&logoColor=ffffff&labelColor=1a1a24)](https://pypi.org/project/PySide6/)
[![Monaco](https://img.shields.io/badge/Editor-Monaco-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=ffffff&labelColor=1a1a24)](https://microsoft.github.io/monaco-editor/)

**AI Pair Programming · Monaco Editor · Integrated PTY Terminal · Native Desktop**

</div>

---

## What Is Dardcor Code?

Dardcor Code is an open-source **desktop AI coding assistant** and VS Code-like IDE built entirely in Python with PySide6. It brings together a native desktop shell, Monaco Editor, integrated terminal, file explorer, source control, debugging panels, extension views, and an agentic AI chat assistant in one cohesive development environment.

The goal is simple: deliver a fast, hackable, native IDE that feels familiar to developers, stays transparent for contributors, and gives AI agents practical tools to inspect, edit, run, and reason about real projects.

Unlike browser-only editors or Electron apps, Dardcor Code runs as a **native desktop application** while still using Monaco through embedded `QWebEngineView` for the familiar code editing experience.

---

## Why Dardcor Code?

- **Native Python desktop app** — easy to inspect, modify, package, and extend.
- **VS Code-inspired workflow** — activity bar, sidebar, tabs, terminal, source control, command palette, and quick open.
- **Agent-first design** — AI can work with the project through structured tools, not only plain chat.
- **Provider-flexible AI layer** — use API keys, local endpoints, OpenAI-compatible providers, or supported OAuth flows.
- **Open-source friendly** — clear configuration, local-first storage, and no hardcoded real credentials.
- **Practical editor core** — Monaco gives modern editing behavior while PySide6 keeps the app native.

---

## Features

### 🖥️ VS Code-Style Interface

- **Custom frameless title bar** with integrated menu bar, Chrome agent launcher, and native window controls (minimize, maximize/restore, close)
- **Activity bar** with Explorer, Search, Source Control, Debug, and Extensions views
- **Resizable split panels** — sidebar, editor area, chat panel, and terminal can all be resized independently
- **Status bar** showing cursor position, language mode, encoding, EOL, git branch, indentation, and AI engine status

### 📝 Monaco Code Editor

- **Full Monaco Editor** embedded via `QWebEngineView` + `QWebChannel` bridge — the same editor engine used by VS Code
- **Syntax highlighting for 30+ languages**: Python, JavaScript, TypeScript, Go, Rust, C/C++, C#, Java, HTML, CSS, SCSS, JSON, YAML, Markdown, SQL, Shell, PowerShell, Ruby, PHP, Swift, Kotlin, Dart, Lua, R, GraphQL, HCL, Protocol Buffers, and more
- **Find & Replace** (Ctrl+F / Ctrl+H) with Monaco's built-in search widget
- **Minimap** toggle for code overview
- **Word wrap** toggle (Alt+Z)
- **Zoom in/out** (Ctrl+= / Ctrl+-)
- **Bracket matching**, auto-indentation, and smart editing features
- **Split editor** — open the same or different files side by side (Ctrl+\\)
- **Tab management** with dirty indicators (● marker), close confirmation for unsaved changes, and draggable tabs

### 🧠 AI Agent Integration

- **Built-in AI coding assistant** with tool-calling capabilities for files, commands, search, git, project detection, and syntax checks
- **Chat panel** (VS Code Copilot Chat style) — type questions, get AI-powered answers and code modifications
- **Agentic loop** — the AI can chain tool calls per request to accomplish complex tasks autonomously
- **Conversation memory** — chat history is persisted to `~/.dardcor-code/conversations/` as JSON files
- **Direct OAuth login** support for subscription-style Codex/Claude flows where available
- **Secure token storage** in the user data directory; real API keys and OAuth tokens are not hardcoded

### 🌐 Multi-Provider AI Support

| Provider | Default Base URL | Example Models |
|----------|-----------------|----------------|
| **OpenAI / Codex** | `api.openai.com/v1` / OAuth backend | GPT and Codex models |
| **Anthropic / Claude** | `api.anthropic.com/v1` / OAuth backend | Claude Sonnet, Opus, Haiku |
| **Google Gemini** | `generativelanguage.googleapis.com/v1beta/openai` | Gemini Flash, Gemini Pro |
| **DeepSeek** | `api.deepseek.com/v1` | `deepseek-chat`, `deepseek-coder` |
| **OpenRouter** | `openrouter.ai/api/v1` | Any model via OpenRouter |
| **Ollama** | `localhost:11434/v1` | `llama3`, `codellama`, `mistral` |
| **NVIDIA NIM** | `integrate.api.nvidia.com/v1` | NVIDIA-hosted models |
| **Groq / Mistral / Cohere / Perplexity / MiMo** | Provider-specific | Registry-backed model lists |

Most API-key providers use an **OpenAI-compatible chat completions** shape. Subscription and OAuth providers use provider-specific adapters where required. Custom base URLs are supported for self-hosted models, local gateways, and proxy setups.

### 📁 File Explorer

- **Tree view** with lazy loading and VS Code-style expand/collapse chevrons
- **SVG file icons** — language-specific icons for Python, JSON, Markdown, TOML, Git files, and generic file/folder icons
- **Context menu** — New File, New Folder, Rename, Delete, Copy Path, Copy Relative Path
- **Open Folder** dialog to switch workspace
- **Auto-filtering** of hidden dirs, `__pycache__`, `node_modules`, `.git`, `.venv`, etc.

### ⌨️ Integrated Terminal

- **Full PTY terminal** powered by `pywinpty` (Windows) with xterm.js frontend via `QWebEngineView`
- **Fallback to QProcess** if PTY is not available
- **Multiple terminal tabs** — create, switch, and close terminal instances
- **Dynamic resize** — terminal responds to panel resize events
- **Supports all shells**: PowerShell, CMD, Bash, Zsh, etc.

### 🔍 Full-Text Search

- **Search across all files** in the workspace with regex, case-sensitive, and whole-word options
- **Replace All** functionality across files
- **File include/exclude filters** (e.g., `*.py`, `src/`)
- **Results tree view** — click to jump directly to the matching file and line
- **Performance** — skips binary files and common large directories automatically

### 🔀 Git Integration

- **Full Source Control panel** — view staged, unstaged, and untracked files
- **Commit** with message input, **Stage/Unstage** individual files, **Discard** changes
- **Sync** (pull --rebase + push) with a single click
- **Auto-refresh** every 3 seconds to detect changes
- **Status-colored file names** — modified (yellow), added (green), deleted (red), renamed (purple)
- **Branch display** in status bar

### 🎨 Command Palette & Quick Open

- **Command Palette** (Ctrl+Shift+P) — search and execute any command with keyboard shortcut hints
- **Quick Open** (Ctrl+P) — fuzzy search for files across the workspace (up to 5,000 files indexed)
- **Go to Line** (Ctrl+G) — jump to a specific line number in the current editor

### ⚙️ Settings

- **Settings dialog** (Ctrl+,) with tabs for AI Model, Editor, Workspace, and About
- **Configurable**: AI provider, model, API key, base URL, temperature, max tokens
- **Editor options**: font family, font size, tab size, word wrap, minimap, auto-save
- **Persistent config** stored at `~/.dardcor-code/config.json`
- **Environment variable support**: `DARDCOR_CODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and provider-specific keys

### 🌐 Chrome Agent Launcher

- **Built-in Chrome button** in the title bar opens Google Chrome with an **isolated agent-specific profile**
- Profile stored in `.dardcor_chrome_profile/` — keeps agent browsing separate from personal Chrome data
- Auto-detects Chrome installation path on Windows, Linux, and macOS

---

## Quick Start

### Prerequisites
- **Python 3.9** or later
- **PySide6 >= 6.6.0** (installed automatically via pip)
- **pywinpty >= 2.0.1** (Windows only, installed automatically)

### Install via pip

```bash
pip install dardcor-code
```

### Launch the IDE

```bash
# Launch with explicit command
dardcor desktop

# Or simply run (desktop is the default command)
dardcor
```

### Install from Source

```bash
git clone https://github.com/Dardcor/dardcor-code.git
cd dardcor-code
pip install -e .
dardcor desktop
```

---

## CLI Commands

```bash
# Launch the desktop IDE (default when no command is specified)
dardcor desktop

# Check installation status
dardcor status

# Show version
dardcor version
dardcor --version
```

---

## Configuration

### API Key Setup

Set your API key using **one** of these methods:

1. **Settings dialog** — press `Ctrl+,`, go to "AI Model" tab, and enter your API key
2. **Environment variable** — set `DARDCOR_CODE_API_KEY` (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)
3. **Config file** — edit `~/.dardcor-code/config.json` directly

### Config File

Configuration is stored at `~/.dardcor-code/config.json`:

```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o",
    "api_key": "",
    "base_url": "",
    "max_tokens": 128000,
    "temperature": 0.7,
    "system_prompt": "You are Dardcor Code, an expert AI coding assistant..."
  },
  "workspace_path": "",
  "auto_save": true,
  "font_family": "Cascadia Code",
  "font_size": 13,
  "tab_size": 4,
  "word_wrap": false,
  "minimap_enabled": true,
  "terminal_shell": ""
}
```

Secrets are kept out of source control. OAuth tokens are stored under the user data directory, and `.env` files are ignored by git.

---

## Keyboard Shortcuts

### General

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+P` | Quick Open File |
| `Ctrl+,` | Open Settings |
| `Ctrl+Q` | Exit |
| `Alt+F4` | Close Window |

### File Operations

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New File |
| `Ctrl+O` | Open File |
| `Ctrl+K` | Open Folder |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+W` | Close Editor |
| `Ctrl+Shift+N` | New Window |

### Editor

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Find |
| `Ctrl+H` | Find and Replace |
| `Ctrl+G` | Go to Line |
| `Ctrl+\` | Split Editor |
| `Ctrl+=` | Zoom In |
| `Ctrl+-` | Zoom Out |
| `Alt+Z` | Toggle Word Wrap |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+A` | Select All |

### Panels

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Toggle Sidebar |
| `Ctrl+Shift+J` | Toggle Chat Panel |
| `` Ctrl+` `` | Toggle Terminal |
| `Ctrl+Shift+E` | Show Explorer |
| `Ctrl+Shift+F` | Show Search / Find in Files |
| `Ctrl+Shift+G` | Show Source Control |
| `Ctrl+Shift+X` | Show Extensions |

### Run & Debug


| Shortcut | Action |
|----------|--------|
| `F5` | Start Debugging |
| `Ctrl+F5` | Run Without Debugging |
| `F9` | Toggle Breakpoint |

---

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **UI Framework** | PySide6 (Qt 6 for Python) | Native desktop widgets, window management, layout |
| **Code Editor** | Monaco Editor via QWebEngineView | Syntax highlighting, IntelliSense-ready, find/replace |
| **Terminal** | xterm.js + pywinpty (Win) / pty (Unix) | Full PTY terminal emulation |
| **AI Communication** | `urllib.request` (stdlib) | Zero-dependency HTTP calls to LLM APIs |
| **Configuration** | `dataclasses` + JSON | Persistent settings in `~/.dardcor-code/` |
| **File Operations** | `os`, `shutil`, `re`, `fnmatch` | Cross-platform file I/O, search, glob |
| **Bridge** | QWebChannel | Bidirectional Python↔JavaScript communication |

### AI Agent Tool System

The AI agent has access to built-in tools that it calls automatically during conversations:

| Tool | Description |
|------|-------------|
| `read_file` | Read the contents of any file (truncated at 50KB) |
| `write_file` | Create or overwrite a file with new content |
| `run_command` | Execute a shell command with 30s timeout |
| `search_files` | Grep across files for a text pattern |
| `list_files` | List files in a directory (optionally recursive) |
| `git_status` / `git_diff` | Inspect source control state |
| `check_syntax` | Run quick syntax checks |
| `detect_project` | Detect project type and tooling |

The agent executes tools in an **agentic loop** — after each tool call, the result is fed back to the LLM, which can then decide to call more tools or provide a final response (up to 10 iterations).

---

## Platform Support

| Platform | Status | Terminal Backend |
|----------|--------|-----------------|
| **Windows** | ✅ Full support | pywinpty (PTY) → QProcess fallback |
| **Linux** | ✅ Full support | pty.fork() (PTY) → QProcess fallback |
| **macOS** | ✅ Full support | pty.fork() (PTY) → QProcess fallback |

### Windows-Specific Features
- Native `WM_NCHITTEST` handling for frameless window resizing from all edges and corners
- `SetCurrentProcessExplicitAppUserModelID` for proper taskbar grouping
- `SIGBREAK` signal handling for graceful shutdown

---

## Security and Credentials

Dardcor Code is designed to keep credentials local and explicit.

- Real API keys are never hardcoded.
- `.env`, local databases, OAuth token files, and secret files are ignored by git.
- OAuth tokens are stored under the user data directory, not in tracked source files.
- Agent tool execution is visible and should be reviewed like any other code-changing automation.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and secret-handling guidance.

---

## Contributing

Dardcor Code is built for contributors who want a Python-native IDE they can understand and modify. Small focused pull requests are preferred, especially when they improve editor behavior, AI provider support, terminal reliability, performance, accessibility, or documentation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup steps, test commands, and contribution guidelines.

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

<br/>

**Built with 💜 by [Dardcor](https://github.com/Dardcor) · [Report Issues](https://github.com/Dardcor/dardcor-code/issues)**

*If this project saves you time, a ⭐ means everything.*

<br/>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:3d006e,50:1a0033,100:0d0017&height=140&section=footer" width="100%"/>

</div>

