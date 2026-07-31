import { ipcMain } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { registerFileChannels } from './main-channel-files.js';
import { registerDialogChannels } from './main-channel-dialogs.js';
import { registerStorageChannels } from './main-channel-storage.js';
import { registerWindowChannels } from './main-channel-window.js';
import { registerAppChannels } from './main-channel-app.js';
import { registerUpdateChannels } from './main-channel-updates.js';

export type IpcHandler = (...args: any[]) => Promise<unknown> | unknown;

export class MainIpcRouter extends Disposable {
	private readonly _handlers = new Map<string, IpcHandler>();

	public register(channel: string, handler: IpcHandler): void {
		this._handlers.set(channel, handler);
	}

	public async handle(_event: any, channel: string, args: any[]): Promise<unknown> {
		const handler = this._handlers.get(channel);
		if (!handler) {
			return { error: `No handler registered for channel '${channel}'` };
		}
		try {
			return await handler(...(Array.isArray(args) ? args : []));
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	}

	public installAll(): void {
		this._register(toDisposable(() => {
			ipcMain.removeHandler('dc:rpc');
		}));
		ipcMain.handle('dc:rpc', (event: any, channel: string, args: any[]) => this.handle(event, channel, args));
		registerFileChannels();
		registerDialogChannels();
		registerStorageChannels();
		registerWindowChannels();
		registerAppChannels();
		registerUpdateChannels();
	}
}
