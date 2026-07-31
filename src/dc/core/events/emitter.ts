/**
 * Dardcor Code - Event & Emitter Architecture
 */

import { IDisposable, DisposableStore, toDisposable } from '../lifecycle/disposable.js';

export interface Event<T> {
	(listener: (e: T) => unknown, thisArgs?: any, disposables?: IDisposable[] | DisposableStore): IDisposable;
}

export namespace Event {
	export const None: Event<any> = () => ({ dispose() {} });

	export function once<T>(event: Event<T>): Event<T> {
		return (listener, thisArgs = null, disposables?) => {
			let didFire = false;
			let result: IDisposable | undefined;
			result = event(e => {
				if (didFire) {
					return;
				}
				if (result) {
					result.dispose();
				} else {
					didFire = true;
				}
				return listener.call(thisArgs, e);
			}, null, disposables);

			if (didFire) {
				result.dispose();
			}
			return result;
		};
	}

	export function map<I, O>(event: Event<I>, fn: (i: I) => O): Event<O> {
		return (listener, thisArgs = null, disposables?) => event(i => listener.call(thisArgs, fn(i)), null, disposables);
	}

	export function filter<T>(event: Event<T>, fn: (e: T) => boolean): Event<T> {
		return (listener, thisArgs = null, disposables?) => event(e => fn(e) && listener.call(thisArgs, e), null, disposables);
	}

	export function signal<T>(event: Event<T>): Event<void> {
		return (listener, thisArgs = null, disposables?) => event(() => listener.call(thisArgs, undefined), null, disposables);
	}

	export function any<T>(...events: Event<T>[]): Event<T> {
		return (listener, thisArgs = null, disposables?) => {
			const store = new DisposableStore();
			for (const event of events) {
				store.add(event(e => listener.call(thisArgs, e)));
			}
			if (disposables) {
				if (Array.isArray(disposables)) {
					disposables.push(store);
				} else {
					disposables.add(store);
				}
			}
			return store;
		};
	}
}

export interface EmitterOptions {
	onWillAddFirstListener?: Function;
	onDidAddListener?: Function;
	onWillRemoveListener?: Function;
	onDidRemoveLastListener?: Function;
}

class Listener<T> {
	constructor(
		public readonly callback: (e: T) => unknown,
		public readonly callbackThis: any
	) {}

	public invoke(e: T): void {
		if (this.callbackThis) {
			this.callback.call(this.callbackThis, e);
		} else {
			this.callback(e);
		}
	}
}

export class Emitter<T = any> {
	private _event?: Event<T>;
	private _listeners?: Listener<T>[];
	private _isDisposed = false;

	constructor(private readonly _options?: EmitterOptions) {}

	get event(): Event<T> {
		if (!this._event) {
			this._event = (listener: (e: T) => unknown, thisArgs?: any, disposables?: IDisposable[] | DisposableStore) => {
				if (this._isDisposed) {
					return { dispose() {} };
				}
				if (!this._listeners) {
					this._options?.onWillAddFirstListener?.(this);
					this._listeners = [];
				}
				const l = new Listener(listener, thisArgs);
				this._listeners.push(l);
				this._options?.onDidAddListener?.(this, listener, thisArgs);

				const result = toDisposable(() => {
					this._removeListener(l);
				});

				if (disposables) {
					if (Array.isArray(disposables)) {
						disposables.push(result);
					} else {
						disposables.add(result);
					}
				}

				return result;
			};
		}
		return this._event;
	}

	private _removeListener(listener: Listener<T>): void {
		if (!this._listeners) {
			return;
		}
		this._options?.onWillRemoveListener?.(this);
		const index = this._listeners.indexOf(listener);
		if (index !== -1) {
			this._listeners.splice(index, 1);
		}
		if (this._listeners.length === 0) {
			this._listeners = undefined;
			this._options?.onDidRemoveLastListener?.(this);
		}
	}

	fire(event: T): void {
		if (this._listeners) {
			const listeners = [...this._listeners];
			for (const listener of listeners) {
				try {
					listener.invoke(event);
				} catch (err) {
					console.error('Unhandled exception in event listener:', err);
				}
			}
		}
	}

	hasListeners(): boolean {
		return !!this._listeners && this._listeners.length > 0;
	}

	dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this._listeners = undefined;
	}
}
