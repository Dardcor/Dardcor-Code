import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface IWebviewRpcMessage {
	id?: number;
	method?: string;
	args?: unknown[];
	data?: unknown;
	error?: string;
}

export class WebviewMessaging extends Disposable {
	private readonly _handlers = new Map<string, (args: unknown[]) => unknown | Promise<unknown>>();
	private readonly _pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
	private _seq = 0;

	public registerHandler(method: string, handler: (args: unknown[]) => unknown | Promise<unknown>): IDisposable {
		this._handlers.set(method, handler);
		return toDisposable(() => this._handlers.delete(method));
	}

	public handleMessage(event: MessageEvent): void {
		const message = event.data as IWebviewRpcMessage | undefined;
		if (!message || typeof message !== 'object') {
			return;
		}
		const target = event.source as Window | null;
		if (typeof message.id === 'number' && 'data' in message) {
			this._handleResponse(message);
		} else if (typeof message.method === 'string' && Array.isArray(message.args)) {
			this._handleRequest(message, target);
		}
	}

	public call(webview: HTMLIFrameElement, method: string, args?: unknown[]): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const id = this._seq++;
			this._pending.set(id, { resolve, reject });
			webview.contentWindow?.postMessage({ id, method, args: args ?? [] }, '*');
		});
	}

	public postMessageToWebview(webview: HTMLIFrameElement, message: unknown): void {
		webview.contentWindow?.postMessage(message, '*');
	}

	public override dispose(): void {
		this._handlers.clear();
		for (const [, pending] of this._pending) {
			pending.reject(new Error('WebviewMessaging dibuang'));
		}
		this._pending.clear();
		super.dispose();
	}

	private _handleRequest(message: IWebviewRpcMessage, target: Window | null): void {
		const respond = (data?: unknown, error?: string): void => {
			if (message.id === undefined) {
				return;
			}
			target?.postMessage(error ? { id: message.id, error } : { id: message.id, data }, '*');
		};
		const handler = this._handlers.get(message.method!);
		if (!handler) {
			respond(undefined, `Metode tidak dikenal: ${message.method}`);
			return;
		}
		try {
			const result = handler(message.args ?? []);
			if (result && typeof (result as any).then === 'function') {
				(result as Promise<unknown>).then(
					value => respond(value),
					err => respond(undefined, String(err instanceof Error ? err.message : err))
				);
			} else {
				respond(result);
			}
		} catch (err) {
			respond(undefined, String(err instanceof Error ? err.message : err));
		}
	}

	private _handleResponse(message: IWebviewRpcMessage): void {
		const pending = this._pending.get(message.id!);
		if (!pending) {
			return;
		}
		this._pending.delete(message.id!);
		if (message.error !== undefined) {
			pending.reject(new Error(message.error));
		} else {
			pending.resolve(message.data);
		}
	}
}
