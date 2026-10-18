/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from './cancellation.js';
import { BugIndicatingError, CancellationError, isCancellationError } from './errors.js';
import { Emitter, Event } from './event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, isDisposable, MutableDisposable, toDisposable } from './lifecycle.js';
import { extUri as defaultExtUri, IExtUri } from './resources.js';
import { URI } from './uri.js';
import { setTimeout0 } from './platform.js';
import { MicrotaskDelay } from './symbols.js';
import { Lazy } from './lazy.js';

export function isThenable<T>(obj: unknown): obj is Promise<T> {
	return !!obj && typeof (obj as unknown as Promise<T>).then === 'function';
}

export interface CancelablePromise<T> extends Promise<T> {
	cancel(): void;
}

export function createCancelablePromise<T>(callback: (token: CancellationToken) => Promise<T>): CancelablePromise<T> {
	const source = new CancellationTokenSource();

	const thenable = callback(source.token);

	let isCancelled = false;

	const promise = new Promise<T>((resolve, reject) => {
		const subscription = source.token.onCancellationRequested(() => {
			isCancelled = true;
			subscription.dispose();
			reject(new CancellationError());
		});
		Promise.resolve(thenable).then(value => {
			subscription.dispose();
			source.dispose();

			if (!isCancelled) {
				resolve(value);

			} else if (isDisposable(value)) {
				value.dispose();
			}
		}, err => {
			subscription.dispose();
			source.dispose();
			reject(err);
		});
	});

	return <CancelablePromise<T>>new class {
		cancel() {
			source.cancel();
			source.dispose();
		}
		then<TResult1 = T, TResult2 = never>(resolve?: ((value: T) => TResult1 | Promise<TResult1>) | undefined | null, reject?: ((reason: unknown) => TResult2 | Promise<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
			return promise.then(resolve, reject);
		}
		catch<TResult = never>(reject?: ((reason: unknown) => TResult | Promise<TResult>) | undefined | null): Promise<T | TResult> {
			return this.then(undefined, reject);
		}
		finally(onfinally?: (() => void) | undefined | null): Promise<T> {
			return promise.finally(onfinally);
		}
	};
}

export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken): Promise<T | undefined>;

export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken, defaultValue: T): Promise<T>;

export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken, defaultValue?: T): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		const ref = token.onCancellationRequested(() => {
			ref.dispose();
			resolve(defaultValue);
		});
		promise.then(resolve, reject).finally(() => ref.dispose());
	});
}

export function raceCancellationError<T>(promise: Promise<T>, token: CancellationToken): Promise<T> {
	return new Promise((resolve, reject) => {
		const ref = token.onCancellationRequested(() => {
			ref.dispose();
			reject(new CancellationError());
		});
		promise.then(resolve, reject).finally(() => ref.dispose());
	});
}

export function rejectIfNotCanceled(err: unknown): undefined {
	if (isCancellationError(err)) {
		return undefined;
	}
	return Promise.reject(err) as never;
}

export function notCancellablePromise<T>(promise: CancelablePromise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		promise.then(resolve, reject);
	});
}

export function raceCancellablePromises<T>(cancellablePromises: (CancelablePromise<T> | Promise<T>)[]): CancelablePromise<T> {
	let resolvedPromiseIndex = -1;
	const promises = cancellablePromises.map((promise, index) => promise.then(result => { resolvedPromiseIndex = index; return result; }));
	const promise = Promise.race(promises) as CancelablePromise<T>;
	promise.cancel = () => {
		cancellablePromises.forEach((cancellablePromise, index) => {
			if (index !== resolvedPromiseIndex && (cancellablePromise as CancelablePromise<T>).cancel) {
				(cancellablePromise as CancelablePromise<T>).cancel();
			}
		});
	};
	promise.finally(() => {
		promise.cancel();
	});
	return promise;
}

export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>(resolve => promiseResolve = resolve)
	]);
}

export function asPromise<T>(callback: () => T | Thenable<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const item = callback();
		if (isThenable<T>(item)) {
			item.then(resolve, reject);
		} else {
			resolve(item);
		}
	});
}

export function promiseWithResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (err?: any) => void } {
	let resolve: (value: T | PromiseLike<T>) => void;
	let reject: (reason?: any) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve: resolve!, reject: reject! };
}

export interface ITask<T> {
	(): T;
}

export interface ICancellableTask<T> {
	(token: CancellationToken): T;
}

export class Throttler implements IDisposable {

	private activePromise: Promise<any> | null;
	private queuedPromise: Promise<any> | null;
	private queuedPromiseFactory: ICancellableTask<Promise<any>> | null;
	private cancellationTokenSource: CancellationTokenSource;

	constructor() {
		this.activePromise = null;
		this.queuedPromise = null;
		this.queuedPromiseFactory = null;

		this.cancellationTokenSource = new CancellationTokenSource();
	}

	queue<T>(promiseFactory: ICancellableTask<Promise<T>>): Promise<T> {
		if (this.cancellationTokenSource.token.isCancellationRequested) {
			return Promise.reject(new Error('Throttler is disposed'));
		}

		if (this.activePromise) {
			this.queuedPromiseFactory = promiseFactory;

			if (!this.queuedPromise) {
				const onComplete = () => {
					this.queuedPromise = null;

					if (this.cancellationTokenSource.token.isCancellationRequested) {
						return;
					}

					const result = this.queue(this.queuedPromiseFactory!);
					this.queuedPromiseFactory = null;

					return result;
				};

				this.queuedPromise = new Promise(resolve => {
					this.activePromise!.then(onComplete, onComplete).then(resolve);
				});
			}

			return new Promise((resolve, reject) => {
				this.queuedPromise!.then(resolve, reject);
			});
		}

		this.activePromise = promiseFactory(this.cancellationTokenSource.token);

		return new Promise((resolve, reject) => {
			this.activePromise!.then((result: T) => {
				this.activePromise = null;
				resolve(result);
			}, (err: unknown) => {
				this.activePromise = null;
				reject(err);
			});
		});
	}

	dispose(): void {
		this.cancellationTokenSource.cancel();
	}
}

export class Sequencer {

	private current: Promise<unknown> = Promise.resolve(null);

	queue<T>(promiseTask: ITask<Promise<T>>): Promise<T> {
		return this.current = this.current.then(() => promiseTask(), () => promiseTask());
	}
}

export class ThrottlerByKey<TKey> implements IDisposable {

	private readonly throttlers = new Map<TKey, { throttler: Throttler; count: number }>();

	queue<T>(key: TKey, task: ITask<Promise<T>>): Promise<T> {
		let entry = this.throttlers.get(key);
		if (!entry) {
			entry = { throttler: new Throttler(), count: 0 };
			this.throttlers.set(key, entry);
		}

		entry.count++;
		return entry.throttler.queue(task).finally(() => {
			if (--entry!.count === 0) {
				entry!.throttler.dispose();
				this.throttlers.delete(key);
			}
		});
	}

	dispose(): void {
		for (const { throttler } of this.throttlers.values()) {
			throttler.dispose();
		}
		this.throttlers.clear();
	}
}

export class SequencerByKey<TKey> {

	private promiseMap = new Map<TKey, Promise<unknown>>();

