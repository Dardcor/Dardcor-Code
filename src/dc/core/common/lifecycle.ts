export interface IDisposable {
	dispose(): void;
}

export class DisposableStore implements IDisposable {
	private readonly _toDispose = new Set<IDisposable>();
	private _isDisposed = false;

	public get isDisposed(): boolean {
		return this._isDisposed;
	}

	public dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		this.clear();
	}

	public clear(): void {
		if (this._toDispose.size === 0) {
			return;
		}
		for (const item of this._toDispose) {
			try {
				item.dispose();
			} catch (e) {
				console.error(e);
			}
		}
		this._toDispose.clear();
	}

	public add<T extends IDisposable>(item: T): T {
		if (this._isDisposed) {
			console.warn('Adding to a disposed DisposableStore');
			item.dispose();
		} else {
			this._toDispose.add(item);
		}
		return item;
	}
}

export class Disposable implements IDisposable {
	public static readonly None: IDisposable = Object.freeze({ dispose() {} });

	protected readonly _store = new DisposableStore();

	public dispose(): void {
		this._store.dispose();
	}

	protected _register<T extends IDisposable>(item: T): T {
		if ((item as unknown as Disposable) === this) {
			throw new Error('Cannot register a disposable on itself!');
		}
		return this._store.add(item);
	}
}

export class MutableDisposable<T extends IDisposable> implements IDisposable {
	private _value?: T;
	private _isDisposed = false;

	public get value(): T | undefined {
		return this._isDisposed ? undefined : this._value;
	}

	public set value(value: T | undefined) {
		if (this._isDisposed || this._value === value) {
			return;
		}
		this._value?.dispose();
		this._value = value;
	}

	public clear(): void {
		this.value = undefined;
	}

	public dispose(): void {
		this._isDisposed = true;
		this._value?.dispose();
		this._value = undefined;
	}
}

export function dispose<T extends IDisposable>(...disposables: (T | undefined)[]): void {
	for (const disposable of disposables) {
		disposable?.dispose();
	}
}

export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
	return toDisposable(() => dispose(...disposables));
}

export function toDisposable(fn: () => void): IDisposable {
	const self = {
		dispose: () => {
			fn();
		}
	};
	return self;
}
