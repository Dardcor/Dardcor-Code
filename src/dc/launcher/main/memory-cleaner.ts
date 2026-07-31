import { app } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface HeapStats {
	heapUsed: number;
	heapTotal: number;
	rss: number;
	external: number;
	arrayBuffers: number;
	timestamp: number;
}

export interface MemoryCleanerOptions {
	intervalMs?: number;
	thresholdMb?: number;
	gcHint?: boolean;
	onThresholdExceeded?: (stats: HeapStats) => void;
}

declare const global: any;

export function isGcAvailable(): boolean {
	return typeof global.gc === 'function';
}

export function tryRunGc(): boolean {
	try {
		if (typeof global.gc === 'function') {
			global.gc();
			return true;
		}
	} catch (err) {
		console.warn('[memory-cleaner] gc failed:', err);
	}
	return false;
}

export function getHeapStats(): HeapStats {
	const usage = process.memoryUsage();
	return {
		heapUsed: usage.heapUsed,
		heapTotal: usage.heapTotal,
		rss: usage.rss,
		external: usage.external,
		arrayBuffers: (usage as any).arrayBuffers ?? 0,
		timestamp: Date.now()
	};
}

export function formatHeapMb(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class MemoryCleaner extends Disposable {
	private _timer: NodeJS.Timeout | null = null;
	private _statsHistory: HeapStats[] = [];
	private readonly _options: MemoryCleanerOptions;
	private readonly _maxHistory: number;

	constructor(options: MemoryCleanerOptions = {}) {
		super();
		this._options = options;
		this._maxHistory = 100;
		this._register(toDisposable(() => this.stop()));
		if (options.gcHint ?? false) {
			try {
				app.commandLine.appendSwitch('js-flags', '--expose-gc');
			} catch {
				// Command line already locked.
			}
		}
	}

	public start(intervalMs?: number): void {
		if (this._timer) {
			return;
		}
		const interval = intervalMs ?? this._options.intervalMs ?? 30000;
		this._timer = setInterval(() => this._tick(), Math.max(1000, interval));
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

	public getHeapStats(): HeapStats {
		return getHeapStats();
	}

	public getHistory(): HeapStats[] {
		return [...this._statsHistory];
	}

	public getAverageHeapUsedMb(): number {
		if (this._statsHistory.length === 0) {
			return 0;
		}
		const sum = this._statsHistory.reduce((acc, s) => acc + s.heapUsed, 0);
		return sum / this._statsHistory.length / (1024 * 1024);
	}

	public getPeakHeapUsedMb(): number {
		const peak = this._statsHistory.reduce((max, s) => Math.max(max, s.heapUsed), 0);
		return peak / (1024 * 1024);
	}

	public runCleanupNow(): boolean {
		return tryRunGc();
	}

	public override dispose(): void {
		this.stop();
		super.dispose();
	}

	private _tick(): void {
		const stats = getHeapStats();
		this._statsHistory.push(stats);
		if (this._statsHistory.length > this._maxHistory) {
			this._statsHistory.shift();
		}
		const threshold = this._options.thresholdMb ?? 1536;
		const heapUsedMb = stats.heapUsed / (1024 * 1024);
		if (heapUsedMb > threshold) {
			console.warn(`[memory-cleaner] heap usage ${heapUsedMb.toFixed(1)} MB exceeds threshold ${threshold} MB`);
			const collected = tryRunGc();
			if (collected) {
				const after = getHeapStats();
				console.log(`[memory-cleaner] collected, heap now ${(after.heapUsed / (1024 * 1024)).toFixed(1)} MB`);
			}
			this._options.onThresholdExceeded?.(stats);
		}
	}
}

export function createMemoryCleaner(options?: MemoryCleanerOptions): MemoryCleaner {
	return new MemoryCleaner(options);
}

export function enableGcHints(): void {
	try {
		app.commandLine.appendSwitch('js-flags', '--expose-gc');
	} catch {
		// Ignore.
	}
}