	queue<T>(key: TKey, promiseTask: ITask<Promise<T>>): Promise<T> {
		const runningPromise = this.promiseMap.get(key) ?? Promise.resolve();
		const newPromise = runningPromise
			.catch(() => { })
			.then(promiseTask)
			.finally(() => {
				if (this.promiseMap.get(key) === newPromise) {
					this.promiseMap.delete(key);
				}
			});
		this.promiseMap.set(key, newPromise);
		return newPromise;
	}

	peek(key: TKey): Promise<unknown> | undefined {
		return this.promiseMap.get(key) || undefined;
	}

	keys(): IterableIterator<TKey> {
		return this.promiseMap.keys();
	}
}

interface IScheduledLater extends IDisposable {
	isTriggered(): boolean;
}

const timeoutDeferred = (timeout: number, fn: () => void): IScheduledLater => {
	let scheduled = true;
	const handle = setTimeout(() => {
		scheduled = false;
		fn();
	}, timeout);
	return {
		isTriggered: () => scheduled,
		dispose: () => {
			clearTimeout(handle);
			scheduled = false;
		},
	};
};

const microtaskDeferred = (fn: () => void): IScheduledLater => {
	let scheduled = true;
	queueMicrotask(() => {
		if (scheduled) {
			scheduled = false;
			fn();
		}
	});

	return {
		isTriggered: () => scheduled,
		dispose: () => { scheduled = false; },
	};
};

export class Delayer<T> implements IDisposable {

	private deferred: IScheduledLater | null;
	private completionPromise: Promise<any> | null;
	private doResolve: ((value?: any | Promise<any>) => void) | null;
	private doReject: ((err: unknown) => void) | null;
	private task: ITask<T | Promise<T>> | null;

	constructor(public defaultDelay: number | typeof MicrotaskDelay) {
		this.deferred = null;
		this.completionPromise = null;
		this.doResolve = null;
		this.doReject = null;
		this.task = null;
	}

	trigger(task: ITask<T | Promise<T>>, delay = this.defaultDelay): Promise<T> {
		this.task = task;
		this.cancelTimeout();

		if (!this.completionPromise) {
			this.completionPromise = new Promise((resolve, reject) => {
				this.doResolve = resolve;
				this.doReject = reject;
			}).then(() => {
				this.completionPromise = null;
				this.doResolve = null;
				if (this.task) {
					const task = this.task;
					this.task = null;
					return task();
				}
				return undefined;
			});
		}

		const fn = () => {
			this.deferred = null;
			this.doResolve?.(null);
		};

		this.deferred = delay === MicrotaskDelay ? microtaskDeferred(fn) : timeoutDeferred(delay, fn);

		return this.completionPromise;
	}

	isTriggered(): boolean {
		return !!this.deferred?.isTriggered();
	}

	cancel(): void {
		this.cancelTimeout();

		if (this.completionPromise) {
			this.doReject?.(new CancellationError());
			this.completionPromise = null;
		}
	}

	private cancelTimeout(): void {
		this.deferred?.dispose();
		this.deferred = null;
	}

	dispose(): void {
		this.cancel();
	}
}

export class ThrottledDelayer<T> {

	private delayer: Delayer<Promise<T>>;
	private throttler: Throttler;

	constructor(defaultDelay: number) {
		this.delayer = new Delayer(defaultDelay);
		this.throttler = new Throttler();
	}

	trigger(promiseFactory: ICancellableTask<Promise<T>>, delay?: number): Promise<T> {
		return this.delayer.trigger(() => this.throttler.queue(promiseFactory), delay) as unknown as Promise<T>;
	}

	isTriggered(): boolean {
		return this.delayer.isTriggered();
	}

	cancel(): void {
		this.delayer.cancel();
	}

	dispose(): void {
		this.delayer.dispose();
		this.throttler.dispose();
	}
}

export class Barrier {
	private _isOpen: boolean;
	private _promise: Promise<boolean>;
	private _completePromise!: (v: boolean) => void;

	constructor() {
		this._isOpen = false;
		this._promise = new Promise<boolean>((c, e) => {
			this._completePromise = c;
		});
	}

	isOpen(): boolean {
		return this._isOpen;
	}

	open(): void {
		this._isOpen = true;
		this._completePromise(true);
	}

	wait(): Promise<boolean> {
		return this._promise;
	}
}

export class AutoOpenBarrier extends Barrier {

	private readonly _timeout: Timeout;

	constructor(autoOpenTimeMs: number) {
		super();
		this._timeout = setTimeout(() => this.open(), autoOpenTimeMs);
	}

	override open(): void {
		clearTimeout(this._timeout);
		super.open();
	}
}

export function timeout(millis: number): CancelablePromise<void>;
export function timeout(millis: number, token: CancellationToken): Promise<void>;
export function timeout(millis: number, token?: CancellationToken): CancelablePromise<void> | Promise<void> {
	if (!token) {
		return createCancelablePromise(token => timeout(millis, token));
	}

	return new Promise((resolve, reject) => {
		const handle = setTimeout(() => {
			disposable.dispose();
			resolve();
		}, millis);
		const disposable = token.onCancellationRequested(() => {
			clearTimeout(handle);
			disposable.dispose();
			reject(new CancellationError());
		});
	});
}

export function disposableTimeout(handler: () => void, timeout = 0, store?: DisposableStore): IDisposable {
	const timer = setTimeout(() => {
		handler();
		if (store) {
			disposable.dispose();
		}
	}, timeout);
	const disposable = toDisposable(() => {
		clearTimeout(timer);
		store?.delete(disposable);
	});
	store?.add(disposable);
	return disposable;
}

export const MAX_TIMEOUT_DELAY = 2 ** 31 - 1;

export function disposableLongTimeout(handler: () => void, timeout: number, store?: DisposableStore): IDisposable {
	const target = Date.now() + timeout;
	let timer: Timeout;

	const arm = () => {
		const remaining = target - Date.now();
		if (remaining <= 0) {
			handler();
			if (store) {
				disposable.dispose();
			}
			return;
		}
		timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_DELAY));
	};

	const disposable = toDisposable(() => {
		clearTimeout(timer);
		store?.delete(disposable);
	});

	timer = setTimeout(arm, Math.min(Math.max(0, timeout), MAX_TIMEOUT_DELAY));
	store?.add(disposable);
	return disposable;
}


export function sequence<T>(promiseFactories: ITask<Promise<T>>[]): Promise<T[]> {
	const results: T[] = [];
	let index = 0;
	const len = promiseFactories.length;

	function next(): Promise<T> | null {
		return index < len ? promiseFactories[index++]() : null;
	}

	function thenHandler(result: unknown): Promise<any> {
		if (result !== undefined && result !== null) {
			results.push(result as T);
		}

		const n = next();
		if (n) {
			return n.then(thenHandler);
		}

		return Promise.resolve(results);
	}

	return Promise.resolve(null).then(thenHandler);
}

export function first<T>(promiseFactories: ITask<Promise<T>>[], shouldStop: (t: T) => boolean = t => !!t, defaultValue: T | null = null): Promise<T | null> {
	let index = 0;
	const len = promiseFactories.length;

	const loop: () => Promise<T | null> = () => {
		if (index >= len) {
			return Promise.resolve(defaultValue);
		}

		const factory = promiseFactories[index++];
		const promise = Promise.resolve(factory());

		return promise.then(result => {
			if (shouldStop(result)) {
				return Promise.resolve(result);
			}

			return loop();
		});
	};

	return loop();
}

