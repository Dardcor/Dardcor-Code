# Dardcor Code

> High-Performance, Next-Generation Modular Code Editor Core

## Architecture Overview

**Dardcor Code** is structured around a decoupled micro-kernel architecture designed for speed, modularity, and extensibility.

### Core Modules Breakdown

- **`src/dc/core/`**: Micro-kernel primitives, event emitters, async queues, cancellation tokens, data buffers, IPC protocols, and DOM utilities.
- **`src/dc/services/`**: Dependency Injection (`InstantiationService`), file providers, storage engine, configuration manager, and command registry.
- **`src/dc/engine/`**: PieceTree text model, text buffer virtualization, viewport rendering, cursor state machine, and code editor components.
- **`src/dc/app-shell/`**: Flexible split-pane grid layout, window titlebar, activity bar, sidebar, editor tab groups, panel container, and status bar.
- **`src/dc/modules/`**: Built-in IDE features including Workspace Explorer, Search, SCM/Git, Debugger (DAP), Integrated Terminal, and Extension Marketplace.
- **`src/dc/extension-api/`**: Extension Host isolated process worker runtime, RPC protocol multiplexer, and Language Server Protocol (LSP) client.
- **`src/dc/launcher/`**: Electron application main process, window management, single instance lock, and CLI bootstrap tools.
- **`src/dc/remote/`**: Standalone Headless Remote Server daemon, WebSocket multiplexer, and SSH tunnel client.
- **`tools/builder/`**: Build pipeline, packaging scripts, Vitest/Playwright test harness, and built-in AI agent tools.

## Getting Started

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Start development watcher
npm run dev
```
