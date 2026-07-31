/**
 * Dardcor Code - Line/Column to Offset Index Mapping (Task 248)
 * Mirrors: vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.ts (offset conversion)
 */

import { Position } from './text-model.js';

export interface IOffsetPosition {
	readonly lineNumber: number;
	readonly column: number;
}

export class PositionConverter {
	private readonly _lineStarts: number[];

	constructor(
		lineStarts: number[],
		private readonly _totalLength: number
	) {
		this._lineStarts = lineStarts;
	}

	public static forText(text: string): PositionConverter {
		const lineStarts = [0];
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) === 10 /* \n */) {
				lineStarts.push(i + 1);
			}
		}
		return new PositionConverter(lineStarts, text.length);
	}

	public getLineCount(): number {
		return this._lineStarts.length;
	}

	public getTotalLength(): number {
		return this._totalLength;
	}

	public getLineStartOffset(lineNumber: number): number {
		return this._lineStarts[Math.max(1, Math.min(this._lineStarts.length, lineNumber)) - 1];
	}

	public getLineEndOffset(lineNumber: number): number {
		if (lineNumber >= this._lineStarts.length) {
			return this._totalLength;
		}
		return this._lineStarts[lineNumber] - 1;
	}

	public getLineLength(lineNumber: number): number {
		return this.getLineEndOffset(lineNumber) - this.getLineStartOffset(lineNumber);
	}

	public positionToOffset(position: IOffsetPosition): number {
		const lineStart = this.getLineStartOffset(position.lineNumber);
		return Math.max(0, Math.min(this._totalLength, lineStart + (position.column - 1)));
	}

	public offsetToPosition(offset: number): Position {
		const clamped = Math.max(0, Math.min(this._totalLength, offset));
		let low = 0;
		let high = this._lineStarts.length - 1;
		let lineIndex = 0;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (this._lineStarts[mid] <= clamped) {
				lineIndex = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		return new Position(lineIndex + 1, clamped - this._lineStarts[lineIndex] + 1);
	}

	public getOffsetRange(start: IOffsetPosition, end: IOffsetPosition): { startOffset: number; endOffset: number } {
		return {
			startOffset: this.positionToOffset(start),
			endOffset: this.positionToOffset(end),
		};
	}

	public getLineOffsets(lineNumber: number): { start: number; end: number } {
		return {
			start: this.getLineStartOffset(lineNumber),
			end: this.getLineEndOffset(lineNumber),
		};
	}

	public static readonly Empty: PositionConverter = new PositionConverter([0], 0);
}
