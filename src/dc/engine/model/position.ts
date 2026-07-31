import { IPosition, Position as BasePosition } from './text-model';

export type { IPosition } from './text-model';

export class Position extends BasePosition {
	static isIPosition(thing: unknown): thing is IPosition {
		if (!thing || typeof thing !== 'object') {
			return false;
		}
		const candidate = thing as IPosition;
		return typeof candidate.lineNumber === 'number' && typeof candidate.column === 'number';
	}

	static isPosition(thing: unknown): thing is IPosition {
		return Position.isIPosition(thing);
	}

	static min(...positions: IPosition[]): Position {
		let result = positions[0];
		for (let i = 1; i < positions.length; i++) {
			if (Position.compare(positions[i], result) < 0) {
				result = positions[i];
			}
		}
		return Position.lift(result);
	}

	static max(...positions: IPosition[]): Position {
		let result = positions[0];
		for (let i = 1; i < positions.length; i++) {
			if (Position.compare(positions[i], result) > 0) {
				result = positions[i];
			}
		}
		return Position.lift(result);
	}

	static lift(pos: IPosition): Position {
		if (pos instanceof Position) {
			return pos;
		}
		return new Position(pos.lineNumber, pos.column);
	}

	static isBefore(a: IPosition, b: IPosition): boolean {
		return Position.compare(a, b) < 0;
	}

	static isBeforeOrEqual(a: IPosition, b: IPosition): boolean {
		return Position.compare(a, b) <= 0;
	}

	static isAfter(a: IPosition, b: IPosition): boolean {
		return Position.compare(a, b) > 0;
	}

	static isAfterOrEqual(a: IPosition, b: IPosition): boolean {
		return Position.compare(a, b) >= 0;
	}

	static equals(a: IPosition, b: IPosition): boolean {
		return a.lineNumber === b.lineNumber && a.column === b.column;
	}

	static compare(a: IPosition, b: IPosition): number {
		if (a.lineNumber !== b.lineNumber) {
			return a.lineNumber - b.lineNumber;
		}
		return a.column - b.column;
	}

	static clone(p: IPosition): Position {
		return new Position(p.lineNumber, p.column);
	}

	static delta(p: IPosition, deltaLineNumber: number, deltaColumn: number): Position {
		return new Position(p.lineNumber + deltaLineNumber, p.column + deltaColumn);
	}

	static toString(p: IPosition): string {
		return `(${p.lineNumber},${p.column})`;
	}

	override toString(): string {
		return Position.toString(this);
	}

	equals(other: IPosition): boolean {
		return Position.equals(this, other);
	}

	isBefore(other: IPosition): boolean {
		return Position.isBefore(this, other);
	}

	isBeforeOrEqual(other: IPosition): boolean {
		return Position.isBeforeOrEqual(this, other);
	}

	isAfter(other: IPosition): boolean {
		return Position.isAfter(this, other);
	}

	isAfterOrEqual(other: IPosition): boolean {
		return Position.isAfterOrEqual(this, other);
	}

	compare(other: IPosition): number {
		return Position.compare(this, other);
	}

	delta(deltaLineNumber: number, deltaColumn: number): Position {
		return Position.delta(this, deltaLineNumber, deltaColumn);
	}

	clone(): Position {
		return Position.clone(this);
	}

	with(column?: number, lineNumber?: number): Position {
		return new Position(lineNumber ?? this.lineNumber, column ?? this.column);
	}

	toIPosition(): IPosition {
		return { lineNumber: this.lineNumber, column: this.column };
	}
}
