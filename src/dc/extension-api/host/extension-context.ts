/**
 * Dardcor Code - vscode.ExtensionContext API Mock Instance (Task 604)
 * Mirrors: vs/workbench/api/common/extHostExtensionService.ts (ExtensionContext)
 */

import * as path from 'node:path';
import { IDisposable, dispose } from '../../core/lifecycle/disposable.js';
import { ExtensionStorage, StorageScope } from './extension-storage.js';
import { URI } from '../../core/types/uri.js';

export enum ExtensionMode {
	Development = 1,
	Production = 2,
	Test = 3
}export interface IMementoOptions {
	readonly storage: ExtensionStorage;
	readonly scope: StorageScope;
}

export interface IMemento {
	keys(): readonly string[];
	get<T>(key: string, defaultValue?: T): T | undefined;
	update(key: string, value: any): Promise<void>;
}

/**
 * Scoped memento bound to one of the extension's storage files.
 * Keys are namespaced with the scope to avoid collisions.
 */
export class Memento implements IMemento {
	constructor(
		private readonly _storage: ExtensionStorage,
		private readonly _scope: StorageScope
	) {}

	public keys(): readonly string[] {
		const prefix = `${this._scope}:`;
		return this._storage.keys.filter(k => k.startsWith(prefix)).map(k => k.substring(prefix.length));
	}

	public get<T>(key: string, defaultValue?: T): T | undefined {
		return this._storage.get<T>(`${this._scope}:${key}`, defaultValue);
	}

	public update(key: string, value: any): Promise<void> {
		return this._storage.update(`${this._scope}:${key}`, value);
	}
}

export interface IExtensionContextOptions {
	readonly extensionPath: string;
	readonly extensionUri: URI;
	readonly globalStoragePath: string;
	readonly workspaceStoragePath: string;
	readonly extensionMode?: ExtensionMode;
	readonly logPath?: string;
	readonly subscriptions?: IDisposable[];
}

/**
 * The `ExtensionContext` handed to `activate(context)` — mirrors the
 * standard VS Code shape (subscriptions, globalState, workspaceState).
 */
export class ExtensionContext implements IDisposable {
	readonly subscriptions: IDisposable[];
	readonly extensionMode: ExtensionMode;

	readonly extensionUri: URI;
	readonly extensionPath: string;
	readonly globalStorageUri: URI;
	readonly workspaceStorageUri: URI;
	readonly logUri: URI;
	readonly storageUri: URI | undefined;

	private readonly _globalMemento: Memento;
	private readonly _workspaceMemento: Memento;

	private _disposed = false;

	constructor(private readonly _options: IExtensionContextOptions) {
		this.subscriptions = _options.subscriptions ?? [];
		this.extensionMode = _options.extensionMode ?? ExtensionMode.Production;
		this.extensionPath = _options.extensionPath;
		this.extensionUri = _options.extensionUri;

		const globalStorageUri = URI.file(_options.globalStoragePath);
		const workspaceStorageUri = URI.file(_options.workspaceStoragePath);
		this.globalStorageUri = globalStorageUri;
		this.workspaceStorageUri = workspaceStorageUri;
		this.storageUri = _options.extensionMode === ExtensionMode.Development ? workspaceStorageUri : undefined;
		this.logUri = URI.file(_options.logPath ?? _options.globalStoragePath);

		const globalStorage = new ExtensionStorage(path.join(_options.globalStoragePath, 'state.json'));
		const workspaceStorage = new ExtensionStorage(path.join(_options.workspaceStoragePath, 'state.json'));
		this._globalMemento = new Memento(globalStorage, StorageScope.GLOBAL);
		this._workspaceMemento = new Memento(workspaceStorage, StorageScope.WORKSPACE);
		this.subscriptions.push(globalStorage, workspaceStorage);
	}

	get globalState(): IMemento {
		return this._globalMemento;
	}

	get workspaceState(): IMemento {
		return this._workspaceMemento;
	}

	public asAbsolutePath(relativePath: string): string {
		return path.join(this.extensionPath, relativePath);
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		dispose(this.subscriptions);
	}
}

export function createExtensionContext(options: IExtensionContextOptions): ExtensionContext {
	return new ExtensionContext(options);
}
