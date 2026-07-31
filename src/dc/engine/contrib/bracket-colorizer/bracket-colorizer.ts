/**
 * Dardcor Code - Colorized Bracket Pair Renderer
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export const BRACKET_PAIRS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"<": ">"
};

const CLOSE_TO_OPEN: Record<string, string> = Object.fromEntries(
	Object.entries(BRACKET_PAIRS).map(([open, close]) => [close, open])
);

export const BRACKET_COLORS: readonly string[] = [
	"#ffd700",
	"#da70d6",
	"#179fff",
	"#4ec9b0",
	"#f14c4c",
	"#ce9178",
	"#c586c0",
	"#569cd6"
];

export interface IBracketToken {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly char: string;
	readonly level: number;
	readonly isOpen: boolean;
}

export interface IColorizedBracket {
	readonly range: IRange;
	readonly char: string;
	readonly color: string;
}

export class BracketColorizer extends Disposable {
	private _tokens: IBracketToken[] = [];
	private _colorized: IColorizedBracket[] = [];
	private _model: ITextModel | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.refresh();
	}

	public refresh(): void {
		const model = this._model;
		if (!model) {
			this._tokens = [];
			this._colorized = [];
			this._onDidChange.fire();
			return;
		}
		this._tokens = this.tokenize(model.getValue());
		this._colorized = this._toRanges(this._tokens, model);
		this._onDidChange.fire();
	}

	public tokenize(text: string): IBracketToken[] {
		const tokens: IBracketToken[] = [];
		const stack: { char: string; level: number; openOffset: number }[] = [];
		let quote: string | null = null;
		let lineComment = false;
		let blockComment = false;

		const lines = text.split(/\r?\n/);
		let offset = 0;
		for (const line of lines) {
			lineComment = false;
			for (let col = 0; col < line.length; col++) {
				const ch = line[col];
				const next = line[col + 1] ?? "";
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
					if (ch === quote && line[col - 1] !== "\\") {
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
				if (ch === "'" || ch === "\"" || ch === "`") {
					quote = ch;
					continue;
				}
				const close = BRACKET_PAIRS[ch];
				if (close) {
					const level = stack.length;
					tokens.push({ startOffset: offset + col, endOffset: offset + col + 1, char: ch, level, isOpen: true });
					stack.push({ char: ch, level, openOffset: offset + col });
					continue;
				}
				const openChar = CLOSE_TO_OPEN[ch];
				if (openChar) {
					// ch is a closing bracket
					if (stack.length > 0 && stack[stack.length - 1].char === openChar) {
						const opened = stack.pop()!;
						tokens.push({ startOffset: offset + col, endOffset: offset + col + 1, char: ch, level: opened.level, isOpen: false });
					} else {
						// Unmatched closing bracket: color at current depth.
						tokens.push({ startOffset: offset + col, endOffset: offset + col + 1, char: ch, level: 0, isOpen: false });
					}
				}
			}
			offset += line.length + 1;
		}
		// Colorize remaining unmatched open brackets at their stack depth.
		for (const opened of stack) {
			tokens.push({ startOffset: opened.openOffset, endOffset: opened.openOffset + 1, char: opened.char, level: opened.level, isOpen: true });
		}
		return tokens;
	}

	private _toRanges(tokens: IBracketToken[], model: ITextModel): IColorizedBracket[] {
		const result: IColorizedBracket[] = [];
		const offsets = this._computeLineOffsets(model);
		for (const token of tokens) {
			const pos = this._offsetToPosition(offsets, token.startOffset, model.getLineCount());
			if (!pos) {
				continue;
			}
			result.push({
				range: {
					startLineNumber: pos.lineNumber,
					startColumn: pos.column,
					endLineNumber: pos.lineNumber,
					endColumn: pos.column + 1
				},
				char: token.char,
				color: BRACKET_COLORS[token.level % BRACKET_COLORS.length]
			});
		}
		return result;
	}

	private _computeLineOffsets(model: ITextModel): number[] {
		const offsets: number[] = [0];
		for (let line = 1; line <= model.getLineCount(); line++) {
			offsets.push(offsets[offsets.length - 1] + model.getLineContent(line).length + 1);
		}
		return offsets;
	}

	private _offsetToPosition(offsets: number[], offset: number, lineCount: number): { lineNumber: number; column: number } | null {
		for (let line = 1; line <= lineCount; line++) {
			const start = offsets[line - 1];
			const end = offsets[line];
			if (offset >= start && offset < end) {
				return { lineNumber: line, column: offset - start + 1 };
			}
		}
		return null;
	}

	public getColorizedBrackets(): readonly IColorizedBracket[] {
		return this._colorized;
	}

	public getTokens(): readonly IBracketToken[] {
		return this._tokens;
	}

	public renderHtml(text: string): string {
		const tokens = this.tokenize(text);
		const tokenMap = new Map<number, IBracketToken>();
		for (const token of tokens) {
			tokenMap.set(token.startOffset, token);
		}
		let out = "";
		for (let i = 0; i < text.length; i++) {
			const token = tokenMap.get(i);
			if (token) {
				const color = BRACKET_COLORS[token.level % BRACKET_COLORS.length];
				out += `<span style="color:${color};font-weight:bold;">${this._escape(text[i])}</span>`;
			} else {
				out += this._escape(text[i]);
			}
		}
		return out;
	}

	private _escape(ch: string): string {
		return ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
	}
}
