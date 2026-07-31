import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostReference {
	private readonly _providers = new Map<number, any>();
	private _nextProviderId = 1;

	registerReferenceProvider(selector: any, provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, provider);

		return {
			dispose: () => {
				this._providers.delete(id);
			}
		};
	}

	async provideReferences(uri: any, position: any, context: any): Promise<any[]> {
		return [];
	}
}
