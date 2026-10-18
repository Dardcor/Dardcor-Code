/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class Deferred<T> {
	resolve: (value: T | PromiseLike<T>) => void = () => { };
	reject: (reason?: unknown) => void = () => { };

	readonly promise: Promise<T> = new Promise((resolve, reject) => {
		this.resolve = resolve;
		this.reject = reject;
	});
}

export function delay<T>(ms: number, value: T): Promise<T>;
export function delay(ms: number): Promise<void>;
export function delay(ms: number, value = undefined) {
	return new Promise(resolve => setTimeout(() => resolve(value), ms));
}
