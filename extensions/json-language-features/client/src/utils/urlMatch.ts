/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from 'vscode';

export function matchesUrlPattern(url: Uri, trustedDomains: Record<string, boolean>): boolean {
	if (isLocalhostAuthority(url.authority)) {
		return true;
	}

	for (const [pattern, isTrusted] of Object.entries(trustedDomains)) {
		if (typeof pattern !== 'string' || pattern.trim() === '') {
			continue;
		}

		if (pattern === '*') {
			return isTrusted;
		}

		try {
			const patternUri = Uri.parse(pattern);

			if (url.scheme !== patternUri.scheme) {
				continue;
			}

			if (!matchesAuthority(url.authority, patternUri.authority)) {
				continue;
			}

			if (!matchesPath(url.path, patternUri.path)) {
				continue;
			}

			return isTrusted;
		} catch {
			continue;
		}
	}

	return false;
}

function matchesAuthority(urlAuthority: string, patternAuthority: string): boolean {
	urlAuthority = urlAuthority.toLowerCase();
	patternAuthority = patternAuthority.toLowerCase();

	if (patternAuthority === urlAuthority) {
		return true;
	}
	if (patternAuthority.startsWith('*.')) {
		const patternDomain = patternAuthority.substring(2);
		return urlAuthority === patternDomain || urlAuthority.endsWith('.' + patternDomain);
	}

	return false;
}

function matchesPath(urlPath: string, patternPath: string): boolean {
	if (!patternPath || patternPath === '/') {
		return true;
	}

	if (urlPath === patternPath) {
		return true;
	}

	if (patternPath.endsWith('/')) {
		return urlPath.startsWith(patternPath);
	}

	return urlPath.startsWith(patternPath + '/') || urlPath === patternPath;
}


const rLocalhost = /^(.+\.)?localhost(:\d+)?$/i;
const r127 = /^127\.0\.0\.1(:\d+)?$/;
const rIPv6Localhost = /^\[::1\](:\d+)?$/;

function isLocalhostAuthority(authority: string): boolean {
	return rLocalhost.test(authority) || r127.test(authority) || rIPv6Localhost.test(authority);
}
