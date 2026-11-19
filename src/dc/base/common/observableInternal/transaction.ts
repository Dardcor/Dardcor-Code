/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { handleBugIndicatingErrorRecovery, IObservable, IObserver, ITransaction } from './base.js';
import { getFunctionName } from './debugName.js';
import { getLogger } from './logging/logging.js';


export function transaction(fn: (tx: ITransaction) => void, getDebugName?: () => string): void {
	const tx = new TransactionImpl(fn, getDebugName);
	try {
		fn(tx);
	} finally {
		tx.finish();
	}
}
let _globalTransaction: ITransaction | undefined = undefined;

export function globalTransaction(fn: (tx: ITransaction) => void) {
	if (_globalTransaction) {
		fn(_globalTransaction);
	} else {
		const tx = new TransactionImpl(fn, undefined);
		_globalTransaction = tx;
		try {
			fn(tx);
		} finally {
			tx.finish();


			_globalTransaction = undefined;
		}
	}
}

export async function asyncTransaction(fn: (tx: ITransaction) => Promise<void>, getDebugName?: () => string): Promise<void> {
	const tx = new TransactionImpl(fn, getDebugName);
	try {
		await fn(tx);
	} finally {
		tx.finish();
	}
}

export function subtransaction(tx: ITransaction | undefined, fn: (tx: ITransaction) => void, getDebugName?: () => string): void {
	if (!tx) {
		transaction(fn, getDebugName);
	} else {
		fn(tx);
	}
} export class TransactionImpl implements ITransaction {
	private _updatingObservers: { observer: IObserver; observable: IObservable<any> }[] | null = [];

	constructor(public readonly _fn: Function, private readonly _getDebugName?: () => string) {
		getLogger()?.handleBeginTransaction(this);
	}

	public getDebugName(): string | undefined {
		if (this._getDebugName) {
			return this._getDebugName();
		}
		return getFunctionName(this._fn);
	}

	public updateObserver(observer: IObserver, observable: IObservable<any>): void {
		if (!this._updatingObservers) {
			handleBugIndicatingErrorRecovery('Transaction already finished!');
			transaction(tx => {
				tx.updateObserver(observer, observable);
			});
			return;
		}

		this._updatingObservers.push({ observer, observable });
		observer.beginUpdate(observable);
	}

	public finish(): void {
		const updatingObservers = this._updatingObservers;
		if (!updatingObservers) {
			handleBugIndicatingErrorRecovery('transaction.finish() has already been called!');
			return;
		}

		for (let i = 0; i < updatingObservers.length; i++) {
			const { observer, observable } = updatingObservers[i];
			observer.endUpdate(observable);
		}
		this._updatingObservers = null;
		getLogger()?.handleEndTransaction(this);
	}

	public debugGetUpdatingObservers() {
		return this._updatingObservers;
	}
}

