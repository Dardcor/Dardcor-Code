/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPosition, Position } from './position.js';

export interface IRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export class Range {

	public readonly startLineNumber: number;
	public readonly startColumn: number;
	public readonly endLineNumber: number;
	public readonly endColumn: number;

	constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
		if ((startLineNumber > endLineNumber) || (startLineNumber === endLineNumber && startColumn > endColumn)) {
			this.startLineNumber = endLineNumber;
			this.startColumn = endColumn;
			this.endLineNumber = startLineNumber;
			this.endColumn = startColumn;
		} else {
			this.startLineNumber = startLineNumber;
			this.startColumn = startColumn;
			this.endLineNumber = endLineNumber;
			this.endColumn = endColumn;
		}
	}

	public isEmpty(): boolean {
		return Range.isEmpty(this);
	}

	public static isEmpty(range: IRange): boolean {
		return (range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn);
	}

	public containsPosition(position: IPosition): boolean {
		return Range.containsPosition(this, position);
	}

	public static containsPosition(range: IRange, position: IPosition): boolean {
		if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
			return false;
		}
		if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
			return false;
		}
		if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {
			return false;
		}
		return true;
	}

	/**
	 * Test if `position` is in `range`. If the position is at the edges, will return false.
	 * @internal
	 */
	public static strictContainsPosition(range: IRange, position: IPosition): boolean {
		if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
			return false;
		}
		if (position.lineNumber === range.startLineNumber && position.column <= range.startColumn) {
			return false;
		}
		if (position.lineNumber === range.endLineNumber && position.column >= range.endColumn) {
			return false;
		}
		return true;
	}

	public containsRange(range: IRange): boolean {
		return Range.containsRange(this, range);
	}

	public static containsRange(range: IRange, otherRange: IRange): boolean {
		if (otherRange.startLineNumber < range.startLineNumber || otherRange.endLineNumber < range.startLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber > range.endLineNumber || otherRange.endLineNumber > range.endLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber === range.startLineNumber && otherRange.startColumn < range.startColumn) {
			return false;
		}
		if (otherRange.endLineNumber === range.endLineNumber && otherRange.endColumn > range.endColumn) {
			return false;
		}
		return true;
	}

	public strictContainsRange(range: IRange): boolean {
		return Range.strictContainsRange(this, range);
	}

	public static strictContainsRange(range: IRange, otherRange: IRange): boolean {
		if (otherRange.startLineNumber < range.startLineNumber || otherRange.endLineNumber < range.startLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber > range.endLineNumber || otherRange.endLineNumber > range.endLineNumber) {
			return false;
		}
		if (otherRange.startLineNumber === range.startLineNumber && otherRange.startColumn <= range.startColumn) {
			return false;
		}
		if (otherRange.endLineNumber === range.endLineNumber && otherRange.endColumn >= range.endColumn) {
			return false;
		}
		return true;
	}

	public plusRange(range: IRange): Range {
		return Range.plusRange(this, range);
	}

	public static plusRange(a: IRange, b: IRange): Range {
		let startLineNumber: number;
		let startColumn: number;
		let endLineNumber: number;
		let endColumn: number;

		if (b.startLineNumber < a.startLineNumber) {
			startLineNumber = b.startLineNumber;
			startColumn = b.startColumn;
		} else if (b.startLineNumber === a.startLineNumber) {
			startLineNumber = b.startLineNumber;
			startColumn = Math.min(b.startColumn, a.startColumn);
		} else {
			startLineNumber = a.startLineNumber;
			startColumn = a.startColumn;
		}

		if (b.endLineNumber > a.endLineNumber) {
			endLineNumber = b.endLineNumber;
			endColumn = b.endColumn;
		} else if (b.endLineNumber === a.endLineNumber) {
			endLineNumber = b.endLineNumber;
			endColumn = Math.max(b.endColumn, a.endColumn);
		} else {
			endLineNumber = a.endLineNumber;
			endColumn = a.endColumn;
		}

		return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	public intersectRanges(range: IRange): Range | null {
		return Range.intersectRanges(this, range);
	}

	public static intersectRanges(a: IRange, b: IRange): Range | null {
		let resultStartLineNumber = a.startLineNumber;
		let resultStartColumn = a.startColumn;
		let resultEndLineNumber = a.endLineNumber;
		let resultEndColumn = a.endColumn;
		const otherStartLineNumber = b.startLineNumber;
		const otherStartColumn = b.startColumn;
		const otherEndLineNumber = b.endLineNumber;
		const otherEndColumn = b.endColumn;

		if (resultStartLineNumber < otherStartLineNumber) {
			resultStartLineNumber = otherStartLineNumber;
			resultStartColumn = otherStartColumn;
		} else if (resultStartLineNumber === otherStartLineNumber) {
			resultStartColumn = Math.max(resultStartColumn, otherStartColumn);
		}

		if (resultEndLineNumber > otherEndLineNumber) {
			resultEndLineNumber = otherEndLineNumber;
			resultEndColumn = otherEndColumn;
		} else if (resultEndLineNumber === otherEndLineNumber) {
			resultEndColumn = Math.min(resultEndColumn, otherEndColumn);
		}

		if (resultStartLineNumber > resultEndLineNumber) {
			return null;
		}
		if (resultStartLineNumber === resultEndLineNumber && resultStartColumn > resultEndColumn) {
			return null;
		}
		return new Range(resultStartLineNumber, resultStartColumn, resultEndLineNumber, resultEndColumn);
	}

	public equalsRange(other: IRange | null | undefined): boolean {
		return Range.equalsRange(this, other);
	}

	public static equalsRange(a: IRange | null | undefined, b: IRange | null | undefined): boolean {
		if (!a && !b) {
			return true;
		}
		return (
			!!a &&
			!!b &&
			a.startLineNumber === b.startLineNumber &&
			a.startColumn === b.startColumn &&
			a.endLineNumber === b.endLineNumber &&
			a.endColumn === b.endColumn
		);
	}

	public getEndPosition(): Position {
		return Range.getEndPosition(this);
	}

	public static getEndPosition(range: IRange): Position {
		return new Position(range.endLineNumber, range.endColumn);
	}

	public getStartPosition(): Position {
		return Range.getStartPosition(this);
	}

	public static getStartPosition(range: IRange): Position {
		return new Position(range.startLineNumber, range.startColumn);
	}

	public toString(): string {
		return '[' + this.startLineNumber + ',' + this.startColumn + ' -> ' + this.endLineNumber + ',' + this.endColumn + ']';
	}

	public setEndPosition(endLineNumber: number, endColumn: number): Range {
		return new Range(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
	}

	public setStartPosition(startLineNumber: number, startColumn: number): Range {
		return new Range(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
	}

	public collapseToStart(): Range {
		return Range.collapseToStart(this);
	}

	public static collapseToStart(range: IRange): Range {
		return new Range(range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn);
	}

	public collapseToEnd(): Range {
		return Range.collapseToEnd(this);
	}

	public static collapseToEnd(range: IRange): Range {
		return new Range(range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn);
	}

	public delta(lineCount: number): Range {
		return new Range(this.startLineNumber + lineCount, this.startColumn, this.endLineNumber + lineCount, this.endColumn);
	}

	public isSingleLine(): boolean {
		return this.startLineNumber === this.endLineNumber;
	}


	public static fromPositions(start: IPosition, end: IPosition = start): Range {
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	public static lift(range: undefined | null): null;
	public static lift(range: IRange): Range;
	public static lift(range: IRange | undefined | null): Range | null;
	public static lift(range: IRange | undefined | null): Range | null {
		if (!range) {
			return null;
		}
		return new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
	}

	public static isIRange(obj: unknown): obj is IRange {
		return (
			!!obj
			&& (typeof (obj as IRange).startLineNumber === 'number')
			&& (typeof (obj as IRange).startColumn === 'number')
			&& (typeof (obj as IRange).endLineNumber === 'number')
			&& (typeof (obj as IRange).endColumn === 'number')
		);
	}

	public static areIntersectingOrTouching(a: IRange, b: IRange): boolean {
		if (a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn)) {
			return false;
		}

		if (b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn)) {
			return false;
		}

		return true;
	}

	public static areIntersecting(a: IRange, b: IRange): boolean {
		if (a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn <= b.startColumn)) {
			return false;
		}

		if (b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn <= a.startColumn)) {
			return false;
		}

		return true;
	}

	public static areOnlyIntersecting(a: IRange, b: IRange): boolean {
		if (a.endLineNumber < (b.startLineNumber - 1) || (a.endLineNumber === b.startLineNumber && a.endColumn < (b.startColumn - 1))) {
			return false;
		}

		if (b.endLineNumber < (a.startLineNumber - 1) || (b.endLineNumber === a.startLineNumber && b.endColumn < (a.startColumn - 1))) {
			return false;
		}

		return true;
	}

	public static compareRangesUsingStarts(a: IRange | null | undefined, b: IRange | null | undefined): number {
		if (a && b) {
			const aStartLineNumber = a.startLineNumber | 0;
			const bStartLineNumber = b.startLineNumber | 0;

			if (aStartLineNumber === bStartLineNumber) {
				const aStartColumn = a.startColumn | 0;
				const bStartColumn = b.startColumn | 0;

				if (aStartColumn === bStartColumn) {
					const aEndLineNumber = a.endLineNumber | 0;
					const bEndLineNumber = b.endLineNumber | 0;

					if (aEndLineNumber === bEndLineNumber) {
						const aEndColumn = a.endColumn | 0;
						const bEndColumn = b.endColumn | 0;
						return aEndColumn - bEndColumn;
					}
					return aEndLineNumber - bEndLineNumber;
				}
				return aStartColumn - bStartColumn;
			}
			return aStartLineNumber - bStartLineNumber;
		}
		const aExists = (a ? 1 : 0);
		const bExists = (b ? 1 : 0);
		return aExists - bExists;
	}

	public static compareRangesUsingEnds(a: IRange, b: IRange): number {
		if (a.endLineNumber === b.endLineNumber) {
			if (a.endColumn === b.endColumn) {
				if (a.startLineNumber === b.startLineNumber) {
					return a.startColumn - b.startColumn;
				}
				return a.startLineNumber - b.startLineNumber;
			}
			return a.endColumn - b.endColumn;
		}
		return a.endLineNumber - b.endLineNumber;
	}

	public static spansMultipleLines(range: IRange): boolean {
		return range.endLineNumber > range.startLineNumber;
	}

	public toJSON(): IRange {
		return this;
	}
}
