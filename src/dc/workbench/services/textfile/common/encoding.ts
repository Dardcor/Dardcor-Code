/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Readable, ReadableStream, newWriteableStream, listenStream } from '../../../../base/common/stream.js';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { coalesce } from '../../../../base/common/arrays.js';

export const UTF8 = 'utf8';
export const UTF8_with_bom = 'utf8bom';
export const UTF16be = 'utf16be';
export const UTF16le = 'utf16le';

export type UTF_ENCODING = typeof UTF8 | typeof UTF8_with_bom | typeof UTF16be | typeof UTF16le;

export function isUTFEncoding(encoding: string): encoding is UTF_ENCODING {
	return [UTF8, UTF8_with_bom, UTF16be, UTF16le].some(utfEncoding => utfEncoding === encoding);
}

export const UTF16be_BOM = [0xFE, 0xFF];
export const UTF16le_BOM = [0xFF, 0xFE];
export const UTF8_BOM = [0xEF, 0xBB, 0xBF];

const ZERO_BYTE_DETECTION_BUFFER_MAX_LEN = 512;
const NO_ENCODING_GUESS_MIN_BYTES = 512;
const AUTO_ENCODING_GUESS_MIN_BYTES = 512 * 8;
const AUTO_ENCODING_GUESS_MAX_BYTES = 512 * 128;

export interface IDecodeStreamOptions {
	acceptTextOnly: boolean;
	guessEncoding: boolean;
	candidateGuessEncodings: string[];
	minBytesRequiredForDetection?: number;

	overwriteEncoding(detectedEncoding: string | null): Promise<string>;
}

export interface IDecodeStreamResult {
	stream: ReadableStream<string>;
	detected: IDetectedEncodingResult;
}

export const enum DecodeStreamErrorKind {

	STREAM_IS_BINARY = 1
}

export class DecodeStreamError extends Error {

	constructor(
		message: string,
		readonly decodeStreamErrorKind: DecodeStreamErrorKind
	) {
		super(message);
	}
}

export interface IDecoderStream {
	write(buffer: Uint8Array): string;
	end(): string | undefined;
}

class DecoderStream implements IDecoderStream {

	static async create(encoding: string): Promise<DecoderStream> {
		let decoder: IDecoderStream | undefined = undefined;
		if (encoding !== UTF8) {
			const iconv = await importAMDNodeModule<typeof import('@vscode/iconv-lite-umd')>('@vscode/iconv-lite-umd', 'lib/iconv-lite-umd.js');
			decoder = iconv.getDecoder(toNodeEncoding(encoding));
		} else {
			const utf8TextDecoder = new TextDecoder();
			decoder = {
				write(buffer: Uint8Array): string {
					return utf8TextDecoder.decode(buffer, {
						stream: true
					});
				},

				end(): string | undefined {
					return utf8TextDecoder.decode();
				}
			};
		}

		return new DecoderStream(decoder);
	}

	private constructor(private iconvLiteDecoder: IDecoderStream) { }

	write(buffer: Uint8Array): string {
		return this.iconvLiteDecoder.write(buffer);
	}

	end(): string | undefined {
		return this.iconvLiteDecoder.end();
	}
}

export function toDecodeStream(source: VSBufferReadableStream, options: IDecodeStreamOptions): Promise<IDecodeStreamResult> {
	const minBytesRequiredForDetection = options.minBytesRequiredForDetection ?? (options.guessEncoding ? AUTO_ENCODING_GUESS_MIN_BYTES : NO_ENCODING_GUESS_MIN_BYTES);

	return new Promise<IDecodeStreamResult>((resolve, reject) => {
		const target = newWriteableStream<string>(strings => strings.join(''));

		const bufferedChunks: VSBuffer[] = [];
		let bytesBuffered = 0;

		let decoder: IDecoderStream | undefined = undefined;

		const cts = new CancellationTokenSource();

		const createDecoder = async () => {
			try {

				const detected = await detectEncodingFromBuffer({
					buffer: VSBuffer.concat(bufferedChunks),
					bytesRead: bytesBuffered
				}, options.guessEncoding, options.candidateGuessEncodings);

				if (detected.seemsBinary && options.acceptTextOnly) {
					throw new DecodeStreamError('Stream is binary but only text is accepted for decoding', DecodeStreamErrorKind.STREAM_IS_BINARY);
				}

				detected.encoding = await options.overwriteEncoding(detected.encoding);

				decoder = await DecoderStream.create(detected.encoding);
				const decoded = decoder.write(VSBuffer.concat(bufferedChunks).buffer);
				target.write(decoded);

				bufferedChunks.length = 0;
				bytesBuffered = 0;

				resolve({
					stream: target,
					detected
				});
			} catch (error) {

				cts.cancel();
				target.destroy();

				reject(error);
			}
		};

		listenStream(source, {
			onData: async chunk => {

				if (decoder) {
					target.write(decoder.write(chunk.buffer));
				}

				else {
					bufferedChunks.push(chunk);
					bytesBuffered += chunk.byteLength;

					if (bytesBuffered >= minBytesRequiredForDetection) {

						source.pause();

						await createDecoder();

						setTimeout(() => source.resume());
					}
				}
			},
			onError: error => target.error(error),
			onEnd: async () => {

				if (!decoder) {
					await createDecoder();
				}

				target.end(decoder?.end());
			}
		}, cts.token);
	});
}

