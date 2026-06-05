<div align="center">

# DARDCOR CODE

**Full Desktop AI Coding Assistant — VS Code-like IDE**

[![PyPI](https://img.shields.io/pypi/v/dardcor-code?color=%234f8ff7&label=version&style=for-the-badge&logo=python&logoColor=ffffff&labelColor=1a1a24)](https://pypi.org/project/dardcor-code/)
[![License: MIT](https://img.shields.io/badge/License-MIT-111118?style=for-the-badge&labelColor=0a0a0f&color=4f8ff7)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?style=for-the-badge&logo=python&logoColor=ffffff&labelColor=1a1a24)](https://python.org)
[![PySide6](https://img.shields.io/badge/UI-PySide6-41CD52?style=for-the-badge&logo=qt&logoColor=ffffff&labelColor=1a1a24)](https://pypi.org/project/PySide6/)

**AI Pair Programming. Native Desktop. Full VS Code Experience.**

</div>

---

## What is Dardcor Code?

Dardcor Code is a **full-featured desktop IDE** built entirely in Python with PySide6 (Qt). It provides a VS Code-like experience with integrated AI pair programming capabilities.

### Features
- **VS Code-like Interface**: Activity bar, file explorer, tabbed code editor, integrated terminal, status bar
- **Multi-language Code Editor**: Syntax highlighting for 30+ languages (Python, JavaScript, TypeScript, Go, Rust, C++, HTML, CSS, JSON, and more)
- **AI Agent Integration**: Built-in AI coding assistant that can read/write files, run commands, search code, and browse the web
- **Multi-Provider AI Support**: OpenAI, Anthropic Claude, Google Gemini, DeepSeek, OpenRouter, Ollama, NVIDIA
- **File Management**: Full CRUD operations, drag-and-drop, context menus
- **Integrated Terminal**: Run commands directly in the IDE
- **Full-Text Search**: Search across your entire codebase
- **Git Integration**: Basic git operations from the IDE

---

## Quick Start

### Prerequisites
- Python 3.9 or later

### Install via pip

```bash
pip install dardcor-code
dardcor desktop
```

### Install from Source

```bash
git clone https://github.com/Dardcor/dardcor-code.git
cd dardcor-code
pip install -e .
dardcor desktop
```

---

## Usage

```bash
# Launch the desktop IDE
dardcor desktop

# Check installation
dardcor status

# Show version
dardcor --version
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save file |
| `Ctrl+N` | New conversation |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+J` | Toggle chat panel |
| `Ctrl+` ` | Toggle terminal |
| `Ctrl+,` | Open settings |
| `Ctrl+Q` | Exit |

---

## Architecture

```
Dardcor Code (Pure Python + PySide6)
├── 🖥️ Desktop GUI (PySide6/Qt)     → Full VS Code-like interface
├── 🧠 AI Engine (Python)            → Multi-provider LLM integration
├── 📁 File System                   → CRUD, search, glob operations
├── ⌨️ Terminal Integration           → Shell command execution
├── 💬 Conversation Memory           → Persistent chat history
└── 🧠 Knowledge System             → Persistent project knowledge
```

### Tech Stack
- **UI Framework**: PySide6 (Qt for Python)
- **AI Providers**: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama, NVIDIA
- **Code Editor**: PySide6 QPlainTextEdit with custom syntax highlighting
- **File Operations**: Native Python os, shutil, glob

---

## License
MIT License

Built by [Dardcor](https://github.com/Dardcor)
