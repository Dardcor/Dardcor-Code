
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../../base/common/errors';
import { OffsetRange } from './offsetRange';
import { IRange, Range } from '../range';
import { findFirstIdxMonotonousOrArrLen, findLastIdxMonotonous, findLastMonotonous } from '../../../../base/common/arraysFind';
import { Comparator, compareBy, numberComparator } from '../../../../base/common/arrays';

export class LineRange {
	public static ofLength(startLineNumber: number, length: number): LineRange {
		return new LineRange(startLineNumber, startLineNumber + length);
	}

	public static fromRange(range: IRange): LineRange {
		return new LineRange(range.startLineNumber, range.endLineNumber);
	}

	public static fromRangeInclusive(range: IRange): LineRange {
		return new LineRange(range.startLineNumber, range.endLineNumber + 1);
	}

	public static readonly compareByStart: Comparator<LineRange> = compareBy(l => l.startLineNumber, numberComparator);

	public static subtract(a: LineRange, b: LineRange | undefined): LineRange[] {
		if (!b) {
			return [a];
		}
		if (a.startLineNumber < b.startLineNumber && b.endLineNumberExclusive < a.endLineNumberExclusive) {
			return [
				new LineRange(a.startLineNumber, b.startLineNumber),
				new LineRange(b.endLineNumberExclusive, a.endLineNumberExclusive)
			];
		} else if (b.startLineNumber <= a.startLineNumber && a.endLineNumberExclusive <= b.endLineNumberExclusive) {
			return [];
		} else if (b.endLineNumberExclusive < a.endLineNumberExclusive) {
			return [new LineRange(Math.max(b.endLineNumberExclusive, a.startLineNumber), a.endLineNumberExclusive)];
		} else {
			return [new LineRange(a.startLineNumber, Math.min(b.startLineNumber, a.endLineNumberExclusive))];
		}
	}

	public static joinMany(lineRanges: readonly (readonly LineRange[])[]): readonly LineRange[] {
		if (lineRanges.length === 0) {
			return [];
		}
		let result = new LineRangeSet(lineRanges[0].slice());
		for (let i = 1; i < lineRanges.length; i++) {
			result = result.getUnion(new LineRangeSet(lineRanges[i].slice()));
		}
		return result.ranges;
	}

	public static join(lineRanges: LineRange[]): LineRange {
		if (lineRanges.length === 0) {
			throw new BugIndicatingError('lineRanges cannot be empty');
		}
		let startLineNumber = lineRanges[0].startLineNumber;
		let endLineNumberExclusive = lineRanges[0].endLineNumberExclusive;
		for (let i = 1; i < lineRanges.length; i++) {
			startLineNumber = Math.min(startLineNumber, lineRanges[i].startLineNumber);
			endLineNumberExclusive = Math.max(endLineNumberExclusive, lineRanges[i].endLineNumberExclusive);
		}
		return new LineRange(startLineNumber, endLineNumberExclusive);
	}

	/**
	 * @internal
	 */
	public static deserialize(lineRange: ISerializedLineRange): LineRange {
		return new LineRange(lineRange[0], lineRange[1]);
	}

	public readonly startLineNumber: number;

	public readonly endLineNumberExclusive: number;

	constructor(
		startLineNumber: number,
		endLineNumberExclusive: number,
	) {
		if (startLineNumber > endLineNumberExclusive) {
			throw new BugIndicatingError(`startLineNumber ${startLineNumber} cannot be after endLineNumberExclusive ${endLineNumberExclusive}`);
		}
		this.startLineNumber = startLineNumber;
		this.endLineNumberExclusive = endLineNumberExclusive;
	}

	public contains(lineNumber: number): boolean {
		return this.startLineNumber <= lineNumber && lineNumber < this.endLineNumberExclusive;
	}

	public containsRange(range: LineRange): boolean {
		return this.startLineNumber <= range.startLineNumber && range.endLineNumberExclusive <= this.endLineNumberExclusive;
	}

	get isEmpty(): boolean {
		return this.startLineNumber === this.endLineNumberExclusive;
	}

	public delta(offset: number): LineRange {
		return new LineRange(this.startLineNumber + offset, this.endLineNumberExclusive + offset);
	}

	public deltaLength(offset: number): LineRange {
		return new LineRange(this.startLineNumber, this.endLineNumberExclusive + offset);
	}

	public get length(): number {
		return this.endLineNumberExclusive - this.startLineNumber;
	}

