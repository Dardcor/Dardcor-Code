/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export function getKoreanAltChars(code: number): ArrayLike<number> | undefined {
	const result = disassembleKorean(code);
	if (result && result.length > 0) {
		return new Uint32Array(result);
	}
	return undefined;
}

let codeBufferLength = 0;
const codeBuffer = new Uint32Array(10);
function disassembleKorean(code: number): Uint32Array | undefined {
	codeBufferLength = 0;

	getCodesFromArray(code, modernConsonants, HangulRangeStartCode.InitialConsonant);
	if (codeBufferLength > 0) {
		return codeBuffer.subarray(0, codeBufferLength);
	}

	getCodesFromArray(code, modernVowels, HangulRangeStartCode.Vowel);
	if (codeBufferLength > 0) {
		return codeBuffer.subarray(0, codeBufferLength);
	}

	getCodesFromArray(code, modernFinalConsonants, HangulRangeStartCode.FinalConsonant);
	if (codeBufferLength > 0) {
		return codeBuffer.subarray(0, codeBufferLength);
	}

	getCodesFromArray(code, compatibilityJamo, HangulRangeStartCode.CompatibilityJamo);
	if (codeBufferLength) {
		return codeBuffer.subarray(0, codeBufferLength);
	}

	if (code >= 0xAC00 && code <= 0xD7A3) {
		const hangulIndex = code - 0xAC00;
		const vowelAndFinalConsonantProduct = hangulIndex % 588;

		const initialConsonantIndex = Math.floor(hangulIndex / 588);
		const vowelIndex = Math.floor(vowelAndFinalConsonantProduct / 28);
		const finalConsonantIndex = vowelAndFinalConsonantProduct % 28 - 1;

		if (initialConsonantIndex < modernConsonants.length) {
			getCodesFromArray(initialConsonantIndex, modernConsonants, 0);
		} else if (HangulRangeStartCode.InitialConsonant + initialConsonantIndex - HangulRangeStartCode.CompatibilityJamo < compatibilityJamo.length) {
			getCodesFromArray(HangulRangeStartCode.InitialConsonant + initialConsonantIndex, compatibilityJamo, HangulRangeStartCode.CompatibilityJamo);
		}

		if (vowelIndex < modernVowels.length) {
			getCodesFromArray(vowelIndex, modernVowels, 0);
		} else if (HangulRangeStartCode.Vowel + vowelIndex - HangulRangeStartCode.CompatibilityJamo < compatibilityJamo.length) {
			getCodesFromArray(HangulRangeStartCode.Vowel + vowelIndex - HangulRangeStartCode.CompatibilityJamo, compatibilityJamo, HangulRangeStartCode.CompatibilityJamo);
		}

		if (finalConsonantIndex >= 0) {
			if (finalConsonantIndex < modernFinalConsonants.length) {
				getCodesFromArray(finalConsonantIndex, modernFinalConsonants, 0);
			} else if (HangulRangeStartCode.FinalConsonant + finalConsonantIndex - HangulRangeStartCode.CompatibilityJamo < compatibilityJamo.length) {
				getCodesFromArray(HangulRangeStartCode.FinalConsonant + finalConsonantIndex - HangulRangeStartCode.CompatibilityJamo, compatibilityJamo, HangulRangeStartCode.CompatibilityJamo);
			}
		}

		if (codeBufferLength > 0) {
			return codeBuffer.subarray(0, codeBufferLength);
		}
	}
	return undefined;
}

function getCodesFromArray(code: number, array: ArrayLike<number>, arrayStartIndex: number): void {
	if (code >= arrayStartIndex && code < arrayStartIndex + array.length) {
		addCodesToBuffer(array[code - arrayStartIndex]);
	}
}

function addCodesToBuffer(codes: number): void {
	if (codes === AsciiCode.NUL) {
		return;
	}
	codeBuffer[codeBufferLength++] = codes & 0xFF;
	if (codes >> 8) {
		codeBuffer[codeBufferLength++] = (codes >> 8) & 0xFF;
	}
	if (codes >> 16) {
		codeBuffer[codeBufferLength++] = (codes >> 16) & 0xFF;
	}
}

const enum HangulRangeStartCode {
	InitialConsonant = 0x1100,
	Vowel = 0x1161,
	FinalConsonant = 0x11A8,
	CompatibilityJamo = 0x3131,
}

const enum AsciiCode {
	NUL = 0,
	A = 65,
	B = 66,
	C = 67,
	D = 68,
	E = 69,
	F = 70,
	G = 71,
	H = 72,
	I = 73,
	J = 74,
	K = 75,
	L = 76,
	M = 77,
	N = 78,
	O = 79,
	P = 80,
	Q = 81,
	R = 82,
	S = 83,
	T = 84,
	U = 85,
	V = 86,
	W = 87,
	X = 88,
	Y = 89,
	Z = 90,
	a = 97,
	b = 98,
	c = 99,
	d = 100,
	e = 101,
	f = 102,
	g = 103,
	h = 104,
	i = 105,
	j = 106,
	k = 107,
	l = 108,
	m = 109,
	n = 110,
	o = 111,
	p = 112,
	q = 113,
	r = 114,
	s = 115,
	t = 116,
	u = 117,
	v = 118,
	w = 119,
	x = 120,
	y = 121,
	z = 122,
}

