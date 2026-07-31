/**
 * Dardcor Code - Auto-Reconnection State Sync Engine (Task 810)
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export const enum ReconnectionState {
	Disconnected = 0,
	Connecting = 1,
	Connected = 2,
	Reconnecting = 3,
	Stopped = 4
}

export interface IReconnectionOptions {
	readonly initialDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly maxAttempts?: number;
	readonly factor?: number;
	readonly jitterRatio?: number;
	readonly autoStart?: boolean;
}

export class ReconnectionManager extends Disposable {
	private readonly _initialDelayMs: number;
	private readonly _maxDelayMs: number;
	private readonly _maxAttempts: number;
	private readonly _factor: number;
	private readonly _jitterRatio: number;

	private _state: ReconnectionState = ReconnectionState.Disconnected;
	private _attempt = 0;
	private _timer: any = null;
	private _connectPromise: Promise<void> | null = null;
	private _hasConnectedOnce = false;

	private readonly _onDidStateChange = this._register(new Emitter<ReconnectionState>());
	readonly onDidStateChange: Event<ReconnectionState> = this._onDidStateChange.event;

	private readonly _onDidReconnect = this._register(new Emitter<{ attempt: number; wasFirstConnect: boolean }>());
	readonly onDidReconnect: Event<{ attempt: number; wasFirstConnect: boolean }> = this._onDidReconnect.event;

	private readonly _onDidGiveUp = this._register(new Emitter<void>());
	readonly onDidGiveUp: Event<void> = this._onDidGiveUp.event;

	constructor(
		private readonly _connect: () => Promise<void> | void,
		options: IReconnectionOptions = {}
	) {
		super();
		this._initialDelayMs = options.initialDelayMs ?? 500;
		this._maxDelayMs = options.maxDelayMs ?? 30000;
		this._maxAttempts = options.maxAttempts ?? Infinity;
		this._factor = options.factor ?? 2;
		this._jitterRatio = options.jitterRatio ?? 0.3;
		if (options.autoStart ?? true) {
			this.start();
		}
	}

	get state(): ReconnectionState {
		return this._state;
	}

	get attempt(): number {
		return this._attempt;
	}

	get isConnected(): boolean {
		return this._state === ReconnectionState.Connected;
	}

	start(): void {
		if (this._state === ReconnectionState.Stopped || this._state === ReconnectionState.Connecting) {
			return;
		}
		this._setState(this._hasConnectedOnce ? ReconnectionState.Reconnecting : ReconnectionState.Connecting);
		void this._runAttempt(this._hasConnectedOnce ? this._computeDelay(this._attempt) : 0);
	}

	notifyDisconnected(): void {
		if (this._state === ReconnectionState.Connected) {
			this._setState(ReconnectionState.Disconnected);
			this.start();
		}
	}

	stop(): void {
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
		this._connectPromise = null;
		this._setState(ReconnectionState.Stopped);
	}

	private async _runAttempt(delayMs: number): Promise<void> {
		if (delayMs > 0) {
			await new Promise<void>(resolve => {
				this._timer = setTimeout(resolve, delayMs);
			});
			this._timer = null;
		}
		if (this._state === ReconnectionState.Stopped) {
			return;
		}
		this._attempt++;
		this._connectPromise = Promise.resolve().then(() => this._connect());
		try {
			await this._connectPromise;
			const wasFirstConnect = !this._hasConnectedOnce;
			this._hasConnectedOnce = true;
			this._setState(ReconnectionState.Connected);
			this._onDidReconnect.fire({ attempt: this._attempt, wasFirstConnect });
			this._attempt = 0;
		} catch (error) {
			if ((this._state as ReconnectionState) === ReconnectionState.Stopped) {
				return;
			}
			if (this._attempt >= this._maxAttempts) {
				this._setState(ReconnectionState.Disconnected);
				this._onDidGiveUp.fire();
				return;
			}
			this._setState(ReconnectionState.Reconnecting);
			this.start();
			void error;
		}
	}

	private _computeDelay(attempt: number): number {
		const exponential = this._initialDelayMs * Math.pow(this._factor, Math.max(0, attempt - 1));
		const capped = Math.min(exponential, this._maxDelayMs);
		if (this._jitterRatio > 0) {
			const jitter = capped * this._jitterRatio * (Math.random() * 2 - 1);
			return Math.max(0, Math.round(capped + jitter));
		}
		return Math.round(capped);
	}

	private _setState(state: ReconnectionState): void {
		if (this._state === state) {
			return;
		}
		this._state = state;
		this._onDidStateChange.fire(state);
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}
