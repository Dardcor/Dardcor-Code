<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d0017,40:1a0033,80:2d0055,100:3d006e&height=240&section=header&text=DARDCOR%20CODE&fontSize=72&fontColor=d4b8ff&animation=fadeIn&fontAlignY=42&desc=Next-Generation%20AI-Powered%20Desktop%20Code%20Editor&descAlignY=64&descSize=22&fontStyle=bold" width="100%"/>

<br/>

**Full-Featured Desktop AI Code Editor — Powered by Electron, TypeScript & Monaco**

[![License: MIT](https://img.shields.io/badge/License-MIT-111118?style=for-the-badge&labelColor=0a0a0f&color=4f8ff7)](LICENSE.txt)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=ffffff&labelColor=1a1a24)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?style=for-the-badge&logo=typescript&logoColor=ffffff&labelColor=1a1a24)](https://typescriptlang.org)
[![Electron](https://img.shields.io/badge/Electron-30%2B-47848F?style=for-the-badge&logo=electron&logoColor=ffffff&labelColor=1a1a24)](https://electronjs.org)
[![Monaco Editor](https://img.shields.io/badge/Editor-Monaco-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=ffffff&labelColor=1a1a24)](https://microsoft.github.io/monaco-editor/)

**AI Pair Programming · Monaco Editor · Integrated PTY Terminal · Extension Ecosystem**

<br/>

</div>

---

## What Is Dardcor Code?

**Dardcor Code** is a high-performance, open-source desktop code editor and AI-assisted development environment built on Electron, TypeScript, and Node.js. It combines the power of the Monaco Editor, an integrated PTY terminal, native extension capabilities, Git source control, and an agentic AI chat assistant into one seamless, customizable application.

The goal of Dardcor Code is to provide a fast, flexible, and hackable code editor that feels completely natural for developers while providing deep AI integration to assist in code generation, refactoring, debugging, and terminal automation.

---

## Why Dardcor Code?

- **Electron & TypeScript Core** — Clean, performant, and extensible codebase using modern web standards.
- **Monaco Editor Engine** — Industry-standard code editing experience with rich syntax highlighting, multi-cursor support, and code intelligence.
- **Integrated PTY Terminal** — Real, full-featured terminal powered by `xterm.js` and native pty processes supporting PowerShell, CMD, Bash, and Zsh.
- **Agentic AI Integration** — AI coding assistant capable of understanding project structure, providing code suggestions, and executing tasks.
- **Git & Source Control** — Built-in Git integration for staging, committing, pushing, pulling, and branch management.
- **Customizable Themes & Layout** — Flexible workbench layout with resizable sidebars, terminal panel, split editor support, and curated themes.

---

## Key Features

### 🖥️ Desktop Workbench
- **Custom Window Shell**: Integrated title bar, activity bar, status bar, and custom native window controls.
- **Flexible Workspace**: Split editor areas, side-by-side file comparisons, drag-and-drop tabs, and customizable panel locations.
- **Activity Bar**: Quick access to Explorer, Search, Source Control, Run & Debug, Extensions, and AI Chat.
- **Status Bar**: Real-time status indicators for Git branch, cursor line/col, encoding, indentation, language mode, and AI engine state.

### 📝 Monaco Code Editor
- **Rich Syntax Highlighting**: Support for JavaScript, TypeScript, Python, Go, Rust, C/C++, Java, HTML, CSS, JSON, Markdown, YAML, SQL, Shell, and many more.
- **Smart Editing**: Auto-closing brackets, auto-indentation, multi-cursor selection, code folding, and minimap.
- **Find & Replace**: Workspace-wide and per-file find and replace with regex, case sensitivity, and whole-word matching.
- **Split View**: Side-by-side editing across multiple open documents.

### ⌨️ Integrated PTY Terminal
- **xterm.js Terminal Emulator**: Smooth rendering, custom font styling, and fast scrollback buffer.
- **Native Process Integration**: Spawns real OS processes via Electron PtyHost service.
- **Multi-Tab Terminal**: Create, rename, split, and manage multiple terminal instances concurrently.
- **Full Shell Support**: Native execution for PowerShell, Command Prompt, Bash, Zsh, and WSL.

### 🧠 AI Assistant & Extension System
- **AI Agent Host**: Integrated agent protocol connecting the renderer with background AI services.
- **Copilot & Chat Integration**: Interactive chat panel for AI assistance, code explanations, refactoring, and automated task execution.
- **Extension Architecture**: Modular extension host supporting core language features, themes, and tool extensions.

---

## Quick Start

### Prerequisites
- **Node.js** v20.x or later
- **npm** v10.x or later
- **Python 3.9+** (required for native module compilation like `node-pty`)

### Installation & Running

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Dardcor/Dardcor-Code.git
   cd Dardcor-Code
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Compile the client source:**
   ```bash
   npm run compile-client
   ```

4. **Launch Dardcor Code:**
   ```bash
   npm start
   ```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+P` | Quick Open File |
| `Ctrl+,` | Settings |
| `Ctrl+B` | Toggle Sidebar |
| `` Ctrl+` `` | Toggle Integrated Terminal |
| `Ctrl+F` | Find in Current File |
| `Ctrl+H` | Find & Replace in Current File |
| `Ctrl+Shift+F` | Search Across Files |
| `Ctrl+Shift+E` | Open Explorer |
| `Ctrl+Shift+G` | Open Source Control |
| `Ctrl+Shift+X` | Open Extensions |
| `Ctrl+\` | Split Editor |
| `Ctrl+S` | Save File |
| `Ctrl+W` | Close Current Tab |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Application Runtime** | Electron & Node.js | Cross-platform desktop shell and background services |
| **Language** | TypeScript / JavaScript | Main application and workbench logic |
| **Code Editor** | Monaco Editor | Code viewing, editing, syntax highlighting |
| **Terminal Emulator** | xterm.js + PtyHost | Native shell execution and terminal rendering |
| **Build Pipeline** | Gulp, esbuild & tsgo | Fast incremental compilation and bundling |

---

## Security

Dardcor Code stores settings and extension data locally under user profile directories. Real API keys, tokens, and credentials should never be committed to repository source code.

---

## License

MIT License — see [LICENSE.txt](LICENSE.txt) for details.

Copyright (c) 2026 - present **Dardcor Corporation**.

---

<div align="center">

**Built with 💜 by [Dardcor](https://github.com/Dardcor) · [Report Issues](https://github.com/Dardcor/Dardcor-Code/issues)**

</div>
