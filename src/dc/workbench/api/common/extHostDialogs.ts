import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDialogs {
	showOpenDialog(options?: any): Promise<any[] | undefined> {
		return Promise.resolve(undefined);
	}

	showSaveDialog(options?: any): Promise<any | undefined> {
		return Promise.resolve(undefined);
	}
}
