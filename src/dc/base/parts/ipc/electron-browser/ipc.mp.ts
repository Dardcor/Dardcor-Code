/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../browser/window.js';
import { Event } from '../../../common/event.js';
import { generateUuid } from '../../../common/uuid.js';
import { ipcMessagePort, ipcRenderer } from '../../sandbox/electron-browser/globals.js';

interface IMessageChannelResult {
	nonce: string;
	port: MessagePort;
	source: unknown;
}

export class MessagePortAcquisitionError extends Error {
	constructor(message: string, readonly fatal: boolean = false) {
		super(message);
		this.name = 'MessagePortAcquisitionError';
	}
}

export async function acquirePort(requestChannel: string | undefined, responseChannel: string, nonce = generateUuid()): Promise<MessagePort> {

	ipcMessagePort.acquire(responseChannel, nonce);

	if (typeof requestChannel === 'string') {
		ipcRenderer.send(requestChannel, nonce);
	}

	const onMessageChannelResult = Event.fromDOMEventEmitter<IMessageChannelResult>(mainWindow, 'message', (e: MessageEvent) => ({ nonce: e.data, port: e.ports[0], source: e.source }));
	const { port } = await Event.toPromise(Event.once(Event.filter(onMessageChannelResult, e => e.nonce === nonce && e.source === mainWindow)));

	return port;
}
