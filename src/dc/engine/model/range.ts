import { IRange, Range as BaseRange } from './text-model.js';
import { Position } from './position.js';

export type { IRange } from './text-model.js';
export { Position };

export class Range extends BaseRange {
	static isIRange(thing: unknown): thing is IRange {
		if (!thing || typeof thing !== 'object') {
			return false;
		}
		const candidate = thing as IRange;
		return typeof candidate.startLineNumber === 'number'
			&& typeof candidate.startColumn === 'number'
			&& typeof candidate.endLineNumber === 'number'
			&& typeof candidate.endColumn === 'number';
	}

	static lift(range: IRange): Range {
		if (range instanceof Range) {
			return range;
		}
		return new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
	}

	static fromPositions(start: { lineNumber: number; column: number }, end: { lineNumber: number; column: number }): Range {
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	static containsRange(range: IRange, other: IRange): boolean {
		return Range.startPosition(range).isBeforeOrEqual(Range.startPosition(other))
			&& Range.endPosition(other).isBeforeOrEqual(Range.endPosition(range));
	}

	static areIntersecting(a: IRange, b: IRange): boolean {
		if (a.endLineNumber < b.startLineNumber || b.endLineNumber < a.startLineNumber) {
			return false;
		}
		if (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) {
			return false;
		}
		if (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn) {
			return false;
		}
		return true;
	}

	static areAdjacent(a: IRange, b: IRange): boolean {
		const aEnd = Range.endPosition(a);
		const bStart = Range.startPosition(b);
		if (Position.equals(aEnd, bStart)) {
			return true;
		}
		const bEnd = Range.endPosition(b);
		const aStart = Range.startPosition(a);
		return Position.equals(bEnd, aStart);
	}

	static collapseToStart(range: IRange): Range {
		return new Range(range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn);
	}

	static collapseToEnd(range: IRange): Range {
		return new Range(range.endLineNumber, range.endColumn, range.endLineNumber, range.endColumn);
	}

	static isEmpty(range: IRange): boolean {
		return range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
	}

	static equals(a: IRange, b: IRange): boolean {
		return a.startLineNumber === b.startLineNumber
			&& a.startColumn === b.startColumn
			&& a.endLineNumber === b.endLineNumber
			&& a.endColumn === b.endColumn;
	}

	static startPosition(range: IRange): Position {
		return new Position(range.startLineNumber, range.startColumn);
	}

	static endPosition(range: IRange): Position {
		return new Position(range.endLineNumber, range.endColumn);
	}

	static plusRange(a: IRange, b: IRange): Range {
		const aStart = Range.startPosition(a);
		const bStart = Range.startPosition(b);
		const aEnd = Range.endPosition(a);
		const bEnd = Range.endPosition(b);
		const start = Position.isBeforeOrEqual(aStart, bStart) ? aStart : bStart;
		const end = Position.isAfterOrEqual(aEnd, bEnd) ? aEnd : bEnd;
		return Range.fromPositions(start, end);
	}

	static containsPosition(range: IRange, position: { lineNumber: number; column: number }): boolean {
		const start = Range.startPosition(range);
		const end = Range.endPosition(range);
		return Position.isBeforeOrEqual(start, position) && Position.isBeforeOrEqual(position, end);
	}

	static toString(range: IRange): string {
		return `[${range.startLineNumber},${range.startColumn} -> ${range.endLineNumber},${range.endColumn}]`;
	}

	override toString(): string {
		return Range.toString(this);
	}

	get isEmpty(): boolean {
		return Range.isEmpty(this);
	}

	get start(): Position {
		return Range.startPosition(this);
	}

	get end(): Position {
		return Range.endPosition(this);
	}

	containsPosition(position: { lineNumber: number; column: number }): boolean {
		return Range.containsPosition(this, position);
	}

	containsRange(other: IRange): boolean {
		return Range.containsRange(this, other);
	}

	areAdjacent(other: IRange): boolean {
		return Range.areAdjacent(this, other);
	}

	collapseToStart(): Range {
		return Range.collapseToStart(this);
	}

	collapseToEnd(): Range {
		return Range.collapseToEnd(this);
	}

	plusRange(other: IRange): Range {
		return Range.plusRange(this, other);
	}

	toIRange(): IRange {
		return { startLineNumber: this.startLineNumber, startColumn: this.startColumn, endLineNumber: this.endLineNumber, endColumn: this.endColumn };
	}
}
