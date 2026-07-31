/**
 * Dardcor Code - Raw Character Array Text Accessor (Task 240)
 * Mirrors: vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.ts
 */

import { IPosition, IRange, Position, Range } from './text-model';
import { escapeRegExpCharacters } from '../../core/types/strings';

export interface ITextBufferSearchResult {
	readonly range: Range;
	readonly matchText: string;
}

export class TextBuffer {
	private readonly _content: string;
	private readonly _lineStarts: number[];

	constructor(text: string) {
		this._content = text;
		this._lineStarts = [0];
		for (let i = 0; i < text.length; i++) {
			const ch = text.charCodeAt(i);
			if (ch === 10 /* \n */) {
				this._lineStarts.push(i + 1);
			}
		}
	}

	public static fromString(text: string): TextBuffer {
		return new TextBuffer(text);
	}

	public getValue(): string {
		return this._content;
	}

	public getLength(): number {
		return this._content.length;
	}

	public getLineCount(): number {
		return this._lineStarts.length;
	}

	public getLineStartOffset(lineNumber: number): number {
		const index = Math.max(0, Math.min(this._lineStarts.length - 1, lineNumber - 1));
		return this._lineStarts[index];
	}

	public getLineEndOffset(lineNumber: number): number {
		if (lineNumber >= this._lineStarts.length) {
			return this._content.length;
		}
		return this._lineStarts[lineNumber] - 1;
	}

	public getLineContent(lineNumber: number): string {
		const start = this.getLineStartOffset(lineNumber);
		const end = this.getLineEndOffset(lineNumber);
		return this._content.substring(start, end);
	}

	public getCharAt(offset: number): string {
		if (offset < 0 || offset >= this._content.length) {
			return '';
		}
		return this._content.charAt(offset);
	}

	public getTextAt(offset: number, length: number): string {
		return this._content.substring(offset, offset + length);
	}

	public getOffsetAt(position: IPosition): number {
		const lineStart = this.getLineStartOffset(position.lineNumber);
		return lineStart + (position.column - 1);
	}

	public getPositionAt(offset: number): Position {
		let low = 0;
		let high = this._lineStarts.length - 1;
		let lineIndex = 0;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (this._lineStarts[mid] <= offset) {
				lineIndex = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		return new Position(lineIndex + 1, offset - this._lineStarts[lineIndex] + 1);
	}

	public getRangeAt(offset: number, length: number): Range {
		const start = this.getPositionAt(offset);
		const end = this.getPositionAt(offset + length);
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	public getTextInRange(range: IRange): string {
		const startOffset = this.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
		const endOffset = this.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
		return this._content.substring(startOffset, endOffset);
	}

	public searchRegex(searchRegex: RegExp, fromOffset: number, limit = Number.MAX_SAFE_INTEGER): ITextBufferSearchResult[] {
		searchRegex.lastIndex = fromOffset;
		const results: ITextBufferSearchResult[] = [];
		let match: RegExpExecArray | null;
		while (results.length < limit && (match = searchRegex.exec(this._content)) !== null) {
			if (match.index < fromOffset) {
				searchRegex.lastIndex = fromOffset;
				continue;
			}
			results.push({
				range: this.getRangeAt(match.index, match[0].length),
				matchText: match[0],
			});
			if (match[0].length === 0) {
				searchRegex.lastIndex++;
			}
		}
		return results;
	}

	public static createSearchRegex(searchString: string, caseSensitive: boolean, wholeWord: boolean, isRegex: boolean): RegExp {
		let source = isRegex ? searchString : escapeRegExpCharacters(searchString);
		if (wholeWord) {
			source = `\\b${source}\\b`;
		}
		return new RegExp(source, caseSensitive ? 'g' : 'gi');
	}
}
