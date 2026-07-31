import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostExtensionContext {
	constructor(
		public readonly extensionId: string,
		public readonly extensionPath: string,
		public readonly storagePath: string,
		public readonly globalStoragePath: string,
		public readonly logPath: string,
		public readonly extensionMode: number
	) {}

	public readonly subscriptions: IDisposable[] = [];
	
	// Stub implementation
}
