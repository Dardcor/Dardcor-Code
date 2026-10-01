/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface RetryOptions {
	readonly maxRetries?: number;
	readonly baseDelayMs?: number;
	readonly maxDelayMs?: number;
	readonly onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
	readonly shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

function isTransientNetworkError(error: unknown): boolean {
	if (!error) {
		return false;
	}
	const status = (error as { status?: number; statusCode?: number }).status ??
		(error as { status?: number; statusCode?: number }).statusCode;
	if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
		return true;
	}
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return (
		message.includes('etimedout') ||
		message.includes('econnreset') ||
		message.includes('econnrefused') ||
		message.includes('socket hang up') ||
		message.includes('fetch failed') ||
		message.includes('network error') ||
		message.includes('rate limit')
	);
}

export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
	const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const shouldRetry = options?.shouldRetry ?? isTransientNetworkError;

	let attempt = 0;
	while (true) {
		try {
			return await fn();
		} catch (error) {
			attempt++;
			if (attempt > maxRetries || !shouldRetry(error)) {
				throw error;
			}
			// Exponential backoff with jitter to prevent herd thundering on local router and upstream
			const jitter = 0.8 + Math.random() * 0.4;
			const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) * jitter, maxDelayMs);
			if (options?.onRetry) {
				options.onRetry(attempt, Math.round(delay), error);
			}
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
}
