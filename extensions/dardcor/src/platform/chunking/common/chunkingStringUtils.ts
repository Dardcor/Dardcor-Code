/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { splitLines } from '../../../util/dardcor/base/common/strings';

export function truncateToMaxUtf8Length(str: string, maxBytes: number): string {
	const upperEstimatedByteLength = str.length * 4;
	if (upperEstimatedByteLength <= maxBytes) {
		return str;
	}

	const encoder = new TextEncoder();
	const encodedStr = encoder.encode(str);

	if (encodedStr.length <= maxBytes) {
		return str;
	}

	const truncatedBytes = encodedStr.slice(0, maxBytes);

	return new TextDecoder().decode(truncatedBytes, {
		stream: true
	});
}


export function stripChunkTextMetadata(text: string): string {
	const lines = splitLines(text);
	if (lines.length >= 3 && lines[0].startsWith('File: ') && lines[1].startsWith('```') && lines.at(-1)?.startsWith('```')) {
		return lines.slice(2, -1).join('\n');
	}
	return text;
}