	public join(other: LineRange): LineRange {
		return new LineRange(
			Math.min(this.startLineNumber, other.startLineNumber),
			Math.max(this.endLineNumberExclusive, other.endLineNumberExclusive)
		);
	}

	public toString(): string {
		return `[${this.startLineNumber},${this.endLineNumberExclusive})`;
	}

	public intersect(other: LineRange): LineRange | undefined {
		const startLineNumber = Math.max(this.startLineNumber, other.startLineNumber);
		const endLineNumberExclusive = Math.min(this.endLineNumberExclusive, other.endLineNumberExclusive);
		if (startLineNumber <= endLineNumberExclusive) {
			return new LineRange(startLineNumber, endLineNumberExclusive);
		}
		return undefined;
	}

	public intersectsStrict(other: LineRange): boolean {
		return this.startLineNumber < other.endLineNumberExclusive && other.startLineNumber < this.endLineNumberExclusive;
	}

	public intersectsOrTouches(other: LineRange): boolean {
		return this.startLineNumber <= other.endLineNumberExclusive && other.startLineNumber <= this.endLineNumberExclusive;
	}

	public equals(b: LineRange): boolean {
		return this.startLineNumber === b.startLineNumber && this.endLineNumberExclusive === b.endLineNumberExclusive;
	}

	public toInclusiveRange(): Range | null {
		if (this.isEmpty) {
			return null;
		}
		return new Range(this.startLineNumber, 1, this.endLineNumberExclusive - 1, Number.MAX_SAFE_INTEGER);
	}

	public toExclusiveRange(): Range {
		return new Range(this.startLineNumber, 1, this.endLineNumberExclusive, 1);
	}

	public mapToLineArray<T>(f: (lineNumber: number) => T): T[] {
		const result: T[] = [];
		for (let lineNumber = this.startLineNumber; lineNumber < this.endLineNumberExclusive; lineNumber++) {
			result.push(f(lineNumber));
		}
		return result;
	}

	public forEach(f: (lineNumber: number) => void): void {
		for (let lineNumber = this.startLineNumber; lineNumber < this.endLineNumberExclusive; lineNumber++) {
			f(lineNumber);
		}
	}

	/**
	 * @internal
	 */
	public serialize(): ISerializedLineRange {
		return [this.startLineNumber, this.endLineNumberExclusive];
	}

	/**
	 * Converts this 1-based line range to a 0-based offset range (subtracts 1!).
	 * @internal
	 */
	public toOffsetRange(): OffsetRange {
		return new OffsetRange(this.startLineNumber - 1, this.endLineNumberExclusive - 1);
	}

	public distanceToRange(other: LineRange): number {
		if (this.endLineNumberExclusive <= other.startLineNumber) {
			return other.startLineNumber - this.endLineNumberExclusive;
		}
		if (other.endLineNumberExclusive <= this.startLineNumber) {
			return this.startLineNumber - other.endLineNumberExclusive;
		}
		return 0;
	}

	public distanceToLine(lineNumber: number): number {
		if (this.contains(lineNumber)) {
			return 0;
		}
		if (lineNumber < this.startLineNumber) {
			return this.startLineNumber - lineNumber;
		}
		return lineNumber - this.endLineNumberExclusive;
	}

	public addMargin(marginTop: number, marginBottom: number): LineRange {
		return new LineRange(
			this.startLineNumber - marginTop,
			this.endLineNumberExclusive + marginBottom
		);
	}
}

export type ISerializedLineRange = [startLineNumber: number, endLineNumberExclusive: number];


export class LineRangeSet {
	constructor(
		private readonly _normalizedRanges: LineRange[] = []
	) {
	}

	get ranges(): readonly LineRange[] {
		return this._normalizedRanges;
	}

	addRange(range: LineRange): void {
		if (range.length === 0) {
			return;
		}


		const joinRangeStartIdx = findFirstIdxMonotonousOrArrLen(this._normalizedRanges, r => r.endLineNumberExclusive >= range.startLineNumber);
		const joinRangeEndIdxExclusive = findLastIdxMonotonous(this._normalizedRanges, r => r.startLineNumber <= range.endLineNumberExclusive) + 1;

		if (joinRangeStartIdx === joinRangeEndIdxExclusive) {
			this._normalizedRanges.splice(joinRangeStartIdx, 0, range);
		} else if (joinRangeStartIdx === joinRangeEndIdxExclusive - 1) {
			const joinRange = this._normalizedRanges[joinRangeStartIdx];
			this._normalizedRanges[joinRangeStartIdx] = joinRange.join(range);
		} else {
			const joinRange = this._normalizedRanges[joinRangeStartIdx].join(this._normalizedRanges[joinRangeEndIdxExclusive - 1]).join(range);
			this._normalizedRanges.splice(joinRangeStartIdx, joinRangeEndIdxExclusive - joinRangeStartIdx, joinRange);
		}
	}

