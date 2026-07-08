# Dardcor Code — Daftar Tugas Menuju 100% Sama Persis Dengan VS Code

Baca lengkap Project asli Visual Studio Code C:\Users\Dardcor\Documents\Code Editor\Visual Studio Code

> Dokumen ini berisi daftar lengkap fitur, fungsi, tampilan, icon, dan penyimpanan lokal
> yang masih belum sama persis antara Dardcor Code dan Visual Studio Code asli.
> Disusun berdasarkan pembacaan mendalam terhadap source code VS Code (`src/vs/`)
> dan dibandingkan satu per satu dengan modul Dardcor Code (`pydardcor/`, `dardcor_agent/`).
>
> Keterangan:
> - [x] = Sudah diimplementasikan / tersedia via Monaco Editor
> - [ ] = Belum diimplementasikan, perlu dikerjakan

---

## 1. EDITOR — Core Text Editor (Monaco)

### 1.1 Editor Features (vs/editor/contrib/) — Disediakan oleh Monaco Editor
- [x] **Bracket Matching** — `matchBrackets: 'always'` sudah aktif di monaco_editor.html
- [x] **Bracket Pair Colorization** — `bracketPairColorization: { enabled: true }` sudah aktif
- [x] **Anchor Select** — selection anchor untuk multi-cursor expand (anchorSelect)
- [x] **Caret Operations** — bawaan Monaco (transpose letters, move by word boundary)
- [x] **Clipboard Handling** — `copyWithSyntaxHighlighting: true` + cut/copy/paste via widget.py
- [x] **Code Action** — `lightbulb: { enabled: true }` sudah aktif + Quick Fix diagnostic actions
- [x] **CodeLens** — `codeLens: true` sudah aktif + References & Run action links
- [x] **Color Picker** — `colorDecorators: true` sudah aktif
- [x] **Comment Toggle** — bawaan Monaco (Ctrl+/ dan Ctrl+Shift+/)
- [x] **Context Menu** — `contextmenu: true` sudah aktif + extension context menu
- [x] **Cursor Undo** — bawaan Monaco
- [x] **Diff Editor Breadcrumbs** — breadcrumbs di diff editor view
- [x] **Drag and Drop** — `dragAndDrop: true` sudah aktif + file drop to open support
- [x] **Document Symbols** — bawaan Monaco + quick outline symbols provider
- [x] **Drop or Paste Into** — handle file/image paste & drop path/link insertion ke editor
- [x] **Editor State** — save/restore cursor position & scroll position per file
- [x] **Find and Replace** — triggerFind() dan triggerFindReplace() sudah diimplementasikan
- [x] **Floating Menu** — floating contextual menu untuk selections (Copy, Format, AI Chat)
- [x] **Code Folding** — `folding: true, showFoldingControls: 'mouseover'` sudah aktif
- [x] **Font Zoom** — `mouseWheelZoom: true` sudah aktif
- [x] **Format Document** — triggerFormat() sudah diimplementasikan
- [x] **Go to Error** — bawaan Monaco (F8 / Shift+F8)
- [x] **Go to Symbol** — bawaan Monaco (Ctrl+Shift+O)
- [x] **GPU Acceleration** — GPU-accelerated rendering
- [x] **Hover** — registerHoverProvider untuk Python sudah ada di bridge.py
- [x] **In-Place Replace** — cycle through suggestions in-place (Alt+[ dan Alt+])
- [x] **Indentation** — `autoIndent: 'full', detectIndentation: true` sudah aktif
- [x] **Inlay Hints** — `inlayHints: { enabled: 'on' }` sudah aktif + return type hints provider
- [x] **Inline Completions** — registerInlineCompletionsProvider sudah ada (AI ghost text)
- [x] **Inline Progress** — inline loading indicator (animated top progress bar)
- [x] **Insert Final New Line** — auto insert newline di akhir file on save
- [x] **Line Selection** — bawaan Monaco (Ctrl+L)
- [x] **Lines Operations** — copy_line_up/down & move_line_up/down keybindings aktif
- [x] **Linked Editing** — `linkedEditing: true` sudah aktif
- [ ] **Links** — `links: true` sudah aktif
- [ ] **Long Lines Helper** — performance helper untuk file panjang
- [ ] **Editor Messages** — pesan overlay di editor
- [ ] **Middle Scroll** — middle mouse button scroll
- [ ] **Multi Cursor** — `multiCursorModifier: 'alt', columnSelection: true` sudah aktif
- [ ] **Parameter Hints** — `parameterHints: { enabled: true }` sudah aktif
- [ ] **Peek View** — bawaan Monaco (Alt+F12)
- [ ] **Placeholder Text** — placeholder text di empty editor
- [ ] **Quick Access** — command_palette.py sudah diimplementasikan (Ctrl+P)
- [ ] **Read Only Message** — pesan saat edit read-only file
- [ ] **Rename** — bawaan Monaco (F2)
- [ ] **Section Headers** — visual section separators
- [ ] **Semantic Tokens** — semantic highlighting dari language server
- [ ] **Smart Select** — expand_selection/shrink_selection sudah di widget.py
- [ ] **Snippets** — snippet_manager.py + extension snippets via bridge.py sudah ada
- [ ] **Sticky Scroll** — `stickyScroll: { enabled: true, maxLineCount: 5 }` sudah aktif
- [ ] **Suggest (Autocomplete)** — backendCompletionProvider + LSP completions sudah ada
- [ ] **Symbol Icons** — bawaan Monaco
- [ ] **Toggle Tab Focus Mode** — tab key focus mode toggle
- [ ] **Tokenization** — Monaco + `vs/basic-languages/monaco.contribution` sudah dimuat
- [ ] **Unicode Highlighter** — highlight invisible unicode characters
- [ ] **Unusual Line Terminators** — detect CRLF/LF/mixed
- [ ] **Word Highlighter** — `occurrencesHighlight: true, selectionHighlight: true` sudah aktif
- [ ] **Word Operations** — bawaan Monaco
- [ ] **Word Part Operations** — bawaan Monaco
- [ ] **Zone Widget** — base class untuk inline editor widgets

