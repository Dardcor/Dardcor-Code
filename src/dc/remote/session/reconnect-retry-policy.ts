import { Emitter, Event } from '../../core/events/emitter';

export interface IReconnectRetryPolicyOptions {
	readonly baseDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly maxAttempts?: number;
	readonly factor?: number;
	readonly jitterRatio?: number;
	readonly maxTotalTimeMs?: number;
}

export interface IRetryDecision {
	readonly shouldRetry: boolean;
	readonly delayMs: number;
	readonly attempt: number;
	readonly reason: 'within-max-attempts' | 'max-attempts-reached' | 'time-budget-exhausted' | 'max-delay-capped';
}

export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;
export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_FACTOR = 2;
export const DEFAULT_JITTER_RATIO = 0.3;

export function computeExponentialDelay(attempt: number, baseDelayMs: number, factor: number, maxDelayMs: number): number {
	const raw = baseDelayMs * Math.pow(factor, Math.max(0, attempt - 1));
	return Math.min(maxDelayMs, Math.round(raw));
}

export function applyJitter(delayMs: number, jitterRatio: number): number {
	if (jitterRatio <= 0) {
		return delayMs;
	}
	const jitter = delayMs * jitterRatio * (Math.random() * 2 - 1);
	return Math.max(0, Math.round(delayMs + jitter));
}

export class ReconnectRetryPolicy {
	private readonly _baseDelayMs: number;
	private readonly _maxDelayMs: number;
	private readonly _maxAttempts: number;
	private readonly _factor: number;
	private readonly _jitterRatio: number;
	private readonly _maxTotalTimeMs: number;

	private _attempt = 0;
	private _startedAt = 0;

	private readonly _onDidReset = new Emitter<void>();
	readonly onDidReset: Event<void> = this._onDidReset.event;

	constructor(options: IReconnectRetryPolicyOptions = {}) {
		this._baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
		this._maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
		this._maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
		this._factor = options.factor ?? DEFAULT_FACTOR;
		this._jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;
		this._maxTotalTimeMs = options.maxTotalTimeMs ?? this._maxDelayMs * this._maxAttempts;
	}

	get maxAttempts(): number {
		return this._maxAttempts;
	}

	get attempt(): number {
		return this._attempt;
	}

	get baseDelayMs(): number {
		return this._baseDelayMs;
	}

	getDelay(attempt: number): number {
		const exponential = computeExponentialDelay(attempt, this._baseDelayMs, this._factor, this._maxDelayMs);
		return applyJitter(exponential, this._jitterRatio);
	}

	getNextDelay(): number {
		return this.getDelay(this._attempt + 1);
	}

	shouldRetry(attempt: number, opts: { maxAttempts?: number; maxTotalTimeMs?: number; now?: number } = {}): IRetryDecision {
		const maxAttempts = opts.maxAttempts ?? this._maxAttempts;
		const now = opts.now ?? Date.now();
		if (this._startedAt === 0) {
			this._startedAt = now;
		}
		if (attempt >= maxAttempts) {
			return { shouldRetry: false, delayMs: 0, attempt, reason: 'max-attempts-reached' };
		}
		const maxTotalTime = opts.maxTotalTimeMs ?? this._maxTotalTimeMs;
		const elapsed = now - this._startedAt;
		const delay = this.getDelay(attempt + 1);
		if (elapsed + delay > maxTotalTime) {
			return { shouldRetry: false, delayMs: 0, attempt, reason: 'time-budget-exhausted' };
		}
		return { shouldRetry: true, delayMs: delay, attempt, reason: delay >= this._maxDelayMs ? 'max-delay-capped' : 'within-max-attempts' };
	}

	getNextAttempt(): IRetryDecision {
		this._attempt++;
		if (this._startedAt === 0) {
			this._startedAt = Date.now();
		}
		return this.shouldRetry(this._attempt);
	}

	recordFailure(): void {
		this._attempt++;
	}

	recordSuccess(): void {
		this.reset();
	}

	reset(): void {
		this._attempt = 0;
		this._startedAt = 0;
		this._onDidReset.fire();
	}

	isExhausted(): boolean {
		return this._attempt >= this._maxAttempts;
	}

	getStats(): { attempt: number; nextDelayMs: number; elapsedMs: number } {
		return {
			attempt: this._attempt,
			nextDelayMs: this.getNextDelay(),
			elapsedMs: this._startedAt === 0 ? 0 : Date.now() - this._startedAt
		};
	}
}
