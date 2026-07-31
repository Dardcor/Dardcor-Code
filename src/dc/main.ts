declare const monaco: typeof import('monaco-editor');
declare const nodeRequire: any;

const { ipcRenderer } = nodeRequire('electron');
const { Terminal } = nodeRequire('@xterm/xterm');
const { FitAddon } = nodeRequire('@xterm/addon-fit');
const path = nodeRequire('path');

const EXT_TO_LANG: Record<string, string> = {
	'.ts': 'typescript', '.tsx': 'typescriptreact',
	'.js': 'javascript', '.jsx': 'javascriptreact',
	'.json': 'json', '.html': 'html', '.htm': 'html',
	'.css': 'css', '.scss': 'scss', '.less': 'less',
	'.md': 'markdown', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
	'.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
	'.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'cpp',
	'.cs': 'csharp', '.php': 'php', '.swift': 'swift',
	'.sh': 'shell', '.bash': 'shell', '.bat': 'bat', '.ps1': 'powershell',
	'.sql': 'sql', '.graphql': 'graphql',
	'.txt': 'plaintext', '.log': 'plaintext',
	'.gitignore': 'plaintext', '.env': 'plaintext',
};

function detectLanguage(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const base = path.basename(filePath).toLowerCase();
	if (base === 'dockerfile') return 'dockerfile';
	if (base === 'makefile') return 'makefile';
	return EXT_TO_LANG[ext] || 'plaintext';
}

function getFileIcon(name: string, isDir: boolean): string {
	if (isDir) return '📁';
	const ext = path.extname(name).toLowerCase();
	switch (ext) {
		case '.ts': case '.tsx': return '🟦';
		case '.js': case '.jsx': return '🟨';
		case '.json': return '⚙️';
		case '.html': case '.htm': return '🌐';
		case '.css': case '.scss': case '.less': return '🎨';
		case '.md': return '📝';
		case '.py': return '🐍';
		case '.rs': return '🦀';
		case '.go': return '🔵';
		case '.png': case '.jpg': case '.gif': case '.svg': return '🖼️';
		default: return '📄';
	}
}

// ─── Tab Manager ─────────────────────────────────────────────────

interface OpenTab {
	filePath: string;
	fileName: string;
	model: any; // monaco.editor.ITextModel
	modified: boolean;
	viewState: any; // monaco.editor.ICodeEditorViewState
}

const openTabs: OpenTab[] = [];
let activeTabIndex = -1;
let monacoEditor: any = null;

// ─── Monaco Editor Setup ─────────────────────────────────────────

function initMonacoEditor(): void {
	const editorArea = document.getElementById('editor-area')!;

	// Configure Monaco theme to match VS Code Dark+
	monaco.editor.defineTheme('dardcor-dark', {
		base: 'vs-dark',
		inherit: true,
		rules: [],
		colors: {
			'editor.background': '#1e1e1e',
			'editorLineNumber.foreground': '#858585',
			'editorLineNumber.activeForeground': '#c6c6c6',
			'editor.selectionBackground': '#264f78',
			'editor.lineHighlightBackground': '#2a2d2e',
			'editorCursor.foreground': '#aeafad',
			'editorWhitespace.foreground': '#3b3b3b',
		}
	});

	monacoEditor = monaco.editor.create(editorArea, {
		theme: 'dardcor-dark',
		fontSize: 14,
		fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
		fontLigatures: true,
		minimap: { enabled: true },
		scrollBeyondLastLine: true,
		smoothScrolling: true,
		cursorSmoothCaretAnimation: 'on',
		cursorBlinking: 'smooth',
		renderWhitespace: 'selection',
		automaticLayout: true,
		bracketPairColorization: { enabled: true },
		guides: { bracketPairs: true, indentation: true },
		padding: { top: 10 },
		suggest: { showIcons: true, showMethods: true },
		wordWrap: 'off',
		lineNumbers: 'on',
		glyphMargin: true,
		folding: true,
		links: true,
		tabSize: 4,
		insertSpaces: false,
	});

	// Update status bar on cursor change
	monacoEditor.onDidChangeCursorPosition((e: any) => {
		const pos = e.position;
		document.getElementById('status-cursor')!.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
	});

	// Track modifications
	monacoEditor.onDidChangeModelContent(() => {
		if (activeTabIndex >= 0 && openTabs[activeTabIndex]) {
			const tab = openTabs[activeTabIndex];
			tab.modified = true;
			renderTabs();
		}
	});

	// Keyboard shortcuts
	monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
		saveCurrentFile();
	});

	// Hide welcome screen initially (shown when no tabs)
	updateWelcomeScreen();
}

