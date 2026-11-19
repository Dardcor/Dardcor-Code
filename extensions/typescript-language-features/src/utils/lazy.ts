/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class Lazy<T> {

	private _didRun: boolean = false;
	private _value?: T;
	private _error: Error | undefined;

	constructor(
		private readonly executor: () => T,
	) { }

	get hasValue() { return this._didRun; }

	get value(): T {
		if (!this._didRun) {
			try {
				this._value = this.executor();
			} catch (err) {
				this._error = err;
			} finally {
				this._didRun = true;
			}
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}

	get rawValue(): T | undefined { return this._value; }

	map<R>(fn: (value: T) => R): Lazy<R> {
		return new Lazy(() => fn(this.value));
	}
}
