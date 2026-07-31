/**
 * Dardcor Code - Document Symbol Provider Interface & Registry
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { ITextModel } from "../../model/text-model.js";
import { IDocumentSymbol, SymbolKind } from "./goto-symbol.js";

export interface IDocumentSymbolContext {
	readonly depthLimit?: number;
}

export interface IDocumentSymbolProvider {
	provideDocumentSymbols(
		model: ITextModel,
		context: IDocumentSymbolContext,
		token: CancellationToken
	): IDocumentSymbol[] | null | Promise<IDocumentSymbol[] | null>;
}

const SYMBOL_PATTERNS: { regex: RegExp; kind: SymbolKind; nameGroup: number }[] = [
	{ regex: /^\s*(?:export\s+|declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Function, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Class, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Interface, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Enum, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?namespace\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/, kind: SymbolKind.Namespace, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: SymbolKind.TypeParameter, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:type|abstract|readonly|static|public|private|protected|async)*\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;]+)?\{/, kind: SymbolKind.Method, nameGroup: 1 },
	{ regex: /^\s*(?:export\s+)?(?:let|const|var)\s+([A-Za-z_$][\w$]*)/, kind: SymbolKind.Variable, nameGroup: 1 }
];

export class RegexDocumentSymbolProvider implements IDocumentSymbolProvider {
	public async provideDocumentSymbols(model: ITextModel, context: IDocumentSymbolContext, token: CancellationToken): Promise<IDocumentSymbol[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		const symbols: IDocumentSymbol[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			for (const pattern of SYMBOL_PATTERNS) {
				const match = pattern.regex.exec(text);
				if (match) {
					const name = match[pattern.nameGroup];
					if (name && !/^(if|for|while|switch|catch)\b/.test(name)) {
						symbols.push({
							name,
							kind: pattern.kind,
							range: {
								startLineNumber: line,
								startColumn: 1,
								endLineNumber: line,
								endColumn: Math.max(1, text.length)
							},
							detail: text.trim()
						});
						break;
					}
				}
			}
		}
		return symbols;
	}
}

export class DocumentSymbolProviderRegistry extends Disposable {
	private readonly _providers: IDocumentSymbolProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IDocumentSymbolProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IDocumentSymbolProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IDocumentSymbolProvider[] {
		return this._providers;
	}

	public async provideDocumentSymbols(model: ITextModel, context: IDocumentSymbolContext = {}): Promise<IDocumentSymbol[]> {
		const results: IDocumentSymbol[] = [];
		const seen = new Set<string>();
		for (const provider of this._providers) {
			try {
				const symbols = await provider.provideDocumentSymbols(model, context, CancellationToken.None);
				if (symbols) {
					for (const symbol of symbols) {
						const key = `${symbol.name}@${symbol.range.startLineNumber}:${symbol.range.startColumn}`;
						if (!seen.has(key)) {
							seen.add(key);
							results.push(symbol);
						}
					}
				}
			} catch {
				// A failing provider must not break the aggregation
			}
		}
		results.sort((a, b) => {
			if (a.range.startLineNumber !== b.range.startLineNumber) {
				return a.range.startLineNumber - b.range.startLineNumber;
			}
			return a.range.startColumn - b.range.startColumn;
		});
		return results;
	}
}
