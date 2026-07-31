/**
 * Dardcor Code - WeakRef Cache Map (Task 57)
 * Mirrors: vs/base/common/cache.ts
 */

export class LRUCachedFunction<TArg, TComputed> {
	private readonly _map = new Map<TArg, TComputed>();
	private readonly _maxSize: number;
	private readonly _fn: (arg: TArg) => TComputed;

	constructor(fn: (arg: TArg) => TComputed, maxSize: number = 100) {
		this._fn = fn;
		this._maxSize = maxSize;
	}

	get(arg: TArg): TComputed {
		if (this._map.has(arg)) {
			const val = this._map.get(arg)!;
			// Move to end (most recently used)
			this._map.delete(arg);
			this._map.set(arg, val);
			return val;
		}
		const computed = this._fn(arg);
		this._map.set(arg, computed);
		if (this._map.size > this._maxSize) {
			// Evict oldest
			const firstKey = this._map.keys().next().value;
			if (firstKey !== undefined) {
				this._map.delete(firstKey);
			}
		}
		return computed;
	}

	clear(): void {
		this._map.clear();
	}
}

export class CachedFunction<TArg, TComputed> {
	private readonly _map = new Map<TArg, TComputed>();
	private readonly _fn: (arg: TArg) => TComputed;

	constructor(fn: (arg: TArg) => TComputed) {
		this._fn = fn;
	}

	get(arg: TArg): TComputed {
		if (this._map.has(arg)) {
			return this._map.get(arg)!;
		}
		const computed = this._fn(arg);
		this._map.set(arg, computed);
		return computed;
	}

	clear(): void {
		this._map.clear();
	}
}

export class WeakCacheMap<K extends object, V> {
	private readonly _map = new WeakMap<K, V>();
	private readonly _fn: (key: K) => V;

	constructor(fn: (key: K) => V) {
		this._fn = fn;
	}

	get(key: K): V {
		let value = this._map.get(key);
		if (value === undefined) {
			value = this._fn(key);
			this._map.set(key, value);
		}
		return value;
	}
}
