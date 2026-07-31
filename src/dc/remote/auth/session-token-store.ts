import { randomBytes, createHash } from 'node:crypto';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ISessionToken {
	readonly userId: string;
	readonly expiresAt: number;
	readonly scopes: string[];
	readonly createdAt: number;
	readonly lastUsedAt: number;
}

export interface ISessionTokenStoreOptions {
	readonly tokenLengthBytes?: number;
	readonly defaultTtlMs?: number;
}

export interface ISessionValidationResult {
	readonly valid: boolean;
	readonly userId?: string;
	readonly scopes?: string[];
	readonly reason?: string;
	readonly expiresAt?: number;
}

export function generateSessionToken(byteLength = 32): string {
	return randomBytes(byteLength).toString('base64url');
}

export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export class SessionTokenStore {
	private readonly _tokens = new Map<string, ISessionToken>();
	private readonly _tokenLengthBytes: number;
	private readonly _defaultTtlMs: number;

	private readonly _onDidCreate = new Emitter<{ tokenHash: string; userId: string }>();
	readonly onDidCreate: Event<{ tokenHash: string; userId: string }> = this._onDidCreate.event;

	private readonly _onDidRevoke = new Emitter<string>();
	readonly onDidRevoke: Event<string> = this._onDidRevoke.event;

	constructor(options: ISessionTokenStoreOptions = {}) {
		this._tokenLengthBytes = options.tokenLengthBytes ?? 32;
		this._defaultTtlMs = options.defaultTtlMs ?? 12 * 60 * 60 * 1000;
	}

	get count(): number {
		return this._tokens.size;
	}

	create(userId: string, scopes: string[] = [], ttlMs?: number): string {
		const token = generateSessionToken(this._tokenLengthBytes);
		const now = Date.now();
		const record: ISessionToken = {
			userId,
			scopes: [...scopes],
			createdAt: now,
			lastUsedAt: now,
			expiresAt: now + (ttlMs ?? this._defaultTtlMs)
		};
		this._tokens.set(hashSessionToken(token), record);
		this._onDidCreate.fire({ tokenHash: hashSessionToken(token), userId });
		return token;
	}

	validate(token: string | null | undefined): ISessionValidationResult {
		if (!token) {
			return { valid: false, reason: 'missing token' };
		}
		const hash = hashSessionToken(token);
		const record = this._tokens.get(hash);
		if (!record) {
			return { valid: false, reason: 'unknown token' };
		}
		if (record.expiresAt <= Date.now()) {
			this._tokens.delete(hash);
			return { valid: false, reason: 'token expired' };
		}
		record.lastUsedAt = Date.now();
		return {
			valid: true,
			userId: record.userId,
			scopes: [...record.scopes],
			expiresAt: record.expiresAt
		};
	}

	getInfo(token: string): ISessionToken | undefined {
		const record = this._tokens.get(hashSessionToken(token));
		if (!record || record.expiresAt <= Date.now()) {
			return undefined;
		}
		return { ...record, scopes: [...record.scopes] };
	}

	hasScope(token: string, scope: string): boolean {
		const record = this._tokens.get(hashSessionToken(token));
		if (!record || record.expiresAt <= Date.now()) {
			return false;
		}
		return record.scopes.includes('*') || record.scopes.includes(scope);
	}

	revoke(token: string): boolean {
		const hash = hashSessionToken(token);
		if (!this._tokens.delete(hash)) {
			return false;
		}
		this._onDidRevoke.fire(hash);
		return true;
	}

	revokeByUserId(userId: string): number {
		let revoked = 0;
		for (const [hash, record] of this._tokens) {
			if (record.userId === userId) {
				this._tokens.delete(hash);
				this._onDidRevoke.fire(hash);
				revoked++;
			}
		}
		return revoked;
	}

	purgeExpired(): number {
		const now = Date.now();
		let purged = 0;
		for (const [hash, record] of this._tokens) {
			if (record.expiresAt <= now) {
				this._tokens.delete(hash);
				purged++;
			}
		}
		return purged;
	}

	touch(token: string): boolean {
		const record = this._tokens.get(hashSessionToken(token));
		if (!record || record.expiresAt <= Date.now()) {
			return false;
		}
		record.lastUsedAt = Date.now();
		return true;
	}

	extend(token: string, ttlMs: number): boolean {
		const hash = hashSessionToken(token);
		const record = this._tokens.get(hash);
		if (!record || record.expiresAt <= Date.now()) {
			return false;
		}
		record.expiresAt = Date.now() + ttlMs;
		return true;
	}

	listTokens(userId?: string): Array<{ tokenHash: string; info: ISessionToken }> {
		const result: Array<{ tokenHash: string; info: ISessionToken }> = [];
		for (const [hash, record] of this._tokens) {
			if (userId === undefined || record.userId === userId) {
				result.push({ tokenHash: hash, info: { ...record, scopes: [...record.scopes] } });
			}
		}
		return result.sort((a, b) => a.info.expiresAt - b.info.expiresAt);
	}

	clear(): void {
		this._tokens.clear();
	}

	toJson(): string {
		return JSON.stringify({
			count: this._tokens.size,
			tokens: this.listTokens()
		});
	}
}
