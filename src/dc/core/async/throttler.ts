/**
 * Dardcor Code - Throttler & ThrottledDelayer
 */

import { ITask } from './promise-queue';
import { IDisposable } from '../lifecycle/disposable';

export class Throttler implements IDisposable {
	private _activePromise: Promise<any> | null = null;
	private _queuedTask: ITask<any> | null = null;

	public queue<T>(promiseFactory: ITask<T>): Promise<T> {
		if (this._activePromise) {
			this._queuedTask = promiseFactory;
			return this._activePromise.then(() => {
				if (this._queuedTask === promiseFactory) {
					this._queuedTask = null;
					return this.queue(promiseFactory);
				}
				return Promise.resolve(undefined as any);
			});
		}

		this._activePromise = promiseFactory().finally(() => {
			this._activePromise = null;
		});

		return this._activePromise;
	}

	public dispose(): void {
		this._activePromise = null;
		this._queuedTask = null;
	}
}

export class ThrottledDelayer<T> implements IDisposable {
	private _timeout: any = null;
	private _task: ITask<T> | null = null;

	constructor(private _delay: number) {}

	public trigger(task: ITask<T>): Promise<T> {
		this._task = task;
		this.cancel();

		return new Promise((resolve, reject) => {
			this._timeout = setTimeout(() => {
				if (this._task) {
					this._task().then(resolve, reject);
				}
			}, this._delay);
		});
	}

	public cancel(): void {
		if (this._timeout !== null) {
			clearTimeout(this._timeout);
			this._timeout = null;
		}
	}

	public dispose(): void {
		this.cancel();
		this._task = null;
	}
}
