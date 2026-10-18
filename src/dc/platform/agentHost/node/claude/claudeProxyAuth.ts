/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';

export interface ProxyBearerAuth {
	readonly valid: boolean;
	readonly sessionId: string | undefined;
}

const INVALID: ProxyBearerAuth = Object.freeze({ valid: false, sessionId: undefined });

export function parseProxyBearer(headers: http.IncomingHttpHeaders, expectedNonce: string): ProxyBearerAuth {
	const authHeader = headers['authorization'];
	if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
		return INVALID;
	}

	const token = authHeader.slice('Bearer '.length);
	const dotIndex = token.indexOf('.');
	if (dotIndex === -1) {
		return INVALID;
	}

	const nonce = token.slice(0, dotIndex);
	const sessionId = token.slice(dotIndex + 1);
	if (nonce !== expectedNonce || sessionId.length === 0) {
		return INVALID;
	}

	return { valid: true, sessionId };
}
