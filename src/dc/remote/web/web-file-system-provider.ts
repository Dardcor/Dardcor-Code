/**
 * Dardcor Code - Browser IndexedDB & HTML5 FileSystem API Provider (Task 817)
 */

import { IFileSystemProvider, IFileStat, FileChangeEvent, FileChangeType } from '../../services/files/file-service';
import { URI } from '../../core/types/uri';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

interface WebFsRecord {
	readonly path: string;
	readonly kind: 'file' | 'dir';
	readonly mtime: number;
	readonly data?: ArrayBuffer;
}

function isBrowser(): boolean {
	return typeof indexedDB !== 'undefined' && typeof globalThis !== 'undefined';
}

function openDatabase(dbName: string): Promise<IDBDatabase> {
	return new Promise((resolvePromise, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is not available; the web file system provider only runs in a browser'));
			return;
		}
		const request = indexedDB.open(dbName, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains('files')) {
				db.createObjectStore('files', { keyPath: 'path' });
			}
		};
		request.onsuccess = () => resolvePromise(request.result);
		request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
	});
}

export class WebFileSystemProvider extends Disposable implements IFileSystemProvider {
	private _dbPromise: Promise<IDBDatabase> | null = null;
	private _mountedHandle: FileSystemDirectoryHandle | null = null;

	private readonly _onDidChangeFile = this._register(new Emitter<FileChangeEvent[]>());
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

	constructor(
		private readonly _databaseName = 'dc-web-fs',
		private readonly _scheme = 'web'
	) {
		super();
		if (!isBrowser()) {
			throw new Error('WebFileSystemProvider only runs in a browser environment');
		}
	}

	get scheme(): string {
		return this._scheme;
	}

	get hasMountedDirectory(): boolean {
		return this._mountedHandle !== null;
	}

