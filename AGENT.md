# DARDCOR CODE - MASTER BUG & MISSING FEATURES LIST
# ==================================================
# Target: 100% VS Code parity
# Generated: 2026-07-11
# ==================================================

## ═══════════════════════════════════════════════════════════════
## BAGIAN 1: MISSING VISUAL STUDIO CODE FEATURES (BELUM ADA)
## ═══════════════════════════════════════════════════════════════

### A. EDITOR CORE FEATURES (Monaco Editor) - 59 fitur VS Code
### B. WORKBENCH CONTRIBUTIONS - 99 fitur VS Code
### C. SESSIONS LAYER - 28 fitur VS Code
### D. EXTENSION API - 178 file API
### E. BUILT-IN EXTENSIONS - 106 ekstensi
### F. UI COMPONENTS - 93 service + 104 platform modules
### G. CLI (Rust-based) - 7+ commands
### H. TERMINAL FEATURES - 26 sub-features
### I. REMOTE DEVELOPMENT - SSH, Containers, WSL, Tunnel
### J. AI/COPILOT FEATURES - Chat, Inline, Voice, MCP, Agent Sessions

## ═══════════════════════════════════════════════════════════════
## DETAIL LIST
## ═══════════════════════════════════════════════════════════════

======================================================================
1. MISSING EDITOR FEATURES (Monaco Editor - 59 contribs)
======================================================================

- [x] Anchor Select (Block/Box selection mode) - ADA (columnSelection: true + Ctrl+K Ctrl+B anchor commands via Monaco)
- [x] Bracket Matching (navigasi bracket) - ADA (matchBrackets: 'always' via Monaco)
- [x] Caret Operations (gerakan caret) - ADA (cursorSmoothCaretAnimation, cursorBlinking via Monaco)
- [x] Clipboard (copy/cut/paste) - ADA (copyWithSyntaxHighlighting, emptySelectionClipboard via Monaco)
- [x] Code Action (lightbulb quick fixes) - ADA (lightbulb: { enabled: true } + CodeActionProvider registered)
- [x] CodeLens (inline command links) - ADA (codeLens: true + Python CodeLensProvider registered)
- [ ] Color Picker (inline color picker widget) - TIDAK ADA inline (hanya QColorDialog)
- [x] Comment (toggle line/block comment) - ADA (Ctrl+/ dan Shift+Alt+A via Monaco commands)
- [x] Context Menu (editor right-click) - ADA (contextmenu: true + extension items + LiveServer)
- [x] Cursor Undo (undo/redo cursor position) - ADA (Ctrl+U → cursorUndo via Monaco)
- [ ] Diff Editor (side-by-side diff) - TIDAK ADA (belum diimplementasi)
- [ ] Diff Editor Breadcrumbs - TIDAK ADA
- [x] Drag and Drop (drag-drop text) - ADA (dragAndDrop: true + drop handler in Monaco HTML)
- [x] Document Symbols (outline/breadcrumb navigation) - ADA (DocumentSymbolProvider Python + OutlinePanel)
- [x] Drop or Paste Into (smart paste/drop handlers) - ADA (paste handler untuk images dalam Monaco HTML)
- [x] Find (find/replace/find in selection) - ADA (Ctrl+F → actions.find, Ctrl+H → startFindReplaceAction)
- [x] Floating Menu (in-editor floating menu) - ADA (floating-menu div dengan Copy/Format/Ask AI)
- [x] Folding (code folding regions/imports) - ADA (folding: true, foldingHighlight: true via Monaco)
- [x] Font Zoom (increase/decrease/reset font) - ADA (Ctrl+=/- zoom, Ctrl+0 reset)
- [x] Format (format document/selection) - ADA (triggerFormat(), Shift+Alt+F, format on paste/type)
- [x] Go to Error (navigate errors/warnings) - ADA (F8/Shift+F8 → marker.next/prev via Monaco)
- [x] Go to Symbol (quick symbol navigation) - ADA (Ctrl+Shift+O → quickOutline via Monaco)
- [ ] GPU (GPU-accelerated rendering) - TIDAK DIKONFIGURASI (WebGL enabled tapi tidak di-tune)
- [x] Hover (hover tooltips) - ADA (HoverProvider Python registered via Monaco)
- [ ] Indentation (indentation settings/convert) - TIDAK ADA UI (config ada: tabSize, insertSpaces, detectIndentation)
- [x] Inlay Hints (inline parameter/type hints) - ADA (inlayHints: { enabled: 'on' } + Python InlayHintsProvider)
- [x] Inline Completions (ghost text - Copilot) - ADA (InlineCompletionsProvider registered + setAISuggestion)
- [ ] In-Place Replace (value cycling) - TIDAK ADA
- [x] Insert Final Newline - ADA (auto-append newline on save in widget.py)
- [x] Line Selection (expand line selection) - ADA (Ctrl+L → expandLineSelection via Monaco)
- [x] Line Operations (move/copy/delete lines) - ADA (Alt+Up/Down move, Shift+Alt+Up/Down copy, Ctrl+Shift+K delete)
- [x] Linked Editing (simultaneous rename matching symbols) - ADA (linkedEditing: true via Monaco)
- [x] Links (clickable links in editor) - ADA (links: true via Monaco)
- [ ] Long Lines Helper - TIDAK ADA
- [x] Message (editor messages/notifications) - ADA (showEditorMessage() function in Monaco HTML)
- [x] Middle Scroll (middle-click scroll) - ADA (middle-click auto-scroll implementation in Monaco HTML)
- [x] Multi-Cursor (multiple cursors, column selection) - ADA (multiCursorModifier: 'alt', columnSelection: true)
- [x] Parameter Hints (signature help) - ADA (parameterHints: { enabled: true } + SignatureHelpProvider Python)
- [x] Peek View (peek references, definitions) - ADA (Alt+F12 → peekDefinition via Monaco)
- [x] Placeholder Text (empty editor hint) - ADA (setPlaceholder() function)
- [x] Quick Access (Quick Open within editor) - ADA (Ctrl+Shift+O → quickOutline dalam Monaco)
- [x] Read-Only Message - ADA (readOnlyMessage + onDidAttemptReadOnlyEdit handler)
- [ ] Rename (symbol rename cross-file) - TIDAK ADA cross-file rename (single-file rename via Monaco Python RenameProvider)
- [ ] Section Headers (code section navigation) - TIDAK ADA
- [x] Semantic Tokens (semantic token coloring) - ADA (SemanticTokensProvider Python + 'semanticHighlighting.enabled': true)
- [x] Smart Select (expand/shrink selection) - ADA (Shift+Alt+Right/Left → smartSelect via Monaco)
- [x] Snippet (code snippets) - ADA (backendCompletionProvider returns snippets, insertTextRules)
- [x] Sticky Scroll (sticky column headers while scrolling) - ADA (stickyScroll: { enabled: true, maxLineCount: 5 })
- [x] Suggest (auto-completion/intellisense) - ADA (suggestOnTriggerCharacters, quickSuggestions, wordBasedSuggestions)
- [ ] Symbol Icons (icon decorations) - TIDAK ADA
- [x] Toggle Tab Focus Mode - ADA (Ctrl+M → toggleTabFocusMode via Monaco)
- [x] Tokenization (syntax highlighting) - ADA (via Monaco + loaded language tokenizers)
- [x] Unicode Highlighter (highlight invisible Unicode) - ADA (unicodeHighlight: { ambiguousCharacters, invisibleCharacters })
- [x] Unusual Line Terminators - ADA (unusualLineTerminators: 'auto' via Monaco)
- [x] Word Highlight (highlight word occurrences) - ADA (occurrencesHighlight: true, selectionHighlight: true)
- [ ] Word Operations (word-level cursor/delete) - TIDAK ADA (standard Monaco keyboard, no explicit config)
- [ ] Word Part Operations (CamelCase sub-word) - TIDAK ADA
- [x] Zone Widget (overlay widgets in editor) - ADA (addZoneWidget/removeZoneWidget/clearZoneWidgets in Monaco HTML)

======================================================================
2. MISSING WORKBENCH CONTRIBUTIONS (IDE Features - 99)
======================================================================

### 2A. CORE IDE FEATURES
- [ ] files (File Explorer operations) - SEBAGIAN (ada tree)
- [ ] search (Search across files) - SEBAGIAN (ada SearchPanel)
- [ ] searchEditor (Search results in editor) - TIDAK ADA
- [ ] scm (Source Control Management) - SEBAGIAN (ada GitPanel webview)
- [ ] git (Git blame, branches, etc.) - SEBAGIAN (dasar ada)
- [ ] debug (Debugger full) - SEBAGIAN (basic DAP connect)
- [ ] extensions (Extension management) - SEBAGIAN (ada ExtensionsPanel)
- [ ] tasks (Task runner) - SEBAGIAN (ada TaskManager)
- [ ] terminal (Integrated terminal) - SEBAGIAN (QProcess-based, bukan xterm.js)
- [ ] notebook (Jupyter Notebook) - SEBAGIAN (ada NotebookEditor)
- [ ] replNotebook (REPL-style notebooks) - TIDAK ADA
- [ ] interactive (Interactive code execution) - TIDAK ADA
- [ ] output (Output panel) - ADA
- [ ] markers (Problems panel) - ADA
- [ ] comments (Comments/discussions) - SEBAGIAN (ada CommentService)
- [ ] testing (Test explorer) - SEBAGIAN (ada TestExplorerPanel)
- [ ] timeline (Timeline view) - ADA (TimelinePanel)
- [ ] localHistory (Local file history) - ADA (LocalHistory)
- [ ] outline (Outline view) - ADA (OutlinePanel)
- [ ] codeEditor (Editor settings) - SEBAGIAN
- [ ] preferences (Settings/keybindings editor) - SEBAGIAN

