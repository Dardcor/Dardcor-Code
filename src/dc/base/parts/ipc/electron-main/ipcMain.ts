/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron from 'electron';
import { onUnexpectedError } from '../../../common/errors.js';
import { Event } from '../../../common/event.js';
import { VSCODE_AUTHORITY } from '../../../common/network.js';

type ipcMainListener = (event: electron.IpcMainEvent, ...args: any[]) => void;

class ValidatedIpcMain implements Event.NodeEventEmitter {

	private readonly mapListenerToWrapper = new WeakMap<ipcMainListener, ipcMainListener>();

	on(channel: string, listener: ipcMainListener): this {

		const wrappedListener = (event: electron.IpcMainEvent, ...args: unknown[]) => {
			if (this.validateEvent(channel, event)) {
				listener(event, ...args);
			}
		};

		this.mapListenerToWrapper.set(listener, wrappedListener);

		electron.ipcMain.on(channel, wrappedListener);

		return this;
	}

	once(channel: string, listener: ipcMainListener): this {
		electron.ipcMain.once(channel, (event: electron.IpcMainEvent, ...args: unknown[]) => {
			if (this.validateEvent(channel, event)) {
				listener(event, ...args);
			}
		});

		return this;
	}

	handle(channel: string, listener: (event: electron.IpcMainInvokeEvent, ...args: any[]) => Promise<unknown>): this {
		electron.ipcMain.handle(channel, (event: electron.IpcMainInvokeEvent, ...args: unknown[]) => {
			if (this.validateEvent(channel, event)) {
				return listener(event, ...args);
			}

			return Promise.reject(`Invalid channel '${channel}' or sender for ipcMain.handle() usage.`);
		});

		return this;
	}

	removeHandler(channel: string): this {
		electron.ipcMain.removeHandler(channel);

		return this;
	}

	removeListener(channel: string, listener: ipcMainListener): this {
		const wrappedListener = this.mapListenerToWrapper.get(listener);
		if (wrappedListener) {
			electron.ipcMain.removeListener(channel, wrappedListener);
			this.mapListenerToWrapper.delete(listener);
		}

		return this;
	}

	private validateEvent(channel: string, event: electron.IpcMainEvent | electron.IpcMainInvokeEvent): boolean {
		if (!channel?.startsWith('vscode:')) {
			onUnexpectedError(`Refused to handle ipcMain event for channel '${channel}' because the channel is unknown.`);
			return false;
		}

		const sender = event.senderFrame;

		const url = sender?.url;
		if (!url || url === 'about:blank') {
			return true;
		}

		let host = 'unknown';
		try {
			host = new URL(url).host;
		} catch (error) {
			onUnexpectedError(`Refused to handle ipcMain event for channel '${channel}' because of a malformed URL '${url}'.`);
			return false;
		}

		if (process.env.VSCODE_DEV) {
			if (url === process.env.DEV_WINDOW_SRC && (host === 'localhost' || host.startsWith('localhost:'))) {
				return true;
			}
		}

		if (host !== VSCODE_AUTHORITY) {
			onUnexpectedError(`Refused to handle ipcMain event for channel '${channel}' because of a bad origin of '${host}'.`);
			return false;
		}

		if (sender?.parent !== null) {
			onUnexpectedError(`Refused to handle ipcMain event for channel '${channel}' because sender of origin '${host}' is not a main frame.`);
			return false;
		}

		return true;
	}
}

export const validatedIpcMain = new ValidatedIpcMain();
