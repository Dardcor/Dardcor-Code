/**
 * Dardcor Code - Cursor Movement & Selection Operations (Task 219)
 * Mirrors: vs/editor/common/cursor/cursorMoveOperations.ts
 */

import { ITextModel, Position } from '../model/text-model';
import { getWordAtPosition, IWordAtPosition } from '../model/word-helper';

export const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

export function isWordChar(ch: string): boolean {
	return ch.length > 0 && WORD_SEPARATORS.indexOf(ch) === -1 && !/\s/.test(ch);
}

export function comparePositions(a: Position, b: Position): number {
	if (a.lineNumber !== b.lineNumber) {
		return a.lineNumber - b.lineNumber;
	}
	return a.column - b.column;
}

export function positionsEqual(a: Position, b: Position): boolean {
	return a.lineNumber === b.lineNumber && a.column === b.column;
}

export function clampPositionToModel(model: ITextModel, position: Position): Position {
	const lineCount = model.getLineCount();
	const lineNumber = Math.max(1, Math.min(position.lineNumber, lineCount));
	const lineLength = model.getLineContent(lineNumber).length;
	return new Position(lineNumber, Math.max(1, Math.min(position.column, lineLength + 1)));
}

export function getLineStart(model: ITextModel, lineNumber: number): Position {
	return new Position(lineNumber, 1);
}

export function getLineEnd(model: ITextModel, lineNumber: number): Position {
	return new Position(lineNumber, model.getLineContent(lineNumber).length + 1);
}

/**
 * A cursor with an anchor; when anchor !== active the cursor holds a selection.
 */
export class CursorSelection {
	constructor(
		public readonly anchor: Position,
		public readonly active: Position
	) {}

	static collapse(position: Position): CursorSelection {
		return new CursorSelection(position, position);
	}

	static fromPositions(anchor: Position, active: Position): CursorSelection {
		return new CursorSelection(anchor, active);
	}

	get start(): Position {
		return comparePositions(this.anchor, this.active) <= 0 ? this.anchor : this.active;
	}

	get end(): Position {
		return comparePositions(this.anchor, this.active) <= 0 ? this.active : this.anchor;
	}

	get isSelection(): boolean {
		return !positionsEqual(this.anchor, this.active);
	}

	get isDirectionLTR(): boolean {
		return comparePositions(this.anchor, this.active) <= 0;
	}

	equals(other: CursorSelection): boolean {
		return positionsEqual(this.anchor, other.anchor) && positionsEqual(this.active, other.active);
	}

	toString(): string {
		return `[${this.start.lineNumber},${this.start.column} -> ${this.end.lineNumber},${this.end.column}]`;
	}
}

export interface IColumnContext {
	readonly model?: ITextModel;
	readonly desiredColumn?: number;
}

function columnForVerticalMove(ctx: IColumnContext, lineNumber: number): number {
	const desired = ctx.desiredColumn ?? undefined;
	const lineLength = ctx.model ? ctx.model.getLineContent(lineNumber).length : 1;
	if (desired !== undefined) {
		return Math.min(desired, lineLength + 1);
	}
	return lineLength + 1;
}


export class CursorOperations {
	static moveCharacterLeft(model: ITextModel, position: Position): Position {
		if (position.column > 1) {
			return new Position(position.lineNumber, position.column - 1);
		}
		if (position.lineNumber > 1) {
			return getLineEnd(model, position.lineNumber - 1);
		}
		return position;
	}

	static moveCharacterRight(model: ITextModel, position: Position): Position {
		if (position.column <= model.getLineContent(position.lineNumber).length) {
			return new Position(position.lineNumber, position.column + 1);
		}
		if (position.lineNumber < model.getLineCount()) {
			return new Position(position.lineNumber + 1, 1);
		}
		return position;
	}

	static moveWordLeft(model: ITextModel, position: Position): Position {
		let lineNumber = position.lineNumber;
		let column = position.column;
		while (true) {
			if (column <= 1) {
				if (lineNumber === 1) {
					return new Position(1, 1);
				}
				lineNumber--;
				column = model.getLineContent(lineNumber).length + 1;
				continue;
			}
			const line = model.getLineContent(lineNumber);
			while (column > 1 && !isWordChar(line.charAt(column - 2))) {
				column--;
			}
			while (column > 1 && isWordChar(line.charAt(column - 2))) {
				column--;
			}
			return new Position(lineNumber, column);
		}
	}