export function firstParallel<T>(promiseList: Promise<T>[], shouldStop?: (t: T) => boolean, defaultValue?: T | null): Promise<T | null>;
export function firstParallel<T, R extends T>(promiseList: Promise<T>[], shouldStop: (t: T) => t is R, defaultValue?: R | null): Promise<R | null>;
export function firstParallel<T>(promiseList: Promise<T>[], shouldStop: (t: T) => boolean = t => !!t, defaultValue: T | null = null) {
	if (promiseList.length === 0) {
		return Promise.resolve(defaultValue);
	}

	let todo = promiseList.length;
	const finish = () => {
		todo = -1;
		for (const promise of promiseList) {
			(promise as Partial<CancelablePromise<T>>).cancel?.();
		}
	};

	return new Promise<T | null>((resolve, reject) => {
		for (const promise of promiseList) {
			promise.then(result => {
				if (--todo >= 0 && shouldStop(result)) {
					finish();
					resolve(result);
				} else if (todo === 0) {
					resolve(defaultValue);
				}
			})
				.catch(err => {
					if (--todo >= 0) {
						finish();
						reject(err);
					}
				});
		}
	});
}

interface ILimitedTaskFactory<T> {
	factory: ITask<Promise<T>>;
	c: (value: T | Promise<T>) => void;
	e: (error?: unknown) => void;
}

export interface ILimiter<T> {

	readonly size: number;

	queue(factory: ITask<Promise<T>>): Promise<T>;

	clear(): void;
}

export class Limiter<T> implements ILimiter<T> {

	private _size = 0;
	private _isDisposed = false;
	private runningPromises: number;
	private readonly maxDegreeOfParalellism: number;
	private readonly outstandingPromises: ILimitedTaskFactory<T>[];
	private readonly _onDrained: Emitter<void>;

	constructor(maxDegreeOfParalellism: number) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
		this._onDrained = new Emitter<void>();
	}

	whenIdle(): Promise<void> {
		return this.size > 0
			? Event.toPromise(this.onDrained)
			: Promise.resolve();
	}

	get onDrained(): Event<void> {
		return this._onDrained.event;
	}

	get size(): number {
		return this._size;
	}

	queue(factory: ITask<Promise<T>>): Promise<T> {
		if (this._isDisposed) {
			throw new Error('Object has been disposed');
		}
		this._size++;

		return new Promise<T>((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}

	private consume(): void {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift()!;
			this.runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this.consumed(), () => this.consumed());
		}
	}

	private consumed(): void {
		if (this._isDisposed) {
			return;
		}
		this.runningPromises--;
		if (--this._size === 0) {
			this._onDrained.fire();
		}

		if (this.outstandingPromises.length > 0) {
			this.consume();
		}
	}

	clear(): void {
		if (this._isDisposed) {
			throw new Error('Object has been disposed');
		}
		this.outstandingPromises.length = 0;
		this._size = this.runningPromises;
	}

	dispose(): void {
		this._isDisposed = true;
		this.outstandingPromises.length = 0;
		this._size = 0;
		this._onDrained.dispose();
	}
}

export class Queue<T> extends Limiter<T> {

	constructor() {
		super(1);
	}
}

export class LimitedQueue {

	private readonly sequentializer = new TaskSequentializer();

	private tasks = 0;

	queue(factory: ITask<Promise<void>>): Promise<void> {
		if (!this.sequentializer.isRunning()) {
			return this.sequentializer.run(this.tasks++, factory());
		}

		return this.sequentializer.queue(() => {
			return this.sequentializer.run(this.tasks++, factory());
		});
	}
}

export class ResourceQueue implements IDisposable {

	private readonly queues = new Map<string, Queue<void>>();

	private readonly drainers = new Set<DeferredPromise<void>>();

	private drainListeners: DisposableMap<number> | undefined = undefined;
	private drainListenerCount = 0;

	async whenDrained(): Promise<void> {
		if (this.isDrained()) {
			return;
		}

		const promise = new DeferredPromise<void>();
		this.drainers.add(promise);

		return promise.p;
	}

	private isDrained(): boolean {
		for (const [, queue] of this.queues) {
			if (queue.size > 0) {
				return false;
			}
		}

		return true;
	}

	queueSize(resource: URI, extUri: IExtUri = defaultExtUri): number {
		const key = extUri.getComparisonKey(resource);

		return this.queues.get(key)?.size ?? 0;
	}

	queueFor(resource: URI, factory: ITask<Promise<void>>, extUri: IExtUri = defaultExtUri): Promise<void> {
		const key = extUri.getComparisonKey(resource);

		let queue = this.queues.get(key);
		if (!queue) {
			queue = new Queue<void>();
			const drainListenerId = this.drainListenerCount++;
			const drainListener = Event.once(queue.onDrained)(() => {
				queue?.dispose();
				this.queues.delete(key);
				this.onDidQueueDrain();

				this.drainListeners?.deleteAndDispose(drainListenerId);

				if (this.drainListeners?.size === 0) {
					this.drainListeners.dispose();
					this.drainListeners = undefined;
				}
			});

			if (!this.drainListeners) {
				this.drainListeners = new DisposableMap();
			}
			this.drainListeners.set(drainListenerId, drainListener);

			this.queues.set(key, queue);
		}

		return queue.queue(factory);
	}

	private onDidQueueDrain(): void {
		if (!this.isDrained()) {
			return;
		}

		this.releaseDrainers();
	}

	private releaseDrainers(): void {
		for (const drainer of this.drainers) {
			drainer.complete();
		}

		this.drainers.clear();
	}

	dispose(): void {
		for (const [, queue] of this.queues) {
			queue.dispose();
		}

		this.queues.clear();

		this.releaseDrainers();

		this.drainListeners?.dispose();
	}
}

export type Task<T = void> = () => (Promise<T> | T);

export type MaybePromise<T> = Promise<T> | T;

export class TaskQueue {
	private _runningTask: Task<any> | undefined = undefined;
	private _pendingTasks: { task: Task<any>; deferred: DeferredPromise<any>; setUndefinedWhenCleared: boolean }[] = [];

	public schedule<T>(task: Task<T>): Promise<T> {
		const deferred = new DeferredPromise<T>();
		this._pendingTasks.push({ task, deferred, setUndefinedWhenCleared: false });
		this._runIfNotRunning();
		return deferred.p;
	}

	public scheduleSkipIfCleared<T>(task: Task<T>): Promise<T | undefined> {
		const deferred = new DeferredPromise<T>();
		this._pendingTasks.push({ task, deferred, setUndefinedWhenCleared: true });
		this._runIfNotRunning();
		return deferred.p;
	}

	private _runIfNotRunning(): void {
		if (this._runningTask === undefined) {
			this._processQueue();
		}
	}

	private async _processQueue(): Promise<void> {
		if (this._pendingTasks.length === 0) {
			return;
		}

		const next = this._pendingTasks.shift();
		if (!next) {
			return;
		}

		if (this._runningTask) {
			throw new BugIndicatingError();
		}

		this._runningTask = next.task;

		try {
			const result = await next.task();
			next.deferred.complete(result);
		} catch (e) {
			next.deferred.error(e);
		} finally {
			this._runningTask = undefined;
			this._processQueue();
		}
	}

