import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDiff {
	async diff(original: any, modified: any, title?: string, options?: any): Promise<void> {
		console.log(`[Diff] Showing diff between ${original.toString()} and ${modified.toString()}`);
		return Promise.resolve();
	}
}
