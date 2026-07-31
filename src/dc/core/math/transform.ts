/**
 * Dardcor Code - CSS 2D Transform Helper (Task 98)
 */

export class Transform2D {
	private _matrix: number[];

	constructor() {
		this._matrix = [1, 0, 0, 1, 0, 0]; // identity: [a, b, c, d, tx, ty]
	}

	static identity(): Transform2D { return new Transform2D(); }

	translate(tx: number, ty: number): Transform2D {
		this._matrix[4] += tx;
		this._matrix[5] += ty;
		return this;
	}

	scale(sx: number, sy?: number): Transform2D {
		const s = sy ?? sx;
		this._matrix[0] *= sx;
		this._matrix[3] *= s;
		return this;
	}

	rotate(angleDeg: number): Transform2D {
		const rad = angleDeg * Math.PI / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const [a, b, c, d] = this._matrix;
		this._matrix[0] = a * cos + c * sin;
		this._matrix[1] = b * cos + d * sin;
		this._matrix[2] = c * cos - a * sin;
		this._matrix[3] = d * cos - b * sin;
		return this;
	}

	toCSSString(): string {
		const [a, b, c, d, tx, ty] = this._matrix;
		return `matrix(${a}, ${b}, ${c}, ${d}, ${tx}, ${ty})`;
	}

	applyToPoint(x: number, y: number): { x: number; y: number } {
		const [a, b, c, d, tx, ty] = this._matrix;
		return { x: a * x + c * y + tx, y: b * x + d * y + ty };
	}

	reset(): Transform2D {
		this._matrix = [1, 0, 0, 1, 0, 0];
		return this;
	}
}
