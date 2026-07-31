/**
 * Dardcor Code - Document Match Counter & Navigator Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export interface IFindOptions {
	readonly isRegex: boolean;
	readonly matchCase: boolean;
	readonly wholeWord: boolean;
}

export interface IFindMatch {
	readonly range: IRange;
	readonly lineText: string;
}

const DEFAULT_OPTIONS: IFindOptions = { isRegex: false, matchCase: false, wholeWord: false };

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class FindModel extends Disposable {
	private _model: ITextModel | null = null;
	private _query: string = "";
	private _options: IFindOptions = { ...DEFAULT_OPTIONS };
	private _matches: IFindMatch[] = [];
	private _currentMatchIndex: number = -1;
	private _isInvalidRegex: boolean = false;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.compute();
	}

	public setQuery(query: string): void {
		this._query = query;
		this.compute();
	}

	public getQuery(): string {
		return this._query;
	}

	public setOptions(partial: Partial<IFindOptions>): void {
		this._options = { ...this._options, ...partial };
		this.compute();
	}

	public getOptions(): IFindOptions {
		return { ...this._options };
	}

	public setRegex(regex: boolean): void {
		this.setOptions({ isRegex: regex });
	}

	public setMatchCase(matchCase: boolean): void {
		this.setOptions({ matchCase });
	}

	public setWholeWord(wholeWord: boolean): void {
		this.setOptions({ wholeWord });
	}

	public compute(): void {
		const model = this._model;
		this._matches = [];
		this._currentMatchIndex = -1;
		this._isInvalidRegex = false;
		if (!model || this._query.length === 0) {
			this._onDidChange.fire();
			return;
		}
		try {
			this._matches = this._computeMatches(model);
		} catch {
			this._isInvalidRegex = true;
		}
		if (this._matches.length > 0) {
			this._currentMatchIndex = 0;
		}
		this._onDidChange.fire();
	}

	private _computeMatches(model: ITextModel): IFindMatch[] {
		const query = this._query;
		const { isRegex, matchCase, wholeWord } = this._options;
		const matches: IFindMatch[] = [];
		const flags = matchCase ? "g" : "gi";
		let regex: RegExp | null = null;
		if (isRegex) {
			regex = new RegExp(query, flags);
		}
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			if (regex) {
				for (const m of text.matchAll(regex)) {
					if (m[0].length === 0) {
						continue;
					}
					const start = m.index ?? 0;
					if (wholeWord && !this._isWholeWord(text, start, start + m[0].length)) {
						continue;
					}
					matches.push(this._makeMatch(line, start, start + m[0].length, text));
				}
			} else {
				const needle = matchCase ? query : query.toLowerCase();
				const haystack = matchCase ? text : text.toLowerCase();
				let index = 0;
				while (true) {
					const found = haystack.indexOf(needle, index);
					if (found === -1) {
						break;
					}
					if (!wholeWord || this._isWholeWord(text, found, found + query.length)) {
						matches.push(this._makeMatch(line, found, found + query.length, text));
					}
					index = found + Math.max(1, query.length);
				}
			}
		}
		return matches;
	}

	private _isWholeWord(text: string, start: number, end: number): boolean {
		const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);
		return (start <= 0 || !isWord(text[start - 1])) && (end >= text.length || !isWord(text[end]));
	}

	private _makeMatch(line: number, start: number, end: number, lineText: string): IFindMatch {
		return {
			range: {
				startLineNumber: line,
				startColumn: start + 1,
				endLineNumber: line,
				endColumn: end + 1
			},
			lineText
		};
	}

	public getMatchCount(): number {
		return this._matches.length;
	}

	public getMatches(): readonly IFindMatch[] {
		return this._matches;
	}

	public getCurrentMatch(): IFindMatch | null {
		if (this._currentMatchIndex < 0 || this._currentMatchIndex >= this._matches.length) {
			return null;
		}
		return this._matches[this._currentMatchIndex];
	}

	public getCurrentMatchIndex(): number {
		return this._currentMatchIndex;
	}

	public moveNext(): IFindMatch | null {
		if (this._matches.length === 0) {
			return null;
		}
		this._currentMatchIndex = (this._currentMatchIndex + 1) % this._matches.length;
		this._onDidChange.fire();
		return this.getCurrentMatch();
	}

	public movePrevious(): IFindMatch | null {
		if (this._matches.length === 0) {
			return null;
		}
		this._currentMatchIndex = (this._currentMatchIndex - 1 + this._matches.length) % this._matches.length;
		this._onDidChange.fire();
		return this.getCurrentMatch();
	}

	public getMatchRanges(): IRange[] {
		return this._matches.map(m => m.range);
	}

	public isInvalidRegex(): boolean {
		return this._isInvalidRegex;
	}

	public replaceCurrent(replacement: string): boolean {
		const match = this.getCurrentMatch();
		const model = this._model;
		if (!match || !model) {
			return false;
		}
		const line = match.range.startLineNumber;
		const startColumn = match.range.startColumn;
		const endColumn = match.range.endColumn;
		const text = model.getValue();
		const lines = text.split(/\r?\n/);
		const lineText = lines[line - 1] ?? "";
		const replaced = this._expandReplacement(replacement, lineText.substring(startColumn - 1, endColumn - 1));
		lines[line - 1] = lineText.substring(0, startColumn - 1) + replaced + lineText.substring(endColumn - 1);
		model.setValue(lines.join("\n"));
		this.compute();
		return true;
	}

	public replaceAll(replacement: string): number {
		const model = this._model;
		if (!model || this._matches.length === 0) {
			return 0;
		}
		const text = model.getValue();
		const lines = text.split(/\r?\n/);
		let replacedCount = 0;
		const editsPerLine = new Map<number, { start: number; end: number; text: string }[]>();
		for (const match of this._matches) {
			const line = match.range.startLineNumber;
			const start = match.range.startColumn - 1;
			const end = match.range.endColumn - 1;
			const lineText = lines[line - 1] ?? "";
			const expanded = this._expandReplacement(replacement, lineText.substring(start, end));
			if (!editsPerLine.has(line)) {
				editsPerLine.set(line, []);
			}
			editsPerLine.get(line)!.push({ start, end, text: expanded });
			replacedCount++;
		}
		for (const [line, edits] of editsPerLine) {
			edits.sort((a, b) => b.start - a.start);
			let lineText = lines[line - 1] ?? "";
			for (const edit of edits) {
				lineText = lineText.substring(0, edit.start) + edit.text + lineText.substring(edit.end);
			}
			lines[line - 1] = lineText;
		}
		model.setValue(lines.join("\n"));
		this.compute();
		return replacedCount;
	}

	public expandReplacement(replacement: string, matchText: string, captureGroups: string[] = []): string {
		return replacement.replace(/\$\$|\$(\d+)|\$\{(\d+)\}/g, (_m, group: string | undefined, braced: string | undefined) => {
			if (group === undefined && braced === undefined) {
				return "$";
			}
			const index = Number(group ?? braced);
			if (index === 0) {
				return matchText;
			}
			return captureGroups[index - 1] ?? "";
		});
	}

	private _expandReplacement(replacement: string, matchText: string): string {
		return this.expandReplacement(replacement, matchText);
	}
}
