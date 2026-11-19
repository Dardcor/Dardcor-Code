/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BugIndicatingError } from './errors.js';


export class ReentrancyBarrier {
	private _isOccupied = false;

	public runExclusivelyOrSkip(runner: () => void): void {
		if (this._isOccupied) {
			return;
		}
		this._isOccupied = true;
		try {
			runner();
		} finally {
			this._isOccupied = false;
		}
	}

	public runExclusivelyOrThrow(runner: () => void): void {
		if (this._isOccupied) {
			throw new BugIndicatingError(`ReentrancyBarrier: reentrant call detected!`);
		}
		this._isOccupied = true;
		try {
			runner();
		} finally {
			this._isOccupied = false;
		}
	}

	public get isOccupied() {
		return this._isOccupied;
	}

	public makeExclusiveOrSkip<TArgs extends unknown[]>(fn: (...args: TArgs) => void): (...args: TArgs) => void {
		return ((...args: TArgs) => {
			if (this._isOccupied) {
				return;
			}
			this._isOccupied = true;
			try {
				return fn(...args);
			} finally {
				this._isOccupied = false;
			}
		});
	}
}
