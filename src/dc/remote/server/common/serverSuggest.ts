import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerCompletionItem {
	readonly label: string;
	readonly insertText: string;
	readonly detail?: string;
	readonly documentation?: string;
	readonly kind?: number;
}

export interface IServerCompletionList {
	readonly items: IServerCompletionItem[];
	readonly isIncomplete?: boolean;
}

export interface IServerCompletionItemProvider {
	readonly id: string;
	readonly triggerCharacters?: string[];
	provideCompletionItems(uri: string, position: { line: number; column: number }, context: any): Promise<IServerCompletionList | undefined>;
	resolveCompletionItem?(item: IServerCompletionItem): Promise<IServerCompletionItem>;
}

export interface IServerSuggestService {
	readonly onDidRegisterProvider: Event<IServerCompletionItemProvider>;
	registerCompletionItemProvider(provider: IServerCompletionItemProvider): IDisposable;
	provideCompletionItems(uri: string, position: { line: number; column: number }, context: any): Promise<IServerCompletionList>;
	resolveCompletionItem(item: IServerCompletionItem): Promise<IServerCompletionItem>;
}

export class ServerSuggestCommon implements IServerSuggestService {
	private readonly _providers = new Map<string, IServerCompletionItemProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerCompletionItemProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerCompletionItemProvider(provider: IServerCompletionItemProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideCompletionItems(uri: string, position: { line: number; column: number }, context: any): Promise<IServerCompletionList> {
		const allItems: IServerCompletionItem[] = [];
		let isIncomplete = false;

		for (const provider of this._providers.values()) {
			const result = await provider.provideCompletionItems(uri, position, context);
			if (result) {
				allItems.push(...result.items);
				if (result.isIncomplete) {
					isIncomplete = true;
				}
			}
		}

		return { items: allItems, isIncomplete };
	}

	async resolveCompletionItem(item: IServerCompletionItem): Promise<IServerCompletionItem> {
		// Default no-op for generic resolution
		return item;
	}
}
