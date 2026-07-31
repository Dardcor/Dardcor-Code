import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface SharedProcessRequest {
	__dcId: number;
	method: string;
	args: unknown[];
}

export interface SharedProcessResponse {
	__dcId: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export type IpcInvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type IpcSendFn = (channel: string, ...args: unknown[]) => void;
export type IpcOnFn = (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;

export interface SharedProcessBridge {
	invoke: IpcInvokeFn;
	send: IpcSendFn;
	on: IpcOnFn;
}

export class SharedProcessClient extends Disposable {
	private _port: { postMessage(message: unknown): void; on(event: 'message', listener: (message: any) => void): unknown } | null = null;
	private _pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: unknown) => void; timer: NodeJS.Timeout }>();
	private _nextId = 1;
	private _eventListeners = new Map<string, Set<(data: unknown) => void>>();
	private _bridge: SharedProcessBridge | null = null;
	private _connected = false;

	public connect(port: unknown): boolean {
		if (!port || typeof (port as any).postMessage !== 'function') {
			return false;
		}
		this._port = port as any;
		(this._port as any).on?.('message', (message: unknown) => this._handleMessage(message));
		(this._port as any).start?.();
		this._connected = true;
		return true;
	}

	public connectViaIpc(bridge: SharedProcessBridge): void {
		this._bridge = bridge;
		this._connected = true;
		bridge.on('shared-process:response', (_event: unknown, ...args: unknown[]) => {
			this._handleResponse(args[0] as SharedProcessResponse);
		});
		bridge.on('shared-process:event', (_event: unknown, ...args: unknown[]) => {
			const channel = args[0] as string;
			const data = args[1];
			const listeners = this._eventListeners.get(channel);
			if (listeners) {
				for (const listener of listeners) {
					try {
						listener(data);
					} catch (err) {
						console.error('[shared-process-client] event listener failed:', err);
					}
				}
			}
		});
	}

	public isConnected(): boolean {
		return this._connected;
	}

	public call(method: string, ...args: unknown[]): Promise<unknown> {
		if (!this._connected) {
			return Promise.reject(new Error('Shared process client is not connected'));
		}
		if (this._bridge) {
			return this._bridge.invoke('shared-process:request', { __dcId: 0, method, args } as SharedProcessRequest);
		}
		return this._callOverPort(method, args);
	}

	public onEvent(channel: string, cb: (data: unknown) => void): () => void {
		let listeners = this._eventListeners.get(channel);
		if (!listeners) {
			listeners = new Set();
			this._eventListeners.set(channel, listeners);
		}
		listeners.add(cb);
		return () => {
			listeners.delete(cb);
		};
	}

	public override dispose(): void {
		for (const pending of this._pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Shared process client disposed'));
		}
		this._pending.clear();
		this._eventListeners.clear();
		this._connected = false;
		this._port = null;
		super.dispose();
	}

	private _callOverPort(method: string, args: unknown[]): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = this._nextId++;
			const timer = setTimeout(() => {
				this._pending.delete(id);
				reject(new Error(`Shared process call '${method}' timed out`));
			}, 30000);
			this._pending.set(id, { resolve, reject, timer });
			this._port?.postMessage({ __dcId: id, method, args } as SharedProcessRequest);
		});
	}

	private _handleMessage(message: unknown): void {
		if (message && typeof message === 'object' && '__dcId' in (message as any)) {
			this._handleResponse(message as SharedProcessResponse);
			return;
		}
		if (message && typeof message === 'object' && '__dcChannel' in (message as any)) {
			const eventMessage = message as { __dcChannel: string; data: unknown };
			const listeners = this._eventListeners.get(eventMessage.__dcChannel);
			if (listeners) {
				for (const listener of listeners) {
					try {
						listener(eventMessage.data);
					} catch (err) {
						console.error('[shared-process-client] event listener failed:', err);
					}
				}
			}
		}
	}

	private _handleResponse(response: SharedProcessResponse): void {
		if (!response || typeof response !== 'object' || !('__dcId' in response)) {
			return;
		}
		const pending = this._pending.get(response.__dcId);
		if (!pending) {
			return;
		}
		this._pending.delete(response.__dcId);
		clearTimeout(pending.timer);
		if (response.ok) {
			pending.resolve(response.result);
		} else {
			pending.reject(new Error(response.error ?? 'Shared process call failed'));
		}
	}
}

export function createSharedProcessClient(): SharedProcessClient {
	return new SharedProcessClient();
}
