import { Emitter, Event } from '../../core/events/emitter.js';

export const enum ConnectionState {
	Disconnected = 0,
	Connecting = 1,
	Connected = 2,
	Reconnecting = 3
}

export interface IConnectionIndicatorInfo {
	readonly state: ConnectionState;
	readonly label: string;
	readonly cssClass: string;
	readonly since: number;
}

const STATE_LABELS: Record<ConnectionState, string> = {
	[ConnectionState.Disconnected]: 'Disconnected',
	[ConnectionState.Connecting]: 'Connecting...',
	[ConnectionState.Connected]: 'Connected to Remote',
	[ConnectionState.Reconnecting]: 'Reconnecting...'
};

const STATE_CSS_CLASSES: Record<ConnectionState, string> = {
	[ConnectionState.Disconnected]: 'dc-conn-disconnected',
	[ConnectionState.Connecting]: 'dc-conn-connecting',
	[ConnectionState.Connected]: 'dc-conn-connected',
	[ConnectionState.Reconnecting]: 'dc-conn-reconnecting'
};

export class ConnectionIndicator {
	private _state: ConnectionState = ConnectionState.Disconnected;
	private _since = Date.now();
	private _connectCount = 0;
	private _disconnectCount = 0;
	private _lastChangeAt = Date.now();

	private readonly _onDidChange = new Emitter<{ previous: ConnectionState; current: ConnectionState }>();
	readonly onDidChange: Event<{ previous: ConnectionState; current: ConnectionState }> = this._onDidChange.event;

	get status(): 'connected' | 'disconnected' | 'reconnecting' {
		switch (this._state) {
			case ConnectionState.Connected:
				return 'connected';
			case ConnectionState.Reconnecting:
				return 'reconnecting';
			default:
				return 'disconnected';
		}
	}

	get state(): ConnectionState {
		return this._state;
	}

	get since(): number {
		return this._since;
	}

	get connectCount(): number {
		return this._connectCount;
	}

	get disconnectCount(): number {
		return this._disconnectCount;
	}

	setStatus(status: 'connected' | 'disconnected' | 'reconnecting' | ConnectionState): void {
		const next = typeof status === 'number' ? status : this._toState(status);
		this._setState(next);
	}

	setConnected(): void {
		this._setState(ConnectionState.Connected);
	}

	setDisconnected(): void {
		this._setState(ConnectionState.Disconnected);
	}

	setReconnecting(): void {
		this._setState(ConnectionState.Reconnecting);
	}

	setConnecting(): void {
		this._setState(ConnectionState.Connecting);
	}

	getStatus(): 'connected' | 'disconnected' | 'reconnecting' {
		return this.status;
	}

	getLabel(): string {
		return STATE_LABELS[this._state];
	}

	getCssClass(): string {
		return STATE_CSS_CLASSES[this._state];
	}

	getInfo(): IConnectionIndicatorInfo {
		return {
			state: this._state,
			label: this.getLabel(),
			cssClass: this.getCssClass(),
			since: this._since
		};
	}

	getDowntimeMs(): number {
		if (this._state === ConnectionState.Connected) {
			return 0;
		}
		return Date.now() - this._since;
	}

	reset(): void {
		this._state = ConnectionState.Disconnected;
		this._since = Date.now();
		this._lastChangeAt = Date.now();
	}

	private _toState(status: 'connected' | 'disconnected' | 'reconnecting'): ConnectionState {
		if (status === 'connected') {
			return ConnectionState.Connected;
		}
		if (status === 'reconnecting') {
			return ConnectionState.Reconnecting;
		}
		return ConnectionState.Disconnected;
	}

	private _setState(next: ConnectionState): void {
		if (this._state === next) {
			return;
		}
		const previous = this._state;
		this._state = next;
		this._since = Date.now();
		this._lastChangeAt = Date.now();
		if (next === ConnectionState.Connected) {
			this._connectCount++;
		}
		if (previous === ConnectionState.Connected && next !== ConnectionState.Connected) {
			this._disconnectCount++;
		}
		this._onDidChange.fire({ previous, current: next });
	}
}
