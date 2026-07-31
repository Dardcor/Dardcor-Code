import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostLanguage {
	constructor(
		public readonly id: string
	) {}
}
