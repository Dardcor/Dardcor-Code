/**
 * Dardcor Code - WebSocket IPC Client (Task 96)
 */

import { IDisposable } from '../lifecycle/disposable';
import { Emitter, Event } from '../events/emitter';

export class WebSocketIPCClient implements IDisposable {
	private _ws: WebSocket | null = null;
	private readonly _onMessage = new Emitter<any>();
	private readonly _onOpen = new Emitter<void>();
	private readonly _onClose = new Emitter<void>();
	private readonly _onError = new Emitter<Error>();
	readonly onMessage: Event<any> = this._onMessage.event;
	readonly onOpen: Event<void> = this._onOpen.event;
	readonly onClose: Event<void> = this._onClose.event;
	readonly onError: Event<Error> = this._onError.event;

	connect(url: string): void {
		this._ws = new WebSocket(url);
		this._ws.onopen = () => this._onOpen.fire();
		this._ws.onclose = () => this._onClose.fire();
		this._ws.onerror = () => this._onError.fire(new Error('WebSocket error'));
		this._ws.onmessage = (e) => {
			try { this._onMessage.fire(JSON.parse(e.data)); }
			catch { this._onMessage.fire(e.data); }
		};
	}

	send(data: any): void {
		this._ws?.send(typeof data === 'string' ? data : JSON.stringify(data));
	}

	get isConnected(): boolean {
		return this._ws?.readyState === WebSocket.OPEN;
	}

	close(): void {
		this._ws?.close();
		this._ws = null;
	}

	dispose(): void {
		this.close();
		this._onMessage.dispose();
		this._onOpen.dispose();
		this._onClose.dispose();
		this._onError.dispose();
	}
}
