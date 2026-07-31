import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostUserData {
	async read(key: string): Promise<string | undefined> {
		return undefined;
	}

	async write(key: string, value: string): Promise<void> {
		return Promise.resolve();
	}
}
