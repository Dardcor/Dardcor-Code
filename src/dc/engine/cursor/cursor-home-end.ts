import { ITextModel, Position } from '../model/text-model.js';
import { Selection } from '../model/selection.js';

export interface ICursorHomeEndArgs {
	readonly inSelection: boolean;
	readonly select: boolean;
}

export class CursorHomeEnd {
	static home(model: ITextModel, selections: readonly Selection[], args: ICursorHomeEndArgs): Selection[] {
		return selections.map(selection => {
			const active = selection.position;
			const line = model.getLineContent(active.lineNumber);
			const firstNonWs = line.search(/\S/);
			const firstNonWsColumn = firstNonWs === -1 ? line.length + 1 : firstNonWs + 1;
			let target: Position;
			if (active.column > firstNonWsColumn) {
				target = new Position(active.lineNumber, firstNonWsColumn);
			} else {
				target = new Position(active.lineNumber, 1);
			}
			return CursorHomeEnd._build(selection, target, args);
		});
	}

	static end(model: ITextModel, selections: readonly Selection[], args: ICursorHomeEndArgs): Selection[] {
		return selections.map(selection => {
			const active = selection.position;
			const lineLength = model.getLineContent(active.lineNumber).length;
			const target = new Position(active.lineNumber, lineLength + 1);
			return CursorHomeEnd._build(selection, target, args);
		});
	}

	static homeIgnoringIndentation(model: ITextModel, selections: readonly Selection[], args: ICursorHomeEndArgs): Selection[] {
		return selections.map(selection => {
			const active = selection.position;
			const target = new Position(active.lineNumber, 1);
			return CursorHomeEnd._build(selection, target, args);
		});
	}

	static endIgnoringIndentation(model: ITextModel, selections: readonly Selection[], args: ICursorHomeEndArgs): Selection[] {
		return CursorHomeEnd.end(model, selections, args);
	}

	private static _build(selection: Selection, target: Position, args: ICursorHomeEndArgs): Selection {
		const keepAnchor = args.select || args.inSelection;
		if (keepAnchor) {
			return new Selection(
				selection.selectionStartLineNumber,
				selection.selectionStartColumn,
				target.lineNumber,
				target.column
			);
		}
		return new Selection(target.lineNumber, target.column, target.lineNumber, target.column);
	}
}
