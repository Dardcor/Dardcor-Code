import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostRename {
	private readonly _providers = new Map<number, any>();
	private _nextProviderId = 1;

	registerRenameProvider(selector: any, provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, provider);

		return {
			dispose: () => {
				this._providers.delete(id);
			}
		};
	}

	async provideRenameEdits(uri: any, position: any, newName: string): Promise<any> {
		return undefined;
	}
}
