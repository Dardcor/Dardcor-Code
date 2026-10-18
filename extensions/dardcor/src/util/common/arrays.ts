/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function count<T>(array: T[], predicate: (value: T) => boolean): number {
	let count = 0;
	for (const value of array) {
		if (predicate(value)) {
			count++;
		}
	}
	return count;
}

export function findInsertionIndexInSortedArray<T>(array: T[], value: T, isBeforeFunction: (a: T, b: T) => boolean): number {
	let low = 0;
	let high = array.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (isBeforeFunction(array[mid], value)) {
			low = mid + 1;
		}
		else {
			high = mid;
		}
	}
	return low;
}
export function max<T>(arr: T[], compare: (a: T, b: T) => number): T | undefined {
	if (arr.length === 0) {
		return undefined;
	}

	let maxElement = arr[0];

	for (let i = 1; i < arr.length; i++) {
		const currentElement = arr[i];

		if (compare(currentElement, maxElement) > 0) {
			maxElement = currentElement;
		}
	}

	return maxElement;
}

export function filterMap<T, K>(array: T[], map: (t: T) => K | undefined | null): K[] {
	const result: K[] = [];
	for (const element of array) {
		const mapped = map(element);
		if (mapped !== undefined && mapped !== null) {
			result.push(mapped);
		}
	}
	return result;
}

export function min(array: number[]): number {
	if (array.length === 0) {
		return Infinity;
	}

	let min = array[0];
	for (let i = 1; i < array.length; i++) {
		min = Math.min(min, array[i]);
	}
	return min;
}

export function* batchArrayElements<T>(array: T[], batchSize: number): Iterable<T[]> {
	for (let i = 0; i < array.length; i += batchSize) {
		yield array.slice(i, i + batchSize);
	}
}
