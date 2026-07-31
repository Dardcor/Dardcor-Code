/**
 * Dardcor Code - Event Debouncer
 */

import { IDisposable } from '../lifecycle/disposable';

export class Debouncer implements IDisposable {
	private _handle: any = null;

	constructor(
		private readonly _fn: (...args: any[]) => void,
		private readonly _delay: number
	) {}

	public debounce(...args: any[]): void {
		if (this._handle !== null) {
			clearTimeout(this._handle);
		}
		this._handle = setTimeout(() => {
			this._handle = null;
			this._fn(...args);
		}, this._delay);
	}

	public cancel(): void {
		if (this._handle !== null) {
			clearTimeout(this._handle);
			this._handle = null;
		}
	}

	public dispose(): void {
		this.cancel();
	}
}
