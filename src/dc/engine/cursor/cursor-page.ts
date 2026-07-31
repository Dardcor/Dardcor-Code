import { ITextModel, Position } from '../model/text-model';
import { Selection } from '../model/selection';

const DEFAULT_LINE_HEIGHT = 19;
const PAGE_SCROLL_FACTOR = 0.8;

export interface ICursorPageViewport {
	readonly height: number;
	readonly scrollTop: number;
}

export interface ICursorPageArgs {
	readonly select: boolean;
}

export interface ICursorPageResult {
	readonly selections: Selection[];
	readonly scrollTop: number;
}

export class CursorPage {
	static pageUp(model: ITextModel, selections: readonly Selection[], viewport: ICursorPageViewport, args: ICursorPageArgs): ICursorPageResult {
		const linesInViewport = Math.max(1, Math.floor(viewport.height / DEFAULT_LINE_HEIGHT));
		const lineCount = model.getLineCount();
		const newSelections = selections.map(selection => {
			const anchor = selection.selectionStart;
			const targetLine = Math.max(1, selection.position.lineNumber - linesInViewport);
			const target = new Position(targetLine, CursorPage._clampColumn(model, targetLine, selection.position.column));
			if (args.select) {
				return new Selection(anchor.lineNumber, anchor.column, target.lineNumber, target.column);
			}
			return new Selection(target.lineNumber, target.column, target.lineNumber, target.column);
		});
		const scrollHeight = lineCount * DEFAULT_LINE_HEIGHT;
		const maxScrollTop = Math.max(0, scrollHeight - viewport.height);
		const scrollTop = Math.max(0, Math.min(viewport.scrollTop - viewport.height * PAGE_SCROLL_FACTOR, maxScrollTop));
		return { selections: newSelections, scrollTop };
	}

	static pageDown(model: ITextModel, selections: readonly Selection[], viewport: ICursorPageViewport, args: ICursorPageArgs): ICursorPageResult {
		const linesInViewport = Math.max(1, Math.floor(viewport.height / DEFAULT_LINE_HEIGHT));
		const lineCount = model.getLineCount();
		const newSelections = selections.map(selection => {
			const anchor = selection.selectionStart;
			const targetLine = Math.min(lineCount, selection.position.lineNumber + linesInViewport);
			const target = new Position(targetLine, CursorPage._clampColumn(model, targetLine, selection.position.column));
			if (args.select) {
				return new Selection(anchor.lineNumber, anchor.column, target.lineNumber, target.column);
			}
			return new Selection(target.lineNumber, target.column, target.lineNumber, target.column);
		});
		const scrollHeight = lineCount * DEFAULT_LINE_HEIGHT;
		const maxScrollTop = Math.max(0, scrollHeight - viewport.height);
		const scrollTop = Math.max(0, Math.min(viewport.scrollTop + viewport.height * PAGE_SCROLL_FACTOR, maxScrollTop));
		return { selections: newSelections, scrollTop };
	}

	static getLinesInViewport(viewport: ICursorPageViewport): number {
		return Math.max(1, Math.floor(viewport.height / DEFAULT_LINE_HEIGHT));
	}

	private static _clampColumn(model: ITextModel, lineNumber: number, column: number): number {
		const lineLength = model.getLineContent(lineNumber).length;
		return Math.max(1, Math.min(column, lineLength + 1));
	}
}
