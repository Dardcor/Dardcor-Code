import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { ConnectionMultiplexer, IRemoteChannelClient } from '../transport/connection-multiplexer.js';

export interface IRpcRequest {
	readonly method: string;
	readonly args?: unknown[];
}

export interface IRpcResponse {
	readonly ok: boolean;
	readonly result?: unknown;
	readonly error?: { message: string; stack?: string };
}

export interface IRpcEvent {
	readonly event: string;
	readonly data?: unknown;
}

export type RpcHandler = (method: string, args: unknown[]) => Promise<unknown> | unknown;

export interface IRemoteExtensionIpcOptions {
	readonly timeoutMs?: number;
}

export class RemoteExtensionIpc extends Disposable {
	private readonly _handlers = new Map<string, RpcHandler>();
	private readonly _clientChannels = new Map<string, IRemoteChannelClient>();
	private readonly _timeoutMs: number;

	private readonly _onEvent = this._register(new Emitter<{ channel: string; event: string; data: unknown }>());
	readonly onEvent: Event<{ channel: string; event: string; data: unknown }> = this._onEvent.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(
		private readonly _multiplexer: ConnectionMultiplexer,
		options: IRemoteExtensionIpcOptions = {}
	) {
		super();
		this._timeoutMs = options.timeoutMs ?? 30000;
		this._register(this._multiplexer.onError(error => this._onError.fire(error)));
	}

	registerChannel(name: string, handler: RpcHandler): Disposable {
		if (this._handlers.has(name)) {
			throw new Error(`Channel '${name}' is already registered`);
		}
		this._handlers.set(name, handler);
		this._multiplexer.registerChannel(name, {
			call: async (payload: unknown): Promise<IRpcResponse> => {
				if (!payload || typeof (payload as IRpcRequest).method !== 'string') {
					throw new Error(`Invalid RPC request on channel '${name}'`);
				}
				const request = payload as IRpcRequest;
				const channelHandler = this._handlers.get(name);
				if (!channelHandler) {
					throw new Error(`No handler registered for channel '${name}'`);
				}
				const args = Array.isArray(request.args) ? request.args : [];
				return { ok: true, result: await channelHandler(request.method, args) };
			},
			onEvent: (payload: unknown) => {
				if (payload && typeof (payload as IRpcEvent).event === 'string') {
					this._onEvent.fire({ channel: name, event: (payload as IRpcEvent).event, data: (payload as IRpcEvent).data });
				}
			}
		});
		const client = this._multiplexer.getChannel(name);
		this._clientChannels.set(name, client);
		return {
			dispose: () => this.unregisterChannel(name)
		} as any;
	}

	unregisterChannel(name: string): void {
		this._handlers.delete(name);
		this._multiplexer.unregisterChannel(name);
		this._clientChannels.delete(name);
	}

	async call(channel: string, method: string, args: unknown[] = []): Promise<unknown> {
		const client = this._getClient(channel);
		let timer: ReturnType<typeof setTimeout> | null = null;
		const promise = client.call({ method, args } satisfies IRpcRequest).then(result => {
			const response = result as IRpcResponse;
			if (response && response.ok === true) {
				return response.result;
			}
			if (response && response.error) {
				const error = new Error(response.error.message);
				(error as Error & { stack?: string }).stack = response.error.stack;
				throw error;
			}
			return response;
		});
		const withTimeout = new Promise<unknown>((resolvePromise, reject) => {
			timer = setTimeout(() => reject(new Error(`RPC call to '${channel}.${method}' timed out after ${this._timeoutMs}ms`)), this._timeoutMs);
			promise.then(
				result => {
					if (timer) {
						clearTimeout(timer);
					}
					resolvePromise(result);
				},
				error => {
					if (timer) {
						clearTimeout(timer);
					}
					reject(error);
				}
			);
		});
		return withTimeout;
	}

	callMethod(channel: string, method: string, args: unknown[] = []): Promise<unknown> {
		return this.call(channel, method, args);
	}

	fire(channel: string, event: string, data?: unknown): void {
		this._getClient(channel).fire({ event, data } satisfies IRpcEvent);
	}

	onChannelEvent(channel: string, listener: (data: unknown) => void): Disposable {
		const client = this._getClient(channel);
		return client.onEvent(payload => {
			if (payload && typeof (payload as IRpcEvent).event === 'string') {
				listener((payload as IRpcEvent).data);
			}
		}) as any;
	}

	hasChannel(name: string): boolean {
		return this._handlers.has(name);
	}

	hasClientChannel(name: string): boolean {
		return this._clientChannels.has(name);
	}

	listChannels(): string[] {
		return [...this._handlers.keys()];
	}

	private _getClient(channel: string): IRemoteChannelClient {
		let client = this._clientChannels.get(channel);
		if (!client) {
			client = this._multiplexer.getChannel(channel);
			this._clientChannels.set(channel, client);
		}
		return client;
	}

	override dispose(): void {
		for (const name of [...this._handlers.keys()]) {
			this.unregisterChannel(name);
		}
		super.dispose();
	}
}
