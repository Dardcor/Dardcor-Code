# AGENT.md — Dardcor Code → VS Code 100% Parity

Baca lengkap project asli dari Visual Studio Code wajib : C:\Users\Dardcor\Documents\Code Editor\Visual Studio Code

> Dokumen ini berisi daftar LENGKAP semua fitur, komponen, menu, icon, logika, dan tampilan yang harus diimplementasikan agar Dardcor Code SAMA PERSIS dengan Visual Studio Code asli.
>
> Metode: Setiap task dikerjakan SATU PER SATU. Setelah selesai, hapus [ ] dan ganti dengan [x].
> TIDAK BOLEH skip. TIDAK BOLEH mock. TIDAK BOLEH stub. Setiap fitur harus benar-benar bekerja.
>
> Format: [ ] Nomor_Task — Deskripsi — File yg perlu dibuat/dimodifikasi — Tingkat Kesulitan (1-10)

---

## 🚨 PRIORITAS TERTINGGI — Bugs Kritis

- [ ] BUG-001 — Fix crash saat buka file >10MB (editor/widget.py, monaco_editor.html perlu virtualized rendering)
- [ ] BUG-002 — Fix memory leak di QWebEngineView (setiap ganti tab, webview lama tidak di-delete)
- [ ] BUG-003 — Fix undo/redo broken setelah 3+ perubahan (Monaco ↔ Python state sync error)
- [ ] BUG-004 — Fix terminal PTY hang setelah 5 menit (pywinpty reader thread blocking)
- [ ] BUG-005 — Fix extension install gagal di Windows path dengan spasi (extension_manager.py quote handling)
- [ ] BUG-006 — Fix file explorer drag-drop crash (panel.py QDrag event loop conflict)
- [ ] BUG-007 — Fix auto-save double-write bug (config.py timer + content_changed conflict)
- [ ] BUG-008 — Fix command palette tidak muncul di secondary screen (command_palette.py parent window issue)
- [ ] BUG-009 — Fix LSP client reconnect loop (client.py infinite retry on crash)
- [ ] BUG-010 — Fix DAP client firehose crash (dap_client.py buffer overflow pada output besar)

---

## 📋 DAFTAR TASK — Lengkap

### ====== 1. INFRASTRUKTUR CORE ======

- [ ] TASK-0001 — Dependency Injection Container — Buat service locator/DI container seperti `src/vs/platform/instantiation/` — File: `pydardcor/core/di.py` — Difficulty: 8
- [ ] TASK-0002 — Service Registry Pattern — Semua service harus diregister via DI, bukan instantiate manual — File: seluruh `pydardcor/core/` + `pydardcor/app/` — Difficulty: 9
- [ ] TASK-0003 — Event Bus System — Buat global event bus (pub/sub) seperti VS Code — File: `pydardcor/core/event_bus.py` — Difficulty: 6
- [ ] TASK-0004 — Context Key Engine — Implementasi penuh `when` clause evaluator (bukan return True) — File: `pydardcor/core/context_keys.py` — Difficulty: 7
- [ ] TASK-0005 — Command System — Register/execute command dengan argument, hasil, progress — File: `pydardcor/core/commands.py` (improve) — Difficulty: 7
- [ ] TASK-0006 — Keybinding Resolver — Resolve keybinding conflicts dengan priority — File: `pydardcor/core/keybinding_manager.py` (replace) — Difficulty: 8
- [ ] TASK-0007 — Keyboard Layout Detection — Deteksi layout keyboard (QWERTY/AZERTY/DVORAK) — File: `pydardcor/core/keyboard_layout.py` — Difficulty: 6
- [ ] TASK-0008 — Configuration Layer — Hierarchical config: Default → User → Workspace → Folder — File: `pydardcor/core/config.py` (improve) — Difficulty: 5
- [ ] TASK-0009 — Logging Framework — Structured logging dengan channel, level, file rotation — File: `pydardcor/core/log.py` — Difficulty: 4
- [ ] TASK-0010 — Storage Service — Key-value storage persistent (sqlite/IndexedDB-like) — File: `pydardcor/core/storage.py` — Difficulty: 5
- [ ] TASK-0011 — Lifecycle Management — Application lifecycle (startup, ready, shutdown phases) — File: `pydardcor/core/lifecycle.py` — Difficulty: 5
- [ ] TASK-0012 — Error Boundary — Global error handler + recovery per component — File: `pydardcor/core/error_boundary.py` — Difficulty: 6
- [ ] TASK-0013 — Progress Service — Progress reporting dengan cancellable operation — File: `pydardcor/core/progress.py` — Difficulty: 4
- [ ] TASK-0014 — URI Identity Service — Canonical URI untuk file dan resource — File: `pydardcor/core/uri.py` — Difficulty: 3
- [ ] TASK-0015 — Product Configuration — product.json dengan branding, extensions, defaults — File: `pydardcor/product.json` — Difficulty: 2

### ====== 2. WINDOW & LAYOUT ======

- [ ] TASK-0016 — Multi-Window Support — Buka beberapa window independen — File: `pydardcor/windows/multi_window.py` — Difficulty: 8
- [ ] TASK-0017 — Auxiliary Window — Window kedua utk panel tambahan — File: `pydardcor/windows/auxiliary_window.py` — Difficulty: 7
- [ ] TASK-0018 — Layout Service — Save/restore layout lengkap (bukan cuma size) — File: `pydardcor/app/layout_service.py` — Difficulty: 7
- [ ] TASK-0019 — Sash Resizer — Drag handle utk resize panel dengan snap — File: upgrade existing splitters — Difficulty: 5
- [ ] TASK-0020 — Panel Position — Bottom/Right/Left/None untuk panel — File: `pydardcor/ui_shared/bottom_panel.py` (improve) — Difficulty: 6
- [ ] TASK-0021 — Editor Layout Presets — Single/2 columns/3 columns/2 rows/3 rows/grid — File: `pydardcor/editor/tabs.py` (improve grid) — Difficulty: 5
- [ ] TASK-0022 — Zen Mode — Fullscreen tanpa UI (true implementation) — File: `pydardcor/editor/zen_mode.py` (improve) — Difficulty: 4
- [ ] TASK-0023 — Centered Layout — Editor content centered — File: `pydardcor/editor/centered_layout.py` — Difficulty: 3
- [ ] TASK-0024 — Activity Bar Position — Left/Right/Hidden setting — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 4
- [ ] TASK-0025 — Side Bar Position — Left/Right — File: main layout — Difficulty: 5
- [ ] TASK-0026 — Banner Part — Top notification banner — File: `pydardcor/ui_shared/banner.py` — Difficulty: 3
- [ ] TASK-0027 — Drop Target Overlay — Visual indicator saat drag file ke editor area — File: `pydardcor/editor/group.py` (improve) — Difficulty: 4

### ====== 3. TITLE BAR & MENU BAR ======

- [ ] TASK-0028 — Custom Title Bar — Frameless + custom controls (macOS/Windows/Linux) — File: `pydardcor/app/titlebar.py` — Difficulty: 7
- [ ] TASK-0029 — Menu Bar Integration — Native menu vs custom menu — File: `pydardcor/app/menubar.py` — Difficulty: 6
- [ ] TASK-0030 — Command Center — Centered search bar di title bar — File: `pydardcor/app/command_center.py` — Difficulty: 5
- [ ] TASK-0031 — Window Title Variables — `${activeEditorShort}`, `${workspaceFolder}`, dll — File: `pydardcor/app/window_title.py` — Difficulty: 4
- [ ] TASK-0032 — File Menu — Lengkap dengan Recent, Save All, Auto Save, Preferences — File: menu definitions — Difficulty: 3
- [ ] TASK-0033 — Edit Menu — Lengkap dengan multi-cursor, snippet, emmet — File: menu definitions — Difficulty: 3
- [ ] TASK-0034 — Selection Menu — Lengkap dengan smart select — File: menu definitions — Difficulty: 3
- [ ] TASK-0035 — View Menu — Appearance, Editor Layout, Panel, Side Bar — File: menu definitions — Difficulty: 3
- [ ] TASK-0036 — Go Menu — Go to File/Symbol/Line/Definition/References — File: menu definitions — Difficulty: 3
- [ ] TASK-0037 — Run Menu — Start/Stop debugging, Add Configuration — File: menu definitions — Difficulty: 3
- [ ] TASK-0038 — Terminal Menu — New/Split/Kill Terminal — File: menu definitions — Difficulty: 3
- [ ] TASK-0039 — Help Menu — Welcome, About, Release Notes, Issues — File: menu definitions — Difficulty: 3
- [ ] TASK-0040 — Share Submenu — Copy Link, Open In, Share — File: share.py — Difficulty: 4

### ====== 4. ACTIVITY BAR ======

- [ ] TASK-0041 — Activity Bar Animations — Smooth icon hover/active transitions — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 4
- [ ] TASK-0042 — Activity Badge — Notification count + debug running + test status — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 3
- [ ] TASK-0043 — Activity Bar Drag Reorder — Drag icon untuk reorder views — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 6
- [ ] TASK-0044 — Global Composite — Accounts + Settings + Gear menu di bottom — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 4
- [ ] TASK-0045 — Extension View Containers — Extension-registered activity bar items — File: `pydardcor/core/extension_manager.py` + activity_bar.py — Difficulty: 7
- [ ] TASK-0046 — Accounts View — Sign in / account management — File: `pydardcor/ui_shared/accounts.py` — Difficulty: 5
- [ ] TASK-0047 — Settings Gear Menu — Theme, Settings, Keyboard Shortcuts — File: gear menu — Difficulty: 3
- [ ] TASK-0048 — Activity Bar Context Menu — Hide, Move, Reorder — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 4
- [ ] TASK-0049 — Activity Bar Width — Configurable width — File: `pydardcor/ui_shared/activity_bar.py` (improve) — Difficulty: 2
- [ ] TASK-0050 — Activity Bar Position — Left/Right/Hidden — File: layout.py — Difficulty: 5

### ====== 5. SIDE BAR ======

- [ ] TASK-0051 — Side Bar Header — View title + Actions toolbar — File: `pydardcor/ui_shared/sidebar_header.py` — Difficulty: 4
- [ ] TASK-0052 — Side Bar Toggle — Ctrl+B toggle dengan animation — File: layout — Difficulty: 3
- [ ] TASK-0053 — Auxiliary Side Bar — Right side secondary sidebar — File: `pydardcor/ui_shared/auxiliary_sidebar.py` — Difficulty: 7
- [ ] TASK-0054 — View Pane Container — Tabbed view container di sidebar — File: `pydardcor/ui_shared/view_pane.py` — Difficulty: 6
- [ ] TASK-0055 — View Title Actions — Icon buttons per view — File: view_pane.py — Difficulty: 4
- [ ] TASK-0056 — Side Bar Width — Drag resize + min/max — File: layout — Difficulty: 4
- [ ] TASK-0057 — Side Bar History — Remember last active view per sidebar — File: layout — Difficulty: 3
- [ ] TASK-0058 — View Drag & Drop — Pindah view antar sidebar — File: view_pane.py — Difficulty: 7

### ====== 6. EDITOR CORE ======

