# Changelog

All notable changes to **Dardcor Code** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-10-01

### 🚀 Autonomous Agent & Smart Edit Engine
- **Smart Edit Engine (9-Layer Heuristic Replacer Pipeline)**: Built an anti-failure code editing pipeline supporting Exact, Line-Trimmed, Block-Anchor (Levenshtein distance similarity $\ge 0.65$), Whitespace-Normalized, Indentation-Flexible, Escape-Normalized, Trimmed-Boundary, Context-Aware, and Multi-Occurrence replacements.
- **Disproportionate Match Safety Guard**: Validates matched replacement spans to ensure AI cannot accidentally wipe out large chunks of source code.
- **Per-File Concurrency Semaphore Lock**: Prevents race conditions and corrupted file writes during asynchronous multi-tool agent execution.
- **Git Checkpoint & Time-Travel Engine**: Integrated sub-second git plumbing snapshots (`git write-tree` and `git read-tree`) before AI turns, allowing per-step undo.
- **Closed-Loop LSP Diagnostics (Self-Healing Loop)**: Diagnostics and compiler errors are automatically routed back to the AI agent after each edit, enabling autonomous self-healing.
- **Doom Loop Circuit Breaker**: Detects repeated identical tool calls and cuts execution after 3 attempts to conserve tokens and prevent infinite loops.

### 📦 Developer Experience & Ecosystem
- **Two-Tier Context Compaction**: Deterministic basic pruning of old tool results and attachment buffers + agentic structured history summarization (`<CONVERSATION_SUMMARY>`).
- **Hierarchical Project Rules Engine**: Automatic discovery and hierarchical compilation of `.dardcorrules`, `.dardcor/rules/`, `.dc/rules/`, `.cursorrules`, and `.windsurfrules` directly into agent system prompts.
- **Rich Context Mentions (`@` System)**: Autocomplete and context resolution for `@selection` (active editor block), `@problems` (compiler errors), `@terminal` (active terminal status), `@git-changes` (uncommitted diffs), `@file:<path>`, and `@folder:<path>`.
- **Local Model Auto-Discovery**: Silent background probing for Ollama (`127.0.0.1:11434`), LM Studio (`127.0.0.1:1234`), and vLLM (`127.0.0.1:8000`) for zero-config offline AI pair programming.
- **Terminal Security Guard**: Pre-execution AST and pattern scanner that intercepts destructive shell commands (`rm -rf /`, `del /f /s /q`, hard resets, and path traversal).
- **Router Token Authentication**: Secured internal routing port 25128 with Bearer token authentication stored in user data directory.

## [1.0.0] - 2026-09-30

### Initial Release
- Monaco Code Editor engine v1.132.0 with syntax highlighting for 50+ languages.
- Dedicated Local AI Router running on port 25128 with multi-provider protocol translation.
- Comprehensive BYOK support for 9 AI providers (OpenAI, Anthropic Claude, Gemini, Ollama, DeepSeek, xAI, Azure, OpenRouter, Custom).
- Native PTY terminal integration powered by xterm.js v6 with WebGL acceleration.
- Complete multi-OS distribution pipeline for Windows, Linux, and macOS (25 release assets).
