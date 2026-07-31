/**
 * Dardcor Code - MessageChannel Bridge (Task 68)
 * Mirrors: vs/base/parts/ipc/common/ipc.mp.ts
 */

import { IDisposable } from '../lifecycle/disposable.js';
import { Emitter, Event } from '../events/emitter.js';

export interface IMessagePortData {
	type: string;
	data: any;
}

export class MessagePortBridge implements IDisposable {
	private readonly _onMessage = new Emitter<IMessagePortData>();
	public readonly onMessage: Event<IMessagePortData> = this._onMessage.event;
	private _port: MessagePort | null;

	constructor(port: MessagePort) {
		this._port = port;
		this._port.onmessage = (e: MessageEvent) => {
			this._onMessage.fire(e.data as IMessagePortData);
		};
		this._port.start();
	}

	send(data: IMessagePortData): void {
		this._port?.postMessage(data);
	}

	dispose(): void {
		this._port?.close();
		this._port = null;
		this._onMessage.dispose();
	}
}

export function createMessageChannelPair(): [MessagePortBridge, MessagePortBridge] {
	const channel = new MessageChannel();
	return [
		new MessagePortBridge(channel.port1),
		new MessagePortBridge(channel.port2)
	];
}
