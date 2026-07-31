import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWorkspaceFolder {
	constructor(
		public readonly uri: any,
		public readonly name: string,
		public readonly index: number
	) {}
}
