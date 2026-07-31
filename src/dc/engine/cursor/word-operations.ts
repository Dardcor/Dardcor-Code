/**
 * Dardcor Code - Word Deletion & Casing Transform Actions (Task 244)
 * Mirrors: vs/editor/contrib/codeAction/codeAction.ts (transform) & cursorDeleteOperations.ts
 */

import { getWordAtPosition } from '../model/word-helper';

export const enum WordTransform {
	UpperCase = 0,
	LowerCase = 1,
	TitleCase = 2,
	Capitalize = 3,
	SnakeCase = 4,
}

export interface IWordDeleteResult {
	readonly text: string;
	readonly startOffset: number;
	readonly endOffset: number;
}

export class WordOperations {
	public static deleteWordLeft(line: string, column: number): IWordDeleteResult {
		const offset = column - 1;
		if (offset <= 0) {
			return { text: '', startOffset: 0, endOffset: offset };
		}
		let index = offset - 1;
		if (index >= 0 && this._isWhitespace(line.charCodeAt(index))) {
			while (index >= 0 && this._isWhitespace(line.charCodeAt(index))) {
				index--;
			}
		} else if (index >= 0 && this._isWordChar(line.charCodeAt(index))) {
			while (index >= 0 && this._isWordChar(line.charCodeAt(index))) {
				index--;
			}
		} else {
			index--;
		}
		const start = index + 1;
		return {
			text: line.substring(start, offset),
			startOffset: start,
			endOffset: offset,
		};
	}

	public static deleteWordRight(line: string, column: number): IWordDeleteResult {
		const offset = column - 1;
		if (offset >= line.length) {
			return { text: '', startOffset: offset, endOffset: offset };
		}
		let index = offset;
		if (this._isWhitespace(line.charCodeAt(index))) {
			while (index < line.length && this._isWhitespace(line.charCodeAt(index))) {
				index++;
			}
		} else if (this._isWordChar(line.charCodeAt(index))) {
			while (index < line.length && this._isWordChar(line.charCodeAt(index))) {
				index++;
			}
		} else {
			index++;
		}
		return {
			text: line.substring(offset, index),
			startOffset: offset,
			endOffset: index,
		};
	}

	public static transformWord(line: string, column: number, transform: WordTransform): IWordDeleteResult {
		const word = getWordAtPosition(line, column);
		if (!word) {
			return { text: '', startOffset: column - 1, endOffset: column - 1 };
		}
		const startOffset = word.startColumn - 1;
		const endOffset = word.endColumn - 1;
		const original = line.substring(startOffset, endOffset);
		let transformed = original;
		switch (transform) {
			case WordTransform.UpperCase:
				transformed = original.toUpperCase();
				break;
			case WordTransform.LowerCase:
				transformed = original.toLowerCase();
				break;
			case WordTransform.TitleCase:
				transformed = original.replace(/\b\w/g, (ch) => ch.toUpperCase());
				break;
			case WordTransform.Capitalize:
				transformed = original.length > 0 ? original.charAt(0).toUpperCase() + original.substring(1).toLowerCase() : original;
				break;
			case WordTransform.SnakeCase:
				transformed = original.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
				break;
		}
		return {
			text: transformed,
			startOffset,
			endOffset,
		};
	}

	public static transformToUpper(line: string, column: number): IWordDeleteResult {
		return WordOperations.transformWord(line, column, WordTransform.UpperCase);
	}

	public static transformToLower(line: string, column: number): IWordDeleteResult {
		return WordOperations.transformWord(line, column, WordTransform.LowerCase);
	}

	public static transformToTitleCase(line: string, column: number): IWordDeleteResult {
		return WordOperations.transformWord(line, column, WordTransform.TitleCase);
	}

	public static transformToSnakeCase(line: string, column: number): IWordDeleteResult {
		return WordOperations.transformWord(line, column, WordTransform.SnakeCase);
	}

	private static _isWhitespace(code: number): boolean {
		return code === 32 /* space */ || code === 9 /* tab */;
	}

	private static _isWordChar(code: number): boolean {
		return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
	}
}
