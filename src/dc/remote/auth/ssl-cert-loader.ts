import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import {
	generateKeyPairSync,
	createSign,
	createPublicKey,
	X509Certificate,
	randomBytes
} from 'node:crypto';

export interface ISslCertLoaderOptions {
	readonly certPath?: string;
	readonly keyPath?: string;
	readonly hostname?: string;
	readonly validityDays?: number;
}

export interface ISslKeyPair {
	readonly key: string;
	readonly cert: string;
}

export interface IHttpsOptions {
	readonly key: string;
	readonly cert: string;
}

export class SslCertLoader {
	private readonly _certPath?: string;
	private readonly _keyPath?: string;
	private readonly _hostname: string;
	private readonly _validityDays: number;

	private _key: string | null = null;
	private _cert: string | null = null;
	private _error: string | null = null;
	private _selfSigned = false;

	constructor(options: ISslCertLoaderOptions = {}) {
		this._certPath = options.certPath;
		this._keyPath = options.keyPath;
		this._hostname = options.hostname ?? 'localhost';
		this._validityDays = options.validityDays ?? 365;
	}

	get isLoaded(): boolean {
		return this._key !== null && this._cert !== null;
	}

	get isSelfSigned(): boolean {
		return this._selfSigned;
	}

	get error(): string | null {
		return this._error;
	}

	async load(certPath?: string, keyPath?: string): Promise<ISslKeyPair> {
		const certFile = certPath ?? this._certPath;
		const keyFile = keyPath ?? this._keyPath;
		try {
			if (certFile && keyFile) {
				const [cert, key] = await Promise.all([readFile(certFile, 'utf8'), readFile(keyFile, 'utf8')]);
				this._validatePair(cert, key);
				this._cert = cert;
				this._key = key;
				this._selfSigned = false;
				this._error = null;
				return { cert, key };
			}
			const pair = await this._generateSelfSigned();
			this._cert = pair.cert;
			this._key = pair.key;
			this._selfSigned = true;
			this._error = null;
			return pair;
		} catch (error) {
			this._error = error instanceof Error ? error.message : String(error);
			this._key = null;
			this._cert = null;
			throw error;
		}
	}

	loadSync(certPath?: string, keyPath?: string): ISslKeyPair {
		const certFile = certPath ?? this._certPath;
		const keyFile = keyPath ?? this._keyPath;
		if (certFile && keyFile && existsSync(certFile) && existsSync(keyFile)) {
			const cert = readFileSync(certFile, 'utf8');
			const key = readFileSync(keyFile, 'utf8');
			this._validatePair(cert, key);
			this._cert = cert;
			this._key = key;
			this._selfSigned = false;
			this._error = null;
			return { cert, key };
		}
		const pair = this._generateSelfSigned();
		this._cert = pair.cert;
		this._key = pair.key;
		this._selfSigned = true;
		this._error = null;
		return pair;
	}

	getHttpsOptions(): IHttpsOptions {
		if (!this.isLoaded) {
			this.loadSync();
		}
		if (!this._key || !this._cert) {
			throw new Error(this._error ?? 'SSL key pair is not loaded');
		}
		return { key: this._key, cert: this._cert };
	}

	getCertPem(): string | null {
		return this._cert;
	}

	getKeyPem(): string | null {
		return this._key;
	}

	getCertFingerprint(): string | null {
		if (!this._cert || typeof X509Certificate === 'undefined') {
			return null;
		}
		try {
			const cert = new X509Certificate(this._cert);
			return cert.fingerprint256;
		} catch {
			return null;
		}
	}

