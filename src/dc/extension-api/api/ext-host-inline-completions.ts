import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { DocumentSelector, matchesSelector } from './ext-host-languages';
import { TextDocument } from './ext-host-documents';
import { Position, Range } from './ext-host-api-impl';
import { CancellationToken } from '../../core/async/cancellation';

export interface ISelectedCompletionInfo {
	text: string;
	range: Range;
}

export interface IInlineCompletionContext {
	triggerKind: number;
	selectedCompletionInfo?: ISelectedCompletionInfo;
}

export interface IInlineCompletionItem {
	insertText: string | { snippet: string };
	range?: Range;
	filterText?: string;
	command?: { title: string; command: string; arguments?: any[] };
}

export interface IInlineCompletionList {
	items: IInlineCompletionItem[];
}

export interface IInlineCompletionItemProvider {
	provideInlineCompletionItems(document: TextDocument, position: Position, context: IInlineCompletionContext, token: CancellationToken): IInlineCompletionItem[] | IInlineCompletionList | Promise<IInlineCompletionItem[] | IInlineCompletionList | undefined> | undefined;
}

interface IInlineCompletionProviderRegistration {
	readonly selector: DocumentSelector;
	readonly provider: IInlineCompletionItemProvider;
}

export class ExtHostInlineCompletions extends Disposable {
	private readonly _providers: IInlineCompletionProviderRegistration[] = [];

	public registerInlineCompletionItemProvider(selector: DocumentSelector, provider: IInlineCompletionItemProvider): IDisposable {
		const registration: IInlineCompletionProviderRegistration = { selector, provider };
		this._providers.push(registration);
		return toDisposable(() => {
			const index = this._providers.indexOf(registration);
			if (index !== -1) {
				this._providers.splice(index, 1);
			}
		});
	}

	public async provideInlineCompletionItems(document: TextDocument, position: Position, context: IInlineCompletionContext, token: CancellationToken = CancellationToken.None): Promise<IInlineCompletionItem[]> {
		const items: IInlineCompletionItem[] = [];
		for (const registration of this._providers) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			const provided = await registration.provider.provideInlineCompletionItems(document, position, context, token);
			if (!provided) {
				continue;
			}
			const list = Array.isArray(provided) ? provided : provided.items;
			items.push(...list);
		}
		return items;
	}

	public hasProviderFor(document: TextDocument): boolean {
		return this._providers.some(registration => matchesSelector(registration.selector, document.uri, document.languageId));
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public override dispose(): void {
		this._providers.length = 0;
		super.dispose();
	}
}
