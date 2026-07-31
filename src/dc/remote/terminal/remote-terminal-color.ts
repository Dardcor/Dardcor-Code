export type RgbColor = readonly [number, number, number];

export interface IParsedSgr {
	readonly fg?: RgbColor;
	readonly bg?: RgbColor;
	readonly fgIndex?: number;
	readonly bgIndex?: number;
	readonly bold?: boolean;
	readonly italic?: boolean;
	readonly underline?: boolean;
	readonly inverse?: boolean;
}

export const ANSI_RESET = '\x1b[0m';
export const ANSI_BOLD = '\x1b[1m';
export const ANSI_ITALIC = '\x1b[3m';
export const ANSI_UNDERLINE = '\x1b[4m';
export const ANSI_INVERSE = '\x1b[7m';

export function parseSgrSequence(sequence: string): IParsedSgr {
	const parts = sequence.split(';').map(Number);
	const result: IParsedSgr = {};
	for (let i = 0; i < parts.length; i++) {
		const code = parts[i];
		if (code === 1) {
			(result as any).bold = true;
		} else if (code === 3) {
			(result as any).italic = true;
		} else if (code === 4) {
			(result as any).underline = true;
		} else if (code === 7) {
			(result as any).inverse = true;
		} else if (code === 38 || code === 48) {
			const mode = parts[i + 1];
			if (mode === 2 && parts[i + 4] !== undefined) {
				const color: RgbColor = [parts[i + 2], parts[i + 3], parts[i + 4]];
				if (code === 38) {
					(result as any).fg = color;
				} else {
					(result as any).bg = color;
				}
				i += 4;
			} else if (mode === 5 && parts[i + 2] !== undefined) {
				const index = parts[i + 2];
				if (code === 38) {
					(result as any).fgIndex = index;
				} else {
					(result as any).bgIndex = index;
				}
				i += 2;
			}
		} else if (code >= 30 && code <= 37) {
			(result as any).fgIndex = code - 30;
		} else if (code >= 90 && code <= 97) {
			(result as any).fgIndex = code - 90 + 8;
		} else if (code >= 40 && code <= 47) {
			(result as any).bgIndex = code - 40;
		} else if (code >= 100 && code <= 107) {
			(result as any).bgIndex = code - 100 + 8;
		}
	}
	return result;
}

export function trueColorToAnsi16(color: RgbColor): number {
	const [r, g, b] = color;
	const gray = Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && Math.abs(r - b) < 12;
	if (gray) {
		const v = (r + g + b) / 3;
		if (v < 8) {
			return 0;
		}
		if (v > 248) {
			return 15;
		}
		return v > 128 ? 8 : 7;
	}
	let code = 0;
	if (r >= 128) {
		code |= 1;
	}
	if (g >= 128) {
		code |= 2;
	}
	if (b >= 128) {
		code |= 4;
	}
	let brightness = 0;
	if (r >= 192) {
		brightness++;
	}
	if (g >= 192) {
		brightness++;
	}
	if (b >= 192) {
		brightness++;
	}
	if (brightness >= 2) {
		code |= 8;
	}
	return code;
}

export function sgrForColor(color: RgbColor, foreground: boolean): string {
	return `\x1b[${foreground ? 38 : 48};2;${color[0]};${color[1]};${color[2]}m`;
}

export class RemoteTerminalColor {
	parseSgr(sequence: string): IParsedSgr {
		return parseSgrSequence(sequence);
	}

	toAnsi16(color: RgbColor): number {
		return trueColorToAnsi16(color);
	}

	toAnsi256(color: RgbColor): number {
		const [r, g, b] = color;
		const gray = Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && Math.abs(r - b) < 12;
		if (gray) {
			const v = (r + g + b) / 3;
			if (v < 8) {
				return 16;
			}
			if (v > 248) {
				return 231;
			}
			return Math.round((v - 8) / 10) + 232;
		}
		const ri = Math.round((r / 255) * 5);
		const gi = Math.round((g / 255) * 5);
		const bi = Math.round((b / 255) * 5);
		return 16 + 36 * ri + 6 * gi + bi;
	}

	colorize(text: string, fg?: RgbColor | string, bg?: RgbColor | string): string {
		let prefix = '';
		if (fg) {
			prefix += this._toSgr(fg, true);
		}
		if (bg) {
			prefix += this._toSgr(bg, false);
		}
		if (!prefix) {
			return text;
		}
		return `${prefix}${text}${ANSI_RESET}`;
	}

	stripAnsi(text: string): string {
		return text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
	}

	getColorTable(): Record<string, RgbColor> {
		return { ...VS_CODE_TERMINAL_COLORS };
	}

	getColor(name: string): RgbColor | undefined {
		const table = VS_CODE_TERMINAL_COLORS as Record<string, RgbColor>;
		return table[name] ? [...table[name]] as RgbColor : undefined;
	}

	applySgr(text: string, sequence: string): string {
		const parsed = this.parseSgr(sequence);
		let prefix = '';
		if (parsed.bold) {
			prefix += ANSI_BOLD;
		}
		if (parsed.italic) {
			prefix += ANSI_ITALIC;
		}
		if (parsed.underline) {
			prefix += ANSI_UNDERLINE;
		}
		if (parsed.inverse) {
			prefix += ANSI_INVERSE;
		}
		if (parsed.fg) {
			prefix += sgrForColor(parsed.fg, true);
		} else if (parsed.fgIndex !== undefined) {
			prefix += `\x1b[38;5;${parsed.fgIndex}m`;
		}
		if (parsed.bg) {
			prefix += sgrForColor(parsed.bg, false);
		} else if (parsed.bgIndex !== undefined) {
			prefix += `\x1b[48;5;${parsed.bgIndex}m`;
		}
		return prefix ? `${prefix}${text}${ANSI_RESET}` : text;
	}

	private _toSgr(color: RgbColor | string, foreground: boolean): string {
		if (typeof color === 'string') {
			if (color.startsWith('#')) {
				return sgrForColor(hexToRgb(color), foreground);
			}
			const named = (VS_CODE_TERMINAL_COLORS as Record<string, RgbColor>)[color];
			if (named) {
				return sgrForColor(named, foreground);
			}
			const index = Number(color);
			if (Number.isInteger(index)) {
				return `\x1b[${foreground ? 38 : 48};5;${index}m`;
			}
			return '';
		}
		return sgrForColor(color, foreground);
	}
}

export function hexToRgb(hex: string): RgbColor {
	const value = hex.replace('#', '');
	if (value.length === 3) {
		return [parseInt(value[0] + value[0], 16), parseInt(value[1] + value[1], 16), parseInt(value[2] + value[2], 16)];
	}
	return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export const VS_CODE_TERMINAL_COLORS: Record<string, RgbColor> = {
	ansiBlack: [0, 0, 0],
	ansiRed: [205, 49, 49],
	ansiGreen: [13, 188, 121],
	ansiYellow: [229, 229, 16],
	ansiBlue: [36, 114, 200],
	ansiMagenta: [188, 63, 188],
	ansiCyan: [17, 168, 205],
	ansiWhite: [229, 229, 229],
	ansiBrightBlack: [102, 102, 102],
	ansiBrightRed: [241, 76, 76],
	ansiBrightGreen: [35, 209, 139],
	ansiBrightYellow: [245, 245, 67],
	ansiBrightBlue: [59, 142, 234],
	ansiBrightMagenta: [214, 112, 214],
	ansiBrightCyan: [41, 184, 219],
	ansiBrightWhite: [255, 255, 255],
	foreground: [204, 204, 204],
	background: [30, 30, 30],
	cursor: [255, 255, 255]
};
