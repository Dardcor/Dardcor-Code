/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { illegalArgument } from '../../../../util/dardcor/base/common/errors';

export class Permutation {

	constructor(private readonly _indexMap: readonly number[]) { }

	get arrayLength() {
		return this._indexMap.length;
	}

	public static createSortPermutation<T>(arr: readonly T[], compareFn: (a: T, b: T) => number): Permutation {
		const sortIndices = Array.from(arr.keys()).sort((index1, index2) => compareFn(arr[index1], arr[index2]));
		return new Permutation(sortIndices);
	}

	apply<T>(arr: readonly T[]): T[] {
		if (arr.length !== this.arrayLength) {
			throw illegalArgument(`Permutation must be applied on an array of same length. Received length: ${arr.length}. Expected length: ${this.arrayLength}`);
		}
		return arr.map((_, index) => arr[this._indexMap[index]]);
	}

	mapIndexBack(indexAfterShuffling: number): number {
		const originalArrIdx = this._indexMap.at(indexAfterShuffling);
		if (originalArrIdx === undefined) {
			throw illegalArgument(`Given index must be within original array length. Received: ${indexAfterShuffling}. Expected: 0 <= x < ${this.arrayLength}`);
		}
		return originalArrIdx;
	}

	inverse(): Permutation {
		const inverseIndexMap = this._indexMap.slice();
		for (let i = 0; i < this._indexMap.length; i++) {
			inverseIndexMap[this._indexMap[i]] = i;
		}
		return new Permutation(inverseIndexMap);
	}
}