	public clearPending(): void {
		const tasks = this._pendingTasks;
		this._pendingTasks = [];
		for (const task of tasks) {
			if (task.setUndefinedWhenCleared) {
				task.deferred.complete(undefined);
			} else {
				task.deferred.error(new CancellationError());
			}
		}
	}
}

export class TimeoutTimer implements IDisposable {
	private _token: Timeout | undefined;
	private _isDisposed = false;

	constructor();
	constructor(runner: () => void, timeout: number);
	constructor(runner?: () => void, timeout?: number) {
		this._token = undefined;

		if (typeof runner === 'function' && typeof timeout === 'number') {
			this.setIfNotSet(runner, timeout);
		}
	}

	dispose(): void {
		this.cancel();
		this._isDisposed = true;
	}

	cancel(): void {
		if (this._token !== undefined) {
			clearTimeout(this._token);
			this._token = undefined;
		}
	}

	cancelAndSet(runner: () => void, timeout: number): void {
		if (this._isDisposed) {
			throw new BugIndicatingError(`Calling 'cancelAndSet' on a disposed TimeoutTimer`);
		}

		this.cancel();
		this._token = setTimeout(() => {
			this._token = undefined;
			runner();
		}, timeout);
	}

	setIfNotSet(runner: () => void, timeout: number): void {
		if (this._isDisposed) {
			throw new BugIndicatingError(`Calling 'setIfNotSet' on a disposed TimeoutTimer`);
		}

		if (this._token !== undefined) {
			return;
		}
		this._token = setTimeout(() => {
			this._token = undefined;
			runner();
		}, timeout);
	}
}

export class IntervalTimer implements IDisposable {

	private disposable: IDisposable | undefined = undefined;
	private isDisposed = false;

	cancel(): void {
		this.disposable?.dispose();
		this.disposable = undefined;
	}

	cancelAndSet(runner: () => void, interval: number, context = globalThis): void {
		if (this.isDisposed) {
			throw new BugIndicatingError(`Calling 'cancelAndSet' on a disposed IntervalTimer`);
		}

		this.cancel();
		const handle = context.setInterval(() => {
			runner();
		}, interval);

		this.disposable = toDisposable(() => {
			context.clearInterval(handle);
			this.disposable = undefined;
		});
	}

	dispose(): void {
		this.cancel();
		this.isDisposed = true;
	}
}

export class RunOnceScheduler<Runner extends (...args: any[]) => any = () => any> implements IDisposable {

	protected runner: Runner | null;

	private timeoutToken: Timeout | undefined;
	private timeout: number;
	private timeoutHandler: () => void;

	constructor(runner: Runner, delay: number) {
		this.timeoutToken = undefined;
		this.runner = runner;
		this.timeout = delay;
		this.timeoutHandler = this.onTimeout.bind(this);
	}

	dispose(): void {
		this.cancel();
		this.runner = null;
	}

	cancel(): void {
		if (this.isScheduled()) {
			clearTimeout(this.timeoutToken);
			this.timeoutToken = undefined;
		}
	}

	schedule(delay = this.timeout): void {
		this.cancel();
		this.timeoutToken = setTimeout(this.timeoutHandler, delay);
	}

	get delay(): number {
		return this.timeout;
	}

	set delay(value: number) {
		this.timeout = value;
	}

	isScheduled(): boolean {
		return this.timeoutToken !== undefined;
	}

	flush(): void {
		if (this.isScheduled()) {
			this.cancel();
			this.doRun();
		}
	}

	private onTimeout() {
		this.timeoutToken = undefined;
		if (this.runner) {
			this.doRun();
		}
	}

	protected doRun(): void {
		this.runner?.();
	}
}

export class ProcessTimeRunOnceScheduler {

	private runner: (() => void) | null;
	private timeout: number;

	private counter: number;
	private intervalToken: Timeout | undefined;
	private intervalHandler: () => void;

	constructor(runner: () => void, delay: number) {
		if (delay % 1000 !== 0) {
			console.warn(`ProcessTimeRunOnceScheduler resolution is 1s, ${delay}ms is not a multiple of 1000ms.`);
		}
		this.runner = runner;
		this.timeout = delay;
		this.counter = 0;
		this.intervalToken = undefined;
		this.intervalHandler = this.onInterval.bind(this);
	}

	dispose(): void {
		this.cancel();
		this.runner = null;
	}

	cancel(): void {
		if (this.isScheduled()) {
			clearInterval(this.intervalToken);
			this.intervalToken = undefined;
		}
	}

	schedule(delay = this.timeout): void {
		if (delay % 1000 !== 0) {
			console.warn(`ProcessTimeRunOnceScheduler resolution is 1s, ${delay}ms is not a multiple of 1000ms.`);
		}
		this.cancel();
		this.counter = Math.ceil(delay / 1000);
		this.intervalToken = setInterval(this.intervalHandler, 1000);
	}

	isScheduled(): boolean {
		return this.intervalToken !== undefined;
	}

	private onInterval() {
		this.counter--;
		if (this.counter > 0) {
			return;
		}

		clearInterval(this.intervalToken);
		this.intervalToken = undefined;
		this.runner?.();
	}
}

export class RunOnceWorker<T> extends RunOnceScheduler<(units: T[]) => void> {

	private units: T[] = [];

	constructor(runner: (units: T[]) => void, timeout: number) {
		super(runner, timeout);
	}

	work(unit: T): void {
		this.units.push(unit);

		if (!this.isScheduled()) {
			this.schedule();
		}
	}

	protected override doRun(): void {
		const units = this.units;
		this.units = [];

		this.runner?.(units);
	}

	override dispose(): void {
		this.units = [];

		super.dispose();
	}
}

export interface IThrottledWorkerOptions {

	maxWorkChunkSize: number;

	maxBufferedWork: number | undefined;

	throttleDelay: number;

	waitThrottleDelayBetweenWorkUnits?: boolean;
}

export class ThrottledWorker<T> extends Disposable {

	private readonly pendingWork: T[] = [];

	private readonly throttler = this._register(new MutableDisposable<RunOnceScheduler>());
	private disposed = false;
	private lastExecutionTime = 0;

	constructor(
		private options: IThrottledWorkerOptions,
		private readonly handler: (units: T[]) => void
	) {
		super();
	}

	get pending(): number { return this.pendingWork.length; }

	work(units: readonly T[]): boolean {
		if (this.disposed) {
			return false;
		}

		if (typeof this.options.maxBufferedWork === 'number') {

			if (this.throttler.value) {
				if (this.pending + units.length > this.options.maxBufferedWork) {
					return false;
				}
			}

			else {
				if (this.pending + units.length - this.options.maxWorkChunkSize > this.options.maxBufferedWork) {
					return false;
				}
			}
		}

		for (const unit of units) {
			this.pendingWork.push(unit);
		}

		const timeSinceLastExecution = Date.now() - this.lastExecutionTime;

		if (!this.throttler.value && (!this.options.waitThrottleDelayBetweenWorkUnits || timeSinceLastExecution >= this.options.throttleDelay)) {
			this.doWork();
		} else if (!this.throttler.value && this.options.waitThrottleDelayBetweenWorkUnits) {
			this.scheduleThrottler(Math.max(this.options.throttleDelay - timeSinceLastExecution, 0));
		} else {
		}

		return true;
	}

