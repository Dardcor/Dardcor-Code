import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostClipboard {
	private _clipboard = '';

	async readText(): Promise<string> {
		return this._clipboard;
	}

	async writeText(value: string): Promise<void> {
		this._clipboard = value;
	}
}
