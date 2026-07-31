import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostCursor {
	constructor(
		public readonly position: any,
		public readonly selection: any
	) {}
}
