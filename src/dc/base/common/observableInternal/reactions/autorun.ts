/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IReaderWithStore, IReader, IObservable, ISettableObservable } from '../base.js';
import { IChangeTracker } from '../changeTracker.js';
import { DisposableStore, IDisposable, toDisposable } from '../commonFacade/deps.js';
import { DebugNameData, IDebugNameData } from '../debugName.js';
import { AutorunObserver } from './autorunImpl.js';
import { DebugLocation } from '../debugLocation.js';
import { observableValue } from '../observables/observableValue.js';
import { transaction } from '../transaction.js';

export function autorun(fn: (reader: IReaderWithStore) => void, debugLocation = DebugLocation.ofCaller()): IDisposable {
	return new AutorunObserver(
		new DebugNameData(undefined, undefined, fn),
		fn,
		undefined,
		debugLocation
	);
}

export function autorunOpts(options: IDebugNameData & {}, fn: (reader: IReaderWithStore) => void, debugLocation = DebugLocation.ofCaller()): IDisposable {
	return new AutorunObserver(
		new DebugNameData(options.owner, options.debugName, options.debugReferenceFn ?? fn),
		fn,
		undefined,
		debugLocation
	);
}

export function autorunHandleChanges<TChangeSummary>(
	options: IDebugNameData & {
		changeTracker: IChangeTracker<TChangeSummary>;
	},
	fn: (reader: IReader, changeSummary: TChangeSummary) => void,
	debugLocation = DebugLocation.ofCaller()
): IDisposable {
	return new AutorunObserver(
		new DebugNameData(options.owner, options.debugName, options.debugReferenceFn ?? fn),
		fn,
		options.changeTracker,
		debugLocation
	);
}

export function autorunWithStoreHandleChanges<TChangeSummary>(
	options: IDebugNameData & {
		changeTracker: IChangeTracker<TChangeSummary>;
	},
	fn: (reader: IReader, changeSummary: TChangeSummary, store: DisposableStore) => void
): IDisposable {
	const store = new DisposableStore();
	const disposable = autorunHandleChanges(
		{
			owner: options.owner,
			debugName: options.debugName,
			debugReferenceFn: options.debugReferenceFn ?? fn,
			changeTracker: options.changeTracker,
		},
		(reader, changeSummary) => {
			store.clear();
			fn(reader, changeSummary, store);
		}
	);
	return toDisposable(() => {
		disposable.dispose();
		store.dispose();
	});
}

export function autorunWithStore(fn: (reader: IReader, store: DisposableStore) => void): IDisposable {
	const store = new DisposableStore();
	const disposable = autorunOpts(
		{
			owner: undefined,
			debugName: undefined,
			debugReferenceFn: fn,
		},
		reader => {
			store.clear();
			fn(reader, store);
		}
	);
	return toDisposable(() => {
		disposable.dispose();
		store.dispose();
	});
}

export function autorunDelta<T>(
	observable: IObservable<T>,
	handler: (args: { lastValue: T | undefined; newValue: T }) => void
): IDisposable {
	let _lastValue: T | undefined;
	return autorunOpts({ debugReferenceFn: handler }, (reader) => {
		const newValue = observable.read(reader);
		const lastValue = _lastValue;
		_lastValue = newValue;
		handler({ lastValue, newValue });
	});
}

export function autorunIterableDelta<T>(
	getValue: (reader: IReader) => Iterable<T>,
	handler: (args: { addedValues: T[]; removedValues: T[] }) => void,
	getUniqueIdentifier: (value: T) => unknown = v => v
) {
	const lastValues = new Map<unknown, T>();
	return autorunOpts({ debugReferenceFn: getValue }, (reader) => {
		const newValues = new Map();
		const removedValues = new Map(lastValues);
		for (const value of getValue(reader)) {
			const id = getUniqueIdentifier(value);
			if (lastValues.has(id)) {
				removedValues.delete(id);
			} else {
				newValues.set(id, value);
				lastValues.set(id, value);
			}
		}
		for (const id of removedValues.keys()) {
			lastValues.delete(id);
		}

		if (newValues.size || removedValues.size) {
			handler({ addedValues: [...newValues.values()], removedValues: [...removedValues.values()] });
		}
	});
}

export function autorunPerKeyedItem<TIn, TKey>(
	items: IObservable<readonly TIn[]>,
	keyFn: (input: TIn) => TKey,
	setup: (key: TKey, value: IObservable<TIn>, store: DisposableStore) => void,
	debugLocation = DebugLocation.ofCaller()
): IDisposable {
	interface ICell {
		readonly value: ISettableObservable<TIn>;
		readonly store: DisposableStore;
	}
	const cells = new Map<TKey, ICell>();
	const ar = autorunOpts({ debugReferenceFn: setup }, reader => {
		const arr = items.read(reader);
		const seen = new Set<TKey>();
		const additions: { key: TKey; cell: ICell }[] = [];
		transaction(tx => {
			for (const item of arr) {
				const key = keyFn(item);
				seen.add(key);
				const existing = cells.get(key);
				if (existing) {
					existing.value.set(item, tx);
				} else {
					const store = new DisposableStore();
					const value = observableValue<TIn>('keyedItem', item);
					const cell: ICell = { value, store };
					cells.set(key, cell);
					additions.push({ key, cell });
				}
			}
			for (const [k, cell] of cells) {
				if (!seen.has(k)) {
					cell.store.dispose();
					cells.delete(k);
				}
			}
		});
		for (const { key, cell } of additions) {
			setup(key, cell.value, cell.store);
		}
	}, debugLocation);
	return toDisposable(() => {
		ar.dispose();
		for (const cell of cells.values()) {
			cell.store.dispose();
		}
		cells.clear();
	});
}

export interface IReaderWithDispose extends IReaderWithStore, IDisposable { }

export function autorunSelfDisposable(fn: (reader: IReaderWithDispose) => void, debugLocation = DebugLocation.ofCaller()): IDisposable {
	let ar: IDisposable | undefined;
	let disposed = false;

	// eslint-disable-next-line prefer-const
	ar = autorun(reader => {
		fn({
			delayedStore: reader.delayedStore,
			store: reader.store,
			readObservable: reader.readObservable.bind(reader),
			dispose: () => {
				ar?.dispose();
				disposed = true;
			}
		});
	}, debugLocation);

	if (disposed) {
		ar.dispose();
	}

	return ar;
}


export function registerAutorunSelfDisposable(store: DisposableStore, fn: (reader: IReaderWithDispose) => void, debugLocation = DebugLocation.ofCaller()): void {
	let ar: IDisposable | undefined;
	let disposeSync = false;

	// eslint-disable-next-line prefer-const
	ar = autorun(reader => {
		fn({
			delayedStore: reader.delayedStore,
			store: reader.store,
			readObservable: reader.readObservable.bind(reader),
			dispose: () => {
				if (!ar) {
					disposeSync = true;
				} else {
					store.delete(ar);
				}
			}
		});
	}, debugLocation);

	if (disposeSync) {
		ar.dispose();
	} else {
		store.add(ar);
	}
}