// ─── Tab Rendering ───────────────────────────────────────────────

function renderTabs(): void {
	const tabsContainer = document.getElementById('editor-tabs')!;
	tabsContainer.innerHTML = '';

	openTabs.forEach((tab, index) => {
		const tabEl = document.createElement('div');
		tabEl.className = 'editor-tab' + (index === activeTabIndex ? ' active' : '') + (tab.modified ? ' modified' : '');
		tabEl.innerHTML = `
			<span style="font-size:12px;">${getFileIcon(tab.fileName, false)}</span>
			<span>${tab.fileName}</span>
			<span class="tab-modified"></span>
			<span class="tab-close">✕</span>
		`;

		tabEl.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).classList.contains('tab-close')) {
				closeTab(index);
			} else {
				switchToTab(index);
			}
		});

		tabsContainer.appendChild(tabEl);
	});
}

function switchToTab(index: number): void {
	if (index < 0 || index >= openTabs.length) return;

	// Save current view state
	if (activeTabIndex >= 0 && openTabs[activeTabIndex]) {
		openTabs[activeTabIndex].viewState = monacoEditor.saveViewState();
	}

	activeTabIndex = index;
	const tab = openTabs[index];

	monacoEditor.setModel(tab.model);
	if (tab.viewState) {
		monacoEditor.restoreViewState(tab.viewState);
	}
	monacoEditor.focus();

	// Update status bar
	const lang = tab.model.getLanguageId?.() || 'plaintext';
	document.getElementById('status-language')!.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
	document.getElementById('title-filename')!.textContent = `🔍 ${tab.fileName} — Dardcor Code`;

	renderTabs();
	updateWelcomeScreen();

	// Highlight in file tree
	highlightFileInTree(tab.filePath);
}

function closeTab(index: number): void {
	const tab = openTabs[index];
	if (!tab) return;

	// TODO: prompt save if modified

	tab.model.dispose();
	openTabs.splice(index, 1);

	if (openTabs.length === 0) {
		activeTabIndex = -1;
		monacoEditor.setModel(null);
		document.getElementById('title-filename')!.textContent = '🔍 Dardcor-Code-New';
		document.getElementById('status-language')!.textContent = 'Plain Text';
		document.getElementById('status-cursor')!.textContent = 'Ln 1, Col 1';
	} else {
		activeTabIndex = Math.min(index, openTabs.length - 1);
		switchToTab(activeTabIndex);
	}

	renderTabs();
	updateWelcomeScreen();
}

function updateWelcomeScreen(): void {
	const welcome = document.getElementById('welcome-screen');
	if (!welcome) return;
	welcome.style.display = openTabs.length === 0 ? 'flex' : 'none';
	if (monacoEditor) {
		(monacoEditor.getDomNode() as HTMLElement).style.display = openTabs.length === 0 ? 'none' : 'block';
	}
}

// ─── File Operations ─────────────────────────────────────────────

async function openFile(filePath: string): Promise<void> {
	// Check if already open
	const existingIndex = openTabs.findIndex(t => t.filePath === filePath);
	if (existingIndex >= 0) {
		switchToTab(existingIndex);
		return;
	}

	const result = await ipcRenderer.invoke('fs:readFile', filePath);
	if (result.error) {
		console.error('Failed to read file:', result.error);
		return;
	}

	const language = detectLanguage(filePath);
	const model = monaco.editor.createModel(result.content, language, monaco.Uri.file(filePath));

	const tab: OpenTab = {
		filePath,
		fileName: path.basename(filePath),
		model,
		modified: false,
		viewState: null
	};

	openTabs.push(tab);
	switchToTab(openTabs.length - 1);
}

async function saveCurrentFile(): Promise<void> {
	if (activeTabIndex < 0) return;
	const tab = openTabs[activeTabIndex];
	if (!tab) return;

	const content = tab.model.getValue();
	const result = await ipcRenderer.invoke('fs:writeFile', tab.filePath, content);
	if (result.error) {
		console.error('Failed to save:', result.error);
		return;
	}

	tab.modified = false;
	renderTabs();
}

// ─── File Tree ───────────────────────────────────────────────────

let currentRootPath: string | null = null;
const expandedFolders = new Set<string>();

async function loadFileTree(rootPath: string): Promise<void> {
	currentRootPath = rootPath;
	const treeEl = document.getElementById('file-tree')!;
	treeEl.innerHTML = '';

	const folderName = path.basename(rootPath);
	const rootItem = document.createElement('div');
	rootItem.className = 'tree-item';
	rootItem.style.fontWeight = '600';
	rootItem.style.paddingLeft = '8px';
	rootItem.innerHTML = `<span class="icon">📂</span><span class="name">${folderName.toUpperCase()}</span>`;
	treeEl.appendChild(rootItem);

	expandedFolders.add(rootPath);
	await renderDirectoryContents(rootPath, treeEl, 1);
}

