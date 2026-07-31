/**
 * Dardcor Code - Bracket Pair AST Parser
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel, IPosition, IRange } from "../../model/text-model.js";
import { BRACKET_PAIRS, BRACKET_COLORS } from "./bracket-colorizer.js";

const CLOSE_TO_OPEN: Record<string, string> = Object.fromEntries(
	Object.entries(BRACKET_PAIRS).map(([open, close]) => [close, open])
);

export interface IBracketPairNode {
	readonly openChar: string;
	readonly closeChar: string;
	readonly openRange: IRange;
	closeRange: IRange | null;

	readonly level: number;
	readonly index: number;
	parent: IBracketPairNode | null;
	readonly children: IBracketPairNode[];
}

export interface IBracketTokenPosition {
	readonly char: string;
	readonly isOpen: boolean;
	readonly lineNumber: number;
	readonly column: number;
}

export interface IBracketPairAST {
	readonly roots: readonly IBracketPairNode[];
	readonly pairs: readonly IBracketPairNode[];
	readonly unmatched: readonly IBracketTokenPosition[];
}

export interface IColorizedBracketRange {
	readonly range: IRange;
	readonly char: string;
	readonly color: string;
	readonly level: number;
}

interface _StackFrame {
	readonly token: IBracketTokenPosition;
	readonly node: IBracketPairNode;
}

export class BracketPairAST extends Disposable {
	private _roots: IBracketPairNode[] = [];
	private _pairs: IBracketPairNode[] = [];
	private _unmatched: IBracketTokenPosition[] = [];
	private _text: string = "";

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public parse(text: string): IBracketPairAST {
		this._text = text;
		this._roots = [];
		this._pairs = [];
		this._unmatched = [];
		const tokens = this._tokenize(text);
		const stack: _StackFrame[] = [];
		let nextIndex = 0;

		for (const token of tokens) {
			if (token.isOpen) {
				const node: IBracketPairNode = {
					openChar: token.char,
					closeChar: BRACKET_PAIRS[token.char],
					openRange: this._tokenRange(token),
					closeRange: null,
					level: stack.length,
					index: nextIndex++,
					parent: stack.length > 0 ? stack[stack.length - 1].node : null,
					children: []
				};
				if (stack.length > 0) {
					stack[stack.length - 1].node.children.push(node);
				} else {
					this._roots.push(node);
				}
				this._pairs.push(node);
				stack.push({ token, node });
			} else {
				const openChar = CLOSE_TO_OPEN[token.char];
				const top = stack.length > 0 ? stack[stack.length - 1] : null;
				if (top && top.token.char === openChar) {
					top.node.closeRange = this._tokenRange(token);
					stack.pop();
				} else {
					this._unmatched.push(token);
				}
			}
		}

		for (const frame of stack) {
			this._unmatched.push(frame.token);
		}
		this._onDidChange.fire();
		return this.getAST();
	}

	private _tokenize(text: string): IBracketTokenPosition[] {
		const tokens: IBracketTokenPosition[] = [];
		let quote: string | null = null;
		let lineComment = false;
		let blockComment = false;
		const lines = text.split(/\r?\n/);
		for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
			const line = lines[lineNumber - 1];
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
				if (BRACKET_PAIRS[ch]) {
					tokens.push({ char: ch, isOpen: true, lineNumber, column: col + 1 });
					continue;
				}
				if (CLOSE_TO_OPEN[ch]) {
					tokens.push({ char: ch, isOpen: false, lineNumber, column: col + 1 });
				}
			}
		}
		return tokens;
	}

	private _tokenRange(token: IBracketTokenPosition): IRange {
		return {
			startLineNumber: token.lineNumber,
			startColumn: token.column,
			endLineNumber: token.lineNumber,
			endColumn: token.column + 1
		};
	}

	public compute(model: ITextModel): void {
		this.parse(model.getValue());
	}

	public getAST(): IBracketPairAST {
		return {
			roots: this._roots,
			pairs: this._pairs,
			unmatched: this._unmatched
		};
	}

	public getPairAt(position: IPosition): IBracketPairNode | null {
		for (const pair of this._pairs) {
			const contains = (range: IRange) =>
				position.lineNumber === range.startLineNumber &&
				position.column >= range.startColumn &&
				position.column <= range.endColumn;
			if (contains(pair.openRange) || (pair.closeRange && contains(pair.closeRange))) {
				return pair;
			}
		}
		return null;
	}

	public getColorizedRanges(): IColorizedBracketRange[] {
		const result: IColorizedBracketRange[] = [];
		for (const pair of this._pairs) {
			const color = BRACKET_COLORS[pair.level % BRACKET_COLORS.length];
			result.push({ range: pair.openRange, char: pair.openChar, color, level: pair.level });
			if (pair.closeRange) {
				result.push({ range: pair.closeRange, char: pair.closeChar, color, level: pair.level });
			}
		}
		result.sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
		return result;
	}

	public getMatchingRange(position: IPosition): IRange | null {
		const pair = this.getPairAt(position);
		if (!pair) {
			return null;
		}
		const isOpen = position.lineNumber === pair.openRange.startLineNumber &&
			position.column >= pair.openRange.startColumn &&
			position.column <= pair.openRange.endColumn;
		return isOpen ? pair.closeRange : pair.openRange;
	}

	public getText(): string {
		return this._text;
	}

	public getPairCount(): number {
		return this._pairs.length;
	}

	public getUnmatchedCount(): number {
		return this._unmatched.length;
	}

	public isComplete(): boolean {
		return this._unmatched.length === 0;
	}
}

export function parseBracketPairs(text: string): IBracketPairAST {
	return new BracketPairAST().parse(text);
}
