import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostDownload {
	async download(uri: any, location: any): Promise<void> {
		console.log(`[Download] Downloading ${uri.toString()} to ${location.toString()}`);
		return Promise.resolve();
	}
}
