import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerSemanticTokensLegend {
	readonly tokenTypes: string[];
	readonly tokenModifiers: string[];
}

export interface IServerSemanticTokens {
	readonly resultId?: string;
	readonly data: Uint32Array;
}

export interface IServerSemanticTokensEdits {
	readonly resultId?: string;
	readonly edits: { start: number; deleteCount: number; data?: Uint32Array }[];
}

export interface IServerDocumentSemanticTokensProvider {
	readonly getLegend: () => IServerSemanticTokensLegend;
	provideDocumentSemanticTokens(uri: string): Promise<IServerSemanticTokens | null>;
	provideDocumentSemanticTokensEdits?(uri: string, previousResultId: string): Promise<IServerSemanticTokens | IServerSemanticTokensEdits | null>;
}

export interface IServerDocumentRangeSemanticTokensProvider {
	readonly getLegend: () => IServerSemanticTokensLegend;
	provideDocumentRangeSemanticTokens(uri: string, range: any): Promise<IServerSemanticTokens | null>;
}

export interface IServerSemanticTokensService {
	readonly onDidRegisterDocumentProvider: Event<IServerDocumentSemanticTokensProvider>;
	readonly onDidRegisterRangeProvider: Event<IServerDocumentRangeSemanticTokensProvider>;
	registerDocumentProvider(provider: IServerDocumentSemanticTokensProvider): IDisposable;
	registerRangeProvider(provider: IServerDocumentRangeSemanticTokensProvider): IDisposable;
	provideDocumentSemanticTokens(uri: string): Promise<IServerSemanticTokens | null>;
	provideDocumentRangeSemanticTokens(uri: string, range: any): Promise<IServerSemanticTokens | null>;
}

export class ServerSemanticTokensCommon implements IServerSemanticTokensService {
	private readonly _docProviders = new Set<IServerDocumentSemanticTokensProvider>();
	private readonly _rangeProviders = new Set<IServerDocumentRangeSemanticTokensProvider>();

	private readonly _onDidRegisterDocumentProvider = new Emitter<IServerDocumentSemanticTokensProvider>();
	readonly onDidRegisterDocumentProvider = this._onDidRegisterDocumentProvider.event;

	private readonly _onDidRegisterRangeProvider = new Emitter<IServerDocumentRangeSemanticTokensProvider>();
	readonly onDidRegisterRangeProvider = this._onDidRegisterRangeProvider.event;

	registerDocumentProvider(provider: IServerDocumentSemanticTokensProvider): IDisposable {
		this._docProviders.add(provider);
		this._onDidRegisterDocumentProvider.fire(provider);
		return { dispose: () => { this._docProviders.delete(provider); } };
	}

	registerRangeProvider(provider: IServerDocumentRangeSemanticTokensProvider): IDisposable {
		this._rangeProviders.add(provider);
		this._onDidRegisterRangeProvider.fire(provider);
		return { dispose: () => { this._rangeProviders.delete(provider); } };
	}

	async provideDocumentSemanticTokens(uri: string): Promise<IServerSemanticTokens | null> {
		for (const provider of this._docProviders) {
			const tokens = await provider.provideDocumentSemanticTokens(uri);
			if (tokens) return tokens;
		}
		return null;
	}

	async provideDocumentRangeSemanticTokens(uri: string, range: any): Promise<IServerSemanticTokens | null> {
		for (const provider of this._rangeProviders) {
			const tokens = await provider.provideDocumentRangeSemanticTokens(uri, range);
			if (tokens) return tokens;
		}
		return null;
	}
}
