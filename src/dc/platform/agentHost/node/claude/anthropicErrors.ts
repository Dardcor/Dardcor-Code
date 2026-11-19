/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';
import type * as http from 'http';


export function buildErrorEnvelope(type: Anthropic.ErrorType, message: string): Anthropic.ErrorResponse {
	return {
		type: 'error',
		error: { type, message },
		request_id: null,
	};
}

export function writeJsonError(
	res: http.ServerResponse,
	status: number,
	type: Anthropic.ErrorType,
	message: string,
): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(buildErrorEnvelope(type, message)));
}

export function writeUpstreamJsonError(
	res: http.ServerResponse,
	status: number,
	envelope: Anthropic.ErrorResponse,
): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(envelope));
}

export function formatSseErrorFrame(envelope: Anthropic.ErrorResponse): string {
	return `event: error\ndata: ${JSON.stringify(envelope)}\n\n`;
}
