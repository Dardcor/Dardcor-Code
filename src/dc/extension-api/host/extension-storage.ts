/**
 * Dardcor Code - Extension Persistent State JSON Storage Proxy (Task 619)
 * Mirrors: vs/platform/state/common/state.ts (global/workspace memento)
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export enum StorageScope {
	GLOBAL = 'global',
	WORKSPACE = 'workspace'
}

/**
 * JSON-file backed key/value store for extension persisted state.
 * Reads synchronously at construction, writes are queued and flushed
 * to disk (debounced) to avoid per-key file I/O.
 */
export class ExtensionStorage extends Disposable {
	private readonly _data = new Map<string, any>();
	private _dirty = false;
	private _flushScheduled = false;
	private _filePath: string;

	private readonly _onDidChange = this._register(new Emitter<{ key: string; value: any }>());
	readonly onDidChange: Event<{ key: string; value: any }> = this._onDidChange.event;

	constructor(filePath: string, defaults?: Record<string, any>) {
		super();
		this._filePath = filePath;
		if (defaults) {
			for (const [key, value] of Object.entries(defaults)) {
				this._data.set(key, value);
			}
		}
		this._load();
	}

	public get keys(): string[] {
		return [...this._data.keys()];
	}

	public get size(): number {
		return this._data.size;
	}

	public get<T>(key: string, defaultValue?: T): T | undefined {
		if (this._data.has(key)) {
			return this._data.get(key) as T;
		}
		return defaultValue;
	}

	public async update(key: string, value: any): Promise<void> {
		if (value === undefined) {
			this._data.delete(key);
		} else {
			this._data.set(key, value);
		}
		this._dirty = true;
		this._onDidChange.fire({ key, value });
		this._scheduleFlush();
	}

	public clear(): Promise<void> {
		this._data.clear();
		this._dirty = true;
		return this.flush();
	}

	public async flush(): Promise<void> {
		if (!this._dirty) {
			return;
		}
		this._dirty = false;
		this._flushScheduled = false;
		try {
			const payload = JSON.stringify(Object.fromEntries(this._data), null, '\t');
			await fsp.mkdir(path.dirname(this._filePath), { recursive: true });
			await fsp.writeFile(this._filePath, payload, 'utf8');
		} catch (err) {
			this._dirty = true;
			throw err;
		}
	}

	public override dispose(): void {
		if (this._dirty) {
			this.flush().catch(() => undefined);
		}
		super.dispose();
	}

	private _scheduleFlush(): void {
		if (this._flushScheduled) {
			return;
		}
		this._flushScheduled = true;
		setTimeout(() => {
			this.flush().catch(err => {
				console.error('[extension-storage] Gagal menulis state:', err);
				this._flushScheduled = false;
			});
		}, 250);
	}

	private _load(): void {
		try {
			const raw = fs.readFileSync(this._filePath, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
				for (const [key, value] of Object.entries(parsed)) {
					if (!this._data.has(key)) {
						this._data.set(key, value);
					}
				}
			}
		} catch {
			// file belum ada / tidak valid -> mulai kosong
		}
	}
}

export interface IStoragePaths {
	readonly globalStoragePath: string;
	readonly workspaceStoragePath: string;
}

export function createExtensionStoragePair(paths: IStoragePaths, extensionId: string): {
	global: ExtensionStorage;
	workspace: ExtensionStorage;
} {
	const safeId = extensionId.replace(/[^a-zA-Z0-9._-]/g, '_');
	return {
		global: new ExtensionStorage(path.join(paths.globalStoragePath, `${safeId}.json`)),
		workspace: new ExtensionStorage(path.join(paths.workspaceStoragePath, `${safeId}.json`))
	};
}
