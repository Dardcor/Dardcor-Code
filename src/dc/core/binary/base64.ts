/**
 * Dardcor Code - Base64 Encoding Utilities
 */

import { DataBuffer } from './buffer';

declare const Buffer: any;

export function encodeBase64(buffer: DataBuffer): string {
	if (typeof btoa !== 'undefined') {
		let binary = '';
		const bytes = buffer.buffer;
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(buffer.buffer).toString('base64');
	}
	return '';
}

export function decodeBase64(base64: string): DataBuffer {
	if (typeof atob !== 'undefined') {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return DataBuffer.wrap(bytes);
	}
	if (typeof Buffer !== 'undefined') {
		return DataBuffer.wrap(Buffer.from(base64, 'base64'));
	}
	return DataBuffer.wrap(new Uint8Array(0));
}
