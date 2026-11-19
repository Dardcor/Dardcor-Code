/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from './event';
import { DisposableStore, IDisposable } from './lifecycle';

export interface CancellationToken {

	readonly isCancellationRequested: boolean;

	readonly onCancellationRequested: (listener: (e: void) => unknown, thisArgs?: unknown, disposables?: IDisposable[]) => IDisposable;
}

const shortcutEvent: Event<void> = Object.freeze(function (callback, context?): IDisposable {
	const handle = setTimeout(callback.bind(context), 0);
	return { dispose() { clearTimeout(handle); } };
});

export namespace CancellationToken {

	export function isCancellationToken(thing: unknown): thing is CancellationToken {
		if (thing === CancellationToken.None || thing === CancellationToken.Cancelled) {
			return true;
		}
		if (thing instanceof MutableToken) {
			return true;
		}
		if (!thing || typeof thing !== 'object') {
			return false;
		}
		return typeof (thing as CancellationToken).isCancellationRequested === 'boolean'
			&& typeof (thing as CancellationToken).onCancellationRequested === 'function';
	}


	export const None = Object.freeze<CancellationToken>({
		isCancellationRequested: false,
		onCancellationRequested: Event.None
	});

	export const Cancelled = Object.freeze<CancellationToken>({
		isCancellationRequested: true,
		onCancellationRequested: shortcutEvent
	});
}

class MutableToken implements CancellationToken {

	private _isCancelled: boolean = false;
	private _emitter: Emitter<void> | null = null;

	public cancel() {
		if (!this._isCancelled) {
			this._isCancelled = true;
			if (this._emitter) {
				this._emitter.fire(undefined);
				this.dispose();
			}
		}
	}

	get isCancellationRequested(): boolean {
		return this._isCancelled;
	}

	get onCancellationRequested(): Event<void> {
		if (this._isCancelled) {
			return shortcutEvent;
		}
		if (!this._emitter) {
			this._emitter = new Emitter<void>();
		}
		return this._emitter.event;
	}

	public dispose(): void {
		if (this._emitter) {
			this._emitter.dispose();
			this._emitter = null;
		}
	}
}

export class CancellationTokenSource {

	private _token?: CancellationToken = undefined;
	private _parentListener?: IDisposable = undefined;

	constructor(parent?: CancellationToken) {
		this._parentListener = parent && parent.onCancellationRequested(this.cancel, this);
	}

	get token(): CancellationToken {
		if (!this._token) {
			this._token = new MutableToken();
		}
		return this._token;
	}

	cancel(): void {
		if (!this._token) {
			this._token = CancellationToken.Cancelled;

		} else if (this._token instanceof MutableToken) {
			this._token.cancel();
		}
	}

	dispose(cancel: boolean = false): void {
		if (cancel) {
			this.cancel();
		}
		this._parentListener?.dispose();
		if (!this._token) {
			this._token = CancellationToken.None;

		} else if (this._token instanceof MutableToken) {
			this._token.dispose();
		}
	}
}

export function cancelOnDispose(store: DisposableStore): CancellationToken {
	const source = new CancellationTokenSource();
	store.add({ dispose() { source.cancel(); } });
	return source.token;
}

export class CancellationTokenPool {

	private readonly _source = new CancellationTokenSource();
	private readonly _listeners = new DisposableStore();

	private _total: number = 0;
	private _cancelled: number = 0;
	private _isDone: boolean = false;

	get token(): CancellationToken {
		return this._source.token;
	}

	add(token: CancellationToken): void {
		if (this._isDone) {
			return;
		}

		this._total++;

		if (token.isCancellationRequested) {
			this._cancelled++;
			this._check();
			return;
		}

		const d = token.onCancellationRequested(() => {
			d.dispose();
			this._cancelled++;
			this._check();
		});
		this._listeners.add(d);
	}

	private _check(): void {
		if (!this._isDone && this._total > 0 && this._total === this._cancelled) {
			this._isDone = true;
			this._listeners.dispose();
			this._source.cancel();
		}
	}

	dispose(): void {
		this._listeners.dispose();
		this._source.dispose();
	}
}
