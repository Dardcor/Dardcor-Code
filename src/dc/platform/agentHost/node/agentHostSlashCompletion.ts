/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesFuzzy2 } from '../../../base/common/filters.js';

export interface ILeadingSlashToken {
	readonly token: string;
	readonly typed: string;
	readonly rangeStart: number;
	readonly rangeEnd: number;
}

export function extractLeadingSlashToken(text: string, offset: number): ILeadingSlashToken | undefined {
	if (text.length === 0 || text.charCodeAt(0) !== 0x2f ) {
		return undefined;
	}
	let end = 1;
	while (end < text.length) {
		if (isSlashTokenWhitespace(text.charCodeAt(end))) {
			break;
		}
		end++;
	}
	if (offset < 0 || offset > end) {
		return undefined;
	}
	const token = text.slice(0, end);
	return { token, typed: token.slice(1), rangeStart: 0, rangeEnd: end };
}

export function extractWhitespaceDelimitedSlashToken(text: string, offset: number): ILeadingSlashToken | undefined {
	if (text.length === 0 || offset < 0 || offset > text.length) {
		return undefined;
	}

	let start = offset;
	while (start > 0 && !isSlashTokenWhitespace(text.charCodeAt(start - 1))) {
		start--;
	}
	if (start >= text.length || text.charCodeAt(start) !== 0x2f ) {
		return undefined;
	}

	let end = start + 1;
	while (end < text.length && !isSlashTokenWhitespace(text.charCodeAt(end))) {
		end++;
	}
	if (offset > end) {
		return undefined;
	}

	const token = text.slice(start, end);
	return { token, typed: token.slice(1), rangeStart: start, rangeEnd: end };
}

export function matchesSlashCompletion(typed: string, name: string): boolean {
	if (typed.length === 0 || name.toLowerCase().startsWith(typed.toLowerCase())) {
		return true;
	}
	return typed.length > 1 && matchesFuzzy2(typed, name) !== null;
}

function isSlashTokenWhitespace(ch: number): boolean {
	return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d ;
}