### 1.2 Editor Tabs & Groups
- [ ] **Multi-Row Tabs** — opsi menampilkan tabs di beberapa baris
- [ ] **Tab Wrapping** — tab wrap ketika overflow
- [ ] **Pinned Tabs** — pin tab agar tidak bisa ditutup/dipindah
- [ ] **Tab Preview Mode** — single-click hanya preview, double-click baru buka
- [ ] **Tab Close on Middle Click** — middle mouse click menutup tab
- [ ] **Tab Drag Reorder** — sudah ada di tabs.py (drag-and-drop reorder)
- [ ] **Tab Drag to New Group** — drag tab ke sisi lain untuk split editor
- [ ] **Editor Group Splitting** — split editor sudah ada di group.py
- [ ] **Editor Grid Layout** — 2x2 atau custom grid layout
- [ ] **Diff Editor Side-by-Side** — diff_editor.html + diff_viewer.py sudah ada
- [ ] **Editor Group Watermark** — welcome watermark saat group kosong
- [ ] **Editor Drop Target** — visual indicator saat drag file
- [ ] **Editor Auto Save** — auto save setelah delay / on focus change
- [ ] **Editor Quick Access** — Ctrl+Tab switch antar editor tabs
- [ ] **No Tab Mode** — mode tanpa tabs
- [ ] **Single Tab Mode** — mode single tab

### 1.3 Editor Status Bar Items
- [ ] **Line/Column indicator** — status_bar.py sudah menampilkan Ln/Col
- [ ] **Selection count** — jumlah karakter/baris yang diseleksi
- [ ] **Indentation indicator** — Spaces:4 sudah di status_bar.py
- [ ] **Encoding indicator** — UTF-8 sudah di status_bar.py
- [ ] **End of Line indicator** — LF/CRLF sudah di status_bar.py
- [ ] **Language Mode indicator** — language mode sudah di status_bar.py
- [ ] **Feedback icon** — smiley face feedback icon
- [ ] **Notification bell** — notification bell sudah di status_bar.py
- [ ] **Remote indicator** — remote connection indicator

---

## 2. FILE EXPLORER (vs/workbench/contrib/files/)

### 2.1 Explorer Tree View
- [ ] **File/Folder drag-and-drop** — drag file/folder untuk move/copy
- [ ] **Rename inline** — F2 rename sudah ada di panel.py (explorer)
- [ ] **Multi-select** — Ctrl+Click / Shift+Click multi-select di tree
- [ ] **Filter on Type** — type to filter tree items
- [ ] **Compact Folders** — tampilkan single-child folders secara compact
- [ ] **File Nesting** — nest related files
- [ ] **File Decorations** — git status decorations sudah ada di panel.py
- [ ] **Explorer Sort Order** — sort by name, type, modified date, size
- [ ] **Sticky Scroll di Explorer** — sticky parent folder saat scroll
- [ ] **New File/Folder** — tombol new file/folder sudah ada di explorer header
- [ ] **Collapse All** — tombol collapse all sudah ada
- [ ] **Refresh Explorer** — tombol refresh sudah ada
- [ ] **Open Editors Section** — open_editors_panel.py sudah ada
- [ ] **Outline Section** — outline_panel.py sudah ada
- [ ] **Timeline Section** — timeline_panel.py sudah ada
- [ ] **Explorer Context Menu** — right-click context menu sudah ada di panel.py
- [ ] **Excluded Files** — settings files.exclude

### 2.2 File Operations
- [ ] **File Watcher** — QFileSystemWatcher sudah ada di panel.py
- [ ] **Workspace Watcher** — workspace-level file watching
- [ ] **File Import/Export** — import/export files
- [ ] **Binary File Viewer** — hex_editor.py sudah ada
- [ ] **File Associations** — language.py detect_language sudah ada

---

## 3. SEARCH (vs/workbench/contrib/search/)

### 3.1 Search View
- [ ] **Search Input** — search panel sudah ada dengan regex, case, whole word toggles
- [ ] **Replace Input** — replace sudah ada di search panel
- [ ] **Files to Include** — glob pattern include sudah ada
- [ ] **Files to Exclude** — glob pattern exclude sudah ada
- [ ] **Search Results Tree** — hierarchical tree view sudah ada
- [ ] **Match Highlighting** — sudah ada di search results
- [ ] **Match Context Lines** — show surrounding lines
- [ ] **Replace Preview** — preview replace changes
- [ ] **Search History** — recent search terms dropdown
- [ ] **Dismiss Search Result** — dismiss individual results
- [ ] **Collapse/Expand Results** — collapse/expand sudah ada
- [ ] **Open in Editor** — click result jump ke file:line sudah ada
- [ ] **Search Editor** — dedicated search results editor tab
- [ ] **AI Search** — semantic/AI-powered search
- [ ] **Notebook Search** — search inside notebook cells

### 3.2 Quick Open (Ctrl+P)
- [ ] **File Quick Open** — command_palette.py sudah ada (Ctrl+P fuzzy search)
- [ ] **Symbol Quick Open** — `@` symbol search sudah ada
- [ ] **Global Symbol Search** — `#` symbol search across workspace
- [ ] **Go to Line** — `:` go to line sudah ada
- [ ] **Command Quick Open** — `>` command palette sudah ada
- [ ] **Recent Files** — MRU file list sudah ada
- [ ] **Quick Access Providers** — extensible quick access system

---

## 4. SOURCE CONTROL / GIT (vs/workbench/contrib/scm/)

### 4.1 SCM View
- [ ] **Source Control Providers** — pluggable SCM provider interface
- [ ] **Changed Files List** — git panel sudah menampilkan changed files
- [ ] **Inline Diff Preview** — click file to see diff sudah ada
- [ ] **Stage/Unstage** — stage/unstage sudah ada di git bridge
- [ ] **Commit Message Input** — commit message editor sudah ada
- [ ] **Commit Actions** — commit sudah ada
- [ ] **Branch Indicator** — branch name di status bar sudah ada
- [ ] **Branch Operations** — create, switch branch sudah ada di clone_dialog/bridge
- [ ] **Merge** — merge branches with conflict resolution
- [ ] **Pull/Push** — pull/push sudah ada di git bridge
- [ ] **Stash** — stash/unstash changes
- [ ] **Sync Changes** — sync indicator sudah ada
- [ ] **Remote Management** — add/remove/rename remotes
- [ ] **Git Graph/History** — git_graph.py sudah ada
- [ ] **Gutter Indicators** — green/blue/red gutter marks
- [ ] **SCM History View** — dedicated history view pane
- [ ] **SCM Repositories View** — multi-repo view
- [ ] **Quick Diff** — inline quick diff gutters
- [ ] **Quick Diff Widget** — peek diff widget in gutter
- [ ] **Working Set** — working set management

---

## 5. DEBUG (vs/workbench/contrib/debug/)

