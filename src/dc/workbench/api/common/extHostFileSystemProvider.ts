import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostFileSystemProvider {
	private readonly _providers = new Map<string, any>();

	registerFileSystemProvider(scheme: string, provider: any, options?: { isCaseSensitive?: boolean; isReadonly?: boolean }): IDisposable {
		this._providers.set(scheme, { provider, options });
		return { dispose: () => this._providers.delete(scheme) };
	}
}
