/**
 * Dardcor Code - Text Encoding Utilities
 */

import { DataBuffer } from './buffer';

export function decodeUTF8(buffer: Uint8Array): string {
	return new TextDecoder('utf-8').decode(buffer);
}

export function encodeUTF8(text: string): DataBuffer {
	return DataBuffer.wrap(new TextEncoder().encode(text));
}
