/**
 * Dardcor Code - IPC Client & Channel Client
 */

import { IChannel } from './channel';
import { Event, Emitter } from '../events/emitter';

export class IPCClient {
	private readonly _channels = new Map<string, IChannel>();

	constructor(private readonly _protocol: any) {}

	getChannel(channelName: string): IChannel {
		let channel = this._channels.get(channelName);
		if (!channel) {
			channel = new ChannelClient(this._protocol, channelName);
			this._channels.set(channelName, channel);
		}
		return channel;
	}
}

class ChannelClient implements IChannel {
	constructor(
		private readonly _protocol: any,
		private readonly _name: string
	) {}

	call<T>(command: string, arg?: any): Promise<T> {
		return this._protocol.sendRequest(this._name, command, arg);
	}

	listen<T>(event: string, arg?: any): Event<T> {
		const emitter = new Emitter<T>();
		this._protocol.subscribe(this._name, event, arg, (data: T) => {
			emitter.fire(data);
		});
		return emitter.event;
	}
}