- [ ] TASK-0059 — Editor Service — Central editor management (buka/tutup/pindah tab) — File: `pydardcor/editor/service.py` — Difficulty: 7
- [ ] TASK-0060 — Editor Group Model — Model untuk groups, tabs, split states — File: `pydardcor/editor/model.py` — Difficulty: 6
- [ ] TASK-0061 — Multi-Row Tabs — Tab wrapping ke multiple rows — File: `pydardcor/editor/group.py` (improve) — Difficulty: 6
- [ ] TASK-0062 — Pinned Tabs — Pin/unpin tab (pin = selalu visible) — File: `pydardcor/editor/group.py` (improve) — Difficulty: 4
- [ ] TASK-0063 — Preview Tabs — Single-click preview (italic), double-click permanent — File: `pydardcor/editor/group.py` (improve) — Difficulty: 5
- [ ] TASK-0064 — Tab Close on Middle Click — Middle click close tab — File: `pydardcor/editor/group.py` (improve) — Difficulty: 2
- [ ] TASK-0065 — Tab Drag Reorder — Drag tab untuk reorder — File: `pydardcor/editor/group.py` (improve) — Difficulty: 5
- [ ] TASK-0066 — Tab Drag to New Group — Drag tab ke sisi lain untuk split — File: `pydardcor/editor/group.py` (improve) — Difficulty: 7
- [ ] TASK-0067 — Editor Group Splitting — Split editor vertical/horizontal — File: `pydardcor/editor/tabs.py` (improve) — Difficulty: 6
- [ ] TASK-0068 — Tab Context Menu — Close, Close Others, Close All, Copy Path, Reveal — File: `pydardcor/editor/group.py` — Difficulty: 4
- [ ] TASK-0069 — Dirty Indicator — Dot/tab perubahan belum disimpan — File: `pydardcor/editor/group.py` — Difficulty: 3
- [ ] TASK-0070 — Editor Watermark — Welcome widget (recent files, open folder, new file) — File: `pydardcor/editor/group.py` (improve) — Difficulty: 4
- [ ] TASK-0071 — Empty Editor Placeholder — "Untitled" editor hint text — File: `pydardcor/editor/widget.py` — Difficulty: 2
- [ ] TASK-0072 — Read-Only Mode — Visual indicator + block editing — File: `pydardcor/editor/widget.py` — Difficulty: 3
- [ ] TASK-0073 — Editor State Persistence — Save/restore cursor, scroll, folding per file — File: `pydardcor/editor/widget.py` (improve) — Difficulty: 5
- [ ] TASK-0074 — Auto Save — Configurable delay + onFocusChange + onWindowChange — File: `pydardcor/editor/auto_save.py` — Difficulty: 5
- [ ] TASK-0075 — Editor Font Family — Per-language font settings — File: editor configuration — Difficulty: 3
- [ ] TASK-0076 — Editor Ligatures — Font ligature support — File: monaco_editor.html — Difficulty: 2
- [ ] TASK-0077 — Smooth Scrolling — Smooth scroll animation — File: monaco_editor.html — Difficulty: 3
- [ ] TASK-0078 — Mouse Wheel Zoom — Ctrl+scroll zoom — File: editor/widget.py — Difficulty: 2
- [ ] TASK-0079 — Column Selection — Alt+Shift+drag column selection — File: editor (Monaco built-in, but needs enabling) — Difficulty: 2
- [ ] TASK-0080 — Overtype Mode — Insert toggle (Ins key) — File: editor config — Difficulty: 2
- [ ] TASK-0081 — Editor Actions Toolbar — Floating toolbar di editor title — File: `pydardcor/editor/toolbar.py` — Difficulty: 5

### ====== 7. EDITOR — Monaco Integration ======

- [ ] TASK-0082 — Monaco Theme Sync — Sinkronisasi theme dari Python ke Monaco JS — File: `pydardcor/editor/bridge.py` (improve) — Difficulty: 5
- [ ] TASK-0083 — Monaco Worker Setup — Proper Web Worker config utk TS/CSS/HTML/JSON — File: assets/monaco/ — Difficulty: 6
- [ ] TASK-0084 — Content Security Policy — CSP untuk webview security — File: monaco_editor.html — Difficulty: 4
- [ ] TASK-0085 — Right-to-Left Support — RTL language rendering — File: monaco config — Difficulty: 3
- [ ] TASK-0086 — Unicode Bidirectional — Unicode bidi isolation — File: monaco config — Difficulty: 3
- [ ] TASK-0087 — Editor Accessibility — ARIA labels, keyboard nav, screen reader — File: monaco config + bridge — Difficulty: 6
- [ ] TASK-0088 — Diff Editor — Side-by-side diff integration — File: `pydardcor/editor/diff_viewer.py` (improve) — Difficulty: 5
- [ ] TASK-0089 — Multi-Diff Editor — Compare multiple files — File: `pydardcor/editor/multi_diff.py` — Difficulty: 8
- [ ] TASK-0090 — Merge Editor — 3-way merge visual editor — File: `pydardcor/editor/merge_editor.py` — Difficulty: 9
- [ ] TASK-0091 — Inline Values Provider — Debug inline variable values — File: editor bridge — Difficulty: 6
- [ ] TASK-0092 — Inline Hints Provider — Custom inlay hints from LSP — File: editor bridge — Difficulty: 5
- [ ] TASK-0093 — Folding Provider — Custom folding ranges from language server — File: editor bridge — Difficulty: 5
- [ ] TASK-0094 — Semantic Tokens Provider — Full semantic highlighting dari LSP — File: editor bridge — Difficulty: 7
- [ ] TASK-0095 — Color Provider — Document colors + color picker — File: editor bridge — Difficulty: 4
- [ ] TASK-0096 — Link Provider — Clickable links + URL detection — File: editor bridge — Difficulty: 3
- [ ] TASK-0097 — Code Lens Provider — Code lens dari LSP — File: editor bridge — Difficulty: 5
- [ ] TASK-0098 — Selection Range Provider — Smart selection ranges — File: editor bridge — Difficulty: 4
- [ ] TASK-0099 — Type Hierarchy Provider — Type hierarchy view — File: editor bridge — Difficulty: 7
- [ ] TASK-0100 — Call Hierarchy Provider — Call hierarchy view — File: editor bridge — Difficulty: 7
- [ ] TASK-0101 — Declaration Provider — Go to declaration — File: editor bridge — Difficulty: 4
- [ ] TASK-0102 — Implementation Provider — Go to implementation — File: editor bridge — Difficulty: 4
- [ ] TASK-0103 — Inline Completions — AI ghost text provider — File: editor bridge — Difficulty: 6
- [ ] TASK-0104 — Inline Edit — Accept/reject inline code changes — File: `pydardcor/editor/inline_chat.py` (improve) — Difficulty: 6
- [ ] TASK-0105 — Drop Into Editor — Drag-drop file/image/link ke editor — File: editor bridge — Difficulty: 4
- [ ] TASK-0106 — Paste Into Editor — Paste image/link dengan handler — File: editor bridge — Difficulty: 4

### ====== 8. STATUS BAR ======

- [ ] TASK-0107 — Status Bar Model — Dynamic add/remove items (VS Code API) — File: `pydardcor/ui_shared/status_bar.py` (improve) — Difficulty: 6
- [ ] TASK-0108 — Status Bar Left/Right — Alignment config per item — File: status_bar.py — Difficulty: 4
- [ ] TASK-0109 — Status Bar Hover — Tooltip per item — File: status_bar.py — Difficulty: 2
- [ ] TASK-0110 — Status Bar Context Menu — Hide/show items — File: status_bar.py — Difficulty: 4
- [ ] TASK-0111 — Git Branch Indicator — Branch name + sync status — File: status_bar.py — Difficulty: 3
- [ ] TASK-0112 — Errors/Warnings Count — Click to open Problems panel — File: status_bar.py — Difficulty: 3
- [ ] TASK-0113 — Cursor Position — Line:Column + selection count — File: status_bar.py — Difficulty: 2
- [ ] TASK-0114 — Indentation — Spaces:4 / Tabs, click to change — File: status_bar.py — Difficulty: 3
- [ ] TASK-0115 — Encoding — UTF-8, click to change — File: status_bar.py — Difficulty: 3
- [ ] TASK-0116 — End of Line — LF/CRLF, click to change — File: status_bar.py — Difficulty: 3
- [ ] TASK-0117 — Language Mode — Current language, click to change — File: status_bar.py — Difficulty: 3
- [ ] TASK-0118 — Remote Indicator — SSH/Container/WSL status — File: status_bar.py — Difficulty: 4
- [ ] TASK-0119 — Feedback Smiley — Feedback icon — File: status_bar.py — Difficulty: 2
- [ ] TASK-0120 — Notification Bell — Count badge + click to open center — File: status_bar.py — Difficulty: 3
- [ ] TASK-0121 — Extension Status Items — Extension-contributed items — File: status_bar.py — Difficulty: 6
- [ ] TASK-0122 — Debug Status — Debug session active indicator — File: status_bar.py — Difficulty: 3
- [ ] TASK-0123 — Terminal Status — Active terminal info — File: status_bar.py — Difficulty: 3
- [ ] TASK-0124 — Problems Status — Error/warning badge — File: status_bar.py — Difficulty: 2
- [ ] TASK-0125 — Layout Toggle — Button to toggle sidebar/panel — File: status_bar.py — Difficulty: 2

### ====== 9. FILE EXPLORER ======

- [ ] TASK-0126 — File Explorer Refresh — Auto-refresh on file system changes — File: `pydardcor/file_explorer/panel.py` (improve) — Difficulty: 5
- [ ] TASK-0127 — Open Editors Section — Show open editors at top — File: `pydardcor/file_explorer/open_editors_panel.py` (improve) — Difficulty: 4
- [ ] TASK-0128 — Outline Section — Symbol outline — File: `pydardcor/file_explorer/outline_panel.py` (improve) — Difficulty: 5
- [ ] TASK-0129 — Timeline Section — Git/local history timeline — File: `pydardcor/file_explorer/timeline_panel.py` (improve) — Difficulty: 5
- [ ] TASK-0130 — File Nesting — Nested file display (VS Code style) — File: panel.py — Difficulty: 7
- [ ] TASK-0131 — Compact Folders — Single-child folders compact — File: panel.py — Difficulty: 4
- [ ] TASK-0132 — File Decorations — Git status (U/A/M/D) + error/warning badges — File: panel.py — Difficulty: 5
- [ ] TASK-0133 — Filter on Type — Type filter di explorer — File: panel.py — Difficulty: 4
- [ ] TASK-0134 — Explorer Sort Order — By name/type/modified — File: panel.py — Difficulty: 4
- [ ] TASK-0135 — Explorer Multi-Select — Ctrl+Click / Shift+Click — File: panel.py — Difficulty: 4
- [ ] TASK-0136 — Explorer Drag-Drop — Move/copy via drag-drop — File: panel.py — Difficulty: 6
- [ ] TASK-0137 — Explorer Inline Rename — F2 rename inline — File: panel.py — Difficulty: 5
- [ ] TASK-0138 — Explorer Sticky Scroll — Sticky parent saat scroll — File: panel.py — Difficulty: 5
- [ ] TASK-0139 — Excluded Files — files.exclude pattern filtering — File: panel.py — Difficulty: 4
- [ ] TASK-0140 — Explorer Context Menu — New File/Folder, Rename, Delete, Copy Path, Reveal in Finder — File: panel.py — Difficulty: 4
- [ ] TASK-0141 — Explorer Keyboard Nav — Arrow keys, type to select — File: panel.py — Difficulty: 3
- [ ] TASK-0142 — File Watcher — QFileSystemWatcher dengan debounce — File: panel.py — Difficulty: 5
- [ ] TASK-0143 — Workspace Folder Management — Add/remove workspace folders — File: panel.py — Difficulty: 5
- [ ] TASK-0144 — Hidden Files Toggle — Show/hide dotfiles — File: panel.py — Difficulty: 2
- [ ] TASK-0145 — Explorer Section Headers — Collapsible sections (Open Editors, Outline, Timeline) — File: panel.py — Difficulty: 3

### ====== 10. SEARCH ======

