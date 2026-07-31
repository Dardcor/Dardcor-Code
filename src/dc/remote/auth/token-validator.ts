/**
 * Dardcor Code - Bearer Authentication Token Verification Middleware (Task 809)
 */

import type { IncomingMessage } from 'node:http';
import { JwtSigner } from './jwt-signer.js';

export interface ITokenValidatorOptions {
	readonly tokens?: ReadonlyArray<string>;
	readonly jwtSigner?: JwtSigner;
}

export interface ITokenVerification {
	readonly valid: boolean;
	readonly kind: 'none' | 'static' | 'jwt';
	readonly claims?: Record<string, unknown>;
	readonly reason?: string;
}

export class TokenValidator {
	private readonly _tokens: ReadonlyArray<string>;
	private readonly _jwtSigner?: JwtSigner;

	constructor(options: ITokenValidatorOptions = {}) {
		this._tokens = options.tokens ?? [];
		this._jwtSigner = options.jwtSigner;
	}

	get isAuthRequired(): boolean {
		return this._tokens.length > 0 || !!this._jwtSigner;
	}

	validateAuthorization(value: string | null | undefined): ITokenVerification {
		if (!value) {
			return this.isAuthRequired
				? { valid: false, kind: 'none', reason: 'missing Authorization header' }
				: { valid: true, kind: 'none' };
		}
		let token = value.trim();
		const match = /^Bearer\s+(.+)$/i.exec(token);
		if (match) {
			token = match[1].trim();
		}
		if (token.includes('.') && this._jwtSigner) {
			const result = this._jwtSigner.verify(token);
			return result.valid
				? { valid: true, kind: 'jwt', claims: result.payload ?? undefined }
				: { valid: false, kind: 'jwt', reason: result.reason ?? 'invalid token' };
		}
		if (this._tokens.includes(token)) {
			return { valid: true, kind: 'static' };
		}
		return this.isAuthRequired
			? { valid: false, kind: 'static', reason: 'token not recognized' }
			: { valid: true, kind: 'none' };
	}

	validateRequest(request: IncomingMessage): ITokenVerification {
		const header = request.headers.authorization;
		if (!header) {
			const url = new URL(request.url ?? '/', 'http://localhost');
			const queryToken = url.searchParams.get('token');
			if (queryToken) {
				return this.validateAuthorization(`Bearer ${queryToken}`);
			}
		}
		return this.validateAuthorization(header);
	}

	validateUpgrade(request: IncomingMessage): ITokenVerification {
		return this.validateRequest(request);
	}

	createChallengeResponse(): string {
		return '401 Unauthorized: a valid bearer token is required';
	}
}