export async function toEncodeReadable(readable: Readable<string>, encoding: string, options?: { addBOM?: boolean }): Promise<VSBufferReadable> {
	const iconv = await importAMDNodeModule<typeof import('@vscode/iconv-lite-umd')>('@vscode/iconv-lite-umd', 'lib/iconv-lite-umd.js');
	const encoder = iconv.getEncoder(toNodeEncoding(encoding), options);

	let bytesWritten = false;
	let done = false;

	return {
		read() {
			if (done) {
				return null;
			}

			const chunk = readable.read();
			if (typeof chunk !== 'string') {
				done = true;

				if (!bytesWritten && options?.addBOM) {
					switch (encoding) {
						case UTF8:
						case UTF8_with_bom:
							return VSBuffer.wrap(Uint8Array.from(UTF8_BOM));
						case UTF16be:
							return VSBuffer.wrap(Uint8Array.from(UTF16be_BOM));
						case UTF16le:
							return VSBuffer.wrap(Uint8Array.from(UTF16le_BOM));
					}
				}

				const leftovers = encoder.end();
				if (leftovers && leftovers.length > 0) {
					bytesWritten = true;

					return VSBuffer.wrap(leftovers);
				}

				return null;
			}

			bytesWritten = true;

			return VSBuffer.wrap(encoder.write(chunk));
		}
	};
}

export async function encodingExists(encoding: string): Promise<boolean> {
	const iconv = await importAMDNodeModule<typeof import('@vscode/iconv-lite-umd')>('@vscode/iconv-lite-umd', 'lib/iconv-lite-umd.js');

	return iconv.encodingExists(toNodeEncoding(encoding));
}

export function toNodeEncoding(enc: string | null): string {
	if (enc === UTF8_with_bom || enc === null) {
		return UTF8;
	}

	return enc;
}

export function detectEncodingByBOMFromBuffer(buffer: VSBuffer | null, bytesRead: number): typeof UTF8_with_bom | typeof UTF16le | typeof UTF16be | null {
	if (!buffer || bytesRead < UTF16be_BOM.length) {
		return null;
	}

	const b0 = buffer.readUInt8(0);
	const b1 = buffer.readUInt8(1);

	if (b0 === UTF16be_BOM[0] && b1 === UTF16be_BOM[1]) {
		return UTF16be;
	}

	if (b0 === UTF16le_BOM[0] && b1 === UTF16le_BOM[1]) {
		return UTF16le;
	}

	if (bytesRead < UTF8_BOM.length) {
		return null;
	}

	const b2 = buffer.readUInt8(2);

	if (b0 === UTF8_BOM[0] && b1 === UTF8_BOM[1] && b2 === UTF8_BOM[2]) {
		return UTF8_with_bom;
	}

	return null;
}

const IGNORE_ENCODINGS = ['ascii', 'utf-16', 'utf-32'];

