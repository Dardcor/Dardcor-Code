import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import * as os from 'os';

export interface CpuSample {
	timestamp: number;
	percent: number;
	user: number;
	system: number;
}

export class CpuSampler extends Disposable {
	private _timer: NodeJS.Timeout | null = null;
	private _intervalMs: number;
	private _lastCpuUsage: NodeJS.CpuUsage | null = null;
	private _lastTime: number | null = null;
	private _samples: CpuSample[] = [];
	private readonly _maxSamples: number;
	private _currentPercent = 0;

	constructor(intervalMs: number = 1000, maxSamples: number = 60) {
		super();
		this._intervalMs = Math.max(50, intervalMs);
		this._maxSamples = Math.max(10, maxSamples);
	}

	public start(intervalMs?: number): void {
		if (this._timer) {
			return;
		}
		if (intervalMs !== undefined && intervalMs > 0) {
			this._intervalMs = intervalMs;
		}
		this._lastCpuUsage = process.cpuUsage();
		this._lastTime = Date.now();
		this._timer = setInterval(() => this._sample(), this._intervalMs);
		this._timer.unref?.();
		this._register(toDisposable(() => this.stop()));
	}

	public stop(): void {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	public isRunning(): boolean {
		return this._timer !== null;
	}

	public getCpuPercent(): number {
		return this._currentPercent;
	}

	public getLastSamples(): CpuSample[] {
		return [...this._samples];
	}

	public getRecentSamples(count: number): CpuSample[] {
		return this._samples.slice(-count);
	}

	public getAveragePercent(): number {
		if (this._samples.length === 0) {
			return this._currentPercent;
		}
		const sum = this._samples.reduce((acc, sample) => acc + sample.percent, 0);
		return sum / this._samples.length;
	}

	public getPeakPercent(): number {
		return this._samples.reduce((max, sample) => Math.max(max, sample.percent), this._currentPercent);
	}

	public getStats(): { current: number; average: number; peak: number; samples: number } {
		return {
			current: this._currentPercent,
			average: this.getAveragePercent(),
			peak: this.getPeakPercent(),
			samples: this._samples.length
		};
	}

	public reset(): void {
		this._samples = [];
		this._currentPercent = 0;
		this._lastCpuUsage = null;
		this._lastTime = null;
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private _sample(): void {
		const now = Date.now();
		const current = process.cpuUsage();
		if (this._lastCpuUsage && this._lastTime) {
			const deltaTime = now - this._lastTime;
			if (deltaTime > 0) {
				const userDelta = current.user - this._lastCpuUsage.user;
				const systemDelta = current.system - this._lastCpuUsage.system;
				const totalDelta = userDelta + systemDelta;
				const cores = Math.max(1, os.cpus().length);
				const percent = Math.min(100 * cores, (totalDelta / 1000) / deltaTime * 100);
				this._currentPercent = Math.max(0, Math.min(100 * cores, percent));
				this._samples.push({
					timestamp: now,
					percent: this._currentPercent,
					user: userDelta,
					system: systemDelta
				});
				if (this._samples.length > this._maxSamples) {
					this._samples.shift();
				}
			}
		}
		this._lastCpuUsage = current;
		this._lastTime = now;
	}
}

export function createCpuSampler(intervalMs?: number): CpuSampler {
	return new CpuSampler(intervalMs);
}

export function sampleCpuNow(): number {
	const sampler = new CpuSampler(1000, 2);
	sampler.start(250);
	sampler.stop();
	return sampler.getCpuPercent();
}
