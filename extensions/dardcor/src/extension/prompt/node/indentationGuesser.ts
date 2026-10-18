/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FormattingOptions, TextDocument } from 'vscode';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import * as strings from '../../../util/dardcor/base/common/strings';
import { isLines, Lines } from './editGeneration';

const enum CharCode {
	Tab = 9,
	Space = 32,
	Comma = 44,
}

export interface IIndentationTextBuffer {
	getLineCount(): number;
	getLineLength(lineNumber: number): number;
	getLineContent(lineNumber: number): string;
}

class SpacesDiffResult {
	public spacesDiff = 0;
	public looksLikeAlignment = false;
}

function spacesDiff(a: string, aLength: number, b: string, bLength: number, result: SpacesDiffResult): void {
	result.spacesDiff = 0;
	result.looksLikeAlignment = false;


	let i: number;

	for (i = 0; i < aLength && i < bLength; i++) {
		const aCharCode = a.charCodeAt(i);
		const bCharCode = b.charCodeAt(i);

		if (aCharCode !== bCharCode) {
			break;
		}
	}

	let aSpacesCnt = 0,
		aTabsCount = 0;
	for (let j = i; j < aLength; j++) {
		const aCharCode = a.charCodeAt(j);
		if (aCharCode === CharCode.Space) {
			aSpacesCnt++;
		} else {
			aTabsCount++;
		}
	}

	let bSpacesCnt = 0,
		bTabsCount = 0;
	for (let j = i; j < bLength; j++) {
		const bCharCode = b.charCodeAt(j);
		if (bCharCode === CharCode.Space) {
			bSpacesCnt++;
		} else {
			bTabsCount++;
		}
	}

	if (aSpacesCnt > 0 && aTabsCount > 0) {
		return;
	}
	if (bSpacesCnt > 0 && bTabsCount > 0) {
		return;
	}

	const tabsDiff = Math.abs(aTabsCount - bTabsCount);
	const spacesDiff = Math.abs(aSpacesCnt - bSpacesCnt);

	if (tabsDiff === 0) {
		result.spacesDiff = spacesDiff;

		if (spacesDiff > 0 && 0 <= bSpacesCnt - 1 && bSpacesCnt - 1 < a.length && bSpacesCnt < b.length) {
			if (b.charCodeAt(bSpacesCnt) !== CharCode.Space && a.charCodeAt(bSpacesCnt - 1) === CharCode.Space) {
				if (a.charCodeAt(a.length - 1) === CharCode.Comma) {
					result.looksLikeAlignment = true;
				}
			}
		}
		return;
	}
	if (spacesDiff % tabsDiff === 0) {
		result.spacesDiff = spacesDiff / tabsDiff;
		return;
	}
}

export interface IGuessedIndentation {
	tabSize: number;
	insertSpaces: boolean;
}

export function guessFileIndentInfo(source: Lines | TextDocument | TextDocumentSnapshot): FormattingOptions {
	return { ...guessIndentation(source, 4, false) };
}

