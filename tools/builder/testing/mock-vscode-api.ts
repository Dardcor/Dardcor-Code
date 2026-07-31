/**
 * Dardcor Code - Standard VS Code API Mocks for Extension Unit Tests (Task 931)
 *
 * In-memory mock of the `vscode` namespace used to unit test extensions
 * without a running editor: Uri/Position/Range/Selection, Disposable,
 * EventEmitter, window (notifications, output channels, editors), workspace
 * (in-memory file system, configuration, folders), commands, languages,
 * and env. All state is fully controllable from tests.
 */

export interface PositionLike {
	readonly line: number;
	readonly character: number;
}

export class Position implements PositionLike {
	constructor(readonly line: number, readonly character: number) {}

	isBefore(other: Position): boolean {
		return this.line < other.line || (this.line === other.line && this.character < other.character);
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.isBefore(other) || this.isEqual(other);
	}

	isEqual(other: Position): boolean {
		return this.line === other.line && this.character === other.character;
	}

	translate(lineDelta: number, characterDelta = 0): Position {
		return new Position(this.line + lineDelta, this.character + characterDelta);
	}

	compareTo(other: Position): number {
		return this.line - other.line || this.character - other.character;
	}
}

export class Range {
	constructor(
		readonly start: PositionLike,
		readonly end: PositionLike
	) {}

	get isEmpty(): boolean {
		return this.start.line === this.end.line && this.start.character === this.end.character;
	}

	get isSingleLine(): boolean {
		return this.start.line === this.end.line;
	}

	contains(position: PositionLike): boolean {
		if (position.line < this.start.line || position.line > this.end.line) return false;
		if (position.line === this.start.line && position.character < this.start.character) return false;
		if (position.line === this.end.line && position.character > this.end.character) return false;
		return true;
	}

	isEqual(other: Range): boolean {
		return this.start.line === other.start.line && this.start.character === other.start.character &&
			this.end.line === other.end.line && this.end.character === other.end.character;
	}
}

export class Selection extends Range {
	constructor(
		readonly anchor: PositionLike,
		readonly active: PositionLike
	) {
		super(anchor, active);
	}

	get isReversed(): boolean {
		return this.active.line < this.anchor.line || (this.active.line === this.anchor.line && this.active.character < this.anchor.character);
	}
}

export class Disposable {
	static from(...disposables: { dispose(): void }[]): Disposable {
		return new Disposable(() => { for (const d of disposables) d.dispose(); });
	}

	constructor(private readonly _fn?: () => void) {}

	dispose(): void {
		this._fn?.();
	}
}

export class EventEmitter<T> {
	private readonly _listeners = new Set<(e: T) => void>();

	get event(): (listener: (e: T) => void) => Disposable {
		return listener => {
			this._listeners.add(listener);
			return new Disposable(() => this._listeners.delete(listener));
		};
	}

	fire(data: T): void {
		for (const listener of [...this._listeners]) listener(data);
	}

	dispose(): void {
		this._listeners.clear();
	}
}

export class Uri {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;

