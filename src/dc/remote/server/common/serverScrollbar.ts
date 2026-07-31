import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerScrollbarOptions {
	readonly vertical: 'auto' | 'visible' | 'hidden';
	readonly horizontal: 'auto' | 'visible' | 'hidden';
	readonly verticalScrollbarSize: number;
	readonly horizontalScrollbarSize: number;
	readonly useShadows: boolean;
}

export interface IServerScrollbarService {
	readonly onDidChangeOptions: Event<IServerScrollbarOptions>;
	getOptions(): IServerScrollbarOptions;
	setOptions(options: Partial<IServerScrollbarOptions>): void;
}

export class ServerScrollbarCommon implements IServerScrollbarService {
	private _options: IServerScrollbarOptions = {
		vertical: 'auto',
		horizontal: 'auto',
		verticalScrollbarSize: 14,
		horizontalScrollbarSize: 14,
		useShadows: true
	};

	private readonly _onDidChangeOptions = new Emitter<IServerScrollbarOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerScrollbarOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerScrollbarOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
