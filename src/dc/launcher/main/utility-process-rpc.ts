export interface RpcPort {
	postMessage(message: unknown, transfer?: unknown[]): void;
	on(event: 'message', listener: (message: any) => void): unknown;
	start?(): void;
	close?(): void;
}

export interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (err: unknown) => void;
	timer: NodeJS.Timeout;
}

export interface RpcRequest {
	__dcRpcId: number;
	method: string;
	args: unknown[];
}

export interface RpcResponse {
	__dcRpcId: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

const DEFAULT_TIMEOUT_MS = 60000;

export class UtilityProcessRpc {
	private _nextRequestId = 1;
	private readonly _pending = new Map<number, PendingRequest>();

	public static createChannelPair(): { port1: unknown; port2: unknown } {
		if (typeof (globalThis as any).MessageChannel !== 'undefined') {
			const channel = new (globalThis as any).MessageChannel();
			return { port1: channel.port1, port2: channel.port2 };
		}
		if (typeof (process as any).parentPort !== 'undefined') {
			return { port1: (process as any).parentPort, port2: (process as any).parentPort };
		}
		throw new Error('No MessageChannel available');
	}

	public expose(port: RpcPort, methods: Record<string, (args: unknown[]) => unknown | Promise<unknown>> = {}): void {
		const listener = (message: unknown): void => {
			if (!message || typeof message !== 'object' || !('__dcRpcId' in (message as any))) {
				return;
			}
			const request = message as RpcRequest;
			const handler = methods[request.method];
			if (!handler) {
				this._sendResponse(port, {
					__dcRpcId: request.__dcRpcId,
					ok: false,
					error: `Unknown method: ${request.method}`
				});
				return;
			}
			try {
				const result = handler(request.args ?? []);
				if (result instanceof Promise) {
					result
						.then((value) => {
							this._sendResponse(port, { __dcRpcId: request.__dcRpcId, ok: true, result: value });
						})
						.catch((err: unknown) => {
							this._sendResponse(port, { __dcRpcId: request.__dcRpcId, ok: false, error: String(err) });
						});
				} else {
					this._sendResponse(port, { __dcRpcId: request.__dcRpcId, ok: true, result });
				}
			} catch (err) {
				this._sendResponse(port, { __dcRpcId: request.__dcRpcId, ok: false, error: String(err) });
			}
		};
		(port as any).on('message', listener);
		port.start?.();
	}

	public call(port: RpcPort, method: string, args: unknown[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = this._nextRequestId++;
			const timer = setTimeout(() => {
				this._pending.delete(id);
				reject(new Error(`RPC call '${method}' timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this._pending.set(id, { resolve, reject, timer });
			const listener = (message: unknown): void => {
				if (!message || typeof message !== 'object' || !('__dcRpcId' in (message as any))) {
					return;
				}
				const response = message as RpcResponse;
				if (response.__dcRpcId !== id) {
					return;
				}
				(port as any).removeListener?.('message', listener);
				this._settle(response);
			};
			(port as any).on('message', listener);
			port.start?.();
			port.postMessage({ __dcRpcId: id, method, args } as RpcRequest);
		});
	}

	public registerMethod(port: RpcPort, method: string, handler: (args: unknown[]) => unknown | Promise<unknown>): void {
		this.expose(port, { [method]: handler });
	}

	public dispose(): void {
		for (const pending of this._pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('RPC disposed'));
		}
		this._pending.clear();
	}

	private _settle(response: RpcResponse): void {
		const pending = this._pending.get(response.__dcRpcId);
		if (!pending) {
			return;
		}
		this._pending.delete(response.__dcRpcId);
		clearTimeout(pending.timer);
		if (response.ok) {
			pending.resolve(response.result);
		} else {
			pending.reject(new Error(response.error ?? 'RPC call failed'));
		}
	}

	private _sendResponse(port: RpcPort, response: RpcResponse): void {
		try {
			port.postMessage(response);
		} catch (err) {
			console.error('[utility-process-rpc] failed to send response:', err);
		}
	}
}

export function createUtilityProcessRpc(): UtilityProcessRpc {
	return new UtilityProcessRpc();
}
