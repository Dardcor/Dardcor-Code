import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerRenderWordsOptions {
	readonly wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
	readonly wordWrapColumn: number;
	readonly wordWrapBreakBeforeCharacters: string;
	readonly wordWrapBreakAfterCharacters: string;
}

export interface IServerRenderWordsService {
	readonly onDidChangeOptions: Event<IServerRenderWordsOptions>;
	getOptions(): IServerRenderWordsOptions;
	setOptions(options: Partial<IServerRenderWordsOptions>): void;
}

export class ServerRenderWordsCommon implements IServerRenderWordsService {
	private _options: IServerRenderWordsOptions = {
		wordWrap: 'off',
		wordWrapColumn: 80,
		wordWrapBreakBeforeCharacters: '([{‘“〈《「『【〔（［｛｢£¥$₩₹',
		wordWrapBreakAfterCharacters: ' \t})\]’”〉》」』】〕）］｝｣.,;:!?'
	};

	private readonly _onDidChangeOptions = new Emitter<IServerRenderWordsOptions>();
	readonly onDidChangeOptions = this._onDidChangeOptions.event;

	getOptions(): IServerRenderWordsOptions {
		return this._options;
	}

	setOptions(options: Partial<IServerRenderWordsOptions>): void {
		this._options = { ...this._options, ...options };
		this._onDidChangeOptions.fire(this._options);
	}
}
