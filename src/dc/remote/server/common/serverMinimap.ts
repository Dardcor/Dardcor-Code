import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerMinimapOptions {
	readonly enabled: boolean;
	readonly renderCharacters: boolean;
	readonly maxColumn: number;
	readonly scale: number;
}

export interface IServerMinimapService {
	readonly onDidChangeOptions: Event<IServerMinimapOptions>;
	getOptions(): IServerMinimapOptions;
	setOptions(options: Partial<IServerMinimapOptions>): void;
}

export class ServerMinimapCommon implements IServerMinimapService {
	private _options: IServerMinimapOptions = {
		enabled: true,
		renderCharacters: true,
		maxColumn: 120,
		scale: 1
	};

	private readonly _onDidChangeOptions = new Emitter<IServerMinimapOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerMinimapOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerMinimapOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
