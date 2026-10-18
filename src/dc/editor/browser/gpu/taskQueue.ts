/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../base/browser/dom.js';
import { Disposable, toDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';

/**
 * Copyright (c) 2022 The xterm.js authors. All rights reserved.
 * @license MIT
 */

export interface ITaskQueue extends IDisposable {
	enqueue(task: () => boolean | void): void;

	flush(): void;

	clear(): void;
}

interface ITaskDeadline {
	timeRemaining(): number;
}
type CallbackWithDeadline = (deadline: ITaskDeadline) => void;

abstract class TaskQueue extends Disposable implements ITaskQueue {
	private _tasks: (() => boolean | void)[] = [];
	private _idleCallback?: number;
	private _i = 0;

	constructor(
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._register(toDisposable(() => this.clear()));
	}

	protected abstract _requestCallback(callback: CallbackWithDeadline): number;
	protected abstract _cancelCallback(identifier: number): void;

	public enqueue(task: () => boolean | void): void {
		this._tasks.push(task);
		this._start();
	}

	public flush(): void {
		while (this._i < this._tasks.length) {
			if (!this._tasks[this._i]()) {
				this._i++;
			}
		}
		this.clear();
	}

	public clear(): void {
		if (this._idleCallback) {
			this._cancelCallback(this._idleCallback);
			this._idleCallback = undefined;
		}
		this._i = 0;
		this._tasks.length = 0;
	}

	private _start(): void {
		if (!this._idleCallback) {
			this._idleCallback = this._requestCallback(this._process.bind(this));
		}
	}

	private _process(deadline: ITaskDeadline): void {
		this._idleCallback = undefined;
		let taskDuration = 0;
		let longestTask = 0;
		let lastDeadlineRemaining = deadline.timeRemaining();
		let deadlineRemaining = 0;
		while (this._i < this._tasks.length) {
			taskDuration = Date.now();
			if (!this._tasks[this._i]()) {
				this._i++;
			}
			taskDuration = Math.max(1, Date.now() - taskDuration);
			longestTask = Math.max(taskDuration, longestTask);
			deadlineRemaining = deadline.timeRemaining();
			if (longestTask * 1.5 > deadlineRemaining) {
				if (lastDeadlineRemaining - taskDuration < -20) {
					this._logService.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(lastDeadlineRemaining - taskDuration))}ms`);
				}
				this._start();
				return;
			}
			lastDeadlineRemaining = deadlineRemaining;
		}
		this.clear();
	}
}

export class PriorityTaskQueue extends TaskQueue {
	protected _requestCallback(callback: CallbackWithDeadline): number {
		return getActiveWindow().setTimeout(() => callback(this._createDeadline(16)));
	}

	protected _cancelCallback(identifier: number): void {
		getActiveWindow().clearTimeout(identifier);
	}

	private _createDeadline(duration: number): ITaskDeadline {
		const end = Date.now() + duration;
		return {
			timeRemaining: () => Math.max(0, end - Date.now())
		};
	}
}

class IdleTaskQueueInternal extends TaskQueue {
	protected _requestCallback(callback: IdleRequestCallback): number {
		return getActiveWindow().requestIdleCallback(callback);
	}

	protected _cancelCallback(identifier: number): void {
		getActiveWindow().cancelIdleCallback(identifier);
	}
}

export const IdleTaskQueue = ('requestIdleCallback' in getActiveWindow()) ? IdleTaskQueueInternal : PriorityTaskQueue;

export class DebouncedIdleTask {
	private _queue: ITaskQueue;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this._queue = instantiationService.createInstance(IdleTaskQueue);
	}

	public set(task: () => boolean | void): void {
		this._queue.clear();
		this._queue.enqueue(task);
	}

	public flush(): void {
		this._queue.flush();
	}
}