	contains(lineNumber: number): boolean {
		const rangeThatStartsBeforeEnd = findLastMonotonous(this._normalizedRanges, r => r.startLineNumber <= lineNumber);
		return !!rangeThatStartsBeforeEnd && rangeThatStartsBeforeEnd.endLineNumberExclusive > lineNumber;
	}

	intersects(range: LineRange): boolean {
		const rangeThatStartsBeforeEnd = findLastMonotonous(this._normalizedRanges, r => r.startLineNumber < range.endLineNumberExclusive);
		return !!rangeThatStartsBeforeEnd && rangeThatStartsBeforeEnd.endLineNumberExclusive > range.startLineNumber;
	}

	getUnion(other: LineRangeSet): LineRangeSet {
		if (this._normalizedRanges.length === 0) {
			return other;
		}
		if (other._normalizedRanges.length === 0) {
			return this;
		}

		const result: LineRange[] = [];
		let i1 = 0;
		let i2 = 0;
		let current: LineRange | null = null;
		while (i1 < this._normalizedRanges.length || i2 < other._normalizedRanges.length) {
			let next: LineRange | null = null;
			if (i1 < this._normalizedRanges.length && i2 < other._normalizedRanges.length) {
				const lineRange1 = this._normalizedRanges[i1];
				const lineRange2 = other._normalizedRanges[i2];
				if (lineRange1.startLineNumber < lineRange2.startLineNumber) {
					next = lineRange1;
					i1++;
				} else {
					next = lineRange2;
					i2++;
				}
			} else if (i1 < this._normalizedRanges.length) {
				next = this._normalizedRanges[i1];
				i1++;
			} else {
				next = other._normalizedRanges[i2];
				i2++;
			}

			if (current === null) {
				current = next;
			} else {
				if (current.endLineNumberExclusive >= next.startLineNumber) {
					current = new LineRange(current.startLineNumber, Math.max(current.endLineNumberExclusive, next.endLineNumberExclusive));
				} else {
					result.push(current);
					current = next;
				}
			}
		}
		if (current !== null) {
			result.push(current);
		}
		return new LineRangeSet(result);
	}

	subtractFrom(range: LineRange): LineRangeSet {
		const joinRangeStartIdx = findFirstIdxMonotonousOrArrLen(this._normalizedRanges, r => r.endLineNumberExclusive >= range.startLineNumber);
		const joinRangeEndIdxExclusive = findLastIdxMonotonous(this._normalizedRanges, r => r.startLineNumber <= range.endLineNumberExclusive) + 1;

		if (joinRangeStartIdx === joinRangeEndIdxExclusive) {
			return new LineRangeSet([range]);
		}

		const result: LineRange[] = [];
		let startLineNumber = range.startLineNumber;
		for (let i = joinRangeStartIdx; i < joinRangeEndIdxExclusive; i++) {
			const r = this._normalizedRanges[i];
			if (r.startLineNumber > startLineNumber) {
				result.push(new LineRange(startLineNumber, r.startLineNumber));
			}
			startLineNumber = r.endLineNumberExclusive;
		}
		if (startLineNumber < range.endLineNumberExclusive) {
			result.push(new LineRange(startLineNumber, range.endLineNumberExclusive));
		}

		return new LineRangeSet(result);
	}

	toString() {
		return this._normalizedRanges.map(r => r.toString()).join(', ');
	}

	getIntersection(other: LineRangeSet): LineRangeSet {
		const result: LineRange[] = [];

		let i1 = 0;
		let i2 = 0;
		while (i1 < this._normalizedRanges.length && i2 < other._normalizedRanges.length) {
			const r1 = this._normalizedRanges[i1];
			const r2 = other._normalizedRanges[i2];

			const i = r1.intersect(r2);
			if (i && !i.isEmpty) {
				result.push(i);
			}

			if (r1.endLineNumberExclusive < r2.endLineNumberExclusive) {
				i1++;
			} else {
				i2++;
			}
		}

		return new LineRangeSet(result);
	}

	getWithDelta(value: number): LineRangeSet {
		return new LineRangeSet(this._normalizedRanges.map(r => r.delta(value)));
	}
}