async function renderDirectoryContents(dirPath: string, parentEl: HTMLElement, depth: number): Promise<void> {
	const result = await ipcRenderer.invoke('fs:readDir', dirPath);
	if (result.error || !Array.isArray(result)) return;

	for (const entry of result) {
		// Skip node_modules, dist, .git etc.
		if (['node_modules', 'dist', '.git', '.DS_Store'].includes(entry.name)) continue;

		const item = document.createElement('div');
		item.className = 'tree-item';
		item.style.paddingLeft = `${8 + depth * 16}px`;
		item.dataset.path = entry.path;
		item.dataset.isDir = String(entry.isDirectory);

		const icon = getFileIcon(entry.name, entry.isDirectory);
		item.innerHTML = `<span class="icon">${entry.isDirectory ? (expandedFolders.has(entry.path) ? '📂' : '📁') : icon}</span><span class="name">${entry.name}</span>`;

		item.addEventListener('click', async () => {
			if (entry.isDirectory) {
				if (expandedFolders.has(entry.path)) {
					// Collapse
					expandedFolders.delete(entry.path);
					// Remove children
					let next = item.nextElementSibling;
					const itemDepth = depth;
					while (next) {
						const nextPl = parseInt((next as HTMLElement).style.paddingLeft || '0');
						if (nextPl <= 8 + itemDepth * 16) break;
						const toRemove = next;
						next = next.nextElementSibling;
						toRemove.remove();
					}
					item.querySelector('.icon')!.textContent = '📁';
				} else {
					// Expand
					expandedFolders.add(entry.path);
					item.querySelector('.icon')!.textContent = '📂';
					// Create a temporary container, render into it, then insert after item
					const tempDiv = document.createElement('div');
					await renderDirectoryContents(entry.path, tempDiv, depth + 1);
					// Insert children after the clicked item
					let insertAfter: Element = item;
					for (const child of Array.from(tempDiv.children)) {
						insertAfter.after(child);
						insertAfter = child;
					}
				}
			} else {
				openFile(entry.path);
			}
		});

		parentEl.appendChild(item);

		// If already expanded, render contents
		if (entry.isDirectory && expandedFolders.has(entry.path)) {
			await renderDirectoryContents(entry.path, parentEl, depth + 1);
		}
	}
}

function highlightFileInTree(filePath: string): void {
	document.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
	const items = document.querySelectorAll('.tree-item[data-path]');
	items.forEach(item => {
		if ((item as HTMLElement).dataset.path === filePath) {
			item.classList.add('active');
		}
	});
}

// ─── Terminal Setup ──────────────────────────────────────────────

let terminal: any = null;
let fitAddon: any = null;
let terminalId: number | null = null;

async function initTerminal(): Promise<void> {
	const container = document.getElementById('terminal-container')!;

	terminal = new Terminal({
		theme: {
			background: '#1e1e1e',
			foreground: '#cccccc',
			cursor: '#aeafad',
			selectionBackground: '#264f78',
			black: '#000000',
			red: '#cd3131',
			green: '#0dbc79',
			yellow: '#e5e510',
			blue: '#2472c8',
			magenta: '#bc3fbc',
			cyan: '#11a8cd',
			white: '#e5e5e5',
			brightBlack: '#666666',
			brightRed: '#f14c4c',
			brightGreen: '#23d18b',
			brightYellow: '#f5f543',
			brightBlue: '#3b8eea',
			brightMagenta: '#d670d6',
			brightCyan: '#29b8db',
			brightWhite: '#e5e5e5',
		},
		fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
		fontSize: 13,
		cursorBlink: true,
		allowProposedApi: true,
	});

	fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.open(container);

	// Delay fit to ensure container is rendered
	setTimeout(() => {
		try { fitAddon.fit(); } catch { /* ignore */ }
	}, 100);

	// Create shell process
	const result = await ipcRenderer.invoke('terminal:create', currentRootPath || undefined);
	terminalId = result.id;

	// Receive data from shell
	ipcRenderer.on('terminal:data', (_event: any, payload: { id: number; data: string }) => {
		if (payload.id === terminalId) {
			terminal.write(payload.data);
		}
	});

	// Handle shell exit
	ipcRenderer.on('terminal:exit', (_event: any, payload: { id: number; code: number | null }) => {
		if (payload.id === terminalId) {
			terminal.write(`\r\n\x1b[90mProcess exited with code ${payload.code}\x1b[0m\r\n`);
			terminalId = null;
		}
	});

	// Send user input to shell
	terminal.onData((data: string) => {
		if (terminalId !== null) {
			ipcRenderer.send('terminal:write', { id: terminalId, data });
		}
	});

	// Resize handler
	window.addEventListener('resize', () => {
		try { fitAddon.fit(); } catch { /* ignore */ }
	});

	// Also refit when panel is resized
	const resizeObserver = new ResizeObserver(() => {
		try { fitAddon.fit(); } catch { /* ignore */ }
	});
	resizeObserver.observe(container);
}

