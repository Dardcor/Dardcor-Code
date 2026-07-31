/**
 * Dardcor Code - LSP Syntax-Aware Folding Range Provider
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel } from "../../model/text-model.js";
import { IFoldingRange } from "./folding-ranges.js";

export interface IFoldingRangeContext {
	readonly rangesLimit?: number;
	readonly lineFoldingOnly?: boolean;
}

export interface IFoldingRangeProvider {
	provideFoldingRanges(
		model: ITextModel,
		context: IFoldingRangeContext,
		token: CancellationToken
	): IFoldingRange[] | null | Promise<IFoldingRange[] | null>;
}

interface _OpenBlock {
	readonly line: number;
	readonly indent: number;
	readonly isComment: boolean;
}

export function computeSyntaxFoldingRanges(model: ITextModel, context: IFoldingRangeContext = {}): IFoldingRange[] {
	const ranges: IFoldingRange[] = [];
	const lineCount = model.getLineCount();
	const stack: _OpenBlock[] = [];
	let blockComment = false;
	const rangesLimit = context.rangesLimit ?? 500;

	const closeBlock = (endLine: number): void => {
		const open = stack.pop();
		if (open && endLine > open.line + 1) {
			ranges.push({
				startLineNumber: open.line,
				endLineNumber: endLine,
				indentLevel: open.indent,
				isComment: open.isComment
			});
		}
	};

	for (let line = 1; line <= lineCount && ranges.length < rangesLimit; line++) {
		const text = model.getLineContent(line);
		const indent = countIndent(text);
		let quote: string | null = null;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			const next = text[i + 1] ?? "";
			if (blockComment) {
				if (ch === "*" && next === "/") {
					blockComment = false;
					closeBlock(line);
					i++;
				}
				continue;
			}
			if (quote) {
				if (ch === quote && text[i - 1] !== "\\") {
					quote = null;
				}
				continue;
			}
			if (ch === "/" && next === "/") {
				break;
			}
			if (ch === "/" && next === "*") {
				blockComment = true;
				stack.push({ line, indent, isComment: true });
				i++;
				continue;
			}
			if (ch === "'" || ch === "\"" || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "{") {
				stack.push({ line, indent, isComment: false });
				continue;
			}
			if (ch === "}") {
				closeBlock(line);
			}
		}
	}

	for (let i = stack.length - 1; i >= 0; i--) {
		const open = stack[i];
		if (lineCount > open.line + 1) {
			ranges.push({
				startLineNumber: open.line,
				endLineNumber: lineCount,
				indentLevel: open.indent,
				isComment: open.isComment
			});
		}
	}

	ranges.sort((a, b) => a.startLineNumber - b.startLineNumber);
	return ranges.slice(0, rangesLimit);
}

function countIndent(text: string): number {
	let level = 0;
	for (const ch of text) {
		if (ch === " ") {
			level++;
		} else if (ch === "\t") {
			level += 4;
		} else {
			break;
		}
	}
	return Math.floor(level / 4);
}

export class SyntaxFoldingProvider implements IFoldingRangeProvider {
	public async provideFoldingRanges(model: ITextModel, context: IFoldingRangeContext, token: CancellationToken): Promise<IFoldingRange[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		return computeSyntaxFoldingRanges(model, context);
	}
}

export class SyntaxFoldingRegistry extends Disposable {
	private readonly _providers: IFoldingRangeProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IFoldingRangeProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IFoldingRangeProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IFoldingRangeProvider[] {
		return this._providers;
	}

	public async provideFoldingRanges(model: ITextModel, context: IFoldingRangeContext = {}): Promise<IFoldingRange[]> {
		if (this._providers.length === 0) {
			return computeSyntaxFoldingRanges(model, context);
		}
		const results: IFoldingRange[] = [];
		for (const provider of this._providers) {
			try {
				const ranges = await provider.provideFoldingRanges(model, context, CancellationToken.None);
				if (ranges) {
					results.push(...ranges);
				}
			} catch {
				// Continue with the next provider
			}
		}
		results.sort((a, b) => a.startLineNumber - b.startLineNumber);
		return results;
	}
}
