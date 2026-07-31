import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostQuickInput {
	showQuickPick(items: any[] | Promise<any[]>, options?: any, token?: any): Promise<any | undefined> {
		return Promise.resolve(undefined); // Mock
	}

	showInputBox(options?: any, token?: any): Promise<string | undefined> {
		return Promise.resolve(undefined); // Mock
	}

	createQuickPick(): any {
		return {}; // Mock
	}

	createInputBox(): any {
		return {}; // Mock
	}
}
