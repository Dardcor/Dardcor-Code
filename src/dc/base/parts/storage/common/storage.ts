/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThrottledDelayer } from '../../../common/async.js';
import { Event, PauseableEmitter } from '../../../common/event.js';
import { Disposable, IDisposable } from '../../../common/lifecycle.js';
import { parse, stringify } from '../../../common/marshalling.js';
import { isObject, isUndefined, isUndefinedOrNull } from '../../../common/types.js';

export enum StorageHint {

	STORAGE_DOES_NOT_EXIST,

	STORAGE_IN_MEMORY
}

export interface IStorageOptions {
	readonly hint?: StorageHint;
}

export interface IUpdateRequest {
	readonly insert?: Map<string, string>;
	readonly delete?: Set<string>;
}

export interface IStorageItemsChangeEvent {
	readonly changed?: Map<string, string>;
	readonly deleted?: Set<string>;
}

export function isStorageItemsChangeEvent(thing: unknown): thing is IStorageItemsChangeEvent {
	const candidate = thing as IStorageItemsChangeEvent | undefined;

	return candidate?.changed instanceof Map || candidate?.deleted instanceof Set;
}

export interface IStorageDatabase {

	readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent>;

	getItems(): Promise<Map<string, string>>;
	updateItems(request: IUpdateRequest): Promise<void>;

	optimize(): Promise<void>;

	close(recovery?: () => Map<string, string>): Promise<void>;
}

export interface IStorageChangeEvent {

	readonly key: string;

	readonly external?: boolean;
}

export type StorageValue = string | boolean | number | undefined | null | object;

export interface IStorage extends IDisposable {

	readonly onDidChangeStorage: Event<IStorageChangeEvent>;

	readonly items: Map<string, string>;
	readonly size: number;

	init(): Promise<void>;

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;

	getNumber(key: string, fallbackValue: number): number;
	getNumber(key: string, fallbackValue?: number): number | undefined;

	getObject<T extends object>(key: string, fallbackValue: T): T;
	getObject<T extends object>(key: string, fallbackValue?: T): T | undefined;

	set(key: string, value: StorageValue, external?: boolean): Promise<void>;
	delete(key: string, external?: boolean): Promise<void>;

	flush(delay?: number): Promise<void>;
	whenFlushed(): Promise<void>;

	optimize(): Promise<void>;

	close(): Promise<void>;
}

export enum StorageState {
	None,
	Initialized,
	Closed
}

export class Storage extends Disposable implements IStorage {

	private static readonly DEFAULT_FLUSH_DELAY = 100;

	private readonly _onDidChangeStorage = this._register(new PauseableEmitter<IStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	private state = StorageState.None;

	private cache = new Map<string, string>();

	private readonly flushDelayer = this._register(new ThrottledDelayer<void>(Storage.DEFAULT_FLUSH_DELAY));

	private pendingDeletes = new Set<string>();
	private pendingInserts = new Map<string, string>();

	private pendingClose: Promise<void> | undefined = undefined;

	private readonly whenFlushedCallbacks: Function[] = [];

	constructor(
		protected readonly database: IStorageDatabase,
		private readonly options: IStorageOptions = Object.create(null)
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.database.onDidChangeItemsExternal(e => this.onDidChangeItemsExternal(e)));
	}

	private onDidChangeItemsExternal(e: IStorageItemsChangeEvent): void {
		this._onDidChangeStorage.pause();

		try {

			e.changed?.forEach((value, key) => this.acceptExternal(key, value));
			e.deleted?.forEach(key => this.acceptExternal(key, undefined));

		} finally {
			this._onDidChangeStorage.resume();
		}
	}

	private acceptExternal(key: string, value: string | undefined): void {
		if (this.state === StorageState.Closed) {
			return;
		}

		let changed = false;

		if (isUndefinedOrNull(value)) {
			changed = this.cache.delete(key);
		}

		else {
			const currentValue = this.cache.get(key);
			if (currentValue !== value) {
				this.cache.set(key, value);
				changed = true;
			}
		}

		if (changed) {
			this._onDidChangeStorage.fire({ key, external: true });
		}
	}

	get items(): Map<string, string> {
		return this.cache;
	}

	get size(): number {
		return this.cache.size;
	}

