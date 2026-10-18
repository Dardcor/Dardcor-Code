/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class DiffChange {
	public originalStart: number;

	public originalLength: number;

	public modifiedStart: number;

	public modifiedLength: number;

	constructor(originalStart: number, originalLength: number, modifiedStart: number, modifiedLength: number) {
		this.originalStart = originalStart;
		this.originalLength = originalLength;
		this.modifiedStart = modifiedStart;
		this.modifiedLength = modifiedLength;
	}

	public getOriginalEnd() {
		return this.originalStart + this.originalLength;
	}

	public getModifiedEnd() {
		return this.modifiedStart + this.modifiedLength;
	}
}

export interface ISequence {
	getElements(): string[];
}

export class LineSequence implements ISequence {

	constructor(
		public readonly lines: readonly string[],
		public readonly trimWhitespace: boolean = true
	) { }

	public getElements(): string[] {
		const elements: string[] = [];
		for (let i = 0, len = this.lines.length; i < len; i++) {
			elements[i] = this.trimWhitespace ? this.lines[i].trim() : this.lines[i];
		}
		return elements;
	}

	public getCharCount(): number {
		let cnt = 0;
		for (const line of this.lines) {
			cnt += line.length;
		}
		return cnt;
	}
}

export class CharSequence implements ISequence {

	private readonly _chars: string[];

	constructor(str: string) {
		this._chars = str.split('');
	}

	public getElements(): string[] {
		return this._chars;
	}
}


class Debug {
	public static Assert(condition: boolean, message: string): void {
		if (!condition) {
			throw new Error(message);
		}
	}
}

class MyArray {
	public static Copy(
		sourceArray: any[],
		sourceIndex: number,
		destinationArray: any[],
		destinationIndex: number,
		length: number
	) {
		for (let i = 0; i < length; i++) {
			destinationArray[destinationIndex + i] = sourceArray[sourceIndex + i];
		}
	}
	public static Copy2(
		sourceArray: Int32Array,
		sourceIndex: number,
		destinationArray: Int32Array,
		destinationIndex: number,
		length: number
	) {
		for (let i = 0; i < length; i++) {
			destinationArray[destinationIndex + i] = sourceArray[sourceIndex + i];
		}
	}
}


const enum LocalConstants {
	MaxDifferencesHistory = 1447,

	MAX_SAFE_SMALL_INTEGER = 1 << 30,

	MIN_SAFE_SMALL_INTEGER = -(1 << 30),
}

class DiffChangeHelper {
	private m_changes: DiffChange[];
	private m_originalStart: number;
	private m_modifiedStart: number;
	private m_originalCount: number;
	private m_modifiedCount: number;

	constructor() {
		this.m_changes = [];
		this.m_originalStart = LocalConstants.MAX_SAFE_SMALL_INTEGER;
		this.m_modifiedStart = LocalConstants.MAX_SAFE_SMALL_INTEGER;
		this.m_originalCount = 0;
		this.m_modifiedCount = 0;
	}

	public MarkNextChange(): void {
		if (this.m_originalCount > 0 || this.m_modifiedCount > 0) {
			this.m_changes.push(
				new DiffChange(this.m_originalStart, this.m_originalCount, this.m_modifiedStart, this.m_modifiedCount)
			);
		}

		this.m_originalCount = 0;
		this.m_modifiedCount = 0;
		this.m_originalStart = LocalConstants.MAX_SAFE_SMALL_INTEGER;
		this.m_modifiedStart = LocalConstants.MAX_SAFE_SMALL_INTEGER;
	}

	public AddOriginalElement(originalIndex: number, modifiedIndex: number) {
		this.m_originalStart = Math.min(this.m_originalStart, originalIndex);
		this.m_modifiedStart = Math.min(this.m_modifiedStart, modifiedIndex);

		this.m_originalCount++;
	}

	public AddModifiedElement(originalIndex: number, modifiedIndex: number): void {
		this.m_originalStart = Math.min(this.m_originalStart, originalIndex);
		this.m_modifiedStart = Math.min(this.m_modifiedStart, modifiedIndex);

		this.m_modifiedCount++;
	}

