/**
 * Dardcor Code - Lazy Service Initializer (Task 156)
 * Mirrors: vs/platform/instantiation/common/instantiation.ts lazy initialization pattern
 */

export class LazyService<T> {
	private _instance: T | null = null;
	private _factory: (() => T) | null;

	constructor(factory: () => T) {
		this._factory = factory;
	}

	get value(): T {
		if (!this._instance && this._factory) {
			this._instance = this._factory();
			this._factory = null;
		}
		return this._instance!;
	}

	get isInitialized(): boolean {
		return this._instance !== null;
	}
}

export function lazy<T>(factory: () => T): LazyService<T> {
	return new LazyService<T>(factory);
}