- [ ] TASK-0146 — Search in Files — Full recursive text search — File: `pydardcor/search/panel.py` (improve) — Difficulty: 6
- [ ] TASK-0147 — Replace in Files — Search and replace across files — File: `pydardcor/search/panel.py` (improve) — Difficulty: 7
- [ ] TASK-0148 — Regex Search — Regex toggle + invalid regex handling — File: panel.py — Difficulty: 5
- [ ] TASK-0149 — Case Sensitive Toggle — Match case toggle — File: panel.py — Difficulty: 2
- [ ] TASK-0150 — Whole Word Toggle — Whole word matching — File: panel.py — Difficulty: 3
- [ ] TASK-0151 — Include/Exclude Patterns — Glob patterns for files to include/exclude — File: panel.py — Difficulty: 4
- [ ] TASK-0152 — Search History — Recent search terms — File: panel.py — Difficulty: 3
- [ ] TASK-0153 — Search Results Tree — Hierarchical file:line results — File: panel.py — Difficulty: 5
- [ ] TASK-0154 — Result Highlighting — Highlight matched text in results — File: panel.py — Difficulty: 4
- [ ] TASK-0155 — Context Lines — Show surrounding lines — File: panel.py — Difficulty: 4
- [ ] TASK-0156 — Replace Preview — Preview changes before applying — File: panel.py — Difficulty: 6
- [ ] TASK-0157 — Collapse All/Expand All — Collapse/expand tree — File: panel.py — Difficulty: 2
- [ ] TASK-0158 — Open in Editor — Click result to open file at line — File: panel.py — Difficulty: 3
- [ ] TASK-0159 — Dismiss Results — Delete key to remove results — File: panel.py — Difficulty: 3
- [ ] TASK-0160 — Search Editor — Dedicated search results tab — File: `pydardcor/search/search_editor.py` — Difficulty: 7
- [ ] TASK-0161 — AI Search — Semantic/AI search (use embeddings) — File: panel.py — Difficulty: 8
- [ ] TASK-0162 — Notebook Search — Search inside .ipynb cells — File: panel.py — Difficulty: 5
- [ ] TASK-0163 — Search Scope — Folder/file scope selector — File: panel.py — Difficulty: 4
- [ ] TASK-0164 — Search Preserve Case — Preserve case saat replace — File: panel.py — Difficulty: 3
- [ ] TASK-0165 — Search Only Open Editors — Limit to open files — File: panel.py — Difficulty: 4

### ====== 11. QUICK OPEN (Ctrl+P) ======

- [ ] TASK-0166 — File Quick Open — Fuzzy file search — File: `pydardcor/ui_shared/command_palette.py` (improve) — Difficulty: 5
- [ ] TASK-0167 — Symbol Quick Open — `@` symbol search — File: command_palette.py — Difficulty: 5
- [ ] TASK-0168 — Global Symbol Search — `#` cross-file symbol — File: command_palette.py — Difficulty: 6
- [ ] TASK-0169 — Go to Line — `:` line number — File: command_palette.py — Difficulty: 3
- [ ] TASK-0170 — Command Palette — `>` all commands — File: command_palette.py (improve) — Difficulty: 4
- [ ] TASK-0171 — Recent Files — Recently opened files — File: command_palette.py — Difficulty: 4
- [ ] TASK-0172 — Quick Access Providers — Extensible provider system — File: command_palette.py — Difficulty: 7
- [ ] TASK-0173 — Keybinding Display — Show shortcuts in list — File: command_palette.py — Difficulty: 4
- [ ] TASK-0174 — Recently Used — Commands ordered by usage — File: command_palette.py — Difficulty: 4
- [ ] TASK-0175 — Command Categories — Grouped by @category — File: command_palette.py — Difficulty: 3
- [ ] TASK-0176 — Parameterized Commands — Commands dengan input — File: command_palette.py — Difficulty: 5
- [ ] TASK-0177 — Tab Switcher — Ctrl+Tab view — File: command_palette.py — Difficulty: 5

### ====== 12. SOURCE CONTROL / GIT ======

- [ ] TASK-0178 — SCM Provider Interface — Pluggable SCM providers — File: `pydardcor/core/scm.py` (improve) — Difficulty: 7
- [ ] TASK-0179 — Git Status — Show changed files with indicators — File: `pydardcor/git/bridge.py` (improve) — Difficulty: 5
- [ ] TASK-0180 — Git Stage/Unstage — Stage/unstage files — File: git/bridge.py — Difficulty: 4
- [ ] TASK-0181 — Git Commit — Commit message + commit button — File: git/bridge.py — Difficulty: 4
- [ ] TASK-0182 — Git Branch Management — Create/switch/delete branches — File: git/bridge.py — Difficulty: 5
- [ ] TASK-0183 — Git Pull/Push — Pull/push with progress — File: git/bridge.py — Difficulty: 5
- [ ] TASK-0184 — Git Stash — Stash/unstash — File: git/bridge.py — Difficulty: 5
- [ ] TASK-0185 — Git Merge — Merge branches dengan conflict — File: git/bridge.py — Difficulty: 6
- [ ] TASK-0186 — Git Remote Management — Add/remove/rename remotes — File: git/bridge.py — Difficulty: 4
- [ ] TASK-0187 — Git Graph — Branch graph visualization — File: `pydardcor/git/git_graph.py` (improve) — Difficulty: 7
- [ ] TASK-0188 — Git History — File history view — File: git/git_graph.py — Difficulty: 5
- [ ] TASK-0189 — Git Diff — Inline diff viewer — File: git/bridge.py + diff viewer — Difficulty: 5
- [ ] TASK-0190 — Git Gutter — Green/blue/red gutter marks — File: editor bridge — Difficulty: 5
- [ ] TASK-0191 — Quick Diff — Inline diff peek — File: editor bridge — Difficulty: 6
- [ ] TASK-0192 — SCM Repositories View — Multi-repo view — File: `pydardcor/git/repos_view.py` — Difficulty: 5
- [ ] TASK-0193 — SCM History View — Source control history tab — File: `pydardcor/git/history_view.py` — Difficulty: 5
- [ ] TASK-0194 — Changes Count Badge — File count badge di activity bar — File: git integration — Difficulty: 3
- [ ] TASK-0195 — Git Staging UI — Full staging interface — File: git/panel.py (improve) — Difficulty: 7
- [ ] TASK-0196 — Git Commit Amend — Amend last commit — File: git/bridge.py — Difficulty: 4
- [ ] TASK-0197 — Git Interactive Rebase — Rebase UI — File: git/rebase_ui.py — Difficulty: 9
- [ ] TASK-0198 — Git LFS — Large File Support — File: git/lfs.py — Difficulty: 6
- [ ] TASK-0199 — Git Blame — Inline blame annotations — File: git/blame.py — Difficulty: 6
- [ ] TASK-0200 — Git Undo Last Commit — Undo commit — File: git/bridge.py — Difficulty: 3
- [ ] TASK-0201 — Git Merge Conflict Editor — Conflict resolution UI — File: merge_editor.py — Difficulty: 8

### ====== 13. DEBUG ======

- [ ] TASK-0202 — Debug Toolbar — Floating debug controls — File: `pydardcor/widgets/debug_toolbar.py` (improve) — Difficulty: 5
- [ ] TASK-0203 — Variables View — Tree view of local/global variables — File: `pydardcor/debug/panel.py` (improve) — Difficulty: 6
- [ ] TASK-0204 — Watch Expressions — Evaluate watch expressions — File: debug/panel.py — Difficulty: 6
- [ ] TASK-0205 — Call Stack View — Thread + call stack tree — File: debug/panel.py — Difficulty: 6
- [ ] TASK-0206 — Breakpoints View — List all breakpoints — File: debug/panel.py — Difficulty: 5
- [ ] TASK-0207 — Breakpoint Toggle — Click gutter to toggle breakpoint — File: editor bridge — Difficulty: 5
- [ ] TASK-0208 — Conditional Breakpoints — Expression breakpoints — File: debug/panel.py + editor — Difficulty: 7
- [ ] TASK-0209 — Logpoints — Log without stopping — File: debug/panel.py + editor — Difficulty: 7
- [ ] TASK-0210 — Function Breakpoints — Break on function name — File: debug/panel.py — Difficulty: 6
- [ ] TASK-0211 — Data Breakpoints — Break on value change — File: debug/panel.py — Difficulty: 8
- [ ] TASK-0212 — Exception Breakpoints — Break on exceptions — File: debug/panel.py — Difficulty: 5
- [ ] TASK-0213 — Debug Console (REPL) — Interactive debug console — File: `pydardcor/debug/console.py` — Difficulty: 7
- [ ] TASK-0214 — Debug Hover — Hover variable in editor while debugging — File: editor bridge — Difficulty: 6
- [ ] TASK-0215 — Inline Values — Show values next to code — File: editor bridge — Difficulty: 7
- [ ] TASK-0216 — Launch Configuration — launch.json parsing + UI — File: `pydardcor/debug/launch_config.py` (improve) — Difficulty: 5
- [ ] TASK-0217 — DAP Client — Full Debug Adapter Protocol — File: `pydardcor/debug/dap_client.py` (improve) — Difficulty: 7
- [ ] TASK-0218 — Multi-Session Debug — Multiple concurrent debug sessions — File: debug/session_manager.py — Difficulty: 8
- [ ] TASK-0219 — Compound Launch — Launch multiple configs — File: debug/session_manager.py — Difficulty: 6
- [ ] TASK-0220 — Loaded Scripts View — View loaded modules — File: debug/panel.py — Difficulty: 5
- [ ] TASK-0221 — Debug Threads — Thread list + switch — File: debug/panel.py — Difficulty: 6
- [ ] TASK-0222 — Disassembly View — Low-level disassembly — File: debug/disassembly.py — Difficulty: 8
- [ ] TASK-0223 — Debug Console ANSI — ANSI color support — File: debug/console.py — Difficulty: 4
- [ ] TASK-0224 — Debug Status Bar — Debug status indicator — File: status_bar.py — Difficulty: 3
- [ ] TASK-0225 — Debug Session Picker — Pick active session — File: debug/panel.py — Difficulty: 4
- [ ] TASK-0226 — Debug PreLaunch Task — Run task before debug — File: debug/launch_config.py — Difficulty: 5
- [ ] TASK-0227 — Auto-Attach — Auto-attach debugger to processes — File: debug/auto_attach.py — Difficulty: 7
- [ ] TASK-0228 — Debug Server Ready — Detect server start — File: debug/server_ready.py — Difficulty: 6

### ====== 14. TERMINAL ======

