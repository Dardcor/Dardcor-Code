import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostSuggest {
	private readonly _providers = new Map<number, any>();
	private _nextProviderId = 1;

	registerCompletionItemProvider(selector: any, provider: any, triggerCharacters: string[]): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, { provider, triggerCharacters });

		return {
			dispose: () => {
				this._providers.delete(id);
			}
		};
	}

	async provideCompletionItems(uri: any, position: any, context: any): Promise<any> {
		return undefined;
	}
}
