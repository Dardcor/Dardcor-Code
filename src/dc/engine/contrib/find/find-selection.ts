/**
 * Dardcor Code - Find Matching Selection Instances Command
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IRange } from "../../model/text-model.js";
import { FindModel, IFindMatch } from "./find-model.js";

export interface IFindSelectionHost {
	getModel(): ITextModel | null;
	getSelection(): IRange | null;
	getFindModel(): FindModel | null;
}

export interface IFindSelectionResult {
	readonly word: string;
	readonly matchCount: number;
	readonly ranges: IRange[];
}

const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);

/**
 * Implements "Find Matching Selection" / "Select All Occurrences": the word
 * under the current selection becomes the find query and all its occurrences
 * in the document are highlighted/selected.
 */
export class FindSelection extends Disposable {
	private readonly _host: IFindSelectionHost;

	private readonly _onDidFind = this._register(new Emitter<IFindSelectionResult>());
	readonly onDidFind: Event<IFindSelectionResult> = this._onDidFind.event;

	constructor(host: IFindSelectionHost) {
		super();
		this._host = host;
	}

	public findMatchingSelection(): IFindSelectionResult | null {
		const model = this._host.getModel();
		const selection = this._host.getSelection();
		if (!model || !selection) {
			return null;
		}
		const word = this._getSelectedWord(model, selection);
		if (word.length === 0) {
			return null;
		}
		const ranges = this._findOccurrences(model, word);
		const findModel = this._host.getFindModel();
		if (findModel) {
			findModel.setQuery(word);
			findModel.setOptions({ matchCase: true, wholeWord: true, isRegex: false });
		}
		const result: IFindSelectionResult = { word, matchCount: ranges.length, ranges };
		this._onDidFind.fire(result);
		return result;
	}

	public static getSelectedWord(model: ITextModel, selection: IRange): string {
		return new FindSelection({ getModel: () => model, getSelection: () => selection, getFindModel: () => null })._getSelectedWord(model, selection);
	}

	public static findOccurrences(model: ITextModel, word: string): IRange[] {
		return new FindSelection({ getModel: () => model, getSelection: () => null, getFindModel: () => null })._findOccurrences(model, word);
	}

	public getSelectedWord(model: ITextModel, selection: IRange): string {
		return this._getSelectedWord(model, selection);
	}

	public getOccurrences(model: ITextModel, word: string): IRange[] {
		return this._findOccurrences(model, word);
	}

	private _getSelectedWord(model: ITextModel, selection: IRange): string {
		const line = model.getLineContent(selection.startLineNumber);
		let start = selection.startColumn - 1;
		let end = selection.endColumn - 1;
		if (start === end) {
			return "";
		}
		if (end > line.length) {
			end = line.length;
		}
		const text = line.substring(start, end);
		if (text.length > 0 && text.trim().length > 0) {
			return text;
		}
		// The selection covers the word - widen it to the full word.
		let s = selection.startColumn - 1;
		while (s > 0 && isWord(line[s - 1])) {
			s--;
		}
		let e = selection.endColumn - 1;
		while (e < line.length && isWord(line[e])) {
			e++;
		}
		return line.substring(s, e);
	}

	private _findOccurrences(model: ITextModel, word: string): IRange[] {
		const ranges: IRange[] = [];
		if (word.length === 0) {
			return ranges;
		}
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			let index = 0;
			while (true) {
				const found = text.indexOf(word, index);
				if (found === -1) {
					break;
				}
				const beforeOk = found === 0 || !isWord(text[found - 1]);
				const afterOk = found + word.length >= text.length || !isWord(text[found + word.length]);
				if (beforeOk && afterOk) {
					ranges.push({
						startLineNumber: line,
						startColumn: found + 1,
						endLineNumber: line,
						endColumn: found + word.length + 1
					});
				}
				index = found + Math.max(1, word.length);
			}
		}
		return ranges;
	}

	public override dispose(): void {
		super.dispose();
	}
}

export function toFindMatches(ranges: readonly IRange[], model: ITextModel): IFindMatch[] {
	return ranges.map(range => ({
		range,
		lineText: model.getLineContent(range.startLineNumber)
	}));
}