### 5.1 Debug View
- [ ] **Debug Configuration Manager** — launch_config.py sudah ada
- [ ] **Debug Toolbar** — debug_toolbar.py sudah ada (Continue, Step, Stop)
- [ ] **Variables View** — variables view di debug panel sudah ada
- [ ] **Watch Expressions** — watch expressions sudah ada
- [ ] **Call Stack View** — call stack view sudah ada
- [ ] **Breakpoints View** — breakpoints view di debug panel
- [ ] **Conditional Breakpoints** — breakpoints with conditions
- [ ] **Logpoint** — breakpoint yang logs tanpa stopping
- [ ] **Function Breakpoints** — break on function name
- [ ] **Data Breakpoints** — break on variable value change
- [ ] **Exception Breakpoints** — break on caught/uncaught exceptions
- [ ] **Inline Values** — show variable values inline saat debugging
- [ ] **Debug Hover** — hover variable di editor saat debugging
- [ ] **Debug Console (REPL)** — interactive debug console
- [ ] **Debug ANSI Handling** — ANSI color support
- [ ] **Loaded Scripts View** — view loaded scripts/modules
- [ ] **Disassembly View** — low-level disassembly view
- [ ] **Debug Session Picker** — pick active debug session
- [ ] **Debug Task Runner** — run pre-launch tasks
- [ ] **Debug Status Bar** — debug status di status bar
- [ ] **Debug Colors** — theme colors untuk debug decorations
- [ ] **Multi-Session Debug** — concurrent debug sessions
- [ ] **Compound Launch** — launch multiple debug configs
- [ ] **Raw Debug Session (DAP)** — dap_client.py sudah ada

---

## 6. TERMINAL (vs/workbench/contrib/terminal/)

### 6.1 Terminal Features
- [ ] **Multiple Terminal Instances** — terminal panel sudah support multiple instances
- [ ] **Terminal Tabs** — terminal tabs sudah ada di panel.py
- [ ] **Split Terminal** — split terminal sudah ada
- [ ] **Terminal Groups** — group terminals together
- [ ] **Terminal Profiles** — terminal profiles (PowerShell, CMD, Bash) sudah ada
- [ ] **Terminal Profile Picker** — dropdown select profile sudah ada
- [ ] **Terminal Rename** — rename terminal sudah ada
- [ ] **Terminal Color/Icon** — custom color & icon per terminal tab
- [ ] **Terminal Find** — Ctrl+F find di terminal sudah ada
- [ ] **Terminal Selection** — text selection sudah ada
- [ ] **Terminal Copy/Paste** — copy/paste sudah ada
- [ ] **Terminal Links** — clickable URLs and file paths
- [ ] **Terminal Context Menu** — right-click context menu sudah ada
- [ ] **Terminal Resize** — resize terminal panel sudah ada
- [ ] **Terminal Scrollback** — scrollback buffer sudah ada
- [ ] **Terminal Escape Sequences** — ANSI escape handling sudah ada
- [ ] **Terminal Configuration** — all terminal settings
- [ ] **Terminal Process Manager** — process management
- [ ] **External Terminal** — open external terminal
- [ ] **Terminal Icon Picker** — pick icon for terminal tab
- [ ] **Terminal Status** — terminal status indicators
- [ ] **Terminal Editing Service** — edit terminal content
- [ ] **Terminal Chat Mirror** — terminal integration with chat
- [ ] **Terminal Suggest** — terminal command suggestions

---

## 7. EXTENSIONS (vs/workbench/contrib/extensions/)

### 7.1 Extensions Marketplace
- [ ] **Extension Search** — extensions_panel.py sudah ada dengan search
- [ ] **Extension Install/Uninstall** — install/uninstall sudah ada di extension_manager.py
- [ ] **Extension Update** — auto-check and update extensions
- [ ] **Extension Enable/Disable** — enable/disable sudah ada
- [ ] **Extension Detail Page** — extension_detail_page.py sudah ada
- [ ] **Extension Ratings & Reviews** — display star ratings
- [ ] **Extension Dependencies** — automatic dependency installation
- [ ] **Extension Recommendations** — file-based recommendations
- [ ] **Extension Pack Support** — install extension packs
- [ ] **Extension Bisect** — binary search for problematic extension
- [ ] **Extension Viewer** — rich extension list item sudah ada
- [ ] **Extension Quick Access** — `ext ` quick access provider
- [ ] **Extension Features Tab** — view extension contributions
- [ ] **Workspace Trust for Extensions** — extension trust management
- [ ] **Extension Auto Update** — configurable auto-update
- [ ] **Extension Sync** — sync installed extensions

---

## 8. NOTIFICATIONS (vs/workbench/browser/parts/notifications/)

### 8.1 Notification System
- [ ] **Notification Toasts** — notification_service.py NotificationToast sudah ada
- [ ] **Notification Center** — expandable notification center
- [ ] **Notification Actions** — actionable buttons sudah ada
- [ ] **Notification Progress** — progress indicator
- [ ] **Notification Source Filter** — filter by source
- [ ] **Do Not Disturb** — DND mode
- [ ] **Notification Status Bar** — notification count badge
- [ ] **Notification Persistence** — persist across sessions

---

## 9. STATUS BAR (vs/workbench/browser/parts/statusbar/)

### 9.1 Status Bar Items
- [ ] **Left-aligned items** — branch, errors/warnings sudah ada
- [ ] **Right-aligned items** — line/col, encoding, EOL, language sudah ada
- [ ] **Status Bar Model** — dynamic add/remove status bar items sudah ada
- [ ] **Status Bar Actions** — click handlers sudah ada
- [ ] **Status Bar Colors** — background color per item (debug mode)
- [ ] **Remote Status** — remote connection status
- [ ] **Extension Status Items** — extension-contributed items sudah ada
- [ ] **Status Bar Hover** — tooltip sudah ada
- [ ] **Status Bar Context Menu** — right-click to show/hide items

---

## 10. TITLE BAR (vs/workbench/browser/parts/titlebar/)

### 10.1 Title Bar Features
- [ ] **Custom Title Bar** — custom title bar sudah ada di main_window.py
- [ ] **Menu Bar Integration** — menubar sudah ada
- [ ] **Command Center** — centered command input di title bar
- [ ] **Window Controls** — min/max/close buttons sudah ada
- [ ] **Window Title** — dynamic title sudah ada
- [ ] **Window Title Variables** — `${activeEditorShort}` dll
- [ ] **Title Bar Actions** — layout toggle, activity bar toggle

---

## 11. ACTIVITY BAR (vs/workbench/browser/parts/activitybar/)

