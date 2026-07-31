/**
 * Dardcor Code - LRU Cache
 */

import { Emitter, Event } from '../events/emitter.js';

export class LRUCache<K, V> {
	private _limit: number;
	private _items = new Map<K, V>();
	private readonly _onDidEvict = new Emitter<{ key: K; value: V }>();

	readonly onDidEvict: Event<{ key: K; value: V }> = this._onDidEvict.event;

	constructor(limit: number) {
		this._limit = limit;
	}

	get limit(): number {
		return this._limit;
	}

	set limit(limit: number) {
		this._limit = limit;
		this._checkTrim();
	}

	get size(): number {
		return this._items.size;
	}

	public get(key: K): V | undefined {
		const value = this._items.get(key);
		if (value !== undefined) {
			this._items.delete(key);
			this._items.set(key, value);
		}
		return value;
	}

	public set(key: K, value: V): this {
		if (this._items.has(key)) {
			this._items.delete(key);
		}
		this._items.set(key, value);
		this._checkTrim();
		return this;
	}

	public has(key: K): boolean {
		return this._items.has(key);
	}

	public delete(key: K): boolean {
		return this._items.delete(key);
	}

	public clear(): void {
		this._items.clear();
	}

	private _checkTrim(): void {
		while (this._items.size > this._limit) {
			const firstKey = this._items.keys().next().value;
			if (firstKey !== undefined) {
				const value = this._items.get(firstKey)!;
				this._items.delete(firstKey);
				this._onDidEvict.fire({ key: firstKey, value });
			}
		}
	}
}
