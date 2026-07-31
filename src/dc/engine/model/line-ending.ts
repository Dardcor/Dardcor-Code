/**
 * Dardcor Code - CRLF vs LF Line Ending Normalizer (Task 261)
 * Mirrors: vs/editor/common/model/eol.ts
 */

export const enum EndOfLinePreference {
	TextDefined = 0,
	LF = 1,
	CRLF = 2,
}

export type EndOfLineSequence = 'LF' | 'CRLF';

export interface ILineEndingInfo {
	readonly crlfCount: number;
	readonly lfCount: number;
	readonly eol: EndOfLineSequence;
}

export function detectEOL(text: string): EndOfLineSequence {
	let crlfCount = 0;
	let lfCount = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 10 /* \n */) {
			lfCount++;
			if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) {
				crlfCount++;
			}
		}
	}
	return crlfCount >= lfCount && crlfCount > 0 ? 'CRLF' : 'LF';
}

export function getEOLString(eol: EndOfLineSequence): string {
	return eol === 'CRLF' ? '\r\n' : '\n';
}

export function normalizeEOL(text: string, eol: EndOfLineSequence): string {
	const eolString = getEOLString(eol);
	return text.replace(/\r\n|\r|\n/g, eolString);
}

export function countEOLs(text: string): ILineEndingInfo {
	let crlfCount = 0;
	let lfCount = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		if (ch === 10 /* \n */) {
			lfCount++;
			if (i > 0 && text.charCodeAt(i - 1) === 13 /* \r */) {
				crlfCount++;
			}
		}
	}
	return {
		crlfCount,
		lfCount,
		eol: detectEOL(text),
	};
}

export class LineEndingNormalizer {
	private _eol: EndOfLineSequence;

	constructor(eol?: EndOfLineSequence) {
		this._eol = eol ?? 'LF';
	}

	public detect(text: string): EndOfLineSequence {
		this._eol = detectEOL(text);
		return this._eol;
	}

	public getEOL(): EndOfLineSequence {
		return this._eol;
	}

	public setEOL(eol: EndOfLineSequence): void {
		this._eol = eol;
	}

	public getEOLString(): string {
		return getEOLString(this._eol);
	}

	public normalize(text: string): string {
		return normalizeEOL(text, this._eol);
	}

	public isMixed(text: string): boolean {
		const info = countEOLs(text);
		return info.crlfCount > 0 && info.lfCount > info.crlfCount;
	}

	public static resolveEOL(eol: EndOfLinePreference, text: string): EndOfLineSequence {
		switch (eol) {
			case EndOfLinePreference.LF:
				return 'LF';
			case EndOfLinePreference.CRLF:
				return 'CRLF';
			case EndOfLinePreference.TextDefined:
			default:
				return detectEOL(text);
		}
	}
}
