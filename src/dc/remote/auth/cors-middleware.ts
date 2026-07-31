/**
 * Dardcor Code - CORS Header Validator For Web Browser Clients (Task 819)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ICorsOptions {
	readonly allowedOrigins?: ReadonlyArray<string>;
	readonly allowAnyOrigin?: boolean;
	readonly allowedMethods?: ReadonlyArray<string>;
	readonly allowedHeaders?: ReadonlyArray<string>;
	readonly credentials?: boolean;
	readonly maxAgeSeconds?: number;
}

export const DEFAULT_CORS_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
export const DEFAULT_CORS_HEADERS = ['content-type', 'authorization', 'x-request-id', 'x-client-id'];

export function isOriginAllowed(origin: string | undefined, options: ICorsOptions): boolean {
	if (!origin) {
		return true;
	}
	if (options.allowAnyOrigin) {
		return true;
	}
	const allowed = options.allowedOrigins ?? [];
	if (allowed.length === 0) {
		return true;
	}
	return allowed.some(pattern => {
		if (pattern === '*') {
			return true;
		}
		if (pattern.startsWith('*.')) {
			return origin.endsWith(pattern.slice(1)) || origin === pattern.slice(1);
		}
		return origin === pattern;
	});
}

export class CorsMiddleware {
	private readonly _options: ICorsOptions;

	constructor(options: ICorsOptions = {}) {
		this._options = options;
	}

	get options(): ICorsOptions {
		return this._options;
	}

	isOriginAllowed(origin: string | undefined): boolean {
		return isOriginAllowed(origin, this._options);
	}

	applyCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
		const origin = request.headers.origin;
		if (!isOriginAllowed(origin, this._options)) {
			return;
		}
		if (origin) {
			const allowAny = this._options.allowAnyOrigin ?? this._options.allowedOrigins?.length === 0;
			if (allowAny) {
				response.setHeader('Access-Control-Allow-Origin', '*');
			} else {
				response.setHeader('Access-Control-Allow-Origin', origin);
				response.setHeader('Vary', 'Origin');
			}
		}
		const methods = (this._options.allowedMethods ?? DEFAULT_CORS_METHODS).join(', ');
		response.setHeader('Access-Control-Allow-Methods', methods);
		const headers = (this._options.allowedHeaders ?? DEFAULT_CORS_HEADERS).join(', ');
		response.setHeader('Access-Control-Allow-Headers', headers);
		if (this._options.credentials) {
			response.setHeader('Access-Control-Allow-Credentials', 'true');
		}
		if (this._options.maxAgeSeconds !== undefined) {
			response.setHeader('Access-Control-Max-Age', String(this._options.maxAgeSeconds));
		}
	}

	isPreflight(request: IncomingMessage): boolean {
		return (
			request.method === 'OPTIONS' &&
			typeof request.headers['access-control-request-method'] === 'string'
		);
	}

	handle(request: IncomingMessage, response: ServerResponse): boolean {
		this.applyCorsHeaders(request, response);
		if (this.isPreflight(request)) {
			response.writeHead(204);
			response.end();
			return true;
		}
		return false;
	}
}
