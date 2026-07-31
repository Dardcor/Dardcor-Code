/**
 * Dardcor Code - Reference Counted Disposable
 */

import { IDisposable } from './disposable';

export class RefCountedDisposable implements IDisposable {
	private _counter = 1;

	constructor(private readonly _disposable: IDisposable) {}

	public acquire(): this {
		if (this._counter <= 0) {
			throw new Error('Cannot acquire a disposed ReferenceCountedDisposable');
		}
		this._counter++;
		return this;
	}

	public release(): void {
		if (this._counter <= 0) {
			return;
		}
		this._counter--;
		if (this._counter === 0) {
			this._disposable.dispose();
		}
	}

	public dispose(): void {
		this.release();
	}
}