	private doWork(): void {
		this.lastExecutionTime = Date.now();

		this.handler(this.pendingWork.splice(0, this.options.maxWorkChunkSize));

		if (this.pendingWork.length > 0) {
			this.scheduleThrottler();
		}
	}

	private scheduleThrottler(delay = this.options.throttleDelay): void {
		this.throttler.value = new RunOnceScheduler(() => {
			this.throttler.clear();

			this.doWork();
		}, delay);
		this.throttler.value.schedule();
	}

	override dispose(): void {
		super.dispose();

		this.pendingWork.length = 0;
		this.disposed = true;
	}
}


export interface IdleDeadline {
	readonly didTimeout: boolean;
	timeRemaining(): number;
}

type IdleApi = Pick<typeof globalThis, 'requestIdleCallback' | 'cancelIdleCallback'>;


export let runWhenGlobalIdle: (callback: (idle: IdleDeadline) => void, timeout?: number) => IDisposable;

export let _runWhenIdle: (targetWindow: IdleApi, callback: (idle: IdleDeadline) => void, timeout?: number) => IDisposable;

(function () {
	const safeGlobal: any = globalThis;
	if (typeof safeGlobal.requestIdleCallback !== 'function' || typeof safeGlobal.cancelIdleCallback !== 'function') {
		_runWhenIdle = (_targetWindow, runner, timeout?) => {
			setTimeout0(() => {
				if (disposed) {
					return;
				}
				const end = Date.now() + 15;
				const deadline: IdleDeadline = {
					didTimeout: true,
					timeRemaining() {
						return Math.max(0, end - Date.now());
					}
				};
				runner(Object.freeze(deadline));
			});
			let disposed = false;
			return {
				dispose() {
					if (disposed) {
						return;
					}
					disposed = true;
				}
			};
		};
	} else {
		_runWhenIdle = (targetWindow: typeof safeGlobal, runner, timeout?) => {
			const handle: number = targetWindow.requestIdleCallback(runner, typeof timeout === 'number' ? { timeout } : undefined);
			let disposed = false;
			return {
				dispose() {
					if (disposed) {
						return;
					}
					disposed = true;
					targetWindow.cancelIdleCallback(handle);
				}
			};
		};
	}
	runWhenGlobalIdle = (runner, timeout) => _runWhenIdle(globalThis, runner, timeout);
})();

export function installFakeRunWhenIdle(fakeImpl: typeof _runWhenIdle): IDisposable {
	const origRunWhenIdle = _runWhenIdle;
	const origRunWhenGlobalIdle = runWhenGlobalIdle;
	_runWhenIdle = fakeImpl;
	runWhenGlobalIdle = (runner, timeout) => fakeImpl(globalThis, runner, timeout);
	return toDisposable(() => {
		_runWhenIdle = origRunWhenIdle;
		runWhenGlobalIdle = origRunWhenGlobalIdle;
	});
}

export abstract class AbstractIdleValue<T> {

	private readonly _executor: () => void;
	private readonly _handle: IDisposable;

	private _didRun: boolean = false;
	private _value?: T;
	private _error: unknown;

	constructor(targetWindow: IdleApi, executor: () => T) {
		this._executor = () => {
			try {
				this._value = executor();
			} catch (err) {
				this._error = err;
			} finally {
				this._didRun = true;
			}
		};
		this._handle = _runWhenIdle(targetWindow, () => this._executor());
	}

	dispose(): void {
		this._handle.dispose();
	}

	get value(): T {
		if (!this._didRun) {
			this._handle.dispose();
			this._executor();
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}

	get isInitialized(): boolean {
		return this._didRun;
	}
}

export class GlobalIdleValue<T> extends AbstractIdleValue<T> {

	constructor(executor: () => T) {
		super(globalThis, executor);
	}
}


export async function retry<T>(task: ITask<Promise<T>>, delay: number, retries: number): Promise<T> {
	let lastError: Error | undefined;

	for (let i = 0; i < retries; i++) {
		try {
			return await task();
		} catch (error) {
			lastError = error;

			await timeout(delay);
		}
	}

	throw lastError;
}


interface IRunningTask {
	readonly taskId: number;
	readonly cancel: () => void;
	readonly promise: Promise<void>;
}

interface IQueuedTask {
	readonly promise: Promise<void>;
	readonly promiseResolve: () => void;
	readonly promiseReject: (error: Error) => void;
	run: ITask<Promise<void>>;
}

export interface ITaskSequentializerWithRunningTask {
	readonly running: Promise<void>;
}

export interface ITaskSequentializerWithQueuedTask {
	readonly queued: IQueuedTask;
}

export class TaskSequentializer {

	private _running?: IRunningTask;
	private _queued?: IQueuedTask;

	isRunning(taskId?: number): boolean {
		if (typeof taskId === 'number') {
			return this._running?.taskId === taskId;
		}

		return !!this._running;
	}

	get running(): Promise<void> | undefined {
		return this._running?.promise;
	}

	cancelRunning(): void {
		this._running?.cancel();
	}

	run(taskId: number, promise: Promise<void>, onCancel?: () => void,): Promise<void> {
		this._running = { taskId, cancel: () => onCancel?.(), promise };

		promise.then(() => this.doneRunning(taskId), () => this.doneRunning(taskId));

		return promise;
	}

	private doneRunning(taskId: number): void {
		if (this._running && taskId === this._running.taskId) {

			this._running = undefined;

			this.runQueued();
		}
	}

	private runQueued(): void {
		if (this._queued) {
			const queued = this._queued;
			this._queued = undefined;

			queued.run().then(queued.promiseResolve, queued.promiseReject);
		}
	}

	queue(run: ITask<Promise<void>>): Promise<void> {

		if (!this._queued) {
			const { promise, resolve: promiseResolve, reject: promiseReject } = promiseWithResolvers<void>();
			this._queued = {
				run,
				promise,
				promiseResolve,
				promiseReject
			};
		}

		else {
			this._queued.run = run;
		}

		return this._queued.promise;
	}

	hasQueued(): boolean {
		return !!this._queued;
	}

	async join(): Promise<void> {
		return this._queued?.promise ?? this._running?.promise;
	}
}



export class IntervalCounter {

	private lastIncrementTime = 0;

	private value = 0;

	constructor(private readonly interval: number, private readonly nowFn = () => Date.now()) { }

	increment(): number {
		const now = this.nowFn();

		if (now - this.lastIncrementTime > this.interval) {
			this.lastIncrementTime = now;
			this.value = 0;
		}

		this.value++;

		return this.value;
	}
}



export type ValueCallback<T = unknown> = (value: T | Promise<T>) => void;

const enum DeferredOutcome {
	Resolved,
	Rejected
}

export class DeferredPromise<T> {

	public static fromPromise<T>(promise: Promise<T>): DeferredPromise<T> {
		const deferred = new DeferredPromise<T>();
		deferred.settleWith(promise);
		return deferred;
	}

	private completeCallback!: ValueCallback<T>;
	private errorCallback!: (err: unknown) => void;
	private outcome?: { outcome: DeferredOutcome.Rejected; value: unknown } | { outcome: DeferredOutcome.Resolved; value: T };

	public get isRejected() {
		return this.outcome?.outcome === DeferredOutcome.Rejected;
	}

	public get isResolved() {
		return this.outcome?.outcome === DeferredOutcome.Resolved;
	}

	public get isSettled() {
		return !!this.outcome;
	}

