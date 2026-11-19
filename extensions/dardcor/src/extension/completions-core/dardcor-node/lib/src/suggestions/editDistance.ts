/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
interface Alignment {
	distance: number;
	startOffset: number;
	endOffset: number;
}

export function editDistance<E, T extends string | E[]>(
	haystack: T,
	needle: T,
	compare: (
		haystackElem: (typeof haystack)[number],
		needleElem: (typeof needle)[number],
		haystackIndex: number,
		needleIndex: number
	) => number = (h, n) => (h === n ? 0 : 1)
): Alignment {
	if (needle.length === 0 || haystack.length === 0) { return { distance: needle.length, startOffset: 0, endOffset: 0 }; }
	let curRow = new Array<number>(needle.length + 1).fill(0);
	let curStart = new Array<number>(needle.length + 1).fill(0);
	let prevRow = new Array<number>(haystack.length + 1).fill(0);
	let prevStart = new Array<number>(haystack.length + 1).fill(0);
	let c = needle[0];
	for (let i = 0; i < haystack.length + 1; i++) {
		if (i === 0) { curRow[i] = 1; }
		else { curRow[i] = compare(haystack[i - 1], c, i - 1, 0); }
		curStart[i] = i > 0 ? i - 1 : 0;
	}
	for (let j = 1; j < needle.length; j++) {
		let swap = prevRow;
		prevRow = curRow;
		curRow = swap;
		swap = prevStart;
		prevStart = curStart;
		curStart = swap;

		c = needle[j];
		curRow[0] = j + 1;
		for (let i = 1; i < haystack.length + 1; i++) {
			const inserted = 1 + prevRow[i];
			const deleted = 1 + curRow[i - 1];
			const substituted = compare(haystack[i - 1], c, i - 1, j) + prevRow[i - 1];
			curRow[i] = Math.min(deleted, inserted, substituted);
			if (curRow[i] === substituted) {
				curStart[i] = prevStart[i - 1];
			} else if (curRow[i] === inserted) {
				curStart[i] = prevStart[i];
			} else {
				curStart[i] = curStart[i - 1];
			}
		}
	}

	let best = 0;
	for (let i = 0; i < haystack.length + 1; i++) {
		if (curRow[i] < curRow[best]) { best = i; }
	}
	return { distance: curRow[best], startOffset: curStart[best], endOffset: best };
}

type LexDictionary = Map<string, number>;

interface LexGenerator {
	(s: string): Generator<string, void, unknown>;
}

export function emptyLexDictionary(): LexDictionary {
	return new Map();
}

export function reverseLexDictionary(d: LexDictionary): string[] {
	const lookup = new Array<string>(d.size);
	for (const [lexeme, idx] of d) {
		lookup[idx] = lexeme;
	}
	return lookup;
}

export function* lexGeneratorWords(s: string): Generator<string, void, unknown> {
	let buffer = '';
	enum State {
		Word,
		Space,
		Other,
	}
	let state: State = State.Word;
	for (const c of s) {
		let newState: State;
		if (/(\p{L}|\p{Nd}|_)/u.test(c)) { newState = State.Word; }
		else if (c === ' ') { newState = State.Space; }
		else { newState = State.Other; }
		if (newState === state && newState !== State.Other) {
			buffer += c;
		} else {
			if (buffer.length > 0) { yield buffer; }
			buffer = c;
			state = newState;
		}
	}
	if (buffer.length > 0) { yield buffer; }
}

export function lexicalAnalyzer(
	s: string,
	d: LexDictionary,
	lexGenerator: LexGenerator,
	lexFilter: (lexeme: string) => boolean
): [[number, number][], LexDictionary] {
	const lexed = [] as [number, number][];
	let offset = 0;
	for (const lexeme of lexGenerator(s)) {
		if (lexFilter(lexeme)) {
			if (!d.has(lexeme)) { d.set(lexeme, d.size); }
			lexed.push([d.get(lexeme)!, offset]);
		}
		offset += lexeme.length;
	}
	return [lexed, d];
}

function notSingleSpace(s: string): boolean {
	return s !== ' ';
}

interface LexAlignment {
	lexDistance: number;
	startOffset: number;
	endOffset: number;
	haystackLexLength: number;
	needleLexLength: number;
}

export function lexEditDistance(
	haystack: string,
	needle: string,
	lexGenerator: LexGenerator = lexGeneratorWords
): LexAlignment {
	const [haystackLexed, d] = lexicalAnalyzer(haystack, emptyLexDictionary(), lexGenerator, notSingleSpace);
	const [needleLexed, dBoth] = lexicalAnalyzer(needle, d, lexGenerator, notSingleSpace);
	if (needleLexed.length === 0 || haystackLexed.length === 0) {
		return {
			lexDistance: needleLexed.length,
			startOffset: 0,
			endOffset: 0,
			haystackLexLength: haystackLexed.length,
			needleLexLength: needleLexed.length,
		};
	}
	const lookupId = reverseLexDictionary(dBoth);
	const needleLexedLength = needleLexed.length;
	const needleFirst = lookupId[needleLexed[0][0]];
	const needleLast = lookupId[needleLexed[needleLexedLength - 1][0]];
	function compare(hLexId: number, nLexId: number, hIndex: number, nIndex: number) {
		if (nIndex === 0 || nIndex === needleLexedLength - 1) {
			const haystackLexeme = lookupId[haystackLexed[hIndex][0]];
			return (nIndex === 0 && haystackLexeme.endsWith(needleFirst)) ||
				(nIndex === needleLexedLength - 1 && haystackLexeme.startsWith(needleLast))
				? 0
				: 1;
		} else {
			return hLexId === nLexId ? 0 : 1;
		}
	}
	const alignment = editDistance(
		haystackLexed.map(x => x[0]),
		needleLexed.map(x => x[0]),
		compare
	);
	const startOffset = haystackLexed[alignment.startOffset][1];
	let endOffset =
		alignment.endOffset < haystackLexed.length ? haystackLexed[alignment.endOffset][1] : haystack.length;
	if (endOffset > 0 && haystack[endOffset - 1] === ' ') { --endOffset; }

	return {
		lexDistance: alignment.distance,
		startOffset,
		endOffset,
		haystackLexLength: haystackLexed.length,
		needleLexLength: needleLexed.length,
	};
}
