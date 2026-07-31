/**
 * Dardcor Code - Auto-Reconnecting WebSocket Transport
 */

import { Disposable } from '../lifecycle/disposable';
import { Emitter, Event } from '../events/emitter';

export class ReconnectingWebSocket extends Disposable {
	private _ws: WebSocket | null = null;
	private _reconnectTimer: any = null;

	private readonly _onMessage = this._register(new Emitter<any>());
	readonly onMessage: Event<any> = this._onMessage.event;

	private readonly _onOpen = this._register(new Emitter<void>());
	readonly onOpen: Event<void> = this._onOpen.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose: Event<void> = this._onClose.event;

	constructor(private readonly _url: string) {
		super();
		this._connect();
	}

	private _connect(): void {
		if (typeof WebSocket === 'undefined') return;
		this._ws = new WebSocket(this._url);

		this._ws.onopen = () => {
			this._onOpen.fire();
		};

		this._ws.onmessage = e => {
			this._onMessage.fire(e.data);
		};

		this._ws.onclose = () => {
			this._onClose.fire();
			this._scheduleReconnect();
		};

		this._ws.onerror = () => {
			this._ws?.close();
		};
	}

	private _scheduleReconnect(): void {
		if (this._store.isDisposed) return;
		this._reconnectTimer = setTimeout(() => {
			this._connect();
		}, 3000);
	}

	send(data: any): void {
		if (this._ws && this._ws.readyState === WebSocket.OPEN) {
			this._ws.send(data);
		}
	}

	override dispose(): void {
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
		}
		if (this._ws) {
			this._ws.close();
			this._ws = null;
		}
		super.dispose();
	}
}
