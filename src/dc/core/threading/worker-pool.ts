/**
 * Dardcor Code - CPU Core Scaling Worker Cluster (Task 85)
 * Mirrors: vs/base/common/worker/
 */

import { IDisposable } from '../lifecycle/disposable';

export interface IWorkerTask<TInput, TOutput> {
	id: number;
	input: TInput;
	resolve: (output: TOutput) => void;
	reject: (error: Error) => void;
}

export class WorkerCluster<TInput, TOutput> implements IDisposable {
	private readonly _workers: Worker[] = [];
	private readonly _idle: Worker[] = [];
	private readonly _queue: IWorkerTask<TInput, TOutput>[] = [];
	private _nextId = 0;

	constructor(
		private readonly _workerUrl: string | URL,
		private readonly _maxWorkers: number = navigator.hardwareConcurrency || 4
	) {
		for (let i = 0; i < this._maxWorkers; i++) {
			const worker = new Worker(this._workerUrl, { type: 'module' });
			this._workers.push(worker);
			this._idle.push(worker);
		}
	}

	execute(input: TInput): Promise<TOutput> {
		return new Promise<TOutput>((resolve, reject) => {
			const task: IWorkerTask<TInput, TOutput> = {
				id: this._nextId++,
				input,
				resolve,
				reject,
			};
			this._queue.push(task);
			this._process();
		});
	}

	private _process(): void {
		while (this._queue.length > 0 && this._idle.length > 0) {
			const worker = this._idle.pop()!;
			const task = this._queue.shift()!;

			const onMessage = (e: MessageEvent) => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
				this._idle.push(worker);
				task.resolve(e.data);
				this._process();
			};
			const onError = (e: ErrorEvent) => {
				worker.removeEventListener('message', onMessage);
				worker.removeEventListener('error', onError);
				this._idle.push(worker);
				task.reject(new Error(e.message));
				this._process();
			};
			worker.addEventListener('message', onMessage);
			worker.addEventListener('error', onError);
			worker.postMessage(task.input);
		}
	}

	get pendingCount(): number {
		return this._queue.length;
	}

	get activeCount(): number {
		return this._maxWorkers - this._idle.length;
	}

	dispose(): void {
		for (const worker of this._workers) {
			worker.terminate();
		}
		this._workers.length = 0;
		this._idle.length = 0;
		for (const task of this._queue) {
			task.reject(new Error('WorkerCluster disposed'));
		}
		this._queue.length = 0;
	}
}
