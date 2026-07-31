import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostCodeAction {
	private readonly _providers = new Map<number, any>();
	private _nextProviderId = 1;

	registerCodeActionProvider(selector: any, provider: any, metadata?: any): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, { provider, metadata });

		return {
			dispose: () => {
				this._providers.delete(id);
			}
		};
	}

	async provideCodeActions(uri: any, rangeOrSelection: any, context: any): Promise<any[]> {
		return [];
	}
}
