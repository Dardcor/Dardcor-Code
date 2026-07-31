import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostLanguages {
	getLanguages(): Promise<string[]> {
		return Promise.resolve([]);
	}

	match(selector: any, document: any): number {
		return 0;
	}
}
