/**
 * Dardcor Code - Word Occurrences Highlighter
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export interface IWordHighlight {
	readonly range: IRange;
	readonly isCurrent: boolean;
}

export class WordHighlighter extends Disposable {
	private _model: ITextModel | null = null;
	private _highlights: IWordHighlight[] = [];
	private _position: IPosition | null = null;

	private readonly _onDidChange = this._register(new Emitter<IWordHighlight[]>());
	readonly onDidChange: Event<IWordHighlight[]> = this._onDidChange.event;

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.update(this._position);
	}

	public update(position: IPosition | null): void {
		this._position = position;
		const model = this._model;
		if (!model || !position) {
			this._highlights = [];
			this._onDidChange.fire(this._highlights);
			return;
		}
		const wordRange = this._findWordRange(model, position);
		if (!wordRange) {
			this._highlights = [];
			this._onDidChange.fire(this._highlights);
			return;
		}
		const line = model.getLineContent(wordRange.startLineNumber);
		const word = line.substring(wordRange.startColumn - 1, wordRange.endColumn - 1);
		if (word.length < 2) {
			this._highlights = [];
			this._onDidChange.fire(this._highlights);
			return;
		}
		this._highlights = this._findOccurrences(model, word, wordRange);
		this._onDidChange.fire(this._highlights);
	}

	public clear(): void {
		this._highlights = [];
		this._onDidChange.fire(this._highlights);
	}

	private _findWordRange(model: ITextModel, position: IPosition): IRange | null {
		const line = model.getLineContent(position.lineNumber);
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		if (!isWord(line[position.column - 1] ?? "")) {
			return null;
		}
		let start = position.column - 1;
		while (start > 0 && isWord(line[start - 1])) {
			start--;
		}
		let end = position.column;
		while (end < line.length && isWord(line[end])) {
			end++;
		}
		return { startLineNumber: position.lineNumber, startColumn: start + 1, endLineNumber: position.lineNumber, endColumn: end + 1 };
	}

	private _findOccurrences(model: ITextModel, word: string, current: IRange): IWordHighlight[] {
		const highlights: IWordHighlight[] = [];
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
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
					const range: IRange = {
						startLineNumber: line,
						startColumn: found + 1,
						endLineNumber: line,
						endColumn: found + word.length + 1
					};
					highlights.push({
						range,
						isCurrent: range.startLineNumber === current.startLineNumber &&
							range.startColumn === current.startColumn
					});
				}
				index = found + Math.max(1, word.length);
			}
		}
		return highlights;
	}

	public getHighlights(): readonly IWordHighlight[] {
		return this._highlights;
	}

	public getHighlightRanges(): IRange[] {
		return this._highlights.map(h => h.range);
	}
}
