/**
 * Dardcor Code - Multi-Channel IPC Socket Over Single Transport Tunnel (Task 803)
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface IMessageConnection {
	readonly onMessage: Event<Uint8Array>;
	send(data: Uint8Array): boolean;
	close(): void;
}

export const enum WireMessageKind {
	Request = 0,
	Response = 1,
	Event = 2
}

export interface WireMessage {
	readonly channel: string;
	readonly kind: WireMessageKind;
	readonly id?: number;
	readonly payload?: any;
}

export interface IRemoteChannelClient {
	readonly channelId: string;
	readonly onEvent: Event<any>;
	call(payload: any): Promise<any>;
	fire(payload: any): void;
}

export interface IRemoteChannelServer {
	readonly channelId?: string;
	call?(payload: any): Promise<any>;
	onEvent?(payload: any): void;
}

export class ConnectionMultiplexer extends Disposable {
	private readonly _clientChannels = new Map<string, IRemoteChannelClient>();
	private readonly _serverChannels = new Map<string, IRemoteChannelServer>();
	private readonly _pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private _requestId = 0;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(private readonly _connection: IMessageConnection) {
		super();
		this._register(this._connection.onMessage(data => this._handleIncoming(data)));
	}

	getChannel(channelId: string): IRemoteChannelClient {
		let channel = this._clientChannels.get(channelId);
		if (!channel) {
			channel = new RemoteChannelClient(channelId, this);
			this._clientChannels.set(channelId, channel);
		}
		return channel;
	}

	registerChannel(channelId: string, server: IRemoteChannelServer): void {
		this._serverChannels.set(channelId, server);
	}

	unregisterChannel(channelId: string): void {
		this._serverChannels.delete(channelId);
	}

	sendRequest(channelId: string, payload: any): Promise<any> {
		const id = ++this._requestId;
		return new Promise<any>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			try {
				this._send({ channel: channelId, kind: WireMessageKind.Request, id, payload });
			} catch (error) {
				this._pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	sendEvent(channelId: string, payload: any): void {
		this._send({ channel: channelId, kind: WireMessageKind.Event, payload });
	}

	sendResponse(id: number, channelId: string, payload: any): void {
		this._send({ channel: channelId, kind: WireMessageKind.Response, id, payload });
	}

	private _send(message: WireMessage): void {
		const data = new TextEncoder().encode(JSON.stringify(message));
		if (!this._connection.send(data)) {
			throw new Error('Connection is closed');
		}
	}

	private _handleIncoming(data: Uint8Array): void {
		let message: WireMessage;
		try {
			message = JSON.parse(new TextDecoder().decode(data)) as WireMessage;
		} catch (error) {
			this._onError.fire(error instanceof Error ? error : new Error('Failed to decode wire message'));
			return;
		}
		if (!message || typeof message.channel !== 'string') {
			this._onError.fire(new Error('Malformed wire message received'));
			return;
		}
		switch (message.kind) {
			case WireMessageKind.Response: {
				if (typeof message.id !== 'number') {
					return;
				}
				const pending = this._pending.get(message.id);
				if (pending) {
					this._pending.delete(message.id);
					pending.resolve(message.payload);
				}
				return;
			}
			case WireMessageKind.Request: {
				const server = this._serverChannels.get(message.channel);
				if (!server || !server.call) {
					this._sendUnhandled(message);
					return;
				}
				Promise.resolve()
					.then(() => server.call!(message.payload))
					.then(
						result => {
							if (typeof message.id === 'number') {
								this.sendResponse(message.id, message.channel, { ok: true, result });
							}
						},
						error => {
							if (typeof message.id === 'number') {
								this.sendResponse(message.id, message.channel, {
									ok: false,
									error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error)
								});
							}
						}
					);
				return;
			}
			case WireMessageKind.Event: {
				const server = this._serverChannels.get(message.channel);
				if (server && server.onEvent) {
					server.onEvent(message.payload);
				}
				const client = this._clientChannels.get(message.channel);
				if (client && client instanceof RemoteChannelClient) {
					client.handleEvent(message.payload);
				}
				return;
			}
		}
	}

	private _sendUnhandled(message: WireMessage): void {
		if (typeof message.id !== 'number') {
			return;
		}
		this.sendResponse(message.id, message.channel, {
			ok: false,
			error: { message: `No channel handler registered for '${message.channel}'` }
		});
	}

	disposeAllChannels(): void {
		for (const pending of this._pending.values()) {
			pending.reject(new Error('Multiplexer disposed'));
		}
		this._pending.clear();
		this._clientChannels.clear();
		this._serverChannels.clear();
	}

	override dispose(): void {
		this.disposeAllChannels();
		try {
			this._connection.close();
		} catch {
			// ignore
		}
		super.dispose();
	}
}

class RemoteChannelClient implements IRemoteChannelClient {
	private readonly _onEvent = new Emitter<any>();
	readonly onEvent: Event<any> = this._onEvent.event;

	constructor(
		public readonly channelId: string,
		private readonly _multiplexer: ConnectionMultiplexer
	) {}

	handleEvent(payload: any): void {
		this._onEvent.fire(payload);
	}

	call(payload: any): Promise<any> {
		return this._multiplexer.sendRequest(this.channelId, payload).then(result => {
			if (result && result.ok === false) {
				const error = new Error(result.error?.message ?? 'Remote call failed');
				(error as any).remoteStack = result.error?.stack;
				throw error;
			}
			return result?.result;
		});
	}

	fire(payload: any): void {
		this._multiplexer.sendEvent(this.channelId, payload);
	}
}
