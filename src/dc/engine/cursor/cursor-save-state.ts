/**
 * Dardcor Code - View State Cursor Restore Snapshot (Task 264)
 * Mirrors: vs/editor/common/cursor/cursorSaveState.ts
 */

import { ITextModel, Position } from '../model/text-model.js';
import { CursorSelection } from './cursor-operations.js';

export interface IViewStateSelection {
	readonly anchorLineNumber: number;
	readonly anchorColumn: number;
	readonly positionLineNumber: number;
	readonly positionColumn: number;
}

export interface ICursorViewState {
	readonly selections: readonly IViewStateSelection[];
	readonly firstPositionLineNumber?: number;
	readonly firstPositionColumn?: number;
}

export class CursorViewState {
	constructor(
		public readonly selections: readonly IViewStateSelection[],
		public readonly firstPositionLineNumber: number = 1,
		public readonly firstPositionColumn: number = 1
	) {}

	public static fromSelections(selections: readonly CursorSelection[]): CursorViewState {
		const selData = selections.map(s => ({
			anchorLineNumber: s.anchor.lineNumber,
			anchorColumn: s.anchor.column,
			positionLineNumber: s.active.lineNumber,
			positionColumn: s.active.column,
		}));
		const first = selections[0];
		const firstLine = first ? first.active.lineNumber : 1;
		const firstCol = first ? first.active.column : 1;
		return new CursorViewState(selData, firstLine, firstCol);
	}

	public static toSelections(state: ICursorViewState): CursorSelection[] {
		if (!state.selections || state.selections.length === 0) {
			return [new CursorSelection(new Position(1, 1), new Position(1, 1))];
		}
		return state.selections.map(s =>
			new CursorSelection(
				new Position(s.anchorLineNumber, s.anchorColumn),
				new Position(s.positionLineNumber, s.positionColumn)
			)
		);
	}

	public static restore(model: ITextModel, state: ICursorViewState | null): CursorSelection[] {
		if (!state) {
			return [new CursorSelection(new Position(1, 1), new Position(1, 1))];
		}
		const rawSelections = this.toSelections(state);
		const maxLine = model.getLineCount();
		return rawSelections.map(sel => {
			const anchorLine = Math.max(1, Math.min(sel.anchor.lineNumber, maxLine));
			const anchorLen = model.getLineContent(anchorLine).length;
			const anchorCol = Math.max(1, Math.min(sel.anchor.column, anchorLen + 1));

			const activeLine = Math.max(1, Math.min(sel.active.lineNumber, maxLine));
			const activeLen = model.getLineContent(activeLine).length;
			const activeCol = Math.max(1, Math.min(sel.active.column, activeLen + 1));

			return new CursorSelection(
				new Position(anchorLine, anchorCol),
				new Position(activeLine, activeCol)
			);
		});
	}

	public clone(): CursorViewState {
		return new CursorViewState(
			this.selections.map(s => ({ ...s })),
			this.firstPositionLineNumber,
			this.firstPositionColumn
		);
	}
}
