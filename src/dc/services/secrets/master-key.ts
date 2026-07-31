/**
 * Dardcor Code - Master Key Derivation (Task 173)
 * Mirrors: vs/platform/secrets/common/secrets.ts PBKDF2 master key derivation
 */

import { sha256Hex } from '../../core/security/crypto.js';

export async function deriveMasterKey(password: string, saltHex: string, iterations = 1000): Promise<string> {
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const enc = new TextEncoder();
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			enc.encode(password),
			{ name: 'PBKDF2' },
			false,
			['deriveBits']
		);
		const salt = new Uint8Array(saltHex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []);
		const bits = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt,
				iterations,
				hash: 'SHA-256',
			},
			keyMaterial,
			256
		);
		const view = new Uint8Array(bits);
		return Array.from(view).map(b => b.toString(16).padStart(2, '0')).join('');
	}
	let current = `${password}:${saltHex}`;
	for (let i = 0; i < iterations; i++) {
		current = await sha256Hex(new TextEncoder().encode(current));
	}
	return current;
}