	static moveWordRight(model: ITextModel, position: Position): Position {
		let lineNumber = position.lineNumber;
		let column = position.column;
		while (true) {
			const line = model.getLineContent(lineNumber);
			if (column > line.length) {
				if (lineNumber === model.getLineCount()) {
					return new Position(lineNumber, line.length + 1);
				}
				lineNumber++;
				column = 1;
				continue;
			}
			while (column <= line.length && isWordChar(line.charAt(column - 1))) {
				column++;
			}
			while (column <= line.length && !isWordChar(line.charAt(column - 1))) {
				column++;
			}
			return new Position(lineNumber, column);
		}
	}

	static moveToLineStart(model: ITextModel, position: Position): Position {
		const line = model.getLineContent(position.lineNumber);
		const firstNonWs = line.search(/\S/);
		const firstNonWsColumn = firstNonWs === -1 ? line.length + 1 : firstNonWs + 1;
		if (position.column > firstNonWsColumn) {
			return new Position(position.lineNumber, firstNonWsColumn);
		}
		return new Position(position.lineNumber, 1);
	}

	static moveToLineEnd(model: ITextModel, position: Position): Position {
		return getLineEnd(model, position.lineNumber);
	}

	static moveVertically(model: ITextModel, position: Position, deltaLines: number, ctx: IColumnContext = {}): Position {
		const targetLine = Math.max(1, Math.min(position.lineNumber + deltaLines, model.getLineCount()));
		return new Position(targetLine, columnForVerticalMove(ctx, targetLine));
	}

	static moveToTop(model: ITextModel, ctx: IColumnContext = {}): Position {
		return new Position(1, columnForVerticalMove(ctx, 1));
	}

	static moveToBottom(model: ITextModel, ctx: IColumnContext = {}): Position {
		return new Position(model.getLineCount(), columnForVerticalMove(ctx, model.getLineCount()));
	}

	static movePageUp(model: ITextModel, position: Position, linesInViewport: number, ctx: IColumnContext = {}): Position {
		return this.moveVertically(model, position, -Math.max(1, linesInViewport), ctx);
	}

	static movePageDown(model: ITextModel, position: Position, linesInViewport: number, ctx: IColumnContext = {}): Position {
		return this.moveVertically(model, position, Math.max(1, linesInViewport), ctx);
	}

	static getWordAt(model: ITextModel, position: Position, wordDefinition?: RegExp): IWordAtPosition | null {
		const lineContent = model.getLineContent(position.lineNumber);
		return getWordAtPosition(lineContent, position.column, wordDefinition);
	}

	static selectWord(model: ITextModel, position: Position, wordDefinition?: RegExp): CursorSelection {
		const word = this.getWordAt(model, position, wordDefinition);
		if (!word) {
			return CursorSelection.collapse(position);
		}
		const start = new Position(position.lineNumber, word.startColumn);
		const end = new Position(position.lineNumber, word.endColumn);
		return CursorSelection.fromPositions(start, end);
	}

	static selectLine(model: ITextModel, position: Position): CursorSelection {
		return CursorSelection.fromPositions(getLineStart(model, position.lineNumber), getLineEnd(model, position.lineNumber));
	}

	static selectAll(model: ITextModel): CursorSelection {
		const lastLine = model.getLineCount();
		return CursorSelection.fromPositions(
			new Position(1, 1),
			lastLine === 0 ? new Position(1, 1) : new Position(lastLine, model.getLineContent(lastLine).length + 1)
		);
	}

	/**
	 * Computes the position a marker moves to when `range` is replaced by `newText`.
	 */
	static adjustPositionForEdit(position: Position, range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }, newText: string): Position {
		const start = new Position(range.startLineNumber, range.startColumn);
		const end = new Position(range.endLineNumber, range.endColumn);
		const cmpStart = comparePositions(position, start);
		if (cmpStart <= 0) {
			return position;
		}
		const sameLineEdit = range.startLineNumber === range.endLineNumber;
		if (position.lineNumber === end.lineNumber && position.column >= end.column) {
			if (sameLineEdit) {
				return new Position(position.lineNumber, position.column + newText.length - (end.column - start.column));
			}
			const newTextLines = newText.split('\n');
			return new Position(
				start.lineNumber + newTextLines.length - 1,
				newTextLines[newTextLines.length - 1].length + (position.column - end.column) + 1
			);
		}
		if (position.lineNumber > end.lineNumber) {
			const newTextLines = newText.split('\n');
			const deltaLines = newTextLines.length - (end.lineNumber - start.lineNumber + 1);
			return new Position(position.lineNumber + deltaLines, position.column);
		}
		return start;
	}
}