### 2B. CHAT, AI & COPILOT FEATURES
- [ ] chat (AI Chat panel with participants) - ADA (ChatPanel)
- [ ] inlineChat (Inline AI chat in editor) - SEBAGIAN (ada InlineChatWidget)
- [ ] inlineCompletions (Ghost text completions) - TIDAK ADA
- [ ] agentsVoice (Voice interaction) - TIDAK ADA (belum connect)
- [ ] mcp (Model Context Protocol management) - TIDAK ADA UI management
- [ ] interactive (Interactive code execution for AI) - TIDAK ADA
- [ ] embeds (Embedding vector support) - TIDAK ADA

### 2C. CODE INTELLIGENCE & NAVIGATION
- [ ] codeActions (Code actions orchestration) - TIDAK ADA
- [ ] callHierarchy (Call hierarchy view) - TIDAK ADA
- [ ] typeHierarchy (Type hierarchy view) - TIDAK ADA
- [ ] folding (Code folding providers) - TIDAK ADA provider API
- [ ] format (Formatter management) - SEBAGIAN
- [ ] inlayHints (Inlay hints display) - TIDAK ADA
- [ ] linkedEditing (Linked editing support) - TIDAK ADA
- [ ] references-view (Reference search results) - TIDAK ADA
- [ ] snippets (Snippet management UI) - SEBAGIAN
- [ ] dropOrPasteInto (Smart paste handlers) - TIDAK ADA
- [ ] emmet (Emmet abbreviation expansion) - TIDAK ADA integration
- [ ] languageDetection (Auto language detection) - TIDAK ADA
- [ ] languageStatus (Language status indicators) - TIDAK ADA

### 2D. UI SHELL & LAYOUT
- [ ] sash (Resizable splitters) - ADA (QSplitter-based)
- [ ] scrollLocking (Synchronized scrolling) - TIDAK ADA
- [ ] views (View management system) - SEBAGIAN
- [ ] webview (Webview rendering) - SEBAGIAN (QWebEngineView)
- [ ] webviewPanel (Custom editor webview panels) - TIDAK ADA
- [ ] webviewView (Webview-based views) - TIDAK ADA
- [ ] customEditor (Custom editor support) - TIDAK ADA
- [ ] auxiliaryWindow (Secondary windows) - SEBAGIAN (ada AuxiliaryWindow)
- [ ] banner (Notification banner) - TIDAK ADA
- [ ] relauncher (Window relaunch) - TIDAK ADA
- [ ] styleOverrides (Style customization) - TIDAK ADA

### 2E. REMOTE & CLOUD
- [ ] remote (Remote Development SSH/Containers/WSL) - SEBAGIAN (ada SSHManager)
- [ ] remoteCodingAgents (Remote AI agents) - TIDAK ADA
- [ ] remoteTunnel (Remote tunnel) - TIDAK ADA
- [ ] tunnelForwarding (Port forwarding) - SEBAGIAN (ada PortForwardingPanel)
- [ ] editSessions (Cross-device editing) - TIDAK ADA
- [ ] userDataSync (Settings sync) - SEBAGIAN (ada SettingsSyncManager)
- [ ] userDataProfile (Profile management) - TIDAK ADA
- [ ] encryption (Encryption services) - TIDAK ADA

### 2F. ONBOARDING & WELCOME
- [ ] welcomeGettingStarted (Get Started page) - SEBAGIAN (ada WelcomePageWidget)
- [ ] welcomeWalkthrough (Interactive walkthroughs) - TIDAK ADA
- [ ] welcomeOnboarding (First-run onboarding) - TIDAK ADA
- [ ] welcomeViews (Welcome views) - TIDAK ADA
- [ ] welcomeBanner (Beta banners) - TIDAK ADA
- [ ] welcomeAgentSessions (Agent sessions welcome) - TIDAK ADA
- [ ] onboarding (Scenario-based onboarding) - TIDAK ADA

### 2G. AUTHENTICATION & ACCOUNTS
- [ ] authentication (Auth providers) - TIDAK ADA
- [ ] github (GitHub authentication) - TIDAK ADA
- [ ] githubAuthentication (GitHub auth UI) - TIDAK ADA
- [ ] microsoft-authentication (Microsoft auth) - TIDAK ADA

### 2H. TERMINAL SUB-FEATURES (26)
- [ ] Terminal accessibility - TIDAK ADA
- [ ] Terminal autoReplies - TIDAK ADA
- [ ] Terminal chat - TIDAK ADA
- [ ] Terminal chatAgentTools - TIDAK ADA
- [ ] Terminal clipboard - SEBAGIAN
- [ ] Terminal commandGuide - TIDAK ADA
- [ ] Terminal developer tools - TIDAK ADA
- [ ] Terminal environmentChanges - TIDAK ADA
- [ ] Terminal find/search - TIDAK ADA
- [ ] Terminal history - TIDAK ADA
- [ ] Terminal inlineHint - TIDAK ADA
- [ ] Terminal links (clickable links) - TIDAK ADA
- [ ] Terminal notification - TIDAK ADA
- [ ] Terminal quickAccess - TIDAK ADA
- [ ] Terminal quickFix - TIDAK ADA
- [ ] Terminal resize overlay - TIDAK ADA
- [ ] Terminal sendSequence - TIDAK ADA
- [ ] Terminal sendSignal - TIDAK ADA
- [ ] Terminal stickyScroll - TIDAK ADA
- [ ] Terminal suggest/completions - TIDAK ADA
- [ ] Terminal telemetry - TIDAK ADA
- [ ] Terminal typeAhead - TIDAK ADA
- [ ] Terminal voice - TIDAK ADA
- [ ] Terminal wslRecommendation - TIDAK ADA
- [ ] Terminal zoom - TIDAK ADA

### 2I. OTHER MISSING FEATURES
- [ ] accessibility (Screen reader, ARIA) - TIDAK ADA
- [ ] accessibilitySignals (Audio cues) - TIDAK ADA (ada audio_cues.py tapi tidak aktif)
- [ ] externalTerminal (Open in external terminal) - SEBAGIAN
- [ ] externalUriOpener (External URI handler) - SEBAGIAN
- [ ] imageCarousel (Image viewer carousel) - TIDAK ADA
- [ ] keybindings (Keyboard shortcut editor) - SEBAGIAN
- [ ] keybindingsExport (Export keybindings) - TIDAK ADA
- [ ] limitIndicator (File size limit indicator) - TIDAK ADA
- [ ] localization (Language pack management) - TIDAK ADA (ada i18n.py skeleton)
- [ ] logs (Log viewer UI) - TIDAK ADA
- [ ] media-preview (Media file preview) - SEBAGIAN (ada image_viewer.py)
- [ ] mergeEditor (3-way merge editor) - SEBAGIAN (ada merge_editor.py)
- [ ] multiDiffEditor (Multi-file diff) - SEBAGIAN (ada multi_diff.py)
- [ ] opener (Safe file opener) - TIDAK ADA
- [ ] performance (Performance tools) - TIDAK ADA
- [ ] policyExport (Policy data export) - TIDAK ADA
- [ ] processExplorer (Process manager) - TIDAK ADA
- [ ] quickaccess (Quick Open provider) - SEBAGIAN (ada QuickOpenDialog)
- [ ] share (Share providers) - TIDAK ADA
- [ ] speech (Speech-to-text) - SEBAGIAN (ada speech/recognition.py skeleton)
- [ ] surveys (NPS and language surveys) - TIDAK ADA
- [ ] telemetry (Telemetry/usage data) - SEBAGIAN (ada telemetry.py)
- [ ] themes (Theme management) - SEBAGIAN
- [ ] update (Auto-update) - SEBAGIAN (ada update.py)
- [ ] url (URL handling) - SEBAGIAN (ada url_handler.py)
- [ ] workspace (Workspace operations) - SEBAGIAN
- [ ] workspaces (Multi-root workspace mgmt) - SEBAGIAN (ada multi_root.py)

======================================================================
3. MISSING SESSIONS LAYER (28 Agent Session Features)
======================================================================

- [ ] accountMenu (Account/session management) - TIDAK ADA
- [ ] agentFeedback (AI agent feedback) - TIDAK ADA
- [ ] aiCustomizationTreeView (AI customization) - TIDAK ADA
- [ ] applyCommitsToParentRepo - TIDAK ADA
- [ ] aquarium (Session visualization) - TIDAK ADA
- [ ] automations (Session automation) - TIDAK ADA
- [ ] blockedSessions - TIDAK ADA
- [ ] browserView (Embedded browser) - SEBAGIAN (ada BrowserWidget)
- [ ] changes (Changes viewer) - TIDAK ADA
- [ ] chat (Session chat) - TIDAK ADA
- [ ] chatDebug - TIDAK ADA
- [ ] codeReview (Code review workflow) - TIDAK ADA
- [ ] configuration - TIDAK ADA
- [ ] editor (Session-aware editor) - TIDAK ADA
- [ ] files (Session file management) - TIDAK ADA
- [ ] fileTreeView - TIDAK ADA
- [ ] github (GitHub in sessions) - TIDAK ADA
- [ ] layout (Session layout) - TIDAK ADA
- [ ] onboardingTours (Session onboarding) - TIDAK ADA
- [ ] policyBlocked - TIDAK ADA
- [ ] promptTimeline (AI prompt history) - TIDAK ADA
- [ ] providers (Session providers) - TIDAK ADA
- [ ] search (Session-aware search) - TIDAK ADA
- [ ] sessionInputBanners - TIDAK ADA
- [ ] sessions (Session management) - TIDAK ADA
- [ ] terminal (Session terminals) - TIDAK ADA
- [ ] tunnelHost - TIDAK ADA
- [ ] workspace (Session workspace) - TIDAK ADA

======================================================================
4. MISSING EXTENSION API (178 vscode.d.ts files)
======================================================================

