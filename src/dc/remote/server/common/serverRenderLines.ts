import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerRenderLinesOptions {
	readonly lineHeight: number;
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly fontLigatures: boolean | string;
}

export interface IServerRenderLinesService {
	readonly onDidChangeOptions: Event<IServerRenderLinesOptions>;
	getOptions(): IServerRenderLinesOptions;
	setOptions(options: Partial<IServerRenderLinesOptions>): void;
}

export class ServerRenderLinesCommon implements IServerRenderLinesService {
	private _options: IServerRenderLinesOptions = {
		lineHeight: 22,
		fontFamily: 'Consolas, "Courier New", monospace',
		fontSize: 14,
		fontLigatures: false
	};

	private readonly _onDidChangeOptions = new Emitter<IServerRenderLinesOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerRenderLinesOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerRenderLinesOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
