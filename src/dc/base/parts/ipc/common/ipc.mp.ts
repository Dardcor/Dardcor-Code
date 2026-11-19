/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../common/buffer.js';
import { Event } from '../../../common/event.js';
import { IDisposable } from '../../../common/lifecycle.js';
import { IMessagePassingProtocol, IPCClient } from './ipc.js';


export interface MessageEvent {

	data: Uint8Array;
}

export interface MessagePort {

	addEventListener(type: 'message', listener: (this: MessagePort, e: MessageEvent) => unknown): void;
	removeEventListener(type: 'message', listener: (this: MessagePort, e: MessageEvent) => unknown): void;

	postMessage(message: Uint8Array): void;

	start(): void;
	close(): void;
}

export class Protocol implements IMessagePassingProtocol {

	readonly onMessage;

	constructor(private port: MessagePort) {
		const onMessage = Event.fromDOMEventEmitter<VSBuffer>(this.port, 'message', (e: MessageEvent) => e.data ? VSBuffer.wrap(e.data) : VSBuffer.alloc(0));
		this.onMessage = Event.filter(onMessage, data => data.byteLength > 0);
		port.start();
	}

	send(message: VSBuffer): void {
		this.port.postMessage(message.buffer);
	}

	disconnect(): void {
		this.port.close();
	}
}

export class Client extends IPCClient implements IDisposable {

	private protocol: Protocol;

	constructor(port: MessagePort, clientId: string) {
		const protocol = new Protocol(port);
		super(protocol, clientId);

		this.protocol = protocol;
	}

	override dispose(): void {
		this.protocol.disconnect();

		super.dispose();
	}
}