- [ ] TASK-0229 — Terminal PTY — Proper pseudo-terminal integration — File: `pydardcor/terminal/instance.py` (improve) — Difficulty: 7
- [ ] TASK-0230 — Multiple Terminals — Tabbed terminal instances — File: `pydardcor/terminal/panel.py` (improve) — Difficulty: 5
- [ ] TASK-0231 — Split Terminal — Split terminal vertically/horizontally — File: terminal/panel.py — Difficulty: 7
- [ ] TASK-0232 — Terminal Groups — Grouped terminals — File: terminal/panel.py — Difficulty: 6
- [ ] TASK-0233 — Terminal Profiles — Shell profile configuration — File: terminal/panel.py — Difficulty: 5
- [ ] TASK-0234 — Terminal Profile Picker — Dropdown profile selector — File: terminal/panel.py — Difficulty: 4
- [ ] TASK-0235 — Terminal Rename — Rename terminal tab — File: terminal/panel.py — Difficulty: 3
- [ ] TASK-0236 — Terminal Colors — Custom color per terminal — File: terminal/instance.py — Difficulty: 4
- [ ] TASK-0237 — Terminal Icons — Custom icon per terminal — File: terminal/panel.py — Difficulty: 3
- [ ] TASK-0238 — Terminal Find — Ctrl+F find in terminal — File: terminal/find.py — Difficulty: 5
- [ ] TASK-0239 — Terminal Selection — Copy/paste selection — File: terminal/instance.py — Difficulty: 4
- [ ] TASK-0240 — Terminal Links — Clickable URLs + file paths — File: terminal/links.py — Difficulty: 5
- [ ] TASK-0241 — Terminal Context Menu — Right-click menu — File: terminal/instance.py — Difficulty: 4
- [ ] TASK-0242 — Terminal Resize — Proper resize handling — File: terminal/instance.py — Difficulty: 5
- [ ] TASK-0243 — Terminal Scrollback — Configurable scrollback — File: terminal/instance.py — Difficulty: 3
- [ ] TASK-0244 — Terminal Escape Codes — ANSI escape sequence rendering — File: xterm.js built-in, verify — Difficulty: 3
- [ ] TASK-0245 — Terminal Configuration — All terminal.* settings — File: terminal/config.py — Difficulty: 4
- [ ] TASK-0246 — External Terminal — Open in system terminal — File: terminal/external.py — Difficulty: 4
- [ ] TASK-0247 — Terminal Suggest — Command suggestions — File: terminal/suggest.py — Difficulty: 7
- [ ] TASK-0248 — Terminal Sticky Scroll — Scroll to see previous output — File: terminal/sticky.py — Difficulty: 5
- [ ] TASK-0249 — Terminal Copy on Select — Auto-copy on selection — File: terminal/instance.py — Difficulty: 3
- [ ] TASK-0250 — Terminal Bell — Visual bell — File: terminal/instance.py — Difficulty: 2
- [ ] TASK-0251 — Terminal Environment — Custom env vars per profile — File: terminal/backend.py — Difficulty: 4
- [ ] TASK-0252 — Terminal CWD — Custom working directory — File: terminal/instance.py — Difficulty: 3
- [ ] TASK-0253 — Terminal Send Text — Send text programmatically — File: terminal/instance.py — Difficulty: 3
- [ ] TASK-0254 — Terminal Automation — Auto-reply to prompts — File: terminal/auto_reply.py — Difficulty: 5

### ====== 15. EXTENSIONS ======

- [ ] TASK-0255 — Extension Search — Search marketplace — File: `pydardcor/ui_shared/extensions_panel.py` (improve) — Difficulty: 5
- [ ] TASK-0256 — Extension Install — Download + install — File: `pydardcor/core/extension_manager.py` (improve) — Difficulty: 6
- [ ] TASK-0257 — Extension Uninstall — Remove extension — File: extension_manager.py — Difficulty: 4
- [ ] TASK-0258 — Extension Enable/Disable — Toggle extension — File: extension_manager.py — Difficulty: 4
- [ ] TASK-0259 — Extension Update — Check + install updates — File: extension_manager.py — Difficulty: 6
- [ ] TASK-0260 — Extension Auto-Update — Automatic updates — File: extension_manager.py — Difficulty: 5
- [ ] TASK-0261 — Extension Detail Page — Publisher, stats, changelog — File: `pydardcor/ui_shared/extension_detail_page.py` (improve) — Difficulty: 5
- [ ] TASK-0262 — Extension Ratings — Star ratings display — File: extension_detail_page.py — Difficulty: 4
- [ ] TASK-0263 — Extension Dependencies — Auto-install deps — File: extension_manager.py — Difficulty: 6
- [ ] TASK-0264 — Extension Pack — Install pack of extensions — File: extension_manager.py — Difficulty: 5
- [ ] TASK-0265 — Extension Recommendations — File-based recommendations — File: `pydardcor/core/extension_recommendations.py` — Difficulty: 5
- [ ] TASK-0266 — Extension Bisect — Binary search problematic extension — File: `pydardcor/core/extension_bisect.py` — Difficulty: 7
- [ ] TASK-0267 — Extension Features Tab — View extension contributions (commands, settings, etc.) — File: extension_detail_page.py — Difficulty: 5
- [ ] TASK-0268 — Extension Host — Node.js extension runtime — File: `pydardcor/extension_host/` (improve) — Difficulty: 9
- [ ] TASK-0269 — VS Code API — Implement VS Code API for extensions — File: `pydardcor/extension_host/api_implementations.py` (massive) — Difficulty: 10
- [ ] TASK-0270 — Extension View Containers — Custom views in sidebar — File: extension_manager.py + activity_bar.py — Difficulty: 7
- [ ] TASK-0271 — Extension Status Bar Items — Custom status bar items — File: extension_manager.py + status_bar.py — Difficulty: 6
- [ ] TASK-0272 — Extension Context Menu — Custom context menu items — File: extension_manager.py + editor — Difficulty: 6
- [ ] TASK-0273 — Extension Keybindings — Extension-contributed shortcuts — File: extension_manager.py + keybindings — Difficulty: 6
- [ ] TASK-0274 — Extension Settings — Contributed settings — File: extension_manager.py + settings — Difficulty: 6
- [ ] TASK-0275 — Extension Workspace Trust — Trust-aware extension loading — File: `pydardcor/workspace/workspace_trust.py` (improve) — Difficulty: 4
- [ ] TASK-0276 — Extension Storage — Per-extension persistent storage — File: extension_manager.py — Difficulty: 5
- [ ] TASK-0277 — Marketplace Browsing — Curated lists, categories — File: extensions_panel.py — Difficulty: 6
- [ ] TASK-0278 — Extension VSIX Install — Install from .vsix file — File: extension_manager.py — Difficulty: 4
- [ ] TASK-0279 — Extension Development — Reload, inspect — File: extension_dev.py — Difficulty: 7

### ====== 16. SETTINGS ======

- [ ] TASK-0280 — Settings UI — Full settings editor — File: `pydardcor/settings/settings_ui.py` (improve) — Difficulty: 7
- [ ] TASK-0281 — Settings Search — Search through settings — File: settings_ui.py — Difficulty: 5
- [ ] TASK-0282 — Settings Categories — Organized by category — File: settings_ui.py — Difficulty: 4
- [ ] TASK-0283 — Settings Scopes — User / Workspace / Folder — File: `pydardcor/settings/settings_scopes.py` — Difficulty: 6
- [ ] TASK-0284 — Setting Types — Boolean, string, number, enum, array, object — File: settings_ui.py — Difficulty: 5
- [ ] TASK-0285 — Modified Indicator — Show changed settings — File: settings_ui.py — Difficulty: 3
- [ ] TASK-0286 — Reset to Default — Reset individual settings — File: settings_ui.py — Difficulty: 3
- [ ] TASK-0287 — Settings JSON — Raw JSON editor — File: settings/settings_json.py — Difficulty: 4
- [ ] TASK-0288 — Default Settings — View all defaults — File: settings_ui.py — Difficulty: 4
- [ ] TASK-0289 — Keyboard Shortcuts UI — Full keybindings editor — File: `pydardcor/settings/keybindings_ui.py` (improve) — Difficulty: 6
- [ ] TASK-0290 — Record Keys — Capture key combination — File: keybindings_ui.py — Difficulty: 5
- [ ] TASK-0291 — Keybinding Search — Search by key/command — File: keybindings_ui.py — Difficulty: 4
- [ ] TASK-0292 — When Clauses — Context condition editor — File: keybindings_ui.py — Difficulty: 5
- [ ] TASK-0293 — Keybinding Conflicts — Conflict detection — File: keybindings_ui.py + keybinding_manager.py — Difficulty: 6
- [ ] TASK-0294 — Keybinding JSON — Raw JSON editor — File: settings/keybindings_json.py — Difficulty: 3
- [ ] TASK-0295 — Language-Specific Settings — Per-language config — File: settings/language_settings.py — Difficulty: 5
- [ ] TASK-0296 — Settings Sync — Cloud sync of settings — File: `pydardcor/sync/settings_sync.py` (replace mock) — Difficulty: 8
- [ ] TASK-0297 — Checkbox/Input/Select Widgets — Form controls — File: settings_ui.py — Difficulty: 3

### ====== 17. THEMES ======

- [ ] TASK-0298 — Color Theme Loader — Load VS Code .json themes — File: `pydardcor/app/theme_manager.py` (improve) — Difficulty: 5
- [ ] TASK-0299 — Theme Application — Apply colors to all widgets — File: theme_manager.py — Difficulty: 6
- [ ] TASK-0300 — Monaco Theme Sync — Sync theme to Monaco editor — File: theme_manager.py + editor bridge — Difficulty: 5
- [ ] TASK-0301 — File Icon Themes — Seti/other icon packs — File: `pydardcor/core/icon_theme_manager.py` (improve) — Difficulty: 6
- [ ] TASK-0302 — Product Icon Themes — Codicon customization — File: theme_manager.py — Difficulty: 5
- [ ] TASK-0303 — Theme Quick Picker — Theme selector in command palette — File: command_palette.py — Difficulty: 4
- [ ] TASK-0304 — Theme Preview — Live preview on hover — File: theme_manager.py — Difficulty: 6
- [ ] TASK-0305 — High Contrast Themes — True high-contrast themes — File: theme_manager.py — Difficulty: 5
- [ ] TASK-0306 — Workbench Color Customization — user settings for colors — File: theme_manager.py — Difficulty: 5
- [ ] TASK-0307 — Token Color Customization — editor.tokenColorCustomizations — File: theme_manager.py — Difficulty: 6
- [ ] TASK-0308 — Extension Themes — Load from extensions — File: theme_manager.py — Difficulty: 5
- [ ] TASK-0309 — Theme Persistence — Save theme preference — File: theme_manager.py — Difficulty: 2
- [ ] TASK-0310 — Custom CSS — workbench.colorCustomizations — File: theme_manager.py — Difficulty: 6
- [ ] TASK-0311 — Semantic Highlighting — Full semantic token colors — File: editor bridge — Difficulty: 7

### ====== 18. NOTIFICATIONS ======

- [ ] TASK-0312 — Notification Toasts — Slide-in notifications — File: `pydardcor/ui_shared/notification_service.py` (improve) — Difficulty: 5
- [ ] TASK-0313 — Notification Center — Expandable notification list — File: `pydardcor/ui_shared/notification_center.py` — Difficulty: 6
- [ ] TASK-0314 — Notification Actions — Action buttons — File: notification_service.py — Difficulty: 4
- [ ] TASK-0315 — Notification Progress — Progress bar in notification — File: notification_service.py — Difficulty: 4
- [ ] TASK-0316 — Do Not Disturb — DND mode — File: notification_service.py — Difficulty: 3
- [ ] TASK-0317 — Source Filter — Filter by source — File: notification_service.py — Difficulty: 4
- [ ] TASK-0318 — Notification Persistence — Persist across sessions — File: notification_service.py — Difficulty: 4
- [ ] TASK-0319 — Notification Sound — Audio cue — File: notification_sound.py — Difficulty: 3

### ====== 19. PROBLEMS PANEL ======

- [ ] TASK-0320 — Problems List — Error/warning/info list — File: `pydardcor/ui_shared/problems_panel.py` (improve) — Difficulty: 5
- [ ] TASK-0321 — Problems Filtering — Filter by type/source/text — File: problems_panel.py — Difficulty: 4
- [ ] TASK-0322 — Problems Grouping — Group by file/type — File: problems_panel.py — Difficulty: 4
- [ ] TASK-0323 — Problems Table View — Table mode — File: problems_panel.py — Difficulty: 4
- [ ] TASK-0324 — Problems Tree View — Tree mode — File: problems_panel.py — Difficulty: 3
- [ ] TASK-0325 — Click to Navigate — Click = open file at line — File: problems_panel.py — Difficulty: 3
- [ ] TASK-0326 — Problems Status Bar — Error/warning count — File: status_bar.py — Difficulty: 3
- [ ] TASK-0327 — File Decorations — Badge on file in explorer — File: file_explorer/panel.py — Difficulty: 4
- [ ] TASK-0328 — Quick Fix — Code action from problem — File: editor bridge + code action — Difficulty: 6
- [ ] TASK-0329 — Auto-Fix — Auto fix action — File: editor bridge — Difficulty: 5
- [ ] TASK-0330 — Problem Source — Show linter/source name — File: problems_panel.py — Difficulty: 3

