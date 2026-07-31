import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostIpc {
	readonly onMessage: Event<any>;
	send(message: any): void;
	dispose(): void;
}

export class ExtensionHostIpc implements IExtensionHostIpc {
	private readonly _onMessage = new Emitter<any>();
	readonly onMessage = this._onMessage.event;

	constructor() {
		// Mock IPC for now
	}

	send(message: any): void {
		console.log('IPC send:', message);
	}

	dispose(): void {
		console.log('IPC disposed');
	}

	// Used by mock transport to deliver messages
	receive(message: any): void {
		this._onMessage.fire(message);
	}
}
