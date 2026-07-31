import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTextDocument {
	constructor(
		public readonly uri: any,
		public readonly languageId: string,
		public readonly version: number,
		private readonly _content: string
	) {}

	getText(range?: any): string {
		return this._content; // Stub
	}

	get isUntitled(): boolean {
		return this.uri.scheme === 'untitled';
	}
}
