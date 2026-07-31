import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from './rpc-protocol.js';

export interface IIpcChannelHandler {
	call(method: string, args: unknown[]): unknown | Promise<unknown>;
	notify?(method: string, args: unknown[]): void;
}

export interface IIpcRequest {
	readonly id: number;
	readonly channel: string;
	readonly method: string;
	readonly args: unknown[];
}

export interface IIpcBridgeOptions {
	readonly rpc?: RPCProtocol;
	readonly channelName?: string;
}

export class ExtensionIpcBridge extends Disposable {
	private readonly _channels = new Map<string, IIpcChannelHandler>();
	private readonly _events = new Map<string, Emitter<unknown>>();
	private readonly _rpc: RPCProtocol | undefined;
	private readonly _channelName: string;

	private readonly _onDidRequest = this._register(new Emitter<IIpcRequest>());
	readonly onDidRequest: Event<IIpcRequest> = this._onDidRequest.event;

	constructor(options: IIpcBridgeOptions = {}) {
		super();
		this._rpc = options.rpc;
		this._channelName = options.channelName ?? 'ipc.bridge';
		if (this._rpc) {
			this._register(this._rpc.registerChannel(this._channelName, this._createRpcHandler()));
		}
	}

	public registerChannel(name: string, handler: IIpcChannelHandler): IDisposable {
		if (this._channels.has(name)) {
			throw new Error(`Channel IPC '${name}' sudah terdaftar`);
		}
		this._channels.set(name, handler);
		return toDisposable(() => {
			this._channels.delete(name);
		});
	}

	public unregisterChannel(name: string): void {
		this._channels.delete(name);
	}

	public hasChannel(name: string): boolean {
		return this._channels.has(name);
	}

	public getChannelNames(): string[] {
		return [...this._channels.keys()];
	}

	public call(channelName: string, method: string, args: unknown[] = []): Promise<unknown> {
		const local = this._channels.get(channelName);
		if (this._rpc && (!local || this._rpc.hasChannel(channelName))) {
			return this._rpc.call(this._channelName, 'dispatch', { channel: channelName, method, args });
		}
		if (!local) {
			return Promise.reject(new Error(`Channel IPC '${channelName}' tidak dikenal`));
		}
		return Promise.resolve(local.call(method, args));
	}

	public notify(channelName: string, method: string, args: unknown[] = []): void {
		const local = this._channels.get(channelName);
		if (this._rpc && (!local || this._rpc.hasChannel(channelName))) {
			this._rpc.notify(this._channelName, 'dispatchNotify', { channel: channelName, method, args });
			return;
		}
		local?.notify?.(method, args);
	}

	public onChannelEvent<T = unknown>(event: string): Event<T> {
		let emitter = this._events.get(event);
		if (!emitter) {
			emitter = new Emitter<unknown>();
			this._events.set(event, emitter);
		}
		return emitter.event as Event<T>;
	}

	public fireChannelEvent(event: string, payload: unknown): void {
		this._events.get(event)?.fire(payload);
		if (this._rpc) {
			this._rpc.emit(this._channelName, event, payload);
		}
	}

	public override dispose(): void {
		this._channels.clear();
		this._events.clear();
		super.dispose();
	}

	private _createRpcHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case 'dispatch': {
						const { channel, method, args } = payload as { channel: string; method: string; args: unknown[] };
						const handler = this._channels.get(channel);
						if (!handler) {
							throw new Error(`Channel IPC '${channel}' tidak dikenal`);
						}
						this._onDidRequest.fire({ id: 0, channel, method, args });
						return handler.call(method, args);
					}
					case 'listChannels':
						return this.getChannelNames();
					default:
						throw new Error(`Perintah IPC tidak dikenal: ${command}`);
				}
			},
			notify: (command: string, payload: any) => {
				if (command === 'dispatchNotify') {
					const { channel, method, args } = payload as { channel: string; method: string; args: unknown[] };
					this._channels.get(channel)?.notify?.(method, args);
				}
			}
		};
	}
}
