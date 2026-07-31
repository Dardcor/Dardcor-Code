import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerCurrentLineOptions {
	readonly renderLineHighlight: 'none' | 'gutter' | 'line' | 'all';
}

export interface IServerCurrentLineService {
	readonly onDidChangeOptions: Event<IServerCurrentLineOptions>;
	getOptions(): IServerCurrentLineOptions;
	setOptions(options: Partial<IServerCurrentLineOptions>): void;
}

export class ServerCurrentLineCommon implements IServerCurrentLineService {
	private _options: IServerCurrentLineOptions = {
		renderLineHighlight: 'line'
	};

	private readonly _onDidChangeOptions = new Emitter<IServerCurrentLineOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerCurrentLineOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerCurrentLineOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
