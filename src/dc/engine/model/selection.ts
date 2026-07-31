import { IRange, Position, Range } from './text-model';
import { Position as EditorPosition } from './position';
import { Range as EditorRange } from './range';

export interface ISelection extends IRange {
	readonly selectionStartLineNumber: number;
	readonly selectionStartColumn: number;
	readonly positionLineNumber: number;
	readonly positionColumn: number;
}

export class Selection extends EditorRange implements ISelection {
	constructor(
		startLineNumber: number,
		startColumn: number,
		endLineNumber: number,
		endColumn: number
	) {
		super(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	static isISelection(thing: unknown): thing is ISelection {
		if (!thing || typeof thing !== 'object') {
			return false;
		}
		const candidate = thing as ISelection;
		return EditorRange.isIRange(candidate)
			&& typeof candidate.selectionStartLineNumber === 'number'
			&& typeof candidate.selectionStartColumn === 'number'
			&& typeof candidate.positionLineNumber === 'number'
			&& typeof candidate.positionColumn === 'number';
	}

	static liftSelection(sel: ISelection): Selection {
		if (sel instanceof Selection) {
			return sel;
		}
		return new Selection(
			sel.selectionStartLineNumber,
			sel.selectionStartColumn,
			sel.positionLineNumber,
			sel.positionColumn
		);
	}

	static isBefore(a: Selection, b: Selection): boolean {
		const aStart = a.selectionStart;
		const bStart = b.selectionStart;
		const cmp = EditorPosition.compare(aStart, bStart);
		if (cmp !== 0) {
			return cmp < 0;
		}
		return EditorPosition.compare(a.position, b.position) < 0;
	}

	static isAfter(a: Selection, b: Selection): boolean {
		return Selection.isBefore(b, a);
	}

	static equals(a: Selection, b: Selection): boolean {
		return a.selectionStartLineNumber === b.selectionStartLineNumber
			&& a.selectionStartColumn === b.selectionStartColumn
			&& a.positionLineNumber === b.positionLineNumber
			&& a.positionColumn === b.positionColumn;
	}

	static isEmpty(sel: Selection): boolean {
		return sel.selectionStartLineNumber === sel.positionLineNumber
			&& sel.selectionStartColumn === sel.positionColumn;
	}

	static selectionDirection(sel: Selection): 'ltr' | 'rtl' {
		const start = EditorPosition.compare(sel.selectionStart, sel.position);
		return start <= 0 ? 'ltr' : 'rtl';
	}

	static createReversed(sel: Selection): Selection {
		return new Selection(
			sel.positionLineNumber,
			sel.positionColumn,
			sel.selectionStartLineNumber,
			sel.selectionStartColumn
		);
	}

	static fromPositions(start: EditorPosition, end: EditorPosition): Selection {
		return new Selection(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	static toString(sel: Selection): string {
		const start = EditorPosition.compare(sel.selectionStart, sel.position) <= 0 ? sel.selectionStart : sel.position;
		const end = EditorPosition.compare(sel.selectionStart, sel.position) <= 0 ? sel.position : sel.selectionStart;
		return `[${start.lineNumber},${start.column} -> ${end.lineNumber},${end.column}]`;
	}

	override toString(): string {
		return Selection.toString(this);
	}

	get selectionStartLineNumber(): number {
		return this.startLineNumber;
	}

	get selectionStartColumn(): number {
		return this.startColumn;
	}

	get positionLineNumber(): number {
		return this.endLineNumber;
	}

	get positionColumn(): number {
		return this.endColumn;
	}

	get selectionStart(): EditorPosition {
		return new EditorPosition(this.startLineNumber, this.startColumn);
	}

	get position(): EditorPosition {
		return new EditorPosition(this.endLineNumber, this.endColumn);
	}

	get anchor(): EditorPosition {
		return this.selectionStart;
	}

	get active(): EditorPosition {
		return this.position;
	}

	get start(): EditorPosition {
		return EditorPosition.compare(this.selectionStart, this.position) <= 0
			? this.selectionStart
			: this.position;
	}

	get end(): EditorPosition {
		return EditorPosition.compare(this.selectionStart, this.position) <= 0
			? this.position
			: this.selectionStart;
	}

	get isEmpty(): boolean {
		return Selection.isEmpty(this);
	}

	get isSelection(): boolean {
		return !Selection.isEmpty(this);
	}

	get direction(): 'ltr' | 'rtl' {
		return Selection.selectionDirection(this);
	}

	equals(other: Selection): boolean {
		return Selection.equals(this, other);
	}

	isBefore(other: Selection): boolean {
		return Selection.isBefore(this, other);
	}

	isAfter(other: Selection): boolean {
		return Selection.isAfter(this, other);
	}

	createReversed(): Selection {
		return Selection.createReversed(this);
	}

	toRange(): EditorRange {
		return EditorRange.fromPositions(this.start, this.end);
	}

	clone(): Selection {
		return new Selection(
			this.selectionStartLineNumber,
			this.selectionStartColumn,
			this.positionLineNumber,
			this.positionColumn
		);
	}

	setStartPosition(lineNumber: number, column: number): Selection {
		return new Selection(lineNumber, column, this.positionLineNumber, this.positionColumn);
	}

	setEndPosition(lineNumber: number, column: number): Selection {
		return new Selection(this.selectionStartLineNumber, this.selectionStartColumn, lineNumber, column);
	}
}
