/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Comparator } from './arrays.js';

export function findLast<T, R extends T>(array: readonly T[], predicate: (item: T, index: number) => item is R, fromIndex?: number): R | undefined;
export function findLast<T>(array: readonly T[], predicate: (item: T, index: number) => unknown, fromIndex?: number): T | undefined;
export function findLast<T>(array: readonly T[], predicate: (item: T, index: number) => unknown, fromIndex = array.length - 1): T | undefined {
	const idx = findLastIdx(array, predicate, fromIndex);
	if (idx === -1) {
		return undefined;
	}
	return array[idx];
}

export function findLastIdx<T>(array: readonly T[], predicate: (item: T, index: number) => unknown, fromIndex = array.length - 1): number {
	for (let i = fromIndex; i >= 0; i--) {
		const element = array[i];

		if (predicate(element, i)) {
			return i;
		}
	}

	return -1;
}

export function findFirst<T, R extends T>(array: readonly T[], predicate: (item: T, index: number) => item is R, fromIndex?: number): R | undefined;
export function findFirst<T>(array: readonly T[], predicate: (item: T, index: number) => unknown, fromIndex?: number): T | undefined;
export function findFirst<T>(array: readonly T[], predicate: (item: T, index: number) => unknown, fromIndex = 0): T | undefined {
	const idx = findFirstIdx(array, predicate, fromIndex);
	if (idx === -1) {
		return undefined;
	}
	return array[idx];
}

export function findFirstIdx<T>(array: readonly T[], predicate: (item: T, index: number) => unknown, fromIndex = 0): number {
	for (let i = fromIndex; i < array.length; i++) {
		const element = array[i];

		if (predicate(element, i)) {
			return i;
		}
	}

	return -1;
}

export function findLastMonotonous<T>(array: readonly T[], predicate: (item: T) => boolean): T | undefined {
	const idx = findLastIdxMonotonous(array, predicate);
	return idx === -1 ? undefined : array[idx];
}

export function findLastIdxMonotonous<T>(array: readonly T[], predicate: (item: T) => boolean, startIdx = 0, endIdxEx = array.length): number {
	let i = startIdx;
	let j = endIdxEx;
	while (i < j) {
		const k = Math.floor((i + j) / 2);
		if (predicate(array[k])) {
			i = k + 1;
		} else {
			j = k;
		}
	}
	return i - 1;
}

export function findFirstMonotonous<T>(array: readonly T[], predicate: (item: T) => boolean): T | undefined {
	const idx = findFirstIdxMonotonousOrArrLen(array, predicate);
	return idx === array.length ? undefined : array[idx];
}

export function findFirstIdxMonotonousOrArrLen<T>(array: readonly T[], predicate: (item: T) => boolean, startIdx = 0, endIdxEx = array.length): number {
	let i = startIdx;
	let j = endIdxEx;
	while (i < j) {
		const k = Math.floor((i + j) / 2);
		if (predicate(array[k])) {
			j = k;
		} else {
			i = k + 1;
		}
	}
	return i;
}

export function findFirstIdxMonotonous<T>(array: readonly T[], predicate: (item: T) => boolean, startIdx = 0, endIdxEx = array.length): number {
	const idx = findFirstIdxMonotonousOrArrLen(array, predicate, startIdx, endIdxEx);
	return idx === array.length ? -1 : idx;
}

export class MonotonousArray<T> {
	public static assertInvariants = false;

	private _findLastMonotonousLastIdx = 0;
	private _prevFindLastPredicate: ((item: T) => boolean) | undefined;

	constructor(private readonly _array: readonly T[]) {
	}

	findLastMonotonous(predicate: (item: T) => boolean): T | undefined {
		if (MonotonousArray.assertInvariants) {
			if (this._prevFindLastPredicate) {
				for (const item of this._array) {
					if (this._prevFindLastPredicate(item) && !predicate(item)) {
						throw new Error('MonotonousArray: current predicate must be weaker than (or equal to) the previous predicate.');
					}
				}
			}
			this._prevFindLastPredicate = predicate;
		}

		const idx = findLastIdxMonotonous(this._array, predicate, this._findLastMonotonousLastIdx);
		this._findLastMonotonousLastIdx = idx + 1;
		return idx === -1 ? undefined : this._array[idx];
	}
}

export function findFirstMax<T>(array: readonly T[], comparator: Comparator<T>): T | undefined {
	if (array.length === 0) {
		return undefined;
	}

	let max = array[0];
	for (let i = 1; i < array.length; i++) {
		const item = array[i];
		if (comparator(item, max) > 0) {
			max = item;
		}
	}
	return max;
}

export function findLastMax<T>(array: readonly T[], comparator: Comparator<T>): T | undefined {
	if (array.length === 0) {
		return undefined;
	}

	let max = array[0];
	for (let i = 1; i < array.length; i++) {
		const item = array[i];
		if (comparator(item, max) >= 0) {
			max = item;
		}
	}
	return max;
}

export function findFirstMin<T>(array: readonly T[], comparator: Comparator<T>): T | undefined {
	return findFirstMax(array, (a, b) => -comparator(a, b));
}

export function findMaxIdx<T>(array: readonly T[], comparator: Comparator<T>): number {
	if (array.length === 0) {
		return -1;
	}

	let maxIdx = 0;
	for (let i = 1; i < array.length; i++) {
		const item = array[i];
		if (comparator(item, array[maxIdx]) > 0) {
			maxIdx = i;
		}
	}
	return maxIdx;
}

export function mapFindFirst<T, R>(items: Iterable<T>, mapFn: (value: T) => R | undefined): R | undefined {
	for (const value of items) {
		const mapped = mapFn(value);
		if (mapped !== undefined) {
			return mapped;
		}
	}

	return undefined;
}
