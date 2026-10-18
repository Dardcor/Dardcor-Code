
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPosition {
	readonly lineNumber: number;
	readonly column: number;
}

export class Position {
	public readonly lineNumber: number;
	public readonly column: number;

	constructor(lineNumber: number, column: number) {
		this.lineNumber = lineNumber;
		this.column = column;
	}

	with(newLineNumber: number = this.lineNumber, newColumn: number = this.column): Position {
		if (newLineNumber === this.lineNumber && newColumn === this.column) {
			return this;
		} else {
			return new Position(newLineNumber, newColumn);
		}
	}

	delta(deltaLineNumber: number = 0, deltaColumn: number = 0): Position {
		return this.with(Math.max(1, this.lineNumber + deltaLineNumber), Math.max(1, this.column + deltaColumn));
	}

	public equals(other: IPosition): boolean {
		return Position.equals(this, other);
	}

	public static equals(a: IPosition | null, b: IPosition | null): boolean {
		if (!a && !b) {
			return true;
		}
		return (
			!!a &&
			!!b &&
			a.lineNumber === b.lineNumber &&
			a.column === b.column
		);
	}

	public isBefore(other: IPosition): boolean {
		return Position.isBefore(this, other);
	}

	public static isBefore(a: IPosition, b: IPosition): boolean {
		if (a.lineNumber < b.lineNumber) {
			return true;
		}
		if (b.lineNumber < a.lineNumber) {
			return false;
		}
		return a.column < b.column;
	}

	public isBeforeOrEqual(other: IPosition): boolean {
		return Position.isBeforeOrEqual(this, other);
	}

	public static isBeforeOrEqual(a: IPosition, b: IPosition): boolean {
		if (a.lineNumber < b.lineNumber) {
			return true;
		}
		if (b.lineNumber < a.lineNumber) {
			return false;
		}
		return a.column <= b.column;
	}

	public static compare(a: IPosition, b: IPosition): number {
		const aLineNumber = a.lineNumber | 0;
		const bLineNumber = b.lineNumber | 0;

		if (aLineNumber === bLineNumber) {
			const aColumn = a.column | 0;
			const bColumn = b.column | 0;
			return aColumn - bColumn;
		}

		return aLineNumber - bLineNumber;
	}

	public clone(): Position {
		return new Position(this.lineNumber, this.column);
	}

	public toString(): string {
		return '(' + this.lineNumber + ',' + this.column + ')';
	}


	public static lift(pos: IPosition): Position {
		return new Position(pos.lineNumber, pos.column);
	}

	public static isIPosition(obj: unknown): obj is IPosition {
		return (
			!!obj
			&& (typeof (obj as IPosition).lineNumber === 'number')
			&& (typeof (obj as IPosition).column === 'number')
		);
	}

	public toJSON(): IPosition {
		return {
			lineNumber: this.lineNumber,
			column: this.column
		};
	}
}
