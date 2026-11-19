/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, IpcMainEvent, MessagePortMain } from 'electron';
import { validatedIpcMain } from './ipcMain.js';
import { Event } from '../../../common/event.js';
import { IDisposable } from '../../../common/lifecycle.js';
import { generateUuid } from '../../../common/uuid.js';
import { Client as MessagePortClient } from '../common/ipc.mp.js';

export class Client extends MessagePortClient implements IDisposable {

	constructor(port: MessagePortMain, clientId: string) {
		super({
			addEventListener: (type, listener) => port.addListener(type, listener),
			removeEventListener: (type, listener) => port.removeListener(type, listener),
			postMessage: message => port.postMessage(message),
			start: () => port.start(),
			close: () => port.close()
		}, clientId);
	}
}

export async function connect(window: BrowserWindow): Promise<MessagePortMain> {

	if (window.isDestroyed() || window.webContents.isDestroyed()) {
		throw new Error('ipc.mp#connect: Cannot talk to window because it is closed or destroyed');
	}

	const nonce = generateUuid();
	window.webContents.send('vscode:createMessageChannel', nonce);

	const onMessageChannelResult = Event.fromNodeEventEmitter<{ nonce: string; port: MessagePortMain }>(validatedIpcMain, 'vscode:createMessageChannelResult', (e: IpcMainEvent, nonce: string) => ({ nonce, port: e.ports[0] }));
	const { port } = await Event.toPromise(Event.once(Event.filter(onMessageChannelResult, e => e.nonce === nonce)));

	return port;
}
