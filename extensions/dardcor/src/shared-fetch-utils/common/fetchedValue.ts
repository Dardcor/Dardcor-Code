/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FetchBlockedError } from './fetchTypes';

export interface FetchedValueOptions<T> {
	fetch: () => Promise<T>;

	isStale: (value: T) => boolean;

	keepCacheHot?: boolean;
}

export class FetchedValue<T> {
	private _value: T | undefined;
	private _hasFetched = false;
	private _inflightFetch: Promise<T> | undefined;
	private _disposed = false;
	private _keepCacheHotTimer: ReturnType<typeof setInterval> | undefined;

	private _fetch: (() => Promise<T>) | undefined;
	private readonly _isStale: (value: T) => boolean;

	constructor(options: FetchedValueOptions<T>) {
		this._fetch = options.fetch;
		this._isStale = options.isStale;
		if (options.keepCacheHot) {
			this._keepCacheHotTimer = setInterval(() => {
				this.resolve().catch(() => { });
			}, 60_000);
		}
	}

	get value(): T | undefined {
		return this._value;
	}

	async resolve(force?: boolean): Promise<T> {
		this._throwIfDisposed();
		if (!force && this._hasFetched && !this._isStale(this._value as T)) {
			return this._value as T;
		}
		if (this._inflightFetch) {
			return this._inflightFetch;
		}
		this._inflightFetch = this._doFetch();
		try {
			return await this._inflightFetch;
		} finally {
			this._inflightFetch = undefined;
		}
	}

	dispose(): void {
		this._disposed = true;
		this._value = undefined;
		this._hasFetched = false;
		this._inflightFetch = undefined;
		this._fetch = undefined;
		if (this._keepCacheHotTimer !== undefined) {
			clearInterval(this._keepCacheHotTimer);
			this._keepCacheHotTimer = undefined;
		}
	}

	private async _doFetch(): Promise<T> {
		this._throwIfDisposed();
		try {
			const newValue = await this._fetch!();
			this._throwIfDisposed();
			this._value = newValue;
			this._hasFetched = true;
			return newValue;
		} catch (err) {
			if (err instanceof FetchBlockedError && this._hasFetched) {
				return this._value as T;
			}
			throw err;
		}
	}

	private _throwIfDisposed(): void {
		if (this._disposed) {
			throw new Error('FetchedValue has been disposed');
		}
	}
}


