/**
 * Dardcor Code - Cancellation Tokens & Cancellation Token Source
 */

import { Event, Emitter } from '../events/emitter';
import { IDisposable } from '../lifecycle/disposable';

export interface CancellationToken {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested: Event<void>;
}

class ShortcutCancellationToken implements CancellationToken {
	readonly isCancellationRequested = true;
	readonly onCancellationRequested: Event<void> = (listener, thisArgs) => {
		listener.call(thisArgs, undefined);
		return { dispose() {} };
	};
}

export namespace CancellationToken {
	export const None: CancellationToken = Object.freeze({
		isCancellationRequested: false,
		onCancellationRequested: Event.None,
	});

	export const Cancelled: CancellationToken = new ShortcutCancellationToken();
}

class MutableCancellationToken implements CancellationToken {
	private _isCancelled = false;
	private _emitter: Emitter<void> | null = null;

	get isCancellationRequested(): boolean {
		return this._isCancelled;
	}

	get onCancellationRequested(): Event<void> {
		if (this._isCancelled) {
			return (listener, thisArgs) => {
				listener.call(thisArgs, undefined);
				return { dispose() {} };
			};
		}
		if (!this._emitter) {
			this._emitter = new Emitter<void>();
		}
		return this._emitter.event;
	}

	public cancel(): void {
		if (this._isCancelled) {
			return;
		}
		this._isCancelled = true;
		if (this._emitter) {
			this._emitter.fire(undefined);
			this._emitter.dispose();
			this._emitter = null;
		}
	}

	public dispose(): void {
		if (this._emitter) {
			this._emitter.dispose();
			this._emitter = null;
		}
	}
}

export class CancellationTokenSource implements IDisposable {
	private _token?: MutableCancellationToken;

	get token(): CancellationToken {
		if (!this._token) {
			this._token = new MutableCancellationToken();
		}
		return this._token;
	}

	cancel(): void {
		if (!this._token) {
			this._token = CancellationToken.Cancelled as MutableCancellationToken;
		} else {
			this._token.cancel();
		}
	}

	dispose(): void {
		if (this._token && 'dispose' in this._token) {
			this._token.dispose();
		}
	}
}