	public getChanges(): DiffChange[] {
		if (this.m_originalCount > 0 || this.m_modifiedCount > 0) {
			this.MarkNextChange();
		}

		return this.m_changes;
	}

	public getReverseChanges(): DiffChange[] {
		if (this.m_originalCount > 0 || this.m_modifiedCount > 0) {
			this.MarkNextChange();
		}

		this.m_changes.reverse();
		return this.m_changes;
	}
}

export class LcsDiff {
	private readonly _originalStringElements: string[];
	private readonly _originalElementsOrHash: Int32Array;
	private readonly _modifiedStringElements: string[];
	private readonly _modifiedElementsOrHash: Int32Array;

	private m_forwardHistory: Int32Array[];
	private m_reverseHistory: Int32Array[];

	constructor(originalSequence: ISequence, modifiedSequence: ISequence) {
		const [originalStringElements, originalElementsOrHash] = LcsDiff._getElements(originalSequence);
		const [modifiedStringElements, modifiedElementsOrHash] = LcsDiff._getElements(modifiedSequence);

		this._originalStringElements = originalStringElements;
		this._originalElementsOrHash = originalElementsOrHash;
		this._modifiedStringElements = modifiedStringElements;
		this._modifiedElementsOrHash = modifiedElementsOrHash;

		this.m_forwardHistory = [];
		this.m_reverseHistory = [];
	}

	private static _getElements(sequence: ISequence): [string[], Int32Array] {
		const elements = sequence.getElements();
		const hashes = new Int32Array(elements.length);
		for (let i = 0, len = elements.length; i < len; i++) {
			hashes[i] = this._stringHash(elements[i], 0);
		}
		return [elements, hashes];
	}

	private static _numberHash(val: number, initialHashVal: number): number {
		return ((initialHashVal << 5) - initialHashVal + val) | 0;
	}

	private static _stringHash(s: string, hashVal: number) {
		hashVal = this._numberHash(149417, hashVal);
		for (let i = 0, length = s.length; i < length; i++) {
			hashVal = this._numberHash(s.charCodeAt(i), hashVal);
		}
		return hashVal;
	}

	private ElementsAreEqual(originalIndex: number, newIndex: number): boolean {
		if (this._originalElementsOrHash[originalIndex] !== this._modifiedElementsOrHash[newIndex]) {
			return false;
		}
		return this._originalStringElements[originalIndex] === this._modifiedStringElements[newIndex];
	}

	public ComputeDiff(): DiffChange[] {
		return this._ComputeDiff(
			0,
			this._originalElementsOrHash.length - 1,
			0,
			this._modifiedElementsOrHash.length - 1
		);
	}

	private _ComputeDiff(
		originalStart: number,
		originalEnd: number,
		modifiedStart: number,
		modifiedEnd: number
	): DiffChange[] {
		return this.ComputeDiffRecursive(originalStart, originalEnd, modifiedStart, modifiedEnd);
	}

	private ComputeDiffRecursive(
		originalStart: number,
		originalEnd: number,
		modifiedStart: number,
		modifiedEnd: number
	): DiffChange[] {
		while (
			originalStart <= originalEnd &&
			modifiedStart <= modifiedEnd &&
			this.ElementsAreEqual(originalStart, modifiedStart)
		) {
			originalStart++;
			modifiedStart++;
		}

		while (
			originalEnd >= originalStart &&
			modifiedEnd >= modifiedStart &&
			this.ElementsAreEqual(originalEnd, modifiedEnd)
		) {
			originalEnd--;
			modifiedEnd--;
		}

		if (originalStart > originalEnd || modifiedStart > modifiedEnd) {
			let changes: DiffChange[];

			if (modifiedStart <= modifiedEnd) {
				Debug.Assert(
					originalStart === originalEnd + 1,
					'originalStart should only be one more than originalEnd'
				);

				changes = [new DiffChange(originalStart, 0, modifiedStart, modifiedEnd - modifiedStart + 1)];
			} else if (originalStart <= originalEnd) {
				Debug.Assert(
					modifiedStart === modifiedEnd + 1,
					'modifiedStart should only be one more than modifiedEnd'
				);

				changes = [new DiffChange(originalStart, originalEnd - originalStart + 1, modifiedStart, 0)];
			} else {
				Debug.Assert(
					originalStart === originalEnd + 1,
					'originalStart should only be one more than originalEnd'
				);
				Debug.Assert(
					modifiedStart === modifiedEnd + 1,
					'modifiedStart should only be one more than modifiedEnd'
				);

				changes = [];
			}

			return changes;
		}

		const midOriginalArr = [0];
		const midModifiedArr = [0];
		const result = this.ComputeRecursionPoint(
			originalStart,
			originalEnd,
			modifiedStart,
			modifiedEnd,
			midOriginalArr,
			midModifiedArr
		);

		const midOriginal = midOriginalArr[0];
		const midModified = midModifiedArr[0];

		if (result !== null) {
			return result;
		} else {

			const leftChanges = this.ComputeDiffRecursive(originalStart, midOriginal, modifiedStart, midModified);
			const rightChanges = this.ComputeDiffRecursive(midOriginal + 1, originalEnd, midModified + 1, modifiedEnd);

			return this.ConcatenateChanges(leftChanges, rightChanges);
		}
	}

