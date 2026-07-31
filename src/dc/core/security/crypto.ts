/**
 * Dardcor Code - AES-256-GCM Crypto Bridge (Task 74)
 * Mirrors: vs/platform/encryption
 */

export class CryptoBridge {
	private static readonly ALGO = 'AES-GCM';
	private static readonly KEY_LENGTH = 256;
	private static readonly IV_LENGTH = 12;

	static async generateKey(): Promise<CryptoKey> {
		return crypto.subtle.generateKey(
			{ name: this.ALGO, length: this.KEY_LENGTH },
			true,
			['encrypt', 'decrypt']
		);
	}

	static async encrypt(data: string, key: CryptoKey): Promise<{ iv: string; ciphertext: string }> {
		const encoder = new TextEncoder();
		const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
		const encoded = encoder.encode(data);
		const encrypted = await crypto.subtle.encrypt(
			{ name: this.ALGO, iv },
			key,
			encoded
		);
		return {
			iv: arrayBufferToBase64(iv.buffer),
			ciphertext: arrayBufferToBase64(encrypted),
		};
	}

	static async decrypt(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
		const decoder = new TextDecoder();
		const ivBuffer = base64ToArrayBuffer(iv);
		const encBuffer = base64ToArrayBuffer(ciphertext);
		const decrypted = await crypto.subtle.decrypt(
			{ name: this.ALGO, iv: ivBuffer },
			key,
			encBuffer
		);
		return decoder.decode(decrypted);
	}

	static async exportKey(key: CryptoKey): Promise<string> {
		const raw = await crypto.subtle.exportKey('raw', key);
		return arrayBufferToBase64(raw);
	}

	static async importKey(base64Key: string): Promise<CryptoKey> {
		const raw = base64ToArrayBuffer(base64Key);
		return crypto.subtle.importKey(
			'raw',
			raw,
			{ name: this.ALGO, length: this.KEY_LENGTH },
			true,
			['encrypt', 'decrypt']
		);
	}

	static async hash(data: string, algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512' = 'SHA-256'): Promise<string> {
		const encoder = new TextEncoder();
		const buf = await crypto.subtle.digest(algorithm, encoder.encode(data));
		return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
	const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
	return CryptoBridge.hash(str, 'SHA-256');
}