	public get value() {
		return this.outcome?.outcome === DeferredOutcome.Resolved ? this.outcome?.value : undefined;
	}

	public readonly p: Promise<T>;

	constructor() {
		this.p = new Promise<T>((c, e) => {
			this.completeCallback = c;
			this.errorCallback = e;
		});
	}

	public complete(value: T) {
		if (this.isSettled) {
			return Promise.resolve();
		}

		return new Promise<void>(resolve => {
			this.completeCallback(value);
			this.outcome = { outcome: DeferredOutcome.Resolved, value };
			resolve();
		});
	}

	public error(err: unknown) {
		if (this.isSettled) {
			return Promise.resolve();
		}

		return new Promise<void>(resolve => {
			this.errorCallback(err);
			this.outcome = { outcome: DeferredOutcome.Rejected, value: err };
			resolve();
		});
	}

	public settleWith(promise: Promise<T>): Promise<void> {
		return promise.then(
			value => this.complete(value),
			error => this.error(error)
		);
	}

	public cancel() {
		return this.error(new CancellationError());
	}
}



export namespace Promises {

	export async function settled<T>(promises: Promise<T>[]): Promise<T[]> {
		let firstError: Error | undefined = undefined;

		const result = await Promise.all(promises.map(promise => promise.then(value => value, error => {
			if (!firstError) {
				firstError = error;
			}

			return undefined;
		})));

		if (typeof firstError !== 'undefined') {
			throw firstError;
		}

		return result as unknown as T[];
	}

	export function withAsyncBody<T, E = Error>(bodyFn: (resolve: (value: T) => unknown, reject: (error: E) => unknown) => Promise<unknown>): Promise<T> {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise<T>(async (resolve, reject) => {
			try {
				await bodyFn(resolve, reject);
			} catch (error) {
				reject(error);
			}
		});
	}
}

export class StatefulPromise<T> {
	private _value: T | undefined = undefined;
	get value(): T | undefined { return this._value; }

	private _error: unknown = undefined;
	get error(): unknown { return this._error; }

	private _isResolved = false;
	get isResolved() { return this._isResolved; }

	public readonly promise: Promise<T>;

	constructor(promise: Promise<T>) {
		this.promise = promise.then(
			value => {
				this._value = value;
				this._isResolved = true;
				return value;
			},
			error => {
				this._error = error;
				this._isResolved = true;
				throw error;
			}
		);
	}

	public requireValue(): T {
		if (!this._isResolved) {
			throw new BugIndicatingError('Promise is not resolved yet');
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}
}

export class LazyStatefulPromise<T> {
	private readonly _promise = new Lazy(() => new StatefulPromise(this._compute()));

	constructor(
		private readonly _compute: () => Promise<T>,
	) { }

	public requireValue(): T {
		return this._promise.value.requireValue();
	}

	public getPromise(): Promise<T> {
		return this._promise.value.promise;
	}

	public get currentValue(): T | undefined {
		return this._promise.rawValue?.value;
	}
}



const enum AsyncIterableSourceState {
	Initial,
	DoneOK,
	DoneError,
}

export interface AsyncIterableEmitter<T> {
	emitOne(value: T): void;
	emitMany(values: T[]): void;
	reject(error: Error): void;
}

export interface AsyncIterableExecutor<T> {
	(emitter: AsyncIterableEmitter<T>): unknown | Promise<unknown>;
}

export class AsyncIterableObject<T> implements AsyncIterable<T> {

	public static fromArray<T>(items: T[]): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>((writer) => {
			writer.emitMany(items);
		});
	}

	public static fromPromise<T>(promise: Promise<T[]>): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>(async (emitter) => {
			emitter.emitMany(await promise);
		});
	}

	public static fromPromisesResolveOrder<T>(promises: Promise<T>[]): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>(async (emitter) => {
			await Promise.all(promises.map(async (p) => emitter.emitOne(await p)));
		});
	}

	public static merge<T>(iterables: AsyncIterable<T>[]): AsyncIterableObject<T> {
		return new AsyncIterableObject(async (emitter) => {
			await Promise.all(iterables.map(async (iterable) => {
				for await (const item of iterable) {
					emitter.emitOne(item);
				}
			}));
		});
	}

	public static EMPTY = AsyncIterableObject.fromArray<any>([]);

	private _state: AsyncIterableSourceState;
	private _results: T[];
	private _error: Error | null;
	private readonly _onReturn?: () => void | Promise<void>;
	private readonly _onStateChanged: Emitter<void>;

	constructor(executor: AsyncIterableExecutor<T>, onReturn?: () => void | Promise<void>) {
		this._state = AsyncIterableSourceState.Initial;
		this._results = [];
		this._error = null;
		this._onReturn = onReturn;
		this._onStateChanged = new Emitter<void>();

		queueMicrotask(async () => {
			const writer: AsyncIterableEmitter<T> = {
				emitOne: (item) => this.emitOne(item),
				emitMany: (items) => this.emitMany(items),
				reject: (error) => this.reject(error)
			};
			try {
				await Promise.resolve(executor(writer));
				this.resolve();
			} catch (err) {
				this.reject(err);
			} finally {
				writer.emitOne = () => { };
				writer.emitMany = () => { };
				writer.reject = () => { };
			}
		});
	}

	[Symbol.asyncIterator](): AsyncIterator<T, undefined, undefined> {
		let i = 0;
		return {
			next: async () => {
				do {
					if (this._state === AsyncIterableSourceState.DoneError) {
						throw this._error;
					}
					if (i < this._results.length) {
						return { done: false, value: this._results[i++] };
					}
					if (this._state === AsyncIterableSourceState.DoneOK) {
						return { done: true, value: undefined };
					}
					await Event.toPromise(this._onStateChanged.event);
				} while (true);
			},
			return: async () => {
				this._onReturn?.();
				return { done: true, value: undefined };
			}
		};
	}

	public static map<T, R>(iterable: AsyncIterable<T>, mapFn: (item: T) => R): AsyncIterableObject<R> {
		return new AsyncIterableObject<R>(async (emitter) => {
			for await (const item of iterable) {
				emitter.emitOne(mapFn(item));
			}
		});
	}

	public map<R>(mapFn: (item: T) => R): AsyncIterableObject<R> {
		return AsyncIterableObject.map(this, mapFn);
	}

	public static filter<T>(iterable: AsyncIterable<T>, filterFn: (item: T) => boolean): AsyncIterableObject<T> {
		return new AsyncIterableObject<T>(async (emitter) => {
			for await (const item of iterable) {
				if (filterFn(item)) {
					emitter.emitOne(item);
				}
			}
		});
	}

	public filter<T2 extends T>(filterFn: (item: T) => item is T2): AsyncIterableObject<T2>;
	public filter(filterFn: (item: T) => boolean): AsyncIterableObject<T>;
	public filter(filterFn: (item: T) => boolean): AsyncIterableObject<T> {
		return AsyncIterableObject.filter(this, filterFn);
	}

	public static coalesce<T>(iterable: AsyncIterable<T | undefined | null>): AsyncIterableObject<T> {
		return <AsyncIterableObject<T>>AsyncIterableObject.filter(iterable, item => !!item);
	}

	public coalesce(): AsyncIterableObject<NonNullable<T>> {
		return AsyncIterableObject.coalesce(this) as AsyncIterableObject<NonNullable<T>>;
	}

	public static async toPromise<T>(iterable: AsyncIterable<T>): Promise<T[]> {
		const result: T[] = [];
		for await (const item of iterable) {
			result.push(item);
		}
		return result;
	}

	public toPromise(): Promise<T[]> {
		return AsyncIterableObject.toPromise(this);
	}

	private emitOne(value: T): void {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		this._results.push(value);
		this._onStateChanged.fire();
	}

	private emitMany(values: T[]): void {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		this._results = this._results.concat(values);
		this._onStateChanged.fire();
	}

	private resolve(): void {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		this._state = AsyncIterableSourceState.DoneOK;
		this._onStateChanged.fire();
	}

	private reject(error: Error) {
		if (this._state !== AsyncIterableSourceState.Initial) {
			return;
		}
		this._state = AsyncIterableSourceState.DoneError;
		this._error = error;
		this._onStateChanged.fire();
	}
}


