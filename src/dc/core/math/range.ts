/**
 * Dardcor Code - 1D Numerical Range Math
 */

export interface INumericalRange {
	start: number;
	end: number;
}

export namespace NumericalRange {
	export function contains(range: INumericalRange, value: number): boolean {
		return value >= range.start && value <= range.end;
	}

	export function intersects(a: INumericalRange, b: INumericalRange): boolean {
		return a.start <= b.end && b.start <= a.end;
	}

	export function length(range: INumericalRange): number {
		return Math.max(0, range.end - range.start);
	}
}
