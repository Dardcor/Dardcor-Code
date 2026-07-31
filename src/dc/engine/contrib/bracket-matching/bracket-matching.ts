/**
 * Dardcor Code - Bracket Pair Detector & Highlighter
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

const OPEN_BRACKETS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"<": ">"
};

const CLOSE_BRACKETS: Record<string, string> = {
	")": "(",
	"]": "[",
	"}": "{",
	">": "<"
};

export interface IBracketMatch {
	readonly opening: IRange;
	readonly closing: IRange;
	readonly direction: 1 | -1;
}

function isStringOrComment(ch: string): boolean {
	return ch === "'" || ch === "\"" || ch === "`";
}

export class BracketMatching extends Disposable {
	private _match: IBracketMatch | null = null;

	private readonly _onDidChange = this._register(new Emitter<IBracketMatch | null>());
	readonly onDidChange: Event<IBracketMatch | null> = this._onDidChange.event;

	public compute(model: ITextModel, position: IPosition): IBracketMatch | null {
		this._match = this._findMatch(model, position);
		return this._match;
	}

	public refresh(model: ITextModel, position: IPosition | null): void {
		this._match = position ? this._findMatch(model, position) : null;
		this._onDidChange.fire(this._match);
	}

	public getMatch(): IBracketMatch | null {
		return this._match;
	}

	private _findMatch(model: ITextModel, position: IPosition): IBracketMatch | null {
		const line = model.getLineContent(position.lineNumber);
		const column = position.column - 1;
		const char = line[column] ?? "";
		if (OPEN_BRACKETS[char]) {
			const close = OPEN_BRACKETS[char];
			const closePos = this._scanForward(model, position.lineNumber, column + 1, char, close);
			if (closePos) {
				return {
					opening: { startLineNumber: position.lineNumber, startColumn: column + 1, endLineNumber: position.lineNumber, endColumn: column + 2 },
					closing: { startLineNumber: closePos.lineNumber, startColumn: closePos.column, endLineNumber: closePos.lineNumber, endColumn: closePos.column + 1 },
					direction: 1
				};
			}
		}
		if (CLOSE_BRACKETS[char]) {
			const open = CLOSE_BRACKETS[char];
			const openPos = this._scanBackward(model, position.lineNumber, column - 1, open, char);
			if (openPos) {
				return {
					opening: { startLineNumber: openPos.lineNumber, startColumn: openPos.column, endLineNumber: openPos.lineNumber, endColumn: openPos.column + 1 },
					closing: { startLineNumber: position.lineNumber, startColumn: column + 1, endLineNumber: position.lineNumber, endColumn: column + 2 },
					direction: -1
				};
			}
		}
		return null;
	}

	private _scanForward(model: ITextModel, lineNumber: number, column: number, open: string, close: string): { lineNumber: number; column: number } | null {
		let depth = 0;
		let quote: string | null = null;
		let lineComment = false;
		let blockComment = false;
		const lineCount = model.getLineCount();
		for (let line = lineNumber; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			const startCol = line === lineNumber ? column : 0;
			for (let col = startCol; col < text.length; col++) {
				const ch = text[col];
				const next = text[col + 1] ?? "";
				if (lineComment) {
					break;
				}
				if (blockComment) {
					if (ch === "*" && next === "/") {
						blockComment = false;
						col++;
					}
					continue;
				}
				if (quote) {
					if (ch === quote && text[col - 1] !== "\\") {
						quote = null;
					}
					continue;
				}
				if (ch === "/" && next === "/") {
					lineComment = true;
					break;
				}
				if (ch === "/" && next === "*") {
					blockComment = true;
					col++;
					continue;
				}
				if (isStringOrComment(ch)) {
					quote = ch;
					continue;
				}
				if (ch === open) {
					depth++;
				} else if (ch === close) {
					depth--;
					if (depth === 0) {
						return { lineNumber: line, column: col + 1 };
					}
				}
			}
			lineComment = false;
		}
		return null;
	}

	private _scanBackward(model: ITextModel, lineNumber: number, column: number, open: string, close: string): { lineNumber: number; column: number } | null {
		let depth = 0;
		for (let line = lineNumber; line >= 1; line--) {
			const text = model.getLineContent(line);
			const startCol = line === lineNumber ? column : text.length - 1;
			for (let col = startCol; col >= 0; col--) {
				const ch = text[col];
				if (ch === close) {
					depth++;
				} else if (ch === open) {
					depth--;
					if (depth === 0) {
						return { lineNumber: line, column: col + 1 };
					}
				}
			}
		}
		return null;
	}

	public getMatchedRanges(): IRange[] {
		if (!this._match) {
			return [];
		}
		return [this._match.opening, this._match.closing];
	}
}
