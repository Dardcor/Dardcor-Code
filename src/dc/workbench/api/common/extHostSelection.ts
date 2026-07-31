import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostSelection {
	constructor(
		public readonly anchor: any,
		public readonly active: any
	) {}
}
