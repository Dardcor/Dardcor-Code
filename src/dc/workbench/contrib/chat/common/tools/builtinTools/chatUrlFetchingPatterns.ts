/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { normalizeURL } from '../../../../../../platform/url/common/trustedDomains.js';
import { testUrlMatchesGlob } from '../../../../../../platform/url/common/urlGlob.js';

function isURLSafeForTrust(url: URI): boolean {
	return url.scheme === 'http' || url.scheme === 'https';
}

export interface IUrlApprovalSettings {
	approveRequest?: boolean;
	approveResponse?: boolean;
}

function getUrlApprovalValue(settings: boolean | IUrlApprovalSettings, checkRequest: boolean): boolean | undefined {
	if (typeof settings === 'boolean') {
		return settings;
	}
	return checkRequest ? settings.approveRequest : settings.approveResponse;
}

export function extractUrlPatterns(url: URI): string[] {
	if (!isURLSafeForTrust(url)) {
		return [];
	}

	const normalizedStr = normalizeURL(url);
	const normalized = URI.parse(normalizedStr);
	const patterns = new Set<string>();

	const fullUrl = normalized.toString(true);
	patterns.add(fullUrl);

	const domainOnly = normalized.with({ path: '', query: '', fragment: '' }).toString(true);
	patterns.add(domainOnly);

	const authority = normalized.authority;
	const domainParts = authority.split('.');

	const isIPv4 = domainParts.length === 4 && domainParts.every((segment: string) =>
		Number.isInteger(+segment));
	const isIPv6 = authority.includes(':') && authority.match(/^(\[)?[0-9a-fA-F:]+(\])?(?::\d+)?$/);
	const isIP = isIPv4 || isIPv6;

	if (!isIP && domainParts.length > 2) {
		for (let i = 0; i < domainParts.length - 2; i++) {
			const wildcardAuthority = '*.' + domainParts.slice(i + 1).join('.');
			const wildcardPattern = normalized.with({
				authority: wildcardAuthority,
				path: '',
				query: '',
				fragment: ''
			}).toString(true);
			patterns.add(wildcardPattern);
		}
	}

	const pathSegments = normalized.path.split('/').filter((s: string) => s.length > 0);
	if (pathSegments.length > 0) {
		for (let i = pathSegments.length - 1; i >= 0; i--) {
			const pathPattern = pathSegments.slice(0, i).join('/');
			const urlWithPathPattern = normalized.with({
				path: (i > 0 ? '/' : '') + pathPattern,
				query: '',
				fragment: ''
			}).toString(true);
			patterns.add(urlWithPathPattern);
		}
	}

	return [...patterns].map(p => p.replace(/\/+$/, ''));
}

export function getPatternLabel(url: URI, pattern: string): string {
	let displayPattern = pattern;

	if (displayPattern.startsWith('https://')) {
		displayPattern = displayPattern.substring(8);
	} else if (displayPattern.startsWith('http://')) {
		displayPattern = displayPattern.substring(7);
	}

	return displayPattern.replace(/\/+$/, '');
}

export function isUrlApproved(
	url: URI,
	approvedUrls: Record<string, boolean | IUrlApprovalSettings>,
	checkRequest: boolean
): boolean {
	if (!isURLSafeForTrust(url)) {
		const settings = approvedUrls['*'];
		return settings === undefined ? false : getUrlApprovalValue(settings, checkRequest) ?? false;
	}

	const normalizedUrlStr = normalizeURL(url);
	const normalizedUrl = URI.parse(normalizedUrlStr);

	for (const [pattern, settings] of Object.entries(approvedUrls)) {
		if (testUrlMatchesGlob(normalizedUrl, pattern)) {
			const value = getUrlApprovalValue(settings, checkRequest);
			if (value !== undefined) {
				return value;
			}
		}
	}

	return false;
}

export function getMatchingPattern(
	url: URI,
	approvedUrls: Record<string, boolean | IUrlApprovalSettings>
): string | undefined {
	if (!isURLSafeForTrust(url)) {
		return Object.keys(approvedUrls).includes('*') ? '*' : undefined;
	}

	const normalizedUrlStr = normalizeURL(url);
	const normalizedUrl = URI.parse(normalizedUrlStr);
	const patterns = extractUrlPatterns(url);

	for (const pattern of patterns) {
		for (const approvedPattern of Object.keys(approvedUrls)) {
			if (testUrlMatchesGlob(normalizedUrl, approvedPattern) && testUrlMatchesGlob(URI.parse(pattern), approvedPattern)) {
				return approvedPattern;
			}
		}
	}

	return undefined;
}
