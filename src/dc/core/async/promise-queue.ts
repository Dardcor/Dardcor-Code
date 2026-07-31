/**
 * Dardcor Code - Serialized Async Queue & Task Concurrency Limiter
 */

export interface ITask<T> {
	(): Promise<T>;
}

export class Queue<T = void> {
	private _promise: Promise<any> = Promise.resolve();

	public queue(task: ITask<T>): Promise<T> {
		const result = this._promise.then(
			() => task(),
			() => task()
		);
		this._promise = result.catch(() => {});
		return result;
	}

	public get size(): number {
		return 0; // Simplified tracking
	}
}

export class Limiter<T = void> {
	private _activeCount = 0;
	private readonly _queue: { task: ITask<T>; resolve: (v: T | PromiseLike<T>) => void; reject: (r?: any) => void }[] = [];

	constructor(private _maxDegreeOfParallelism: number) {}

	public queue(task: ITask<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this._queue.push({ task, resolve, reject });
			this._consume();
		});
	}

	private _consume(): void {
		while (this._activeCount < this._maxDegreeOfParallelism && this._queue.length > 0) {
			const item = this._queue.shift();
			if (!item) {
				break;
			}
			this._activeCount++;
			const promise = item.task();
			promise
				.then(
					res => item.resolve(res),
					err => item.reject(err)
				)
				.finally(() => {
					this._activeCount--;
					this._consume();
				});
		}
	}
}
