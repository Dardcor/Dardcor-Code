/**
 * Dardcor Code - Performance Counter (Task 90)
 * Mirrors: vs/base/common/performance.ts
 */

export interface IPerformanceMark {
	readonly name: string;
	readonly startTime: number;
}

export class PerformanceCounter {
	private readonly _marks = new Map<string, number>();
	private readonly _measures: Array<{ name: string; start: number; duration: number }> = [];

	mark(name: string): void {
		this._marks.set(name, performance.now());
	}

	measure(name: string, startMark: string, endMark?: string): number {
		const start = this._marks.get(startMark);
		if (start === undefined) return 0;
		const end = endMark ? (this._marks.get(endMark) ?? performance.now()) : performance.now();
		const duration = end - start;
		this._measures.push({ name, start, duration });
		return duration;
	}

	getMarks(): IPerformanceMark[] {
		return Array.from(this._marks.entries()).map(([name, startTime]) => ({ name, startTime }));
	}

	getMeasures(): readonly { name: string; start: number; duration: number }[] {
		return this._measures;
	}

	clearMarks(): void {
		this._marks.clear();
	}

	clearMeasures(): void {
		this._measures.length = 0;
	}

	reset(): void {
		this.clearMarks();
		this.clearMeasures();
	}
}

let _global: PerformanceCounter | null = null;

export function getGlobalPerformanceCounter(): PerformanceCounter {
	if (!_global) {
		_global = new PerformanceCounter();
	}
	return _global;
}

export function perfMark(name: string): void {
	getGlobalPerformanceCounter().mark(name);
}

export function perfMeasure(name: string, startMark: string, endMark?: string): number {
	return getGlobalPerformanceCounter().measure(name, startMark, endMark);
}
