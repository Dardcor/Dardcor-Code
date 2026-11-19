/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FetchBlockedError, type FetchMiddleware, type HttpHeaders } from '../fetchTypes';

export class RateLimitBackoffError extends FetchBlockedError {
	constructor(retryAfterMs: number) {
		super(`Rate limited, backing off for ${Math.round(retryAfterMs / 1000)}s`, retryAfterMs);
	}
}

export interface RateLimitBackoffOptions {
	readonly initialDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly multiplier?: number;
	readonly now?: () => number;
}

export function rateLimitBackoffMiddleware(options?: RateLimitBackoffOptions): FetchMiddleware {
	const {
		initialDelayMs = 60_000,
		maxDelayMs = 15 * 60_000,
		multiplier = 2,
		now = Date.now,
	} = options ?? {};
	let consecutiveRateLimits = 0;
	let blockedUntil = 0;

	return (next) => async (request) => {
		if (now() < blockedUntil) {
			throw new RateLimitBackoffError(blockedUntil - now());
		}

		const response = await next(request);

		if (!isRateLimited(response.status, response.headers)) {
			if (now() >= blockedUntil) {
				consecutiveRateLimits = 0;
				blockedUntil = 0;
			}
			return response;
		}

		consecutiveRateLimits++;
		const hinted = retryAfterFromHeaders(response.headers, now);
		const backoff = hinted ?? initialDelayMs * Math.pow(multiplier, consecutiveRateLimits - 1);
		const delay = Math.min(backoff, maxDelayMs);
		blockedUntil = now() + delay;
		throw new RateLimitBackoffError(delay);
	};
}

function isRateLimited(status: number, headers: HttpHeaders): boolean {
	if (status === 429) {
		return true;
	}
	return status === 403 && readHeader(headers, 'x-ratelimit-remaining') === '0';
}

function retryAfterFromHeaders(headers: HttpHeaders, now: () => number): number | undefined {
	const retryAfter = Number(readHeader(headers, 'retry-after'));
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return retryAfter * 1000;
	}
	const reset = Number(readHeader(headers, 'x-ratelimit-reset'));
	if (Number.isFinite(reset) && reset > 0) {
		return Math.max(0, reset * 1000 - now());
	}
	return undefined;
}

function readHeader(headers: HttpHeaders, lowerCaseName: string): string | undefined {
	const canonical = lowerCaseName.replace(/(^|-)([a-z])/g, (_, separator: string, char: string) => separator + char.toUpperCase());
	return headers.get(lowerCaseName) ?? headers.get(canonical) ?? undefined;
}
