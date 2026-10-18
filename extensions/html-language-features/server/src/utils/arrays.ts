/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function pushAll<T>(to: T[], from: T[]) {
	if (from) {
		for (const e of from) {
			to.push(e);
		}
	}
}

export function contains<T>(arr: T[], val: T) {
	return arr.indexOf(val) !== -1;
}

export function mergeSort<T>(data: T[], compare: (a: T, b: T) => number): T[] {
	_divideAndMerge(data, compare);
	return data;
}

function _divideAndMerge<T>(data: T[], compare: (a: T, b: T) => number): void {
	if (data.length <= 1) {
		return;
	}
	const p = (data.length / 2) | 0;
	const left = data.slice(0, p);
	const right = data.slice(p);

	_divideAndMerge(left, compare);
	_divideAndMerge(right, compare);

	let leftIdx = 0;
	let rightIdx = 0;
	let i = 0;
	while (leftIdx < left.length && rightIdx < right.length) {
		const ret = compare(left[leftIdx], right[rightIdx]);
		if (ret <= 0) {
			data[i++] = left[leftIdx++];
		} else {
			data[i++] = right[rightIdx++];
		}
	}
	while (leftIdx < left.length) {
		data[i++] = left[leftIdx++];
	}
	while (rightIdx < right.length) {
		data[i++] = right[rightIdx++];
	}
}

export function binarySearch<T>(array: T[], key: T, comparator: (op1: T, op2: T) => number): number {
	let low = 0,
		high = array.length - 1;

	while (low <= high) {
		const mid = ((low + high) / 2) | 0;
		const comp = comparator(array[mid], key);
		if (comp < 0) {
			low = mid + 1;
		} else if (comp > 0) {
			high = mid - 1;
		} else {
			return mid;
		}
	}
	return -(low + 1);
}
