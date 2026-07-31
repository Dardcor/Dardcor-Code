/**
 * Dardcor Code - HMAC SHA-256 JWT Token Generator & Verifier (Task 829)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = { alg: 'HS256', typ: 'JWT' };

export function base64UrlEncode(data: Uint8Array): string {
	return Buffer.from(data).toString('base64url');
}

export function base64UrlDecode(value: string): Uint8Array {
	return new Uint8Array(Buffer.from(value, 'base64url'));
}

export interface IJwtSignerOptions {
	readonly issuer?: string;
	readonly audience?: string;
	readonly clockToleranceSeconds?: number;
	readonly defaultExpiresInSeconds?: number;
}

export interface IJwtVerificationResult {
	readonly valid: boolean;
	readonly payload: Record<string, unknown> | null;
	readonly reason?: string;
}

export class JwtSigner {
	private readonly _issuer?: string;
	private readonly _audience?: string;
	private readonly _clockToleranceSeconds: number;
	private readonly _defaultExpiresInSeconds: number;

	constructor(
		private readonly _secret: string,
		options: IJwtSignerOptions = {}
	) {
		this._issuer = options.issuer;
		this._audience = options.audience;
		this._clockToleranceSeconds = options.clockToleranceSeconds ?? 30;
		this._defaultExpiresInSeconds = options.defaultExpiresInSeconds ?? 3600;
	}

	sign(payload: Record<string, unknown>, expiresInSeconds?: number): string {
		const now = Math.floor(Date.now() / 1000);
		const claims: Record<string, unknown> = { ...payload, iat: now };
		if (expiresInSeconds === undefined || expiresInSeconds > 0) {
			claims.exp = now + (expiresInSeconds ?? this._defaultExpiresInSeconds);
		}
		if (this._issuer) {
			claims.iss = this._issuer;
		}
		if (this._audience) {
			claims.aud = this._audience;
		}
		return this._encode(claims);
	}

	createToken(payload: Record<string, unknown>, expiresInSeconds?: number): string {
		return this.sign(payload, expiresInSeconds);
	}

	verify(token: string): IJwtVerificationResult {
		const parts = token.split('.');
		if (parts.length !== 3) {
			return { valid: false, payload: null, reason: 'malformed-token' };
		}
		const [headerPart, payloadPart, signaturePart] = parts;
		try {
			const expected = this._sign(`${headerPart}.${payloadPart}`);
			const actual = Buffer.from(signaturePart, 'base64url');
			const expectedBuffer = Buffer.from(expected, 'base64url');
			if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
				return { valid: false, payload: null, reason: 'bad-signature' };
			}
			const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>;
			const now = Math.floor(Date.now() / 1000);
			if (typeof payload.exp === 'number' && payload.exp + this._clockToleranceSeconds < now) {
				return { valid: false, payload, reason: 'expired' };
			}
			if (typeof payload.nbf === 'number' && payload.nbf - this._clockToleranceSeconds > now) {
				return { valid: false, payload, reason: 'not-yet-valid' };
			}
			if (this._issuer && payload.iss !== this._issuer) {
				return { valid: false, payload, reason: 'bad-issuer' };
			}
			if (this._audience && payload.aud !== this._audience) {
				return { valid: false, payload, reason: 'bad-audience' };
			}
			return { valid: true, payload };
		} catch (error) {
			return { valid: false, payload: null, reason: error instanceof Error ? error.message : 'invalid-token' };
		}
	}

	verifyToken(token: string): IJwtVerificationResult {
		return this.verify(token);
	}

	private _encode(claims: Record<string, unknown>): string {
		const headerPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(HEADER)));
		const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
		const signature = this._sign(`${headerPart}.${payloadPart}`);
		return `${headerPart}.${payloadPart}.${signature}`;
	}

	private _sign(data: string): string {
		return createHmac('sha256', this._secret).update(data).digest('base64url');
	}
}
