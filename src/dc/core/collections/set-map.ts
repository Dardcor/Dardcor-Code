/**
 * Dardcor Code - Set, ResourceMap & BidirectionalMap
 */

import { URI } from '../types/uri';

export class BidirectionalMap<K, V> {
	private readonly _forward = new Map<K, V>();
	private readonly _reverse = new Map<V, K>();

	public set(key: K, value: V): void {
		this._forward.set(key, value);
		this._reverse.set(value, key);
	}

	public get(key: K): V | undefined {
		return this._forward.get(key);
	}

	public getKey(value: V): K | undefined {
		return this._reverse.get(value);
	}

	public delete(key: K): boolean {
		const value = this._forward.get(key);
		if (value !== undefined) {
			this._forward.delete(key);
			this._reverse.delete(value);
			return true;
		}
		return false;
	}

	public clear(): void {
		this._forward.clear();
		this._reverse.clear();
	}
}

export class ResourceMap<V> {
	private readonly _map = new Map<string, V>();

	public set(resource: URI, value: V): this {
		this._map.set(resource.toString(), value);
		return this;
	}

	public get(resource: URI): V | undefined {
		return this._map.get(resource.toString());
	}

	public has(resource: URI): boolean {
		return this._map.has(resource.toString());
	}

	public delete(resource: URI): boolean {
		return this._map.delete(resource.toString());
	}

	public clear(): void {
		this._map.clear();
	}

	get size(): number {
		return this._map.size;
	}

	public forEach(callbackfn: (value: V, key: URI, map: ResourceMap<V>) => void, thisArg?: any): void {
		this._map.forEach((v, k) => {
			callbackfn.call(thisArg, v, URI.parse(k), this);
		});
	}

	public *entries(): IterableIterator<[URI, V]> {
		for (const [k, v] of this._map.entries()) {
			yield [URI.parse(k), v];
		}
	}

	public *keys(): IterableIterator<URI> {
		for (const k of this._map.keys()) {
			yield URI.parse(k);
		}
	}

	public values(): IterableIterator<V> {
		return this._map.values();
	}

	public [Symbol.iterator](): IterableIterator<[URI, V]> {
		return this.entries();
	}
}
