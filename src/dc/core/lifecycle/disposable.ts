/**
 * Dardcor Code - Micro-kernel Base Lifecycle (Disposable)
 */

export interface IDisposable {
	dispose(): void;
}

export interface IDisposableTracker {
	trackDisposable(disposable: IDisposable): void;
	setParent(child: IDisposable, parent: IDisposable | null): void;
	markAsDisposed(disposable: IDisposable): void;
	markAsSingleton(disposable: IDisposable): void;
}

let disposableTracker: IDisposableTracker | null = null;

export function setDisposableTracker(tracker: IDisposableTracker | null): void {
	disposableTracker = tracker;
}

export function trackDisposable<T extends IDisposable>(x: T): T {
	disposableTracker?.trackDisposable(x);
	return x;
}

export function markAsDisposed(disposable: IDisposable): void {
	disposableTracker?.markAsDisposed(disposable);
}

export function setParentOfDisposable(child: IDisposable, parent: IDisposable | null): void {
	disposableTracker?.setParent(child, parent);
}

export function isDisposable<E>(thing: E): thing is E & IDisposable {
	return typeof thing === 'object' && thing !== null && typeof (thing as unknown as IDisposable).dispose === 'function';
}

export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export function dispose<T extends IDisposable>(disposables: Iterable<T>): void;
export function dispose<T extends IDisposable>(arg: T | Iterable<T> | undefined): any {
	if (arg && typeof (arg as any)[Symbol.iterator] === 'function') {
		const errors: any[] = [];
		for (const d of arg as Iterable<T>) {
			if (d) {
				try {
					d.dispose();
				} catch (e) {
					errors.push(e);
				}
			}
		}
		if (errors.length === 1) {
			throw errors[0];
		} else if (errors.length > 1) {
			throw new AggregateError(errors, 'Errors during disposal');
		}
		return Array.isArray(arg) ? [] : arg;
	} else if (arg) {
		(arg as T).dispose();
		return arg;
	}
}

class FunctionDisposable implements IDisposable {
	private _isDisposed = false;

	constructor(private readonly _fn: () => void) {
		trackDisposable(this);
	}

	dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		markAsDisposed(this);
		this._fn();
	}
}

export function toDisposable(fn: () => void): IDisposable {
	return new FunctionDisposable(fn);
}

export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
	const parent = toDisposable(() => dispose(disposables));
	for (const child of disposables) {
		setParentOfDisposable(child, parent);
	}
	return parent;
}

export abstract class Disposable implements IDisposable {
	static readonly None = Object.freeze<IDisposable>({ dispose() {} });

	protected readonly _store: DisposableStore;

	constructor() {
		trackDisposable(this);
		this._store = new DisposableStore();
		setParentOfDisposable(this._store, this);
	}

	public dispose(): void {
		markAsDisposed(this);
		this._store.dispose();
	}

	protected _register<T extends IDisposable>(o: T): T {
		if ((o as unknown as Disposable) === this) {
			throw new Error('Cannot register a disposable on itself');
		}
		return this._store.add(o);
	}
}

export class DisposableStore implements IDisposable {
	private readonly _toDispose = new Set<IDisposable>();
	private _isDisposed = false;

	constructor() {
		trackDisposable(this);
	}

	public dispose(): void {
		if (this._isDisposed) {
			return;
		}
		markAsDisposed(this);
		this._isDisposed = true;
		this.clear();
	}

	public get isDisposed(): boolean {
		return this._isDisposed;
	}

	public clear(): void {
		if (this._toDispose.size === 0) {
			return;
		}
		try {
			dispose(this._toDispose);
		} finally {
			this._toDispose.clear();
		}
	}

	public add<T extends IDisposable>(o: T): T {
		if (!o || o === Disposable.None) {
			return o;
		}
		if ((o as unknown as DisposableStore) === this) {
			throw new Error('Cannot register disposable store on itself');
		}
		setParentOfDisposable(o, this);
		if (this._isDisposed) {
			console.warn('Adding disposable to an already disposed store');
			o.dispose();
		} else {
			this._toDispose.add(o);
		}
		return o;
	}

	public delete<T extends IDisposable>(o: T): void {
		if (!o) {
			return;
		}
		if (this._toDispose.delete(o)) {
			setParentOfDisposable(o, null);
			o.dispose();
		}
	}

	public deleteAndLeak<T extends IDisposable>(o: T): void {
		if (!o) {
			return;
		}
		if (this._toDispose.delete(o)) {
			setParentOfDisposable(o, null);
		}
	}
}

export class MutableDisposable<T extends IDisposable> implements IDisposable {
	private _value?: T;
	private _isDisposed = false;

	constructor() {
		trackDisposable(this);
	}

	get value(): T | undefined {
		return this._isDisposed ? undefined : this._value;
	}

	set value(value: T | undefined) {
		if (this._isDisposed || value === this._value) {
			return;
		}
		this._value?.dispose();
		this._value = value;
		if (value) {
			setParentOfDisposable(value, this);
		}
	}

	clear(): void {
		this.value = undefined;
	}

	dispose(): void {
		if (this._isDisposed) {
			return;
		}
		markAsDisposed(this);
		this._isDisposed = true;
		this._value?.dispose();
		this._value = undefined;
	}
}
