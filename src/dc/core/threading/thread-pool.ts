/**
 * Dardcor Code - Worker Thread Pool Executor
 */

import { WorkerClient } from './worker-client.js';
import { Disposable } from '../lifecycle/disposable.js';

export class ThreadPool extends Disposable {
	private readonly _workers: WorkerClient[] = [];
	private _nextWorker = 0;

	constructor(workerUrl: string, size = 4) {
		super();
		for (let i = 0; i < size; i++) {
			this._workers.push(this._register(new WorkerClient(workerUrl)));
		}
	}

	execute(taskMessage: any): Promise<any> {
		if (this._workers.length === 0) {
			return Promise.reject(new Error('ThreadPool is empty or disposed'));
		}
		const worker = this._workers[this._nextWorker];
		this._nextWorker = (this._nextWorker + 1) % this._workers.length;

		return new Promise(resolve => {
			const sub = worker.onMessage(data => {
				sub.dispose();
				resolve(data);
			});
			worker.postMessage(taskMessage);
		});
	}
}