	constructor(parts: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }) {
		this.scheme = parts.scheme ?? '';
		this.authority = parts.authority ?? '';
		this.path = parts.path ?? '';
		this.query = parts.query ?? '';
		this.fragment = parts.fragment ?? '';
	}

	static file(filePath: string): Uri {
		return new Uri({ scheme: 'file', path: filePath.replace(/\\/g, '/') });
	}

	static parse(value: string): Uri {
		const match = /^([^:/?#]+):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
		if (!match) return new Uri({ path: value });
		return new Uri({ scheme: match[1], authority: match[2], path: match[3] || '/', query: match[4], fragment: match[5] });
	}

	static from(parts: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
		return new Uri(parts);
	}

	toString(): string {
		let out = `${this.scheme}:`;
		if (this.authority || this.scheme === 'file') out += `//${this.authority}`;
		out += this.path;
		if (this.query) out += `?${this.query}`;
		if (this.fragment) out += `#${this.fragment}`;
		return out;
	}

	get fsPath(): string {
		return this.path.replace(/\//g, '\\');
	}

	with(change: { scheme?: string; path?: string }): Uri {
		return new Uri({ scheme: change.scheme ?? this.scheme, authority: this.authority, path: change.path ?? this.path, query: this.query, fragment: this.fragment });
	}
}

interface FileNode {
	type: 'file' | 'directory';
	content: string;
	children: Map<string, FileNode>;
}

function normalizePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

export class MockWorkspaceFileSystem {
	private readonly _root: FileNode = { type: 'directory', content: '', children: new Map() };

	constructor(initial?: Record<string, string>) {
		if (initial) {
			for (const [filePath, content] of Object.entries(initial)) {
				this.writeFile(filePath, content);
			}
		}
	}

	writeFile(filePath: string, content: string): void {
		const parts = normalizePath(filePath).split('/');
		let node = this._root;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!node.children.has(parts[i])) {
				node.children.set(parts[i], { type: 'directory', content: '', children: new Map() });
			}
			node = node.children.get(parts[i])!;
		}
		node.children.set(parts[parts.length - 1], { type: 'file', content, children: new Map() });
	}

	readFile(filePath: string): string {
		let node = this._root;
		for (const part of normalizePath(filePath).split('/')) {
			node = node.children.get(part)!;
		}
		if (node.type !== 'file') throw new Error(`not a file: ${filePath}`);
		return node.content;
	}

	readDirectory(dirPath: string): Array<[string, string]> {
		let node = this._root;
		for (const part of normalizePath(dirPath).split('/')) {
			if (part === '') continue;
			node = node.children.get(part)!;
		}
		return [...node.children.entries()].map(([name, child]) => [name, child.type === 'directory' ? 'Directory' : 'File']);
	}

	exists(filePath: string): boolean {
		let node: FileNode | undefined = this._root;
		for (const part of normalizePath(filePath).split('/')) {
			node = node.children.get(part);
			if (!node) return false;
		}
		return true;
	}

	delete(filePath: string): void {
		const parts = normalizePath(filePath).split('/');
		let node = this._root;
		for (let i = 0; i < parts.length - 1; i++) {
			node = node.children.get(parts[i]) ?? node;
		}
		node.children.delete(parts[parts.length - 1]);
	}
}

export interface MockConfiguration {
	readonly [key: string]: unknown;
}

export class MockTextDocument {
	private _version = 1;

	constructor(readonly uri: Uri, private _content: string) {}

	get fileName(): string {
		return this.uri.path.split('/').pop() ?? '';
	}

	get lineCount(): number {
		return this._content.split('\n').length;
	}

	get version(): number {
		return this._version;
	}

	getText(): string {
		return this._content;
	}

	lineAt(line: number): { lineNumber: number; text: string } {
		const lines = this._content.split('\n');
		return { lineNumber: line, text: lines[line] ?? '' };
	}

	setContent(content: string): void {
		this._content = content;
		this._version++;
	}
}

export interface MockEditor {
	readonly document: MockTextDocument;
	readonly selection: Selection;
	readonly selections: Selection[];
	edit(fn: (builder: { replace(range: Range, text: string): void; insert(position: PositionLike, text: string): void }) => void): Promise<boolean>;
}

class MockEditBuilder {
	private _ranges: Array<{ range: Range; text: string }> = [];

	replace(range: Range, text: string): void {
		this._ranges.push({ range, text });
	}

	insert(position: PositionLike, text: string): void {
		this._ranges.push({ range: new Range(position, position), text });
	}

	get edits(): Array<{ range: Range; text: string }> {
		return this._ranges;
	}
}

export class MockWorkspace {
	readonly fs: MockWorkspaceFileSystem;
	private readonly _folders: Uri[] = [];
	private readonly _config: Record<string, MockConfiguration> = {};
	private readonly _onDidSaveTextDocument = new EventEmitter<MockTextDocument>();
	readonly onDidSaveTextDocument = this._onDidSaveTextDocument.event;

