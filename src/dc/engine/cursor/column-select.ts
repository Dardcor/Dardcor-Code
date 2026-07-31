/**
 * Dardcor Code - Rectangular Box Selection Controller (Task 257)
 * Mirrors: vs/editor/contrib/columnSelection/columnSelection.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Range } from '../model/text-model';

export interface IBoxSelection {
	readonly anchorLineNumber: number;
	readonly anchorColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface IColumnSelectPosition {
	readonly lineNumber: number;
	readonly column: number;
}

export interface IColumnSelectCallbacks {
	getPositionFromPoint(x: number, y: number): IColumnSelectPosition | null;
	setSelection(selection: Range): void;
}

export class ColumnSelectController extends Disposable {
	private _anchor: IColumnSelectPosition | null = null;
	private _end: IColumnSelectPosition | null = null;
	private _isActive = false;

	constructor(private readonly _callbacks: IColumnSelectCallbacks) {
		super();
	}

	public begin(x: number, y: number): boolean {
		const position = this._callbacks.getPositionFromPoint(x, y);
		if (!position) {
			return false;
		}
		this._anchor = { ...position };
		this._end = { ...position };
		this._isActive = true;
		this._updateSelection();
		return true;
	}

	public update(x: number, y: number): void {
		if (!this._isActive || !this._anchor) {
			return;
		}
		const position = this._callbacks.getPositionFromPoint(x, y);
		if (!position) {
			return;
		}
		this._end = { ...position };
		this._updateSelection();
	}

	public end(): void {
		this._isActive = false;
	}

	public isActive(): boolean {
		return this._isActive;
	}

	public getSelection(): IBoxSelection | null {
		if (!this._anchor || !this._end) {
			return null;
		}
		return {
			anchorLineNumber: this._anchor.lineNumber,
			anchorColumn: this._anchor.column,
			endLineNumber: this._end.lineNumber,
			endColumn: this._end.column,
		};
	}

	public static toRectangularSelections(box: IBoxSelection): Range[] {
		const startLine = Math.min(box.anchorLineNumber, box.endLineNumber);
		const endLine = Math.max(box.anchorLineNumber, box.endLineNumber);
		const startColumn = Math.min(box.anchorColumn, box.endColumn);
		const endColumn = Math.max(box.anchorColumn, box.endColumn);
		const selections: Range[] = [];
		for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
			selections.push(new Range(lineNumber, startColumn, lineNumber, endColumn));
		}
		return selections;
	}

	public static expandToColumn(line: string, column: number): number {
		if (column <= 1) {
			return 1;
		}
		return Math.min(column, line.length + 1);
	}

	private _updateSelection(): void {
		if (!this._anchor || !this._end) {
			return;
		}
		const startLine = Math.min(this._anchor.lineNumber, this._end.lineNumber);
		const endLine = Math.max(this._anchor.lineNumber, this._end.lineNumber);
		const startColumn = Math.min(this._anchor.column, this._end.column);
		const endColumn = Math.max(this._anchor.column, this._end.column);
		this._callbacks.setSelection(new Range(startLine, startColumn, endLine, endColumn));
	}

	public override dispose(): void {
		this._anchor = null;
		this._end = null;
		this._isActive = false;
		super.dispose();
	}
}
