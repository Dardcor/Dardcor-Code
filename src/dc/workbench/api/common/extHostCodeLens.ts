import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostCodeLens {
	private readonly _providers = new Map<number, any>();
	private _nextProviderId = 1;

	registerCodeLensProvider(selector: any, provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, provider);

		return {
			dispose: () => {
				this._providers.delete(id);
			}
		};
	}

	async provideCodeLenses(uri: any): Promise<any[]> {
		// Mock
		return [];
	}
}
