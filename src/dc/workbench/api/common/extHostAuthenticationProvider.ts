import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostAuthenticationProvider {
	private readonly _providers = new Map<string, any>();

	registerAuthenticationProvider(id: string, label: string, provider: any, options?: any): IDisposable {
		this._providers.set(id, provider);
		return { dispose: () => this._providers.delete(id) };
	}
}
