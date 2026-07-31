import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export interface UtilityMemoryStats {
	pid: number | null;
	heapUsed: number;
	heapTotal: number;
	rss: number;
	external: number;
	timestamp: number;
}

export interface UtilityProcessMemoryOptions {
	intervalMs?: number;
	onStats?: (stats: UtilityMemoryStats) => void;
}

export class UtilityProcessMemory extends Disposable {
	private _timer: NodeJS.Timeout | null = null;
	private _intervalMs: number;
	private _latest: UtilityMemoryStats | null = null;
	private _history: UtilityMemoryStats[] = [];
	private readonly _maxHistory: number;
	private readonly _caller: { call<T>(serviceName: string, method: string, ...args: unknown[]): Promise<T> };
	private readonly _serviceName: string;
	private readonly _onDidUpdate = new Emitter<UtilityMemoryStats>();
	public readonly onDidUpdate = this._onDidUpdate.event;

	constructor(
		caller: { call<T>(serviceName: string, method: string, ...args: unknown[]): Promise<T> },
		serviceName: string,
		options: UtilityProcessMemoryOptions = {}
	) {
		super();
		this._caller = caller;
		this._serviceName = serviceName;
		this._intervalMs = options.intervalMs ?? 5000;
		this._maxHistory = 120;
		this._register(this._onDidUpdate);
		this._register(toDisposable(() => this.stop()));
	}

	public start(intervalMs?: number): void {
		if (this._timer) {
			return;
		}
		if (intervalMs !== undefined && intervalMs > 0) {
			this._intervalMs = intervalMs;
		}
		this._poll();
		this._timer = setInterval(() => this._poll(), this._intervalMs);
		this._timer.unref?.();
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

	public async pollNow(): Promise<UtilityMemoryStats | null> {
		try {
			const stats = await this._caller.call<UtilityMemoryStats>(this._serviceName, 'memory:getStats');
			this._update(stats);
			return stats;
		} catch (err) {
			console.warn(`[utility-process-memory] poll for '${this._serviceName}' failed:`, err);
			return null;
		}
	}

	public getLatest(): UtilityMemoryStats | null {
		return this._latest;
	}

	public getHistory(): UtilityMemoryStats[] {
		return [...this._history];
	}

	public getAverageHeapUsedMb(): number {
		if (this._history.length === 0) {
			return 0;
		}
		const sum = this._history.reduce((acc, stats) => acc + stats.heapUsed, 0);
		return sum / this._history.length / (1024 * 1024);
	}

	public getPeakHeapUsedMb(): number {
		return this._history.reduce((max, stats) => Math.max(max, stats.heapUsed), 0) / (1024 * 1024);
	}

	public getStatsSummary(): { serviceName: string; latest: UtilityMemoryStats | null; averageMb: number; peakMb: number; samples: number } {
		return {
			serviceName: this._serviceName,
			latest: this._latest,
			averageMb: this.getAverageHeapUsedMb(),
			peakMb: this.getPeakHeapUsedMb(),
			samples: this._history.length
		};
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private async _poll(): Promise<void> {
		await this.pollNow();
	}

	private _update(stats: UtilityMemoryStats): void {
		this._latest = stats;
		this._history.push(stats);
		if (this._history.length > this._maxHistory) {
			this._history.shift();
		}
		this._onDidUpdate.fire(stats);
	}
}

export function createUtilityProcessMemory(
	caller: { call<T>(serviceName: string, method: string, ...args: unknown[]): Promise<T> },
	serviceName: string,
	options?: UtilityProcessMemoryOptions
): UtilityProcessMemory {
	return new UtilityProcessMemory(caller, serviceName, options);
}

export function formatUtilityMemory(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
