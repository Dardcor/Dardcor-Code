/**
 * Dardcor Code - SQLite Desktop Storage Backend (Task 111)
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { IStorageService, IStorageChangeEvent, StorageScope, StorageTarget } from './storage-service.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

type DatabaseSync = {
	exec(sql: string): void;
	prepare(sql: string): {
		all(...params: any[]): any[];
		run(...params: any[]): { changes: number | bigint };
		get(...params: any[]): any;
	};
	close(): void;
};

interface StorageRow {
	scope: number;
	key: string;
	value: string;
}

export class SqliteStorageService extends Disposable implements IStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _cache = new Map<number, Map<string, string>>();
	private _db: DatabaseSync | null = null;
	private _sqliteAvailable = false;
	private _pendingStores: [number, string, string][] = [];
	private readonly _ready: Promise<void>;

	private readonly _onDidChangeStorage = this._register(new Emitter<IStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	constructor(private readonly _databasePath: string) {
		super();
		this._ready = this._open();
	}

	public isAvailable(): boolean {
		return this._sqliteAvailable;
	}

	public getDatabasePath(): string {
		return this._databasePath;
	}

	public get(key: string, scope: StorageScope, fallbackValue: string): string;
	public get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;
	public get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
		return this._map(scope).get(key) ?? fallbackValue;
	}

	public getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean {
		const value = this.get(key, scope);
		return value !== undefined ? value === 'true' : fallbackValue;
	}

	public getNumber(key: string, scope: StorageScope, fallbackValue: number): number {
		const value = this.get(key, scope);
		return value !== undefined ? Number(value) : fallbackValue;
	}

	public store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope, _target: StorageTarget): void {
		if (value === undefined || value === null) {
			this.remove(key, scope);
			return;
		}
		const strValue = String(value);
		this._map(scope).set(key, strValue);
		this._queueStore(scope, key, strValue);
		this._onDidChangeStorage.fire({ key, scope });
	}

	public remove(key: string, scope: StorageScope): void {
		if (!this._map(scope).delete(key)) {
			return;
		}
		this._queueRemove(scope, key);
		this._onDidChangeStorage.fire({ key, scope });
	}

	public override dispose(): void {
		this._db?.close();
		this._db = null;
		super.dispose();
	}

	private async _open(): Promise<void> {
		try {
			const mod = await import('node:sqlite');
			const DatabaseSyncCtor = (mod as any).DatabaseSync;
			if (typeof DatabaseSyncCtor !== 'function') {
				throw new Error('node:sqlite is not available');
			}
			await fs.mkdir(dirname(this._databasePath), { recursive: true });
			const db = new DatabaseSyncCtor(this._databasePath) as DatabaseSync;
			db.exec('PRAGMA journal_mode = WAL;');
			db.exec('PRAGMA synchronous = NORMAL;');
			db.exec(
				'CREATE TABLE IF NOT EXISTS storage_items (' +
				'scope INTEGER NOT NULL, ' +
				'key TEXT NOT NULL, ' +
				'value TEXT NOT NULL, ' +
				'PRIMARY KEY (scope, key));'
			);

			const rows = db.prepare('SELECT scope, key, value FROM storage_items;').all() as StorageRow[];
			for (const row of rows) {
				this._map(row.scope).set(row.key, row.value);
			}

			const upsert = db.prepare(
				'INSERT INTO storage_items (scope, key, value) VALUES (?, ?, ?) ' +
				'ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value;'
			);
			const removeStmt = db.prepare('DELETE FROM storage_items WHERE scope = ? AND key = ?;');
			for (const [scope, key, value] of this._pendingStores) {
				upsert.run(scope, key, value);
			}
			this._pendingStores = [];

			this._db = db;
			this._sqliteAvailable = true;
		} catch {
			// Fallback: memory-only mode (graceful degradation).
			this._db = null;
			this._sqliteAvailable = false;
			this._pendingStores = [];
		}
	}

	private _queueStore(scope: StorageScope, key: string, value: string): void {
		this._ready.then(() => {
			if (!this._db) {
				return;
			}
			try {
				this._db!.prepare(
					'INSERT INTO storage_items (scope, key, value) VALUES (?, ?, ?) ' +
					'ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value;'
				).run(scope, key, value);
			} catch {
				// Persistence failure is non-fatal; cache stays authoritative.
			}
		});
	}

	private _queueRemove(scope: StorageScope, key: string): void {
		this._ready.then(() => {
			if (!this._db) {
				return;
			}
			try {
				this._db!.prepare('DELETE FROM storage_items WHERE scope = ? AND key = ?;').run(scope, key);
			} catch {
				// Ignore.
			}
		});
	}

	private _map(scope: StorageScope): Map<string, string> {
		let map = this._cache.get(scope);
		if (!map) {
			map = new Map<string, string>();
			this._cache.set(scope, map);
		}
		return map;
	}
}
