import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostProtocol {
	readonly onMessage: Event<any>;
	send(message: any): void;
	disconnect(): void;
}

export class ExtensionHostProtocol implements IExtensionHostProtocol {
	private readonly _onMessage = new Emitter<any>();
	readonly onMessage = this._onMessage.event;

	constructor() {
		// Mock protocol for now
	}

	send(message: any): void {
		console.log('Protocol send:', message);
	}

	disconnect(): void {
		console.log('Protocol disconnected');
	}

	// Used by mock transport to deliver messages
	receive(message: any): void {
		this._onMessage.fire(message);
	}
}
