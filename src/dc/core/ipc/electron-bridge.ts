/**
 * Dardcor Code - Electron IPC Adapter (Task 84)
 * Mirrors: vs/base/parts/ipc/electron-main/ipc.electron.ts
 */

import { IDisposable } from '../lifecycle/disposable';
import { Emitter, Event } from '../events/emitter';

declare const require: any;

export interface IElectronIPC {
	send(channel: string, ...args: any[]): void;
	invoke(channel: string, ...args: any[]): Promise<any>;
	on(channel: string, listener: (...args: any[]) => void): IDisposable;
}

export class ElectronIPCBridge implements IElectronIPC, IDisposable {
	private readonly _ipcRenderer: any;
	private readonly _listeners = new Map<string, Set<(...args: any[]) => void>>();

	constructor() {
		try {
			const electron = require('electron');
			this._ipcRenderer = electron.ipcRenderer;
		} catch {
			this._ipcRenderer = null;
		}
	}

	get isAvailable(): boolean {
		return this._ipcRenderer !== null;
	}

	send(channel: string, ...args: any[]): void {
		this._ipcRenderer?.send(channel, ...args);
	}

	invoke(channel: string, ...args: any[]): Promise<any> {
		if (!this._ipcRenderer) {
			return Promise.reject(new Error('IPC not available'));
		}
		return this._ipcRenderer.invoke(channel, ...args);
	}

	on(channel: string, listener: (...args: any[]) => void): IDisposable {
		if (!this._ipcRenderer) {
			return { dispose: () => {} };
		}

		const wrappedListener = (_event: any, ...args: any[]) => listener(...args);
		this._ipcRenderer.on(channel, wrappedListener);

		let set = this._listeners.get(channel);
		if (!set) {
			set = new Set();
			this._listeners.set(channel, set);
		}
		set.add(wrappedListener);

		return {
			dispose: () => {
				this._ipcRenderer?.removeListener(channel, wrappedListener);
				set?.delete(wrappedListener);
			}
		};
	}

	dispose(): void {
		for (const [channel, listeners] of this._listeners) {
			for (const listener of listeners) {
				this._ipcRenderer?.removeListener(channel, listener);
			}
		}
		this._listeners.clear();
	}
}

let _instance: ElectronIPCBridge | null = null;

export function getElectronIPC(): ElectronIPCBridge {
	if (!_instance) {
		_instance = new ElectronIPCBridge();
	}
	return _instance;
}
