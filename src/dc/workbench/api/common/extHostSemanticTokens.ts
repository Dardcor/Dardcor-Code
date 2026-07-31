import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostSemanticTokens {
	private readonly _documentProviders = new Map<number, any>();
	private readonly _rangeProviders = new Map<number, any>();
	private _nextProviderId = 1;

	registerDocumentSemanticTokensProvider(selector: any, provider: any, legend: any): IDisposable {
		const id = this._nextProviderId++;
		this._documentProviders.set(id, { provider, legend });
		return { dispose: () => this._documentProviders.delete(id) };
	}

	registerDocumentRangeSemanticTokensProvider(selector: any, provider: any, legend: any): IDisposable {
		const id = this._nextProviderId++;
		this._rangeProviders.set(id, { provider, legend });
		return { dispose: () => this._rangeProviders.delete(id) };
	}
}
