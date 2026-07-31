import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostFileWatcher {
	constructor(
		public readonly globPattern: string,
		public readonly ignoreCreateEvents?: boolean,
		public readonly ignoreChangeEvents?: boolean,
		public readonly ignoreDeleteEvents?: boolean
	) {}

	readonly onDidCreate = new Emitter<any>().event;
	readonly onDidChange = new Emitter<any>().event;
	readonly onDidDelete = new Emitter<any>().event;

	dispose(): void {}
}
