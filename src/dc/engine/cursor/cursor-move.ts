import { ITextModel, Position } from '../model/text-model.js';
import { Selection } from '../model/selection.js';

export interface ICursorMoveArgs {
	readonly to: 'left' | 'right' | 'up' | 'down' | 'wrappedLineStart' | 'wrappedLineEnd' | 'viewPortTop' | 'viewPortCenter' | 'viewPortBottom' | 'prevBlankLine' | 'nextBlankLine';
	readonly by?: 'line' | 'wrappedLine' | 'character' | 'halfLine';
	readonly value?: number;
	readonly select: boolean;
}

function clampColumnToLine(model: ITextModel, lineNumber: number, column: number): number {
	const lineLength = model.getLineContent(lineNumber).length;
	return Math.max(1, Math.min(column, lineLength + 1));
}

function moveCharacterLeft(model: ITextModel, position: Position): Position {
	if (position.column > 1) {
		return new Position(position.lineNumber, position.column - 1);
	}
	if (position.lineNumber > 1) {
		const prevLength = model.getLineContent(position.lineNumber - 1).length;
		return new Position(position.lineNumber - 1, prevLength + 1);
	}
	return position;
}

function moveCharacterRight(model: ITextModel, position: Position): Position {
	const lineLength = model.getLineContent(position.lineNumber).length;
	if (position.column <= lineLength) {
		return new Position(position.lineNumber, position.column + 1);
	}
	if (position.lineNumber < model.getLineCount()) {
		return new Position(position.lineNumber + 1, 1);
	}
	return position;
}

function moveLineUp(model: ITextModel, position: Position, lines: number): Position {
	const targetLine = Math.max(1, position.lineNumber - lines);
	const column = clampColumnToLine(model, targetLine, position.column);
	return new Position(targetLine, column);
}

function moveLineDown(model: ITextModel, position: Position, lines: number): Position {
	const targetLine = Math.min(model.getLineCount(), position.lineNumber + lines);
	const column = clampColumnToLine(model, targetLine, position.column);
	return new Position(targetLine, column);
}

function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

function moveToPrevBlankLine(model: ITextModel, position: Position): Position {
	for (let line = position.lineNumber - 1; line >= 1; line--) {
		if (isBlankLine(model.getLineContent(line))) {
			return new Position(line, 1);
		}
	}
	return new Position(1, 1);
}

function moveToNextBlankLine(model: ITextModel, position: Position): Position {
	const lineCount = model.getLineCount();
	for (let line = position.lineNumber + 1; line <= lineCount; line++) {
		if (isBlankLine(model.getLineContent(line))) {
			return new Position(line, 1);
		}
	}
	return new Position(lineCount, model.getLineContent(lineCount).length + 1);
}

export class CursorMove {
	static move(model: ITextModel, selections: readonly Selection[], args: ICursorMoveArgs): Selection[] {
		const value = Math.max(1, args.value ?? 1);
		const by = args.by ?? 'line';
		return selections.map(selection => {
			const anchor = selection.selectionStart;
			let target = selection.position;
			switch (args.to) {
				case 'left': {
					for (let i = 0; i < value; i++) {
						target = moveCharacterLeft(model, target);
					}
					break;
				}
				case 'right': {
					for (let i = 0; i < value; i++) {
						target = moveCharacterRight(model, target);
					}
					break;
				}
				case 'up': {
					const lines = by === 'halfLine' ? Math.max(1, Math.ceil(value / 2)) : value;
					target = moveLineUp(model, target, lines);
					break;
				}
				case 'down': {
					const lines = by === 'halfLine' ? Math.max(1, Math.ceil(value / 2)) : value;
					target = moveLineDown(model, target, lines);
					break;
				}
				case 'wrappedLineStart': {
					const line = model.getLineContent(target.lineNumber);
					const firstNonWs = line.search(/\S/);
					const firstNonWsColumn = firstNonWs === -1 ? line.length + 1 : firstNonWs + 1;
					target = new Position(target.lineNumber, target.column > firstNonWsColumn ? firstNonWsColumn : 1);
					break;
				}
				case 'wrappedLineEnd': {
					target = new Position(target.lineNumber, model.getLineContent(target.lineNumber).length + 1);
					break;
				}
				case 'viewPortTop': {
					target = new Position(1, clampColumnToLine(model, 1, target.column));
					break;
				}
				case 'viewPortCenter': {
					const middle = Math.max(1, Math.ceil(model.getLineCount() / 2));
					target = new Position(middle, clampColumnToLine(model, middle, target.column));
					break;
				}
				case 'viewPortBottom': {
					const last = model.getLineCount();
					target = new Position(last, clampColumnToLine(model, last, target.column));
					break;
				}
				case 'prevBlankLine': {
					target = moveToPrevBlankLine(model, target);
					break;
				}
				case 'nextBlankLine': {
					target = moveToNextBlankLine(model, target);
					break;
				}
			}
			if (args.select) {
				return new Selection(anchor.lineNumber, anchor.column, target.lineNumber, target.column);
			}
			return new Selection(target.lineNumber, target.column, target.lineNumber, target.column);
		});
	}

	static moveLeft(model: ITextModel, selections: readonly Selection[], value: number = 1, select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'left', by: 'character', value, select });
	}

	static moveRight(model: ITextModel, selections: readonly Selection[], value: number = 1, select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'right', by: 'character', value, select });
	}

	static moveUp(model: ITextModel, selections: readonly Selection[], value: number = 1, select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'up', by: 'line', value, select });
	}

	static moveDown(model: ITextModel, selections: readonly Selection[], value: number = 1, select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'down', by: 'line', value, select });
	}

	static moveToLineStart(model: ITextModel, selections: readonly Selection[], select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'wrappedLineStart', select });
	}

	static moveToLineEnd(model: ITextModel, selections: readonly Selection[], select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'wrappedLineEnd', select });
	}

	static moveToTop(model: ITextModel, selections: readonly Selection[], select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'viewPortTop', select });
	}

	static moveToBottom(model: ITextModel, selections: readonly Selection[], select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'viewPortBottom', select });
	}

	static moveToPreviousBlankLine(model: ITextModel, selections: readonly Selection[], select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'prevBlankLine', select });
	}

	static moveToNextBlankLine(model: ITextModel, selections: readonly Selection[], select: boolean = false): Selection[] {
		return CursorMove.move(model, selections, { to: 'nextBlankLine', select });
	}
}
