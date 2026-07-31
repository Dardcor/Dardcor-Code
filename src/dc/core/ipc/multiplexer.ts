/**
 * Dardcor Code - IPC Multiplexer (Task 67)
 * Mirrors: vs/base/parts/ipc/common/ipc.ts multiplexing
 */

import { Emitter, Event } from '../events/emitter';
import { IDisposable } from '../lifecycle/disposable';

export interface IChannelMessage {
	channelId: string;
	type: 'request' | 'response' | 'event';
	requestId?: number;
	payload: any;
}

export class ChannelMultiplexer implements IDisposable {
	private readonly _channels = new Map<string, IVirtualChannel>();
	private readonly _onMessage = new Emitter<IChannelMessage>();
	public readonly onMessage: Event<IChannelMessage> = this._onMessage.event;
	private _requestId = 0;
	private readonly _pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

	constructor(private readonly _send: (msg: IChannelMessage) => void) {}

	dispose(): void {
		this._onMessage.dispose();
		this._channels.clear();
		for (const [, pending] of this._pendingRequests) {
			pending.reject(new Error('Multiplexer disposed'));
		}
		this._pendingRequests.clear();
	}

	getChannel(channelId: string): IVirtualChannel {
		let channel = this._channels.get(channelId);
		if (!channel) {
			channel = new VirtualChannel(channelId, this);
			this._channels.set(channelId, channel);
		}
		return channel;
	}

	sendRequest(channelId: string, payload: any): Promise<any> {
		const requestId = ++this._requestId;
		return new Promise((resolve, reject) => {
			this._pendingRequests.set(requestId, { resolve, reject });
			this._send({ channelId, type: 'request', requestId, payload });
		});
	}

	sendEvent(channelId: string, payload: any): void {
		this._send({ channelId, type: 'event', payload });
	}

	handleIncoming(msg: IChannelMessage): void {
		if (msg.type === 'response' && msg.requestId !== undefined) {
			const pending = this._pendingRequests.get(msg.requestId);
			if (pending) {
				this._pendingRequests.delete(msg.requestId);
				pending.resolve(msg.payload);
			}
		} else {
			this._onMessage.fire(msg);
		}
	}
}

export interface IVirtualChannel {
	readonly channelId: string;
	call(payload: any): Promise<any>;
	fire(payload: any): void;
}

class VirtualChannel implements IVirtualChannel {
	constructor(
		public readonly channelId: string,
		private readonly _multiplexer: ChannelMultiplexer
	) {}

	call(payload: any): Promise<any> {
		return this._multiplexer.sendRequest(this.channelId, payload);
	}

	fire(payload: any): void {
		this._multiplexer.sendEvent(this.channelId, payload);
	}
}