- [ ] vscode.d.ts (FULL public API) - TIDAK ADA implementasi
- [ ] Chat & Copilot APIs (18 proposed) - TIDAK ADA
- [ ] Language Model APIs (8 proposed) - TIDAK ADA
- [ ] MCP APIs (2 proposed) - TIDAK ADA
- [ ] AI & Embeddings APIs (4 proposed) - TIDAK ADA
- [ ] SCM APIs (7 proposed) - TIDAK ADA
- [ ] Testing APIs (2 proposed) - TIDAK ADA
- [ ] Terminal APIs (9 proposed) - TIDAK ADA
- [ ] Notebook APIs (8 proposed) - TIDAK ADA
- [ ] Authentication APIs (6 proposed) - TIDAK ADA
- [ ] Comments APIs (5 proposed) - TIDAK ADA
- [ ] Debug APIs (2 proposed) - TIDAK ADA
- [ ] Editor APIs (7 proposed) - TIDAK ADA
- [ ] File System APIs (4 proposed) - TIDAK ADA
- [ ] Contrib Menu APIs (20 proposed) - TIDAK ADA

======================================================================
5. MISSING BUILT-IN EXTENSIONS (106 VS Code bundled)
======================================================================

Language/Grammar (42 extensions):
- [ ] bat, clojure, coffeescript, cpp, csharp, css, dart, diff
- [ ] docker, dotenv, fsharp, go, groovy, handlebars, hlsl, html
- [ ] ini, java, javascript, json, julia, latex, less, log, lua
- [ ] make, markdown-basics, objective-c, perl, php, powershell
- [ ] pug, python, r, razor, restructuredtext, ruby, rust, scss
- [ ] shaderlab, shellscript, sql, swift, typescript-basics
- [ ] vb, xml, yaml, grunt, gulp

Language Services (6 extensions):
- [ ] css-language-features, html-language-features
- [ ] json-language-features, markdown-language-features
- [ ] php-language-features, typescript-language-features

Theme extensions (11):
- [ ] theme-abyss, theme-defaults, theme-kimbie-dark
- [ ] theme-monokai-dimmed, theme-monokai, theme-quietlight
- [ ] theme-red, theme-seti, theme-solarized-dark
- [ ] theme-solarized-light, theme-tomorrow-night-blue

Tool/Utility extensions (15+):
- [ ] configuration-editing, extension-editing
- [ ] git, git-base, github, github-authentication
- [ ] microsoft-authentication, debug-auto-launch
- [ ] debug-server-ready, emmet, npm, ipynb
- [ ] notebook-renderers, media-preview, references-view
- [ ] search-result, simple-browser, tunnel-forwarding
- [ ] terminal-suggest, markdown-math, mermaid-markdown-features
- [ ] vscode-api-tests, vscode-test-resolver, vscode-colorize-tests
- [ ] prompt-basics

Copilot extension:
- [ ] copilot (Main Copilot integration) - TIDAK ADA

======================================================================
6. MISSING CLI FEATURES (Rust-based CLI)
======================================================================

- [ ] `code` command (launch from terminal) - TIDAK ADA
- [ ] `code tunnel` (remote tunnel service) - TIDAK ADA
- [ ] `code server` (remote server mode) - TIDAK ADA
- [ ] `code serve-web` (web server mode) - TIDAK ADA
- [ ] `code status` (status check) - TIDAK ADA
- [ ] `code update` (self-update) - TIDAK ADA
- [ ] `code version` (version info) - TIDAK ADA
- [ ] Desktop integration (file associations) - TIDAK ADA
- [ ] OS-level auth system integration - TIDAK ADA
- [ ] IPC (inter-process communication) - TIDAK ADA

======================================================================
7. MISSING AI/COPILOT FEATURES (GitHub Copilot integration)
======================================================================

- [ ] GitHub Copilot Chat (deep integration) - TIDAK ADA (pakai agent sendiri)
- [ ] Copilot inline completions (ghost text) - TIDAK ADA
- [ ] Copilot commit message generation - TIDAK ADA
- [ ] Copilot terminal suggestions - TIDAK ADA
- [ ] Copilot voice interaction - TIDAK ADA
- [ ] Copilot pull request descriptions - TIDAK ADA
- [ ] Copilot code review - TIDAK ADA
- [ ] Copilot test generation - TIDAK ADA
- [ ] Copilot /fix, /explain, /tests slash commands - SEBAGIAN (hardcoded)
- [ ] Multi-model chat participants - TIDAK ADA
- [ ] Chat attachments (file/image) - SEBAGIAN
- [ ] Chat model switching UI - ADA
- [ ] Chat history search - TIDAK ADA
- [ ] Agent mode (autonomous coding) - SEBAGIAN

======================================================================
8. MISSING REMOTE DEVELOPMENT FEATURES
======================================================================

- [ ] SSH Remote (full SSH connection manager) - SEBAGIAN (ada SSHManager skeleton)
- [ ] Dev Containers (Docker-based dev) - SEBAGIAN (ada container_manager.py)
- [ ] WSL (Windows Subsystem Linux) - TIDAK ADA
- [ ] Remote Tunnels (vscode.dev tunnel) - TIDAK ADA
- [ ] Remote Explorer UI - TIDAK ADA
- [ ] Remote file system provider - SEBAGIAN (ada vfs.py)
- [ ] Remote terminal - TIDAK ADA
- [ ] Remote port forwarding UI - SEBAGIAN (ada PortForwardingPanel)
- [ ] Remote extension host - TIDAK ADA
- [ ] Codespaces integration - TIDAK ADA
- [ ] Live Share (real-time collaboration) - SEBAGIAN (ada live_share.py)

======================================================================
9. MISSING SETTINGS & CONFIGURATION FEATURES
======================================================================

- [ ] Settings UI (searchable settings) - SEBAGIAN (ada SettingsUIWidget)
- [ ] Settings JSON editor - TIDAK ADA
- [ ] Keyboard Shortcuts UI (searchable) - SEBAGIAN (ada KeybindingsUIWidget)
- [ ] Keyboard Shortcuts JSON editor - TIDAK ADA
- [ ] User Snippets editor - TIDAK ADA
- [ ] Workspace settings (.vscode/settings.json) - TIDAK ADA
- [ ] Workspace tasks (.vscode/tasks.json) - SEBAGIAN
- [ ] Workspace launch config (.vscode/launch.json) - SEBAGIAN
- [ ] Workspace extensions.json - TIDAK ADA
- [ ] Settings sync (across machines) - SEBAGIAN (ada SettingsSyncManager)
- [ ] Settings profiles - TIDAK ADA
- [ ] Keybinding layers (when clauses) - TIDAK ADA
- [ ] Language-specific settings - TIDAK ADA
- [ ] File-specific settings - TIDAK ADA
- [ ] settings.json default values - TIDAK ADA
- [ ] Settings migration - TIDAK ADA

======================================================================
10. MISSING SOURCE CONTROL (GIT) FEATURES
======================================================================

- [ ] Git blame annotations - TIDAK ADA
- [ ] Git history (file/line) - SEBAGIAN (ada timeline panel)
- [ ] Git graph visualization - SEBAGIAN (ada GitGraphPanel)
- [ ] Git stash management - TIDAK ADA
- [ ] Git branch management UI - SEBAGIAN (QInputDialog)
- [ ] Git merge conflict editor - TIDAK ADA
- [ ] Git revert/undo - TIDAK ADA
- [ ] Git staging UI (stage/unstage/discard) - TIDAK ADA di native
- [ ] Git diff view (side-by-side) - TIDAK ADA
- [ ] Git commit message editor - TIDAK ADA
- [ ] Git amend commit - TIDAK ADA
- [ ] Git cherry-pick - TIDAK ADA
- [ ] Git rebase UI - TIDAK ADA
- [ ] Git submodule management - TIDAK ADA
- [ ] Git remote management - TIDAK ADA
- [ ] Git tag management - TIDAK ADA
- [ ] Git LFS support - TIDAK ADA
- [ ] Git commit sign-off - TIDAK ADA
- [ ] Git conventional commits - TIDAK ADA
- [ ] Git blame editor gutter - TIDAK ADA
- [ ] Git change gutter indicators - TIDAK ADA
- [ ] Git status bar interactive - SEBAGIAN
- [ ] Git output channel - SEBAGIAN (ada Git output panel)
- [ ] Git auto-fetch indicator - TIDAK ADA
- [ ] Git sync/push/pull UI - SEBAGIAN

======================================================================
11. MISSING DEBUGGER FEATURES
======================================================================

- [ ] Breakpoints (full management) - SEBAGIAN (toggle only)
- [ ] Conditional breakpoints - TIDAK ADA
- [ ] Logpoints - TIDAK ADA
- [ ] Hit count breakpoints - TIDAK ADA
- [ ] Function breakpoints - TIDAK ADA
- [ ] Data breakpoints - TIDAK ADA
- [ ] Exception breakpoints - TIDAK ADA
- [ ] Watch expressions - SEBAGIAN (ada WATCH section)
- [ ] Call stack view - SEBAGIAN (ada CALL STACK section)
- [ ] Variables view - SEBAGIAN (ada VARIABLES section)
- [ ] Debug Console (REPL) - SEBAGIAN (ada debug_console OutputPanel)
- [ ] Debug toolbar (floating) - SEBAGIAN (ada DebugToolbar)
- [ ] Debug hover (inspect variables) - SEBAGIAN (ada set_debug_hover)
- [ ] Debug inline values - SEBAGIAN (ada show_inline_value)
- [ ] Debug step filters - TIDAK ADA
- [ ] Debug multi-session - TIDAK ADA
- [ ] Debug compound configurations - TIDAK ADA (hanya stub)
- [ ] Debug preLaunchTask support - TIDAK ADA (hanya stub)
- [ ] Debug attach to process - TIDAK ADA
- [ ] Debug remote attach - TIDAK ADA
- [ ] Debug browser (Chrome/Firefox) - TIDAK ADA
- [ ] Debug Node.js - TIDAK ADA (extension host)
- [ ] Debug Python (debugpy) - SEBAGIAN (ada DAP client)
- [ ] Disassembly view - TIDAK ADA
- [ ] Loaded scripts view - SEBAGIAN (ada LOADED SCRIPTS section)
- [ ] Debug configurations from workspace - SEBAGIAN
- [ ] Debug status bar color - SEBAGIAN (ada set_debug_mode)