	async mountDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
		if (typeof FileSystemDirectoryHandle === 'undefined') {
			throw new Error('The FileSystem API is not supported in this browser');
		}
		this._mountedHandle = handle;
		await this._importDirectory(handle, '/', new Set());
		this._fireChange('/', FileChangeType.Added);
	}

	async stat(resource: URI): Promise<IFileStat> {
		const record = await this._getRecord(resource.path);
		if (!record) {
			throw new Error(`Not found: ${resource.path}`);
		}
		return this._toStat(record, resource);
	}

	async readdir(resource: URI): Promise<[string, IFileStat][]> {
		const records = await this._getRecordsWithPrefix(resource.path);
		const prefix = resource.path === '/' ? '/' : `${resource.path}/`;
		const children = new Map<string, WebFsRecord>();
		for (const record of records) {
			if (!record.path.startsWith(prefix) || record.path === resource.path) {
				continue;
			}
			const rest = record.path.slice(prefix.length);
			const name = rest.split('/')[0];
			if (!children.has(name)) {
				children.set(name, record);
			}
		}
		return [...children.entries()].map(([name, record]) => [
			name,
			this._toStat(record, URI.from({ scheme: this._scheme, path: `${prefix}${name}` }))
		]);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const record = await this._getRecord(resource.path);
		if (!record || record.kind !== 'file' || !record.data) {
			throw new Error(`Not found: ${resource.path}`);
		}
		return new Uint8Array(record.data);
	}

	async writeFile(resource: URI, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): Promise<void> {
		const existing = await this._getRecord(resource.path);
		const record: WebFsRecord = {
			path: resource.path,
			kind: 'file',
			mtime: Date.now(),
			data: content.slice().buffer as ArrayBuffer
		};
		await this._putRecord(record);
		if (this._mountedHandle) {
			await this._writeToMounted(resource.path, content).catch(() => undefined);
		}
		this._fireChange(resource.path, existing ? FileChangeType.Updated : FileChangeType.Added);
	}

	async delete(resource: URI, options: { recursive: boolean }): Promise<void> {
		const records = await this._getRecordsWithPrefix(resource.path);
		const toDelete = records.filter(r => r.path === resource.path || (options.recursive && r.path.startsWith(`${resource.path}/`)));
		if (toDelete.length === 0) {
			throw new Error(`Not found: ${resource.path}`);
		}
		const db = await this._getDb();
		await new Promise<void>((resolvePromise, reject) => {
			const tx = db.transaction('files', 'readwrite');
			const store = tx.objectStore('files');
			for (const record of toDelete) {
				store.delete(record.path);
			}
			tx.oncomplete = () => resolvePromise();
			tx.onerror = () => reject(tx.error ?? new Error('Delete failed'));
		});
		this._fireChange(resource.path, FileChangeType.Deleted);
	}

	async mkdir(resource: URI): Promise<void> {
		const record: WebFsRecord = { path: resource.path, kind: 'dir', mtime: Date.now() };
		await this._putRecord(record);
		this._fireChange(resource.path, FileChangeType.Added);
	}

	private async _importDirectory(handle: FileSystemDirectoryHandle, path: string, visited: Set<string>): Promise<void> {
		if (visited.has(handle.name)) {
			return;
		}
		visited.add(handle.name);
		await this._putRecord({ path, kind: 'dir', mtime: Date.now() });
		const iterator = getDirectoryIterator(handle);
		for await (const entry of iterator) {
			if (entry.kind === 'file') {
				const file = await entry.getFile();
				const buffer = await file.arrayBuffer();
				await this._putRecord({ path: joinPath(path, entry.name), kind: 'file', mtime: file.lastModified, data: buffer });
			} else if (entry.kind === 'directory') {
				await this._importDirectory(entry, joinPath(path, entry.name), visited);
			}
		}
	}

	private async _writeToMounted(path: string, content: Uint8Array): Promise<void> {
		if (!this._mountedHandle) {
			return;
		}
		const segments = path.split('/').filter(Boolean);
		let dir = this._mountedHandle;
		for (let i = 0; i < segments.length - 1; i++) {
			dir = await dir.getDirectoryHandle(segments[i], { create: true });
		}
		const name = segments.at(-1) ?? 'file';
		const fileHandle = await dir.getFileHandle(name, { create: true });
		const writable = await fileHandle.createWritable();
		const copy = content.slice();
		await writable.write(copy.buffer as ArrayBuffer);
		await writable.close();
	}

	private _toStat(record: WebFsRecord, resource: URI): IFileStat {
		return {
			resource,
			name: record.path.split('/').filter(Boolean).at(-1) ?? '',
			isDirectory: record.kind === 'dir',
			isFile: record.kind === 'file',
			size: record.data ? record.data.byteLength : 0,
			mtime: record.mtime
		};
	}

	private _getDb(): Promise<IDBDatabase> {
		if (!this._dbPromise) {
			this._dbPromise = openDatabase(this._databaseName);
		}
		return this._dbPromise;
	}

	private _getRecord(path: string): Promise<WebFsRecord | undefined> {
		return this._getDb().then(db => new Promise<WebFsRecord | undefined>((resolvePromise, reject) => {
			const tx = db.transaction('files', 'readonly');
			const request = tx.objectStore('files').get(path);
			request.onsuccess = () => resolvePromise(request.result as WebFsRecord | undefined);
			request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
		}));
	}

	private _getRecordsWithPrefix(path: string): Promise<WebFsRecord[]> {
		return this._getDb().then(db => new Promise<WebFsRecord[]>((resolvePromise, reject) => {
			const tx = db.transaction('files', 'readonly');
			const request = tx.objectStore('files').getAll();
			request.onsuccess = () => {
				const all = request.result as WebFsRecord[];
				resolvePromise(all.filter(r => r.path === path || r.path.startsWith(path === '/' ? '/' : `${path}/`)));
			};
			request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
		}));
	}

	private _putRecord(record: WebFsRecord): Promise<void> {
		return this._getDb().then(db => new Promise<void>((resolvePromise, reject) => {
			const tx = db.transaction('files', 'readwrite');
			tx.objectStore('files').put(record);
			tx.oncomplete = () => resolvePromise();
			tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
		}));
	}

	private _fireChange(path: string, type: FileChangeType): void {
		this._onDidChangeFile.fire([{
			resource: URI.from({ scheme: this._scheme, path }),
			type
		}]);
	}
}

function joinPath(base: string, name: string): string {
	return `${base === '/' ? '' : base}/${name}`;
}

function getDirectoryIterator(handle: FileSystemDirectoryHandle): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle> {
	const anyHandle = handle as any;
	if (typeof anyHandle.values === 'function') {
		return anyHandle.values() as AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
	}
	const iterator = anyHandle[Symbol.asyncIterator];
	if (typeof iterator === 'function') {
		return {
			[Symbol.asyncIterator]: () => iterator.call(handle)
		};
	}
	throw new Error('FileSystemDirectoryHandle does not support enumeration in this browser');
}
