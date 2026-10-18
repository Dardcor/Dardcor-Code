/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { splitLines } from '../../../../../util/dardcor/base/common/strings';
import { Position } from '../../../../../util/dardcor/editor/common/core/position';
import { Range } from '../../../../../util/dardcor/editor/common/core/range';
import { TextLength } from '../../../../../util/dardcor/editor/common/core/text/textLength';

export function lengthDiff(startLineCount: number, startColumnCount: number, endLineCount: number, endColumnCount: number): Length {
	return (startLineCount !== endLineCount)
		? toLength(endLineCount - startLineCount, endColumnCount)
		: toLength(0, endColumnCount - startColumnCount);
}

export type Length = { _brand: 'Length' };

export const lengthZero = 0 as any as Length;

export function lengthIsZero(length: Length): boolean {
	return length as any as number === 0;
}

const factor = 2 ** 26;

export function toLength(lineCount: number, columnCount: number): Length {


	return (lineCount * factor + columnCount) as any as Length;
}

export function lengthToObj(length: Length): TextLength {
	const l = length as any as number;
	const lineCount = Math.floor(l / factor);
	const columnCount = l - lineCount * factor;
	return new TextLength(lineCount, columnCount);
}

export function lengthGetLineCount(length: Length): number {
	return Math.floor(length as any as number / factor);
}

export function lengthGetColumnCountIfZeroLineCount(length: Length): number {
	return length as any as number;
}


export function lengthAdd(length1: Length, length2: Length): Length;
export function lengthAdd(l1: any, l2: any): Length {
	let r = l1 + l2;
	if (l2 >= factor) { r = r - (l1 % factor); }
	return r;
}

export function sumLengths<T>(items: readonly T[], lengthFn: (item: T) => Length): Length {
	return items.reduce((a, b) => lengthAdd(a, lengthFn(b)), lengthZero);
}

export function lengthEquals(length1: Length, length2: Length): boolean {
	return length1 === length2;
}

export function lengthDiffNonNegative(length1: Length, length2: Length): Length {
	const l1 = length1 as any as number;
	const l2 = length2 as any as number;

	const diff = l2 - l1;
	if (diff <= 0) {
		return lengthZero;
	}

	const lineCount1 = Math.floor(l1 / factor);
	const lineCount2 = Math.floor(l2 / factor);

	const colCount2 = l2 - lineCount2 * factor;

	if (lineCount1 === lineCount2) {
		const colCount1 = l1 - lineCount1 * factor;
		return toLength(0, colCount2 - colCount1);
	} else {
		return toLength(lineCount2 - lineCount1, colCount2);
	}
}

export function lengthLessThan(length1: Length, length2: Length): boolean {
	return (length1 as any as number) < (length2 as any as number);
}

export function lengthLessThanEqual(length1: Length, length2: Length): boolean {
	return (length1 as any as number) <= (length2 as any as number);
}

export function lengthGreaterThanEqual(length1: Length, length2: Length): boolean {
	return (length1 as any as number) >= (length2 as any as number);
}

export function lengthToPosition(length: Length): Position {
	const l = length as any as number;
	const lineCount = Math.floor(l / factor);
	const colCount = l - lineCount * factor;
	return new Position(lineCount + 1, colCount + 1);
}

export function positionToLength(position: Position): Length {
	return toLength(position.lineNumber - 1, position.column - 1);
}

export function lengthsToRange(lengthStart: Length, lengthEnd: Length): Range {
	const l = lengthStart as any as number;
	const lineCount = Math.floor(l / factor);
	const colCount = l - lineCount * factor;

	const l2 = lengthEnd as any as number;
	const lineCount2 = Math.floor(l2 / factor);
	const colCount2 = l2 - lineCount2 * factor;

	return new Range(lineCount + 1, colCount + 1, lineCount2 + 1, colCount2 + 1);
}

export function lengthOfRange(range: Range): TextLength {
	if (range.startLineNumber === range.endLineNumber) {
		return new TextLength(0, range.endColumn - range.startColumn);
	} else {
		return new TextLength(range.endLineNumber - range.startLineNumber, range.endColumn - 1);
	}
}

export function lengthCompare(length1: Length, length2: Length): number {
	const l1 = length1 as any as number;
	const l2 = length2 as any as number;
	return l1 - l2;
}

export function lengthOfString(str: string): Length {
	const lines = splitLines(str);
	return toLength(lines.length - 1, lines[lines.length - 1].length);
}

export function lengthOfStringObj(str: string): TextLength {
	const lines = splitLines(str);
	return new TextLength(lines.length - 1, lines[lines.length - 1].length);
}

export function lengthHash(length: Length): number {
	return length as any;
}

export function lengthMax(length1: Length, length2: Length): Length {
	return length1 > length2 ? length1 : length2;
}
