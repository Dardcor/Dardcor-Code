/**
 * Dardcor Code - Disk FileSystem Provider (Task 106)
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { IFileSystemProvider, IFileStat, FileChangeEvent, FileChangeType } from './file-service';
import { URI } from '../../core/types/uri';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { isWindows } from '../../core/environment/platform';
import { toFileStat } from './file-stat';
import { FileSystemWatcher } from './file-watcher';

export type { IFileSystemProvider } from './file-service';

export function toOSPath(resource: URI): string {
	let path = decodeURIComponent(resource.path);
	if (isWindows && path.startsWith('/')) {
		path = path.substring(1);
	}
	return path.replace(/\//g, '\\');
}

export function toFileURI(fsPath: string): URI {
	return URI.file(fsPath);
}

function joinUriPath(basePath: string, name: string): string {
	return basePath === '' || basePath.endsWith('/') ? basePath + name : basePath + '/' + name;
}

export class DiskFileSystemProvider extends Disposable implements IFileSystemProvider {
	private readonly _onDidChangeFile = this._register(new Emitter<FileChangeEvent[]>());
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

	private readonly _watchers = new Map<string, FileSystemWatcher>();

	public async stat(resource: URI): Promise<IFileStat> {
		const stats = await fs.stat(toOSPath(resource));
		return toFileStat(resource, stats);
	}

	public async readdir(resource: URI): Promise<[string, IFileStat][]> {
		const osPath = toOSPath(resource);
		const dirents = await fs.readdir(osPath, { withFileTypes: true });
		const result: [string, IFileStat][] = [];
		for (const dirent of dirents) {
			const childUri = URI.from({
				scheme: resource.scheme,
				authority: resource.authority,
				path: joinUriPath(resource.path, dirent.name)
			});
			try {
				const stats = await fs.stat(joinUriPath(osPath, dirent.name));
				result.push([dirent.name, toFileStat(childUri, stats)]);
			} catch {
				// Entry vanished between readdir and stat - skip it.
			}
		}
		return result;
	}

	public async readFile(resource: URI): Promise<Uint8Array> {
		const data = await fs.readFile(toOSPath(resource));
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}

	public async writeFile(resource: URI, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
		const osPath = toOSPath(resource);
		if (!options.create || !options.overwrite) {
			const exists = await this._exists(osPath);
			if (exists && !options.overwrite) {
				throw new Error(`File already exists: ${osPath}`);
			}
			if (!exists && !options.create) {
				throw new Error(`File does not exist: ${osPath}`);
			}
		}
		const parent = dirname(osPath);
		if (parent) {
			await fs.mkdir(parent, { recursive: true });
		}
		await fs.writeFile(osPath, content);
		this._fireChange(resource, FileChangeType.Updated);
	}

	public async delete(resource: URI, options: { recursive: boolean }): Promise<void> {
		await fs.rm(toOSPath(resource), { recursive: options.recursive, force: true });
		this._fireChange(resource, FileChangeType.Deleted);
	}

	public async mkdir(resource: URI): Promise<void> {
		await fs.mkdir(toOSPath(resource), { recursive: true });
		this._fireChange(resource, FileChangeType.Added);
	}

	public async rename(source: URI, target: URI): Promise<void> {
		await fs.rename(toOSPath(source), toOSPath(target));
		this._fireChange(source, FileChangeType.Deleted);
		this._fireChange(target, FileChangeType.Added);
	}

	public watch(resource: URI, options: { recursive?: boolean } = {}): IDisposable {
		const osPath = toOSPath(resource);
		const existing = this._watchers.get(osPath);
		if (existing) {
			return toDisposable(() => {});
		}
		const watcher = this._register(new FileSystemWatcher(osPath, 100));
		this._register(watcher.onDidChangeFile((events) => this._onDidChangeFile.fire(events)));
		this._watchers.set(osPath, watcher);
		return toDisposable(() => {
			this._watchers.delete(osPath);
		});
	}

	private _fireChange(resource: URI, type: FileChangeType): void {
		if (this._isWatched(resource)) {
			return; // Active watcher already reports this change.
		}
		this._onDidChangeFile.fire([{ resource, type }]);
	}

	private _isWatched(resource: URI): boolean {
		const osPath = toOSPath(resource);
		for (const watchedPath of this._watchers.keys()) {
			if (osPath === watchedPath || osPath.startsWith(watchedPath + '\\')) {
				return true;
			}
		}
		return false;
	}

	private async _exists(osPath: string): Promise<boolean> {
		try {
			await fs.access(osPath);
			return true;
		} catch {
			return false;
		}
	}
}
