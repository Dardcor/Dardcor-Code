/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPosition, Position } from './position.js';
import { Range } from './range.js';

export interface ISelection {
	readonly selectionStartLineNumber: number;
	readonly selectionStartColumn: number;
	readonly positionLineNumber: number;
	readonly positionColumn: number;
}

export const enum SelectionDirection {
	LTR,
	RTL
}

export class Selection extends Range {
	public readonly selectionStartLineNumber: number;
	public readonly selectionStartColumn: number;
	public readonly positionLineNumber: number;
	public readonly positionColumn: number;

	constructor(selectionStartLineNumber: number, selectionStartColumn: number, positionLineNumber: number, positionColumn: number) {
		super(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn);
		this.selectionStartLineNumber = selectionStartLineNumber;
		this.selectionStartColumn = selectionStartColumn;
		this.positionLineNumber = positionLineNumber;
		this.positionColumn = positionColumn;
	}

	public override toString(): string {
		return '[' + this.selectionStartLineNumber + ',' + this.selectionStartColumn + ' -> ' + this.positionLineNumber + ',' + this.positionColumn + ']';
	}

	public equalsSelection(other: ISelection): boolean {
		return (
			Selection.selectionsEqual(this, other)
		);
	}

	public static selectionsEqual(a: ISelection, b: ISelection): boolean {
		return (
			a.selectionStartLineNumber === b.selectionStartLineNumber &&
			a.selectionStartColumn === b.selectionStartColumn &&
			a.positionLineNumber === b.positionLineNumber &&
			a.positionColumn === b.positionColumn
		);
	}

	public getDirection(): SelectionDirection {
		if (this.selectionStartLineNumber === this.startLineNumber && this.selectionStartColumn === this.startColumn) {
			return SelectionDirection.LTR;
		}
		return SelectionDirection.RTL;
	}

	public override setEndPosition(endLineNumber: number, endColumn: number): Selection {
		if (this.getDirection() === SelectionDirection.LTR) {
			return new Selection(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
		}
		return new Selection(endLineNumber, endColumn, this.startLineNumber, this.startColumn);
	}

	public getPosition(): Position {
		return new Position(this.positionLineNumber, this.positionColumn);
	}

	public getSelectionStart(): Position {
		return new Position(this.selectionStartLineNumber, this.selectionStartColumn);
	}

	public override setStartPosition(startLineNumber: number, startColumn: number): Selection {
		if (this.getDirection() === SelectionDirection.LTR) {
			return new Selection(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
		}
		return new Selection(this.endLineNumber, this.endColumn, startLineNumber, startColumn);
	}


	public static override fromPositions(start: IPosition, end: IPosition = start): Selection {
		return new Selection(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	public static fromRange(range: Range, direction: SelectionDirection): Selection {
		if (direction === SelectionDirection.LTR) {
			return new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
		} else {
			return new Selection(range.endLineNumber, range.endColumn, range.startLineNumber, range.startColumn);
		}
	}

	public static liftSelection(sel: ISelection): Selection {
		return new Selection(sel.selectionStartLineNumber, sel.selectionStartColumn, sel.positionLineNumber, sel.positionColumn);
	}

	public static selectionsArrEqual(a: ISelection[], b: ISelection[]): boolean {
		if (a && !b || !a && b) {
			return false;
		}
		if (!a && !b) {
			return true;
		}
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0, len = a.length; i < len; i++) {
			if (!this.selectionsEqual(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}

	public static isISelection(obj: unknown): obj is ISelection {
		return (
			!!obj
			&& (typeof (obj as ISelection).selectionStartLineNumber === 'number')
			&& (typeof (obj as ISelection).selectionStartColumn === 'number')
			&& (typeof (obj as ISelection).positionLineNumber === 'number')
			&& (typeof (obj as ISelection).positionColumn === 'number')
		);
	}

	public static createWithDirection(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, direction: SelectionDirection): Selection {

		if (direction === SelectionDirection.LTR) {
			return new Selection(startLineNumber, startColumn, endLineNumber, endColumn);
		}

		return new Selection(endLineNumber, endColumn, startLineNumber, startColumn);
	}
}
