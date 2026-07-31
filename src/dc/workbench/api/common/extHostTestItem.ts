import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTestItem {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly uri?: any
	) {}
}
