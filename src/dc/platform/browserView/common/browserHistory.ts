/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { StringSHA1 } from '../../../base/common/hash.js';
import { Disposable } from '../../../base/common/lifecycle.js';

export interface ISerializedBrowserHistoryEntry {
	readonly id: number;
	readonly url: string;
	readonly time: number;
	readonly title: string;
	readonly icon?: string;
	readonly explicit?: true;
}

export interface IBrowserHistoryEntry extends ISerializedBrowserHistoryEntry { }

export interface IBrowserHistoryUpdate {
	readonly url?: string;
	readonly title?: string;
	readonly favicon?: string | null;
}

export interface IBrowserHistoryItemHandle {
	readonly id: number;
	update(patch: IBrowserHistoryUpdate): void;
	delete(): void;
}

const NOOP_HANDLE: IBrowserHistoryItemHandle = Object.freeze({
	id: -1,
	update: () => { },
	delete: () => { },
});

export interface ISerializedBrowserHistoryEntriesSnapshot {
	readonly items: readonly ISerializedBrowserHistoryEntry[];
}

export interface ISerializedBrowserFaviconsSnapshot {
	readonly map: Readonly<Record<string, string>>;
}

const DEFAULT_MAX_ENTRIES = 200;

export class BrowserHistoryEntriesStore extends Disposable {

	private _nextId: number = 1;
	private _items: IBrowserHistoryEntry[] = [];
	private _maxEntries: number;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
		super();
		this._maxEntries = maxEntries;
	}

	get items(): readonly IBrowserHistoryEntry[] {
		return this._items;
	}

	get maxEntries(): number {
		return this._maxEntries;
	}

	setMaxEntries(max: number): void {
		if (max < 0 || max === this._maxEntries) {
			return;
		}
		this._maxEntries = max;
		if (this._evictIfNeeded()) {
			this._onDidChange.fire();
		}
	}

	add(url: string, title: string, faviconHash: string | undefined, userInitiated: boolean): IBrowserHistoryEntry {
		const entry: IBrowserHistoryEntry = userInitiated
			? { id: this._nextId++, url, time: Date.now(), title, icon: faviconHash, explicit: true }
			: { id: this._nextId++, url, time: Date.now(), title, icon: faviconHash };
		this._items.push(entry);
		this._evictIfNeeded();
		this._onDidChange.fire();
		return entry;
	}

	update(id: number, patch: { url?: string; title?: string; faviconHash?: string | null }): boolean {
		const idx = this._indexOf(id);
		if (idx === -1) {
			return false;
		}
		const existing = this._items[idx];
		const nextTitle = patch.title && patch.title.length > 0 ? patch.title : existing.title;
		const nextUrl = patch.url && patch.url.length > 0 ? patch.url : existing.url;
		const nextFaviconHash = patch.faviconHash === undefined
			? existing.icon
			: (patch.faviconHash ?? undefined);
		const nextTime = patch.url ? Date.now() : existing.time;
		if (nextUrl === existing.url && nextTitle === existing.title && nextFaviconHash === existing.icon && nextTime === existing.time) {
			return false;
		}
		this._items[idx] = { ...existing, url: nextUrl, title: nextTitle, icon: nextFaviconHash, time: nextTime };
		this._onDidChange.fire();
		return true;
	}

	delete(id: number): boolean {
		const idx = this._indexOf(id);
		if (idx === -1) {
			return false;
		}
		this._items.splice(idx, 1);
		this._onDidChange.fire();
		return true;
	}

	clear(): void {
		if (this._items.length === 0 && this._nextId === 1) {
			return;
		}
		this._items = [];
		this._nextId = 1;
		this._onDidChange.fire();
	}

	serialize(): ISerializedBrowserHistoryEntriesSnapshot {
		return { items: this._items.slice() };
	}

	hydrate(snapshot: ISerializedBrowserHistoryEntriesSnapshot | undefined): void {
		this._items = [];
		this._nextId = 1;
		if (snapshot && Array.isArray(snapshot.items)) {
			for (const e of snapshot.items) {
				if (isValidEntry(e)) {
					this._items.push(e);
				}
			}
			for (const e of this._items) {
				if (e.id >= this._nextId) {
					this._nextId = e.id + 1;
				}
			}
			this._evictIfNeeded();
		}
		this._onDidChange.fire();
	}

	private _indexOf(id: number): number {
		for (let i = this._items.length - 1; i >= 0; i--) {
			if (this._items[i].id === id) {
				return i;
			}
		}
		return -1;
	}

	private _evictIfNeeded(): boolean {
		if (this._items.length > this._maxEntries) {
			this._items.splice(0, this._items.length - this._maxEntries);
			return true;
		}
		return false;
	}
}

