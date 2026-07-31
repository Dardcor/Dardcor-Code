import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export interface IFileStat {
	type: FileType;
	ctime: number;
	mtime: number;
	size: number;
}

export interface IFileWriteOptions {
	create?: boolean;
	overwrite?: boolean;
}

export interface IFileDeleteOptions {
	recursive?: boolean;
}

export interface IFileRenameOptions {
	overwrite?: boolean;
}

export interface IFileWatcherOptions {
	recursive?: boolean;
}

export interface IFileSystemProvider {
	readFile?(uri: URI): Uint8Array | Promise<Uint8Array>;
	writeFile?(uri: URI, content: Uint8Array, options?: IFileWriteOptions): void | Promise<void>;
	readDirectory?(uri: URI): Array<[string, FileType]> | Promise<Array<[string, FileType]>>;
	stat?(uri: URI): IFileStat | Promise<IFileStat>;
	watch?(uri: URI, options?: IFileWatcherOptions): IDisposable;
	delete?(uri: URI, options?: IFileDeleteOptions): void | Promise<void>;
	rename?(oldUri: URI, newUri: URI, options?: IFileRenameOptions): void | Promise<void>;
	createDirectory?(uri: URI): void | Promise<void>;
}

export interface IFileSystemProviderRegistration {
	readonly scheme: string;
	readonly provider: IFileSystemProvider;
}

export class ExtHostFileSystem extends Disposable {
	private readonly _providers = new Map<string, IFileSystemProvider>();
	private readonly _watches = new Map<string, IDisposable[]>();

	private readonly _onDidChangeFileSystem = this._register(new Emitter<{ scheme: string; added: boolean }>());
	readonly onDidChangeFileSystem: Event<{ scheme: string; added: boolean }> = this._onDidChangeFileSystem.event;

	public registerFileSystemProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
		if (this._providers.has(scheme)) {
			throw new Error(`Provider file system '${scheme}' sudah terdaftar`);
		}
		this._providers.set(scheme, provider);
		this._onDidChangeFileSystem.fire({ scheme, added: true });
		return toDisposable(() => {
			this._providers.delete(scheme);
			this._watches.delete(scheme);
			this._onDidChangeFileSystem.fire({ scheme, added: false });
		});
	}

	public getProvider(scheme: string): IFileSystemProvider | undefined {
		return this._providers.get(scheme);
	}

	public hasProvider(scheme: string): boolean {
		return this._providers.has(scheme);
	}

	public getSchemes(): string[] {
		return [...this._providers.keys()];
	}

	public getProviders(): IFileSystemProviderRegistration[] {
		return [...this._providers.entries()].map(([scheme, provider]) => ({ scheme, provider }));
	}

	public async readFile(uri: URI): Promise<Uint8Array> {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.readFile) {
			throw new Error(`Provider '${uri.scheme}' tidak mendukung readFile`);
		}
		return provider.readFile(uri);
	}

	public async writeFile(uri: URI, content: Uint8Array, options?: IFileWriteOptions): Promise<void> {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.writeFile) {
			throw new Error(`Provider '${uri.scheme}' tidak mendukung writeFile`);
		}
		await provider.writeFile(uri, content, options);
	}

	public async readDirectory(uri: URI): Promise<Array<[string, FileType]>> {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.readDirectory) {
			throw new Error(`Provider '${uri.scheme}' tidak mendukung readDirectory`);
		}
		return provider.readDirectory(uri);
	}

	public async stat(uri: URI): Promise<IFileStat> {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.stat) {
			throw new Error(`Provider '${uri.scheme}' tidak mendukung stat`);
		}
		return provider.stat(uri);
	}

	public watch(uri: URI, options?: IFileWatcherOptions): IDisposable {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.watch) {
			return toDisposable(() => undefined);
		}
		const disposable = provider.watch(uri, options);
		const key = uri.scheme;
		let watches = this._watches.get(key);
		if (!watches) {
			watches = [];
			this._watches.set(key, watches);
		}
		watches.push(disposable);
		return toDisposable(() => {
			const index = watches.indexOf(disposable);
			if (index !== -1) {
				watches.splice(index, 1);
			}
			disposable.dispose();
		});
	}

	public async delete(uri: URI, options?: IFileDeleteOptions): Promise<void> {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.delete) {
			throw new Error(`Provider '${uri.scheme}' tidak mendukung delete`);
		}
		await provider.delete(uri, options);
	}

	public async rename(oldUri: URI, newUri: URI, options?: IFileRenameOptions): Promise<void> {
		const provider = this._requireProvider(oldUri.scheme);
		if (!provider.rename) {
			throw new Error(`Provider '${oldUri.scheme}' tidak mendukung rename`);
		}
		await provider.rename(oldUri, newUri, options);
	}

	public async createDirectory(uri: URI): Promise<void> {
		const provider = this._requireProvider(uri.scheme);
		if (!provider.createDirectory) {
			throw new Error(`Provider '${uri.scheme}' tidak mendukung createDirectory`);
		}
		await provider.createDirectory(uri);
	}

	public override dispose(): void {
		for (const watches of this._watches.values()) {
			for (const watch of watches) {
				watch.dispose();
			}
		}
		this._watches.clear();
		this._providers.clear();
		super.dispose();
	}

	private _requireProvider(scheme: string): IFileSystemProvider {
		const provider = this._providers.get(scheme);
		if (!provider) {
			throw new Error(`Tidak ada provider file system untuk scheme '${scheme}'`);
		}
		return provider;
	}
}
