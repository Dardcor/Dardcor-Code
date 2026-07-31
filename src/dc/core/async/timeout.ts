/**
 * Dardcor Code - Timeout and Interval Timers with Disposable Auto-Cancellation
 */

import { IDisposable } from '../lifecycle/disposable.js';

export class TimeoutTimer implements IDisposable {
	private _token: any = null;

	constructor(runner?: () => void, timeout?: number) {
		if (typeof runner === 'function' && typeof timeout === 'number') {
			this.setIfNotSet(runner, timeout);
		}
	}

	public dispose(): void {
		this.cancel();
	}

	public cancel(): void {
		if (this._token !== null) {
			clearTimeout(this._token);
			this._token = null;
		}
	}

	public setIfNotSet(runner: () => void, timeout: number): void {
		if (this._token !== null) {
			return;
		}
		this._token = setTimeout(() => {
			this._token = null;
			runner();
		}, timeout);
	}
}

export class IntervalTimer implements IDisposable {
	private _token: any = null;

	public cancel(): void {
		if (this._token !== null) {
			clearInterval(this._token);
			this._token = null;
		}
	}

	public cancelAndSet(runner: () => void, interval: number): void {
		this.cancel();
		this._token = setInterval(runner, interval);
	}

	public dispose(): void {
		this.cancel();
	}
}
