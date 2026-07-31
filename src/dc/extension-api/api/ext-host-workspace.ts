/**
 * Dardcor Code - dc.workspace API Bridge (Task 606)
 * Mirrors: vs/workbench/api/common/extHostWorkspace.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol.js';
import { URI } from '../../core/types/uri.js';
import { TextDocument, ExtHostDocuments, TextDocumentChangeEvent, ITextDocumentData } from './ext-host-documents.js';
import { WorkspaceEdit } from './ext-host-api-impl.js';

export interface IWorkspaceFolderData {
	uri: string;
	name: string;
	index: number;
}

export class WorkspaceFolder {
	readonly uri: URI;
	readonly name: string;
	readonly index: number;

	constructor(data: IWorkspaceFolderData) {
		this.uri = URI.parse(data.uri);
		this.name = data.name;
		this.index = data.index;
	}

	public toJSON(): IWorkspaceFolderData {
		return { uri: this.uri.toString(), name: this.name, index: this.index };
	}
}

export interface IWorkspaceConfigurationData {
	section: string;
	values: Record<string, any>;
}

export class WorkspaceConfiguration {
	constructor(
		private readonly _data: IWorkspaceConfigurationData
	) {}

	public get<T>(key: string, defaultValue?: T): T | undefined {
		const path = this._fullKey(key);
		if (path.length === 0) {
			return this._data.values as unknown as T;
		}
		let current: any = this._data.values;
		for (const part of path) {
			if (current === null || typeof current !== 'object') {
				return defaultValue;
			}
			current = current[part];
		}
		return current === undefined ? defaultValue : current as T;
	}

	public has(key: string): boolean {
		return this.get<any>(key) !== undefined;
	}

	public inspect<T>(key: string): { value?: T; defaultValue?: T; globalValue?: T; workspaceValue?: T } | undefined {
		const value = this.get<T>(key);
		return value === undefined ? undefined : { value, defaultValue: value };
	}

	public toJSON(): any {
		return this._data.values;
	}

	private _fullKey(key: string): string[] {
		if (!key) {
			return [];
		}
		return `${this._data.section}.${key}`.split('.').filter(p => p.length > 0);
	}
}

export class FileSystemWatcher extends Disposable {
	private readonly _onDidCreate = this._register(new Emitter<URI>());
	readonly onDidCreate: Event<URI> = this._onDidCreate.event;

	private readonly _onDidChange = this._register(new Emitter<URI>());
	readonly onDidChange: Event<URI> = this._onDidChange.event;

	private readonly _onDidDelete = this._register(new Emitter<URI>());
	readonly onDidDelete: Event<URI> = this._onDidDelete.event;

	public ignoreCreateEvents = false;
	public ignoreChangeEvents = false;
	public ignoreDeleteEvents = false;

	constructor(
		public readonly watcherId: number,
		private readonly _rpc: RPCProtocol
	) {
		super();
	}

	public fireEvent(type: 'create' | 'change' | 'delete', uri: URI): void {
		if (type === 'create' && !this.ignoreCreateEvents) {
			this._onDidCreate.fire(uri);
		} else if (type === 'change' && !this.ignoreChangeEvents) {
			this._onDidChange.fire(uri);
		} else if (type === 'delete' && !this.ignoreDeleteEvents) {
			this._onDidDelete.fire(uri);
		}
	}

	public override dispose(): void {
		this._rpc.notify('main', 'workspace.unwatch', { id: this.watcherId });
		super.dispose();
	}
}

export interface IWorkspaceApi {
	readonly name: string | undefined;
	readonly workspaceFolders: WorkspaceFolder[] | undefined;
	readonly workspaceFile: URI | undefined;
	readonly onDidChangeWorkspaceFolders: Event<{ added: WorkspaceFolder[]; removed: WorkspaceFolder[] }>;
	readonly onDidChangeTextDocument: Event<TextDocumentChangeEvent>;
	readonly onDidChangeConfiguration: Event<{ affectsConfiguration: (section: string, scope?: unknown) => boolean }>;
	readonly fs: {
		readFile(uri: URI): Promise<Uint8Array>;
		writeFile(uri: URI, content: Uint8Array, options?: { create?: boolean; overwrite?: boolean }): Promise<void>;
		stat(uri: URI): Promise<{ type: number; ctime: number; mtime: number; size: number }>;
		readDirectory(uri: URI): Promise<Array<[string, number]>>;
		delete(uri: URI, options?: { recursive?: boolean }): Promise<void>;
		rename(oldUri: URI, newUri: URI, options?: { overwrite?: boolean }): Promise<void>;
	};
	getWorkspaceFolder(uri: URI): WorkspaceFolder | undefined;
	asRelativePath(pathOrUri: string | URI, includeWorkspaceFolder?: boolean): string | undefined;
	applyEdit(edit: WorkspaceEdit): Promise<boolean>;
	openTextDocument(uriOrOptions?: URI | { language?: string; content?: string }): Promise<TextDocument>;
	getConfiguration(section?: string, scope?: URI | WorkspaceFolder): WorkspaceConfiguration;
	createFileSystemWatcher(globPattern: string, ignoreCreateEvents?: boolean, ignoreChangeEvents?: boolean, ignoreDeleteEvents?: boolean): FileSystemWatcher;
	registerTextDocumentContentProvider(scheme: string, provider: unknown): IDisposable;
	findFiles(include: string, exclude?: string, maxResults?: number): Promise<URI[]>;
}

export class ExtHostWorkspace extends Disposable {
	private _folders: WorkspaceFolder[] = [];
	private _name: string | undefined;
	private _configuration: Record<string, any> = {};
	private _nextWatcherId = 1;
	private readonly _watchers = new Map<number, FileSystemWatcher>();
	private readonly _contentProviders = new Map<string, unknown>();

	private readonly _onDidChangeFolders = this._register(new Emitter<{ added: WorkspaceFolder[]; removed: WorkspaceFolder[] }>());
	readonly onDidChangeWorkspaceFolders: Event<{ added: WorkspaceFolder[]; removed: WorkspaceFolder[] }> = this._onDidChangeFolders.event;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<{ affectsConfiguration: (section: string, scope?: unknown) => boolean }>());
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	readonly onDidChangeTextDocument: Event<TextDocumentChangeEvent>;

	constructor(
		private readonly _rpc: RPCProtocol,
		private readonly _documents: ExtHostDocuments
	) {
		super();
		this.onDidChangeTextDocument = this._documents.onDidChangeTextDocument;
		this._register(this._rpc.onEvent('workspace', 'watcherChanged')((payload: { id: number; type: 'create' | 'change' | 'delete'; uri: string }) => {
			this._watchers.get(payload.id)?.fireEvent(payload.type, URI.parse(payload.uri));
		}));
		this._register(this._rpc.onEvent('workspace', 'configurationChanged')((payload: { configuration: Record<string, any> }) => {
			this._configuration = payload.configuration;
			this._onDidChangeConfiguration.fire({
				affectsConfiguration: (section: string) => this._configurationHasSection(section)
			});
		}));
		this._register(this._rpc.onEvent('workspace', 'foldersChanged')((payload: { folders: IWorkspaceFolderData[] }) => {
			this.setWorkspaceFolders(payload.folders);
		}));
	}

	public setWorkspaceFolders(folders: IWorkspaceFolderData[]): void {
		const next = folders.map(f => new WorkspaceFolder(f));
		const removed = this._folders.filter(f => !next.some(n => n.uri.toString() === f.uri.toString()));
		const added = next.filter(n => !this._folders.some(f => f.uri.toString() === n.uri.toString()));
		this._folders = next;
		this._name = this._folders[0]?.name;
		if (added.length > 0 || removed.length > 0) {
			this._onDidChangeFolders.fire({ added, removed });
		}
	}

	public setConfiguration(configuration: Record<string, any>): void {
		this._configuration = configuration;
	}

	public get api(): IWorkspaceApi {
		const self = this;
		const rpc = this._rpc;
		return {
			get name() {
				return self._name;
			},
			get workspaceFolders() {
				return self._folders.length > 0 ? self._folders.slice() : undefined;
			},
			get workspaceFile() {
				return self._workspaceFileUri ? URI.parse(self._workspaceFileUri) : undefined;
			},
			onDidChangeWorkspaceFolders: this.onDidChangeWorkspaceFolders,
			onDidChangeTextDocument: this.onDidChangeTextDocument,
			onDidChangeConfiguration: this.onDidChangeConfiguration,
			fs: {
				readFile: (uri: URI) => rpc.call<Uint8Array>('main', 'workspace.fs.readFile', { uri: uri.toString() }),
				writeFile: (uri: URI, content: Uint8Array, options?: { create?: boolean; overwrite?: boolean }) =>
					rpc.call('main', 'workspace.fs.writeFile', { uri: uri.toString(), content: Array.from(content), options }),
				stat: (uri: URI) => rpc.call('main', 'workspace.fs.stat', { uri: uri.toString() }),
				readDirectory: (uri: URI) => rpc.call<Array<[string, number]>>('main', 'workspace.fs.readDirectory', { uri: uri.toString() }),
				delete: (uri: URI, options?: { recursive?: boolean }) => rpc.call('main', 'workspace.fs.delete', { uri: uri.toString(), options }),
				rename: (oldUri: URI, newUri: URI, options?: { overwrite?: boolean }) =>
					rpc.call('main', 'workspace.fs.rename', { oldUri: oldUri.toString(), newUri: newUri.toString(), options })
			},
			getWorkspaceFolder: (uri: URI) => {
				const value = uri.toString();
				return self._folders.find(f => value === f.uri.toString() || value.startsWith(f.uri.toString() + '/'));
			},
			asRelativePath: (pathOrUri: string | URI) => {
				const value = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path;
				const folder = self._folders.find(f => value.startsWith(f.uri.path));
				return folder ? value.substring(folder.uri.path.length + 1) : value;
			},
			applyEdit: (edit: WorkspaceEdit) => rpc.call<boolean>('main', 'workspace.applyEdit', { entries: edit.toJSON() }),
			openTextDocument: async (uriOrOptions?: URI | { language?: string; content?: string }) => {
				if (uriOrOptions && !(uriOrOptions instanceof URI) && 'content' in uriOrOptions) {
					const uri = URI.from({ scheme: 'untitled' });
					return self._documents.addDocument({
						uri: uri.toString(),
						languageId: uriOrOptions.language ?? 'plaintext',
						version: 1,
						text: uriOrOptions.content ?? '',
						eol: 'lf'
					});
				}
				const uri = uriOrOptions instanceof URI ? uriOrOptions : undefined;
				const data = await rpc.call<ITextDocumentData>('main', 'workspace.openTextDocument', { uri: uri?.toString() });
				if (!data) {
					throw new Error(`Gagal membuka dokumen ${uri?.toString()}`);
				}
				return self._documents.addDocument(data);
			},
			getConfiguration: (section?: string, scope?: URI | WorkspaceFolder) =>
				new WorkspaceConfiguration({ section: section ?? '', values: self._configurationFor(section ?? '', scope) }),
			createFileSystemWatcher: (globPattern: string, ignoreCreateEvents = false, ignoreChangeEvents = false, ignoreDeleteEvents = false) => {
				const id = self._nextWatcherId++;
				const watcher = new FileSystemWatcher(id, rpc);
				watcher.ignoreCreateEvents = ignoreCreateEvents;
				watcher.ignoreChangeEvents = ignoreChangeEvents;
				watcher.ignoreDeleteEvents = ignoreDeleteEvents;
				self._watchers.set(id, watcher);
				rpc.notify('main', 'workspace.watch', { id, glob: globPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents });
				return watcher;
			},
			registerTextDocumentContentProvider: (scheme: string, provider: unknown) => {
				self._contentProviders.set(scheme, provider);
				rpc.notify('main', 'workspace.registerContentProvider', { scheme });
				return { dispose: () => self._contentProviders.delete(scheme) };
			},
			findFiles: (include: string, exclude?: string, maxResults?: number) =>
				rpc.call<string[]>('main', 'workspace.findFiles', { include, exclude, maxResults }).then(list => list.map(u => URI.parse(u)))
		};
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$setFolders':
						this.setWorkspaceFolders(payload.folders);
						return undefined;
					case '$setConfiguration':
						this.setConfiguration(payload.configuration);
						return undefined;
					case '$getContentProvider':
						return this._contentProviders.has(payload.scheme);
					default:
						throw new Error(`Perintah workspace tidak dikenal: ${command}`);
				}
			}
		};
	}

	private _workspaceFileUri: string | undefined;

	private _configurationFor(section: string, scope?: URI | WorkspaceFolder): Record<string, any> {
		if (!section) {
			return this._configuration;
		}
		let current: any = this._configuration;
		for (const part of section.split('.')) {
			if (current === null || typeof current !== 'object') {
				return {};
			}
			current = current[part];
		}
		return current ?? {};
	}

	private _configurationHasSection(section: string): boolean {
		return Object.keys(this._configurationFor(section)).length > 0;
	}
}