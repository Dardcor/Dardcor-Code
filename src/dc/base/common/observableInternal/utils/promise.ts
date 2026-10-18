/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DisposableStore } from '../../lifecycle.js';
import { IObservable, ISettableObservable } from '../base.js';
import { autorun } from '../reactions/autorun.js';
import { transaction } from '../transaction.js';
import { derived } from '../observables/derived.js';
import { observableValue } from '../observables/observableValue.js';

export class ObservableLazy<T> {
	private readonly _value = observableValue<T | undefined>(this, undefined);

	public get cachedValue(): IObservable<T | undefined> { return this._value; }

	constructor(private readonly _computeValue: () => T) {
	}

	public getValue(): T {
		let v = this._value.get();
		if (!v) {
			v = this._computeValue();
			this._value.set(v, undefined);
		}
		return v;
	}
}

export class ObservablePromise<T> {
	public static fromFn<T>(fn: () => Promise<T>): ObservablePromise<T> {
		return new ObservablePromise(fn());
	}

	public static resolved<T>(value: T): ObservablePromise<T> {
		return new ObservablePromise(Promise.resolve(value));
	}

	private readonly _value = observableValue<PromiseResult<T> | undefined>(this, undefined);

	public readonly promise: Promise<T>;

	public readonly promiseResult: IObservable<PromiseResult<T> | undefined> = this._value;

	constructor(promise: Promise<T>) {
		this.promise = promise.then(value => {
			transaction(tx => {
				this._value.set(new PromiseResult(value, undefined), tx);
			});
			return value;
		}, error => {
			transaction(tx => {
				this._value.set(new PromiseResult<T>(undefined, error), tx);
			});
			throw error;
		});
	}

	public readonly resolvedValue = derived(this, reader => {
		const result = this.promiseResult.read(reader);
		if (!result) {
			return undefined;
		}
		return result.getDataOrThrow();
	});
}

export class PromiseResult<T> {
	constructor(
		public readonly data: T | undefined,

		public readonly error: unknown | undefined,
	) {
	}

	public getDataOrThrow(): T {
		if (this.error) {
			throw this.error;
		}
		return this.data!;
	}
}

export class ObservableResolvedPromise<T> {
	private readonly _lastResolved: ISettableObservable<T>;
	public readonly lastResolved: IObservable<T>;

	private readonly _isResolving = observableValue<boolean>(this, false);
	public readonly isResolving: IObservable<boolean> = this._isResolving;

	private _runningPromise: ObservablePromise<T> | undefined;

	constructor(
		source: IObservable<ObservablePromise<T>>,
		initialValue: T,
		store: DisposableStore,
	) {
		this._lastResolved = observableValue<T>(this, initialValue);
		this.lastResolved = this._lastResolved;

		store.add(autorun(reader => {
			const current = source.read(reader);
			this._runningPromise = current;

			const result = current.promiseResult.read(reader);
			if (result) {
				if (current === this._runningPromise) {
					this._isResolving.set(false, undefined);
					this._lastResolved.set(result.getDataOrThrow(), undefined);
				}
			} else {
				this._isResolving.set(true, undefined);
			}
		}));
	}
}

export class ObservableLazyPromise<T> {
	private readonly _lazyValue = new ObservableLazy(() => new ObservablePromise(this._computePromise()));

	public readonly cachedPromiseResult = derived(this, reader => this._lazyValue.cachedValue.read(reader)?.promiseResult.read(reader));

	constructor(private readonly _computePromise: () => Promise<T>) {
	}

	public getPromise(): Promise<T> {
		return this._lazyValue.getValue().promise;
	}
}
