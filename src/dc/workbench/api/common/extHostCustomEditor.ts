import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostCustomEditor {
	private readonly _providers = new Map<string, any>();

	registerCustomEditorProvider(viewType: string, provider: any, options?: any): IDisposable {
		this._providers.set(viewType, { provider, options });
		return { dispose: () => this._providers.delete(viewType) };
	}
}