### ====== 20. OUTPUT PANEL ======

- [ ] TASK-0331 — Output Channels — Named channels — File: `pydardcor/ui_shared/output_panel.py` (improve) — Difficulty: 4
- [ ] TASK-0332 — Channel Dropdown — Select channel — File: output_panel.py — Difficulty: 3
- [ ] TASK-0333 — Clear Output — Clear button — File: output_panel.py — Difficulty: 2
- [ ] TASK-0334 — Auto-Scroll — Follow output — File: output_panel.py — Difficulty: 3
- [ ] TASK-0335 — Line Numbers — Show line numbers — File: output_panel.py — Difficulty: 3
- [ ] TASK-0336 — Word Wrap — Toggle wrap — File: output_panel.py — Difficulty: 2
- [ ] TASK-0337 — Output Time Stamps — Timestamps — File: output_panel.py — Difficulty: 3
- [ ] TASK-0338 — Output Filter — Filter by text — File: output_panel.py — Difficulty: 4
- [ ] TASK-0339 — Output Save — Save output to file — File: output_panel.py — Difficulty: 3

### ====== 21. BREADCRUMBS ======

- [ ] TASK-0340 — File Path Breadcrumbs — Clickable path — File: `pydardcor/ui_shared/breadcrumbs.py` (improve) — Difficulty: 4
- [ ] TASK-0341 — Symbol Breadcrumbs — Current symbol — File: breadcrumbs.py — Difficulty: 5
- [ ] TASK-0342 — Breadcrumb Dropdown — Dropdown picker — File: breadcrumbs.py — Difficulty: 5
- [ ] TASK-0343 — Breadcrumb Navigation — Click to navigate — File: breadcrumbs.py — Difficulty: 3
- [ ] TASK-0344 — Breadcrumb Keyboard Nav — Ctrl+Shift+; — File: breadcrumbs.py — Difficulty: 3
- [ ] TASK-0345 — Breadcrumb Show File Path — Full path on hover — File: breadcrumbs.py — Difficulty: 2
- [ ] TASK-0346 — Breadcrumb Enable/Disable — Toggle setting — File: breadcrumbs.py — Difficulty: 2

### ====== 22. MINIMAP ======

- [ ] TASK-0347 — Minimap — Code overview minimap — File: monaco config (built-in, verify) — Difficulty: 2
- [ ] TASK-0348 — Minimap Slider — Drag slider — File: monaco config — Difficulty: 2
- [ ] TASK-0349 — Minimap Scale — Size setting — File: monaco config — Difficulty: 2
- [ ] TASK-0350 — Minimap Position — Left/right — File: monaco config — Difficulty: 2
- [ ] TASK-0351 — Minimap Render Characters — Character rendering — File: monaco config — Difficulty: 2
- [ ] TASK-0352 — Minimap Git Decorations — Git change indicators — File: editor bridge — Difficulty: 5
- [ ] TASK-0353 — Minimap Error/Warning — Problems in minimap — File: editor bridge — Difficulty: 5
- [ ] TASK-0354 — Minimap Section Headers — Highlight sections — File: monaco config — Difficulty: 3
- [ ] TASK-0355 — Minimap Show On Hover — Only show on hover — File: monaco config — Difficulty: 2

### ====== 23. NOTEBOOKS ======

- [ ] TASK-0356 — Notebook Editor — Full notebook UI — File: `pydardcor/notebooks/editor.py` (REWRITE from scratch) — Difficulty: 9
- [ ] TASK-0357 — Notebook Cells — Monaco-based code cells — File: notebooks/editor.py — Difficulty: 7
- [ ] TASK-0358 — Cell Execution — Run with real kernel — File: `pydardcor/notebooks/kernel_client.py` (replace mock) — Difficulty: 8
- [ ] TASK-0359 — Rich Output — HTML, images, plots, LaTeX — File: notebooks/output.py — Difficulty: 8
- [ ] TASK-0360 — Cell Toolbar — Run, move, delete buttons — File: notebooks/editor.py — Difficulty: 5
- [ ] TASK-0361 — Cell Drag & Drop — Reorder cells — File: notebooks/editor.py — Difficulty: 6
- [ ] TASK-0362 — Multi-Cell Selection — Select multiple cells — File: notebooks/editor.py — Difficulty: 5
- [ ] TASK-0363 — Notebook Kernel — Jupyter kernel connection — File: notebooks/kernel_client.py — Difficulty: 8
- [ ] TASK-0364 — Kernel Management — Start/stop/restart kernel — File: notebooks/kernel_manager.py — Difficulty: 7
- [ ] TASK-0365 — Notebook Serialization — .ipynb save/load — File: notebooks/editor.py — Difficulty: 5
- [ ] TASK-0366 — Notebook Diff — Diff for notebooks — File: notebooks/diff.py — Difficulty: 7
- [ ] TASK-0367 — Notebook Find — Search across cells — File: notebooks/find.py — Difficulty: 5
- [ ] TASK-0368 — Cell Output Scrolling — Scrollable output — File: notebooks/output.py — Difficulty: 4
- [ ] TASK-0369 -Cell Execution Count — Number label — File: notebooks/editor.py — Difficulty: 3
- [ ] TASK-0370 — Notebook Variables — Variable explorer — File: notebooks/variables.py — Difficulty: 7
- [ ] TASK-0371 — Interactive Window — REPL-like window — File: `pydardcor/notebooks/interactive.py` — Difficulty: 7
- [ ] TASK-0372 — Notebook Formatting — Format cell code — File: notebooks/format.py — Difficulty: 5
- [ ] TASK-0373 — Notebook Renderers — Custom output renderers — File: notebooks/renderers.py — Difficulty: 6

### ====== 24. TESTING ======

- [ ] TASK-0374 — Test Explorer — Discover and list tests — File: `pydardcor/testing/panel.py` (REWRITE) — Difficulty: 7
- [ ] TASK-0375 — Run Tests — Run individual/file/all tests — File: testing/panel.py — Difficulty: 6
- [ ] TASK-0376 — Debug Tests — Run tests under debugger — File: testing/debug.py — Difficulty: 7
- [ ] TASK-0377 — Test Results — Pass/fail/skip — File: testing/panel.py — Difficulty: 5
- [ ] TASK-0378 — Test Coverage — Code coverage visualization — File: testing/coverage.py — Difficulty: 8
- [ ] TASK-0379 — Inline Test Results — Gutter decorations — File: editor bridge — Difficulty: 6
- [ ] TASK-0380 — Test Output — Output panel per test — File: testing/output.py — Difficulty: 4
- [ ] TASK-0381 — Test Profiles — Run configuration — File: testing/profiles.py — Difficulty: 5
- [ ] TASK-0382 — Continuous Test Run — Auto-run on change — File: testing/continuous.py — Difficulty: 7
- [ ] TASK-0383 — Test Status Bar — Running/fail count — File: status_bar.py — Difficulty: 3
- [ ] TASK-0384 — Test Decorations — Gutter colors — File: editor bridge — Difficulty: 5
- [ ] TASK-0385 — Test Navigation — Click test to go to code — File: testing/panel.py — Difficulty: 3

### ====== 25. TASKS ======

- [ ] TASK-0386 — tasks.json — Parse task config — File: `pydardcor/tasks/task_manager.py` (improve) — Difficulty: 5
- [ ] TASK-0387 — Task Auto-Detection — Detect npm/gulp/grunt — File: tasks/auto_detect.py — Difficulty: 6
- [ ] TASK-0388 — Task Runner — Execute tasks — File: tasks/task_manager.py — Difficulty: 5
- [ ] TASK-0389 — Task Monitoring — Progress/status — File: tasks/task_manager.py — Difficulty: 4
- [ ] TASK-0390 — Problem Matchers — Parse output for problems — File: tasks/problem_matcher.py (improve) — Difficulty: 6
- [ ] TASK-0391 — Task Groups — Build/test groups — File: tasks/task_manager.py — Difficulty: 4
- [ ] TASK-0392 — Run Build Task — Ctrl+Shift+B — File: tasks/task_manager.py — Difficulty: 4
- [ ] TASK-0393 — Run Task — Task picker — File: tasks/task_picker.py — Difficulty: 4
- [ ] TASK-0394 — Background Tasks — Long-running tasks — File: tasks/task_manager.py — Difficulty: 5
- [ ] TASK-0395 — Compound Tasks — Run multiple tasks — File: tasks/task_manager.py — Difficulty: 5
- [ ] TASK-0396 — Task Variables — ${workspaceFolder} etc — File: tasks/task_manager.py — Difficulty: 4
- [ ] TASK-0397 — Task Quick Access — Run task from command palette — File: command_palette.py — Difficulty: 3

### ====== 26. COMMENTS ======

- [ ] TASK-0398 — Comment Threads — Inline comment threads — File: `pydardcor/comments/thread.py` (NEW) — Difficulty: 8
- [ ] TASK-0399 — Comment Widget — Comment input/reply widget — File: comments/widget.py — Difficulty: 7
- [ ] TASK-0400 — Comment Ranges — Range-based comments — File: comments/range.py — Difficulty: 6
- [ ] TASK-0401 — Comment Navigation — Navigate between comments — File: comments/navigation.py — Difficulty: 5
- [ ] TASK-0402 — Comment Panel — Dedicated comments view — File: comments/panel.py — Difficulty: 6
- [ ] TASK-0403 — Comment Reactions — Emoji reactions — File: comments/reactions.py — Difficulty: 5
- [ ] TASK-0404 — Comment Resolve — Resolve thread — File: comments/thread.py — Difficulty: 4
- [ ] TASK-0405 — Comment Delete — Delete comment — File: comments/thread.py — Difficulty: 3
- [ ] TASK-0406 — Comment Draft Save — Save draft — File: comments/storage.py — Difficulty: 4

### ====== 27. TIMELINE ======

- [ ] TASK-0407 — File Timeline — Show file history — File: `pydardcor/file_explorer/timeline_panel.py` (replace) — Difficulty: 6
- [ ] TASK-0408 — Git History — Git commit log — File: timeline_panel.py — Difficulty: 5
- [ ] TASK-0409 — Local History — Save/restore snapshots — File: `pydardcor/editor/local_history.py` (improve) — Difficulty: 6
- [ ] TASK-0410 — Timeline Filter — Filter by source — File: timeline_panel.py — Difficulty: 4
- [ ] TASK-0411 — Timeline Actions — Compare, restore — File: timeline_panel.py — Difficulty: 5
- [ ] TASK-0412 — Timeline Provider — Extensible timeline sources — File: timeline/provider.py — Difficulty: 6
- [ ] TASK-0413 — History Storage — Persistent storage — File: local_history.py — Difficulty: 4
- [ ] TASK-0414 — Hot Exit — Save dirty files on exit — File: local_history.py — Difficulty: 6

### ====== 28. COMMAND PALETTE ======

- [ ] TASK-0415 — Fuzzy Search — Improved fuzzy matching — File: `pydardcor/ui_shared/command_palette.py` (improve) — Difficulty: 5
- [ ] TASK-0416 — Recent Commands — History-based ordering — File: command_palette.py — Difficulty: 4
- [ ] TASK-0417 — Prefix Modes — `>`, `@`, `#`, `:` prefixes — File: command_palette.py — Difficulty: 5
- [ ] TASK-0418 — Keyboard Navigation — Arrow keys, Enter, Escape — File: command_palette.py — Difficulty: 3
- [ ] TASK-0419 — Command Labels — Rich labels with category — File: command_palette.py — Difficulty: 3
- [ ] TASK-0420 — Command Icons — Icons next to commands — File: command_palette.py — Difficulty: 3
- [ ] TASK-0421 — Command Aliases — Multiple names per command — File: command_palette.py — Difficulty: 4
- [ ] TASK-0422 — Parameter Input — Input after selection — File: command_palette.py — Difficulty: 5

