import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTreeDataProvider {
	private readonly _providers = new Map<string, any>();

	registerTreeDataProvider(viewId: string, treeDataProvider: any): IDisposable {
		this._providers.set(viewId, treeDataProvider);
		return { dispose: () => this._providers.delete(viewId) };
	}
}
