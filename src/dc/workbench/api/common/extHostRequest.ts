import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostRequest {
	async request(options: any): Promise<any> {
		console.log(`[Request] Executing request with options:`, options);
		return Promise.resolve({
			status: 200,
			data: undefined
		});
	}
}
