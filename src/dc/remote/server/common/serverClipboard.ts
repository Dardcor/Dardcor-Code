import { Emitter, Event } from 'dc/core/common/event';

export interface IServerClipboardService {
	readonly onDidChangeClipboard: Event<void>;
	readText(): Promise<string>;
	writeText(text: string): Promise<void>;
	readResources(): Promise<string[]>;
	writeResources(resources: string[]): Promise<void>;
	hasResources(): Promise<boolean>;
}

export class ServerClipboardCommon implements IServerClipboardService {
	private _text = '';
	private _resources: string[] = [];

	private readonly _onDidChangeClipboard = new Emitter<void>();
	readonly onDidChangeClipboard = this._onDidChangeClipboard.event;

	async readText(): Promise<string> {
		return this._text;
	}

	async writeText(text: string): Promise<void> {
		if (this._text !== text) {
			this._text = text;
			this._onDidChangeClipboard.fire();
		}
	}

	async readResources(): Promise<string[]> {
		return [...this._resources];
	}

	async writeResources(resources: string[]): Promise<void> {
		this._resources = [...resources];
		this._onDidChangeClipboard.fire();
	}

	async hasResources(): Promise<boolean> {
		return this._resources.length > 0;
	}
}