### ====== 29. LOCALIZATION ======

- [ ] TASK-0423 — Language Packs — Load language packs — File: `pydardcor/core/language_pack.py` — Difficulty: 6
- [ ] TASK-0424 — i18n Infrastructure — String localization — File: `pydardcor/core/i18n.py` — Difficulty: 6
- [ ] TASK-0425 — Locale Selection — Language selection UI — File: settings — Difficulty: 4
- [ ] TASK-0426 — NLS Resolution — %key% resolution — File: extension_manager.py — Difficulty: 5

### ====== 30. ACCESSIBILITY ======

- [ ] TASK-0427 — Screen Reader Support — ARIA labels everywhere — File: seluruh UI — Difficulty: 9
- [ ] TASK-0428 — Accessibility Help — Alt+F1 dialog — File: `pydardcor/app/accessibility_help.py` — Difficulty: 4
- [ ] TASK-0429 — Tab Focus Mode — Ctrl+M toggle — File: editor — Difficulty: 3
- [ ] TASK-0430 — High Contrast — True high contrast theme — File: theme_manager.py — Difficulty: 5
- [ ] TASK-0431 — Keyboard Navigation — Full keyboard flow — File: seluruh UI — Difficulty: 8
- [ ] TASK-0432 — Zoom Level — Global zoom — File: app.py — Difficulty: 3
- [ ] TASK-0433 — Accessible View — Alternative text view — File: `pydardcor/app/accessible_view.py` — Difficulty: 5
- [ ] TASK-0434 — Focus Indicator — Visible focus ring — File: stylesheet — Difficulty: 3
- [ ] TASK-0435 — Audio Cues — Sound for events — File: `pydardcor/core/audio_cues.py` — Difficulty: 5

### ====== 31. REMOTE DEVELOPMENT ======

- [ ] TASK-0436 — Remote SSH — Full SSH remote — File: `pydardcor/remote/ssh_manager.py` (REWRITE from mock) — Difficulty: 9
- [ ] TASK-0437 — Remote Containers — Dev Containers support — File: `pydardcor/remote/container_manager.py` (REWRITE) — Difficulty: 9
- [ ] TASK-0438 — Remote Tunnels — VS Code Tunnels — File: `pydardcor/remote/tunnels.py` — Difficulty: 9
- [ ] TASK-0439 — Remote WSL — WSL integration — File: `pydardcor/remote/wsl.py` — Difficulty: 8
- [ ] TASK-0440 — Port Forwarding — Port mapping UI — File: `pydardcor/remote/ports_panel.py` (improve) — Difficulty: 6
- [ ] TASK-0441 — Remote Explorer — View remote targets — File: `pydardcor/remote/remote_explorer.py` — Difficulty: 6
- [ ] TASK-0442 — Remote Status — Connection status — File: status_bar.py — Difficulty: 4
- [ ] TASK-0443 — Remote File System — File ops via SSH/Container — File: `pydardcor/remote/vfs.py` (improve) — Difficulty: 7
- [ ] TASK-0444 — Remote Extension Install — Install to remote — File: extension_manager.py — Difficulty: 6
- [ ] TASK-0445 — Remote Terminal — Terminal on remote — File: terminal/remote.py — Difficulty: 8
- [ ] TASK-0446 — Remote Server — Server-side headless — File: `pydardcor/remote/server.py` — Difficulty: 9
- [ ] TASK-0447 — devcontainer.json — Parse and apply — File: remote/devcontainer.py — Difficulty: 7
- [ ] TASK-0448 — SSH Config — Parse ~/.ssh/config — File: remote/ssh_config.py — Difficulty: 5
- [ ] TASK-0449 — Remote Tunnel Authentication — Auth flow — File: remote/tunnel_auth.py — Difficulty: 7

### ====== 32. WELCOME & ONBOARDING ======

- [ ] TASK-0450 — Welcome Tab — Getting started page — File: `pydardcor/app/welcome_page.py` (NEW) — Difficulty: 6
- [ ] TASK-0451 — Recent Files — Recent list on welcome — File: welcome_page.py — Difficulty: 4
- [ ] TASK-0452 — Getting Started — Interactive walkthrough — File: `pydardcor/app/getting_started.py` — Difficulty: 7
- [ ] TASK-0453 — Release Notes — What's new page — File: `pydardcor/app/release_notes.py` — Difficulty: 4
- [ ] TASK-0454 — Tips & Tricks — Productivity tips — File: `pydardcor/app/tips.py` — Difficulty: 4
- [ ] TASK-0455 — Interactive Playground — Learn editor — File: `pydardcor/app/playground.py` — Difficulty: 7
- [ ] TASK-0456 — Walkthroughs — Step-by-step tutorials — File: `pydardcor/app/walkthroughs.py` — Difficulty: 7
- [ ] TASK-0457 — Splash Screen — Loading screen — File: `pydardcor/app/splash.py` — Difficulty: 3
- [ ] TASK-0458 — Onboarding Flow — First-run setup — File: `pydardcor/app/onboarding.py` — Difficulty: 6

### ====== 33. WORKSPACE ======

- [ ] TASK-0459 — Multi-Root Workspaces — .code-workspace full support — File: `pydardcor/workspace/multi_root.py` (improve) — Difficulty: 6
- [ ] TASK-0460 — Workspace Trust — Restricted mode — File: `pydardcor/workspace/workspace_trust.py` (improve) — Difficulty: 5
- [ ] TASK-0461 — Untitled Files — Scratch files — File: `pydardcor/workspace/untitled.py` — Difficulty: 5
- [ ] TASK-0462 — Workspace Settings — .vscode/settings.json — File: workspace/settings.py — Difficulty: 4
- [ ] TASK-0463 — Workspace Recommendations — extensions.json — File: workspace/recommendations.py — Difficulty: 4
- [ ] TASK-0464 — Workspace Tasks — .vscode/tasks.json — File: tasks/task_manager.py — Difficulty: 4
- [ ] TASK-0465 — Workspace Launch — launch.json — File: debug/launch_config.py — Difficulty: 4
- [ ] TASK-0466 — Workspace Storage — Per-workspace storage — File: workspace/storage.py — Difficulty: 4
- [ ] TASK-0467 — Add Folder to Workspace — Multi-root UX — File: workspace/multi_root.py — Difficulty: 5
- [ ] TASK-0468 — Save Workspace As — Save .code-workspace — File: workspace/multi_root.py — Difficulty: 4

### ====== 34. USER DATA & PROFILES ======

- [ ] TASK-0469 — Create Profile — Named profile — File: `pydardcor/settings/profile.py` (NEW) — Difficulty: 6
- [ ] TASK-0470 — Switch Profile — Profile selector — File: settings/profile.py — Difficulty: 5
- [ ] TASK-0471 — Profile Export/Import — Share profiles — File: settings/profile.py — Difficulty: 5
- [ ] TASK-0472 — Profile Contents — Settings, keybindings, snippets — File: settings/profile.py — Difficulty: 6
- [ ] TASK-0473 — Default Profile — Reset to default — File: settings/profile.py — Difficulty: 3
- [ ] TASK-0474 — Settings Sync — Real cloud sync — File: `pydardcor/sync/settings_sync.py` (REWRITE from mock) — Difficulty: 9
- [ ] TASK-0475 — Sync Keybindings — Sync shortcuts — File: sync/settings_sync.py — Difficulty: 5
- [ ] TASK-0476 — Sync Extensions — Sync extension list — File: sync/settings_sync.py — Difficulty: 5
- [ ] TASK-0477 — Sync UI State — Sync layout — File: sync/settings_sync.py — Difficulty: 5
- [ ] TASK-0478 — Sync Snippets — Sync snippets — File: sync/settings_sync.py — Difficulty: 4
- [ ] TASK-0479 — Sync Tasks — Sync tasks — File: sync/settings_sync.py — Difficulty: 4
- [ ] TASK-0480 — Conflict Resolution — Merge conflicts — File: sync/conflict.py — Difficulty: 7

### ====== 35. UPDATE SYSTEM ======

- [ ] TASK-0481 — Auto Update Check — Check on startup — File: `pydardcor/core/updater.py` (NEW) — Difficulty: 6
- [ ] TASK-0482 — Update Notification — Notify available — File: updater.py — Difficulty: 4
- [ ] TASK-0483 — Download & Install — Download update — File: updater.py — Difficulty: 7
- [ ] TASK-0484 — Release Notes — Show changes — File: updater.py — Difficulty: 4
- [ ] TASK-0485 — Update Settings — Channel configuration — File: updater.py — Difficulty: 3
- [ ] TASK-0486 — Update Channel — Stable/Insider — File: updater.py — Difficulty: 4
- [ ] TASK-0487 — Background Download — Download while using — File: updater.py — Difficulty: 5

### ====== 36. TELEMETRY & DIAGNOSTICS ======

- [ ] TASK-0488 — Crash Reporter — Send crash reports — File: `pydardcor/core/crash_reporter.py` (improve) — Difficulty: 6
- [ ] TASK-0489 — Usage Telemetry — Opt-in telemetry — File: `pydardcor/core/telemetry.py` (improve) — Difficulty: 6
- [ ] TASK-0490 — Process Explorer — View running processes — File: `pydardcor/app/process_explorer.py` — Difficulty: 6
- [ ] TASK-0491 — Developer Tools — Open DevTools — File: `pydardcor/app/dev_tools.py` — Difficulty: 4
- [ ] TASK-0492 — Inspect Context Keys — Debug context — File: `pydardcor/app/context_inspector.py` — Difficulty: 5
- [ ] TASK-0493 — Reload Window — Developer reload — File: `pydardcor/app/reload.py` — Difficulty: 4
- [ ] TASK-0494 — Open DevTools for Webview — Chrome DevTools — File: editor/widget.py — Difficulty: 3
- [ ] TASK-0495 — Startup Performance — Track startup time — File: app/app.py — Difficulty: 4
- [ ] TASK-0496 — Issue Reporter — Report issues UI — File: `pydardcor/app/issue_reporter.py` — Difficulty: 5

### ====== 37. WEBVIEW ======

- [ ] TASK-0497 — Webview Panel — Full webview panel — File: `pydardcor/webview/panel.py` (improve) — Difficulty: 6
- [ ] TASK-0498 — Webview Editor — Webview as editor — File: `pydardcor/webview/editor.py` — Difficulty: 6
- [ ] TASK-0499 — Webview Messaging — Two-way comms — File: `pydardcor/webview/message_router.py` (improve) — Difficulty: 5
- [ ] TASK-0500 — Webview Persistence — Save/restore state — File: webview/panel.py — Difficulty: 5
- [ ] TASK-0501 — Webview Security — CSP, sandboxing — File: webview/security.py — Difficulty: 6
- [ ] TASK-0502 — Webview Serialization — Serialize on reload — File: webview/panel.py — Difficulty: 5
- [ ] TASK-0503 — Simple Browser — Built-in web browser — File: `pydardcor/webview/browser_widget.py` — Difficulty: 6

### ====== 38. MARKDOWN ======