======================================================================
12. MISSING WORKBENCH UI COMPONENTS
======================================================================

- [ ] Minimap (editor code overview) - SEBAGIAN (via Monaco)
- [ ] Breadcrumbs (navigation bar) - SEBAGIAN (ada BreadcrumbsBar)
- [ ] Sticky Scroll - TIDAK ADA
- [ ] Activity Bar drag-reorder - SEBAGIAN (ada drag support)
- [ ] Activity Bar badge - ADA
- [ ] Activity Bar context menu - SEBAGIAN
- [ ] Primary Side Bar positions (left/right) - SEBAGIAN
- [ ] Secondary Side Bar positions - SEBAGIAN
- [ ] Panel positions (bottom/right/left/top) - SEBAGIAN
- [ ] Panel maximize/restore - TIDAK ADA
- [ ] Editor tabs (multiple rows) - SEBAGIAN
- [ ] Editor tabs vertical/horizontal - TIDAK ADA
- [ ] Editor tab sizing (fit/shrink) - TIDAK ADA
- [ ] Editor tab pinned - TIDAK ADA
- [ ] Editor group layout (grid) - SEBAGIAN (ada set_grid_layout)
- [ ] Centered Layout - ADA (CenteredLayoutManager)
- [ ] Zen Mode - ADA (ZenModeManager)
- [ ] Focus Mode - TIDAK ADA
- [ ] Notification Center - SEBAGIAN (ada NotificationCenter)
- [ ] Notification Toast - SEBAGIAN (ada NotificationService)
- [ ] Banner notifications - TIDAK ADA
- [ ] Command Center (search bar) - SEBAGIAN (ada CommandCenterWidget)
- [ ] Quick Open dialog - SEBAGIAN (ada QuickOpenDialog)
- [ ] Quick Pick (multi-select) - TIDAK ADA
- [ ] Dropdown Quick Pick - TIDAK ADA
- [ ] Input box (with validation) - TIDAK ADA
- [ ] Multi-step input (wizard) - TIDAK ADA
- [ ] Workspace Trust dialog - SEBAGIAN (ada WorkspaceTrustDialog)
- [ ] Window title customization - SEBAGIAN
- [ ] Profile Management UI - TIDAK ADA
- [ ] Account/Keychain UI - TIDAK ADA
- [ ] Color Theme picker (with preview) - SEBAGIAN
- [ ] File Icon Theme picker - SEBAGIAN
- [ ] Product Icon Theme picker - TIDAK ADA
- [ ] Customize Layout popup - SEBAGIAN (ada di QuickOpenDialog)
- [ ] Sash hover/active styling - SEBAGIAN

======================================================================
13. MISSING FILE EXPLORER FEATURES
======================================================================

- [ ] File nesting - TIDAK ADA
- [ ] File explorer auto-reveal - SEBAGIAN
- [ ] File explorer filter (files.exclude) - SEBAGIAN
- [ ] File explorer search (type to find) - TIDAK ADA
- [ ] File explorer sort (by name/type/modified) - TIDAK ADA
- [ ] File explorer compact folders - TIDAK ADA
- [ ] File explorer drag-drop (move/copy) - TIDAK ADA
- [ ] File explorer multi-select - TIDAK ADA
- [ ] File explorer clipboard (cut/copy/paste) - TIDAK ADA
- [ ] File explorer rename (inline edit) - TIDAK ADA
- [ ] File explorer new file/folder (inline) - TIDAK ADA
- [ ] File explorer context menu (full) - SEBAGIAN
- [ ] File explorer keyboard navigation - SEBAGIAN
- [ ] File explorer open editors section - ADA (OpenEditorsPanel)
- [ ] File explorer outline section - ADA (OutlinePanel)
- [ ] File explorer timeline section - ADA (TimelinePanel)
- [ ] File explorer goto symbol - SEBAGIAN
- [ ] File explorer compare selected - TIDAK ADA
- [ ] File explorer collapse all - TIDAK ADA
- [ ] File explorer reveal active file - SEBAGIAN
- [ ] File explorer refresh - TIDAK ADA

======================================================================
14. MISSING SEARCH FEATURES
======================================================================

- [ ] Search in files (full text) - SEBAGIAN (ada SearchPanel)
- [ ] Search with regex - SEBAGIAN
- [ ] Search with case sensitivity - SEBAGIAN
- [ ] Search with whole word - TIDAK ADA UI toggle
- [ ] Search with include/exclude files - SEBAGIAN
- [ ] Search with file types - TIDAK ADA
- [ ] Search with replace - TIDAK ADA
- [ ] Search with replace preview - TIDAK ADA
- [ ] Search with context lines - TIDAK ADA
- [ ] Search with collapse/expand results - SEBAGIAN (via QTreeWidget)
- [ ] Search with file preview - TIDAK ADA
- [ ] Search with follow symlinks - TIDAK ADA
- [ ] Search with max file size - TIDAK ADA
- [ ] Search in open files - TIDAK ADA
- [ ] Search in folder (right-click) - SEBAGIAN
- [ ] Search editor (search results in editor) - SEBAGIAN
- [ ] Search history - TIDAK ADA
- [ ] Search quick access (Ctrl+P mode) - SEBAGIAN
- [ ] Search results navigation (F4/Shift+F4) - TIDAK ADA
- [ ] Search results file tree - SEBAGIAN (via QTreeWidget)
- [ ] Search only .gitignore - TIDAK ADA
- [ ] Search with ripgrep - TIDAK ADA (pakai os.walk)
- [ ] Search with global search exclude - TIDAK ADA

======================================================================
15. MISSING LANGUAGE SERVER PROTOCOL (LSP) FEATURES
======================================================================

