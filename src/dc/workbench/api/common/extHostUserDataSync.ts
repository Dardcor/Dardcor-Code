import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostUserDataSync {
	async sync(): Promise<void> {
		return Promise.resolve();
	}
}
