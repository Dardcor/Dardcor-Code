/**
 * Dardcor Code - Cubic Bezier Timing Curves (Task 87)
 * Mirrors: CSS animation easing functions
 */

export class CubicBezier {
	private readonly _cx3: number;
	private readonly _bx: number;
	private readonly _ax: number;
	private readonly _cy3: number;
	private readonly _by: number;
	private readonly _ay: number;

	constructor(
		public readonly x1: number,
		public readonly y1: number,
		public readonly x2: number,
		public readonly y2: number
	) {
		this._cx3 = 3.0 * x1;
		this._bx = 3.0 * (x2 - x1) - this._cx3;
		this._ax = 1.0 - this._cx3 - this._bx;
		this._cy3 = 3.0 * y1;
		this._by = 3.0 * (y2 - y1) - this._cy3;
		this._ay = 1.0 - this._cy3 - this._by;
	}

	solve(t: number): number {
		return this._sampleCurveY(this._solveCurveX(t));
	}

	private _sampleCurveX(t: number): number {
		return ((this._ax * t + this._bx) * t + this._cx3) * t;
	}

	private _sampleCurveY(t: number): number {
		return ((this._ay * t + this._by) * t + this._cy3) * t;
	}

	private _sampleCurveDerivativeX(t: number): number {
		return (3.0 * this._ax * t + 2.0 * this._bx) * t + this._cx3;
	}

	private _solveCurveX(x: number): number {
		let t = x;
		// Newton-Raphson iterations
		for (let i = 0; i < 8; i++) {
			const x2 = this._sampleCurveX(t) - x;
			if (Math.abs(x2) < 1e-7) return t;
			const d2 = this._sampleCurveDerivativeX(t);
			if (Math.abs(d2) < 1e-7) break;
			t -= x2 / d2;
		}
		// Bisection fallback
		let t0 = 0, t1 = 1;
		t = x;
		while (t0 < t1) {
			const x2 = this._sampleCurveX(t);
			if (Math.abs(x2 - x) < 1e-7) return t;
			if (x > x2) { t0 = t; } else { t1 = t; }
			t = (t1 - t0) * 0.5 + t0;
		}
		return t;
	}

	toCSSString(): string {
		return `cubic-bezier(${this.x1}, ${this.y1}, ${this.x2}, ${this.y2})`;
	}
}

// Standard CSS timing functions
export const EASE = new CubicBezier(0.25, 0.1, 0.25, 1.0);
export const EASE_IN = new CubicBezier(0.42, 0, 1.0, 1.0);
export const EASE_OUT = new CubicBezier(0, 0, 0.58, 1.0);
export const EASE_IN_OUT = new CubicBezier(0.42, 0, 0.58, 1.0);
export const LINEAR = new CubicBezier(0, 0, 1, 1);

// VS Code-style smooth scrolling
export const SMOOTH_SCROLL = new CubicBezier(0.1, 0.9, 0.2, 1.0);
