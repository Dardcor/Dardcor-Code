import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerIndentGuidesOptions {
	readonly enabled: boolean;
	readonly highlightActiveIndentGuide: boolean;
	readonly highlightActiveBracketPair: boolean;
}

export interface IServerIndentGuidesService {
	readonly onDidChangeOptions: Event<IServerIndentGuidesOptions>;
	getOptions(): IServerIndentGuidesOptions;
	setOptions(options: Partial<IServerIndentGuidesOptions>): void;
}

export class ServerIndentGuidesCommon implements IServerIndentGuidesService {
	private _options: IServerIndentGuidesOptions = {
		enabled: true,
		highlightActiveIndentGuide: true,
		highlightActiveBracketPair: true
	};

	private readonly _onDidChangeOptions = new Emitter<IServerIndentGuidesOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerIndentGuidesOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerIndentGuidesOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
