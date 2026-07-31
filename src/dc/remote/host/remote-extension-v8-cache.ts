import { readdir, mkdir, stat, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Emitter, Event } from '../../core/events/emitter';

export interface IV8CacheOptions {
	readonly cacheDir?: string;
	readonly maxCacheSizeBytes?: number;
}

export interface IV8CacheEntry {
	readonly name: string;
	readonly size: number;
	readonly updatedAt: number;
}

export const CACHE_FILE_EXTENSION = '.codecache';
export const DEFAULT_MAX_CACHE_SIZE = 128 * 1024 * 1024;

export function getDefaultCacheDir(): string {
	if (typeof process === 'undefined') {
		return '.dc-v8-cache';
	}
	const xdgCache = process.env.XDG_CACHE_HOME;
	if (xdgCache) {
		return join(xdgCache, 'dc-remote', 'v8-cache');
	}
	return join(homedir(), '.cache', 'dc-remote', 'v8-cache');
}

export function sanitizeExtensionId(extensionId: string): string {
	return extensionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export class RemoteExtensionV8Cache {
	private readonly _cacheDir: string;
	private readonly _maxCacheSizeBytes: number;

	private readonly _onDidUpdate = new Emitter<string>();
	readonly onDidUpdate: Event<string> = this._onDidUpdate.event;

	constructor(options: IV8CacheOptions = {}) {
		this._cacheDir = options.cacheDir ?? getDefaultCacheDir();
		this._maxCacheSizeBytes = options.maxCacheSizeBytes ?? DEFAULT_MAX_CACHE_SIZE;
	}

	get cacheDir(): string {
		return this._cacheDir;
	}

	getCachePath(extensionId: string): string {
		return join(this._cacheDir, `${sanitizeExtensionId(extensionId)}${CACHE_FILE_EXTENSION}`);
	}

	async write(extensionId: string, data: Uint8Array): Promise<string> {
		await mkdir(this._cacheDir, { recursive: true });
		const path = this.getCachePath(extensionId);
		await writeFile(path, data);
		this._onDidUpdate.fire(extensionId);
		return path;
	}

	async read(extensionId: string): Promise<Uint8Array | null> {
		try {
			const bytes = await readFile(this.getCachePath(extensionId));
			return new Uint8Array(bytes);
		} catch {
			return null;
		}
	}

	async has(extensionId: string): Promise<boolean> {
		try {
			await stat(this.getCachePath(extensionId));
			return true;
		} catch {
			return false;
		}
	}

	async delete(extensionId: string): Promise<boolean> {
		try {
			await unlink(this.getCachePath(extensionId));
			this._onDidUpdate.fire(extensionId);
			return true;
		} catch {
			return false;
		}
	}

	async clear(): Promise<number> {
		let removed = 0;
		try {
			const files = await readdir(this._cacheDir);
			for (const file of files) {
				if (file.endsWith(CACHE_FILE_EXTENSION)) {
					await unlink(join(this._cacheDir, file)).catch(() => undefined);
					removed++;
				}
			}
		} catch {
			return 0;
		}
		return removed;
	}

	async size(): Promise<number> {
		const entries = await this.listEntries();
		return entries.reduce((sum, entry) => sum + entry.size, 0);
	}

	async listEntries(): Promise<IV8CacheEntry[]> {
		const entries: IV8CacheEntry[] = [];
		try {
			const files = await readdir(this._cacheDir);
			for (const file of files) {
				if (!file.endsWith(CACHE_FILE_EXTENSION)) {
					continue;
				}
				const info = await stat(join(this._cacheDir, file)).catch(() => null);
				if (info?.isFile()) {
					entries.push({
						name: file.slice(0, -CACHE_FILE_EXTENSION.length),
						size: info.size,
						updatedAt: info.mtimeMs
					});
				}
			}
		} catch {
			return [];
		}
		return entries.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async prune(maxBytes?: number): Promise<number> {
		const limit = maxBytes ?? this._maxCacheSizeBytes;
		let entries = await this.listEntries();
		let total = entries.reduce((sum, entry) => sum + entry.size, 0);
		let removed = 0;
		while (total > limit && entries.length > 0) {
			const oldest = entries[entries.length - 1];
			if (await this.delete(oldest.name)) {
				total -= oldest.size;
				removed++;
			}
			entries = entries.slice(0, -1);
		}
		return removed;
	}

	async writeFile(path: string, data: Uint8Array): Promise<void> {
		await mkdir(this._cacheDir, { recursive: true });
		await writeFile(join(this._cacheDir, path), data);
	}

	async clearAll(): Promise<void> {
		await rm(this._cacheDir, { recursive: true, force: true });
	}

	stats(): { extensionId: string; size: number }[] {
		void 0;
		return [];
	}
}
