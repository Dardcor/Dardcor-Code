import { Emitter, Event } from '../../core/events/emitter';
import { URI } from '../../core/types/uri';

export interface IStatCacheEntry<T = unknown> {
	readonly stat: T;
	readonly expiresAt: number;
}

export interface IStatCacheOptions {
	readonly defaultTtlMs?: number;
	readonly maxEntries?: number;
}

export interface ICacheInvalidateEvent {
	readonly uri: string;
	readonly reason: 'expired' | 'manual' | 'overwrite' | 'clear';
}

export class RemoteFileStatCache<T = unknown> {
	private readonly _entries = new Map<string, IStatCacheEntry<T>>();
	private readonly _defaultTtlMs: number;
	private readonly _maxEntries: number;

	private readonly _onDidInvalidate = new Emitter<ICacheInvalidateEvent>();
	readonly onDidInvalidate: Event<ICacheInvalidateEvent> = this._onDidInvalidate.event;

	constructor(options: IStatCacheOptions = {}) {
		this._defaultTtlMs = options.defaultTtlMs ?? 30000;
		this._maxEntries = options.maxEntries ?? 10000;
	}

	get size(): number {
		return this._entries.size;
	}

	get(uri: URI | string): T | undefined {
		const key = this._key(uri);
		const entry = this._entries.get(key);
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt <= Date.now()) {
			this._entries.delete(key);
			this._onDidInvalidate.fire({ uri: key, reason: 'expired' });
			return undefined;
		}
		return entry.stat;
	}

	peek(uri: URI | string): T | undefined {
		return this._entries.get(this._key(uri))?.stat;
	}

	set(uri: URI | string, stat: T, ttlMs?: number): void {
		const key = this._key(uri);
		const expiresAt = Date.now() + (ttlMs ?? this._defaultTtlMs);
		const previous = this._entries.get(key);
		this._entries.set(key, { stat, expiresAt });
		if (this._entries.size > this._maxEntries) {
			this._evictOldest();
		}
		if (previous) {
			this._onDidInvalidate.fire({ uri: key, reason: 'overwrite' });
		}
	}

	invalidate(uri: URI | string): boolean {
		const key = this._key(uri);
		if (!this._entries.delete(key)) {
			return false;
		}
		this._onDidInvalidate.fire({ uri: key, reason: 'manual' });
		return true;
	}

	invalidateAll(): number {
		const count = this._entries.size;
		if (count === 0) {
			return 0;
		}
		const keys = [...this._entries.keys()];
		this._entries.clear();
		for (const key of keys) {
			this._onDidInvalidate.fire({ uri: key, reason: 'clear' });
		}
		return count;
	}

	purgeExpired(): number {
		const now = Date.now();
		let purged = 0;
		for (const [key, entry] of this._entries) {
			if (entry.expiresAt <= now) {
				this._entries.delete(key);
				this._onDidInvalidate.fire({ uri: key, reason: 'expired' });
				purged++;
			}
		}
		return purged;
	}

	has(uri: URI | string): boolean {
		return this.get(uri) !== undefined;
	}

	getRemainingTtl(uri: URI | string): number | null {
		const entry = this._entries.get(this._key(uri));
		if (!entry) {
			return null;
		}
		return Math.max(0, entry.expiresAt - Date.now());
	}

	getKeys(): string[] {
		return [...this._entries.keys()];
	}

	entries(): Array<{ uri: string; stat: T }> {
		this.purgeExpired();
		return [...this._entries.entries()].map(([uri, entry]) => ({ uri, stat: entry.stat }));
	}

	refresh(uri: URI | string, ttlMs?: number): boolean {
		const key = this._key(uri);
		const entry = this._entries.get(key);
		if (!entry) {
			return false;
		}
		(entry as any).expiresAt = Date.now() + (ttlMs ?? this._defaultTtlMs);
		return true;
	}

	clear(): void {
		this.invalidateAll();
	}

	private _evictOldest(): void {
		let oldestKey: string | null = null;
		let oldestExpiry = Infinity;
		for (const [key, entry] of this._entries) {
			if (entry.expiresAt < oldestExpiry) {
				oldestExpiry = entry.expiresAt;
				oldestKey = key;
			}
		}
		if (oldestKey) {
			this._entries.delete(oldestKey);
			this._onDidInvalidate.fire({ uri: oldestKey, reason: 'expired' });
		}
	}

	private _key(uri: URI | string): string {
		return uri instanceof URI ? uri.toString() : uri;
	}
}
