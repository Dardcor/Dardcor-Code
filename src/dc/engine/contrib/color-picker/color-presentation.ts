/**
 * Dardcor Code - Color String Format Converter
 */

export interface IColorPresentation {
	readonly label: string;
	readonly textEdit: string;
}

export class ColorPresentation implements IColorPresentation {
	constructor(
		public readonly label: string,
		public readonly textEdit: string
	) {}
}

export interface IRGB {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}

export interface IHSL {
	readonly h: number;
	readonly s: number;
	readonly l: number;
}

function componentToHex(value: number): string {
	return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
	return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

export function normalizeHex(hex: string): string | null {
	if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
		return null;
	}
	if (hex.length === 4) {
		return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
	}
	return hex.toLowerCase();
}

export function hexToRgb(hex: string): IRGB | null {
	const normalized = normalizeHex(hex);
	if (!normalized) {
		return null;
	}
	return {
		r: parseInt(normalized.substring(1, 3), 16),
		g: parseInt(normalized.substring(3, 5), 16),
		b: parseInt(normalized.substring(5, 7), 16)
	};
}

export function rgbToHsl(r: number, g: number, b: number): IHSL {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case rn:
				h = (gn - bn) / d + (gn < bn ? 6 : 0);
				break;
			case gn:
				h = (bn - rn) / d + 2;
				break;
			default:
				h = (rn - gn) / d + 4;
		}
		h /= 6;
	}
	return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): IRGB {
	const hn = ((h % 360) + 360) % 360 / 360;
	const sn = Math.max(0, Math.min(1, s / 100));
	const ln = Math.max(0, Math.min(1, l / 100));
	const c = (1 - Math.abs(2 * ln - 1)) * sn;
	const x = c * (1 - Math.abs((hn * 6) % 2 - 1));
	const m = ln - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (hn < 1 / 6) { r = c; g = x; }
	else if (hn < 2 / 6) { r = x; g = c; }
	else if (hn < 3 / 6) { g = c; b = x; }
	else if (hn < 4 / 6) { g = x; b = c; }
	else if (hn < 5 / 6) { r = x; b = c; }
	else { r = c; b = x; }
	return {
		r: Math.round((r + m) * 255),
		g: Math.round((g + m) * 255),
		b: Math.round((b + m) * 255)
	};
}

export function hexToHsl(hex: string): IHSL | null {
	const rgb = hexToRgb(hex);
	return rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null;
}

export function toCssRgb(hex: string): string {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return "";
	}
	return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function toCssHsl(hex: string): string {
	const hsl = hexToHsl(hex);
	if (!hsl) {
		return "";
	}
	return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

export function toCssRgba(hex: string, alpha: number): string {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return "";
	}
	return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export function getColorPresentations(hex: string): ColorPresentation[] {
	const normalized = normalizeHex(hex);
	if (!normalized) {
		return [];
	}
	const rgb = hexToRgb(normalized);
	const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null;
	const presentations: ColorPresentation[] = [new ColorPresentation(normalized, normalized)];
	if (rgb) {
		const cssRgb = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
		presentations.push(new ColorPresentation(cssRgb, cssRgb));
	}
	if (hsl) {
		const cssHsl = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
		presentations.push(new ColorPresentation(cssHsl, cssHsl));
	}
	presentations.push(new ColorPresentation(normalized.toUpperCase(), normalized.toUpperCase()));
	return presentations;
}

export function isColorString(text: string): boolean {
	return normalizeHex(text) !== null || /^rgba?\([\d,\s.]+\)$/.test(text) || /^hsla?\([\d,\s.%.]+\)$/.test(text);
}
