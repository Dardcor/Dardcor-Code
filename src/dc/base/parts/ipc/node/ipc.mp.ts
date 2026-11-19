/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessagePortMain, isUtilityProcess, MessageEvent } from '../../sandbox/node/electronTypes.js';
import { VSBuffer } from '../../../common/buffer.js';
import { ClientConnectionEvent, IMessagePassingProtocol, IPCServer } from '../common/ipc.js';
import { Emitter, Event } from '../../../common/event.js';
import { assertType } from '../../../common/types.js';

class Protocol implements IMessagePassingProtocol {

	readonly onMessage;

	constructor(private port: MessagePortMain) {
		this.onMessage = Event.fromNodeEventEmitter<VSBuffer>(this.port, 'message', (e: MessageEvent) => {
			if (e.data) {
				return VSBuffer.wrap(e.data as Uint8Array);
			}
			return VSBuffer.alloc(0);
		});
		port.start();
	}

	send(message: VSBuffer): void {
		this.port.postMessage(message.buffer);
	}

	disconnect(): void {
		this.port.close();
	}
}

export interface IClientConnectionFilter {

	handledClientConnection(e: MessageEvent): boolean;
}

export class Server extends IPCServer {

	private static getOnDidClientConnect(filter?: IClientConnectionFilter): Event<ClientConnectionEvent> {
		assertType(isUtilityProcess(process), 'Electron Utility Process');

		const onCreateMessageChannel = new Emitter<MessagePortMain>();

		process.parentPort.on('message', (e: MessageEvent) => {
			if (filter?.handledClientConnection(e)) {
				return;
			}

			const port = e.ports.at(0);
			if (port) {
				onCreateMessageChannel.fire(port);
			}
		});

		return Event.map(onCreateMessageChannel.event, port => {
			const protocol = new Protocol(port);

			const result: ClientConnectionEvent = {
				protocol,
				onDidClientDisconnect: Event.fromNodeEventEmitter(port, 'close')
			};

			return result;
		});
	}

	constructor(filter?: IClientConnectionFilter) {
		super(Server.getOnDidClientConnect(filter));
	}
}

interface INodeMessagePortFragment {
	on(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
	removeListener(event: 'message', listener: (messageEvent: MessageEvent) => void): this;
}

export function once(port: INodeMessagePortFragment, message: unknown, callback: () => void): void {
	const listener = (e: MessageEvent) => {
		if (e.data === message) {
			port.removeListener('message', listener);
			callback();
		}
	};

	port.on('message', listener);
}
