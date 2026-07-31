import * as crypto from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';

export async function computeSha256(filePath: string): Promise<string> {
	const buffer = await fsp.readFile(filePath);
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function generateSignature(filePath: string): Promise<string> {
	return computeSha256(filePath);
}

export function sha256Compare(a: string, b: string): boolean {
	const normalizedA = a.trim().toLowerCase();
	const normalizedB = b.trim().toLowerCase();
	if (normalizedA.length !== normalizedB.length) {
		return false;
	}
	const bufferA = Buffer.from(normalizedA, 'utf-8');
	const bufferB = Buffer.from(normalizedB, 'utf-8');
	let diff = 0;
	for (let i = 0; i < bufferA.length; i++) {
		diff |= bufferA[i] ^ bufferB[i];
	}
	return diff === 0;
}

export async function verifySignature(filePath: string, signatureHex?: string, publicKeyPem?: string): Promise<boolean> {
	if (!fs.existsSync(filePath)) {
		return false;
	}
	if (!signatureHex && !publicKeyPem) {
		return true;
	}
	if (signatureHex && !publicKeyPem) {
		const actual = await computeSha256(filePath);
		return sha256Compare(actual, signatureHex);
	}
	if (publicKeyPem) {
		try {
			const data = await fsp.readFile(filePath);
			const verifier = crypto.createVerify('sha256');
			verifier.update(data);
			verifier.end();
			const signature = signatureHex ? Buffer.from(signatureHex, 'hex') : await readSignatureFile(filePath);
			return verifier.verify(publicKeyPem, signature);
		} catch (err) {
			console.warn('[update-signature] RSA verification failed, falling back to sha256:', err);
			if (signatureHex) {
				const actual = await computeSha256(filePath);
				return sha256Compare(actual, signatureHex);
			}
			return false;
		}
	}
	return false;
}

export async function readSignatureFile(filePath: string): Promise<Buffer> {
	const signaturePath = `${filePath}.sig`;
	try {
		const hex = await fsp.readFile(signaturePath, 'utf-8');
		return Buffer.from(hex.trim(), 'hex');
	} catch {
		throw new Error(`Signature file not found: ${signaturePath}`);
	}
}

export async function writeSignatureFile(filePath: string, signatureHex: string): Promise<string> {
	const signaturePath = `${filePath}.sig`;
	await fsp.writeFile(signaturePath, signatureHex, 'utf-8');
	return signaturePath;
}

export async function verifyFileIntegrity(filePath: string, expectedSha256?: string): Promise<boolean> {
	if (!expectedSha256) {
		return true;
	}
	const actual = await computeSha256(filePath);
	return sha256Compare(actual, expectedSha256);
}

export function sha256OfBuffer(buffer: Buffer): string {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function verifyBufferSignature(buffer: Buffer, signatureHex: string, publicKeyPem?: string): boolean {
	if (!publicKeyPem) {
		return sha256Compare(sha256OfBuffer(buffer), signatureHex);
	}
	try {
		const verifier = crypto.createVerify('sha256');
		verifier.update(buffer);
		verifier.end();
		return verifier.verify(publicKeyPem, Buffer.from(signatureHex, 'hex'));
	} catch {
		return false;
	}
}

export function generateSignatureFromBuffer(buffer: Buffer): string {
	return sha256OfBuffer(buffer);
}
