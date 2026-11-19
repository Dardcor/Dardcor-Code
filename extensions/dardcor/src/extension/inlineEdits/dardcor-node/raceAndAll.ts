/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function raceAndAll<T extends readonly unknown[]>(
	promises: {
		[K in keyof T]: Promise<T[K]>;
	},
	errorHandler: (error: unknown) => void,
): {
	first: Promise<{
		[K in keyof T]: T[K] | undefined;
	}>;
	all: Promise<T>;
} {
	let settled = false;

	let rejectionCount = 0;

	const first = new Promise<{
		[K in keyof T]: T[K] | undefined;
	}>((resolve, reject) => {
		promises.forEach((promise, index) => {
			promise.then(result => {
				if (settled) {
					return;
				}
				settled = true;
				const output = Array(promises.length).fill(undefined) as unknown[];
				output[index] = result;
				resolve(output as {
					[K in keyof T]: T[K] | undefined;
				});
			}, error => {
				errorHandler(error);
				rejectionCount++;
				if (rejectionCount === promises.length) {
					settled = true;
					reject(new Error('All promises passed to raceAndAll were rejected'));
				}
			});
		});
	});

	const all = Promise.all(promises) as Promise<T>;

	return { first, all };
}
