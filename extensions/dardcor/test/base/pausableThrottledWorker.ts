/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IThrottledWorkerOptions, ThrottledWorker } from '../../src/util/dardcor/base/common/async';

export class PausableThrottledWorker<T> extends ThrottledWorker<T> {
	private _paused: boolean = false;
	private _pausedWork: T[] = [];

	constructor(options: IThrottledWorkerOptions, handler: (units: T[]) => void) {
		super(options, (units: T[]) => {
			if (this._paused) {
				this._pausedWork.push(...units);
			} else {
				handler(units);
			}
		});
	}

	isPaused(): boolean {
		return this._paused;
	}

	pause(): void {
		this._paused = true;
	}

	resume(): void {
		this._paused = false;

		if (this._pausedWork.length > 0) {
			const work = this._pausedWork;
			this._pausedWork = [];
			this.work(work);
		}
	}

	override dispose(): void {
		this._pausedWork = [];
		super.dispose();
	}
}
