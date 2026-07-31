import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerBracketGuidesOptions {
	readonly enabled: boolean;
	readonly highlightActiveBracketPair: boolean;
	readonly renderBracketGuides: boolean;
}

export interface IServerBracketGuidesService {
	readonly onDidChangeOptions: Event<IServerBracketGuidesOptions>;
	getOptions(): IServerBracketGuidesOptions;
	setOptions(options: Partial<IServerBracketGuidesOptions>): void;
}

export class ServerBracketGuidesCommon implements IServerBracketGuidesService {
	private _options: IServerBracketGuidesOptions = {
		enabled: true,
		highlightActiveBracketPair: true,
		renderBracketGuides: true
	};

	private readonly _onDidChangeOptions = new Emitter<IServerBracketGuidesOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerBracketGuidesOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerBracketGuidesOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
