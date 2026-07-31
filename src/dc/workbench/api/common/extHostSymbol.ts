import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostSymbol {
	private readonly _documentSymbolProviders = new Map<number, any>();
	private readonly _workspaceSymbolProviders = new Map<number, any>();
	private _nextProviderId = 1;

	registerDocumentSymbolProvider(selector: any, provider: any, metadata?: any): IDisposable {
		const id = this._nextProviderId++;
		this._documentSymbolProviders.set(id, provider);
		return { dispose: () => this._documentSymbolProviders.delete(id) };
	}

	registerWorkspaceSymbolProvider(provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._workspaceSymbolProviders.set(id, provider);
		return { dispose: () => this._workspaceSymbolProviders.delete(id) };
	}
}
