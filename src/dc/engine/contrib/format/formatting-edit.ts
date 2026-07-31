/**
 * Dardcor Code - Text Edit Application Transformer (Formatting)
 */

import { ITextModel, IRange } from "../../model/text-model.js";
import { IFormattingEdit } from "./format-controller.js";

export class FormattingEdit {
	constructor(
		public readonly range: IRange,
		public readonly text: string
	) {}

	public static replace(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, text: string): FormattingEdit {
		return new FormattingEdit({ startLineNumber, startColumn, endLineNumber, endColumn }, text);
	}

	public static insert(lineNumber: number, column: number, text: string): FormattingEdit {
		return new FormattingEdit({ startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column }, text);
	}

	public static delete(range: IRange): FormattingEdit {
		return new FormattingEdit(range, "");
	}

	public equals(other: FormattingEdit): boolean {
		return this.text === other.text &&
			this.range.startLineNumber === other.range.startLineNumber &&
			this.range.startColumn === other.range.startColumn &&
			this.range.endLineNumber === other.range.endLineNumber &&
			this.range.endColumn === other.range.endColumn;
	}
}

export class TextEditTransformer {
	public static computeLineOffsets(model: ITextModel): number[] {
		const offsets: number[] = [0];
		for (let line = 1; line <= model.getLineCount(); line++) {
			offsets.push(offsets[offsets.length - 1] + model.getLineContent(line).length + 1);
		}
		return offsets;
	}

	public static offsetAt(offsets: number[], lineNumber: number, column: number): number {
		if (lineNumber < 1 || lineNumber >= offsets.length) {
			return -1;
		}
		return offsets[lineNumber - 1] + (column - 1);
	}

	public static applyToText(text: string, offsets: number[], edits: readonly IFormattingEdit[]): string {
		const sorted = [...edits].sort((a, b) => {
			const aStart = TextEditTransformer.offsetAt(offsets, a.range.startLineNumber, a.range.startColumn);
			const bStart = TextEditTransformer.offsetAt(offsets, b.range.startLineNumber, b.range.startColumn);
			return bStart - aStart;
		});
		let result = text;
		for (const edit of sorted) {
			const start = TextEditTransformer.offsetAt(offsets, edit.range.startLineNumber, edit.range.startColumn);
			const end = TextEditTransformer.offsetAt(offsets, edit.range.endLineNumber, edit.range.endColumn);
			if (start < 0 || end < start || end > result.length) {
				continue;
			}
			result = result.substring(0, start) + edit.text + result.substring(end);
		}
		return result;
	}

	public static applyEdits(model: ITextModel, edits: readonly IFormattingEdit[]): boolean {
		if (edits.length === 0) {
			return false;
		}
		const offsets = TextEditTransformer.computeLineOffsets(model);
		const text = model.getValue();
		const result = TextEditTransformer.applyToText(text, offsets, edits);
		if (result !== text) {
			model.setValue(result);
			return true;
		}
		return false;
	}

	public static mergeEdits(edits: readonly IFormattingEdit[]): IFormattingEdit[] {
		const sorted = [...edits].sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			if (a.range.startColumn !== b.range.startColumn) {
				return a.range.startColumn - b.range.startColumn;
			}
			return b.range.endColumn - a.range.endColumn;
		});
		const merged: IFormattingEdit[] = [];
		for (const edit of sorted) {
			const last = merged[merged.length - 1];
			const overlaps = last &&
				last.range.endLineNumber >= edit.range.startLineNumber &&
				last.range.endColumn >= edit.range.startColumn;
			if (overlaps) {
				merged[merged.length - 1] = {
					range: {
						startLineNumber: last.range.startLineNumber,
						startColumn: last.range.startColumn,
						endLineNumber: Math.max(last.range.endLineNumber, edit.range.endLineNumber),
						endColumn: Math.max(last.range.endColumn, edit.range.endColumn)
					},
					text: last.text + edit.text
				};
			} else {
				merged.push(edit);
			}
		}
		return merged;
	}

	public static getEditCount(edits: readonly IFormattingEdit[]): number {
		return edits.length;
	}

	public static isEmpty(edits: readonly IFormattingEdit[]): boolean {
		return edits.length === 0;
	}
}
