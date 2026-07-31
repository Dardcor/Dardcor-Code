import * as fs from 'node:fs';
import * as path from 'node:path';

export interface IExtensionCacheEntry {
	readonly key: string;
	readonly code: string;
	readonly filePath: string;
	readonly mtime: number;
	readonly size: number;
}

export class ExtensionCache {
	private readonly _entries = new Map<string, IExtensionCacheEntry>();
	private readonly _byPath = new Map<string, IExtensionCacheEntry>();

	public getCacheKey(filePath: string): string {
		const mtime = this._mtime(filePath);
		return `${path.normalize(filePath).replace(/\\/g, '/')}:${mtime}`;
	}

	public has(filePath: string): boolean {
		const current = this.getCacheKey(filePath);
		const entry = this._byPath.get(filePath);
		if (!entry) {
			return false;
		}
		if (entry.key !== current) {
			this._invalidate(filePath);
			return false;
		}
		return true;
	}

	public get(filePath: string): string | undefined {
		const current = this.getCacheKey(filePath);
		const entry = this._byPath.get(filePath);
		if (!entry || entry.key !== current) {
			return undefined;
		}
		return entry.code;
	}

	public set(filePath: string, code: string): void {
		this._invalidate(filePath);
		const mtime = this._mtime(filePath);
		const key = this.getCacheKey(filePath);
		const entry: IExtensionCacheEntry = { key, code, filePath, mtime, size: code.length };
		this._entries.set(key, entry);
		this._byPath.set(filePath, entry);
	}

	public delete(filePath: string): void {
		this._invalidate(filePath);
	}

	public clear(): void {
		this._entries.clear();
		this._byPath.clear();
	}

	public get size(): number {
		return this._byPath.size;
	}

	public getStats(): { entries: number; totalBytes: number } {
		let totalBytes = 0;
		for (const [, entry] of this._byPath) {
			totalBytes += entry.size;
		}
		return { entries: this._byPath.size, totalBytes };
	}

	public getEntry(filePath: string): IExtensionCacheEntry | undefined {
		const entry = this._byPath.get(filePath);
		if (!entry || entry.key !== this.getCacheKey(filePath)) {
			return undefined;
		}
		return entry;
	}

	private _mtime(filePath: string): number {
		try {
			return fs.statSync(filePath).mtimeMs;
		} catch {
			return 0;
		}
	}

	private _invalidate(filePath: string): void {
		const entry = this._byPath.get(filePath);
		if (entry) {
			this._entries.delete(entry.key);
			this._byPath.delete(filePath);
		}
	}
}
