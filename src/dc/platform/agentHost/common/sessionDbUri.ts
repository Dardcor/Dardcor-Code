/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeHex } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';

const SESSION_DB_SCHEME = 'session-db';

export function buildSessionDbUri(sessionUri: string, toolCallId: string, filePath: string, part: 'before' | 'after'): string {
	return sessionDbUri(URI.file(filePath).path, { sessionUri, toolCallId, filePath, part }).toString();
}

function sessionDbUri(path: string, fields: ISessionDbUriFields): URI {
	return URI.from({ scheme: SESSION_DB_SCHEME, path, query: JSON.stringify(fields) });
}

export interface ISessionDbUriFields {
	sessionUri: string;
	toolCallId: string;
	filePath: string;
	part: 'before' | 'after';
}

export function parseSessionDbUri(raw: string): ISessionDbUriFields | undefined {
	let parsed: URI;
	try {
		parsed = URI.parse(raw);
	} catch {
		return undefined;
	}
	if (parsed.scheme !== SESSION_DB_SCHEME) {
		return undefined;
	}
	return parsed.query ? parseSessionDbUriQuery(parsed.query) : parseLegacySessionDbUri(parsed);
}

export function canonicalizeSessionDbUri(uri: URI, fileUri: URI): URI {
	if (uri.scheme !== SESSION_DB_SCHEME || uri.query) {
		return uri;
	}
	const fields = parseLegacySessionDbUri(uri);
	if (!fields) {
		return uri;
	}
	return sessionDbUri(fileUri.path, fields);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function parseSessionDbUriQuery(query: string): ISessionDbUriFields | undefined {
	let fields: Partial<ISessionDbUriFields>;
	try {
		fields = JSON.parse(query) as Partial<ISessionDbUriFields>;
	} catch {
		return undefined;
	}
	if (typeof fields !== 'object' || fields === null) {
		return undefined;
	}
	const { sessionUri, toolCallId, filePath, part } = fields;
	if (!isNonEmptyString(sessionUri) || !isNonEmptyString(toolCallId) || !isNonEmptyString(filePath) || (part !== 'before' && part !== 'after')) {
		return undefined;
	}
	return { sessionUri, toolCallId, filePath, part };
}

function parseLegacySessionDbUri(uri: URI): ISessionDbUriFields | undefined {
	const [, toolCallId, filePath, part] = uri.path.split('/');
	if (!toolCallId || !filePath || (part !== 'before' && part !== 'after')) {
		return undefined;
	}
	try {
		return {
			sessionUri: decodeHex(uri.authority).toString(),
			toolCallId: decodeURIComponent(toolCallId),
			filePath: decodeHex(filePath).toString(),
			part
		};
	} catch {
		return undefined;
	}
}
