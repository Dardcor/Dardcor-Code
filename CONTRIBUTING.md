# Contributing to Dardcor Code

Thank you for your interest in contributing to **Dardcor Code**! We welcome bug fixes, documentation improvements, performance optimizations, and feature enhancements.

This document provides setup instructions, architectural context, and coding standards to help you get started.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and collaborative environment for all contributors. Please communicate respectfully, focus on constructive feedback, and treat fellow community members with professionalism.

---

## Development Prerequisites

Before building Dardcor Code locally, ensure you have the following installed:

| Requirement | Recommended Version | Notes |
|-------------|---------------------|-------|
| **Node.js** | v20.x or v24.x | Required JavaScript runtime |
| **npm** | v10.x or later | Package manager bundled with Node.js |
| **Python** | 3.9+ | Required by `node-gyp` to compile native modules (`node-pty`) |
| **Git** | 2.30+ | Source code version control |

### Native Build Tools by OS
- **Windows**: Install the Visual Studio C++ Build Tools (via `npm install --global --production windows-build-tools` or Visual Studio Installer with the "Desktop development with C++" workload).
- **Linux (Ubuntu/Debian)**: `sudo apt-get install build-essential libsecret-1-dev libx11-dev libxkbfile-dev`
- **macOS**: `xcode-select --install`

---

## Setting Up Your Local Environment

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/Dardcor/Dardcor-Code.git
   cd Dardcor-Code
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Compile the project:**
   To compile all components (client workbench, copilot extension, and local AI router):
   ```bash
   npm run compile
   ```

4. **Launch Dardcor Code:**
   ```bash
   npm start
   ```

---

## Development Workflow & Scripts

For daily development, you do not need to rebuild the entire application every time. Use the targeted scripts below:

### Compilation Scripts
- `npm run compile-client` — Compiles the workbench, Monaco editor, and renderer sources.
- `npm run compile-copilot` — Compiles the Dardcor AI Copilot extension located in `extensions/dardcor/`.
- `npm run compile-router` — Builds the standalone Next.js AI router application in `.dardcor-router/`.
- `npm run watch-client` — Starts an incremental file watcher for the client; re-compiles modified files automatically.

### Code Quality & Hygiene
- `npm run hygiene` — Runs repository-wide hygiene checks (whitespace, copyright headers, disallowed dependencies).
- `npm run eslint` — Lints TypeScript and JavaScript source files.
- `npm run stylelint` — Lints CSS and layout styles.
- `npm run typecheck-client` — Runs TypeScript compiler checks without emitting files.

### Testing
- `npm run test-node` — Runs unit tests in a Node.js test environment.
- `npm run test-browser` — Runs browser/renderer unit tests using Playwright.
- `npm run smoketest` — Executes end-to-end smoke tests to ensure workbench launch and UI stability.

---

## Project Structure Overview

```
Dardcor-Code/
├── .dardcor-router/        # Standalone Next.js AI router & visual node interface (port 25128)
├── build/                  # Build scripts, packaging logic, and Gulp tasks
├── extensions/             # Built-in extensions (including extensions/dardcor for AI Chat)
├── public/                 # Static assets, application icons, and preview screenshots
├── scripts/                # Development startup and maintenance scripts
├── src/                    # Core application source code
│   └── dc/
│       ├── base/           # Common utilities, URI handlers, cancelation tokens, event emitters
│       ├── platform/       # Service contracts, storage, logging, and environment abstractions
│       └── workbench/      # Workbench layout, editor groups, terminal host, chat panel, status bar
├── package.json            # Root dependencies and script definitions
└── README.md               # Project documentation and showcase
```

---

## Coding Standards

### TypeScript Best Practices
- **Strict Typing**: Provide explicit types for function arguments, return values, and exported interfaces. Avoid `any` where a concrete type, generic, or `unknown` is applicable.
- **Resource Disposal**: Implement `IDisposable` and register event listeners or timer handles in `DisposableStore` to prevent memory leaks in the workbench renderer.
- **Async Hygiene**: Use `async`/`await` consistently. Propagate `CancellationToken` instances for long-running or cancelable background operations.

### Comment Hygiene (Anti-Slop)
- Do not write comments that merely restate what the code clearly does (e.g., avoid `// set name to string` or `// loop through items`).
- Write comments to document:
  - *Why* a non-standard pattern or workaround was used.
  - Concurrency invariants or lifecycle order requirements.
  - OS-specific quirks (e.g., Windows path handling, macOS keybindings).

---

## Submitting a Pull Request

1. **Create a Topic Branch:**
   Branch off from the latest `main`:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Commit Your Changes:**
   Use clear, conventional commit messages:
   - `feat: add model token counter in AI chat status bar`
   - `fix: resolve terminal scroll glitch on Windows resize`
   - `docs: update keyboard shortcuts in README`
   - `perf: optimize Monaco editor tokenization caching`

3. **Verify Locally Before Opening a PR:**
   - [ ] Application compiles successfully (`npm run compile-client`).
   - [ ] Hygiene and linting pass (`npm run hygiene`).
   - [ ] Relevant tests pass without regression.
   - [ ] No temporary debug statements (`console.log`) or secrets committed.

4. **Open the Pull Request:**
   - Provide a concise description of the motivation and changes made.
   - Reference any related issue numbers (e.g., `Closes #42`).
   - For UI changes, attach screenshots or a brief recording demonstrating the before and after state.
