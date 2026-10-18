/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class TtlCache<V> {
	private readonly _entries = new Map<string, { value: V; timestamp: number; ttlMs?: number }>();

	constructor(private readonly _ttlMs: number) { }

	get(key: string): V | undefined {
		const entry = this._entries.get(key);
		if (!entry) {
			return undefined;
		}
		const ttl = entry.ttlMs ?? this._ttlMs;
		if (Date.now() - entry.timestamp >= ttl) {
			this._entries.delete(key);
			return undefined;
		}
		return entry.value;
	}

	set(key: string, value: V, ttlMs?: number): void {
		this._entries.set(key, { value, timestamp: Date.now(), ttlMs });
	}

	delete(key: string): void {
		this._entries.delete(key);
	}

	clear(): void {
		this._entries.clear();
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}
}

export class SingleSlotTtlCache<V> {
	private _entry: { value: V; timestamp: number; key: string } | undefined;

	constructor(private readonly _ttlMs: number) { }

	get(key: string): V | undefined {
		if (!this._entry || this._entry.key !== key) {
			return undefined;
		}
		if (Date.now() - this._entry.timestamp >= this._ttlMs) {
			this._entry = undefined;
			return undefined;
		}
		return this._entry.value;
	}

	set(key: string, value: V): void {
		this._entry = { value, timestamp: Date.now(), key };
	}

	clear(): void {
		this._entry = undefined;
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}
}
