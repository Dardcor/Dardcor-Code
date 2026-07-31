import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTaskProvider {
	private readonly _providers = new Map<number, any>();
	private _nextProviderId = 1;

	registerTaskProvider(type: string, provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, { type, provider });
		return { dispose: () => this._providers.delete(id) };
	}
}