- [ ] TASK-0504 — Markdown Preview — Side-by-side preview — File: `pydardcor/editor/markdown_preview.py` (improve) — Difficulty: 6
- [ ] TASK-0505 — Markdown Editor — Syntax highlighting — File: Monaco built-in — Difficulty: 2
- [ ] TASK-0506 — Markdown Math — LaTeX math rendering — File: `pydardcor/editor/markdown_math.py` — Difficulty: 6
- [ ] TASK-0507 — Markdown Mermaid — Mermaid diagram rendering — File: markdown_mermaid.py — Difficulty: 7
- [ ] TASK-0508 — Markdown Preview Sync — Scroll sync — File: markdown_preview.py — Difficulty: 5
- [ ] TASK-0509 — Markdown Preview Security — CSP — File: markdown_preview.py — Difficulty: 4
- [ ] TASK-0510 — Markdown Table of Contents — TOC — File: markdown_preview.py — Difficulty: 4
- [ ] TASK-0511 — Markdown Export — Export to HTML — File: markdown_export.py — Difficulty: 4

### ====== 39. SNIPPETS ======

- [ ] TASK-0512 — Built-in Snippets — Language snippets — File: `pydardcor/editor/snippet_manager.py` (improve) — Difficulty: 5
- [ ] TASK-0513 — User Snippets — Custom snippet files — File: snippet_manager.py — Difficulty: 4
- [ ] TASK-0514 — Workspace Snippets — Per-workspace — File: snippet_manager.py — Difficulty: 4
- [ ] TASK-0515 — Snippet Completion — Tab completion — File: editor bridge — Difficulty: 5
- [ ] TASK-0516 — Insert Snippet Command — Picker — File: command_palette.py — Difficulty: 4
- [ ] TASK-0517 — Snippet Variables — $TM_FILENAME, $CURRENT_YEAR — File: snippet_manager.py — Difficulty: 5
- [ ] TASK-0518 — Snippet Scope — Language scope — File: snippet_manager.py — Difficulty: 4

### ====== 40. EMMET ======

- [ ] TASK-0519 — Emmet Expand — Expand abbreviation — File: `pydardcor/editor/emmet.py` (improve) — Difficulty: 5
- [ ] TASK-0520 — Emmet Wrap — Wrap with abbreviation — File: emmet.py — Difficulty: 5
- [ ] TASK-0521 — Emmet Balance — Balance inward/outward — File: emmet.py — Difficulty: 5
- [ ] TASK-0522 — Emmet Remove Tag — Remove tag — File: emmet.py — Difficulty: 4
- [ ] TASK-0523 — Emmet Update Tag — Update tag — File: emmet.py — Difficulty: 4
- [ ] TASK-0524 — Emmet Math — Evaluate math — File: emmet.py — Difficulty: 5
- [ ] TASK-0525 — Emmet Reflect CSS — Reflect CSS — File: emmet.py — Difficulty: 5
- [ ] TASK-0526 — Emmet Config — Custom snippets — File: emmet.py — Difficulty: 4

### ====== 41. LANGUAGE SERVERS (LSP) ======

- [ ] TASK-0527 — LSP Client Manager — Manage multiple LSPs — File: `pydardcor/lsp/client.py` (improve) — Difficulty: 7
- [ ] TASK-0528 — LSP Initialize — Proper initialize flow — File: lsp/client.py — Difficulty: 5
- [ ] TASK-0529 — LSP Shutdown — Clean shutdown — File: lsp/client.py — Difficulty: 4
- [ ] TASK-0530 — LSP Completion — Autocomplete from LSP — File: lsp/client.py + editor bridge — Difficulty: 6
- [ ] TASK-0531 — LSP Hover — Hover info — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0532 — LSP Definition — Go to def — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0533 — LSP References — Find refs — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0534 — LSP Rename — Rename symbol — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0535 — LSP Format — Format document — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0536 — LSP Code Action — Quick fixes — File: lsp/client.py + editor bridge — Difficulty: 6
- [ ] TASK-0537 — LSP Diagnostics — Error/warning markers — File: lsp/client.py + editor bridge — Difficulty: 6
- [ ] TASK-0538 — LSP Signature Help — Parameter hints — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0539 — LSP Document Symbols — Outline — File: lsp/client.py + outline — Difficulty: 5
- [ ] TASK-0540 — LSP Workspace Symbols — Global symbols — File: lsp/client.py + command palette — Difficulty: 6
- [ ] TASK-0541 — LSP Semantic Tokens — Full semantic highlighting — File: lsp/client.py + editor bridge — Difficulty: 7
- [ ] TASK-0542 — LSP Inlay Hints — Inline hints — File: lsp/client.py + editor bridge — Difficulty: 6
- [ ] TASK-0543 — LSP Code Lens — Code lens — File: lsp/client.py + editor bridge — Difficulty: 6
- [ ] TASK-0544 — LSP Linked Editing — Linked edit ranges — File: lsp/client.py + editor bridge — Difficulty: 5
- [ ] TASK-0545 — LSP Type Hierarchy — Type hierarchy — File: lsp/client.py — Difficulty: 7
- [ ] TASK-0546 — LSP Call Hierarchy — Call hierarchy — File: lsp/client.py — Difficulty: 7
- [ ] TASK-0547 — LSP Progress — Server progress — File: lsp/client.py — Difficulty: 5
- [ ] TASK-0548 — LSP Configuration — Per-language LSP config — File: lsp/config.py — Difficulty: 5
- [ ] TASK-0549 — LSP Status — Language status indicator — File: status_bar.py — Difficulty: 4

### ====== 42. AUTHENTICATION ======

- [ ] TASK-0550 — GitHub Auth — OAuth flow — File: `pydardcor/core/auth.py` (improve) — Difficulty: 7
- [ ] TASK-0551 — Microsoft Auth — Microsoft login — File: core/auth.py — Difficulty: 7
- [ ] TASK-0552 — Account Management — Add/remove accounts — File: UI: accounts.py — Difficulty: 6
- [ ] TASK-0553 — Secret Storage — Encrypted secrets — File: `pydardcor/core/secrets.py` — Difficulty: 6
- [ ] TASK-0554 — Token Refresh — Auto-refresh tokens — File: core/auth.py — Difficulty: 5

### ====== 43. MCP (Model Context Protocol) ======

- [ ] TASK-0555 — MCP Server — MCP server implementation — File: `pydardcor/mcp/server.py` (NEW) — Difficulty: 9
- [ ] TASK-0556 — MCP Tools — Tool calling — File: mcp/tools.py — Difficulty: 8
- [ ] TASK-0557 — MCP Resources — Resource access — File: mcp/resources.py — Difficulty: 7
- [ ] TASK-0558 — MCP Prompts — Prompt templates — File: mcp/prompts.py — Difficulty: 7
- [ ] TASK-0559 — MCP Language Features — Code intelligence — File: mcp/language.py — Difficulty: 7
- [ ] TASK-0560 — MCP View — MCP servers panel — File: mcp/view.py — Difficulty: 6
- [ ] TASK-0561 — MCP Sandbox — Secure execution — File: mcp/sandbox.py — Difficulty: 8
- [ ] TASK-0562 — MCP Discovery — Server discovery — File: mcp/discovery.py — Difficulty: 6

### ====== 44. BUILT-IN EXTENSIONS ======

- [ ] TASK-0563 — Python Extension — Python IntelliSense — File: extensions/python/ — Difficulty: 7
- [ ] TASK-0564 — JavaScript/TS Extension — JS/TS support — File: extensions/javascript/ — Difficulty: 7
- [ ] TASK-0565 — HTML/CSS Extension — HTML/CSS IntelliSense — File: extensions/html/ — Difficulty: 6
- [ ] TASK-0566 — JSON Extension — JSON support — File: extensions/json/ — Difficulty: 5
- [ ] TASK-0567 — Markdown Extension — Markdown support — File: extensions/markdown/ — Difficulty: 5
- [ ] TASK-0568 — Git Extension — Git integration — File: pydardcor/git/ (improve) — Difficulty: 6
- [ ] TASK-0569 — GitHub Extension — GitHub integration — File: extensions/github/ — Difficulty: 7
- [ ] TASK-0570 — NPM Extension — NPM scripts — File: extensions/npm/ — Difficulty: 6
- [ ] TASK-0571 — Debug Auto-Launch — Auto attach debug — File: debug/auto_attach.py — Difficulty: 6
- [ ] TASK-0572 — Debug Server Ready — Server detection — File: debug/server_ready.py — Difficulty: 5
- [ ] TASK-0573 — Merge Conflict — Conflict decorations — File: editor/merge_conflict.py — Difficulty: 6
- [ ] TASK-0574 — Media Preview — Image viewer — File: `pydardcor/editor/image_viewer.py` (improve) — Difficulty: 4
- [ ] TASK-0575 — Simple Browser — Web view — File: `pydardcor/editor/browser_widget.py` (improve) — Difficulty: 5
- [ ] TASK-0576 — References View — Find all refs panel — File: extensions/references_view/ — Difficulty: 5
- [ ] TASK-0577 — Search Result — Search result syntax — File: extensions/search_result/ — Difficulty: 4
- [ ] TASK-0578 — Tunnel Forwarding — Port tunneling — File: `pydardcor/remote/ports_panel.py` (improve) — Difficulty: 6
- [ ] TASK-0579 — Configuration Editing — Settings IntelliSense — File: extensions/config_editing/ — Difficulty: 5
- [ ] TASK-0580 — Extension Editing — Extension dev support — File: extensions/ext_editing/ — Difficulty: 5
- [ ] TASK-0581 — Grunt/Gulp/Jake — Task auto-detect — File: tasks/auto_detect.py — Difficulty: 5
- [ ] TASK-0582 — GitHub Auth — GitHub login — File: core/auth.py — Difficulty: 6
- [ ] TASK-0583 — Notebook Renderers — Output renderers — File: notebooks/renderers.py — Difficulty: 6
- [ ] TASK-0584 — Terminal Suggest — Terminal completion — File: terminal/suggest.py — Difficulty: 7

### ====== 45. LANGUAGE DEFAULT THEMES ======

- [ ] TASK-0585 — Theme Dark+ — Default dark theme — File: assets/themes/dark_plus.json — Difficulty: 3
- [ ] TASK-0586 — Theme Light+ — Default light theme — File: assets/themes/light_plus.json — Difficulty: 3
- [ ] TASK-0587 — Theme High Contrast — High contrast — File: assets/themes/hc.json — Difficulty: 3
- [ ] TASK-0588 — Theme Monokai — Monokai theme — File: assets/themes/monokai.json — Difficulty: 3
- [ ] TASK-0589 — Theme Solarized — Solarized — File: assets/themes/solarized.json — Difficulty: 3
- [ ] TASK-0590 — Theme Abyss — Abyss theme — File: assets/themes/abyss.json — Difficulty: 3
- [ ] TASK-0591 — Theme Kimbie — Kimbie dark — File: assets/themes/kimbie.json — Difficulty: 3
- [ ] TASK-0592 — Theme Monokai Dimmed — Dimmed monokai — File: assets/themes/monokai_dimmed.json — Difficulty: 3
- [ ] TASK-0593 — Theme Quiet Light — Quiet light — File: assets/themes/quiet_light.json — Difficulty: 3
- [ ] TASK-0594 — Theme Red — Red theme — File: assets/themes/red.json — Difficulty: 3
- [ ] TASK-0595 — Theme Tomorrow Night Blue — Blue theme — File: assets/themes/tomorrow_night_blue.json — Difficulty: 3
- [ ] TASK-0596 — Theme Seti — Seti file icons — File: assets/themes/seti.json — Difficulty: 4

### ====== 46. CHAT & AI ======

