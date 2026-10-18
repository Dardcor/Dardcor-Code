
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, onUnexpectedError } from './commonFacade/deps';

export interface IObservable<T> extends IObservableWithChange<T, unknown> { }

export interface IObservableWithChange<T, TChange = unknown> {
	get(): T;

	reportChanges(): void;

	addObserver(observer: IObserver): void;

	removeObserver(observer: IObserver): void;


	read(reader: IReader | undefined): T;

	recomputeInitiallyAndOnChange(store: DisposableStore, handleValue?: (value: T) => void): IObservable<T>;

	keepObserved(store: DisposableStore): IObservable<T>;

	map<TNew>(fn: (value: T, reader: IReader) => TNew): IObservable<TNew>;
	map<TNew>(owner: object, fn: (value: T, reader: IReader) => TNew): IObservable<TNew>;

	flatten<TNew>(this: IObservable<IObservable<TNew>>): IObservable<TNew>;

	log(): IObservableWithChange<T, TChange>;

	readonly debugName: string;

	readonly TChange: TChange;

}

export interface IObserver {
	beginUpdate<T>(observable: IObservable<T>): void;

	endUpdate<T>(observable: IObservable<T>): void;

	handlePossibleChange<T>(observable: IObservable<T>): void;

	handleChange<T, TChange>(observable: IObservableWithChange<T, TChange>, change: TChange): void;
}

export interface IReader {
	readObservable<T>(observable: IObservableWithChange<T, any>): T;
}

export interface ISettable<T, TChange = void> {
	set(value: T, transaction: ITransaction | undefined, change: TChange): void;
}

export interface ITransaction {
	updateObserver(observer: IObserver, observable: IObservableWithChange<any, any>): void;
}

export function handleBugIndicatingErrorRecovery(message: string) {
	const err = new Error('BugIndicatingErrorRecovery: ' + message);
	onUnexpectedError(err);
	console.error('recovered from an error that indicates a bug', err);
}

export interface ISettableObservable<T, TChange = void> extends IObservableWithChange<T, TChange>, ISettable<T, TChange> {
}

export interface IReaderWithStore extends IReader {
	get store(): DisposableStore;

	get delayedStore(): DisposableStore;
}
