/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from 'vscode';

export class ThrottledDebouncer implements Disposable {

	private static readonly INITIAL_DELAY = 100;
	private static readonly DELAY_INCREMENT = 10;
	private static readonly MAX_DELAY = 500;

	private timeoutId: TimeoutHandle | undefined;
	private currentDelay: number;
	private readonly initialDelay: number;
	private readonly increment: number;
	private readonly maxDelay: number;

	constructor(initialDelay: number = ThrottledDebouncer.INITIAL_DELAY, increment: number = ThrottledDebouncer.DELAY_INCREMENT, maxDelay: number = ThrottledDebouncer.MAX_DELAY) {
		this.currentDelay = initialDelay;
		this.initialDelay = initialDelay;
		this.increment = increment;
		this.maxDelay = maxDelay;
	}

	public trigger<T extends unknown[]>(fn: (...args: T) => void, ...args: T): void {
		if (this.timeoutId !== undefined) {
			clearTimeout(this.timeoutId);
			this.currentDelay = Math.min(
				this.currentDelay + this.increment,
				this.maxDelay
			);
		}

		this.timeoutId = setTimeout(() => {
			this.timeoutId = undefined;
			this.currentDelay = this.initialDelay;
			fn(...args);
		}, this.currentDelay);
	}

	public cancel(): void {
		if (this.timeoutId !== undefined) {
			clearTimeout(this.timeoutId);
			this.timeoutId = undefined;
		}
		this.currentDelay = this.initialDelay;
	}

	public get isPending(): boolean {
		return this.timeoutId !== undefined;
	}

	public get getCurrentDelay(): number {
		return this.currentDelay;
	}

	public dispose(): void {
		this.cancel();
	}
}