	async init(): Promise<void> {
		if (this.state !== StorageState.None) {
			return;
		}

		this.state = StorageState.Initialized;

		if (this.options.hint === StorageHint.STORAGE_DOES_NOT_EXIST) {
			return;
		}

		this.cache = await this.database.getItems();
	}

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		const value = this.cache.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value;
	}

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value === 'true';
	}

	getNumber(key: string, fallbackValue: number): number;
	getNumber(key: string, fallbackValue?: number): number | undefined;
	getNumber(key: string, fallbackValue?: number): number | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return parseInt(value, 10);
	}

	getObject(key: string, fallbackValue: object): object;
	getObject(key: string, fallbackValue?: object | undefined): object | undefined;
	getObject(key: string, fallbackValue?: object): object | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return parse(value);
	}

	async set(key: string, value: string | boolean | number | null | undefined | object, external = false): Promise<void> {
		if (this.state === StorageState.Closed) {
			return;
		}

		if (isUndefinedOrNull(value)) {
			return this.delete(key, external);
		}

		const valueStr = isObject(value) || Array.isArray(value) ? stringify(value) : String(value);

		const currentValue = this.cache.get(key);
		if (currentValue === valueStr) {
			return;
		}

		this.cache.set(key, valueStr);
		this.pendingInserts.set(key, valueStr);
		this.pendingDeletes.delete(key);

		this._onDidChangeStorage.fire({ key, external });

		return this.doFlush();
	}

	async delete(key: string, external = false): Promise<void> {
		if (this.state === StorageState.Closed) {
			return;
		}

		const wasDeleted = this.cache.delete(key);
		if (!wasDeleted) {
			return;
		}

		if (!this.pendingDeletes.has(key)) {
			this.pendingDeletes.add(key);
		}

		this.pendingInserts.delete(key);

		this._onDidChangeStorage.fire({ key, external });

		return this.doFlush();
	}

	async optimize(): Promise<void> {
		if (this.state === StorageState.Closed) {
			return;
		}

		await this.flush(0);

		return this.database.optimize();
	}

	async close(): Promise<void> {
		if (!this.pendingClose) {
			this.pendingClose = this.doClose();
		}

		return this.pendingClose;
	}

	private async doClose(): Promise<void> {

		this.state = StorageState.Closed;

		try {
			await this.doFlush(0 );
		} catch {
		}

		await this.database.close(() => this.cache);
	}

	private get hasPending() {
		return this.pendingInserts.size > 0 || this.pendingDeletes.size > 0;
	}

	private async flushPending(): Promise<void> {
		if (!this.hasPending) {
			return;
		}

		const updateRequest: IUpdateRequest = { insert: this.pendingInserts, delete: this.pendingDeletes };

		this.pendingDeletes = new Set<string>();
		this.pendingInserts = new Map<string, string>();

		return this.database.updateItems(updateRequest).finally(() => {
			if (!this.hasPending) {
				while (this.whenFlushedCallbacks.length) {
					this.whenFlushedCallbacks.pop()?.();
				}
			}
		});
	}

	async flush(delay?: number): Promise<void> {
		if (
			this.state === StorageState.Closed ||
			this.pendingClose
		) {
			return;
		}

		return this.doFlush(delay);
	}

	private async doFlush(delay?: number): Promise<void> {
		if (this.options.hint === StorageHint.STORAGE_IN_MEMORY) {
			return this.flushPending();
		}

		return this.flushDelayer.trigger(() => this.flushPending(), delay);
	}

	async whenFlushed(): Promise<void> {
		if (!this.hasPending) {
			return;
		}

		return new Promise(resolve => this.whenFlushedCallbacks.push(resolve));
	}

	isInMemory(): boolean {
		return this.options.hint === StorageHint.STORAGE_IN_MEMORY;
	}
}

export class InMemoryStorageDatabase implements IStorageDatabase {

	readonly onDidChangeItemsExternal = Event.None;

	private readonly items = new Map<string, string>();

	async getItems(): Promise<Map<string, string>> {
		return this.items;
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		request.insert?.forEach((value, key) => this.items.set(key, value));

		request.delete?.forEach(key => this.items.delete(key));
	}

	async optimize(): Promise<void> { }
	async close(): Promise<void> { }
}


export const MIGRATED_KEY = '__$__migratedStorageMarker';

export class MigratingStorage extends Storage {

	private migratedKeys: Set<string> = new Set();
	private fallbackStorage: IStorage | undefined = undefined;
	private isFallbackStorageReadonly: boolean = false;

	override async init(): Promise<void> {
		await super.init();

		this.migratedKeys = this.loadMigratedKeys();
	}

	public setFallbackStorage(storage: IStorage, isReadonly: boolean): void {
		this.fallbackStorage = storage;
		this.isFallbackStorageReadonly = isReadonly;
	}

	private static readonly INTERNAL_KEY_PREFIX = '__$__';

	override get(key: string, fallbackValue: string): string;
	override get(key: string, fallbackValue?: string): string | undefined;
	override get(key: string, fallbackValue?: string): string | undefined {
		if (!key.startsWith(MigratingStorage.INTERNAL_KEY_PREFIX) && !this.migratedKeys.has(key) && isUndefined(super.get(key))) {
			this.migratedKeys.add(key);
			const value = this.fallbackStorage?.items.get(key);
			if (!isUndefined(value)) {
				this.set(key, value);
				if (!this.isFallbackStorageReadonly) {
					this.fallbackStorage?.delete(key);
				}
				this.persistMigratedKeys();
			}
		}
		return super.get(key, fallbackValue);
	}

	private loadMigratedKeys(): Set<string> {
		const raw = super.get(MIGRATED_KEY);
		if (raw) {
			try {
				return new Set(JSON.parse(raw));
			} catch {
			}
		}
		return new Set();
	}

	private persistMigratedKeys(): void {
		this.set(MIGRATED_KEY, JSON.stringify([...this.migratedKeys]));
	}
}

