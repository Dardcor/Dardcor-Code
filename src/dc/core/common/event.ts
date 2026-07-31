import { IDisposable, toDisposable } from './lifecycle.js';

export interface Event<T> {
	(listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[]): IDisposable;
}

export class Emitter<T> implements IDisposable {
	private _listeners?: Set<(e: T) => void>;
	private _event?: Event<T>;
	private _disposed = false;

	public get event(): Event<T> {
		if (!this._event) {
			this._event = (listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[]): IDisposable => {
				if (!this._listeners) {
					this._listeners = new Set();
				}
				const boundListener = thisArgs ? listener.bind(thisArgs) : listener;
				this._listeners.add(boundListener);

				const result = toDisposable(() => {
					this._listeners?.delete(boundListener);
				});

				if (disposables) {
					disposables.push(result);
				}

				return result;
			};
		}
		return this._event;
	}

	public fire(event: T): void {
		if (this._listeners) {
			for (const listener of Array.from(this._listeners)) {
				try {
					listener(event);
				} catch (e) {
					console.error(e);
				}
			}
		}
	}

	public dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._listeners?.clear();
			this._listeners = undefined;
		}
	}
}

export class PauseableEmitter<T> extends Emitter<T> {
	private _isPaused = false;
	private _eventQueue: T[] = [];

	public pause(): void {
		this._isPaused = true;
	}

	public resume(): void {
		this._isPaused = false;
		for (const event of this._eventQueue) {
			super.fire(event);
		}
		this._eventQueue = [];
	}

	public override fire(event: T): void {
		if (this._isPaused) {
			this._eventQueue.push(event);
		} else {
			super.fire(event);
		}
	}
}

export class DebounceEmitter<T> extends Emitter<T> {}

export class Relay<T> implements IDisposable {
	private readonly _emitter = new Emitter<T>();
	public readonly event: Event<T> = this._emitter.event;
	private _inputDisposable?: IDisposable;

	public set input(event: Event<T>) {
		this._inputDisposable?.dispose();
		this._inputDisposable = event(e => this._emitter.fire(e));
	}

	public dispose(): void {
		this._inputDisposable?.dispose();
		this._emitter.dispose();
	}
}

export class EventMultiplexer<T> implements IDisposable {
	private readonly _emitter = new Emitter<T>();
	public readonly event: Event<T> = this._emitter.event;

	public add(event: Event<T>): IDisposable {
		return event(e => this._emitter.fire(e));
	}

	public dispose(): void {
		this._emitter.dispose();
	}
}

export function mapEvent<I, O>(event: Event<I>, fn: (i: I) => O): Event<O> {
	return (listener, thisArgs, disposables) => event(i => listener.call(thisArgs, fn(i)), undefined, disposables);
}

export function filterEvent<T>(event: Event<T>, fn: (e: T) => boolean): Event<T> {
	return (listener, thisArgs, disposables) => event(e => fn(e) && listener.call(thisArgs, e), undefined, disposables);
}

export function once<T>(event: Event<T>): Event<T> {
	return (listener, thisArgs, disposables) => {
		let result: IDisposable;
		result = event(e => {
			result?.dispose();
			return listener.call(thisArgs, e);
		}, undefined, disposables);
		return result;
	};
}

export function anyEvent<T>(...events: Event<T>[]): Event<T> {
	return (listener, thisArgs, disposables) => {
		const store: IDisposable[] = [];
		for (const event of events) {
			store.push(event(listener, thisArgs));
		}
		const res = toDisposable(() => {
			for (const d of store) {
				d.dispose();
			}
		});
		if (disposables) {
			disposables.push(res);
		}
		return res;
	};
}

export function buffer<T>(event: Event<T>): Event<T> {
	return event;
}

export function signal<T>(event: Event<T>): Event<void> {
	return mapEvent(event, () => undefined);
}