	private WALKTRACE(
		diagonalForwardBase: number,
		diagonalForwardStart: number,
		diagonalForwardEnd: number,
		diagonalForwardOffset: number,
		diagonalReverseBase: number,
		diagonalReverseStart: number,
		diagonalReverseEnd: number,
		diagonalReverseOffset: number,
		forwardPoints: Int32Array,
		reversePoints: Int32Array,
		originalIndex: number,
		originalEnd: number,
		midOriginalArr: number[],
		modifiedIndex: number,
		modifiedEnd: number,
		midModifiedArr: number[],
		deltaIsEven: boolean
	): DiffChange[] {
		let forwardChanges: DiffChange[] | null = null;
		let reverseChanges: DiffChange[] | null = null;

		let changeHelper = new DiffChangeHelper();
		let diagonalMin = diagonalForwardStart;
		let diagonalMax = diagonalForwardEnd;
		let diagonalRelative = midOriginalArr[0] - midModifiedArr[0] - diagonalForwardOffset;
		let lastOriginalIndex = LocalConstants.MIN_SAFE_SMALL_INTEGER;
		let historyIndex = this.m_forwardHistory.length - 1;

		do {
			const diagonal = diagonalRelative + diagonalForwardBase;

			if (
				diagonal === diagonalMin ||
				(diagonal < diagonalMax && forwardPoints[diagonal - 1] < forwardPoints[diagonal + 1])
			) {
				originalIndex = forwardPoints[diagonal + 1];
				modifiedIndex = originalIndex - diagonalRelative - diagonalForwardOffset;
				if (originalIndex < lastOriginalIndex) {
					changeHelper.MarkNextChange();
				}
				lastOriginalIndex = originalIndex;
				changeHelper.AddModifiedElement(originalIndex + 1, modifiedIndex);
				diagonalRelative = diagonal + 1 - diagonalForwardBase;
			} else {
				originalIndex = forwardPoints[diagonal - 1] + 1;
				modifiedIndex = originalIndex - diagonalRelative - diagonalForwardOffset;
				if (originalIndex < lastOriginalIndex) {
					changeHelper.MarkNextChange();
				}
				lastOriginalIndex = originalIndex - 1;
				changeHelper.AddOriginalElement(originalIndex, modifiedIndex + 1);
				diagonalRelative = diagonal - 1 - diagonalForwardBase;
			}

			if (historyIndex >= 0) {
				forwardPoints = this.m_forwardHistory[historyIndex];
				diagonalForwardBase = forwardPoints[0];
				diagonalMin = 1;
				diagonalMax = forwardPoints.length - 1;
			}
		} while (--historyIndex >= -1);

		forwardChanges = changeHelper.getReverseChanges();

		changeHelper = new DiffChangeHelper();
		diagonalMin = diagonalReverseStart;
		diagonalMax = diagonalReverseEnd;
		diagonalRelative = midOriginalArr[0] - midModifiedArr[0] - diagonalReverseOffset;
		lastOriginalIndex = LocalConstants.MAX_SAFE_SMALL_INTEGER;
		historyIndex = deltaIsEven ? this.m_reverseHistory.length - 1 : this.m_reverseHistory.length - 2;

		do {
			const diagonal = diagonalRelative + diagonalReverseBase;

			if (
				diagonal === diagonalMin ||
				(diagonal < diagonalMax && reversePoints[diagonal - 1] >= reversePoints[diagonal + 1])
			) {
				originalIndex = reversePoints[diagonal + 1] - 1;
				modifiedIndex = originalIndex - diagonalRelative - diagonalReverseOffset;
				if (originalIndex > lastOriginalIndex) {
					changeHelper.MarkNextChange();
				}
				lastOriginalIndex = originalIndex + 1;
				changeHelper.AddOriginalElement(originalIndex + 1, modifiedIndex + 1);
				diagonalRelative = diagonal + 1 - diagonalReverseBase;
			} else {
				originalIndex = reversePoints[diagonal - 1];
				modifiedIndex = originalIndex - diagonalRelative - diagonalReverseOffset;
				if (originalIndex > lastOriginalIndex) {
					changeHelper.MarkNextChange();
				}
				lastOriginalIndex = originalIndex;
				changeHelper.AddModifiedElement(originalIndex + 1, modifiedIndex + 1);
				diagonalRelative = diagonal - 1 - diagonalReverseBase;
			}

			if (historyIndex >= 0) {
				reversePoints = this.m_reverseHistory[historyIndex];
				diagonalReverseBase = reversePoints[0];
				diagonalMin = 1;
				diagonalMax = reversePoints.length - 1;
			}
		} while (--historyIndex >= -1);

		reverseChanges = changeHelper.getChanges();

		return this.ConcatenateChanges(forwardChanges, reverseChanges);
	}

