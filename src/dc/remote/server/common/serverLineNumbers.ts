import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerLineNumbersOptions {
	readonly enabled: boolean;
	readonly renderType: 'on' | 'off' | 'relative' | 'interval' | 'custom';
}

export interface IServerLineNumbersService {
	readonly onDidChangeOptions: Event<IServerLineNumbersOptions>;
	getOptions(): IServerLineNumbersOptions;
	setOptions(options: Partial<IServerLineNumbersOptions>): void;
}

export class ServerLineNumbersCommon implements IServerLineNumbersService {
	private _options: IServerLineNumbersOptions = {
		enabled: true,
		renderType: 'on'
	};

	private readonly _onDidChangeOptions = new Emitter<IServerLineNumbersOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerLineNumbersOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerLineNumbersOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
