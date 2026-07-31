/**
 * Dardcor Code - Editor Context State Accessor for Cursor Operations (Task 251)
 * Mirrors: vs/editor/common/controller/cursor.ts (CursorContext)
 */

import { ITextModel } from '../model/text-model.js';
import { Position } from '../model/text-model.js';
import { CursorColumn } from './cursor-column.js';
import { EndOfLineSequence } from '../model/line-ending.js';

export interface ICursorContext {
	readonly model: ITextModel;
	readonly tabSize: number;
	readonly lineEnding: EndOfLineSequence;
	getLineContent(lineNumber: number): string;
	getLineMaxColumn(lineNumber: number): number;
	getLineMinColumn(): number;
	getLineCount(): number;
	normalizeColumn(lineNumber: number, column: number): number;
	isAtLineStart(position: Position): boolean;
	isAtLineEnd(position: Position): boolean;
	isEmptyLine(lineNumber: number): boolean;
	getEOL(): string;
}

export class CursorContext implements ICursorContext {
	public readonly tabSize: number;
	public readonly lineEnding: EndOfLineSequence;

	constructor(
		public readonly model: ITextModel,
		tabSize = 4,
		lineEnding: EndOfLineSequence = 'LF'
	) {
		this.tabSize = Math.max(1, tabSize);
		this.lineEnding = lineEnding;
	}

	public getLineContent(lineNumber: number): string {
		return this.model.getLineContent(lineNumber);
	}

	public getLineMaxColumn(lineNumber: number): number {
		const line = this.model.getLineContent(lineNumber);
		return CursorColumn.getMaxColumn(line, this.tabSize);
	}

	public getLineMinColumn(): number {
		return 1;
	}

	public getLineCount(): number {
		return this.model.getLineCount();
	}

	public normalizeColumn(lineNumber: number, column: number): number {
		const line = this.model.getLineContent(lineNumber);
		return CursorColumn.normalizeColumn(line, column, this.tabSize);
	}

	public isAtLineStart(position: Position): boolean {
		return position.column <= 1;
	}

	public isAtLineEnd(position: Position): boolean {
		return position.column >= this.getLineMaxColumn(position.lineNumber);
	}

	public isEmptyLine(lineNumber: number): boolean {
		return this.model.getLineContent(lineNumber).length === 0;
	}

	public getEOL(): string {
		return this.lineEnding === 'CRLF' ? '\r\n' : '\n';
	}
}