export function createCancelableAsyncIterableProducer<T>(callback: (token: CancellationToken) => AsyncIterable<T>): CancelableAsyncIterableProducer<T> {
	const source = new CancellationTokenSource();
	const innerIterable = callback(source.token);

	return new CancelableAsyncIterableProducer<T>(source, async (emitter) => {
		const subscription = source.token.onCancellationRequested(() => {
			subscription.dispose();
			source.dispose();
			emitter.reject(new CancellationError());
		});
		try {
			for await (const item of innerIterable) {
				if (source.token.isCancellationRequested) {
					return;
				}
				emitter.emitOne(item);
			}
			subscription.dispose();
			source.dispose();
		} catch (err) {
			subscription.dispose();
			source.dispose();
			emitter.reject(err);
		}
	});
}

export class AsyncIterableSource<T> {

	private readonly _deferred = new DeferredPromise<void>();
	private readonly _asyncIterable: AsyncIterableObject<T>;

	private _errorFn: (error: Error) => void;
	private _emitOneFn: (item: T) => void;
	private _emitManyFn: (item: T[]) => void;

	constructor(onReturn?: () => Promise<void> | void) {
		this._asyncIterable = new AsyncIterableObject(emitter => {

			if (earlyError) {
				emitter.reject(earlyError);
				return;
			}
			if (earlyItems) {
				emitter.emitMany(earlyItems);
			}
			this._errorFn = (error: Error) => emitter.reject(error);
			this._emitOneFn = (item: T) => emitter.emitOne(item);
			this._emitManyFn = (items: T[]) => emitter.emitMany(items);
			return this._deferred.p;
		}, onReturn);

		let earlyError: Error | undefined;
		let earlyItems: T[] | undefined;


		this._errorFn = (error: Error) => {
			if (!earlyError) {
				earlyError = error;
			}
		};
		this._emitOneFn = (item: T) => {
			if (!earlyItems) {
				earlyItems = [];
			}
			earlyItems.push(item);
		};
		this._emitManyFn = (items: T[]) => {
			if (!earlyItems) {
				earlyItems = items.slice();
			} else {
				items.forEach(item => earlyItems!.push(item));
			}
		};
	}

	get asyncIterable(): AsyncIterableObject<T> {
		return this._asyncIterable;
	}

	resolve(): void {
		this._deferred.complete();
	}

	reject(error: Error): void {
		this._errorFn(error);
		this._deferred.complete();
	}

	emitOne(item: T): void {
		this._emitOneFn(item);
	}

	emitMany(items: T[]) {
		this._emitManyFn(items);
	}
}

export function cancellableIterable<T>(iterableOrIterator: AsyncIterator<T> | AsyncIterable<T>, token: CancellationToken): AsyncIterableIterator<T> {
	const iterator = Symbol.asyncIterator in iterableOrIterator ? iterableOrIterator[Symbol.asyncIterator]() : iterableOrIterator;

	return {
		async next(): Promise<IteratorResult<T>> {
			if (token.isCancellationRequested) {
				return { done: true, value: undefined };
			}
			const result = await raceCancellation(iterator.next(), token);
			return result || { done: true, value: undefined };
		},
		throw: iterator.throw?.bind(iterator),
		return: iterator.return?.bind(iterator),
		[Symbol.asyncIterator]() {
			return this;
		}
	};
}

type ProducerConsumerValue<T> = {
	ok: true;
	value: T;
} | {
	ok: false;
	error: Error;
};

class ProducerConsumer<T> {
	private readonly _unsatisfiedConsumers: DeferredPromise<T>[] = [];
	private readonly _unconsumedValues: ProducerConsumerValue<T>[] = [];
	private _finalValue: ProducerConsumerValue<T> | undefined;

	public get hasFinalValue(): boolean {
		return !!this._finalValue;
	}

	produce(value: ProducerConsumerValue<T>): void {
		this._ensureNoFinalValue();
		if (this._unsatisfiedConsumers.length > 0) {
			const deferred = this._unsatisfiedConsumers.shift()!;
			this._resolveOrRejectDeferred(deferred, value);
		} else {
			this._unconsumedValues.push(value);
		}
	}

	produceFinal(value: ProducerConsumerValue<T>): void {
		this._ensureNoFinalValue();
		this._finalValue = value;
		for (const deferred of this._unsatisfiedConsumers) {
			this._resolveOrRejectDeferred(deferred, value);
		}
		this._unsatisfiedConsumers.length = 0;
	}

	private _ensureNoFinalValue(): void {
		if (this._finalValue) {
			throw new BugIndicatingError('ProducerConsumer: cannot produce after final value has been set');
		}
	}

	private _resolveOrRejectDeferred(deferred: DeferredPromise<T>, value: ProducerConsumerValue<T>): void {
		if (value.ok) {
			deferred.complete(value.value);
		} else {
			deferred.error((value as { ok: false; error: Error }).error);
		}
	}

	consume(): Promise<T> {
		if (this._unconsumedValues.length > 0 || this._finalValue) {
			const value = this._unconsumedValues.length > 0 ? this._unconsumedValues.shift()! : this._finalValue!;
			if (value.ok) {
				return Promise.resolve(value.value);
			} else {
				return Promise.reject((value as { ok: false; error: Error }).error);
			}
		} else {
			const deferred = new DeferredPromise<T>();
			this._unsatisfiedConsumers.push(deferred);
			return deferred.p;
		}
	}
}

export class AsyncIterableProducer<T> implements AsyncIterable<T> {
	private readonly _producerConsumer = new ProducerConsumer<IteratorResult<T>>();

	constructor(executor: AsyncIterableExecutor<T>, private readonly _onReturn?: () => void) {
		queueMicrotask(async () => {
			const p = executor({
				emitOne: value => this._producerConsumer.produce({ ok: true, value: { done: false, value: value } }),
				emitMany: values => {
					for (const value of values) {
						this._producerConsumer.produce({ ok: true, value: { done: false, value: value } });
					}
				},
				reject: error => this._finishError(error),
			});

			if (!this._producerConsumer.hasFinalValue) {
				try {
					await p;
					this._finishOk();
				} catch (error) {
					this._finishError(error);
				}
			}
		});
	}

	public static fromArray<T>(items: T[]): AsyncIterableProducer<T> {
		return new AsyncIterableProducer<T>((writer) => {
			writer.emitMany(items);
		});
	}