### 11.1 Activity Bar Features
- [ ] **Activity Bar Icons** — Explorer, Search, Git, Debug, Extensions, Testing sudah ada
- [ ] **Activity Bar Badge** — notification badge count sudah ada
- [ ] **Activity Bar Context Menu** — right-click to hide/show views
- [ ] **Activity Bar Reorder** — drag-and-drop reorder sudah ada di activity_bar.py
- [ ] **Activity Bar Position** — left, right, top, hidden positions
- [ ] **Activity Bar Extension Buttons** — extension view containers sudah ada
- [ ] **Global Composite Bar** — accounts, settings gear di bawah

---

## 12. SIDEBAR / PANEL LAYOUT (vs/workbench/browser/parts/)

### 12.1 Layout Features
- [ ] **Side Bar** — primary sidebar sudah ada
- [ ] **Auxiliary Side Bar** — secondary sidebar (right)
- [ ] **Panel (Bottom)** — bottom panel (terminal, output, problems) sudah ada
- [ ] **Panel Position** — bottom, right, left positions
- [ ] **Panel Maximize** — maximize/restore panel
- [ ] **Layout Persistence** — save/restore layout across sessions
- [ ] **Layout Reset** — reset layout to default
- [ ] **Zen Mode** — zen_mode.py sudah ada
- [ ] **Centered Editor Layout** — centered_layout.py sudah ada
- [ ] **Side Bar Toggle** — Ctrl+B toggle sidebar sudah ada
- [ ] **Panel Toggle** — Ctrl+J toggle bottom panel sudah ada
- [ ] **Drag Sash** — resizable splitters sudah ada

---

## 13. COMMAND PALETTE (vs/workbench/contrib/quickaccess/)

### 13.1 Command Palette Features
- [ ] **Fuzzy Search** — fuzzy matching sudah ada di command_palette.py
- [ ] **Keybinding Display** — shortcut display sudah ada
- [ ] **Recently Used** — recent commands sudah ada
- [ ] **Command Categories** — grouped by category sudah ada
- [ ] **Parameterized Commands** — commands that accept input
- [ ] **Command Alias** — multiple names untuk same command
- [ ] **Extension Commands** — extension-contributed commands sudah ada

---

## 14. SETTINGS (vs/workbench/contrib/preferences/)

### 14.1 Settings Editor
- [ ] **Settings UI** — settings_ui.py rich settings editor sudah ada
- [ ] **Settings Search** — search settings sudah ada
- [ ] **Settings Categories** — categories sudah ada
- [ ] **Settings Scopes** — User / Workspace / Folder scope tabs
- [ ] **Setting Types** — boolean, text, number, enum sudah ada
- [ ] **Setting Indicators** — modified indicator, default reset
- [ ] **Setting Descriptions** — markdown descriptions per setting
- [ ] **settings.json** — raw JSON settings editor
- [ ] **Default Settings** — view all default settings
- [ ] **Settings Sync** — sync settings across devices

### 14.2 Keyboard Shortcuts Editor
- [ ] **Keyboard Shortcuts UI** — keybindings_ui.py sudah ada
- [ ] **Keybinding Search** — search by key/command sudah ada
- [ ] **Record Keys** — record key combination sudah ada
- [ ] **When Clause** — context (when) conditions
- [ ] **keybindings.json** — raw JSON keybindings editor
- [ ] **Default Keybindings** — view all default keybindings
- [ ] **Conflict Detection** — detect conflicting keybindings

---

## 15. THEMES (vs/workbench/contrib/themes/)

### 15.1 Theme System
- [ ] **Color Themes** — theme_manager.py + defineCustomTheme sudah ada
- [ ] **File Icon Themes** — icon_theme_manager.py sudah ada
- [ ] **Product Icon Themes** — Codicon icon customization
- [ ] **Theme Quick Picker** — theme picker di command palette sudah ada
- [ ] **Theme Preview** — live preview saat scrolling themes
- [ ] **High Contrast Themes** — high contrast dark & light themes
- [ ] **Custom CSS Tokens** — theme customization per token
- [ ] **Workbench Color Customization** — `workbench.colorCustomizations`
- [ ] **Token Color Customization** — `editor.tokenColorCustomizations`

---

## 16. BUILT-IN LANGUAGE SUPPORT (extensions/)

### 16.1 Syntax Highlighting (TextMate Grammars) — Via Monaco built-in languages
- [ ] **JavaScript/TypeScript** — Monaco vs/basic-languages + ts worker
- [ ] **Python** — Monaco vs/basic-languages/python
- [ ] **HTML** — Monaco vs/language/html
- [ ] **CSS/SCSS/Less** — Monaco vs/language/css
- [ ] **JSON** — Monaco vs/language/json
- [ ] **Markdown** — Monaco vs/basic-languages/markdown
- [ ] **C/C++** — Monaco vs/basic-languages/cpp
- [ ] **C#** — Monaco vs/basic-languages/csharp
- [ ] **Java** — Monaco vs/basic-languages/java
- [ ] **Go** — Monaco vs/basic-languages/go
- [ ] **Rust** — Monaco vs/basic-languages/rust
- [ ] **Ruby** — Monaco vs/basic-languages/ruby
- [ ] **PHP** — Monaco vs/basic-languages/php
- [ ] **Swift** — Monaco vs/basic-languages/swift
- [ ] **Kotlin** — Monaco vs/basic-languages/kotlin
- [ ] **Dart** — Monaco vs/basic-languages/dart
- [ ] **SQL** — Monaco vs/basic-languages/sql
- [ ] **YAML** — Monaco vs/basic-languages/yaml
- [ ] **XML** — Monaco vs/basic-languages/xml
- [ ] **Shell Script** — Monaco vs/basic-languages/shell
- [ ] **PowerShell** — Monaco vs/basic-languages/powershell
- [ ] **Lua** — Monaco vs/basic-languages/lua
- [ ] **R** — Monaco vs/basic-languages/r
- [ ] **Perl** — Monaco vs/basic-languages/perl
- [ ] **Docker** — Monaco vs/basic-languages/dockerfile
- [ ] **Makefile** — syntax highlighting
- [ ] **INI/Properties** — Monaco vs/basic-languages/ini
- [ ] **Diff** — detect_language sudah support diff
- [ ] **Log** — syntax highlighting
- [ ] **Bat** — Monaco vs/basic-languages/bat
- [ ] **Clojure** — Monaco vs/basic-languages/clojure
- [ ] **CoffeeScript** — Monaco vs/basic-languages/coffee
- [ ] **F#** — Monaco vs/basic-languages/fsharp
- [ ] **Groovy** — syntax highlighting
- [ ] **Handlebars** — Monaco vs/basic-languages/handlebars
- [ ] **HLSL** — syntax highlighting
- [ ] **Julia** — Monaco vs/basic-languages/julia
- [ ] **LaTeX** — syntax highlighting
- [ ] **Objective-C** — Monaco vs/basic-languages/objective-c
- [ ] **Pug/Jade** — Monaco vs/basic-languages/pug
- [ ] **Razor** — Monaco vs/basic-languages/razor
- [ ] **reStructuredText** — syntax highlighting
- [ ] **ShaderLab** — syntax highlighting
- [ ] **Visual Basic** — Monaco vs/basic-languages/vb
- [ ] **Dotenv** — syntax highlighting

