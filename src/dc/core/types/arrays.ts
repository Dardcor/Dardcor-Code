/**
 * Dardcor Code - Array Utilities (Task 61)
 * Mirrors: vs/base/common/arrays.ts
 */

export function tail<T>(arr: T[]): [T[], T] {
	if (arr.length === 0) throw new Error('Invalid tail call');
	return [arr.slice(0, arr.length - 1), arr[arr.length - 1]];
}

export function equals<T>(
	one: ReadonlyArray<T> | undefined,
	other: ReadonlyArray<T> | undefined,
	itemEquals: (a: T, b: T) => boolean = (a, b) => a === b
): boolean {
	if (one === other) return true;
	if (!one || !other) return false;
	if (one.length !== other.length) return false;
	for (let i = 0; i < one.length; i++) {
		if (!itemEquals(one[i], other[i])) return false;
	}
	return true;
}

export function removeFastWithoutKeepingOrder<T>(array: T[], index: number): void {
	const last = array.length - 1;
	if (index < last) {
		array[index] = array[last];
	}
	array.pop();
}

export function binarySearch<T>(array: ReadonlyArray<T>, key: T, comparator: (op1: T, op2: T) => number): number {
	return binarySearch2(array.length, i => comparator(array[i], key));
}

export function binarySearch2(length: number, compareToKey: (index: number) => number): number {
	let low = 0, high = length - 1;
	while (low <= high) {
		const mid = ((low + high) / 2) | 0;
		const comp = compareToKey(mid);
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

export function findFirstInSorted<T>(array: ReadonlyArray<T>, p: (item: T) => boolean): number {
	let low = 0, high = array.length;
	if (high === 0) return 0;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (p(array[mid])) {
			high = mid;
		} else {
			low = mid + 1;
		}
	}
	return low;
}

export function mergeSort<T>(data: T[], comparator: (a: T, b: T) => number): T[] {
	return data.slice().sort(comparator);
}

export function groupBy<T>(data: ReadonlyArray<T>, comparator: (a: T, b: T) => number): T[][] {
	const sorted = mergeSort([...data], comparator);
	const result: T[][] = [];
	let currentGroup: T[] | undefined;
	for (const element of sorted) {
		if (!currentGroup || comparator(currentGroup[0], element) !== 0) {
			currentGroup = [element];
			result.push(currentGroup);
		} else {
			currentGroup.push(element);
		}
	}
	return result;
}

export function coalesce<T>(array: ReadonlyArray<T | undefined | null>): T[] {
	return array.filter((e): e is T => !!e);
}

export function distinct<T>(array: ReadonlyArray<T>, keyFn: (value: T) => any = v => v): T[] {
	const seen = new Set<any>();
	return array.filter(element => {
		const key = keyFn(element);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function uniqueFilter<T>(keyFn: (t: T) => any): (t: T) => boolean {
	const seen = new Set<any>();
	return element => {
		const key = keyFn(element);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	};
}

export function firstOrDefault<T>(array: ReadonlyArray<T>, notFoundValue: T): T;
export function firstOrDefault<T>(array: ReadonlyArray<T>): T | undefined;
export function firstOrDefault<T>(array: ReadonlyArray<T>, notFoundValue?: T): T | undefined {
	return array.length > 0 ? array[0] : notFoundValue;
}

export function lastOrDefault<T>(array: ReadonlyArray<T>, notFoundValue: T): T;
export function lastOrDefault<T>(array: ReadonlyArray<T>): T | undefined;
export function lastOrDefault<T>(array: ReadonlyArray<T>, notFoundValue?: T): T | undefined {
	return array.length > 0 ? array[array.length - 1] : notFoundValue;
}

export function flatten<T>(arr: T[][]): T[] {
	return ([] as T[]).concat(...arr);
}

export function range(to: number): number[];
export function range(from: number, to: number): number[];
export function range(arg: number, to?: number): number[] {
	let from = typeof to === 'number' ? arg : 0;
	const end = typeof to === 'number' ? to : arg;
	const result: number[] = [];
	for (let i = from; i < end; i++) result.push(i);
	return result;
}

export function insertInto<T>(array: T[], start: number, newItems: T[]): void {
	const startIdx = getActualStartIndex(array, start);
	const originalLength = array.length;
	const newItemsLength = newItems.length;
	array.length = originalLength + newItemsLength;
	// Shift existing items to the right
	for (let i = originalLength - 1; i >= startIdx; i--) {
		array[i + newItemsLength] = array[i];
	}
	for (let i = 0; i < newItemsLength; i++) {
		array[i + startIdx] = newItems[i];
	}
}

function getActualStartIndex<T>(array: T[], start: number): number {
	return start < 0 ? Math.max(start + array.length, 0) : Math.min(start, array.length);
}

export function pushToStart<T>(arr: T[], value: T): void {
	const index = arr.indexOf(value);
	if (index > -1) {
		arr.splice(index, 1);
		arr.unshift(value);
	}
}

export function pushToEnd<T>(arr: T[], value: T): void {
	const index = arr.indexOf(value);
	if (index > -1) {
		arr.splice(index, 1);
		arr.push(value);
	}
}

export function asArray<T>(x: T | T[]): T[];
export function asArray<T>(x: T | readonly T[]): readonly T[];
export function asArray<T>(x: T | T[]): T[] {
	return Array.isArray(x) ? x : [x];
}

export interface ISplice<T> {
	readonly start: number;
	readonly deleteCount: number;
	readonly toInsert: T[];
}

export function splice<T>(array: T[], start: number, deleteCount: number, toInsert: T[]): ISplice<T> {
	const deleted = array.splice(start, deleteCount, ...toInsert);
	return { start, deleteCount: deleted.length, toInsert };
}
