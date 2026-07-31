/**
 * Dardcor Code - WebSocket Ping/Pong Heartbeat Latency Monitor (Task 830)
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import {
	HeartbeatPayload,
	createHeartbeatPing,
	createHeartbeatPong,
	computeRoundTripTime
} from '../transport/heartbeat-protocol.js';

export interface IHeartbeatMonitorOptions {
	readonly intervalMs?: number;
	readonly timeoutMs?: number;
	readonly autoStart?: boolean;
}

export const enum HeartbeatState {
	Stopped = 0,
	Healthy = 1,
	Unreachable = 2
}

export interface IHeartbeatTransport {
	sendPing(payload: HeartbeatPayload): void;
	sendPong(payload: HeartbeatPayload): void;
}

export class HeartbeatMonitor extends Disposable {
	private readonly _intervalMs: number;
	private readonly _timeoutMs: number;

	private _timer: any = null;
	private _lastPingAt = 0;
	private _lastPongAt = 0;
	private _pendingSeq: number | null = null;
	private _latency = -1;
	private _state: HeartbeatState = HeartbeatState.Stopped;
	private _pingsSent = 0;
	private _pongsReceived = 0;
	private _timeouts = 0;

	private readonly _onLatency = this._register(new Emitter<number>());
	readonly onLatency: Event<number> = this._onLatency.event;

	private readonly _onStateChange = this._register(new Emitter<HeartbeatState>());
	readonly onStateChange: Event<HeartbeatState> = this._onStateChange.event;

	private readonly _onTimeout = this._register(new Emitter<void>());
	readonly onTimeout: Event<void> = this._onTimeout.event;

	constructor(
		private readonly _transport: IHeartbeatTransport,
		options: IHeartbeatMonitorOptions = {}
	) {
		super();
		this._intervalMs = options.intervalMs ?? 30000;
		this._timeoutMs = options.timeoutMs ?? 10000;
		if (options.autoStart ?? true) {
			this.start();
		}
	}

	get state(): HeartbeatState {
		return this._state;
	}

	get latency(): number {
		return this._latency;
	}

	get stats(): { pingsSent: number; pongsReceived: number; timeouts: number } {
		return { pingsSent: this._pingsSent, pongsReceived: this._pongsReceived, timeouts: this._timeouts };
	}

	start(): void {
		if (this._timer) {
			return;
		}
		this._setState(HeartbeatState.Healthy);
		this._timer = setInterval(() => this._tick(), this._intervalMs);
		if (typeof this._timer.unref === 'function') {
			this._timer.unref();
		}
		this._tick();
	}

	stop(): void {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		this._pendingSeq = null;
		this._setState(HeartbeatState.Stopped);
	}

	handleIncomingMessage(message: string): void {
		let payload: HeartbeatPayload | undefined;
		try {
			payload = JSON.parse(message) as HeartbeatPayload;
		} catch {
			return;
		}
		if (!payload || (payload.type !== 'heartbeat.ping' && payload.type !== 'heartbeat.pong')) {
			return;
		}
		if (payload.type === 'heartbeat.ping') {
			this._transport.sendPong(createHeartbeatPong(payload));
			return;
		}
		this._handlePong(payload);
	}

	private _tick(): void {
		if (this._state === HeartbeatState.Unreachable) {
			return;
		}
		if (this._pendingSeq !== null && Date.now() - this._lastPingAt > this._timeoutMs) {
			this._timeouts++;
			this._pendingSeq = null;
			this._setState(HeartbeatState.Unreachable);
			this._onTimeout.fire();
			return;
		}
		this._pingsSent++;
		this._pendingSeq = this._pingsSent;
		this._lastPingAt = Date.now();
		this._transport.sendPing(createHeartbeatPing(this._pendingSeq));
	}

	private _handlePong(payload: HeartbeatPayload): void {
		this._pongsReceived++;
		this._lastPongAt = Date.now();
		const rtt = computeRoundTripTime(
			{ type: 'heartbeat.ping', t: this._lastPingAt, seq: payload.seq },
			payload
		);
		this._latency = rtt;
		this._pendingSeq = null;
		if (this._state === HeartbeatState.Unreachable) {
			this._setState(HeartbeatState.Healthy);
		}
		this._onLatency.fire(rtt);
	}

	private _setState(state: HeartbeatState): void {
		if (this._state === state) {
			return;
		}
		this._state = state;
		this._onStateChange.fire(state);
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}
