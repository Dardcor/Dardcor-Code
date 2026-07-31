import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerInlineCompletion {
	readonly insertText: string;
	readonly filterText?: string;
	readonly range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly command?: { id: string; title: string; arguments?: any[] };
}

export interface IServerInlineCompletionsProvider {
	readonly id: string;
	provideInlineCompletions(uri: string, position: { line: number; column: number }, context: any): Promise<{ items: IServerInlineCompletion[] }>;
	freeInlineCompletions?(items: IServerInlineCompletion[]): void;
}

export interface IServerInlineCompletionsService {
	readonly onDidRegisterProvider: Event<IServerInlineCompletionsProvider>;
	registerProvider(provider: IServerInlineCompletionsProvider): IDisposable;
	getInlineCompletions(uri: string, position: { line: number; column: number }, context: any): Promise<IServerInlineCompletion[]>;
	freeInlineCompletions(items: IServerInlineCompletion[]): void;
}

export class ServerInlineCompletionsCommon implements IServerInlineCompletionsService {
	private readonly _providers = new Map<string, IServerInlineCompletionsProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerInlineCompletionsProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerProvider(provider: IServerInlineCompletionsProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async getInlineCompletions(uri: string, position: { line: number; column: number }, context: any): Promise<IServerInlineCompletion[]> {
		const completions: IServerInlineCompletion[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideInlineCompletions(uri, position, context);
			if (result && result.items) {
				completions.push(...result.items);
			}
		}
		return completions;
	}

	freeInlineCompletions(items: IServerInlineCompletion[]): void {
		for (const provider of this._providers.values()) {
			if (provider.freeInlineCompletions) {
				provider.freeInlineCompletions(items);
			}
		}
	}
}
