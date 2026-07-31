/**
 * Dardcor Code - RunOnceScheduler (Task 56)
 * Mirrors: vs/base/common/async.ts → RunOnceScheduler
 */

import { IDisposable } from '../lifecycle/disposable';

export class RunOnceScheduler implements IDisposable {
	private _runner: (() => void) | null;
	private _timeout: any;
	private _delay: number;

	constructor(runner: () => void, delay: number) {
		this._runner = runner;
		this._delay = delay;
		this._timeout = undefined;
	}

	dispose(): void {
		this.cancel();
		this._runner = null;
	}

	cancel(): void {
		if (this._timeout !== undefined) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}
	}

	schedule(delay: number = this._delay): void {
		this.cancel();
		this._timeout = setTimeout(() => {
			this._timeout = undefined;
			this._runner?.();
		}, delay);
	}

	get isScheduled(): boolean {
		return this._timeout !== undefined;
	}

	flush(): void {
		if (this.isScheduled) {
			this.cancel();
			this._runner?.();
		}
	}

	set delay(value: number) {
		this._delay = value;
	}

	get delay(): number {
		return this._delay;
	}
}

export class RunOnceWorker<T> extends RunOnceScheduler {
	private _units: T[] = [];

	constructor(runner: (units: T[]) => void, delay: number) {
		super(() => {
			const units = this._units;
			this._units = [];
			runner(units);
		}, delay);
	}

	work(unit: T): void {
		this._units.push(unit);
		if (!this.isScheduled) {
			this.schedule();
		}
	}

	override dispose(): void {
		this._units = [];
		super.dispose();
	}
}

export class ProcessTimeRunOnceScheduler implements IDisposable {
	private _runner: (() => void) | null;
	private _timeout: any;
	private _delay: number;

	constructor(runner: () => void, delay: number) {
		this._runner = runner;
		this._delay = delay;
		this._timeout = undefined;
	}

	dispose(): void {
		this.cancel();
		this._runner = null;
	}

	cancel(): void {
		if (this._timeout !== undefined) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}
	}

	schedule(delay: number = this._delay): void {
		this.cancel();
		this._timeout = setTimeout(() => {
			this._timeout = undefined;
			this._runner?.();
		}, delay);
	}

	get isScheduled(): boolean {
		return this._timeout !== undefined;
	}
}
