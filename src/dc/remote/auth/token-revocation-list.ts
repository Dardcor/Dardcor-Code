import { createHash } from 'node:crypto';
import { Emitter, Event } from '../../core/events/emitter';

export interface IRevocationEntry {
	readonly hash: string;
	readonly revokedAt: number;
	readonly expiresAt: number | null;
	readonly reason?: string;
}

export interface ITokenRevocationListOptions {
	readonly defaultTtlMs?: number;
	readonly maxEntries?: number;
}

export interface ITokenRevocationListStats {
	readonly size: number;
	readonly totalRevoked: number;
	readonly totalExpired: number;
}

export function sha256Hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function sha256HexGuarded(value: string): string {
	if (typeof createHash === 'function') {
		return sha256Hex(value);
	}
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export class TokenRevocationList {
	private readonly _entries = new Map<string, IRevocationEntry>();
	private readonly _defaultTtlMs: number;
	private readonly _maxEntries: number;

	private _totalRevoked = 0;
	private _totalExpired = 0;

	private readonly _onDidRevoke = new Emitter<string>();
	readonly onDidRevoke: Event<string> = this._onDidRevoke.event;

	constructor(options: ITokenRevocationListOptions = {}) {
		this._defaultTtlMs = options.defaultTtlMs ?? 24 * 60 * 60 * 1000;
		this._maxEntries = options.maxEntries ?? 100000;
	}

	get size(): number {
		return this._entries.size;
	}

	revoke(token: string, ttlMs?: number | null, reason?: string): void {
		this.purgeExpired();
		const hash = this._hash(token);
		if (this._entries.has(hash)) {
			return;
		}
		this._entries.set(hash, {
			hash,
			revokedAt: Date.now(),
			expiresAt: ttlMs === null ? null : Date.now() + (ttlMs ?? this._defaultTtlMs),
			reason
		});
		this._totalRevoked++;
		this._onDidRevoke.fire(hash);
	}

	revokeJti(jti: string): void {
		this.revoke(jti);
	}

	isRevoked(token: string): boolean {
		const entry = this._entries.get(this._hash(token));
		if (!entry) {
			return false;
		}
		if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
			this._entries.delete(entry.hash);
			this._totalExpired++;
			return false;
		}
		return true;
	}

	has(token: string): boolean {
		return this.isRevoked(token);
	}

	getEntry(token: string): IRevocationEntry | undefined {
		const entry = this._entries.get(this._hash(token));
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
			this._entries.delete(entry.hash);
			this._totalExpired++;
			return undefined;
		}
		return { ...entry };
	}

	unrevoke(token: string): boolean {
		return this._entries.delete(this._hash(token));
	}

	purgeExpired(): number {
		const now = Date.now();
		let purged = 0;
		for (const [hash, entry] of this._entries) {
			if (entry.expiresAt !== null && entry.expiresAt <= now) {
				this._entries.delete(hash);
				purged++;
			}
		}
		this._totalExpired += purged;
		return purged;
	}

	containsHash(hash: string): boolean {
		const entry = this._entries.get(hash);
		if (!entry) {
			return false;
		}
		if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
			this._entries.delete(hash);
			this._totalExpired++;
			return false;
		}
		return true;
	}

	list(): IRevocationEntry[] {
		this.purgeExpired();
		return [...this._entries.values()]
			.sort((a, b) => a.revokedAt - b.revokedAt)
			.map(entry => ({ ...entry }));
	}

	getStats(): ITokenRevocationListStats {
		return {
			size: this._entries.size,
			totalRevoked: this._totalRevoked,
			totalExpired: this._totalExpired
		};
	}

	clear(): void {
		this._entries.clear();
	}

	toJson(): string {
		return JSON.stringify({
			stats: this.getStats(),
			entries: this.list()
		});
	}

	private _hash(token: string): string {
		return sha256HexGuarded(token);
	}
}
