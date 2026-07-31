import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerSnippet {
	readonly name: string;
	readonly prefix: string;
	readonly description?: string;
	readonly body: string;
	readonly source?: string;
}

export interface IServerSnippetProvider {
	readonly id: string;
	provideSnippets(languageId: string): Promise<IServerSnippet[]>;
}

export interface IServerSnippetService {
	readonly onDidChangeSnippets: Event<void>;
	registerSnippetProvider(provider: IServerSnippetProvider): IDisposable;
	getSnippets(languageId: string): Promise<IServerSnippet[]>;
	insertSnippet(uri: string, snippetBody: string, position: { line: number; column: number }): Promise<void>;
}

export class ServerSnippetCommon implements IServerSnippetService {
	private readonly _providers = new Map<string, IServerSnippetProvider>();

	private readonly _onDidChangeSnippets = new Emitter<void>();
	readonly onDidChangeSnippets = this._onDidChangeSnippets.event;

	registerSnippetProvider(provider: IServerSnippetProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidChangeSnippets.fire();
		return {
			dispose: () => {
				this._providers.delete(provider.id);
				this._onDidChangeSnippets.fire();
			}
		};
	}

	async getSnippets(languageId: string): Promise<IServerSnippet[]> {
		const snippets: IServerSnippet[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideSnippets(languageId);
			if (result) {
				snippets.push(...result);
			}
		}
		return snippets;
	}

	async insertSnippet(_uri: string, _snippetBody: string, _position: { line: number; column: number }): Promise<void> {}
}
