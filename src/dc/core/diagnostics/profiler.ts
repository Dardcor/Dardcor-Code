/**
 * Dardcor Code - Micro-Benchmark Profiler Timer
 */

export class Profiler {
	private static _starts = new Map<string, number>();

	public static start(name: string): void {
		this._starts.set(name, performance.now());
	}

	public static stop(name: string): number {
		const start = this._starts.get(name);
		if (start === undefined) return 0;
		const elapsed = performance.now() - start;
		this._starts.delete(name);
		return elapsed;
	}
}