// ─── Activity Bar ────────────────────────────────────────────────

function initActivityBar(): void {
	const icons = document.querySelectorAll('.activity-icon');
	icons.forEach(icon => {
		icon.addEventListener('click', () => {
			icons.forEach(i => i.classList.remove('active'));
			icon.classList.add('active');
		});
	});
}

// ─── Menu Actions ────────────────────────────────────────────────

function initMenuActions(): void {
	// File > Open File
	document.getElementById('menu-file')?.addEventListener('click', async () => {
		const filePath = await ipcRenderer.invoke('dialog:openFile');
		if (filePath) {
			openFile(filePath);
		}
	});

	// Open Folder (from menu or welcome screen)
	const openFolderAction = async () => {
		const folderPath = await ipcRenderer.invoke('dialog:openFolder');
		if (folderPath) {
			await loadFileTree(folderPath);
		}
	};

	document.getElementById('menu-view')?.addEventListener('click', openFolderAction);

	// Welcome screen buttons
	document.getElementById('btn-welcome-new-file')?.addEventListener('click', () => {
		const language = 'plaintext';
		const model = monaco.editor.createModel('', language);
		const tab: OpenTab = {
			filePath: 'Untitled-1',
			fileName: 'Untitled-1',
			model,
			modified: true,
			viewState: null
		};
		openTabs.push(tab);
		switchToTab(openTabs.length - 1);
	});

	document.getElementById('btn-welcome-open-file')?.addEventListener('click', async () => {
		const filePath = await ipcRenderer.invoke('dialog:openFile');
		if (filePath) {
			openFile(filePath);
		}
	});

	document.getElementById('btn-welcome-open-folder')?.addEventListener('click', openFolderAction);

	// Ctrl+O = Open File, Ctrl+K Ctrl+O = Open Folder
	document.addEventListener('keydown', async (e) => {
		if (e.ctrlKey && e.key === 'o' && !e.shiftKey) {
			e.preventDefault();
			const filePath = await ipcRenderer.invoke('dialog:openFile');
			if (filePath) openFile(filePath);
		}
	});
}

// ─── Panel Resize (Drag) ────────────────────────────────────────

function initPanelResize(): void {
	const panel = document.getElementById('panel')!;
	const borderEl = panel.querySelector('#panel-tabs') as HTMLElement;
	if (!borderEl) return;

	let dragging = false;
	let startY = 0;
	let startH = 0;

	// Use the top border of the panel as the drag handle
	panel.style.position = 'relative';
	const handle = document.createElement('div');
	handle.style.cssText = 'position:absolute;top:-3px;left:0;right:0;height:6px;cursor:ns-resize;z-index:10;';
	panel.prepend(handle);

	handle.addEventListener('mousedown', (e: MouseEvent) => {
		dragging = true;
		startY = e.clientY;
		startH = panel.offsetHeight;
		document.body.style.cursor = 'ns-resize';
		e.preventDefault();
	});

	document.addEventListener('mousemove', (e: MouseEvent) => {
		if (!dragging) return;
		const delta = startY - e.clientY;
		const newH = Math.max(80, Math.min(600, startH + delta));
		panel.style.height = newH + 'px';
		try { fitAddon?.fit(); } catch { /* ignore */ }
	});

	document.addEventListener('mouseup', () => {
		if (dragging) {
			dragging = false;
			document.body.style.cursor = '';
			try { fitAddon?.fit(); } catch { /* ignore */ }
		}
	});
}

// ─── Bootstrap ───────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
	initMonacoEditor();
	initActivityBar();
	initMenuActions();
	initPanelResize();
	await initTerminal();

	// Load project root as file tree
	const appPath = await ipcRenderer.invoke('app:getPath');
	if (appPath) {
		await loadFileTree(appPath);
	}
}

// Run when DOM is ready (it should already be ready since Monaco loaded first)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => bootstrap());
} else {
	bootstrap();
}
