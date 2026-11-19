/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FetchBlockedError, type FetchMiddleware } from '../fetchTypes';

export class AuthBlockedError extends FetchBlockedError {
	constructor(retryAfterMs: number) {
		super(`Auth token blocked for ${Math.round(retryAfterMs / 1000)}s after 401/403`, retryAfterMs);
	}
}

export function authBlockedMiddleware(
	blockDurationMs: number = 60 * 60 * 1000,
): FetchMiddleware {
	let blockedToken: string | undefined;
	let blockedUntil = 0;

	return (next) => async (request) => {
		const currentToken = request.headers['Authorization'] ?? request.headers['authorization'];

		if (currentToken !== blockedToken) {
			blockedToken = undefined;
			blockedUntil = 0;
		}

		if (currentToken && currentToken === blockedToken && Date.now() < blockedUntil) {
			throw new AuthBlockedError(blockedUntil - Date.now());
		}

		const response = await next(request);

		if ((response.status === 401 || response.status === 403) && currentToken) {
			blockedToken = currentToken;
			blockedUntil = Date.now() + blockDurationMs;
			throw new AuthBlockedError(blockDurationMs);
		}

		return response;
	};
}