	public static fromPromise<T>(promise: Promise<T[]>): AsyncIterableProducer<T> {
		return new AsyncIterableProducer<T>(async (emitter) => {
			emitter.emitMany(await promise);
		});
	}

	public static fromPromisesResolveOrder<T>(promises: Promise<T>[]): AsyncIterableProducer<T> {
		return new AsyncIterableProducer<T>(async (emitter) => {
			await Promise.all(promises.map(async (p) => emitter.emitOne(await p)));
		});
	}

	public static merge<T>(iterables: AsyncIterable<T>[]): AsyncIterableProducer<T> {
		return new AsyncIterableProducer(async (emitter) => {
			await Promise.all(iterables.map(async (iterable) => {
				for await (const item of iterable) {
					emitter.emitOne(item);
				}
			}));
		});
	}

	public static EMPTY = AsyncIterableProducer.fromArray<any>([]);

	public static map<T, R>(iterable: AsyncIterable<T>, mapFn: (item: T) => R): AsyncIterableProducer<R> {
		return new AsyncIterableProducer<R>(async (emitter) => {
			for await (const item of iterable) {
				emitter.emitOne(mapFn(item));
			}
		});
	}

	public static tee<T>(iterable: AsyncIterable<T>): [AsyncIterableProducer<T>, AsyncIterableProducer<T>] {
		let emitter1: AsyncIterableEmitter<T> | undefined;
		let emitter2: AsyncIterableEmitter<T> | undefined;

		const defer = new DeferredPromise<void>();

		const start = async () => {
			if (!emitter1 || !emitter2) {
				return;
			}
			try {
				for await (const item of iterable) {
					emitter1.emitOne(item);
					emitter2.emitOne(item);
				}
			} catch (err) {
				emitter1.reject(err);
				emitter2.reject(err);
			} finally {
				defer.complete();
			}
		};

		const p1 = new AsyncIterableProducer<T>(async (emitter) => {
			emitter1 = emitter;
			start();
			return defer.p;
		});
		const p2 = new AsyncIterableProducer<T>(async (emitter) => {
			emitter2 = emitter;
			start();
			return defer.p;
		});
		return [p1, p2];
	}

	public map<R>(mapFn: (item: T) => R): AsyncIterableProducer<R> {
		return AsyncIterableProducer.map(this, mapFn);
	}

	public static coalesce<T>(iterable: AsyncIterable<T | undefined | null>): AsyncIterableProducer<T> {
		return <AsyncIterableProducer<T>>AsyncIterableProducer.filter(iterable, item => !!item);
	}

	public coalesce(): AsyncIterableProducer<NonNullable<T>> {
		return AsyncIterableProducer.coalesce(this) as AsyncIterableProducer<NonNullable<T>>;
	}

	public static filter<T>(iterable: AsyncIterable<T>, filterFn: (item: T) => boolean): AsyncIterableProducer<T> {
		return new AsyncIterableProducer<T>(async (emitter) => {
			for await (const item of iterable) {
				if (filterFn(item)) {
					emitter.emitOne(item);
				}
			}
		});
	}

	public filter<T2 extends T>(filterFn: (item: T) => item is T2): AsyncIterableProducer<T2>;
	public filter(filterFn: (item: T) => boolean): AsyncIterableProducer<T>;
	public filter(filterFn: (item: T) => boolean): AsyncIterableProducer<T> {
		return AsyncIterableProducer.filter(this, filterFn);
	}

	private _finishOk(): void {
		if (!this._producerConsumer.hasFinalValue) {
			this._producerConsumer.produceFinal({ ok: true, value: { done: true, value: undefined } });
		}
	}

	private _finishError(error: Error): void {
		if (!this._producerConsumer.hasFinalValue) {
			this._producerConsumer.produceFinal({ ok: false, error: error });
		}
	}

	private readonly _iterator: AsyncIterator<T, void, void> = {
		next: () => this._producerConsumer.consume(),
		return: () => {
			this._onReturn?.();
			return Promise.resolve({ done: true, value: undefined });
		},
		throw: async (e) => {
			this._finishError(e);
			return { done: true, value: undefined };
		},
	};

	[Symbol.asyncIterator](): AsyncIterator<T, void, void> {
		return this._iterator;
	}
}

export class CancelableAsyncIterableProducer<T> extends AsyncIterableProducer<T> {
	constructor(
		private readonly _source: CancellationTokenSource,
		executor: AsyncIterableExecutor<T>
	) {
		super(executor);
	}

	cancel(): void {
		this._source.cancel();
	}
}


export const AsyncReaderEndOfStream = Symbol('AsyncReaderEndOfStream');

export class AsyncReader<T> {
	private _buffer: T[] = [];
	private _atEnd = false;

	public get endOfStream(): boolean { return this._buffer.length === 0 && this._atEnd; }
	private _extendBufferPromise: Promise<void> | undefined;

	constructor(
		private readonly _source: AsyncIterator<T>
	) {
	}

	public async read(): Promise<T | typeof AsyncReaderEndOfStream> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await this._extendBuffer();
		}
		if (this._buffer.length === 0) {
			return AsyncReaderEndOfStream;
		}
		return this._buffer.shift()!;
	}

	public async readWhile(predicate: (value: T) => boolean, callback: (element: T) => unknown): Promise<void> {
		do {
			const piece = await this.peek();
			if (piece === AsyncReaderEndOfStream) {
				break;
			}
			if (!predicate(piece)) {
				break;
			}
			await this.read();
			await callback(piece);
		} while (true);
	}

	public readBufferedOrThrow(): T | typeof AsyncReaderEndOfStream {
		const value = this.peekBufferedOrThrow();
		this._buffer.shift();
		return value;
	}

	public async consumeToEnd(): Promise<void> {
		while (!this.endOfStream) {
			await this.read();
		}
	}

	public async peek(): Promise<T | typeof AsyncReaderEndOfStream> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await this._extendBuffer();
		}
		if (this._buffer.length === 0) {
			return AsyncReaderEndOfStream;
		}
		return this._buffer[0];
	}

	public peekBufferedOrThrow(): T | typeof AsyncReaderEndOfStream {
		if (this._buffer.length === 0) {
			if (this._atEnd) {
				return AsyncReaderEndOfStream;
			}
			throw new BugIndicatingError('No buffered elements');
		}

		return this._buffer[0];
	}

	public async peekTimeout(timeoutMs: number): Promise<T | typeof AsyncReaderEndOfStream | undefined> {
		if (this._buffer.length === 0 && !this._atEnd) {
			await raceTimeout(this._extendBuffer(), timeoutMs);
		}
		if (this._atEnd) {
			return AsyncReaderEndOfStream;
		}
		if (this._buffer.length === 0) {
			return undefined;
		}
		return this._buffer[0];
	}

	private _extendBuffer(): Promise<void> {
		if (this._atEnd) {
			return Promise.resolve();
		}

		if (!this._extendBufferPromise) {
			this._extendBufferPromise = (async () => {
				const { value, done } = await this._source.next();
				this._extendBufferPromise = undefined;
				if (done) {
					this._atEnd = true;
				} else {
					this._buffer.push(value);
				}
			})();
		}

		return this._extendBufferPromise;
	}
}

export function createTimeout(ms: number, cb: () => void): IDisposable {
	const t = setTimeout(cb, ms);
	return toDisposable(() => clearTimeout(t));
}