- [ ] TASK-0597 — Chat Panel — Full chat UI — File: dardcor_agent/chat/panel.py (improve) — Difficulty: 7
- [ ] TASK-0598 — Chat Participants — @workspace, @terminal, etc — File: dardcor_agent/chat/participants.py — Difficulty: 7
- [ ] TASK-0599 — Chat Variables — #file, #selection — File: dardcor_agent/chat/variables.py — Difficulty: 6
- [ ] TASK-0600 — Chat Slash Commands — /fix, /explain — File: dardcor_agent/chat/slash.py — Difficulty: 5
- [ ] TASK-0601 — Chat Code Blocks — Syntax-highlighted — File: dardcor_agent/chat/code_blocks.py — Difficulty: 5
- [ ] TASK-0602 — Chat Attachments — File/image attach — File: dardcor_agent/chat/attachments.py — Difficulty: 5
- [ ] TASK-0603 — Chat Edit Mode — Multi-file edit — File: dardcor_agent/chat/edit_mode.py — Difficulty: 8
- [ ] TASK-0604 — Chat History — Conversation history — File: dardcor_agent/chat/history.py — Difficulty: 5
- [ ] TASK-0605 — Chat Model Selection — Choose AI model — File: dardcor_agent/models/ — Difficulty: 5
- [ ] TASK-0606 — Inline Chat — Ctrl+I in editor — File: `pydardcor/editor/inline_chat.py` (improve) — Difficulty: 6
- [ ] TASK-0607 — Voice Input — Speech-to-text — File: dardcor_agent/chat/voice.py — Difficulty: 8
- [ ] TASK-0608 — Chat Agent Sessions — Full agent UI — File: dardcor_agent/sessions/ — Difficulty: 9
- [ ] TASK-0609 — Model Context Protocol — MCP for AI — File: mcp/ (see above) — Difficulty: 9
- [ ] TASK-0610 — Agent Plugins — Extensible agent — File: dardcor_agent/extensibility/ — Difficulty: 8

### ====== 47. IMAGE HANDLING ======

- [ ] TASK-0611 — Image Preview — PNG/JPEG/GIF/SVG viewer — File: `pydardcor/editor/image_viewer.py` (improve) — Difficulty: 4
- [ ] TASK-0612 — Image Zoom — Zoom in/out — File: image_viewer.py — Difficulty: 3
- [ ] TASK-0613 — Image Info — Dimensions, size — File: image_viewer.py — Difficulty: 3
- [ ] TASK-0614 — Image Transparency — Checkerboard bg — File: image_viewer.py — Difficulty: 3
- [ ] TASK-0615 — SVG Rendering — SVG support — File: image_viewer.py — Difficulty: 4
- [ ] TASK-0616 — Image Carousel — Browse images — File: image_viewer.py — Difficulty: 5

### ====== 48. HEX EDITOR ======

- [ ] TASK-0617 — Hex View — Binary file viewer — File: `pydardcor/editor/hex_editor.py` (improve) — Difficulty: 6
- [ ] TASK-0618 — Hex Edit — Binary editing — File: hex_editor.py — Difficulty: 7
- [ ] TASK-0619 — Hex Find — Search hex — File: hex_editor.py — Difficulty: 5
- [ ] TASK-0620 — Hex Go To — Offset navigation — File: hex_editor.py — Difficulty: 3

### ====== 49. KEYBOARD SHORTCUTS ======

- [ ] TASK-0621 — All Default Keybindings — Complete keybinding set — File: defaults — Difficulty: 5
- [ ] TASK-0622 — Chord Keybindings — Ctrl+K Ctrl+C etc — File: keybinding_manager.py — Difficulty: 6
- [ ] TASK-0623 — When Context — Full context evaluation — File: context_keys.py — Difficulty: 7
- [ ] TASK-0624 — Keybinding Resolver — Conflict resolution — File: keybinding_manager.py — Difficulty: 7
- [ ] TASK-0625 — Keyboard Shortcuts Editor — Full editor — File: settings/keybindings_ui.py — Difficulty: 6
- [ ] TASK-0626 — Default Keybindings JSON — View defaults — File: settings/keybindings_ui.py — Difficulty: 3
- [ ] TASK-0627 — Keybinding Record — Capture shortcut — File: keybindings_ui.py — Difficulty: 5

### ====== 50. ICONS & VISUAL ASSETS ======

- [ ] TASK-0628 — Codicon Font — Full icon font — File: assets/codicon.ttf (verify) — Difficulty: 2
- [ ] TASK-0629 — File Icon Theme — Seti icons — File: assets/icons/ — Difficulty: 5
- [ ] TASK-0630 — Folder Icons — src, dist, node_modules — File: file_explorer/panel.py — Difficulty: 4
- [ ] TASK-0631 — Product Icons — All product icons — File: assets/icons/product/ — Difficulty: 5
- [ ] TASK-0632 — Welcome Page Icons — Getting started — File: assets/icons/welcome/ — Difficulty: 3
- [ ] TASK-0633 — Empty State Icons — No results — File: assets/icons/empty/ — Difficulty: 3
- [ ] TASK-0634 — Debug Icons — Play, pause, stop — File: assets/icons/debug/ — Difficulty: 3
- [ ] TASK-0635 — Tree Icons — Chevrons, folders — File: file_explorer/panel.py — Difficulty: 3

### ====== 51. SPEECH ======

- [ ] TASK-0636 — Speech Recognition — Dictation — File: `pydardcor/speech/recognition.py` (NEW) — Difficulty: 8
- [ ] TASK-0637 — Text-to-Speech — Accessibility — File: `pydardcor/speech/tts.py` — Difficulty: 6
- [ ] TASK-0638 — Voice Commands — Voice control — File: speech/commands.py — Difficulty: 8
- [ ] TASK-0639 — Audio Cues — Event sounds — File: `pydardcor/core/audio_cues.py` — Difficulty: 4

### ====== 52. MISCELLANEOUS ======

- [ ] TASK-0640 — URL Handler — vscode:// protocol — File: `pydardcor/core/url_handler.py` — Difficulty: 6
- [ ] TASK-0641 — Share — Link sharing — File: `pydardcor/core/share.py` — Difficulty: 5
- [ ] TASK-0642 — Surveys — In-product surveys — File: `pydardcor/app/surveys.py` — Difficulty: 5
- [ ] TASK-0643 — Tags — Workspace tags — File: `pydardcor/core/tags.py` — Difficulty: 4
- [ ] TASK-0644 — Encrypted Storage — Encrypt sensitive data — File: `pydardcor/core/encryption.py` — Difficulty: 6
- [ ] TASK-0645 — Policy Support — Enterprise policies — File: `pydardcor/core/policy.py` — Difficulty: 7
- [ ] TASK-0646 — Metered Connection — Metered network warning — File: `pydardcor/core/network.py` — Difficulty: 4
- [ ] TASK-0647 — Scroll Locking — Lock scroll across splits — File: editor/scroll_lock.py — Difficulty: 4
- [ ] TASK-0648 — Style Overrides — CSS overrides — File: app/style_overrides.py — Difficulty: 4
- [ ] TASK-0649 — Backup & Recovery — Hot exit — File: core/backup.py — Difficulty: 6
- [ ] TASK-0650 — Graceful Shutdown — Save state on exit — File: app/app.py — Difficulty: 4
- [ ] TASK-0651 — Process Manager — Manage child processes — File: core/process.py — Difficulty: 5
- [ ] TASK-0652 — Shell Integration — Shell environment — File: terminal/backend.py — Difficulty: 5
- [ ] TASK-0653 — Operating System Integration — File associations, protocol handler — File: app/os_integration.py — Difficulty: 6
- [ ] TASK-0654 — Single Instance — Singleton app — File: app/app.py — Difficulty: 5
- [ ] TASK-0655 — CLI Arguments — Full CLI arg parsing — File: `pydardcor/cli.py` (improve) — Difficulty: 5
- [ ] TASK-0656 — Drag and Drop from OS — Drag file into app — File: main_window.py — Difficulty: 4
- [ ] TASK-0657 — Clipboard Management — System clipboard — File: core/clipboard.py — Difficulty: 3
- [ ] TASK-0658 — Native Dialogs — OS file dialogs — File: core/dialogs.py — Difficulty: 3
- [ ] TASK-0659 — Auto-Detect Encoding — File encoding detection — File: editor/encoding.py — Difficulty: 5
- [ ] TASK-0660 — Large File Optimizations — Virtualized rendering — File: editor/large_file.py — Difficulty: 8

---

## 🎯 PRIORITAS BERDASARKAN KATEGORI

### Fase 1 — Core Infrastructure (Task 0001-0015, 0640-0660)
DI framework, event bus, context keys, keybinding resolver, config layers, logging, error handling.

### Fase 2 — Editor & Monaco (Task 0059-0106, 0082-0106)
Editor service, multi-tabs, split, merge editor, diff, code intelligence bridge.

### Fase 3 — Layout & Window (Task 0016-0027, 0028-0040, 0041-0058)
Multi-window, title bar, menu bar, activity bar, sidebar, panel, sash resizer.

### Fase 4 — UI Panels (Task 0107-0165, 0312-0346, 0347-0355)
Status bar, search, quick open, notifications, problems, output, breadcrumbs, minimap.

### Fase 5 — SCM & Git (Task 0178-0201)
Full Git integration, blame, rebase, merge, LFS.

### Fase 6 — Debug (Task 0202-0228)
Full DAP client, breakpoints, variables, call stack, REPL, multi-session.

### Fase 7 — Terminal (Task 0229-0254)
PTY, split, profiles, find, links, suggest.

### Fase 8 — Extensions (Task 0255-0279)
Extension host, VS Code API, marketplace, bisect.

### Fase 9 — Settings & Themes (Task 0280-0311)
Settings UI, keybindings editor, theme system.

### Fase 10 — Notebooks (Task 0356-0373)
Jupyter kernel, rich output, cell operations.

### Fase 11 — Testing (Task 0374-0385)
Test explorer, coverage, continuous run.

### Fase 12 — Remote (Task 0436-0449)
SSH, containers, tunnels, WSL.

### Fase 13 — Chat & AI (Task 0597-0610)
Chat participants, voice, edit mode, MCP.

### Fase 14 — Sync, Profiles, Updates (Task 0469-0487)
Settings sync, profiles, auto-update.

### Fase 15 — Comments, Timeline, Misc (Task 0398-0414, 0636-0659)
Comments system, timeline, speech, enterprise.

---

## 📊 PROGRESS TRACKER

| Fase | Total Tasks | [ ] | [x] | % |
|------|-------------|-----|-----|---|
| 1. Core Infrastructure | 22 | 22 | 0 | 0% |
| 2. Editor & Monaco | 48 | 48 | 0 | 0% |
| 3. Layout & Window | 33 | 33 | 0 | 0% |
| 4. UI Panels | 55 | 55 | 0 | 0% |
| 5. SCM & Git | 24 | 24 | 0 | 0% |
| 6. Debug | 27 | 27 | 0 | 0% |
| 7. Terminal | 26 | 26 | 0 | 0% |
| 8. Extensions | 25 | 25 | 0 | 0% |
| 9. Settings & Themes | 34 | 34 | 0 | 0% |
| 10. Notebooks | 18 | 18 | 0 | 0% |
| 11. Testing | 12 | 12 | 0 | 0% |
| 12. Remote | 14 | 14 | 0 | 0% |
| 13. Chat & AI | 14 | 14 | 0 | 0% |
| 14. Sync, Profiles, Updates | 19 | 19 | 0 | 0% |
| 15. Comments, Timeline, Misc | 28 | 28 | 0 | 0% |
| Bugs | 10 | 10 | 0 | 0% |
| **TOTAL** | **429** | **429** | **0** | **0%** |

> **CATATAN PENTING:** Task.md yang ada sebelumnya TIDAK AKURAT. Banyak fitur dicentang padahal hanya stub/mock. AGENT.md ini adalah daftar HONEST yang mencakup SEMUA yang benar-benar perlu dikerjakan.

Setiap task harus:
1. Dibaca deskripsinya
2. Dicari referensi di VS Code asli
3. Diimplementasikan fully working (NO STUBS, NO MOCKS)
4. Dites manual
5. Dicentang [x]

KERJAKAN URUT DARI ATAS KE BAWAH. JANGAN LOMPAT-LOMPAT.