	private ComputeRecursionPoint(
		originalStart: number,
		originalEnd: number,
		modifiedStart: number,
		modifiedEnd: number,
		midOriginalArr: number[],
		midModifiedArr: number[]
	) {
		let originalIndex = 0,
			modifiedIndex = 0;
		let diagonalForwardStart = 0,
			diagonalForwardEnd = 0;
		let diagonalReverseStart = 0,
			diagonalReverseEnd = 0;

		originalStart--;
		modifiedStart--;

		midOriginalArr[0] = 0;
		midModifiedArr[0] = 0;

		this.m_forwardHistory = [];
		this.m_reverseHistory = [];

		const maxDifferences = originalEnd - originalStart + (modifiedEnd - modifiedStart);
		const numDiagonals = maxDifferences + 1;
		const forwardPoints = new Int32Array(numDiagonals);
		const reversePoints = new Int32Array(numDiagonals);
		const diagonalForwardBase = modifiedEnd - modifiedStart;
		const diagonalReverseBase = originalEnd - originalStart;
		const diagonalForwardOffset = originalStart - modifiedStart;
		const diagonalReverseOffset = originalEnd - modifiedEnd;

		const delta = diagonalReverseBase - diagonalForwardBase;
		const deltaIsEven = delta % 2 === 0;

		forwardPoints[diagonalForwardBase] = originalStart;
		reversePoints[diagonalReverseBase] = originalEnd;

		for (let numDifferences = 1; numDifferences <= maxDifferences / 2 + 1; numDifferences++) {
			let furthestOriginalIndex = 0;
			let furthestModifiedIndex = 0;

			diagonalForwardStart = this.ClipDiagonalBound(
				diagonalForwardBase - numDifferences,
				numDifferences,
				diagonalForwardBase,
				numDiagonals
			);
			diagonalForwardEnd = this.ClipDiagonalBound(
				diagonalForwardBase + numDifferences,
				numDifferences,
				diagonalForwardBase,
				numDiagonals
			);
			for (let diagonal = diagonalForwardStart; diagonal <= diagonalForwardEnd; diagonal += 2) {
				if (
					diagonal === diagonalForwardStart ||
					(diagonal < diagonalForwardEnd && forwardPoints[diagonal - 1] < forwardPoints[diagonal + 1])
				) {
					originalIndex = forwardPoints[diagonal + 1];
				} else {
					originalIndex = forwardPoints[diagonal - 1] + 1;
				}
				modifiedIndex = originalIndex - (diagonal - diagonalForwardBase) - diagonalForwardOffset;

				const tempOriginalIndex = originalIndex;

				while (
					originalIndex < originalEnd &&
					modifiedIndex < modifiedEnd &&
					this.ElementsAreEqual(originalIndex + 1, modifiedIndex + 1)
				) {
					originalIndex++;
					modifiedIndex++;
				}
				forwardPoints[diagonal] = originalIndex;

				if (originalIndex + modifiedIndex > furthestOriginalIndex + furthestModifiedIndex) {
					furthestOriginalIndex = originalIndex;
					furthestModifiedIndex = modifiedIndex;
				}

				if (!deltaIsEven && Math.abs(diagonal - diagonalReverseBase) <= numDifferences - 1) {
					if (originalIndex >= reversePoints[diagonal]) {
						midOriginalArr[0] = originalIndex;
						midModifiedArr[0] = modifiedIndex;

						if (
							tempOriginalIndex <= reversePoints[diagonal] &&
							LocalConstants.MaxDifferencesHistory > 0 &&
							numDifferences <= LocalConstants.MaxDifferencesHistory + 1
						) {
							return this.WALKTRACE(
								diagonalForwardBase,
								diagonalForwardStart,
								diagonalForwardEnd,
								diagonalForwardOffset,
								diagonalReverseBase,
								diagonalReverseStart,
								diagonalReverseEnd,
								diagonalReverseOffset,
								forwardPoints,
								reversePoints,
								originalIndex,
								originalEnd,
								midOriginalArr,
								modifiedIndex,
								modifiedEnd,
								midModifiedArr,
								deltaIsEven
							);
						} else {
							return null;
						}
					}
				}
			}

			diagonalReverseStart = this.ClipDiagonalBound(
				diagonalReverseBase - numDifferences,
				numDifferences,
				diagonalReverseBase,
				numDiagonals
			);
			diagonalReverseEnd = this.ClipDiagonalBound(
				diagonalReverseBase + numDifferences,
				numDifferences,
				diagonalReverseBase,
				numDiagonals
			);
			for (let diagonal = diagonalReverseStart; diagonal <= diagonalReverseEnd; diagonal += 2) {
				if (
					diagonal === diagonalReverseStart ||
					(diagonal < diagonalReverseEnd && reversePoints[diagonal - 1] >= reversePoints[diagonal + 1])
				) {
					originalIndex = reversePoints[diagonal + 1] - 1;
				} else {
					originalIndex = reversePoints[diagonal - 1];
				}
				modifiedIndex = originalIndex - (diagonal - diagonalReverseBase) - diagonalReverseOffset;

				const tempOriginalIndex = originalIndex;

				while (
					originalIndex > originalStart &&
					modifiedIndex > modifiedStart &&
					this.ElementsAreEqual(originalIndex, modifiedIndex)
				) {
					originalIndex--;
					modifiedIndex--;
				}
				reversePoints[diagonal] = originalIndex;

				if (deltaIsEven && Math.abs(diagonal - diagonalForwardBase) <= numDifferences) {
					if (originalIndex <= forwardPoints[diagonal]) {
						midOriginalArr[0] = originalIndex;
						midModifiedArr[0] = modifiedIndex;

						if (
							tempOriginalIndex >= forwardPoints[diagonal] &&
							LocalConstants.MaxDifferencesHistory > 0 &&
							numDifferences <= LocalConstants.MaxDifferencesHistory + 1
						) {
							return this.WALKTRACE(
								diagonalForwardBase,
								diagonalForwardStart,
								diagonalForwardEnd,
								diagonalForwardOffset,
								diagonalReverseBase,
								diagonalReverseStart,
								diagonalReverseEnd,
								diagonalReverseOffset,
								forwardPoints,
								reversePoints,
								originalIndex,
								originalEnd,
								midOriginalArr,
								modifiedIndex,
								modifiedEnd,
								midModifiedArr,
								deltaIsEven
							);
						} else {
							return null;
						}
					}
				}
			}

			if (numDifferences <= LocalConstants.MaxDifferencesHistory) {
				let temp = new Int32Array(diagonalForwardEnd - diagonalForwardStart + 2);
				temp[0] = diagonalForwardBase - diagonalForwardStart + 1;
				MyArray.Copy2(
					forwardPoints,
					diagonalForwardStart,
					temp,
					1,
					diagonalForwardEnd - diagonalForwardStart + 1
				);
				this.m_forwardHistory.push(temp);

				temp = new Int32Array(diagonalReverseEnd - diagonalReverseStart + 2);
				temp[0] = diagonalReverseBase - diagonalReverseStart + 1;
				MyArray.Copy2(
					reversePoints,
					diagonalReverseStart,
					temp,
					1,
					diagonalReverseEnd - diagonalReverseStart + 1
				);
				this.m_reverseHistory.push(temp);
			}
		}

		return this.WALKTRACE(
			diagonalForwardBase,
			diagonalForwardStart,
			diagonalForwardEnd,
			diagonalForwardOffset,
			diagonalReverseBase,
			diagonalReverseStart,
			diagonalReverseEnd,
			diagonalReverseOffset,
			forwardPoints,
			reversePoints,
			originalIndex,
			originalEnd,
			midOriginalArr,
			modifiedIndex,
			modifiedEnd,
			midModifiedArr,
			deltaIsEven
		);
	}

