/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EqualityComparer, strictEquals, BugIndicatingError } from '../commonFacade/deps.js';
import { IObservable, IObservableWithChange, ISettableObservable } from '../base.js';
import { subtransaction } from '../transaction.js';
import { IChangeTracker } from '../changeTracker.js';
import { DebugNameData, DebugOwner } from '../debugName.js';
import { DerivedWithSetter, IDerivedReader } from '../observables/derivedImpl.js';
import { DebugLocation } from '../debugLocation.js';

export interface IReducerOptions<T, TChangeSummary = void, TOutChange = void> {
	initial: T | (() => T);

	disposeFinal?(value: T): void;
	changeTracker?: IChangeTracker<TChangeSummary>;
	equalityComparer?: EqualityComparer<T>;

	update(reader: IDerivedReader<TOutChange>, previousValue: T, changes: TChangeSummary): T;
}

export function observableReducer<T, TInChanges, TOutChange = void>(owner: DebugOwner, options: IReducerOptions<T, TInChanges, TOutChange>): SimplifyObservableWithChange<T, TOutChange> {
	// eslint-disable-next-line local/code-no-any-casts
	return observableReducerSettable<T, TInChanges, TOutChange>(owner, options) as any;
}

export function observableReducerSettable<T, TInChanges, TOutChange = void>(owner: DebugOwner, options: IReducerOptions<T, TInChanges, TOutChange>): ISettableObservable<T, TOutChange> {
	let prevValue: T | undefined = undefined;
	let hasValue = false;

	const d = new DerivedWithSetter(
		new DebugNameData(owner, undefined, options.update),
		(reader: IDerivedReader<TOutChange>, changeSummary) => {
			if (!hasValue) {
				prevValue = options.initial instanceof Function ? options.initial() : options.initial;
				hasValue = true;
			}
			const newValue = options.update(reader, prevValue!, changeSummary);
			prevValue = newValue;
			return newValue;
		},
		options.changeTracker,
		() => {
			if (hasValue) {
				options.disposeFinal?.(prevValue!);
				hasValue = false;
			}
		},
		options.equalityComparer ?? strictEquals,
		(value, tx, change) => {
			if (!hasValue) {
				throw new BugIndicatingError('Can only set when there is a listener! This is to prevent leaks.');
			}
			subtransaction(tx, tx => {
				prevValue = value;
				d.setValue(value, tx, change);
			});
		},
		DebugLocation.ofCaller()
	);

	return d;
}

type SimplifyObservableWithChange<T, TChange> = TChange extends void ? IObservable<T> : IObservableWithChange<T, TChange>;
