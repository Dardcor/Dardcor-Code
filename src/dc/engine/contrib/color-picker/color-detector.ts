/**
 * Dardcor Code - Hex/RGB Color String Regex Scanner
 */

import { ITextModel, IPosition, IRange } from "../../model/text-model.js";

export type ColorFormat = "hex" | "rgb" | "hsl";

export interface IColorDetectorResult {
	readonly range: IRange;
	readonly text: string;
	readonly hex: string;
	readonly format: ColorFormat;
}

function componentToHex(value: number): string {
	return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function parseRgbToHex(text: string): string {
	const match = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(text);
	if (!match) {
		return "#000000";
	}
	return rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]));
}

function parseHslToHex(text: string): string {
	const match = /hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(text);
	if (!match) {
		return "#000000";
	}
	const h = Number(match[1]);
	const s = Number(match[2]) / 100;
	const l = Number(match[3]) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h / 60) % 2 - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) { r = c; g = x; }
	else if (h < 120) { r = x; g = c; }
	else if (h < 180) { g = c; b = x; }
	else if (h < 240) { g = x; b = c; }
	else if (h < 300) { r = x; b = c; }
	else { r = c; b = x; }
	return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function normalizeHex(value: string): string {
	if (value.length === 4 || value.length === 5) {
		return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
	}
	return value.substring(0, 7);
}

export class ColorDetector {
	private static readonly HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
	private static readonly RGB_RE = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+)?\s*\)/g;
	private static readonly HSL_RE = /hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+)?\s*\)/g;

	public static detectLine(lineText: string, lineNumber: number): IColorDetectorResult[] {
		const results: IColorDetectorResult[] = [];
		const scanners: { regex: RegExp; format: ColorFormat }[] = [
			{ regex: ColorDetector.HEX_RE, format: "hex" },
			{ regex: ColorDetector.RGB_RE, format: "rgb" },
			{ regex: ColorDetector.HSL_RE, format: "hsl" }
		];
		for (const scanner of scanners) {
			scanner.regex.lastIndex = 0;
			for (const m of lineText.matchAll(scanner.regex)) {
				const found = m[0];
				const start = m.index ?? 0;
				const hex = found.startsWith("#")
					? normalizeHex(found)
					: /^rgb/i.test(found)
						? parseRgbToHex(found)
						: parseHslToHex(found);
				results.push({
					range: {
						startLineNumber: lineNumber,
						startColumn: start + 1,
						endLineNumber: lineNumber,
						endColumn: start + found.length + 1
					},
					text: found,
					hex,
					format: scanner.format
				});
			}
		}
		results.sort((a, b) => a.range.startColumn - b.range.startColumn);
		return results;
	}

	public static detectModel(model: ITextModel): IColorDetectorResult[] {
		const results: IColorDetectorResult[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			results.push(...ColorDetector.detectLine(model.getLineContent(line), line));
		}
		return results;
	}

	public static findAtPosition(model: ITextModel, position: IPosition): IColorDetectorResult | null {
		const matches = ColorDetector.detectLine(model.getLineContent(position.lineNumber), position.lineNumber);
		for (const match of matches) {
			if (position.column >= match.range.startColumn && position.column <= match.range.endColumn) {
				return match;
			}
		}
		return null;
	}

	public static isColorText(text: string): boolean {
		return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text) ||
			/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+)?\s*\)$/.test(text) ||
			/^hsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+)?\s*\)$/.test(text);
	}
}
