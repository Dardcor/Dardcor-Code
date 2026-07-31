/**
 * Dardcor Code - Browser WebSocket Client Connection Bridge (Task 813)
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export interface IWebSocketClientOptions {
	readonly protocols?: string | string[];
	readonly binaryType?: 'arraybuffer' | 'blob';
}

export class WebSocketClientBridge extends Disposable {
	private _socket: WebSocket | null = null;
	private _ready = false;

	private readonly _onOpen = this._register(new Emitter<void>());
	readonly onOpen: Event<void> = this._onOpen.event;

	private readonly _onMessage = this._register(new Emitter<Uint8Array>());
	readonly onMessage: Event<Uint8Array> = this._onMessage.event;

	private readonly _onClose = this._register(new Emitter<{ code: number; reason: string }>());
	readonly onClose: Event<{ code: number; reason: string }> = this._onClose.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(
		private readonly _url: string,
		private readonly _options: IWebSocketClientOptions = {}
	) {
		super();
	}

	get ready(): boolean {
		return this._ready && this._socket !== null && this._socket.readyState === WebSocket.OPEN;
	}

	connect(): void {
		if (this._socket && (this._socket.readyState === WebSocket.OPEN || this._socket.readyState === WebSocket.CONNECTING)) {
			return;
		}
		if (typeof WebSocket === 'undefined') {
			const error = new Error(
				'WebSocket is not available in this environment. ' +
				'Run in a browser or a Node.js runtime (>= 22) that provides the global WebSocket API.'
			);
			this._onError.fire(error);
			return;
		}
		const socket = new WebSocket(this._url, this._options.protocols);
		socket.binaryType = this._options.binaryType ?? 'arraybuffer';
		this._socket = socket;

		socket.onopen = () => {
			this._ready = true;
			this._onOpen.fire();
		};
		socket.onmessage = (event: MessageEvent) => {
			if (event.data instanceof ArrayBuffer) {
				this._onMessage.fire(new Uint8Array(event.data));
			} else if (event.data instanceof Blob) {
				event.data.arrayBuffer().then(buffer => this._onMessage.fire(new Uint8Array(buffer))).catch(() => undefined);
			} else {
				this._onMessage.fire(new TextEncoder().encode(String(event.data)));
			}
		};
		socket.onclose = (event: CloseEvent) => {
			this._ready = false;
			this._onClose.fire({ code: event.code, reason: event.reason });
		};
		socket.onerror = () => {
			this._onError.fire(new Error(`WebSocket connection to '${this._url}' failed`));
		};
	}

	send(data: Uint8Array | string): boolean {
		if (!this.ready) {
			return false;
		}
		try {
			this._socket!.send(data);
			return true;
		} catch (error) {
			this._onError.fire(error instanceof Error ? error : new Error(String(error)));
			return false;
		}
	}

	close(code?: number, reason?: string): void {
		this._ready = false;
		if (this._socket) {
			try {
				this._socket.close(code, reason);
			} catch {
				// ignore
			}
			this._socket = null;
		}
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}