	constructor(workspaceRoot: string = '/workspace', initialFiles?: Record<string, string>) {
		this.fs = new MockWorkspaceFileSystem(initialFiles);
		this._folders.push(Uri.file(workspaceRoot));
	}

	get workspaceFolders(): Uri[] | undefined {
		return [...this._folders];
	}

	getWorkspaceFolder(uri: Uri): { uri: Uri; index: number; name: string } | undefined {
		const folder = this._folders.find(f => uri.toString().startsWith(f.toString()));
		return folder ? { uri: folder, index: 0, name: folder.path.split('/').pop() ?? '' } : undefined;
	}

	getConfiguration(section: string): { get: <T>(key: string, defaultValue?: T) => T | undefined; update: (key: string, value: unknown) => Promise<void> } {
		const target = this._config[section] ?? {};
		return {
			get: <T>(key: string, defaultValue?: T): T | undefined => (target[key] as T | undefined) ?? defaultValue,
			update: async (key: string, value: unknown) => { this._config[section] = { ...target, [key]: value }; },
		};
	}

	createFileSystemWatcher(): { onDidCreate: EventEmitter<string>['event']; onDidChange: EventEmitter<string>['event']; onDidDelete: EventEmitter<string>['event']; dispose(): void } {
		const onDidCreate = new EventEmitter<string>();
		const onDidChange = new EventEmitter<string>();
		const onDidDelete = new EventEmitter<string>();
		return {
			onDidCreate: onDidCreate.event,
			onDidChange: onDidChange.event,
			onDidDelete: onDidDelete.event,
			dispose: () => { onDidCreate.dispose(); onDidChange.dispose(); onDidDelete.dispose(); },
		};
	}

	saveDocument(doc: MockTextDocument): void {
		this._onDidSaveTextDocument.fire(doc);
	}
}

export class MockCommands {
	private readonly _registry = new Map<string, (...args: any[]) => unknown>();

	registerCommand(id: string, handler: (...args: any[]) => unknown): Disposable {
		this._registry.set(id, handler);
		return new Disposable(() => this._registry.delete(id));
	}

	executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
		const handler = this._registry.get(id);
		if (!handler) return Promise.reject(new Error(`command not registered: ${id}`));
		return Promise.resolve(handler(...args) as T);
	}
}

export class MockLanguages {
	private readonly _diagnostics = new Map<string, { uri: string; diagnostics: unknown[] }>();

	createDiagnosticCollection(name: string): { set(uri: Uri, diagnostics: unknown[]): void; clear(): void; dispose(): void } {
		return {
			set: (uri, diagnostics) => {
				const key = uri.toString();
				const entry = this._diagnostics.get(key) ?? { uri: key, diagnostics: [] };
				entry.diagnostics = [...diagnostics];
				this._diagnostics.set(key, entry);
			},
			clear: () => this._diagnostics.clear(),
			dispose: () => this._diagnostics.clear(),
		};
	}

	getLanguages(): string[] {
		return ['typescript', 'javascript', 'json', 'css', 'html', 'markdown', 'plaintext'];
	}
}

export class MockEnv {
	readonly machineId = 'mock-machine';
	readonly appName = 'Dardcor Code (mock)';
	readonly appRoot = '/mock/appRoot';
	readonly language = 'en';
	private _clipboard = '';

	readonly clipboard = {
		writeText: async (text: string) => { this._clipboard = text; },
		readText: async () => this._clipboard,
	};
}

