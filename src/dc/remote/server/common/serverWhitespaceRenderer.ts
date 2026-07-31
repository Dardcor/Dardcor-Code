import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerWhitespaceRendererOptions {
	readonly renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
}

export interface IServerWhitespaceRendererService {
	readonly onDidChangeOptions: Event<IServerWhitespaceRendererOptions>;
	getOptions(): IServerWhitespaceRendererOptions;
	setOptions(options: Partial<IServerWhitespaceRendererOptions>): void;
}

export class ServerWhitespaceRendererCommon implements IServerWhitespaceRendererService {
	private _options: IServerWhitespaceRendererOptions = {
		renderWhitespace: 'none'
	};

	private readonly _onDidChangeOptions = new Emitter<IServerWhitespaceRendererOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerWhitespaceRendererOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerWhitespaceRendererOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