export function guessIndentation(
	source: Lines | TextDocument | TextDocumentSnapshot,
	defaultTabSize: number,
	defaultInsertSpaces: boolean
): IGuessedIndentation {
	const linesCount = Math.min(isLines(source) ? source.length : source.lineCount, 10000);

	let linesIndentedWithTabsCount = 0;
	let linesIndentedWithSpacesCount = 0;

	let previousLineText = '';
	let previousLineIndentation = 0;

	const ALLOWED_TAB_SIZE_GUESSES = [2, 4, 6, 8, 3, 5, 7];
	const MAX_ALLOWED_TAB_SIZE_GUESS = 8;

	const spacesDiffCount = [0, 0, 0, 0, 0, 0, 0, 0, 0];
	const tmp = new SpacesDiffResult();

	for (let lineNumber = 0; lineNumber < linesCount; lineNumber++) {
		const currentLineText = isLines(source) ? source[lineNumber] : source.lineAt(lineNumber).text;
		const currentLineLength = currentLineText.length;

		let currentLineHasContent = false;
		let currentLineIndentation = 0;
		let currentLineSpacesCount = 0;
		let currentLineTabsCount = 0;
		for (let j = 0, lenJ = currentLineLength; j < lenJ; j++) {
			const charCode = currentLineText.charCodeAt(j);

			if (charCode === CharCode.Tab) {
				currentLineTabsCount++;
			} else if (charCode === CharCode.Space) {
				currentLineSpacesCount++;
			} else {
				currentLineHasContent = true;
				currentLineIndentation = j;
				break;
			}
		}

		if (!currentLineHasContent) {
			continue;
		}

		if (currentLineTabsCount > 0) {
			linesIndentedWithTabsCount++;
		} else if (currentLineSpacesCount > 1) {
			linesIndentedWithSpacesCount++;
		}

		spacesDiff(previousLineText, previousLineIndentation, currentLineText, currentLineIndentation, tmp);

		if (tmp.looksLikeAlignment) {

			if (!(defaultInsertSpaces && defaultTabSize === tmp.spacesDiff)) {
				continue;
			}
		}

		const currentSpacesDiff = tmp.spacesDiff;
		if (currentSpacesDiff <= MAX_ALLOWED_TAB_SIZE_GUESS) {
			spacesDiffCount[currentSpacesDiff]++;
		}

		previousLineText = currentLineText;
		previousLineIndentation = currentLineIndentation;
	}

	let insertSpaces = defaultInsertSpaces;
	if (linesIndentedWithTabsCount !== linesIndentedWithSpacesCount) {
		insertSpaces = linesIndentedWithTabsCount < linesIndentedWithSpacesCount;
	}

	let tabSize = defaultTabSize;

	if (insertSpaces) {
		let tabSizeScore = insertSpaces ? 0 : 0.1 * linesCount;


		ALLOWED_TAB_SIZE_GUESSES.forEach(possibleTabSize => {
			const possibleTabSizeScore = spacesDiffCount[possibleTabSize];
			if (possibleTabSizeScore > tabSizeScore) {
				tabSizeScore = possibleTabSizeScore;
				tabSize = possibleTabSize;
			}
		});

		if (
			tabSize === 4 &&
			spacesDiffCount[4] > 0 &&
			spacesDiffCount[2] > 0 &&
			spacesDiffCount[2] >= spacesDiffCount[4] / 2
		) {
			tabSize = 2;
		}
	}


	return {
		insertSpaces: insertSpaces,
		tabSize: tabSize,
	};
}

function computeIndentLevel(line: string, tabSize: number): number {
	let indent = 0;
	let i = 0;
	const len = line.length;

	while (i < len) {
		const chCode = line.charCodeAt(i);
		if (chCode === CharCode.Space) {
			indent++;
		} else if (chCode === CharCode.Tab) {
			indent = indent - indent % tabSize + tabSize;
		} else {
			break;
		}
		i++;
	}

	if (i === len) {
		return ~indent;
	}

	return indent;
}

export function computeIndentLevel2(line: string, tabSize: number): number {
	const result = computeIndentLevel(line, tabSize);
	if (result < 0) {
		return Math.floor(~result / tabSize);
	}
	return Math.floor(result / tabSize);
}

function nextIndentTabStop(visibleColumn: number, indentSize: number): number {
	return visibleColumn + indentSize - visibleColumn % indentSize;
}

function _normalizeIndentationFromWhitespace(str: string, indentSize: number, insertSpaces: boolean): string {
	let spacesCnt = 0;
	for (let i = 0; i < str.length; i++) {
		if (str.charAt(i) === '\t') {
			spacesCnt = nextIndentTabStop(spacesCnt, indentSize);
		} else {
			spacesCnt++;
		}
	}

	let result = '';
	if (!insertSpaces) {
		const tabsCnt = Math.floor(spacesCnt / indentSize);
		spacesCnt = spacesCnt % indentSize;
		for (let i = 0; i < tabsCnt; i++) {
			result += '\t';
		}
	}

	for (let i = 0; i < spacesCnt; i++) {
		result += ' ';
	}

	return result;
}

export function normalizeIndentation(str: string, indentSize: number, insertSpaces: boolean): string {
	let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(str);
	if (firstNonWhitespaceIndex === -1) {
		firstNonWhitespaceIndex = str.length;
	}
	return _normalizeIndentationFromWhitespace(str.substring(0, firstNonWhitespaceIndex), indentSize, insertSpaces) + str.substring(firstNonWhitespaceIndex);
}

export function getIndentationChar(indentation: IGuessedIndentation): string {
	if (indentation.insertSpaces) {
		return ' '.repeat(indentation.tabSize);
	} else {
		return '\t';
	}
}

export function transformIndentation(content: string, fromIndent: IGuessedIndentation, toIndent: IGuessedIndentation): string {
	if (fromIndent.insertSpaces === toIndent.insertSpaces && fromIndent.tabSize === toIndent.tabSize) {
		return content;
	}

	const fromChr = getIndentationChar(fromIndent);
	const toChr = getIndentationChar(toIndent);

	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		let k = 0;
		while (lines[i].slice(k, k + fromChr.length) === fromChr) {
			k += fromChr.length;
		}

		lines[i] = toChr.repeat(k / fromChr.length) + lines[i].slice(k);
	}

	return lines.join('\n');
}