export interface MockVscodeApi {
	readonly version: string;
	readonly Uri: typeof Uri;
	readonly Position: typeof Position;
	readonly Range: typeof Range;
	readonly Selection: typeof Selection;
	readonly Disposable: typeof Disposable;
	readonly EventEmitter: typeof EventEmitter;
	readonly window: {
		readonly activeTextEditor: MockEditor | undefined;
		readonly visibleTextEditors: MockEditor[];
		readonly onDidChangeActiveTextEditor: (listener: (editor: MockEditor | undefined) => void) => Disposable;
		showInformationMessage(message: string): Promise<void>;
		showWarningMessage(message: string): Promise<void>;
		showErrorMessage(message: string): Promise<void>;
		showInputBox(options?: { prompt?: string; value?: string }): Promise<string | undefined>;
		showQuickPick(items: Array<{ label: string; description?: string } | string>): Promise<{ label: string; description?: string } | string | undefined>;
		createOutputChannel(name: string): { name: string; appendLine(line: string): void; show(): void; dispose(): void };
		setStatusBarMessage(text: string): Disposable;
	};
	readonly workspace: MockWorkspace;
	readonly commands: MockCommands;
	readonly languages: MockLanguages;
	readonly env: MockEnv;
}

export function createMockVscodeApi(options?: {
	workspaceRoot?: string;
	initialFiles?: Record<string, string>;
	openDocument?: { uri: Uri; content: string };
}): MockVscodeApi {
	const workspace = new MockWorkspace(options?.workspaceRoot ?? '/workspace', options?.initialFiles);
	const commands = new MockCommands();
	const languages = new MockLanguages();
	const env = new MockEnv();
	const outputChannels: Array<{ name: string; appendLine(line: string): void; show(): void; dispose(): void }> = [];
	const onDidChangeActiveTextEditor = new EventEmitter<MockEditor | undefined>();
	let activeEditor: MockEditor | undefined;

	if (options?.openDocument) {
		const doc = new MockTextDocument(options.openDocument.uri, options.openDocument.content);
		activeEditor = createMockEditor(doc);
	}

	function createMockEditor(document: MockTextDocument): MockEditor {
		return {
			document,
			selection: new Selection(new Position(0, 0), new Position(0, 0)),
			selections: [],
			edit: async fn => {
				const builder = new MockEditBuilder();
				fn(builder);
				let content = document.getText();
				const lines = content.split('\n');
				for (const { range, text } of builder.edits.sort((a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character)) {
					const startIdx = Math.min(content.length, lines.slice(0, range.start.line).reduce((acc, l) => acc + l.length + 1, 0) + range.start.character);
					const endIdx = Math.min(content.length, lines.slice(0, range.end.line).reduce((acc, l) => acc + l.length + 1, 0) + range.end.character);
					content = content.slice(0, startIdx) + text + content.slice(endIdx);
				}
				(document as MockTextDocument).setContent(content);
				return true;
			},
		};
	}

	return {
		version: '1.0.0-mock',
		Uri,
		Position,
		Range,
		Selection,
		Disposable,
		EventEmitter,
		window: {
			get activeTextEditor(): MockEditor | undefined {
				return activeEditor;
			},
			get visibleTextEditors(): MockEditor[] {
				return activeEditor ? [activeEditor] : [];
			},
			onDidChangeActiveTextEditor: onDidChangeActiveTextEditor.event,
			showInformationMessage: async message => console.log('[mock:vscode:info]', message),
			showWarningMessage: async message => console.warn('[mock:vscode:warn]', message),
			showErrorMessage: async message => console.error('[mock:vscode:error]', message),
			showInputBox: async options => options?.value,
			showQuickPick: async items => (Array.isArray(items) ? items[0] : undefined),
			createOutputChannel: name => {
				const channel = {
					name,
					appendLine(line: string) { console.log(`[${name}]`, line); },
					show() { /* no-op */ },
					dispose() { const idx = outputChannels.indexOf(channel); if (idx >= 0) outputChannels.splice(idx, 1); },
				};
				outputChannels.push(channel);
				return channel;
			},
			setStatusBarMessage: text => new Disposable(() => { /* no-op */ }),
		},
		workspace,
		commands,
		languages,
		env,
	};
}

export const mockVscodeApi = createMockVscodeApi();
