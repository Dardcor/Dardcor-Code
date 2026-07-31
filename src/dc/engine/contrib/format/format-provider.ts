/**
 * Dardcor Code - Document Formatting Provider Interface & Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel, IRange } from "../../model/text-model.js";
import { IFormatProvider, IFormattingEdit, IFormattingOptions } from "./format-controller.js";

export class FormatProviderRegistry extends Disposable {
	private readonly _providers: IFormatProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IFormatProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IFormatProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IFormatProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async provideDocumentFormattingEdits(model: ITextModel, options: IFormattingOptions): Promise<IFormattingEdit[]> {
		for (const provider of this._providers) {
			try {
				const edits = await provider.provideDocumentFormattingEdits(model, options, CancellationToken.None);
				if (edits && edits.length > 0) {
					return edits;
				}
			} catch {
				// Try the next provider
			}
		}
		return [];
	}

	public async provideRangeFormattingEdits(model: ITextModel, range: IRange, options: IFormattingOptions): Promise<IFormattingEdit[]> {
		for (const provider of this._providers) {
			const provide = provider.provideRangeFormattingEdits;
			if (provide) {
				try {
					const edits = await provide.call(provider, model, range, options, CancellationToken.None);
					if (edits && edits.length > 0) {
						return edits;
					}
				} catch {
					// Try the next provider
				}
			}
		}
		return [];
	}
}

export class IndentFormatProvider implements IFormatProvider {
	public async provideDocumentFormattingEdits(model: ITextModel, options: IFormattingOptions, token: CancellationToken): Promise<IFormattingEdit[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		return this._computeIndentEdits(model, options);
	}

	public async provideRangeFormattingEdits(model: ITextModel, range: IRange, options: IFormattingOptions, token: CancellationToken): Promise<IFormattingEdit[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		const startLine = range.startLineNumber;
		const endLine = Math.min(range.endLineNumber, model.getLineCount());
		const edits: IFormattingEdit[] = [];
		let depth = this._depthBeforeLine(model, startLine);
		for (let line = startLine; line <= endLine; line++) {
			const text = model.getLineContent(line);
			const trimmed = text.trim();
			if (trimmed.length === 0) {
				continue;
			}
			if (trimmed.startsWith("}") || trimmed.startsWith("]") || trimmed.startsWith(")")) {
				depth = Math.max(0, depth - 1);
			}
			const expected = this._indentString(depth, options);
			const current = this._leadingWhitespace(text);
			if (current !== expected) {
				edits.push({
					range: {
						startLineNumber: line,
						startColumn: 1,
						endLineNumber: line,
						endColumn: current.length + 1
					},
					text: expected
				});
			}
			depth += this._braceDelta(trimmed);
		}
		return edits;
	}

	private async _computeIndentEdits(model: ITextModel, options: IFormattingOptions): Promise<IFormattingEdit[]> {
		const edits: IFormattingEdit[] = [];
		const lineCount = model.getLineCount();
		let depth = 0;
		let quote: string | null = null;
		let blockComment = false;
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			const trimmed = text.trim();
			if (trimmed.length === 0) {
				continue;
			}
			if (blockComment) {
				if (trimmed.includes("*/")) {
					blockComment = false;
				}
				continue;
			}
			if (trimmed.startsWith("/*")) {
				blockComment = !trimmed.includes("*/");
				continue;
			}
			if (/^\s*(?:case\b|default\s*:)/.test(text)) {
				depth = Math.max(0, depth - 1);
			}
			if (trimmed.startsWith("}") || trimmed.startsWith("]") || trimmed.startsWith(")")) {
				depth = Math.max(0, depth - 1);
			}
			const expected = this._indentString(depth, options);
			const current = this._leadingWhitespace(text);
			if (current !== expected) {
				edits.push({
					range: {
						startLineNumber: line,
						startColumn: 1,
						endLineNumber: line,
						endColumn: current.length + 1
					},
					text: expected
				});
			}
			depth += this._braceDelta(text);
		}
		void quote;
		return edits;
	}

	private _braceDelta(text: string): number {
		let delta = 0;
		let quote: string | null = null;
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			const next = text[i + 1] ?? "";
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
				break;
			}
			if (ch === "'" || ch === "\"" || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "{") {
				delta++;
			} else if (ch === "}") {
				delta--;
			}
		}
		return delta;
	}

	private _depthBeforeLine(model: ITextModel, line: number): number {
		let depth = 0;
		for (let i = 1; i < Math.min(line, model.getLineCount() + 1); i++) {
			const text = model.getLineContent(i);
			if (text.trim().startsWith("/*")) {
				continue;
			}
			depth += this._braceDelta(text);
		}
		return Math.max(0, depth);
	}

	private _indentString(depth: number, options: IFormattingOptions): string {
		if (options.insertSpaces) {
			return " ".repeat(depth * (options.tabSize ?? 4));
		}
		return "\t".repeat(depth);
	}

	private _leadingWhitespace(text: string): string {
		let index = 0;
		while (index < text.length && (text[index] === " " || text[index] === "\t")) {
			index++;
		}
		return text.substring(0, index);
	}
}

export type { IFormatProvider, IFormattingEdit, IFormattingOptions } from "./format-controller.js";
