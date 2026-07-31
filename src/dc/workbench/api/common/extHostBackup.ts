import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostBackup {
	async backup(uri: any, content: string): Promise<void> {
		return Promise.resolve();
	}
}
