/**
 * Dardcor Code - IndexedDB Browser Storage Backend (Task 112)
 */

import { IStorageService, IStorageChangeEvent, StorageScope, StorageTarget } from './storage-service.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

const STORE_NAMES: Record<number, string> = {
	[StorageScope.GLOBAL]: 'global',
	[StorageScope.WORKSPACE]: 'workspace',
	[StorageScope.PROFILE]: 'profile'
};

interface IndexedDbRecord {
	key: string;
	value: string;
}

export class IndexedDbStorageService extends Disposable implements IStorageService {
	declare readonly _serviceBrand: undefined;

	private readonly _cache = new Map<number, Map<string, string>>();
	private _database: IDBDatabase | null = null;
	private _idbAvailable = false;
	private readonly _ready: Promise<void>;

	private readonly _onDidChangeStorage = this._register(new Emitter<IStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	constructor(private readonly _databaseName: string = 'dardcor-code') {
		super();
		this._ready = this._open();
	}

	public isAvailable(): boolean {
		return this._idbAvailable;
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
		this._ready.then(() => this._write(scope, key, strValue));
		this._onDidChangeStorage.fire({ key, scope });
	}

	public remove(key: string, scope: StorageScope): void {
		if (!this._map(scope).delete(key)) {
			return;
		}
		this._ready.then(() => this._remove(scope, key));
		this._onDidChangeStorage.fire({ key, scope });
	}

	public override dispose(): void {
		this._database?.close();
		this._database = null;
		super.dispose();
	}

	private async _open(): Promise<void> {
		if (typeof indexedDB === 'undefined') {
			return; // Memory-only mode.
		}
		this._database = await this._openDatabase();
		if (!this._database) {
			return;
		}
		this._idbAvailable = true;
		for (const scope of Object.keys(STORE_NAMES).map(Number)) {
			const records = await this._readAll(scope);
			const map = this._map(scope);
			for (const record of records) {
				map.set(record.key, record.value);
			}
		}
	}

	private _openDatabase(): Promise<IDBDatabase | null> {
		return new Promise((resolve) => {
			try {
				const request = indexedDB.open(this._databaseName, 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					for (const name of Object.values(STORE_NAMES)) {
						if (!db.objectStoreNames.contains(name)) {
							db.createObjectStore(name, { keyPath: 'key' });
						}
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
				request.onblocked = () => resolve(null);
			} catch {
				resolve(null);
			}
		});
	}

	private _readAll(scope: StorageScope): Promise<IndexedDbRecord[]> {
		const db = this._database;
		if (!db) {
			return Promise.resolve([]);
		}
		return new Promise((resolve) => {
			try {
				const tx = db.transaction(STORE_NAMES[scope], 'readonly');
				const req = tx.objectStore(STORE_NAMES[scope]).getAll();
				req.onsuccess = () => resolve((req.result as IndexedDbRecord[]) ?? []);
				req.onerror = () => resolve([]);
			} catch {
				resolve([]);
			}
		});
	}

	private _write(scope: StorageScope, key: string, value: string): void {
		const db = this._database;
		if (!db) {
			return;
		}
		try {
			const tx = db.transaction(STORE_NAMES[scope], 'readwrite');
			tx.objectStore(STORE_NAMES[scope]).put({ key, value } satisfies IndexedDbRecord);
		} catch {
			// Ignore persistence failures; cache remains authoritative.
		}
	}

	private _remove(scope: StorageScope, key: string): void {
		const db = this._database;
		if (!db) {
			return;
		}
		try {
			const tx = db.transaction(STORE_NAMES[scope], 'readwrite');
			tx.objectStore(STORE_NAMES[scope]).delete(key);
		} catch {
			// Ignore.
		}
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
