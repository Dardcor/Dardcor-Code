import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerSelectionRendererOptions {
	readonly showCornerRender: boolean;
	readonly cornerStyle: 'square' | 'rounded';
	readonly color: string;
}

export interface IServerSelectionRendererService {
	readonly onDidChangeOptions: Event<IServerSelectionRendererOptions>;
	getOptions(): IServerSelectionRendererOptions;
	setOptions(options: Partial<IServerSelectionRendererOptions>): void;
}

export class ServerSelectionRendererCommon implements IServerSelectionRendererService {
	private _options: IServerSelectionRendererOptions = {
		showCornerRender: true,
		cornerStyle: 'rounded',
		color: '#264f78' // Default selection color in VS Code dark theme
	};

	private readonly _onDidChangeOptions = new Emitter<IServerSelectionRendererOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerSelectionRendererOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerSelectionRendererOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