const enum AsciiCodeCombo {
	fa = AsciiCode.a << 8 | AsciiCode.f,
	fg = AsciiCode.g << 8 | AsciiCode.f,
	fq = AsciiCode.q << 8 | AsciiCode.f,
	fr = AsciiCode.r << 8 | AsciiCode.f,
	ft = AsciiCode.t << 8 | AsciiCode.f,
	fv = AsciiCode.v << 8 | AsciiCode.f,
	fx = AsciiCode.x << 8 | AsciiCode.f,
	hk = AsciiCode.k << 8 | AsciiCode.h,
	hl = AsciiCode.l << 8 | AsciiCode.h,
	ho = AsciiCode.o << 8 | AsciiCode.h,
	ml = AsciiCode.l << 8 | AsciiCode.m,
	nj = AsciiCode.j << 8 | AsciiCode.n,
	nl = AsciiCode.l << 8 | AsciiCode.n,
	np = AsciiCode.p << 8 | AsciiCode.n,
	qt = AsciiCode.t << 8 | AsciiCode.q,
	rt = AsciiCode.t << 8 | AsciiCode.r,
	sg = AsciiCode.g << 8 | AsciiCode.s,
	sw = AsciiCode.w << 8 | AsciiCode.s,
}

const modernConsonants = new Uint8Array([
	AsciiCode.r,
	AsciiCode.R,
	AsciiCode.s,
	AsciiCode.e,
	AsciiCode.E,
	AsciiCode.f,
	AsciiCode.a,
	AsciiCode.q,
	AsciiCode.Q,
	AsciiCode.t,
	AsciiCode.T,
	AsciiCode.d,
	AsciiCode.w,
	AsciiCode.W,
	AsciiCode.c,
	AsciiCode.z,
	AsciiCode.x,
	AsciiCode.v,
	AsciiCode.g,
]);

const modernVowels = new Uint16Array([
	AsciiCode.k,
	AsciiCode.o,
	AsciiCode.i,
	AsciiCode.O,
	AsciiCode.j,
	AsciiCode.p,
	AsciiCode.u,
	AsciiCode.P,
	AsciiCode.h,
	AsciiCodeCombo.hk,
	AsciiCodeCombo.ho,
	AsciiCodeCombo.hl,
	AsciiCode.y,
	AsciiCode.n,
	AsciiCodeCombo.nj,
	AsciiCodeCombo.np,
	AsciiCodeCombo.nl,
	AsciiCode.b,
	AsciiCode.m,
	AsciiCodeCombo.ml,
	AsciiCode.l,
]);

const modernFinalConsonants = new Uint16Array([
	AsciiCode.r,
	AsciiCode.R,
	AsciiCodeCombo.rt,
	AsciiCode.s,
	AsciiCodeCombo.sw,
	AsciiCodeCombo.sg,
	AsciiCode.e,
	AsciiCode.f,
	AsciiCodeCombo.fr,
	AsciiCodeCombo.fa,
	AsciiCodeCombo.fq,
	AsciiCodeCombo.ft,
	AsciiCodeCombo.fx,
	AsciiCodeCombo.fv,
	AsciiCodeCombo.fg,
	AsciiCode.a,
	AsciiCode.q,
	AsciiCodeCombo.qt,
	AsciiCode.t,
	AsciiCode.T,
	AsciiCode.d,
	AsciiCode.w,
	AsciiCode.c,
	AsciiCode.z,
	AsciiCode.x,
	AsciiCode.v,
	AsciiCode.g,
]);

const compatibilityJamo = new Uint16Array([
	AsciiCode.r,
	AsciiCode.R,
	AsciiCodeCombo.rt,
	AsciiCode.s,
	AsciiCodeCombo.sw,
	AsciiCodeCombo.sg,
	AsciiCode.e,
	AsciiCode.E,
	AsciiCode.f,
	AsciiCodeCombo.fr,
	AsciiCodeCombo.fa,
	AsciiCodeCombo.fq,
	AsciiCodeCombo.ft,
	AsciiCodeCombo.fx,
	AsciiCodeCombo.fv,
	AsciiCodeCombo.fg,
	AsciiCode.a,
	AsciiCode.q,
	AsciiCode.Q,
	AsciiCodeCombo.qt,
	AsciiCode.t,
	AsciiCode.T,
	AsciiCode.d,
	AsciiCode.w,
	AsciiCode.W,
	AsciiCode.c,
	AsciiCode.z,
	AsciiCode.x,
	AsciiCode.v,
	AsciiCode.g,
	AsciiCode.k,
	AsciiCode.o,
	AsciiCode.i,
	AsciiCode.O,
	AsciiCode.j,
	AsciiCode.p,
	AsciiCode.u,
	AsciiCode.P,
	AsciiCode.h,
	AsciiCodeCombo.hk,
	AsciiCodeCombo.ho,
	AsciiCodeCombo.hl,
	AsciiCode.y,
	AsciiCode.n,
	AsciiCodeCombo.nj,
	AsciiCodeCombo.np,
	AsciiCodeCombo.nl,
	AsciiCode.b,
	AsciiCode.m,
	AsciiCodeCombo.ml,
	AsciiCode.l,
]);