async function guessEncodingByBuffer(buffer: VSBuffer, candidateGuessEncodings?: string[]): Promise<string | null> {
	const jschardet = await importAMDNodeModule<typeof import('jschardet')>('jschardet', 'dist/jschardet.min.js');

	const limitedBuffer = buffer.slice(0, AUTO_ENCODING_GUESS_MAX_BYTES);

	const binaryString = encodeLatin1(limitedBuffer.buffer);

	if (candidateGuessEncodings) {
		candidateGuessEncodings = coalesce(candidateGuessEncodings.map(e => toJschardetEncoding(e)));
		if (candidateGuessEncodings.length === 0) {
			candidateGuessEncodings = undefined;
		}
	}

	let guessed: { encoding: string | undefined } | undefined;
	try {
		guessed = jschardet.detect(binaryString, candidateGuessEncodings ? { detectEncodings: candidateGuessEncodings } : undefined);
	} catch (error) {
		return null;
	}

	if (!guessed?.encoding) {
		return null;
	}

	const enc = guessed.encoding.toLowerCase();
	if (0 <= IGNORE_ENCODINGS.indexOf(enc)) {
		return null;
	}

	return toIconvLiteEncoding(guessed.encoding);
}

const JSCHARDET_TO_ICONV_ENCODINGS: { [name: string]: string } = {
	'ibm866': 'cp866',
	'big5': 'cp950'
};

