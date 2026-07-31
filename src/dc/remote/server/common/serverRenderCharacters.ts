import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerRenderCharactersOptions {
	readonly letterSpacing: number;
	readonly fontWeight: string;
	readonly disableMonospaceOptimizations: boolean;
}

export interface IServerRenderCharactersService {
	readonly onDidChangeOptions: Event<IServerRenderCharactersOptions>;
	getOptions(): IServerRenderCharactersOptions;
	setOptions(options: Partial<IServerRenderCharactersOptions>): void;
}

export class ServerRenderCharactersCommon implements IServerRenderCharactersService {
	private _options: IServerRenderCharactersOptions = {
		letterSpacing: 0,
		fontWeight: 'normal',
		disableMonospaceOptimizations: false
	};

	private readonly _onDidChangeOptions = new Emitter<IServerRenderCharactersOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerRenderCharactersOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerRenderCharactersOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
