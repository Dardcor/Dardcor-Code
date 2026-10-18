/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Observer<T> {
	next: (value: T) => void;
	complete?: () => void;
	error?: (err: unknown) => void;
}

export class Subject<T> {
	private observers = new Set<Observer<T>>();

	constructor() { }

	subscribe(observer: Observer<T>): () => void {
		this.observers.add(observer);
		return () => this.observers.delete(observer);
	}

	next(value: T): void {
		for (const observer of this.observers) {
			observer.next(value);
		}
	}

	error(err: unknown): void {
		for (const observer of this.observers) {
			observer.error?.(err);
		}
	}

	complete(): void {
		for (const observer of this.observers) {
			observer.complete?.();
		}
	}
}

export class ReplaySubject<T> extends Subject<T> {
	private _value: T | undefined;

	override subscribe(observer: Observer<T>): () => void {
		const subscription = super.subscribe(observer);
		if (this._value !== undefined) { observer.next(this._value); }
		return subscription;
	}

	override next(value: T): void {
		this._value = value;
		super.next(value);
	}
}
