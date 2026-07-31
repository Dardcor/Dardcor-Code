import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter } from '../../core/events/emitter';

export interface SharedProcessLifecycleOptions {
	idleTimeoutMs?: number;
	maxLifetimeMs?: number;
	onTerminate?: () => void;
}

export interface SharedProcessLifecycleState {
	idleTimeoutMs: number;
	lastActivity: number;
	idleMs: number;
	terminated: boolean;
}

export class SharedProcessLifecycle extends Disposable {
	private _timer: NodeJS.Timeout | null = null;
	private _lifetimeTimer: NodeJS.Timeout | null = null;
	private _lastActivity = Date.now();
	private _started = false;
	private _terminated = false;
	private readonly _idleTimeoutMs: number;
	private readonly _maxLifetimeMs: number | null;
	private readonly _onDidTerminate = new Emitter<{ reason: 'idle' | 'max-lifetime' | 'manual' }>();
	public readonly onDidTerminate = this._onDidTerminate.event;

	constructor(options: SharedProcessLifecycleOptions = {}) {
		super();
		this._idleTimeoutMs = options.idleTimeoutMs ?? 60000;
		this._maxLifetimeMs = options.maxLifetimeMs ?? null;
		this._register(this._onDidTerminate);
		this._register(toDisposable(() => this.stop()));
	}

	public start(): void {
		if (this._started || this._terminated) {
			return;
		}
		this._started = true;
		this._lastActivity = Date.now();
		this._timer = setInterval(() => this._checkIdle(), Math.min(5000, this._idleTimeoutMs / 2));
		this._timer.unref?.();
		if (this._maxLifetimeMs) {
			this._lifetimeTimer = setTimeout(() => this._terminate('max-lifetime'), this._maxLifetimeMs);
			this._lifetimeTimer.unref?.();
		}
	}

	public stop(): void {
		this._started = false;
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		if (this._lifetimeTimer) {
			clearTimeout(this._lifetimeTimer);
			this._lifetimeTimer = null;
		}
	}

	public touch(): void {
		if (this._terminated) {
			return;
		}
		this._lastActivity = Date.now();
	}

	public getState(): SharedProcessLifecycleState {
		return {
			idleTimeoutMs: this._idleTimeoutMs,
			lastActivity: this._lastActivity,
			idleMs: Date.now() - this._lastActivity,
			terminated: this._terminated
		};
	}

	public isIdle(): boolean {
		return Date.now() - this._lastActivity > this._idleTimeoutMs;
	}

	public isTerminated(): boolean {
		return this._terminated;
	}

	public terminate(): void {
		this._terminate('manual');
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private _checkIdle(): void {
		if (this._terminated) {
			return;
		}
		if (Date.now() - this._lastActivity > this._idleTimeoutMs) {
			this._terminate('idle');
		}
	}

	private _terminate(reason: 'idle' | 'max-lifetime' | 'manual'): void {
		if (this._terminated) {
			return;
		}
		this._terminated = true;
		this.stop();
		this._onDidTerminate.fire({ reason });
	}
}

export function createSharedProcessLifecycle(options?: SharedProcessLifecycleOptions): SharedProcessLifecycle {
	return new SharedProcessLifecycle(options);
}