	private ConcatenateChanges(left: DiffChange[], right: DiffChange[]): DiffChange[] {
		const mergedChangeArr: DiffChange[] = [];

		if (left.length === 0 || right.length === 0) {
			return right.length > 0 ? right : left;
		} else if (this.ChangesOverlap(left[left.length - 1], right[0], mergedChangeArr)) {
			const result = new Array<DiffChange>(left.length + right.length - 1);
			MyArray.Copy(left, 0, result, 0, left.length - 1);
			result[left.length - 1] = mergedChangeArr[0];
			MyArray.Copy(right, 1, result, left.length, right.length - 1);

			return result;
		} else {
			const result = new Array<DiffChange>(left.length + right.length);
			MyArray.Copy(left, 0, result, 0, left.length);
			MyArray.Copy(right, 0, result, left.length, right.length);

			return result;
		}
	}

	private ChangesOverlap(left: DiffChange, right: DiffChange, mergedChangeArr: Array<DiffChange | null>): boolean {
		Debug.Assert(
			left.originalStart <= right.originalStart,
			'Left change is not less than or equal to right change'
		);
		Debug.Assert(
			left.modifiedStart <= right.modifiedStart,
			'Left change is not less than or equal to right change'
		);

		if (
			left.originalStart + left.originalLength >= right.originalStart ||
			left.modifiedStart + left.modifiedLength >= right.modifiedStart
		) {
			const originalStart = left.originalStart;
			let originalLength = left.originalLength;
			const modifiedStart = left.modifiedStart;
			let modifiedLength = left.modifiedLength;

			if (left.originalStart + left.originalLength >= right.originalStart) {
				originalLength = right.originalStart + right.originalLength - left.originalStart;
			}
			if (left.modifiedStart + left.modifiedLength >= right.modifiedStart) {
				modifiedLength = right.modifiedStart + right.modifiedLength - left.modifiedStart;
			}

			mergedChangeArr[0] = new DiffChange(originalStart, originalLength, modifiedStart, modifiedLength);
			return true;
		} else {
			mergedChangeArr[0] = null;
			return false;
		}
	}

	private ClipDiagonalBound(
		diagonal: number,
		numDifferences: number,
		diagonalBaseIndex: number,
		numDiagonals: number
	): number {
		if (diagonal >= 0 && diagonal < numDiagonals) {
			return diagonal;
		}

		const diagonalsBelow = diagonalBaseIndex;
		const diagonalsAbove = numDiagonals - diagonalBaseIndex - 1;
		const diffEven = numDifferences % 2 === 0;

		if (diagonal < 0) {
			const lowerBoundEven = diagonalsBelow % 2 === 0;
			return diffEven === lowerBoundEven ? 0 : 1;
		} else {
			const upperBoundEven = diagonalsAbove % 2 === 0;
			return diffEven === upperBoundEven ? numDiagonals - 1 : numDiagonals - 2;
		}
	}
}