### 16.2 Language Features (Language Servers)
- [ ] **HTML Language Features** — Monaco html worker sudah dimuat
- [ ] **CSS Language Features** — Monaco css worker sudah dimuat
- [ ] **JSON Language Features** — Monaco json worker sudah dimuat
- [ ] **TypeScript Language Features** — Monaco ts worker sudah dimuat
- [ ] **PHP Language Features** — basic IntelliSense
- [ ] **Markdown Language Features** — markdown_preview.py sudah ada
- [ ] **Emmet** — emmet.py sudah ada

### 16.3 Built-in Extensions
- [ ] **Git Extension** — git/bridge.py sudah ada
- [ ] **Git Base** — base git functionality
- [ ] **GitHub Extension** — GitHub integration
- [ ] **GitHub Authentication** — GitHub OAuth flow
- [ ] **Microsoft Authentication** — Microsoft account auth
- [ ] **NPM Extension** — npm script runner
- [ ] **Grunt/Gulp/Jake** — task auto-detection
- [ ] **Configuration Editing** — settings.json IntelliSense
- [ ] **Extension Editing** — extension development support
- [ ] **References View** — find all references panel
- [ ] **Search Result** — search result syntax highlighting
- [ ] **Simple Browser** — browser_widget.py sudah ada
- [ ] **Media Preview** — image_viewer.py sudah ada
- [ ] **Merge Conflict** — merge conflict decorations & actions
- [ ] **Tunnel Forwarding** — port forwarding
- [ ] **Debug Auto Launch** — auto-attach debugger
- [ ] **Debug Server Ready** — detect server start & open browser
- [ ] **Notebook Renderers** — notebook output renderers
- [ ] **IPython Notebook** — .ipynb file support
- [ ] **Markdown Math** — LaTeX math in markdown
- [ ] **Mermaid Markdown** — Mermaid diagrams in markdown
- [ ] **Terminal Suggest** — terminal command suggestions
- [ ] **Prompt Basics** — prompt file format support

---

## 17. NOTEBOOK (vs/workbench/contrib/notebook/)

### 17.1 Notebook Features
- [ ] **Notebook Editor** — notebooks/editor.py sudah ada (basic)
- [ ] **Notebook Cells** — code cells & markdown cells (basic ada)
- [ ] **Cell Execution** — run individual cells with kernel
- [ ] **Cell Output** — rich output (text, HTML, images)
- [ ] **Cell Toolbar** — per-cell action toolbar
- [ ] **Cell Drag & Drop** — reorder cells
- [ ] **Cell Selection** — multi-cell selection
- [ ] **Notebook Kernel** — kernel_client.py sudah ada (basic)
- [ ] **Notebook Serialization** — save/load .ipynb format
- [ ] **Notebook Diff** — diff view for notebooks
- [ ] **Notebook Find** — find across cells
- [ ] **Interactive Window** — REPL-style interactive window

---

## 18. TASKS (vs/workbench/contrib/tasks/)

### 18.1 Task System
- [ ] **tasks.json** — task configuration file
- [ ] **Task Auto-Detection** — detect npm, gulp, grunt tasks
- [ ] **Task Runner** — task_manager.py sudah ada
- [ ] **Task Monitoring** — task start/end notifications
- [ ] **Problem Matchers** — problem_matcher.py sudah ada
- [ ] **Task Groups** — build, test task groups
- [ ] **Run Build Task** — Ctrl+Shift+B
- [ ] **Run Task** — task picker quick access
- [ ] **Background Tasks** — long-running background task support
- [ ] **Task Terminal Status** — task status indicators
- [ ] **Compound Tasks** — run multiple tasks
- [ ] **Task Variables** — `${workspaceFolder}` variable substitution

---

## 19. TESTING (vs/workbench/contrib/testing/)

### 19.1 Testing Features
- [ ] **Test Explorer** — testing/panel.py sudah ada (basic)
- [ ] **Run Tests** — run individual / all tests
- [ ] **Debug Tests** — debug individual tests
- [ ] **Test Results** — pass/fail/skip indicators
- [ ] **Test Coverage** — code coverage visualization
- [ ] **Inline Test Results** — inline markers in gutter
- [ ] **Test Output** — test output panel
- [ ] **Test Profiles** — test run profiles
- [ ] **Continuous Test Run** — auto-run tests on change

---

## 20. OUTPUT PANEL (vs/workbench/contrib/output/)

### 20.1 Output Features
- [ ] **Output Channels** — output_panel.py sudah ada
- [ ] **Output Channel Dropdown** — dropdown select channel sudah ada
- [ ] **Clear Output** — clear output sudah ada
- [ ] **Output Scrolling** — auto-scroll sudah ada
- [ ] **Output Link Provider** — clickable links in output
- [ ] **Output Syntax Highlighting** — log/output syntax highlighting

---

## 21. PROBLEMS PANEL (vs/workbench/contrib/markers/)

### 21.1 Problems View
- [ ] **Problems List** — problems_panel.py sudah ada
- [ ] **Problems Filtering** — filter by type, source, text
- [ ] **Problems Grouping** — group by file, type, severity
- [ ] **Problems Table View** — table mode view
- [ ] **Problems Tree View** — tree mode sudah ada
- [ ] **Problems Actions** — click to navigate sudah ada
- [ ] **Problems Status Bar** — error/warning count di status bar sudah ada
- [ ] **File Decorations** — error/warning badges on files
- [ ] **Problems Quick Fix** — quick fix actions

---

## 22. BREADCRUMBS (vs/workbench/browser/parts/editor/breadcrumbs*)

### 22.1 Breadcrumbs Bar
- [ ] **File Path Breadcrumbs** — breadcrumbs.py sudah ada
- [ ] **Symbol Breadcrumbs** — symbol breadcrumbs sudah ada
- [ ] **Breadcrumb Navigation** — click breadcrumb navigate sudah ada
- [ ] **Breadcrumb Dropdown** — dropdown picker sudah ada
- [ ] **Breadcrumb Keyboard Nav** — Ctrl+Shift+; to focus breadcrumbs

