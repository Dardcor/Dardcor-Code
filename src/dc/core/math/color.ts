/**
 * Dardcor Code - RGBA, HSL, Hex Color Parsing (Task 71)
 * Mirrors: vs/base/common/color.ts
 */

function roundFloat(number: number, decimalPoints: number): number {
	const decimal = Math.pow(10, decimalPoints);
	return Math.round(number * decimal) / decimal;
}

export class RGBA {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;

	constructor(r: number, g: number, b: number, a: number = 1) {
		this.r = Math.min(255, Math.max(0, r)) | 0;
		this.g = Math.min(255, Math.max(0, g)) | 0;
		this.b = Math.min(255, Math.max(0, b)) | 0;
		this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
	}

	static equals(a: RGBA, b: RGBA): boolean {
		return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
	}
}

export class HSLA {
	readonly h: number;
	readonly s: number;
	readonly l: number;
	readonly a: number;

	constructor(h: number, s: number, l: number, a: number) {
		this.h = Math.max(Math.min(360, h), 0) | 0;
		this.s = roundFloat(Math.max(Math.min(1, s), 0), 3);
		this.l = roundFloat(Math.max(Math.min(1, l), 0), 3);
		this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
	}

	static equals(a: HSLA, b: HSLA): boolean {
		return a.h === b.h && a.s === b.s && a.l === b.l && a.a === b.a;
	}

	static fromRGBA(rgba: RGBA): HSLA {
		const r = rgba.r / 255;
		const g = rgba.g / 255;
		const b = rgba.b / 255;
		const a = rgba.a;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0, s = 0;
		const l = (min + max) / 2;
		const chroma = max - min;
		if (chroma > 0) {
			s = Math.min(l <= 0.5 ? chroma / (2 * l) : chroma / (2 - 2 * l), 1);
			switch (max) {
				case r: h = (g - b) / chroma + (g < b ? 6 : 0); break;
				case g: h = (b - r) / chroma + 2; break;
				case b: h = (r - g) / chroma + 4; break;
			}
			h *= 60;
			h = Math.round(h);
		}
		return new HSLA(h, s, l, a);
	}

	static toRGBA(hsla: HSLA): RGBA {
		const h = hsla.h / 360;
		const s = hsla.s;
		const l = hsla.l;
		const a = hsla.a;
		let r: number, g: number, b: number;
		if (s === 0) {
			r = g = b = l;
		} else {
			const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			const p = 2 * l - q;
			r = hue2rgb(p, q, h + 1 / 3);
			g = hue2rgb(p, q, h);
			b = hue2rgb(p, q, h - 1 / 3);
		}
		return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a);
	}
}

function hue2rgb(p: number, q: number, t: number): number {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

export class Color {
	readonly rgba: RGBA;

	constructor(arg: RGBA | HSLA) {
		if (arg instanceof HSLA) {
			this.rgba = HSLA.toRGBA(arg);
		} else {
			this.rgba = arg;
		}
	}

	get hsla(): HSLA {
		return HSLA.fromRGBA(this.rgba);
	}

	equals(other: Color | null): boolean {
		return !!other && RGBA.equals(this.rgba, other.rgba);
	}

	isLighter(): boolean {
		const hsla = this.hsla;
		return hsla.l > 0.5;
	}

	isLighterThan(other: Color): boolean {
		const dominated = this.hsla.l;
		const other_l = other.hsla.l;
		return dominated > other_l;
	}

	isDarkerThan(other: Color): boolean {
		const dominated = this.hsla.l;
		const other_l = other.hsla.l;
		return dominated < other_l;
	}

	lighten(factor: number): Color {
		return new Color(new HSLA(this.hsla.h, this.hsla.s, this.hsla.l + this.hsla.l * factor, this.hsla.a));
	}

	darken(factor: number): Color {
		return new Color(new HSLA(this.hsla.h, this.hsla.s, this.hsla.l - this.hsla.l * factor, this.hsla.a));
	}

	transparent(factor: number): Color {
		const { r, g, b, a } = this.rgba;
		return new Color(new RGBA(r, g, b, a * factor));
	}

	opposite(): Color {
		return new Color(new RGBA(255 - this.rgba.r, 255 - this.rgba.g, 255 - this.rgba.b, this.rgba.a));
	}

	toString(): string {
		if (this.rgba.a === 1) {
			return Color.toHex(this);
		}
		return `rgba(${this.rgba.r}, ${this.rgba.g}, ${this.rgba.b}, ${this.rgba.a})`;
	}

	static toHex(color: Color): string {
		const r = color.rgba.r.toString(16).padStart(2, '0');
		const g = color.rgba.g.toString(16).padStart(2, '0');
		const b = color.rgba.b.toString(16).padStart(2, '0');
		if (color.rgba.a === 1) {
			return `#${r}${g}${b}`;
		}
		const a = Math.round(color.rgba.a * 255).toString(16).padStart(2, '0');
		return `#${r}${g}${b}${a}`;
	}

	static fromHex(hex: string): Color {
		return parseHex(hex) || new Color(new RGBA(0, 0, 0, 1));
	}

	static readonly WHITE = new Color(new RGBA(255, 255, 255, 1));
	static readonly BLACK = new Color(new RGBA(0, 0, 0, 1));
	static readonly RED = new Color(new RGBA(255, 0, 0, 1));
	static readonly GREEN = new Color(new RGBA(0, 255, 0, 1));
	static readonly BLUE = new Color(new RGBA(0, 0, 255, 1));
	static readonly TRANSPARENT = new Color(new RGBA(0, 0, 0, 0));

	static blend(c1: Color, c2: Color, factor: number = 0.5): Color {
		const r = Math.round(c1.rgba.r * (1 - factor) + c2.rgba.r * factor);
		const g = Math.round(c1.rgba.g * (1 - factor) + c2.rgba.g * factor);
		const b = Math.round(c1.rgba.b * (1 - factor) + c2.rgba.b * factor);
		const a = c1.rgba.a * (1 - factor) + c2.rgba.a * factor;
		return new Color(new RGBA(r, g, b, a));
	}

	static getLuminosity(color: Color): number {
		const r = color.rgba.r / 255;
		const g = color.rgba.g / 255;
		const b = color.rgba.b / 255;
		const lr = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
		const lg = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
		const lb = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
		return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
	}
}

function parseHex(hex: string): Color | null {
	const val = hex.replace('#', '');
	if (val.length === 3) {
		const r = parseInt(val[0] + val[0], 16);
		const g = parseInt(val[1] + val[1], 16);
		const b = parseInt(val[2] + val[2], 16);
		return new Color(new RGBA(r, g, b, 1));
	}
	if (val.length === 6) {
		const r = parseInt(val.substring(0, 2), 16);
		const g = parseInt(val.substring(2, 4), 16);
		const b = parseInt(val.substring(4, 6), 16);
		return new Color(new RGBA(r, g, b, 1));
	}
	if (val.length === 8) {
		const r = parseInt(val.substring(0, 2), 16);
		const g = parseInt(val.substring(2, 4), 16);
		const b = parseInt(val.substring(4, 6), 16);
		const a = parseInt(val.substring(6, 8), 16) / 255;
		return new Color(new RGBA(r, g, b, a));
	}
	return null;
}

export function parseColor(str: string): Color | null {
	if (str.startsWith('#')) return parseHex(str);
	const rgbaMatch = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
	if (rgbaMatch) {
		return new Color(new RGBA(
			parseInt(rgbaMatch[1]),
			parseInt(rgbaMatch[2]),
			parseInt(rgbaMatch[3]),
			rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
		));
	}
	return null;
}