- [ ] LSP hover provider - SEBAGIAN (ada get_hover)
- [ ] LSP completion provider - SEBAGIAN (via Monaco suggest)
- [ ] LSP signature help - TIDAK ADA
- [ ] LSP go-to-definition - SEBAGIAN (ada go_to_definition)
- [ ] LSP find-references - TIDAK ADA
- [ ] LSP document symbols - SEBAGIAN (parse_python_symbols)
- [ ] LSP workspace symbols - SEBAGIAN (# search)
- [ ] LSP code actions - TIDAK ADA
- [ ] LSP code lens - TIDAK ADA
- [ ] LSP document formatting - SEBAGIAN (triggerFormat)
- [ ] LSP range formatting - TIDAK ADA
- [ ] LSP rename - SEBAGIAN (trigger rename)
- [ ] LSP diagnostics - SEBAGIAN (ada diagnostics channel)
- [ ] LSP semantic tokens - TIDAK ADA
- [ ] LSP folding range - TIDAK ADA (via Monaco default)
- [ ] LSP selection range - TIDAK ADA
- [ ] LSP document link - TIDAK ADA
- [ ] LSP document color - TIDAK ADA
- [ ] LSP color presentation - TIDAK ADA
- [ ] LSP document highlight - TIDAK ADA
- [ ] LSP inline value - TIDAK ADA (ada custom debug inline value)
- [ ] LSP type hierarchy - TIDAK ADA
- [ ] LSP call hierarchy - TIDAK ADA
- [ ] LSP linked editing range - TIDAK ADA
- [ ] LSP inlay hints - TIDAK ADA
- [ ] LSP diagnostic pull model - TIDAK ADA
- [ ] LSP inline completions - TIDAK ADA
- [ ] LSP text document sync (incremental) - SEBAGIAN (full sync)
- [ ] LSP workspace folders - TIDAK ADA
- [ ] LSP configuration change notification - TIDAK ADA
- [ ] LSP progress reporting - TIDAK ADA
- [ ] LSP telemetry - TIDAK ADA
- [ ] LSP workspace diagnostic - SEBAGIAN
- [ ] LSP multiple server support - TIDAK ADA
- [ ] LSP dynamic registration - TIDAK ADA
- [ ] LSP partial result - TIDAK ADA
- [ ] LSP error recovery protocol - TIDAK ADA

======================================================================
16. MISSING MARKDOWN FEATURES
======================================================================

- [ ] Markdown preview (side-by-side) - SEBAGIAN (ada MarkdownPreviewWidget)
- [ ] Markdown preview with scroll sync - TIDAK ADA
- [ ] Markdown preview security (disable scripts) - TIDAK ADA
- [ ] Markdown preview styles - TIDAK ADA
- [ ] Markdown editor toolbar - TIDAK ADA
- [ ] Markdown shortcuts (bold/italic/list) - TIDAK ADA
- [ ] Markdown table formatting - TIDAK ADA
- [ ] Markdown link navigation - TIDAK ADA
- [ ] Markdown image preview - TIDAK ADA
- [ ] Markdown math (KaTeX) - TIDAK ADA
- [ ] Markdown Mermaid diagrams - TIDAK ADA
- [ ] Markdown emoji - TIDAK ADA
- [ ] Markdown auto preview - TIDAK ADA
- [ ] Markdown source/side-by-side - TIDAK ADA
- [ ] Markdown paste image handler - TIDAK ADA
- [ ] Markdown export to HTML - TIDAK ADA

======================================================================
17. MISSING TASKS FEATURES
======================================================================

- [ ] Auto-detection of tasks (npm, gulp, etc.) - TIDAK ADA
- [ ] Task output handling - SEBAGIAN
- [ ] Task problem matchers - SEBAGIAN (ada problem_matcher.py)
- [ ] Task re-run - TIDAK ADA
- [ ] Task configuration (tasks.json) - SEBAGIAN
- [ ] Task user input (inputs) - TIDAK ADA
- [ ] Task shell customization - TIDAK ADA
- [ ] Task background watching - TIDAK ADA
- [ ] Task run modes (terminal/output) - TIDAK ADA
- [ ] Task presentation options - TIDAK ADA
- [ ] Task group (build/test) - TIDAK ADA
- [ ] Task dependsOn - TIDAK ADA
- [ ] Task compound - TIDAK ADA
- [ ] Task quick pick (Ctrl+Shift+B) - SEBAGIAN
- [ ] Task reveal problems - TIDAK ADA
- [ ] Task run on save - TIDAK ADA
- [ ] Task output panel links - TIDAK ADA
- [ ] Task variables substitution - TIDAK ADA

======================================================================
18. MISSING TERMINAL IMPROVEMENTS
======================================================================

- [ ] xterm.js integration (instead of QProcess) - TIDAK ADA
- [ ] Terminal tabs (VS Code style) - SEBAGIAN (ada combo-based)
- [ ] Terminal split panes - SEBAGIAN (via SplitTerminalContainer)
- [ ] Terminal drag-reorder tabs - TIDAK ADA
- [ ] Terminal color themes - TIDAK ADA
- [ ] Terminal font customization - SEBAGIAN
- [ ] Terminal cursor style - TIDAK ADA
- [ ] Terminal bell/audio cues - TIDAK ADA
- [ ] Terminal copy on select - TIDAK ADA
- [ ] Terminal selection - TIDAK ADA
- [ ] Terminal search (Ctrl+F) - TIDAK ADA
- [ ] Terminal link detection - TIDAK ADA
- [ ] Terminal environment variables - TIDAK ADA
- [ ] Terminal cwd per tab - TIDAK ADA
- [ ] Terminal icon customization - SEBAGIAN
- [ ] Terminal color customization - SEBAGIAN
- [ ] Terminal rename - SEBAGIAN (via context menu)
- [ ] Terminal profile management - TIDAK ADA
- [ ] Terminal shell type detection - TIDAK ADA
- [ ] Terminal process manager - TIDAK ADA
- [ ] Terminal scrollback limit - SEBAGIAN (1000)
- [ ] Terminal auto-replies (like VS Code) - TIDAK ADA
- [ ] Terminal send sequence (like VS Code) - TIDAK ADA
- [ ] Terminal sticky scroll - TIDAK ADA
- [ ] Terminal inline chat - TIDAK ADA
- [ ] Terminal quick fixes - TIDAK ADA
- [ ] Terminal WSL integration - TIDAK ADA

======================================================================
19. MISSING NOTEBOOK FEATURES
======================================================================

- [ ] Jupyter notebook (.ipynb) support - SEBAGIAN (ada NotebookEditor)
- [ ] Notebook cell execute - SEBAGIAN
- [ ] Notebook kernel management - SEBAGIAN (ada KernelClient)
- [ ] Notebook variable explorer - TIDAK ADA
- [ ] Notebook output rich display - TIDAK ADA
- [ ] Notebook cell drag-reorder - TIDAK ADA
- [ ] Notebook cell collapse - TIDAK ADA
- [ ] Notebook cell split/merge - TIDAK ADA
- [ ] Notebook cell move up/down - TIDAK ADA
- [ ] Notebook cell copy/cut/paste - TIDAK ADA
- [ ] Notebook cell tags/metadata - TIDAK ADA
- [ ] Notebook diff - TIDAK ADA
- [ ] Notebook to script export - TIDAK ADA
- [ ] Notebook trusted/untrusted - TIDAK ADA
- [ ] Notebook outline - TIDAK ADA
- [ ] Notebook table of contents - TIDAK ADA
- [ ] Notebook debugger integration - TIDAK ADA
- [ ] Notebook code folding - TIDAK ADA
- [ ] Notebook search - TIDAK ADA
- [ ] Notebook completion - TIDAK ADA
- [ ] Interactive window (REPL-like) - TIDAK ADA

======================================================================
20. MISSING TESTING FEATURES
======================================================================

- [ ] Test explorer (sidebar) - SEBAGIAN (ada TestExplorerPanel)
- [ ] Test run with debugging - TIDAK ADA
- [ ] Test coverage gutter - TIDAK ADA
- [ ] Test status bar indicator - TIDAK ADA
- [ ] Test output panel - TIDAK ADA
- [ ] Test failure decorations - TIDAK ADA
- [ ] Test run profiles - TIDAK ADA
- [ ] Test auto-discovery - TIDAK ADA
- [ ] Test breakpoints integration - TIDAK ADA
- [ ] Test continuous run - TIDAK ADA
- [ ] Test history - TIDAK ADA
- [ ] Test peek (inline test view) - TIDAK ADA
- [ ] Test related code - TIDAK ADA
- [ ] Test explorer auto-refresh - TIDAK ADA
- [ ] Test explorer sort/filter - TIDAK ADA
- [ ] Test explorer progress indicator - TIDAK ADA

======================================================================
21. MISSING EXTENSION SYSTEM FEATURES
======================================================================

- [ ] Marketplace integration (full) - SEBAGIAN (ada URLs)
- [ ] Extension search (online) - TIDAK ADA
- [ ] Extension install from VSIX - SEBAGIAN (ada vsix_parser)
- [ ] Extension auto-update - SEBAGIAN
- [ ] Extension recommendations - TIDAK ADA
- [ ] Extension contribution points parsing - SEBAGIAN
- [ ] Extension activation events (full) - SEBAGIAN
- [ ] Extension virtual document provider - TIDAK ADA
- [ ] Extension file system provider - TIDAK ADA
- [ ] Extension search provider - TIDAK ADA
- [ ] Extension text content provider - TIDAK ADA
- [ ] Extension webview view - TIDAK ADA
- [ ] Extension custom editor - TIDAK ADA
- [ ] Extension tree view (TreeDataProvider) - SEBAGIAN
- [ ] Extension status bar item - SEBAGIAN
- [ ] Extension output channel - SEBAGIAN
- [ ] Extension terminal - SEBAGIAN
- [ ] Extension debug adapter - TIDAK ADA
- [ ] Extension task provider - TIDAK ADA
- [ ] Extension test provider - TIDAK ADA
- [ ] Extension notebook content provider - TIDAK ADA
- [ ] Extension notebook kernel - TIDAK ADA
- [ ] Extension authentication provider - TIDAK ADA
- [ ] Extension MCP server - TIDAK ADA
- [ ] Extension language model - TIDAK ADA
- [ ] Extension chat participant - TIDAK ADA
- [ ] Extension inline completion - TIDAK ADA
- [ ] Extension hover provider - TIDAK ADA
- [ ] Extension completion provider - TIDAK ADA
- [ ] Extension diagnostic provider - TIDAK ADA
- [ ] Extension code action provider - TIDAK ADA
- [ ] Extension code lens provider - TIDAK ADA
- [ ] Extension definition provider - TIDAK ADA
- [ ] Extension reference provider - TIDAK ADA
- [ ] Extension rename provider - TIDAK ADA
- [ ] Extension signature help provider - TIDAK ADA
- [ ] Extension document link provider - TIDAK ADA
- [ ] Extension document color provider - TIDAK ADA
- [ ] Extension document highlight provider - TIDAK ADA
- [ ] Extension document formatting provider - TIDAK ADA
- [ ] Extension folding range provider - TIDAK ADA
- [ ] Extension selection range provider - TIDAK ADA
- [ ] Extension inline values provider - TIDAK ADA
- [ ] Extension inline hints provider - TIDAK ADA
- [ ] Extension type hierarchy provider - TIDAK ADA
- [ ] Extension call hierarchy provider - TIDAK ADA
- [ ] Extension linked editing provider - TIDAK ADA
- [ ] Extension semantic tokens provider - TIDAK ADA
- [ ] Extension clipboard provider - TIDAK ADA
- [ ] Extension drop into editor provider - TIDAK ADA
- [ ] Extension drag and drop provider - TIDAK ADA
- [ ] Extension comment provider - TIDAK ADA
- [ ] Extension timeline provider - TIDAK ADA
- [ ] Extension language status provider - TIDAK ADA
- [ ] Extension inline chat provider - TIDAK ADA
- [ ] Extension speech provider - TIDAK ADA

======================================================================
22. MISSING KEYBOARD SHORTCUTS (keybindings incomplete)
======================================================================

- [ ] Ctrl+Shift+P (Command Palette) - ADA
- [ ] Ctrl+P (Quick Open) - ADA
- [ ] Ctrl+Shift+N (New Window) - ADA
- [ ] Ctrl+W (Close Editor) - ADA
- [x] Ctrl+K Ctrl+W (Close All) - ADA (shortcut added)
- [ ] Ctrl+Tab (Cycle Editor Tab) - ADA
- [ ] Ctrl+K Ctrl+Tab (Cycle Editor Group) - TIDAK ADA
- [ ] Ctrl+\ (Split Editor) - ADA
- [ ] Ctrl+K Ctrl+\ (Split Editor Down) - ADA
- [x] Ctrl+1/2/3 (Focus Editor Group) - ADA (shortcut added)
- [x] Ctrl+K Ctrl+Left/Right (Focus Group) - ADA (shortcut added)
- [ ] Ctrl+Shift+E (Explorer) - ADA
- [ ] Ctrl+Shift+F (Search) - ADA
- [ ] Ctrl+Shift+G (Source Control) - ADA
- [ ] Ctrl+Shift+D (Run and Debug) - ADA (via command palette)
- [ ] Ctrl+Shift+X (Extensions) - ADA
- [ ] Ctrl+Shift+H (Replace in Files) - ADA (redirect ke search)
- [ ] Ctrl+Shift+J (Toggle Chat) - ADA
- [ ] Ctrl+Shift+M (Problems) - ADA
- [ ] Ctrl+Shift+U (Output) - ADA
- [ ] Ctrl+Shift+Y (Debug Console) - ADA
- [ ] Ctrl+Shift+V (Markdown Preview) - ADA
- [x] Ctrl+K V (Markdown Preview Side) - ADA (shortcut added)
- [ ] Ctrl+K Z (Zen Mode) - ADA
- [ ] Ctrl+B (Toggle Sidebar) - ADA
- [ ] Ctrl+` (Toggle Terminal) - ADA
- [ ] Ctrl+J (Toggle Panel) - ADA
- [ ] Ctrl+K Ctrl+S (Keyboard Shortcuts) - ADA
- [ ] Ctrl+K Ctrl+T (Color Theme) - ADA
- [ ] Ctrl+, (Settings) - ADA
- [ ] Ctrl+K Ctrl+R (Keyboard Reference) - TIDAK ADA
- [x] F1 (Command Palette) - ADA (shortcut added)
- [ ] F5 (Start Debugging) - ADA
- [ ] Ctrl+F5 (Run Without Debugging) - ADA
- [ ] Shift+F5 (Stop Debugging) - ADA
- [ ] Ctrl+Shift+F5 (Restart Debugging) - ADA
- [ ] F9 (Toggle Breakpoint) - ADA
- [ ] F10 (Step Over) - ADA
- [ ] F11 (Step Into) - ADA
- [ ] Shift+F11 (Step Out) - ADA
- [ ] F8 (Next Problem) - ADA (via command palette)
- [ ] Shift+F8 (Previous Problem) - ADA (via command palette)
- [ ] F12 (Go to Definition) - ADA
- [ ] Alt+F12 (Peek Definition) - ADA (via Monaco command)
- [x] Ctrl+F12 (Go to Implementation) - ADA (Monaco command added)
- [x] Shift+F12 (Go to References) - ADA (Monaco command added)
- [ ] Ctrl+- (Navigate Back) - ADA
- [ ] Ctrl+Shift+- (Navigate Forward) - ADA
- [ ] Ctrl+Shift+O (Go to Symbol) - ADA
- [ ] Ctrl+T (Go to Symbol in Workspace) - ADA
- [ ] Ctrl+G (Go to Line) - ADA
- [ ] Ctrl+K Ctrl+Q (Last Edit Location) - TIDAK ADA
- [x] Ctrl+Shift+\ (Go to Bracket) - ADA (Monaco command added)
- [ ] Ctrl+D (Add Selection to Next Find Match) - ADA (via Monaco)
- [x] Ctrl+U (Undo Last Cursor) - ADA (Monaco command Ctrl+U → cursorUndo)
- [ ] Ctrl+Shift+L (Select All Occurrences) - ADA (via Monaco)
- [ ] Ctrl+Alt+Up/Down (Add Cursor) - ADA (via Monaco)
- [ ] Shift+Alt+I (Add Cursor to Line Ends) - ADA (via Monaco)
- [ ] Ctrl+I (Inline Chat) - ADA
- [x] Ctrl+Shift+I (Toggle Developer Tools) - ADA (shortcut added)
- [x] F11 (Full Screen) - ADA (shortcut added)
- [ ] Shift+Alt+Up/Down (Copy Line) - ADA (via Monaco)
- [ ] Alt+Up/Down (Move Line) - ADA (via Monaco)
- [ ] Ctrl+Shift+K (Delete Line) - ADA (via Monaco)
- [ ] Ctrl+Enter (Insert Line Below) - ADA (via Monaco)
- [ ] Ctrl+Shift+Enter (Insert Line Above) - ADA (via Monaco)
- [ ] Ctrl+/ (Toggle Line Comment) - ADA (via Monaco)
- [ ] Shift+Alt+A (Toggle Block Comment) - ADA (via Monaco)
- [ ] Ctrl+Space (Trigger Suggest) - ADA (via Monaco)
- [x] Ctrl+Shift+Space (Trigger Parameter Hints) - ADA (Monaco command added)
- [ ] Shift+Alt+F (Format Document) - ADA
- [x] Ctrl+K Ctrl+F (Format Selection) - ADA (Monaco command added)
- [x] Ctrl+. (Quick Fix) - ADA (Monaco command added)
- [ ] F2 (Rename Symbol) - ADA (via Monaco)
- [x] Ctrl+F2 (Change All Occurrences) - ADA (Monaco command added)
- [ ] Alt+F3 (Next Change) - TIDAK ADA
- [ ] Shift+Alt+F3 (Previous Change) - TIDAK ADA
- [ ] Ctrl+K M (Keymaps) - TIDAK ADA
- [x] Ctrl+K Ctrl+I (Show Hover) - ADA (Monaco command added)
- [ ] Ctrl+K Ctrl+; (Add Line Above Cursor) - TIDAK ADA
- [ ] Ctrl+Shift+[ (Fold) - ADA (via Monaco)
- [ ] Ctrl+Shift+] (Unfold) - ADA (via Monaco)
- [ ] Ctrl+K Ctrl+0 (Fold All) - ADA (via Monaco)
- [ ] Ctrl+K Ctrl+J (Unfold All) - ADA (via Monaco)
- [x] Ctrl+Numpad0 (Reset Zoom) - ADA (Ctrl+0 shortcut added)
- [ ] Ctrl+= (Zoom In) - ADA
- [ ] Ctrl+- (Zoom Out) - ADA
- [ ] Alt+Z (Word Wrap) - ADA
- [ ] Alt+Left (Navigate Back) - ADA
- [ ] Alt+Right (Navigate Forward) - ADA
- [ ] Ctrl+Shift+Tab (Editor Quick Access Prev) - ADA

======================================================================
23. KNOWN BUGS & ISSUES (Dari Source Code)
======================================================================

### BUGS KRITIS:
- [x] [BUG-001] Navigation back/forward stacks rusak: FIXED - pop() LIFO + forward stack preserved correctly
- [x] [BUG-002] MainWindow._execute_command duplicate keys: FIXED - removed duplicate handler entries
- [x] [BUG-003] GoToLineDialog tidak connect Enter key: FIXED - explicit Return and Enter keyPressEvent handlers added
- [x] [BUG-004] ThemeManager.register_extension_themes dipanggil 2x: FIXED - deduplicated with a class flag
- [x] [BUG-005] _navigate_back menggunakan self._nav_back_stack.pop(0) yang O(n): FIXED - pop() O(1)
- [x] [BUG-006] _navigate_back mengosongkan _nav_forward_stack dengan cara salah: FIXED
- [x] [BUG-007] _sidebar_positions swapping rusak: FIXED - renamed _horiz_split → _main_split
- [x] [BUG-008] set_primary_sidebar_position rusak karena _horiz_split tidak ada: FIXED
- [x] [BUG-009] Terminal combo_box disembunyikan: FIXED - displayed and integrated into toolbar
- [x] [BUG-010] _update_sidebar_list di terminal panel selalu reset combo_box items: FIXED - incremental UI updates
- [x] [BUG-011] TerminalPanel._switch_tab block signals recursion risk: FIXED - signals blocked on both widgets during updates
- [x] [BUG-012] DebugPanel._clear_sections tidak handle exception: FIXED - wrapped in try-except block
- [x] [BUG-013] SearchPanel scan_files hanya scan .py files untuk # search: FIXED - global symbol search parses multiple formats
- [x] [BUG-014] QuickOpenDialog._scan_files tidak async: FIXED - file scanning run asynchronously in background thread
- [x] [BUG-015] QuickOpenDialog._on_filter untuk "@" hanya support Python symbols: FIXED - general outline symbols parser integrated
- [x] [BUG-016] WelcomePageWidget menggunakan emoji characters hardcoded: FIXED - clean ASCII-compatible text labels
- [x] [BUG-017] MarkdownPreviewWidget hanya support file, tidak support live edit: FIXED - real-time preview updates on keystrokes
- [x] [BUG-018] Settings dialog tidak searchable: FIXED - settings search bar and live row filter logic added
- [x] [BUG-019] AutoSave timer tidak mati setelah save: FIXED - timer is singleShot, restarts only on dirty change
- [x] [BUG-020] _save_all_dirty_if_auto_save panggil save_all terus-terusan tiap detik: FIXED

### BUGS UI:
- [x] [BUG-021] Status bar items overlap saat window di-resize terlalu kecil: FIXED - progressive hiding of status bar buttons on narrow window width
- [x] [BUG-022] Activity bar icon alignment tidak konsisten: FIXED - text-align: center added to stylesheet of ActivityBarButton
- [x] [BUG-023] Editor tab close button tidak selalu visible: FIXED - leaveEvent coordinates check added to FlowTabButton to prevent early hiding on child hover
- [x] [BUG-024] Splitters tidak bisa drag dengan mulus: FIXED - handle widths increased to 4px across all main splitters
- [x] [BUG-025] Command palette list item height kadang inconsistent: FIXED - standardized selectable item heights to 28px and implemented _adjust_popup_size
- [x] [BUG-026] Welcome page scroll area tidak auto-scroll ke aktivitas terkini: FIXED - added showEvent scroll reset and implemented 'Recent' items checklist section
- [x] [BUG-027] Theme overlay spinner tidak centered di beberapa layout: FIXED - implemented Resize event filter in ThemeLoadingOverlay to match parent bounds
- [x] [BUG-028] Focus outline tidak visible untuk keyboard navigation: FIXED - added global focus border styles in ThemeManager
- [x] [BUG-029] Context menu border tidak konsisten: FIXED - removed local/hardcoded context menu stylesheets in favor of dynamic theme styles
- [x] [BUG-030] Bottom panel tabs tidak ada icons (beda dengan VS Code): FIXED - added codicon icons to all bottom panel tabs
- [x] [BUG-031] Editor tab bar tidak support tab wrapping: FIXED - enabled WA_StyledBackground on FlowTabButton to support wrap stylesheet drawing
- [x] [BUG-032] Git panel webview loaded check tidak reliable: FIXED - decoupled loaded states and added bridge data reload on page load finished
- [x] [BUG-033] Chat panel typing indicator tidak sinkron dengan actual streaming: FIXED - integrated independent HTML typing-indicator element toggle in JS and Python backend
- [x] [BUG-034] Notification badge di status bar posisi absolute, tidak responsive: FIXED - responsive badge relocation in resizeEvent
- [x] [BUG-035] Dialog popup position tidak selalu centered di multi-monitor setup: FIXED - used mapToGlobal to center dialogs relative to parent screen positions

### BUGS PERFORMANCE:
- [x] [BUG-036] Flake8 linter blocking: FIXED - added timeouts & creationflags to prevent system command blocking
- [x] [BUG-037] QuickOpenDialog._scan_files untuk folder besar blocking UI: FIXED - background thread scanner added
- [x] [BUG-038] _parse_outline_symbols dipanggil tiap content change: FIXED - 500ms debounce timer added
- [x] [BUG-039] Monaco editor webview reload tiap tab switch (resource heavy): FIXED - set QStackedWidget layout stackingMode to StackAll to keep active/inactive webviews alive without GPU suspension/flickering
- [x] [BUG-040] Git status bar check setiap 1 detik tanpa caching: FIXED - added 5-second branch polling timer with rate-limiting and caching
- [x] [BUG-041] LSP didChange dikirim tiap keypress tanpa debounce: FIXED - debounced LSP didChange notifications using a QTimer with a 300ms delay
- [x] [BUG-042] Theme overlay blocking UI dengan QApplication.processEvents: FIXED - removed manual QApplication.processEvents call from _set_theme, letting the Qt event loop process repaint natively
- [x] [BUG-043] Chat panel append message tidak batch, satu-satu ke UI thread: FIXED - batched tool output streams using a 50ms buffering timer
- [x] [BUG-044] Tree widget populate tidak pakai beginResetModel/endResetModel: FIXED - added layoutAboutToBeChanged and layoutChanged model resets to the ExplorerTreeWidget
- [x] [BUG-045] File explorer refresh tidak incremental, full rebuild: FIXED - implemented directory-specific subtree refresh, only reloading changed directories during file updates

### BUGS MEMORY LEAKS:
- [BUG-046] Editor widget cleanup tidak complete (bridge/channel leaks)
- [BUG-047] QWebEngineView tidak di-delete dengan benar (memory leak)
- [BUG-048] Thread pool tasks tidak di-cancel saat window close
- [BUG-049] Signal connections tidak di-disconnect di cleanup
- [BUG-050] Extension manager tidak unloading extensions dengan bersih

### BUGS FUNCTIONAL:
- [BUG-051] New file tidak auto-select di file explorer
- [BUG-052] File rename di explorer tidak refresh tree
- [BUG-053] File delete tidak confirm dialog
- [BUG-054] Drag-drop file dari luar app tidak didukung
- [BUG-055] Multi-root workspace tidak berfungsi (stub only)
- [BUG-056] Workspace trust tidak benar-benar membatasi akses
- [BUG-057] Settings sync tidak benar-benar sync ke cloud
- [BUG-058] Remote SSH connection tidak persistent
- [BUG-059] Live server start/stop race condition
- [BUG-060] DAP client reconnect tidak handle error
- [BUG-061] Extension install tidak handle dependencies
- [BUG-062] Extension host crash handling tidak ada
- [BUG-063] Keybinding conflicts tidak di-check
- [BUG-064] Language detection hanya berdasarkan extension, tidak content-based
- [BUG-065] Snippet completion tidak work di Monaco bridge
- [BUG-066] Format document tidak async (block UI sampai complete)
- [BUG-067] Go to definition tidak handle cross-file references
- [BUG-068] Find references tidak ada implementasi (stub only)
- [BUG-069] Rename symbol tidak update imports
- [BUG-070] Code action lightbulb tidak muncul
- [BUG-071] Hover provider tidak panggil LSP
- [BUG-072] Diagnostics tidak auto-clear setelah file closed
- [BUG-073] Breakpoint gutter indicator tidak sync dengan Monaco
- [BUG-074] Debug variable view tidak nested
- [BUG-075] Debug watch expressions tidak evaluate
- [BUG-076] Git blame tidak ada di editor gutter
- [BUG-077] Git diff colors tidak apply di editor
- [BUG-078] Git stanging/unstaging UI tidak work
- [BUG-079] Git commit message box tidak ada
- [BUG-080] Notification center history tidak persist

### BUGS CROSS-PLATFORM:
- [BUG-081] Signal handler hanya untuk Windows (SIGBREAK), tidak untuk Linux/Mac
- [BUG-082] Terminal backend macOS tidak diimplementasi
- [BUG-083] File path handling tidak konsisten (forward/backslash)
- [BUG-084] Font fallback berbeda per platform (Windows DirectWrite issues)
- [BUG-085] High DPI scaling tidak optimal di Linux (X11)
- [BUG-086] Keyboard shortcut mapping berbeda per platform
- [BUG-087] Menu bar shortcut labels tidak update untuk Mac (Cmd vs Ctrl)
- [BUG-088] Window decoration frameless berbeda behavior di Linux
- [BUG-089] Size grip hanya untuk non-Windows (seharusnya untuk semua)
- [BUG-090] File watcher (inotify) tidak ada di Linux/Mac

### BUGS SECURITY:
- [BUG-091] AI agent command execution tanpa approval untuk certain commands
- [BUG-092] Telemetry data tidak anonymized
- [BUG-093] Extension install tidak verifikasi signature
- [BUG-094] Workspace trust tidak enforce di file system access
- [BUG-095] API keys tersimpan di plain text config
- [BUG-096] No sandboxing untuk extension host
- [BUG-097] HTML content di webview tidak disanitize
- [BUG-098] File path traversal tidak divalidasi
- [BUG-099] Network requests tidak pakai proxy settings
- [BUG-100] URL handler tidak validate protocol

======================================================================
24. MISSING MENU ITEMS (Dibanding VS Code)
======================================================================

### FILE MENU (VS Code):
- [ ] New File... (Ctrl+Alt+Win+N) - TIDAK ADA (redirect ke command palette)
- [ ] New Window (Ctrl+Shift+N) - ADA
- [ ] Open File... (Ctrl+O) - ADA
- [ ] Open Folder... (Ctrl+K Ctrl+O) - ADA
- [ ] Open Workspace from File... - TIDAK ADA (redirect ke command palette)
- [ ] Open Recent - TIDAK ADA (stub)
- [ ] Add Folder to Workspace... - TIDAK ADA (redirect ke command palette)
- [ ] Save Workspace As... - TIDAK ADA (redirect ke command palette)
- [ ] Duplicate Workspace - TIDAK ADA (redirect ke command palette)
- [ ] Auto Save (checkable) - ADA
- [ ] Preferences > Settings (Ctrl+,) - ADA
- [ ] Preferences > Extensions (Ctrl+Shift+X) - ADA
- [ ] Preferences > Keyboard Shortcuts (Ctrl+K Ctrl+S) - ADA
- [ ] Preferences > Keymaps (Ctrl+K Ctrl+M) - TIDAK ADA (redirect)
- [ ] Preferences > User Snippets - TIDAK ADA (redirect)
- [ ] Preferences > Color Theme (Ctrl+K Ctrl+T) - ADA
- [ ] Preferences > File Icon Theme - ADA
- [ ] Preferences > Product Icon Theme - TIDAK ADA (redirect)
- [ ] Revert File - TIDAK ADA (redirect)
- [ ] Close Folder (Ctrl+K F) - ADA
- [ ] Close Window (Alt+F4) - ADA
- [ ] Share > Export Profile - TIDAK ADA (redirect)

### MISSING MENUS:
- [ ] Panel Menu - TIDAK ADA (harusnya ada di VS Code baru)
- [ ] Accounts Menu - TIDAK ADA

======================================================================
25. MISSING WORKBENCH SERVICES (93 VS Code services)
======================================================================

- [ ] CodeEditorService - TIDAK ADA
- [ ] EditorService (open/custom editor resolution) - SEBAGIAN
- [ ] EditorResolverService - TIDAK ADA
- [ ] EditorPaneService - TIDAK ADA
- [ ] CustomEditorLabelService - TIDAK ADA
- [ ] ExtensionManagementService - SEBAGIAN
- [ ] ExtensionTipsService - TIDAK ADA
- [ ] ExtensionsScannerService - TIDAK ADA
- [ ] ExtensionGalleryService - TIDAK ADA
- [ ] ConfigurationService - SEBAGIAN (ada core/config.py)
- [ ] JSONEditingService - TIDAK ADA
- [ ] WorkspacesService - TIDAK ADA
- [ ] WorkspaceEditingService - TIDAK ADA
- [ ] CanonicalUriService - TIDAK ADA
- [ ] TextFileService - SEBAGIAN
- [ ] FileDialogService - SEBAGIAN
- [ ] ElevatedFileService - TIDAK ADA
- [ ] TerminalService - SEBAGIAN (ada TerminalPanel)
- [ ] EmbedderTerminalService - TIDAK ADA
- [ ] AuthenticationService - TIDAK ADA
- [ ] ChatEntitlementService - TIDAK ADA
- [ ] McpWorkbenchManagementService - TIDAK ADA
- [ ] McpGalleryManifestService - TIDAK ADA
- [ ] KeybindingService - SEBAGIAN (ada KeybindingsManager)
- [ ] KeybindingEditing - TIDAK ADA
- [ ] NotificationService - SEBAGIAN (ada NotificationService)
- [ ] ProgressService - TIDAK ADA
- [ ] QuickInputService - TIDAK ADA
- [ ] SearchService - TIDAK ADA
- [ ] WorkbenchThemeService - SEBAGIAN
- [ ] BrowserHostColorSchemeService - TIDAK ADA
- [ ] UserDataSyncWorkbenchService - SEBAGIAN
- [ ] UserDataProfileManagement - TIDAK ADA
- [ ] UserDataProfileImportExportService - TIDAK ADA
- [ ] ViewDescriptorService - TIDAK ADA
- [ ] ViewsService - TIDAK ADA
- [ ] ActivityService - TIDAK ADA
- [ ] LanguageService - TIDAK ADA
- [ ] LanguageDetectionService - TIDAK ADA
- [ ] HistoryService - TIDAK ADA (ada basic navigation)
- [ ] TelemetryService - SEBAGIAN
- [ ] RemoteExplorerService - TIDAK ADA
- [ ] AgentHostService - TIDAK ADA
- [ ] EncryptionService - TIDAK ADA
- [ ] SecretStorageService - TIDAK ADA
- [ ] ClipboardService - TIDAK ADA
- [ ] ContextMenuService - TIDAK ADA
- [ ] TunnelService - TIDAK ADA
- [ ] UpdateService - SEBAGIAN
- [ ] WorkingCopyBackupService - TIDAK ADA
- [ ] WorkingCopyService - TIDAK ADA
- [ ] WorkingCopyFileService - TIDAK ADA
- [ ] IntegrityService - TIDAK ADA
- [ ] LifecycleService - SEBAGIAN
- [ ] PowerService - TIDAK ADA

======================================================================
26. MISSING WINDOW MANAGEMENT
======================================================================

- [ ] Multi-window support - SEBAGIAN (ada multi_window.py)
- [ ] Multi-window file drag-drop - TIDAK ADA
- [ ] Window position memory - SEBAGIAN
- [ ] Window size memory - SEBAGIAN
- [ ] Full screen mode - SEBAGIAN
- [ ] Presentation mode - TIDAK ADA
- [ ] Zen mode - ADA
- [ ] Centered layout - ADA
- [ ] Window title customization - SEBAGIAN
- [ ] Window zoom level - SEBAGIAN
- [ ] Grid layout (2x2, 3 columns, etc.) - SEBAGIAN (stub)
- [ ] Editor group splitting (up/down/left/right) - SEBAGIAN
- [ ] Editor group drag tabs between groups - TIDAK ADA
- [ ] Editor tab preview mode - TIDAK ADA
- [ ] Auxiliary windows (floating editors) - SEBAGIAN
- [ ] Window title bar customization - SEBAGIAN
- [ ] Custom title bar (frameless) - ADA
- [ ] OS-level window snap support - TIDAK ADA
- [ ] Window taskbar progress indicator - TIDAK ADA
- [ ] Window taskbar icon overlay - TIDAK ADA
- [ ] Window jump list (Windows) - TIDAK ADA
- [ ] Window multi-monitor DPI handling - TIDAK ADA

======================================================================
27. MISSING WEBVIEW FEATURES
======================================================================

- [ ] Webview panel (sidebar) - SEBAGIAN (ada WebviewPanel)
- [ ] Webview view (anywhere) - TIDAK ADA
- [ ] Webview editor (custom editor) - TIDAK ADA
- [ ] Webview options (allowScripts, etc.) - TIDAK ADA
- [ ] Webview retain context when hidden - TIDAK ADA
- [ ] Webview serializer (state persistence) - TIDAK ADA
- [ ] Webview transferable (move windows) - TIDAK ADA
- [ ] Webview port mapping - TIDAK ADA
- [ ] Webview CSP (Content Security Policy) - TIDAK ADA
- [ ] Webview local resource access - TIDAK ADA
- [ ] Webview postMessage protocol - TIDAK ADA

======================================================================
28. MISSING PRODUCT ICONS
======================================================================

- [ ] Product icon theme support - TIDAK ADA
- [ ] Default VS Code codicons mapping - SEBAGIAN
- [ ] Extension product icon contributions - TIDAK ADA
- [ ] Icon theme picker UI - TIDAK ADA
- [ ] Built-in product icon themes - TIDAK ADA
- [ ] Codicon font loading - ADA (codicon.ttf)
- [ ] Extension icon path resolution - SEBAGIAN

======================================================================
29. MISSING ACCESSIBILITY FEATURES
======================================================================

- [ ] Screen reader support (NVDA/JAWS) - TIDAK ADA
- [ ] ARIA labels on UI elements - TIDAK ADA
- [ ] Keyboard navigation (full) - SEBAGIAN
- [ ] Tab trap in dialogs - TIDAK ADA
- [ ] Focus indicator (high contrast) - TIDAK ADA
- [ ] Audio cues for events - SEBAGIAN (ada audio_cues.py)
- [ ] High contrast theme - SEBAGIAN
- [ ] Reduced motion support - TIDAK ADA
- [ ] Font ligatures support - TIDAK ADA
- [ ] Editor accessibility (line numbers, etc.) - TIDAK ADA
- [ ] Terminal accessibility (screen reader) - TIDAK ADA
- [ ] Notification for screen readers - TIDAK ADA
- [ ] Navigate by section landmarks - TIDAK ADA
- [ ] Color blind friendly themes - TIDAK ADA
- [ ] Zoom without layout shift - TIDAK ADA

======================================================================
30. MISSING INTERNATIONALIZATION (i18n)
======================================================================

- [ ] Language pack support - TIDAK ADA (ada i18n.py skeleton)
- [ ] UI translation system - TIDAK ADA
- [ ] Locale detection - TIDAK ADA
- [ ] Right-to-left (RTL) support - TIDAK ADA
- [ ] Date/number formatting per locale - TIDAK ADA
- [ ] Keyboard shortcut labels per locale - TIDAK ADA
- [ ] Marketplace language packs - TIDAK ADA
- [ ] Translated extension names - TIDAK ADA
- [ ] Locale-specific file encoding - TIDAK ADA

======================================================================
31. MISSING TELEMETRY & CRASH REPORTING
======================================================================

- [ ] Telemetry opt-in dialog - TIDAK ADA
- [ ] Telemetry data collection service - SEBAGIAN
- [ ] Crash reporter with stack trace - SEBAGIAN
- [ ] Usage statistics dashboard - TIDAK ADA
- [ ] Performance telemetry - TIDAK ADA
- [ ] Extension telemetry - TIDAK ADA
- [ ] Error telemetry with context - TIDAK ADA
- [ ] Telemetry GDPR compliance - TIDAK ADA
- [ ] Telemetry disable per extension - TIDAK ADA
- [ ] Online services error reporting - TIDAK ADA

======================================================================
32. MISSING CODE EDITOR BRIDGE IMPROVEMENTS
======================================================================

- [ ] Incremental text sync (instead of full content) - TIDAK ADA
- [ ] Monaco editor worker threads - TIDAK ADA
- [ ] Monaco editor language worker - TIDAK ADA
- [ ] QWebChannel communication optimization - TIDAK ADA
- [ ] Editor state serialization per file - SEBAGIAN
- [ ] Undo stack preservation across sessions - TIDAK ADA
- [ ] Editor view state restore (scroll, folding) - SEBAGIAN
- [ ] Multi-cursor state sync - TIDAK ADA
- [ ] Selection state sync - TIDAK ADA
- [ ] Syntax highlighting theme sync - SEBAGIAN
- [ ] Editor font/theme settings live update - SEBAGIAN
- [ ] Editor minimap settings sync - SEBAGIAN
- [ ] Editor rulers settings - TIDAK ADA
- [ ] Editor word wrap column - TIDAK ADA
- [ ] Editor tab size per language - TIDAK ADA
- [ ] Editor insert spaces per language - TIDAK ADA
- [ ] Editor format on paste - TIDAK ADA
- [ ] Editor format on save - TIDAK ADA (config ada)
- [ ] Editor code actions on save - TIDAK ADA
- [ ] Editor suggest selection mode - TIDAK ADA
- [ ] Editor snippet suggestions - TIDAK ADA
- [ ] Editor quick suggestions per language - TIDAK ADA (config ada)
- [ ] Editor bracket pair colorization - SEBAGIAN (via Monaco)
- [ ] Editor guides (indent/bracket) - TIDAK ADA
- [ ] Editor smooth scrolling - TIDAK ADA
- [ ] Editor cursor animation - TIDAK ADA
- [ ] Editor cursor style - TIDAK ADA
- [ ] Editor mouse scroll wheel zoom - TIDAK ADA
- [ ] Editor multi-cursor paste - TIDAK ADA
- [ ] Editor drag and drop text - TIDAK ADA
- [ ] Editor trim auto whitespace - TIDAK ADA (config ada)
- [ ] Editor semantic highlighting - TIDAK ADA
- [ ] Editor color decorations - TIDAK ADA
- [ ] Editor glyph margin - TIDAK ADA
- [ ] Editor folding highlight - TIDAK ADA
- [ ] Editor unicode highlighting - TIDAK ADA

======================================================================
33. SUMMARY STATS
======================================================================

Total fitur VS Code: ~1000+
Total terimplementasi di Dardcor: ~250 (25%)
Total MISSING/BELUM BERFUNGSI: ~750+ (75%)

Bugs teridentifikasi: 100 (BUG-001 s/d BUG-100)
- Critical/Functional: 20
- UI: 15
- Performance: 10
- Memory Leaks: 5
- Cross-platform: 10
- Security: 10
- Missing features: 750+

======================================================================
END OF AGENT.md
======================================================================
