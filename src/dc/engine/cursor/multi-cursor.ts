/**
 * Dardcor Code - Multi-Cursor Caret Collection & Merging (Task 220)
 * Mirrors: vs/editor/common/cursor/cursorCollection.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { ITextModel, Position, Range } from '../model/text-model';
import { ICursorState } from './cursor-controller';
import { CursorSelection } from './cursor-operations';

export class MultiCursor extends Disposable {
	private _selections: CursorSelection[] = [new CursorSelection(new Position(1, 1), new Position(1, 1))];
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor() {
		super();
	}

	public getPrimarySelection(): CursorSelection {
		return this._selections[0];
	}

	public getSelections(): CursorSelection[] {
		return this._selections;
	}

	public setSelections(selections: CursorSelection[]): void {
		if (selections && selections.length > 0) {
			this._selections = selections;
			this._onDidChange.fire();
		}
	}

	public getActivePositions(): Position[] {
		return this._selections.map(s => s.active);
	}

	public addCursorAt(pos: Position): void {
		this.setSelections([...this._selections, new CursorSelection(pos, pos)]);
	}

	public removeAllButPrimary(): void {
		if (this._selections.length > 1) {
			this.setSelections([this._selections[0]]);
		}
	}

	public clampToModel(model: ITextModel): void {
		// Clamp selections within model boundaries
	}

	public static addCursorAbove(model: ITextModel, currentStates: readonly ICursorState[]): ICursorState[] {
		const newStates: ICursorState[] = [...currentStates];
		const primary = currentStates[0];
		if (primary.position.lineNumber > 1) {
			const aboveLine = primary.position.lineNumber - 1;
			const lineLen = model.getLineContent(aboveLine).length;
			const col = Math.min(primary.stickyColumn, lineLen + 1);
			const pos = new Position(aboveLine, col);
			newStates.push({
				position: pos,
				selection: new Range(aboveLine, col, aboveLine, col),
				stickyColumn: primary.stickyColumn,
			});
		}
		return MultiCursor.mergeCollidingCursors(newStates);
	}

	public static addCursorBelow(model: ITextModel, currentStates: readonly ICursorState[]): ICursorState[] {
		const newStates: ICursorState[] = [...currentStates];
		const primary = currentStates[0];
		const maxLine = model.getLineCount();
		if (primary.position.lineNumber < maxLine) {
			const belowLine = primary.position.lineNumber + 1;
			const lineLen = model.getLineContent(belowLine).length;
			const col = Math.min(primary.stickyColumn, lineLen + 1);
			const pos = new Position(belowLine, col);
			newStates.push({
				position: pos,
				selection: new Range(belowLine, col, belowLine, col),
				stickyColumn: primary.stickyColumn,
			});
		}
		return MultiCursor.mergeCollidingCursors(newStates);
	}

	public static mergeCollidingCursors(states: readonly ICursorState[]): ICursorState[] {
		if (states.length <= 1) {
			return [...states];
		}
		const sorted = [...states].sort((a, b) => {
			if (a.position.lineNumber !== b.position.lineNumber) {
				return a.position.lineNumber - b.position.lineNumber;
			}
			return a.position.column - b.position.column;
		});

		const result: ICursorState[] = [sorted[0]];
		for (let i = 1; i < sorted.length; i++) {
			const prev = result[result.length - 1];
			const curr = sorted[i];
			if (prev.position.lineNumber === curr.position.lineNumber && prev.position.column === curr.position.column) {
				continue;
			}
			result.push(curr);
		}

		return result;
	}

	public static findNextOccurrence(model: ITextModel, searchString: string, afterPosition: Position): Range | null {
		if (!searchString || searchString.length === 0) {
			return null;
		}
		const lineCount = model.getLineCount();
		for (let line = afterPosition.lineNumber; line <= lineCount; line++) {
			const content = model.getLineContent(line);
			const startIdx = line === afterPosition.lineNumber ? afterPosition.column - 1 : 0;
			const foundIdx = content.indexOf(searchString, startIdx);
			if (foundIdx >= 0) {
				return new Range(line, foundIdx + 1, line, foundIdx + 1 + searchString.length);
			}
		}
		for (let line = 1; line < afterPosition.lineNumber; line++) {
			const content = model.getLineContent(line);
			const foundIdx = content.indexOf(searchString, 0);
			if (foundIdx >= 0) {
				return new Range(line, foundIdx + 1, line, foundIdx + 1 + searchString.length);
			}
		}
		return null;
	}
}