function normalizeEncoding(encodingName: string): string {
	return encodingName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function toIconvLiteEncoding(encodingName: string): string {
	const normalizedEncodingName = normalizeEncoding(encodingName);
	const mapped = JSCHARDET_TO_ICONV_ENCODINGS[normalizedEncodingName];

	return mapped || normalizedEncodingName;
}

function toJschardetEncoding(encodingName: string): string | undefined {
	const normalizedEncodingName = normalizeEncoding(encodingName);
	const mapped = GUESSABLE_ENCODINGS[normalizedEncodingName];

	return mapped ? mapped.guessableName : undefined;
}

function encodeLatin1(buffer: Uint8Array): string {
	let result = '';
	for (let i = 0; i < buffer.length; i++) {
		result += String.fromCharCode(buffer[i]);
	}

	return result;
}

export function toCanonicalName(enc: string): string {
	switch (enc) {
		case 'shiftjis':
			return 'shift-jis';
		case 'utf16le':
			return 'utf-16le';
		case 'utf16be':
			return 'utf-16be';
		case 'big5hkscs':
			return 'big5-hkscs';
		case 'eucjp':
			return 'euc-jp';
		case 'euckr':
			return 'euc-kr';
		case 'koi8r':
			return 'koi8-r';
		case 'koi8u':
			return 'koi8-u';
		case 'macroman':
			return 'x-mac-roman';
		case 'utf8bom':
			return 'utf8';
		default: {
			const m = enc.match(/windows(\d+)/);
			if (m) {
				return 'windows-' + m[1];
			}

			return enc;
		}
	}
}

export interface IDetectedEncodingResult {
	encoding: string | null;
	seemsBinary: boolean;
}

export interface IReadResult {
	buffer: VSBuffer | null;
	bytesRead: number;
}

export function detectEncodingFromBuffer(readResult: IReadResult, autoGuessEncoding?: false, candidateGuessEncodings?: string[]): IDetectedEncodingResult;
export function detectEncodingFromBuffer(readResult: IReadResult, autoGuessEncoding?: boolean, candidateGuessEncodings?: string[]): Promise<IDetectedEncodingResult>;
export function detectEncodingFromBuffer({ buffer, bytesRead }: IReadResult, autoGuessEncoding?: boolean, candidateGuessEncodings?: string[]): Promise<IDetectedEncodingResult> | IDetectedEncodingResult {

	let encoding = detectEncodingByBOMFromBuffer(buffer, bytesRead);

	let seemsBinary = false;
	if (encoding !== UTF16be && encoding !== UTF16le && buffer) {
		let couldBeUTF16LE = true;
		let couldBeUTF16BE = true;
		let containsZeroByte = false;

		for (let i = 0; i < bytesRead && i < ZERO_BYTE_DETECTION_BUFFER_MAX_LEN; i++) {
			const isEndian = (i % 2 === 1);
			const isZeroByte = (buffer.readUInt8(i) === 0);

			if (isZeroByte) {
				containsZeroByte = true;
			}

			if (couldBeUTF16LE && (isEndian && !isZeroByte || !isEndian && isZeroByte)) {
				couldBeUTF16LE = false;
			}

			if (couldBeUTF16BE && (isEndian && isZeroByte || !isEndian && !isZeroByte)) {
				couldBeUTF16BE = false;
			}

			if (isZeroByte && !couldBeUTF16LE && !couldBeUTF16BE) {
				break;
			}
		}

		if (containsZeroByte) {
			if (couldBeUTF16LE) {
				encoding = UTF16le;
			} else if (couldBeUTF16BE) {
				encoding = UTF16be;
			} else {
				seemsBinary = true;
			}
		}
	}

	if (autoGuessEncoding && !seemsBinary && !encoding && buffer) {
		return guessEncodingByBuffer(buffer.slice(0, bytesRead), candidateGuessEncodings).then(guessedEncoding => {
			return {
				seemsBinary: false,
				encoding: guessedEncoding
			};
		});
	}

	return { seemsBinary, encoding };
}

type EncodingsMap = { [encoding: string]: { labelLong: string; labelShort: string; order: number; encodeOnly?: boolean; alias?: string; guessableName?: string } };

export const SUPPORTED_ENCODINGS: EncodingsMap = {
	utf8: {
		labelLong: 'UTF-8',
		labelShort: 'UTF-8',
		order: 1,
		alias: 'utf8bom',
		guessableName: 'UTF-8'
	},
	utf8bom: {
		labelLong: 'UTF-8 with BOM',
		labelShort: 'UTF-8 with BOM',
		encodeOnly: true,
		order: 2,
		alias: 'utf8'
	},
	utf16le: {
		labelLong: 'UTF-16 LE',
		labelShort: 'UTF-16 LE',
		order: 3,
		guessableName: 'UTF-16LE'
	},
	utf16be: {
		labelLong: 'UTF-16 BE',
		labelShort: 'UTF-16 BE',
		order: 4,
		guessableName: 'UTF-16BE'
	},
	windows1252: {
		labelLong: 'Western (Windows 1252)',
		labelShort: 'Windows 1252',
		order: 5,
		guessableName: 'windows-1252'
	},
	iso88591: {
		labelLong: 'Western (ISO 8859-1)',
		labelShort: 'ISO 8859-1',
		order: 6
	},
	iso88593: {
		labelLong: 'Western (ISO 8859-3)',
		labelShort: 'ISO 8859-3',
		order: 7
	},
	iso885915: {
		labelLong: 'Western (ISO 8859-15)',
		labelShort: 'ISO 8859-15',
		order: 8
	},
	macroman: {
		labelLong: 'Western (Mac Roman)',
		labelShort: 'Mac Roman',
		order: 9
	},
	cp437: {
		labelLong: 'DOS (CP 437)',
		labelShort: 'CP437',
		order: 10
	},
	windows1256: {
		labelLong: 'Arabic (Windows 1256)',
		labelShort: 'Windows 1256',
		order: 11
	},
	iso88596: {
		labelLong: 'Arabic (ISO 8859-6)',
		labelShort: 'ISO 8859-6',
		order: 12
	},
	windows1257: {
		labelLong: 'Baltic (Windows 1257)',
		labelShort: 'Windows 1257',
		order: 13
	},
	iso88594: {
		labelLong: 'Baltic (ISO 8859-4)',
		labelShort: 'ISO 8859-4',
		order: 14
	},
	iso885914: {
		labelLong: 'Celtic (ISO 8859-14)',
		labelShort: 'ISO 8859-14',
		order: 15
	},
	windows1250: {
		labelLong: 'Central European (Windows 1250)',
		labelShort: 'Windows 1250',
		order: 16,
		guessableName: 'windows-1250'
	},
	iso88592: {
		labelLong: 'Central European (ISO 8859-2)',
		labelShort: 'ISO 8859-2',
		order: 17,
		guessableName: 'ISO-8859-2'
	},
	cp852: {
		labelLong: 'Central European (CP 852)',
		labelShort: 'CP 852',
		order: 18
	},
	windows1251: {
		labelLong: 'Cyrillic (Windows 1251)',
		labelShort: 'Windows 1251',
		order: 19,
		guessableName: 'windows-1251'
	},
	cp866: {
		labelLong: 'Cyrillic (CP 866)',
		labelShort: 'CP 866',
		order: 20,
		guessableName: 'IBM866'
	},
	cp1125: {
		labelLong: 'Cyrillic (CP 1125)',
		labelShort: 'CP 1125',
		order: 21,
		guessableName: 'IBM1125'
	},
	iso88595: {
		labelLong: 'Cyrillic (ISO 8859-5)',
		labelShort: 'ISO 8859-5',
		order: 22,
		guessableName: 'ISO-8859-5'
	},
	koi8r: {
		labelLong: 'Cyrillic (KOI8-R)',
		labelShort: 'KOI8-R',
		order: 23,
		guessableName: 'KOI8-R'
	},
	koi8u: {
		labelLong: 'Cyrillic (KOI8-U)',
		labelShort: 'KOI8-U',
		order: 24
	},
	iso885913: {
		labelLong: 'Estonian (ISO 8859-13)',
		labelShort: 'ISO 8859-13',
		order: 25
	},
	windows1253: {
		labelLong: 'Greek (Windows 1253)',
		labelShort: 'Windows 1253',
		order: 26,
		guessableName: 'windows-1253'
	},
	iso88597: {
		labelLong: 'Greek (ISO 8859-7)',
		labelShort: 'ISO 8859-7',
		order: 27,
		guessableName: 'ISO-8859-7'
	},
	windows1255: {
		labelLong: 'Hebrew (Windows 1255)',
		labelShort: 'Windows 1255',
		order: 28,
		guessableName: 'windows-1255'
	},
	iso88598: {
		labelLong: 'Hebrew (ISO 8859-8)',
		labelShort: 'ISO 8859-8',
		order: 29,
		guessableName: 'ISO-8859-8'
	},
	iso885910: {
		labelLong: 'Nordic (ISO 8859-10)',
		labelShort: 'ISO 8859-10',
		order: 30
	},
	iso885916: {
		labelLong: 'Romanian (ISO 8859-16)',
		labelShort: 'ISO 8859-16',
		order: 31
	},
	windows1254: {
		labelLong: 'Turkish (Windows 1254)',
		labelShort: 'Windows 1254',
		order: 32
	},
	iso88599: {
		labelLong: 'Turkish (ISO 8859-9)',
		labelShort: 'ISO 8859-9',
		order: 33
	},
	cp857: {
		labelLong: 'Turkish (CP 857)',
		labelShort: 'CP 857',
		order: 34
	},
	windows1258: {
		labelLong: 'Vietnamese (Windows 1258)',
		labelShort: 'Windows 1258',
		order: 35
	},
	gbk: {
		labelLong: 'Simplified Chinese (GBK)',
		labelShort: 'GBK',
		order: 36
	},
	gb18030: {
		labelLong: 'Simplified Chinese (GB18030)',
		labelShort: 'GB18030',
		order: 37
	},
	cp950: {
		labelLong: 'Traditional Chinese (Big5)',
		labelShort: 'Big5',
		order: 38,
		guessableName: 'Big5'
	},
	big5hkscs: {
		labelLong: 'Traditional Chinese (Big5-HKSCS)',
		labelShort: 'Big5-HKSCS',
		order: 39
	},
	shiftjis: {
		labelLong: 'Japanese (Shift JIS)',
		labelShort: 'Shift JIS',
		order: 40,
		guessableName: 'SHIFT_JIS'
	},
	eucjp: {
		labelLong: 'Japanese (EUC-JP)',
		labelShort: 'EUC-JP',
		order: 41,
		guessableName: 'EUC-JP'
	},
	euckr: {
		labelLong: 'Korean (EUC-KR)',
		labelShort: 'EUC-KR',
		order: 42,
		guessableName: 'EUC-KR'
	},
	windows874: {
		labelLong: 'Thai (Windows 874)',
		labelShort: 'Windows 874',
		order: 43
	},
	iso885911: {
		labelLong: 'Latin/Thai (ISO 8859-11)',
		labelShort: 'ISO 8859-11',
		order: 44
	},
	koi8ru: {
		labelLong: 'Cyrillic (KOI8-RU)',
		labelShort: 'KOI8-RU',
		order: 45
	},
	koi8t: {
		labelLong: 'Tajik (KOI8-T)',
		labelShort: 'KOI8-T',
		order: 46
	},
	gb2312: {
		labelLong: 'Simplified Chinese (GB 2312)',
		labelShort: 'GB 2312',
		order: 47,
		guessableName: 'GB2312'
	},
	cp865: {
		labelLong: 'Nordic DOS (CP 865)',
		labelShort: 'CP 865',
		order: 48
	},
	cp850: {
		labelLong: 'Western European DOS (CP 850)',
		labelShort: 'CP 850',
		order: 49
	}
};

export const GUESSABLE_ENCODINGS: EncodingsMap = (() => {
	const guessableEncodings: EncodingsMap = {};
	for (const encoding in SUPPORTED_ENCODINGS) {
		if (SUPPORTED_ENCODINGS[encoding].guessableName) {
			guessableEncodings[encoding] = SUPPORTED_ENCODINGS[encoding];
		}
	}

	return guessableEncodings;
})();
