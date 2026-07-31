import { ITextModel } from '../model/text-model';
import { Selection } from '../model/selection';
import { Range } from '../model/range';
import { CursorWord, DEFAULT_WORD_SEPARATORS } from './cursor-word';
import { IEditOperation } from './cursor-type';

export class CursorDelete {
	static deleteLeft(model: ITextModel, selections: readonly Selection[], wordStarts: boolean): IEditOperation[] {
		const edits: IEditOperation[] = [];
		for (const selection of selections) {
			if (!selection.isEmpty) {
				edits.push({ range: selection.toRange(), text: '' });
				continue;
			}
			const position = selection.position;
			if (wordStarts) {
				const target = CursorWord.left(model, selection, DEFAULT_WORD_SEPARATORS);
				if (target.lineNumber === position.lineNumber && target.column === position.column) {
					continue;
				}
				edits.push({
					range: new Range(target.lineNumber, target.column, position.lineNumber, position.column),
					text: '',
				});
				continue;
			}
			if (position.column > 1) {
				edits.push({
					range: new Range(position.lineNumber, position.column - 1, position.lineNumber, position.column),
					text: '',
				});
			} else if (position.lineNumber > 1) {
				const prevLineLength = model.getLineContent(position.lineNumber - 1).length;
				edits.push({
					range: new Range(position.lineNumber - 1, prevLineLength + 1, position.lineNumber, position.column),
					text: '',
				});
			}
		}
		return edits;
	}

	static deleteRight(model: ITextModel, selections: readonly Selection[], wordEnds: boolean): IEditOperation[] {
		const edits: IEditOperation[] = [];
		for (const selection of selections) {
			if (!selection.isEmpty) {
				edits.push({ range: selection.toRange(), text: '' });
				continue;
			}
			const position = selection.position;
			const lineLength = model.getLineContent(position.lineNumber).length;
			if (wordEnds) {
				const target = CursorWord.right(model, selection, DEFAULT_WORD_SEPARATORS);
				if (target.lineNumber === position.lineNumber && target.column === position.column) {
					continue;
				}
				edits.push({
					range: new Range(position.lineNumber, position.column, target.lineNumber, target.column),
					text: '',
				});
				continue;
			}
			if (position.column <= lineLength) {
				edits.push({
					range: new Range(position.lineNumber, position.column, position.lineNumber, position.column + 1),
					text: '',
				});
			} else if (position.lineNumber < model.getLineCount()) {
				edits.push({
					range: new Range(position.lineNumber, position.column, position.lineNumber + 1, 1),
					text: '',
				});
			}
		}
		return edits;
	}

	static deleteWordLeft(model: ITextModel, selections: readonly Selection[]): IEditOperation[] {
		return CursorDelete.deleteLeft(model, selections, true);
	}

	static deleteWordRight(model: ITextModel, selections: readonly Selection[]): IEditOperation[] {
		return CursorDelete.deleteRight(model, selections, true);
	}

	static deleteToLineStart(model: ITextModel, selections: readonly Selection[]): IEditOperation[] {
		const edits: IEditOperation[] = [];
		for (const selection of selections) {
			if (!selection.isEmpty) {
				edits.push({ range: selection.toRange(), text: '' });
				continue;
			}
			const position = selection.position;
			edits.push({
				range: new Range(position.lineNumber, 1, position.lineNumber, position.column),
				text: '',
			});
		}
		return edits;
	}

	static deleteToLineEnd(model: ITextModel, selections: readonly Selection[]): IEditOperation[] {
		const edits: IEditOperation[] = [];
		for (const selection of selections) {
			if (!selection.isEmpty) {
				edits.push({ range: selection.toRange(), text: '' });
				continue;
			}
			const position = selection.position;
			const lineLength = model.getLineContent(position.lineNumber).length;
			if (position.column <= lineLength) {
				edits.push({
					range: new Range(position.lineNumber, position.column, position.lineNumber, lineLength + 1),
					text: '',
				});
			}
		}
		return edits;
	}
}
