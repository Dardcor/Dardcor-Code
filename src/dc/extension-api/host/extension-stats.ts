import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IExtensionStats {
	readonly cpuPercent: number;
	readonly memoryMB: number;
}

export interface IExtensionStatsOptions {
	readonly intervalMs?: number;
}

export class ExtensionStats extends Disposable {
	private _timer: ReturnType<typeof setInterval> | undefined;
	private _lastCpuUsage = 0;
	private _lastSampleTime = 0;
	private _stats: IExtensionStats = { cpuPercent: 0, memoryMB: 0 };

	private readonly _onDidUpdate = this._register(new Emitter<IExtensionStats>());
	readonly onDidUpdate: Event<IExtensionStats> = this._onDidUpdate.event;

	constructor(private readonly _options: IExtensionStatsOptions = {}) {
		super();
	}

	public start(): void {
		if (this._timer) {
			return;
		}
		this._lastCpuUsage = this._cpuTotal();
		this._lastSampleTime = Date.now();
		this._timer = setInterval(() => this._sample(), this._options.intervalMs ?? 1000);
	}

	public stop(): void {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = undefined;
		}
	}

	public getStats(): IExtensionStats {
		return { ...this._stats };
	}

	public isRunning(): boolean {
		return this._timer !== undefined;
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private _sample(): void {
		const now = Date.now();
		const elapsed = Math.max(1, now - this._lastSampleTime);
		const cpu = this._cpuTotal();
		const cpuDelta = Math.max(0, cpu - this._lastCpuUsage);
		const cpuPercent = cpuDelta > 0 ? Math.min(100, (cpuDelta / elapsed / 1000) * 100) : 0;
		const memoryMB = this._memoryMB();
		this._lastCpuUsage = cpu;
		this._lastSampleTime = now;
		this._stats = { cpuPercent, memoryMB };
		this._onDidUpdate.fire({ ...this._stats });
	}

	private _cpuTotal(): number {
		if (typeof process !== 'undefined' && typeof process.cpuUsage === 'function') {
			const usage = process.cpuUsage();
			return usage.user + usage.system;
		}
		return 0;
	}

	private _memoryMB(): number {
		if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
			return process.memoryUsage().heapUsed / 1024 / 1024;
		}
		return 0;
	}
}
