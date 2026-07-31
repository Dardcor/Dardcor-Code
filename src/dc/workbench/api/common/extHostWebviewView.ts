import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWebviewView {
	private readonly _providers = new Map<string, any>();

	registerWebviewViewProvider(viewId: string, provider: any, options?: any): IDisposable {
		this._providers.set(viewId, { provider, options });
		return { dispose: () => this._providers.delete(viewId) };
	}
}
