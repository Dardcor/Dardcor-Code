import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostNotifications {
	showInformationMessage(message: string, ...items: any[]): Promise<any | undefined> {
		console.info(`[Info] ${message}`, items);
		return Promise.resolve(items[0]);
	}

	showWarningMessage(message: string, ...items: any[]): Promise<any | undefined> {
		console.warn(`[Warn] ${message}`, items);
		return Promise.resolve(items[0]);
	}

	showErrorMessage(message: string, ...items: any[]): Promise<any | undefined> {
		console.error(`[Error] ${message}`, items);
		return Promise.resolve(items[0]);
	}
}
