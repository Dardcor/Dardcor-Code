import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostLanguageConfiguration {
	private readonly _providers = new Map<string, any>();

	setLanguageConfiguration(language: string, configuration: any): IDisposable {
		this._providers.set(language, configuration);
		return { dispose: () => this._providers.delete(language) };
	}
}
