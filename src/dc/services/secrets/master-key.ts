/**
 * Dardcor Code - Master Key Derivation Algorithm (Task 173)
 * Mirrors: vs/platform/secrets/common/secrets.ts PBKDF2 master key derivation
 */

import { sha256Hex } from '../../core/security/crypto.js';

const DEFAULT_ITERATIONS = 150_000;

export function generateSalt(bytes = 16): string {
	const arr = new Uint8Array(bytes);
	if (typeof globalThis !== 'undefined' && typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
		globalThis.crypto.getRandomValues(arr);
	} else {
		for (let i = 0; i < arr.length; i++) {
			arr[i] = Math.floor(Math.random() * 256);
		}
	}
	return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveMasterKey(password: string, saltHex: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
	if (typeof globalThis !== 'undefined' && typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
		const enc = new TextEncoder();
		const keyMaterial = await globalThis.crypto.subtle.importKey(
			'raw',
			enc.encode(password),
			{ name: 'PBKDF2' },
			false,
			['deriveBits']
		);
		const saltBytes = hexToBytes(saltHex);
		const bits = await globalThis.crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt: saltBytes as BufferSource,
				iterations,
				hash: 'SHA-256',
			},
			keyMaterial,
			256
		);
		return bytesToHex(new Uint8Array(bits));
	}
	let current = `${password}:${saltHex}`;
	for (let i = 0; i < iterations; i++) {
		current = await sha256Hex(new TextEncoder().encode(current));
	}
	return current;
}

/**
 * Derive a master key and produce a stored key record (salt + key) so the
 * salt can be persisted alongside the wrapped secret.
 */
export async function createMasterKeyRecord(password: string, iterations = DEFAULT_ITERATIONS): Promise<{ salt: string; key: string; iterations: number }> {
	const salt = generateSalt();
	const key = await deriveMasterKey(password, salt, iterations);
	return { salt, key, iterations };
}

function hexToBytes(hex: string): Uint8Array {
	const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
	const result = new Uint8Array(normalized.length / 2);
	for (let i = 0; i < result.length; i++) {
		result[i] = parseInt(normalized.substring(i * 2, i * 2 + 2), 16);
	}
	return result;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
