/**
 * Dardcor Code - Global Workspace Symbol Search Interface
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { toDisposable } from "../../../core/lifecycle/disposable.js";
import { CancellationToken } from "../../../core/async/cancellation.js";
import { URI } from "../../../core/types/uri.js";
import { IRange } from "../../model/text-model.js";
import { SymbolKind } from "./goto-symbol.js";

export interface IWorkspaceSymbol {
	readonly name: string;
	readonly kind: SymbolKind;
	readonly uri: URI;
	readonly range: IRange;
	readonly detail: string;
}

export interface IWorkspaceSymbolProvider {
	readonly scheme: string;
	provideWorkspaceSymbols(query: string, token: CancellationToken): IWorkspaceSymbol[] | null | Promise<IWorkspaceSymbol[] | null>;
}

export interface IWorkspaceSymbolSearchResult {
	readonly symbols: readonly IWorkspaceSymbol[];
	readonly providerCount: number;
	readonly durationMs: number;
}

/**
 * Registry + aggregator for workspace-wide symbol search. Providers are
 * registered per URI scheme (e.g. "file"); `search` fans out the query to all
 * providers, deduplicates identical symbols and caps the result list.
 */
export class WorkspaceSymbolProviderRegistry extends Disposable {
	private readonly _providers: IWorkspaceSymbolProvider[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public register(provider: IWorkspaceSymbolProvider): IDisposable {
		this._providers.push(provider);
		this._onDidChange.fire();
		return toDisposable(() => this.unregister(provider));
	}

	public unregister(provider: IWorkspaceSymbolProvider): void {
		const index = this._providers.indexOf(provider);
		if (index !== -1) {
			this._providers.splice(index, 1);
			this._onDidChange.fire();
		}
	}

	public getProviders(): readonly IWorkspaceSymbolProvider[] {
		return this._providers;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public async search(query: string, limit: number = 100): Promise<IWorkspaceSymbolSearchResult> {
		const startedAt = Date.now();
		const results: IWorkspaceSymbol[] = [];
		const seen = new Set<string>();
		await Promise.all(this._providers.map(async provider => {
			try {
				const symbols = await provider.provideWorkspaceSymbols(query, CancellationToken.None);
				if (!symbols) {
					return;
				}
				for (const symbol of symbols) {
					const key = `${symbol.uri.toString()}#${symbol.name}:${symbol.range.startLineNumber}:${symbol.range.startColumn}`;
					if (!seen.has(key)) {
						seen.add(key);
						results.push(symbol);
					}
				}
			} catch {
				// A failing provider must not break the search
			}
		}));
		results.sort((a, b) => {
			if (a.name !== b.name) {
				return a.name.localeCompare(b.name);
			}
			return a.uri.toString().localeCompare(b.uri.toString());
		});
		return {
			symbols: results.slice(0, limit),
			providerCount: this._providers.length,
			durationMs: Date.now() - startedAt
		};
	}
}

/**
 * Default provider that searches a fixed in-memory index of files. Useful as
 * a fallback when no language service is present.
 */
export class IndexedWorkspaceSymbolProvider implements IWorkspaceSymbolProvider {
	readonly scheme: string = "file";
	private readonly _index: IWorkspaceSymbol[] = [];

	constructor(symbols: IWorkspaceSymbol[] = []) {
		this._index = symbols;
	}

	public setSymbols(symbols: IWorkspaceSymbol[]): void {
		this._index.length = 0;
		this._index.push(...symbols);
	}

	public async provideWorkspaceSymbols(query: string, token: CancellationToken): Promise<IWorkspaceSymbol[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		const q = query.toLowerCase();
		if (q.length === 0) {
			return [...this._index];
		}
		return this._index.filter(symbol =>
			symbol.name.toLowerCase().includes(q) || symbol.detail.toLowerCase().includes(q)
		);
	}
}
