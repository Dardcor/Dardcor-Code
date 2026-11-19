/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable, IReader, ITransaction, ISettableObservable, IObservableWithChange } from '../base';
import { IChangeTracker } from '../changeTracker';
import { DisposableStore, EqualityComparer, IDisposable, strictEquals } from '../commonFacade/deps';
import { DebugLocation } from '../debugLocation';
import { DebugOwner, DebugNameData, IDebugNameData } from '../debugName';
import { _setDerivedOpts } from './baseObservable';
import { IDerivedReader, Derived, DerivedWithSetter } from './derivedImpl';

export function derived<T, TChange = void>(computeFn: (reader: IDerivedReader<TChange>, debugLocation?: DebugLocation) => T): IObservableWithChange<T, TChange>;
export function derived<T, TChange = void>(owner: DebugOwner, computeFn: (reader: IDerivedReader<TChange>) => T, debugLocation?: DebugLocation): IObservableWithChange<T, TChange>;
export function derived<T, TChange = void>(
	computeFnOrOwner: ((reader: IDerivedReader<TChange>) => T) | DebugOwner,
	computeFn?: ((reader: IDerivedReader<TChange>) => T) | undefined,
	debugLocation = DebugLocation.ofCaller()
): IObservable<T> {
	if (computeFn !== undefined) {
		return new Derived(
			new DebugNameData(computeFnOrOwner, undefined, computeFn),
			computeFn,
			undefined,
			undefined,
			strictEquals,
			debugLocation,
		);
	}
	return new Derived(
		// eslint-disable-next-line local/code-no-any-casts
		new DebugNameData(undefined, undefined, computeFnOrOwner as any),
		// eslint-disable-next-line local/code-no-any-casts
		computeFnOrOwner as any,
		undefined,
		undefined,
		strictEquals,
		debugLocation,
	);
}

export function derivedWithSetter<T>(owner: DebugOwner | undefined, computeFn: (reader: IReader) => T, setter: (value: T, transaction: ITransaction | undefined) => void, debugLocation = DebugLocation.ofCaller()): ISettableObservable<T> {
	return new DerivedWithSetter(
		new DebugNameData(owner, undefined, computeFn),
		computeFn,
		undefined,
		undefined,
		strictEquals,
		setter,
		debugLocation
	);
}

export function derivedOpts<T>(
	options: IDebugNameData & {
		equalsFn?: EqualityComparer<T>;
		onLastObserverRemoved?: (() => void);
	},
	computeFn: (reader: IReader) => T,
	debugLocation = DebugLocation.ofCaller()
): IObservable<T> {
	return new Derived(
		new DebugNameData(options.owner, options.debugName, options.debugReferenceFn),
		computeFn,
		undefined,
		options.onLastObserverRemoved,
		options.equalsFn ?? strictEquals,
		debugLocation
	);
}
_setDerivedOpts(derivedOpts);

export function derivedHandleChanges<T, TDelta, TChangeSummary>(
	options: IDebugNameData & {
		changeTracker: IChangeTracker<TChangeSummary>;
		equalityComparer?: EqualityComparer<T>;
	},
	computeFn: (reader: IDerivedReader<TDelta>, changeSummary: TChangeSummary) => T,
	debugLocation = DebugLocation.ofCaller()
): IObservableWithChange<T, TDelta> {
	return new Derived(
		new DebugNameData(options.owner, options.debugName, undefined),
		computeFn,
		options.changeTracker,
		undefined,
		options.equalityComparer ?? strictEquals,
		debugLocation
	);
}

export function derivedWithStore<T>(computeFn: (reader: IReader, store: DisposableStore) => T): IObservable<T>;

export function derivedWithStore<T>(owner: DebugOwner, computeFn: (reader: IReader, store: DisposableStore) => T): IObservable<T>;
export function derivedWithStore<T>(computeFnOrOwner: ((reader: IReader, store: DisposableStore) => T) | DebugOwner, computeFnOrUndefined?: ((reader: IReader, store: DisposableStore) => T), debugLocation = DebugLocation.ofCaller()): IObservable<T> {
	let computeFn: (reader: IReader, store: DisposableStore) => T;
	let owner: DebugOwner;
	if (computeFnOrUndefined === undefined) {
		// eslint-disable-next-line local/code-no-any-casts
		computeFn = computeFnOrOwner as any;
		owner = undefined;
	} else {
		owner = computeFnOrOwner;
		// eslint-disable-next-line local/code-no-any-casts
		computeFn = computeFnOrUndefined as any;
	}

	// eslint-disable-next-line local/code-no-potentially-unsafe-disposables
	let store = new DisposableStore();

	return new Derived(
		new DebugNameData(owner, undefined, computeFn),
		r => {
			if (store.isDisposed) {
				store = new DisposableStore();
			} else {
				store.clear();
			}
			return computeFn(r, store);
		},
		undefined,
		() => store.dispose(),
		strictEquals,
		debugLocation
	);
}

export function derivedDisposable<T extends IDisposable | undefined>(computeFn: (reader: IReader) => T): IObservable<T>;
export function derivedDisposable<T extends IDisposable | undefined>(owner: DebugOwner, computeFn: (reader: IReader) => T): IObservable<T>;
export function derivedDisposable<T extends IDisposable | undefined>(computeFnOrOwner: ((reader: IReader) => T) | DebugOwner, computeFnOrUndefined?: ((reader: IReader) => T), debugLocation = DebugLocation.ofCaller()): IObservable<T> {
	let computeFn: (reader: IReader) => T;
	let owner: DebugOwner;
	if (computeFnOrUndefined === undefined) {
		// eslint-disable-next-line local/code-no-any-casts
		computeFn = computeFnOrOwner as any;
		owner = undefined;
	} else {
		owner = computeFnOrOwner;
		// eslint-disable-next-line local/code-no-any-casts
		computeFn = computeFnOrUndefined as any;
	}

	let store: DisposableStore | undefined = undefined;
	return new Derived(
		new DebugNameData(owner, undefined, computeFn),
		r => {
			if (!store) {
				store = new DisposableStore();
			} else {
				store.clear();
			}
			const result = computeFn(r);
			if (result) {
				store.add(result);
			}
			return result;
		},
		undefined,
		() => {
			if (store) {
				store.dispose();
				store = undefined;
			}
		},
		strictEquals,
		debugLocation
	);
}
