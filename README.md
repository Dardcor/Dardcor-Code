<div align="center">

# DARDCOR CODE

**Full Desktop AI Coding Assistant — VS Code-like IDE built entirely in Python**

[![PyPI](https://img.shields.io/pypi/v/dardcor-code?color=%234f8ff7&label=version&style=for-the-badge&logo=python&logoColor=ffffff&labelColor=1a1a24)](https://pypi.org/project/dardcor-code/)
[![License: MIT](https://img.shields.io/badge/License-MIT-111118?style=for-the-badge&labelColor=0a0a0f&color=4f8ff7)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?style=for-the-badge&logo=python&logoColor=ffffff&labelColor=1a1a24)](https://python.org)
[![PySide6](https://img.shields.io/badge/UI-PySide6-41CD52?style=for-the-badge&logo=qt&logoColor=ffffff&labelColor=1a1a24)](https://pypi.org/project/PySide6/)
[![Monaco](https://img.shields.io/badge/Editor-Monaco-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=ffffff&labelColor=1a1a24)](https://microsoft.github.io/monaco-editor/)

**AI Pair Programming · Monaco Editor · Integrated PTY Terminal · Native Desktop**

</div>

---

## What is Dardcor Code?

Dardcor Code is a **full-featured desktop IDE** built entirely in Python with PySide6 (Qt). It delivers a VS Code-like experience — complete with Monaco Editor, xterm.js terminal, and AI pair programming — as a single `pip install` package with zero external dependencies beyond Python.

Unlike browser-based editors or Electron apps, Dardcor Code runs as a **native desktop application** with minimal memory footprint while still providing the full Monaco editing experience through embedded `QWebEngineView`.

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
- **Built-in AI coding assistant** with tool-calling capabilities (read files, write files, run commands, search code, list files)
- **Chat panel** (VS Code Copilot Chat style) — type questions, get AI-powered answers and code modifications
- **Agentic loop** — the AI can chain up to 10 tool calls per request to accomplish complex tasks autonomously
- **Conversation memory** — chat history is persisted to `~/.dardcor-code/conversations/` as JSON files
- **System prompt** customizable via config
- **Streaming-ready architecture** with callback support

### 🌐 Multi-Provider AI Support
| Provider | Default Base URL | Example Models |
|----------|-----------------|----------------|
| **OpenAI** | `api.openai.com/v1` | `gpt-4o`, `gpt-4`, `gpt-3.5-turbo` |
| **Anthropic** | `api.anthropic.com/v1` | `claude-sonnet-4-20250514`, `claude-3.5-sonnet` |
| **Google Gemini** | `generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash`, `gemini-1.5-pro` |
| **DeepSeek** | `api.deepseek.com/v1` | `deepseek-chat`, `deepseek-coder` |
| **OpenRouter** | `openrouter.ai/api/v1` | Any model via OpenRouter |
| **Ollama** | `localhost:11434/v1` | `llama3`, `codellama`, `mistral` |
| **NVIDIA NIM** | `integrate.api.nvidia.com/v1` | NVIDIA-hosted models |

All providers use the **OpenAI-compatible chat completions API** format. Custom base URLs are supported for self-hosted or proxy setups.

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
- **Environment variable support**: `DARDCOR_CODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`

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

## Architecture

```
pydardcor/                          # Main Python package
├── __init__.py                     # Package metadata (version, author)
├── __main__.py                     # python -m pydardcor entry point
├── app.py                          # QApplication setup, HiDPI, theming, signal handling
├── cli.py                          # CLI argument parser (desktop, status, version)
│
├── engine/                         # Backend logic (no GUI dependencies)
│   ├── agent.py                    # AI Agent with tool-calling loop (5 tools)
│   ├── config.py                   # AppConfig / AIConfig dataclasses + JSON persistence
│   ├── commands.py                 # Shell command executor with streaming + timeout
│   ├── filesystem.py               # File I/O, grep, glob, directory listing
│   └── memory.py                   # Conversation / Message models + ConversationStore
│
├── editor/                         # Monaco Editor integration
│   ├── widget.py                   # MonacoEditorWidget (QWebEngineView + QWebChannel)
│   ├── bridge.py                   # EditorBridge — Python↔JavaScript communication
│   ├── language.py                 # Language detection from file extension (30+ languages)
│   ├── group.py                    # EditorGroup — tab bar + stacked Monaco instances
│   └── tabs.py                     # EditorTabs — split view manager (QSplitter)
│
├── terminal/                       # Integrated terminal
│   ├── instance.py                 # TerminalInstance — PTY + xterm.js via QWebEngineView
│   ├── panel.py                    # TerminalPanel — multi-tab terminal container
│   ├── bridge.py                   # TerminalBridge — Python↔xterm.js communication
│   ├── backend.py                  # Shell detection + PTY reader thread
│   ├── win_backend.py              # Windows-specific pywinpty backend
│   └── unix_backend.py             # Unix/macOS pty.fork() backend
│
├── browser/                        # Chrome integration
│   └── chrome_launcher.py          # Agent-specific Chrome profile launcher
│
├── widgets/                        # UI components
│   ├── activity_bar.py             # Vertical icon bar (Explorer, Search, Git, Debug, Extensions)
│   ├── chat_panel.py               # AI chat panel (Copilot Chat style)
│   ├── file_explorer.py            # File tree with SVG icons and context menu
│   ├── search_panel.py             # Full-text search with regex + replace
│   ├── git_panel.py                # Source Control — staging, committing, syncing
│   ├── command_palette.py          # Command Palette + Quick Open + Go to Line dialogs
│   ├── settings_dialog.py          # Settings UI (AI, Editor, Workspace, About tabs)
│   ├── status_bar.py               # Bottom status bar with cursor, language, git, AI status
│   ├── problems_panel.py           # Problems panel (diagnostic display)
│   ├── output_panel.py             # Output panel
│   ├── outline_panel.py            # Document outline / symbols panel
│   ├── timeline_panel.py           # File timeline / history panel
│   └── debug_panel.py              # Debug panel (placeholder)
│
├── windows/                        # Window management
│   ├── main_window.py              # MainWindow — layout assembly, menus, shortcuts, agent wiring
│   └── theme_manager.py            # ThemeManager — Dark+/Light+ theme with QPalette + stylesheet
│
└── assets/                         # Static assets
    ├── monaco/                     # Monaco Editor HTML + JS + CSS
    ├── xterm/                      # xterm.js terminal HTML + JS + CSS
    ├── send.svg                    # Chat send icon
    ├── plus.svg                    # Attach file icon
    └── mic.svg                     # Microphone icon
```

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

The AI agent has access to **5 tools** that it calls automatically during conversations:

| Tool | Description |
|------|-------------|
| `read_file` | Read the contents of any file (truncated at 50KB) |
| `write_file` | Create or overwrite a file with new content |
| `run_command` | Execute a shell command with 30s timeout |
| `search_files` | Grep across files for a text pattern |
| `list_files` | List files in a directory (optionally recursive) |

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

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built by [Dardcor](https://github.com/Dardcor) · [Report Issues](https://github.com/Dardcor/dardcor-code/issues)

</div>
