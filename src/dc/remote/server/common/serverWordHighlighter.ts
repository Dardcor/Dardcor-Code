import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerDocumentHighlight {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly kind: 'text' | 'read' | 'write';
}

export interface IServerDocumentHighlightProvider {
	readonly id: string;
	provideDocumentHighlights(uri: string, position: { line: number; column: number }): Promise<IServerDocumentHighlight[] | undefined>;
}

export interface IServerWordHighlighterService {
	readonly onDidRegisterProvider: Event<IServerDocumentHighlightProvider>;
	registerDocumentHighlightProvider(provider: IServerDocumentHighlightProvider): IDisposable;
	provideDocumentHighlights(uri: string, position: { line: number; column: number }): Promise<IServerDocumentHighlight[]>;
}

export class ServerWordHighlighterCommon implements IServerWordHighlighterService {
	private readonly _providers = new Map<string, IServerDocumentHighlightProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerDocumentHighlightProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerDocumentHighlightProvider(provider: IServerDocumentHighlightProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideDocumentHighlights(uri: string, position: { line: number; column: number }): Promise<IServerDocumentHighlight[]> {
		const highlights: IServerDocumentHighlight[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideDocumentHighlights(uri, position);
			if (result) {
				highlights.push(...result);
			}
		}
		return highlights;
	}
}
