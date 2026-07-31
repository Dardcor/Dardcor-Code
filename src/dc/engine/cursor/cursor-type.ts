import { ITextModel } from '../model/text-model';
import { Selection } from '../model/selection';
import { Range } from '../model/range';

export interface IEditOperation {
	readonly range: Range;
	readonly text: string;
}

export class TypeHandler {
	static type(model: ITextModel, selections: readonly Selection[], text: string): IEditOperation[] {
		return selections.map(selection => ({
			range: selection.toRange(),
			text,
		}));
	}

	static typeAtPosition(model: ITextModel, position: { lineNumber: number; column: number }, text: string): IEditOperation {
		return {
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			text,
		};
	}

	static replaceRange(model: ITextModel, range: Range, text: string): IEditOperation {
		return { range, text };
	}

	static insertLineBreak(model: ITextModel, selections: readonly Selection[], indent: string = ''): IEditOperation[] {
		return selections.map(selection => {
			const position = selection.position;
			const line = model.getLineContent(position.lineNumber);
			const lineIndent = /^\s*/.exec(line)?.[0] ?? '';
			const text = '\n' + (indent || lineIndent);
			return {
				range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
				text,
			};
		});
	}

	static typeTab(model: ITextModel, selections: readonly Selection[], tabSize: number = 4, insertSpaces: boolean = true): IEditOperation[] {
		const text = insertSpaces ? ' '.repeat(tabSize) : '\t';
		return TypeHandler.type(model, selections, text);
	}

	static newLineAtEndOfLine(model: ITextModel, selections: readonly Selection[]): IEditOperation[] {
		return selections.map(selection => {
			const lineNumber = selection.position.lineNumber;
			const lineLength = model.getLineContent(lineNumber).length;
			return {
				range: new Range(lineNumber, lineLength + 1, lineNumber, lineLength + 1),
				text: '\n',
			};
		});
	}

	static composeEdits(model: ITextModel, edits: IEditOperation[]): string {
		const lines = model.getValue().split('\n');
		const lineStarts: number[] = [];
		let total = 0;
		for (const line of lines) {
			lineStarts.push(total);
			total += line.length + 1;
		}
		const offsetAt = (lineNumber: number, column: number): number => lineStarts[lineNumber - 1] + (column - 1);
		const normalized = edits.map(edit => ({
			startOffset: offsetAt(edit.range.startLineNumber, edit.range.startColumn),
			endOffset: offsetAt(edit.range.endLineNumber, edit.range.endColumn),
			text: edit.text,
		})).sort((a, b) => a.startOffset - b.startOffset);
		let result = '';
		let cursor = 0;
		for (const edit of normalized) {
			if (edit.startOffset < cursor || edit.endOffset < edit.startOffset) {
				continue;
			}
			result += model.getValue().substring(cursor, edit.startOffset);
			result += edit.text;
			cursor = edit.endOffset;
		}
		result += model.getValue().substring(cursor);
		return result;
	}
}
