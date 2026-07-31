export const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
export const UTF16LE_BOM = new Uint8Array([0xff, 0xfe]);
export const UTF16BE_BOM = new Uint8Array([0xfe, 0xff]);

export function encodeUtf8Manual(text: string): Uint8Array {
	const bytes: number[] = [];
	for (const char of text) {
		const codePoint = char.codePointAt(0)!;
		if (codePoint < 0x80) {
			bytes.push(codePoint);
		} else if (codePoint < 0x800) {
			bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
		} else if (codePoint < 0x10000) {
			bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
		} else {
			bytes.push(
				0xf0 | (codePoint >> 18),
				0x80 | ((codePoint >> 12) & 0x3f),
				0x80 | ((codePoint >> 6) & 0x3f),
				0x80 | (codePoint & 0x3f)
			);
		}
	}
	return new Uint8Array(bytes);
}

export function decodeUtf8Manual(bytes: Uint8Array): string {
	let result = '';
	let i = 0;
	while (i < bytes.length) {
		const first = bytes[i];
		let codePoint: number;
		let length: number;
		if (first < 0x80) {
			codePoint = first;
			length = 1;
		} else if ((first & 0xe0) === 0xc0) {
			codePoint = first & 0x1f;
			length = 2;
		} else if ((first & 0xf0) === 0xe0) {
			codePoint = first & 0x0f;
			length = 3;
		} else if ((first & 0xf8) === 0xf0) {
			codePoint = first & 0x07;
			length = 4;
		} else {
			result += '\ufffd';
			i++;
			continue;
		}
		if (i + length > bytes.length) {
			result += '\ufffd';
			break;
		}
		let valid = true;
		for (let j = 1; j < length; j++) {
			const next = bytes[i + j];
			if ((next & 0xc0) !== 0x80) {
				valid = false;
				break;
			}
			codePoint = (codePoint << 6) | (next & 0x3f);
		}
		if (!valid) {
			result += '\ufffd';
			i++;
			continue;
		}
		result += String.fromCodePoint(codePoint);
		i += length;
	}
	return result;
}

export function detectBom(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | 'none' {
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return 'utf-8';
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
		return 'utf-16le';
	}
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
		return 'utf-16be';
	}
	return 'none';
}

export function stripBom(bytes: Uint8Array): Uint8Array {
	const bom = detectBom(bytes);
	if (bom === 'utf-8') {
		return bytes.subarray(3);
	}
	if (bom === 'utf-16le' || bom === 'utf-16be') {
		return bytes.subarray(2);
	}
	return bytes;
}

export class RemoteTerminalEncoding {
	encode(text: string): Uint8Array {
		if (typeof TextEncoder !== 'undefined') {
			return new TextEncoder().encode(text);
		}
		return encodeUtf8Manual(text);
	}

	decode(bytes: Uint8Array): string {
		const bom = detectBom(bytes);
		if (bom === 'utf-16le') {
			return decodeUtf16(bytes.subarray(2), false);
		}
		if (bom === 'utf-16be') {
			return decodeUtf16(bytes.subarray(2), true);
		}
		const cleaned = bom === 'utf-8' ? bytes.subarray(3) : bytes;
		if (typeof TextDecoder !== 'undefined') {
			return new TextDecoder('utf-8', { fatal: false }).decode(cleaned);
		}
		return decodeUtf8Manual(cleaned);
	}

	decodeUtf8(bytes: Uint8Array): string {
		return this.decode(bytes);
	}

	encodeUtf16(text: string, bigEndian = false): Uint8Array {
		const bytes = new Uint8Array(text.length * 2);
		const view = new DataView(bytes.buffer);
		for (let i = 0; i < text.length; i++) {
			view.setUint16(i * 2, text.charCodeAt(i), !bigEndian);
		}
		return bytes;
	}

	decodeUtf16(bytes: Uint8Array, bigEndian = false): string {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let result = '';
		for (let i = 0; i < Math.floor(bytes.byteLength / 2); i++) {
			result += String.fromCharCode(view.getUint16(i * 2, !bigEndian));
		}
		return result;
	}

	detectBom(bytes: Uint8Array): 'utf-8' | 'utf-16le' | 'utf-16be' | 'none' {
		return detectBom(bytes);
	}

	withBom(text: string, encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8'): Uint8Array {
		if (encoding === 'utf-16le') {
			return concatBytes(UTF16LE_BOM, this.encodeUtf16(text, false));
		}
		if (encoding === 'utf-16be') {
			return concatBytes(UTF16BE_BOM, this.encodeUtf16(text, true));
		}
		return concatBytes(UTF8_BOM, this.encode(text));
	}

	byteLength(text: string): number {
		return this.encode(text).length;
	}

	transcode(bytes: Uint8Array, from: 'utf-8' | 'utf-16le' | 'utf-16be', to: 'utf-8' | 'utf-16le' | 'utf-16be'): Uint8Array {
		let text = '';
		if (from === 'utf-8') {
			text = this.decodeUtf8(bytes);
		} else {
			text = this.decodeUtf16(bytes, from === 'utf-16be');
		}
		if (to === 'utf-8') {
			return this.encode(text);
		}
		return this.encodeUtf16(text, to === 'utf-16be');
	}
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const chunk of chunks) {
		total += chunk.length;
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
	return new RemoteTerminalEncoding().decodeUtf16(bytes, bigEndian);
}
