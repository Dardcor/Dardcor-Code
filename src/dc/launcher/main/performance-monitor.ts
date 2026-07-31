import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export interface PerformanceReport {
	timestamp: number;
	lagMs: number;
	fps: number;
	intervalMs: number;
}

export interface LagStats {
	average: number;
	max: number;
	min: number;
	samples: number;
	current: number;
}

export interface PerformanceMonitorOptions {
	intervalMs?: number;
	maxSamples?: number;
	lagThresholdMs?: number;
}

export class PerformanceMonitor extends Disposable {
	private _timer: NodeJS.Timeout | null = null;
	private _lastTick: number | null = null;
	private _intervalMs: number;
	private _lagSamples: number[] = [];
	private readonly _maxSamples: number;
	private readonly _lagThresholdMs: number;
	private _currentLag = 0;
	private _currentFps = 0;
	private readonly _onDidReport = new Emitter<PerformanceReport>();
	public readonly onDidReport = this._onDidReport.event;

	constructor(options: PerformanceMonitorOptions = {}) {
		super();
		this._intervalMs = options.intervalMs ?? 1000;
		this._maxSamples = options.maxSamples ?? 120;
		this._lagThresholdMs = options.lagThresholdMs ?? 100;
		this._register(this._onDidReport);
		this._register(toDisposable(() => this.stop()));
	}

	public start(intervalMs?: number): void {
		if (this._timer) {
			return;
		}
		if (intervalMs !== undefined && intervalMs > 0) {
			this._intervalMs = intervalMs;
		}
		this._lastTick = null;
		this._timer = setInterval(() => this._tick(), this._intervalMs);
		this._timer.unref?.();
	}

	public stop(): void {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
		this._lastTick = null;
	}

	public isRunning(): boolean {
		return this._timer !== null;
	}

	public getLagStats(): LagStats {
		if (this._lagSamples.length === 0) {
			return { average: 0, max: 0, min: 0, samples: 0, current: this._currentLag };
		}
		const sum = this._lagSamples.reduce((acc, sample) => acc + sample, 0);
		return {
			average: sum / this._lagSamples.length,
			max: Math.max(...this._lagSamples),
			min: Math.min(...this._lagSamples),
			samples: this._lagSamples.length,
			current: this._currentLag
		};
	}

	public getCurrentLag(): number {
		return this._currentLag;
	}

	public getCurrentFps(): number {
		return this._currentFps;
	}

	public isLagging(): boolean {
		return this._currentLag > this._lagThresholdMs;
	}

	public getRecentReports(count: number): PerformanceReport[] {
		return this._recentReports.slice(-count);
	}

	public measureEventLoopLag(): number {
		const start = Date.now();
		const end = start + 10;
		while (Date.now() < end) {
			// Busy spin measures scheduler granularity.
		}
		return Date.now() - end;
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private _recentReports: PerformanceReport[] = [];

	private _tick(): void {
		const now = Date.now();
		let lag = 0;
		if (this._lastTick !== null) {
			lag = Math.max(0, now - this._lastTick - this._intervalMs);
		}
		this._lastTick = now;
		this._currentLag = lag;
		this._currentFps = this._intervalMs > 0 ? Math.round(1000 / this._intervalMs) : 0;
		this._lagSamples.push(lag);
		if (this._lagSamples.length > this._maxSamples) {
			this._lagSamples.shift();
		}
		const report: PerformanceReport = {
			timestamp: now,
			lagMs: lag,
			fps: this._currentFps,
			intervalMs: this._intervalMs
		};
		this._recentReports.push(report);
		if (this._recentReports.length > this._maxSamples) {
			this._recentReports.shift();
		}
		this._onDidReport.fire(report);
	}
}

export function createPerformanceMonitor(options?: PerformanceMonitorOptions): PerformanceMonitor {
	return new PerformanceMonitor(options);
}

export function measureSyncBlocking(blockingFn: () => void): number {
	const start = process.hrtime.bigint();
	blockingFn();
	const end = process.hrtime.bigint();
	return Number(end - start) / 1e6;
}