export class BrowserFaviconsStore extends Disposable {

	private readonly _byHash = new Map<string, string>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	get(hash: string): string | undefined {
		return this._byHash.get(hash);
	}

	register(dataUri: string): string {
		const sha = new StringSHA1();
		sha.update(dataUri);
		const hash = sha.digest();
		if (!this._byHash.has(hash)) {
			this._byHash.set(hash, dataUri);
			this._onDidChange.fire();
		}
		return hash;
	}

	gc(referenced: ReadonlySet<string>): void {
		if (this._byHash.size === 0) {
			return;
		}
		let changed = false;
		for (const hash of this._byHash.keys()) {
			if (!referenced.has(hash)) {
				this._byHash.delete(hash);
				changed = true;
			}
		}
		if (changed) {
			this._onDidChange.fire();
		}
	}

	clear(): void {
		if (this._byHash.size === 0) {
			return;
		}
		this._byHash.clear();
		this._onDidChange.fire();
	}

	serialize(): ISerializedBrowserFaviconsSnapshot {
		return { map: Object.fromEntries(this._byHash) };
	}

	hydrate(snapshot: ISerializedBrowserFaviconsSnapshot | undefined): void {
		this._byHash.clear();
		if (snapshot?.map && typeof snapshot.map === 'object') {
			for (const [k, v] of Object.entries(snapshot.map)) {
				if (typeof v === 'string') {
					this._byHash.set(k, v);
				}
			}
		}
		this._onDidChange.fire();
	}
}

export class BrowserHistoryStore extends Disposable {

	readonly entries: BrowserHistoryEntriesStore;
	readonly favicons: BrowserFaviconsStore;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(maxEntries?: number) {
		super();
		this.entries = this._register(new BrowserHistoryEntriesStore(maxEntries));
		this.favicons = this._register(new BrowserFaviconsStore());

		this._register(this.entries.onDidChange(() => {
			this._gcFavicons();
			this._onDidChange.fire();
		}));
		this._register(this.favicons.onDidChange(() => this._onDidChange.fire()));
	}

	add(url: string, title: string, favicon?: string, userInitiated = false): IBrowserHistoryItemHandle {
		if (this.entries.maxEntries === 0) {
			return NOOP_HANDLE;
		}
		const faviconHash = favicon ? this.favicons.register(favicon) : undefined;
		const entry = this.entries.add(url, title, faviconHash, userInitiated);
		return this._handleFor(entry.id);
	}

	setMaxEntries(max: number): void {
		this.entries.setMaxEntries(max);
	}

	clear(): void {
		this.entries.clear();
		this.favicons.clear();
	}

	private _handleFor(id: number): IBrowserHistoryItemHandle {
		return {
			id,
			update: patch => {
				const next: { url?: string; title?: string; faviconHash?: string | null } = {};
				if (patch.url !== undefined) {
					next.url = patch.url;
				}
				if (patch.title !== undefined) {
					next.title = patch.title;
				}
				if (patch.favicon !== undefined) {
					next.faviconHash = patch.favicon === null ? null : this.favicons.register(patch.favicon);
				}
				this.entries.update(id, next);
			},
			delete: () => {
				this.entries.delete(id);
			},
		};
	}

	private _gcFavicons(): void {
		const referenced = new Set<string>();
		for (const e of this.entries.items) {
			if (e.icon) {
				referenced.add(e.icon);
			}
		}
		this.favicons.gc(referenced);
	}
}

function isValidEntry(value: unknown): value is ISerializedBrowserHistoryEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const e = value as ISerializedBrowserHistoryEntry;
	return typeof e.id === 'number'
		&& typeof e.url === 'string'
		&& typeof e.time === 'number'
		&& typeof e.title === 'string'
		&& (e.icon === undefined || typeof e.icon === 'string')
		&& (e.explicit === undefined || e.explicit === true);
}