	private _validatePair(cert: string, key: string): void {
		if (!cert.includes('BEGIN CERTIFICATE') || !key.includes('BEGIN')) {
			throw new Error('Provided PEM files do not contain a certificate and a private key');
		}
		if (typeof X509Certificate !== 'undefined') {
			const parsed = new X509Certificate(cert);
			if (new Date(parsed.validTo) < new Date()) {
				throw new Error('The provided certificate has expired');
			}
		}
		try {
			createPublicKey(key);
		} catch (error) {
			throw new Error(`The provided private key is not valid: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private _generateSelfSigned(): ISslKeyPair {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', {
			modulusLength: 2048,
			publicKeyEncoding: { type: 'spki', format: 'der' },
			privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
		});
		const now = new Date();
		const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const notAfter = new Date(now.getTime() + this._validityDays * 24 * 60 * 60 * 1000);
		const serial = randomBytes(16);
		serial[0] &= 0x7f;
		const tbs = buildTbsCertificate(serial, privateKey, publicKey, this._hostname, notBefore, notAfter);
		const signature = createSign('sha256').update(tbs).sign(privateKey);
		const body = derConcat(
			tbs,
			derSequence(derConcat(derOid(SHA256_RSA_OID), derNull())),
			derBitString(signature)
		);
		const cert = toPem(derSequence(body), 'CERTIFICATE');
		return { key: privateKey, cert };
	}
}

const SHA256_RSA_OID = '1.2.840.113549.1.1.11';
const RSA_ENCRYPTION_OID = '1.2.840.113549.1.1.1';
const COMMON_NAME_OID = '2.5.4.3';

function buildTbsCertificate(
	serial: Buffer,
	privateKey: string,
	spkiDer: Buffer,
	hostname: string,
	notBefore: Date,
	notAfter: Date
): Uint8Array {
	const name = derSequence(derSet(derSequence(derConcat(derOid(COMMON_NAME_OID), derUtf8String(hostname)))));
	const algorithm = derSequence(derConcat(derOid(SHA256_RSA_OID), derNull()));
	const spki = derSequence(derConcat(derSequence(derConcat(derOid(RSA_ENCRYPTION_OID), derNull())), derBitString(spkiDer)));
	return derConcat(
		derExplicit(0, derInteger(2)),
		derInteger(serial),
		algorithm,
		name,
		derSequence(derConcat(derUtcTime(notBefore), derUtcTime(notAfter))),
		name,
		spki
	);
}

function derLen(length: number): Uint8Array {
	if (length < 0x80) {
		return new Uint8Array([length]);
	}
	const bytes: number[] = [];
	let value = length;
	while (value > 0) {
		bytes.unshift(value & 0xff);
		value = Math.floor(value / 256);
	}
	return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derConcat(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function derWrap(tag: number, content: Uint8Array): Uint8Array {
	return derConcat(new Uint8Array([tag]), derLen(content.length), content);
}

function derSequence(content: Uint8Array): Uint8Array {
	return derWrap(0x30, content);
}

function derSet(content: Uint8Array): Uint8Array {
	return derWrap(0x31, content);
}

function derExplicit(tag: number, content: Uint8Array): Uint8Array {
	return derWrap(0xa0 | tag, content);
}

function derNull(): Uint8Array {
	return new Uint8Array([0x05, 0x00]);
}

function derInteger(value: Buffer | number): Uint8Array {
	let bytes: Uint8Array;
	if (typeof value === 'number') {
		const buf = Buffer.alloc(4);
		buf.writeUInt32BE(value, 0);
		const first = buf.findIndex(b => b !== 0);
		bytes = new Uint8Array(buf.subarray(first === -1 ? buf.length - 1 : first));
	} else {
		const buf = value[0] & 0x80 ? Buffer.concat([Buffer.from([0x00]), value]) : value;
		bytes = new Uint8Array(buf);
	}
	return derWrap(0x02, bytes);
}

function derOid(oid: string): Uint8Array {
	const parts = oid.split('.').map(Number);
	const content: number[] = [parts[0] * 40 + parts[1]];
	for (let i = 2; i < parts.length; i++) {
		let value = parts[i];
		const stack: number[] = [value & 0x7f];
		value = Math.floor(value / 128);
		while (value > 0) {
			stack.unshift((value & 0x7f) | 0x80);
			value = Math.floor(value / 128);
		}
		content.push(...stack);
	}
	return derWrap(0x06, new Uint8Array(content));
}

function derBitString(content: Uint8Array): Uint8Array {
	return derWrap(0x03, derConcat(new Uint8Array([0x00]), content));
}

function derUtf8String(value: string): Uint8Array {
	return derWrap(0x0c, new TextEncoder().encode(value));
}

function derUtcTime(date: Date): Uint8Array {
	const two = (n: number): string => String(n).padStart(2, '0');
	const text = `${two(date.getUTCFullYear() % 100)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
	return derWrap(0x17, new TextEncoder().encode(text));
}

function toPem(content: Uint8Array, label: string): string {
	const base64 = Buffer.from(content).toString('base64');
	const lines: string[] = [`-----BEGIN ${label}-----`];
	for (let i = 0; i < base64.length; i += 64) {
		lines.push(base64.slice(i, i + 64));
	}
	lines.push(`-----END ${label}-----`);
	return lines.join('\n') + '\n';
}