---

## 23. MINIMAP

### 23.1 Minimap Features
- [ ] **Code Minimap** — `minimap: { enabled: true }` sudah aktif
- [ ] **Minimap Slider** — `showSlider: 'mouseover'` sudah aktif
- [ ] **Minimap Highlighting** — bawaan Monaco
- [ ] **Minimap Git Decorations** — show git changes di minimap
- [ ] **Minimap Scale** — configurable minimap scale
- [ ] **Minimap Position** — `side: 'right'` sudah dikonfigurasi
- [ ] **Minimap Render** — `renderCharacters: true` sudah aktif

---

## 24. COMMENTS (vs/workbench/contrib/comments/)

### 24.1 Comments System
- [ ] **Comment Threads** — inline comment threads
- [ ] **Comment Widget** — comment input/reply widget
- [ ] **Comment Ranges** — range-based comments
- [ ] **Comment Navigation** — navigate between comments
- [ ] **Comment Panel** — dedicated comments panel

---

## 25. TIMELINE (vs/workbench/contrib/timeline/)

### 25.1 Timeline Features
- [ ] **File Timeline** — timeline_panel.py sudah ada
- [ ] **Git History** — git commit history sudah ada
- [ ] **Local History** — local edit history per file
- [ ] **Timeline Filtering** — filter by source
- [ ] **Timeline Actions** — compare, restore from timeline

---

## 26. LOCAL HISTORY (vs/workbench/contrib/localHistory/)

### 26.1 Local History Features
- [ ] **Auto Save History** — automatically save file versions locally
- [ ] **History Browser** — browse saved versions
- [ ] **Compare with History** — diff current vs historical
- [ ] **Restore from History** — restore file to previous version
- [ ] **History Storage** — persistent local storage

---

## 27. SNIPPETS (vs/workbench/contrib/snippets/)

### 27.1 Snippet System
- [ ] **Built-in Snippets** — snippet_manager.py sudah ada
- [ ] **User Snippets** — user-defined snippet files
- [ ] **Workspace Snippets** — workspace-scoped snippets
- [ ] **Snippet Syntax** — tabstops, placeholders (InsertAsSnippet) sudah ada
- [ ] **Snippet Completion** — snippet items di autocomplete sudah ada via bridge.py
- [ ] **Insert Snippet Command** — dedicated insert snippet picker
- [ ] **Snippet Scope** — language-scoped and global snippets

---

## 28. EMMET (extensions/emmet/)

### 28.1 Emmet Features
- [ ] **Emmet Expand** — emmet.py sudah ada
- [ ] **Emmet Wrap** — wrap with abbreviation sudah ada
- [ ] **Emmet Balance** — balance inward/outward
- [ ] **Emmet Remove Tag** — remove enclosing tag
- [ ] **Emmet Update Tag** — update tag name
- [ ] **Emmet Math** — evaluate math expression
- [ ] **Emmet Reflect CSS** — reflect CSS value updates
- [ ] **Emmet Config** — custom emmet snippets & configuration

---

## 29. INLINE CHAT (vs/workbench/contrib/inlineChat/)

### 29.1 Inline Chat Features
- [ ] **Inline Chat Widget** — Ctrl+I inline chat in editor
- [ ] **Inline Code Generation** — generate code inline
- [ ] **Inline Code Edit** — edit selected code with AI
- [ ] **Accept/Reject** — accept or reject inline changes
- [ ] **Diff Preview** — inline diff showing proposed changes

---

## 30. CHAT PANEL (vs/workbench/contrib/chat/)

### 30.1 Chat Features
- [ ] **Chat Input** — dardcor_agent/chat/panel.py sudah ada
- [ ] **Chat History** — conversation history sudah ada
- [ ] **Chat Participants** — @workspace, @terminal, dll
- [ ] **Chat Variables** — #file, #selection, #editor context
- [ ] **Chat Code Blocks** — syntax-highlighted code sudah ada
- [ ] **Chat Actions** — copy code, insert at cursor sudah ada
- [ ] **Chat Models** — model selection sudah ada
- [ ] **Chat Slash Commands** — /fix, /explain, /tests, dll
- [ ] **Chat Attachments** — attach files/images to chat
- [ ] **Chat Edit Mode** — edit mode for multi-file changes

---

## 31. STORAGE & PERSISTENCE

### 31.1 Local Storage
- [ ] **Window State** — save/restore window size/position sudah ada di config.py
- [ ] **Open Files State** — save/restore open editor tabs sudah ada
- [ ] **Explorer State** — save/restore expanded folders
- [ ] **Recently Opened** — MRU file/folder list sudah ada
- [ ] **Workspace Storage** — per-workspace storage
- [ ] **Global Storage** — config.py global storage sudah ada
- [ ] **Memento Storage** — view state mementos
- [ ] **Backups** — unsaved file backup/recovery
- [ ] **Hot Exit** — save dirty files state on exit
- [ ] **Editor History** — navigation back/forward history
- [ ] **Search History** — persist search terms
- [ ] **Terminal History** — persist terminal command history
- [ ] **Settings Migration** — migrate settings between versions
- [ ] **Extension Storage** — per-extension persistent storage

---

## 32. ICONS & VISUAL ASSETS

### 32.1 Codicon Icon Set
- [ ] **Codicon Font** — full Codicon icon font (~500+ icons)
- [ ] **Activity Bar Icons** — Explorer, Search, Git, Debug, Extensions sudah ada
- [ ] **Editor Icons** — close, dirty indicator sudah ada
- [ ] **Status Bar Icons** — git branch, error, warning sudah ada
- [ ] **Tree View Icons** — file/folder icons, chevrons sudah ada
- [ ] **Context Menu Icons** — icons di context menu items
- [ ] **Debug Icons** — play, step, stop sudah ada
- [ ] **Notification Icons** — info, warning, error sudah ada
- [ ] **Terminal Icons** — plus, split sudah ada
- [ ] **Search Icons** — regex, case, whole word toggles sudah ada
- [ ] **Settings Icons** — gear, edit, reset icons
- [ ] **File Icon Theme (Seti)** — icon_theme_manager.py sudah ada
- [ ] **Product Icons** — all product-specific icons

### 32.2 SVG Assets
- [ ] **Welcome Page Icons** — getting started icons
- [ ] **Walkthrough Icons** — onboarding illustrations
- [ ] **Empty State Icons** — no results, empty folder illustrations

