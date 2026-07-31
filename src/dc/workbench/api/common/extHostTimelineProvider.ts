import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTimelineProvider {
	private readonly _providers = new Map<string, any>();

	registerTimelineProvider(provider: any): IDisposable {
		const id = provider.id;
		this._providers.set(id, provider);
		return { dispose: () => this._providers.delete(id) };
	}
}
