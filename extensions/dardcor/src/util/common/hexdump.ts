/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function formatHexdump(data: Uint8Array, startOffset: number = 0, maxBytes?: number): string {
	const bytesToFormat = maxBytes !== undefined ? Math.min(data.length - startOffset, maxBytes) : data.length - startOffset;
	if (bytesToFormat <= 0) {
		return '';
	}

	const lines: string[] = [];
	const bytesPerLine = 16;

	for (let i = 0; i < bytesToFormat; i += bytesPerLine) {
		const offset = startOffset + i;
		const lineBytes = Math.min(bytesPerLine, bytesToFormat - i);
		const slice = data.subarray(startOffset + i, startOffset + i + lineBytes);

		const offsetStr = offset.toString(16).padStart(8, '0');

		const hexParts: string[] = [];
		for (let j = 0; j < bytesPerLine; j++) {
			if (j === 8) {
				hexParts.push('');
			}
			if (j < lineBytes) {
				hexParts.push(slice[j].toString(16).padStart(2, '0'));
			} else {
				hexParts.push('  ');
			}
		}
		const hexStr = hexParts.join(' ');

		let ascii = '';
		for (let j = 0; j < lineBytes; j++) {
			const byte = slice[j];
			ascii += (byte >= 0x20 && byte <= 0x7e) ? String.fromCharCode(byte) : '.';
		}

		lines.push(`${offsetStr}  ${hexStr}  |${ascii}|`);
	}

	return lines.join('\n');
}

export function isBinaryContent(data: Uint8Array): boolean {
	const checkLength = Math.min(data.length, 8192);
	for (let i = 0; i < checkLength; i++) {
		if (data[i] === 0) {
			return true;
		}
	}
	return false;
}