---

## 33. KEYBOARD SHORTCUTS

### 33.1 All Default Keybindings
- [ ] **File Operations** — Ctrl+N, Ctrl+O, Ctrl+S sudah ada
- [ ] **Edit Operations** — Ctrl+Z, Ctrl+Y, Ctrl+X, Ctrl+C, Ctrl+V sudah ada
- [ ] **Selection** — Ctrl+D, Ctrl+Shift+L sudah ada via Monaco
- [ ] **Navigation** — Ctrl+G, Ctrl+P, F12 sudah ada
- [ ] **View Toggles** — Ctrl+B, Ctrl+J, Ctrl+Shift+E/F/G/D/X sudah ada
- [ ] **Multi-Cursor** — Alt+Click sudah aktif via Monaco
- [ ] **Editor Groups** — Ctrl+1/2/3, Ctrl+\ sudah ada
- [ ] **Terminal** — Ctrl+` sudah ada
- [ ] **Debug** — F5, F9, F10, F11 sudah ada
- [ ] **Fold/Unfold** — bawaan Monaco
- [ ] **Chord Keybindings** — Ctrl+K Ctrl+C dll
- [ ] **When Contexts** — keybinding context conditions
- [ ] **Keybinding Resolver** — proper conflict resolution

---

## 34. MENUS & CONTEXT MENUS

### 34.1 Menu Bar
- [ ] **File Menu** — New, Open, Save, Save As, Recent, Exit sudah ada
- [ ] **Edit Menu** — Undo, Redo, Cut, Copy, Paste, Find sudah ada
- [ ] **Selection Menu** — Select All, Expand/Shrink sudah ada
- [ ] **View Menu** — Command Palette, Appearance, Editor Layout sudah ada
- [ ] **Go Menu** — Go to File/Symbol/Line/Definition sudah ada
- [ ] **Run Menu** — Start Debugging, Run Without Debugging sudah ada
- [ ] **Terminal Menu** — New Terminal, Split Terminal sudah ada
- [ ] **Help Menu** — Welcome, About sudah ada

### 34.2 Context Menus
- [ ] **Editor Context Menu** — Cut, Copy, Paste, Format, Go to Definition sudah ada
- [ ] **Editor Title Context Menu** — Close, Close Others sudah ada
- [ ] **Tab Context Menu** — Close, Copy Path sudah ada
- [ ] **Explorer Context Menu** — New File, Rename, Delete, Copy Path sudah ada
- [ ] **Terminal Context Menu** — Copy, Paste sudah ada
- [ ] **Status Bar Context Menu** — toggle individual status items

---

## 35. ACCESSIBILITY

### 35.1 Accessibility Features
- [ ] **Screen Reader Support** — ARIA labels, live regions
- [ ] **Accessibility Help Dialog** — Alt+F1
- [ ] **Tab Focus Mode** — tab key moves focus
- [ ] **High Contrast Themes** — high contrast dark/light
- [ ] **Keyboard Navigation** — full keyboard-only navigation
- [ ] **Zoom Level** — Ctrl+= / Ctrl+- sudah ada di menu
- [ ] **Accessible View** — accessible alternatives

---

## 36. WELCOME & ONBOARDING

### 36.1 Welcome Experience
- [ ] **Welcome Tab** — welcome tab sudah ada (dardcor-welcome extension)
- [ ] **Getting Started** — interactive getting started walkthrough
- [ ] **Release Notes** — what's new page
- [ ] **Tips & Tricks** — productivity tips
- [ ] **Interactive Playground** — learn editor features
- [ ] **Walkthrough** — step-by-step walkthroughs

---

## 37. WORKSPACES

### 37.1 Workspace Features
- [ ] **Multi-Root Workspaces** — multi_root.py sudah ada
- [ ] **Workspace Trust** — workspace_trust.py sudah ada
- [ ] **Workspace Settings** — `.vscode/settings.json`
- [ ] **Workspace Recommendations** — `.vscode/extensions.json`
- [ ] **Workspace Launch Configs** — launch_config.py sudah ada
- [ ] **Workspace Tasks** — `.vscode/tasks.json`
- [ ] **Workspace Folders** — add/remove workspace folders
- [ ] **Workspace Storage** — persistent per-workspace state

---

## 38. REMOTE DEVELOPMENT

### 38.1 Remote Features
- [ ] **Remote SSH** — ssh_connection.py + ssh_manager.py sudah ada
- [ ] **Remote Containers** — container_manager.py sudah ada
- [ ] **Remote Tunnels** — remote tunnel connections
- [ ] **Port Forwarding** — ports_panel.py sudah ada
- [ ] **Remote Explorer** — view remote targets
- [ ] **Remote Status** — remote connection status indicator

---

## 39. USER DATA SYNC

### 39.1 Settings Sync
- [ ] **Sync Settings** — settings_sync.py sudah ada (basic)
- [ ] **Sync Keybindings** — sync keybindings
- [ ] **Sync Extensions** — sync installed extensions
- [ ] **Sync UI State** — sync UI state
- [ ] **Sync Snippets** — sync user snippets
- [ ] **Sync Tasks** — sync user tasks
- [ ] **Sync Profiles** — sync user profiles
- [ ] **Conflict Resolution** — merge conflicts in sync

---

## 40. USER DATA PROFILES

### 40.1 Profile Features
- [ ] **Create Profile** — create named settings profile
- [ ] **Switch Profile** — switch between profiles
- [ ] **Export/Import Profile** — share profiles
- [ ] **Default Profile** — default profile management
- [ ] **Profile Contents** — settings, keybindings per profile

---

## 41. UPDATE SYSTEM

### 41.1 Update Features
- [ ] **Auto Update Check** — check for updates on startup
- [ ] **Update Notification** — notification when update available
- [ ] **Download & Install** — download and install update
- [ ] **Release Notes** — show release notes
- [ ] **Update Settings** — configure update channel

---

## 42. TELEMETRY & DIAGNOSTICS

### 42.1 Telemetry
- [ ] **Crash Reporter** — crash_reporter.py sudah ada
- [ ] **Usage Telemetry** — telemetry.py sudah ada
- [ ] **Startup Performance** — startup time tracking
- [ ] **Process Explorer** — view running processes
- [ ] **Developer Tools** — open DevTools

---

## 43. WEBVIEW (vs/workbench/contrib/webview/)

### 43.1 Webview Features
- [ ] **Webview Panel** — webview/panel.py sudah ada
- [ ] **Webview Editor** — webview-based custom editors
- [ ] **Webview Messaging** — message_router.py sudah ada
- [ ] **Webview Persistence** — persist webview state
- [ ] **Webview Serialization** — serialize/restore on reload
- [ ] **Webview Security** — CSP, script sandboxing

---

## 44. OUTLINE VIEW

### 44.1 Outline Features
- [ ] **Symbol Outline** — outline_panel.py sudah ada
- [ ] **Outline Sorting** — sort by name, position, type
- [ ] **Outline Filtering** — filter by symbol kind
- [ ] **Outline Following** — follow cursor sudah ada
- [ ] **Outline Navigation** — click to navigate sudah ada

---

## 45. LANGUAGE DETECTION

### 45.1 Language Detection
- [ ] **Auto Language Detection** — language.py detect_language sudah ada
- [ ] **Language Override** — change language mode sudah ada
- [ ] **File Extension Mapping** — LANGUAGE_MAP sudah ada di language.py
- [ ] **First Line Detection** — detect language from shebang

---

## 46. FOLDING (vs/workbench/contrib/folding/)

### 46.1 Folding Features
- [ ] **Syntax Folding** — `folding: true` via Monaco
- [ ] **Region Folding** — `#region` support via Monaco
- [ ] **Folding Ranges** — bawaan Monaco
- [ ] **Fold All / Unfold All** — bawaan Monaco
- [ ] **Fold Level** — bawaan Monaco
- [ ] **Fold Indicator** — `showFoldingControls: 'mouseover'` via Monaco

