import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostFormat {
	private readonly _documentFormatProviders = new Map<number, any>();
	private readonly _rangeFormatProviders = new Map<number, any>();
	private readonly _onTypeFormatProviders = new Map<number, any>();
	private _nextProviderId = 1;

	registerDocumentFormattingEditProvider(selector: any, provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._documentFormatProviders.set(id, provider);
		return { dispose: () => this._documentFormatProviders.delete(id) };
	}

	registerDocumentRangeFormattingEditProvider(selector: any, provider: any): IDisposable {
		const id = this._nextProviderId++;
		this._rangeFormatProviders.set(id, provider);
		return { dispose: () => this._rangeFormatProviders.delete(id) };
	}

	registerOnTypeFormattingEditProvider(selector: any, provider: any, firstTriggerCharacter: string, ...moreTriggerCharacter: string[]): IDisposable {
		const id = this._nextProviderId++;
		this._onTypeFormatProviders.set(id, { provider, triggerCharacters: [firstTriggerCharacter, ...moreTriggerCharacter] });
		return { dispose: () => this._onTypeFormatProviders.delete(id) };
	}
}
