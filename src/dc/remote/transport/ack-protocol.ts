import { Emitter, Event } from '../../core/events/emitter';
import { generateUuid } from '../../core/types/uuid';

export interface IAckMessage<T = unknown> {
	readonly id: string;
	readonly payload: T;
}

export interface IAckProtocolOptions {
	readonly timeoutMs?: number;
	readonly maxRetries?: number;
	readonly resendDelayMs?: number;
}

export type AckSender<T> = (frame: IAckMessage<T>) => void;

export interface IAckStats {
	readonly pending: number;
	readonly sent: number;
	readonly acked: number;
	readonly nacked: number;
	readonly timedOut: number;
	readonly retries: number;
}

export class AckProtocol {
	private readonly _timeoutMs: number;
	private readonly _maxRetries: number;
	private readonly _resendDelayMs: number;

	private readonly _pending = new Map<string, {
		readonly id: string;
		readonly payload: unknown;
		readonly send: AckSender<unknown>;
		attempts: number;
		timer: ReturnType<typeof setTimeout> | null;
		resolve: () => void;
		reject: (error: Error) => void;
	}>();

	private _sent = 0;
	private _acked = 0;
	private _nacked = 0;
	private _timedOut = 0;
	private _retries = 0;

	private readonly _onAck = new Emitter<string>();
	readonly onAck: Event<string> = this._onAck.event;

	private readonly _onNack = new Emitter<string>();
	readonly onNack: Event<string> = this._onNack.event;

	private readonly _onResend = new Emitter<{ id: string; attempt: number }>();
	readonly onResend: Event<{ id: string; attempt: number }> = this._onResend.event;

	private readonly _onError = new Emitter<{ id: string; error: Error }>();
	readonly onError: Event<{ id: string; error: Error }> = this._onError.event;

	constructor(options: IAckProtocolOptions = {}) {
		this._timeoutMs = options.timeoutMs ?? 3000;
		this._maxRetries = options.maxRetries ?? 2;
		this._resendDelayMs = options.resendDelayMs ?? this._timeoutMs;
	}

	get pendingCount(): number {
		return this._pending.size;
	}

	getStats(): IAckStats {
		return {
			pending: this._pending.size,
			sent: this._sent,
			acked: this._acked,
			nacked: this._nacked,
			timedOut: this._timedOut,
			retries: this._retries
		};
	}

	sendWithAck<T>(payload: T, send: AckSender<T>): Promise<void> {
		return this.sendWithAckId(generateUuid(), payload, send);
	}

	sendWithAckId<T>(id: string, payload: T, send: AckSender<T>): Promise<void> {
		this._sent++;
		return new Promise<void>((resolve, reject) => {
			this._pending.set(id, {
				id,
				payload,
				send: send as AckSender<unknown>,
				attempts: 0,
				timer: null,
				resolve: () => {
					this._acked++;
					this._onAck.fire(id);
					resolve();
				},
				reject: error => {
					this._nacked++;
					this._onNack.fire(id);
					this._onError.fire({ id, error });
					reject(error);
				}
			});
			this._sendFrame(id);
		});
	}

	onAckReceived(id: string): void {
		const pending = this._pending.get(id);
		if (!pending) {
			this._acked++;
			this._onAck.fire(id);
			return;
		}
		this._clearTimer(pending);
		this._pending.delete(id);
		pending.resolve();
	}

	onNackReceived(id: string, reason?: string): void {
		const pending = this._pending.get(id);
		if (!pending) {
			this._nacked++;
			this._onNack.fire(id);
			return;
		}
		this._clearTimer(pending);
		this._pending.delete(id);
		pending.reject(new Error(reason ?? `Message '${id}' was rejected by the receiver`));
	}

	resend(): number {
		const ids = [...this._pending.keys()];
		for (const id of ids) {
			this.resendId(id);
		}
		return ids.length;
	}

	resendId(id: string): boolean {
		const pending = this._pending.get(id);
		if (!pending) {
			return false;
		}
		this._clearTimer(pending);
		this._retries++;
		this._onResend.fire({ id, attempt: pending.attempts });
		this._sendFrame(id);
		return true;
	}

	getPendingIds(): string[] {
		return [...this._pending.keys()];
	}

	hasPending(id: string): boolean {
		return this._pending.has(id);
	}

	clear(): void {
		for (const pending of [...this._pending.values()]) {
			this._clearTimer(pending);
			pending.reject(new Error('AckProtocol cleared'));
		}
		this._pending.clear();
	}

	private _sendFrame(id: string): void {
		const pending = this._pending.get(id);
		if (!pending) {
			return;
		}
		pending.attempts++;
		try {
			pending.send({ id, payload: pending.payload });
		} catch (error) {
			this._pending.delete(id);
			pending.reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		pending.timer = setTimeout(() => this._onTimeout(id), this._timeoutMs);
	}

	private _onTimeout(id: string): void {
		const pending = this._pending.get(id);
		if (!pending) {
			return;
		}
		if (pending.attempts <= this._maxRetries) {
			this._retries++;
			this._onResend.fire({ id, attempt: pending.attempts });
			this._sendFrame(id);
			return;
		}
		this._timedOut++;
		this._pending.delete(id);
		pending.reject(new Error(`Message '${id}' timed out after ${pending.attempts} attempts`));
	}

	private _clearTimer(pending: { timer: ReturnType<typeof setTimeout> | null }): void {
		if (pending.timer) {
			clearTimeout(pending.timer);
			pending.timer = null;
		}
	}
}