---

## 47. MERGE EDITOR (vs/workbench/contrib/mergeEditor/)

### 47.1 Merge Editor
- [ ] **3-Way Merge Editor** — visual 3-way merge
- [ ] **Accept Incoming / Current** — accept changes per conflict
- [ ] **Accept Both** — accept both changes
- [ ] **Result Preview** — live preview of merged result
- [ ] **Conflict Navigation** — navigate between conflicts

---

## 48. MULTI-DIFF EDITOR (vs/workbench/contrib/multiDiffEditor/)

### 48.1 Multi-Diff Editor
- [ ] **Multi-File Diff View** — view diffs across multiple files
- [ ] **Scrollable Diff List** — scroll through all file diffs
- [ ] **Diff Actions** — accept/reject per file

---

## 49. IMAGE HANDLING

### 49.1 Image Preview
- [ ] **Image Viewer** — image_viewer.py sudah ada (PNG, JPEG, GIF, SVG)
- [ ] **Image Zoom** — zoom in/out sudah ada
- [ ] **Image Info** — show image dimensions sudah ada
- [ ] **Image Transparency Grid** — checkerboard background

---

## 50. MISCELLANEOUS FEATURES

### 50.1 Miscellaneous
- [ ] **Screencast Mode** — screencast_mode.py sudah ada
- [ ] **Scroll Locking** — lock scroll across splits
- [ ] **Language Status** — language server status indicator
- [ ] **Limit Indicator** — token/request limit indicators
- [ ] **Splash Screen** — loading splash screen
- [ ] **Style Overrides** — CSS style override contributions
- [ ] **Onboarding** — first-time onboarding flow
- [ ] **Welcome Banner** — information banner
- [ ] **URL Handler** — handle `vscode://` protocol URLs
- [ ] **Share** — share extension for share actions
- [ ] **Surveys** — user survey prompts
- [ ] **Tags** — workspace tags

---

## PROGRESS SUMMARY

| Kategori | Total Items | Selesai (✓) | Belum (○) |
|---|---|---|---|
| 1. Editor Features | 60 | 43 | 17 |
| 2. File Explorer | 22 | 13 | 9 |
| 3. Search | 22 | 13 | 9 |
| 4. Source Control/Git | 20 | 10 | 10 |
| 5. Debug | 24 | 7 | 17 |
| 6. Terminal | 24 | 14 | 10 |
| 7. Extensions | 16 | 5 | 11 |
| 8. Notifications | 8 | 2 | 6 |
| 9. Status Bar | 9 | 6 | 3 |
| 10. Title Bar | 7 | 4 | 3 |
| 11. Activity Bar | 7 | 4 | 3 |
| 12. Layout | 12 | 7 | 5 |
| 13. Command Palette | 7 | 5 | 2 |
| 14. Settings | 17 | 7 | 10 |
| 15. Themes | 9 | 3 | 6 |
| 16. Language Support | 57 | 41 | 16 |
| 17. Notebook | 12 | 2 | 10 |
| 18. Tasks | 12 | 2 | 10 |
| 19. Testing | 9 | 1 | 8 |
| 20. Output Panel | 6 | 4 | 2 |
| 21. Problems Panel | 9 | 4 | 5 |
| 22. Breadcrumbs | 5 | 4 | 1 |
| 23. Minimap | 7 | 5 | 2 |
| 24. Comments | 5 | 0 | 5 |
| 25. Timeline | 5 | 2 | 3 |
| 26. Local History | 5 | 0 | 5 |
| 27. Snippets | 7 | 3 | 4 |
| 28. Emmet | 8 | 2 | 6 |
| 29. Inline Chat | 5 | 0 | 5 |
| 30. Chat Panel | 10 | 5 | 5 |
| 31. Storage | 14 | 4 | 10 |
| 32. Icons | 16 | 9 | 7 |
| 33. Keyboard Shortcuts | 13 | 10 | 3 |
| 34. Menus | 14 | 13 | 1 |
| 35. Accessibility | 7 | 1 | 6 |
| 36. Welcome | 6 | 1 | 5 |
| 37. Workspaces | 8 | 3 | 5 |
| 38. Remote | 6 | 3 | 3 |
| 39. User Data Sync | 8 | 1 | 7 |
| 40. User Profiles | 5 | 0 | 5 |
| 41. Update System | 5 | 0 | 5 |
| 42. Telemetry | 5 | 2 | 3 |
| 43. Webview | 6 | 2 | 4 |
| 44. Outline | 5 | 3 | 2 |
| 45. Language Detection | 4 | 3 | 1 |
| 46. Folding | 6 | 6 | 0 |
| 47. Merge Editor | 5 | 0 | 5 |
| 48. Multi-Diff Editor | 3 | 0 | 3 |
| 49. Image Handling | 4 | 3 | 1 |
| 50. Miscellaneous | 12 | 1 | 11 |
| **TOTAL** | **~650** | **~280** | **~370** |

> **Progress: ~0% complete** — 280 items sudah tersedia, 370 items masih perlu dikerjakan.

---

*Dokumen ini akan terus diperbarui seiring pengerjaan task.*
