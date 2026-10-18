/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';

const fileExtensionSuffixes = new Set([
	'7z', 'bz2', 'cjs', 'class', 'cpp', 'cs', 'css', 'csv', 'dll', 'exe', 'gif', 'gz', 'ico', 'jar',
	'env', 'java', 'jpeg', 'jpg', 'js', 'json', 'jsx', 'lock', 'log', 'md', 'mjs', 'pdf', 'php', 'png',
	'py', 'rar', 'rs', 'so', 'sql', 'svg', 'tar', 'tgz', 'toml', 'ts', 'tsx', 'txt', 'wasm', 'webp',
	'xml', 'yaml', 'yml', 'zip'
]);

const wellKnownDomainSuffixes = new Set([
	'ai', 'cloud', 'com', 'dev', 'io', 'me', 'net', 'org', 'tech'
]);

export function normalizeDomain(value: string | undefined, fromUrl: boolean = false): string | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.trim().toLowerCase().replace(/^[^@]+@/, '').replace(/:\d+$/, '').replace(/\.+$/, '');
	if (!normalized || normalized.includes('/') || normalized === '.' || normalized === '..') {
		return undefined;
	}

	if (normalized === '*') {
		return '*';
	}

	if (!/^\*?\.?[a-z0-9.;,)!?:-]+$/.test(normalized)) {
		return undefined;
	}

	const stripped = normalized.replace(/[),;:!?]+$/, '');
	if (!stripped) {
		return undefined;
	}

	const domainToValidate = stripped.startsWith('*.') ? stripped.slice(2) : stripped;
	if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))*$/.test(domainToValidate)) {
		return undefined;
	}

	const hasWildcardPrefix = stripped.startsWith('*.');
	const host = hasWildcardPrefix ? stripped.slice(2) : stripped;
	if (!host) {
		return undefined;
	}

	if (!/^[a-z0-9.-]+$/.test(host)) {
		return undefined;
	}

	if (!fromUrl) {
		const lastLabel = host.slice(host.lastIndexOf('.') + 1);
		if (fileExtensionSuffixes.has(lastLabel)) {
			return undefined;
		}
		if (!wellKnownDomainSuffixes.has(lastLabel)) {
			return undefined;
		}
	}

	return hasWildcardPrefix ? `*.${host}` : host;
}

function normalizeUriAuthority(authority: string | undefined): string | undefined {
	if (!authority || /[/?#\\]/.test(authority)) {
		return undefined;
	}

	let hostname: string;
	try {
		const url = new URL(`http://${authority}`);
		if (hasHostLikeCredentials(url)) {
			return undefined;
		}
		hostname = url.hostname.toLowerCase();
	} catch {
		return undefined;
	}

	if (hostname.startsWith('[')) {
		return hostname.endsWith(']') ? hostname : undefined;
	}

	return normalizeDomain(hostname, true);
}

function hasHostLikeCredentials(url: URL): boolean {
	return [url.username, url.password].some(value => {
		if (!value) {
			return false;
		}

		let decoded: string;
		try {
			decoded = decodeURIComponent(value).toLowerCase();
		} catch {
			return true;
		}

		if (decoded.includes('@')) {
			return false;
		}

		return (decoded.includes('.') && normalizeDomain(decoded, true) !== undefined)
			|| normalizeBareIpv6(decoded) !== undefined;
	});
}

function normalizeBareIpv6(value: string): string | undefined {
	if (!value.includes(':') || /[/?#\\@\[\]]/.test(value)) {
		return undefined;
	}
	return normalizeUriAuthority(`[${value}]`);
}

export function normalizeDomainPattern(pattern: string): string | undefined {
	const extractedPattern = extractDomainPattern(pattern);

	if (extractedPattern === '*') {
		return extractedPattern;
	}

	if (extractedPattern.startsWith('*.')) {
		const normalizedPattern = normalizeDomain(extractedPattern, true);
		if (!normalizedPattern) {
			return undefined;
		}
		const suffix = normalizedPattern.slice(2);
		return `*.${normalizeUriAuthority(suffix) ?? suffix}`;
	}

	return normalizeBareIpv6(extractedPattern)
		?? normalizeUriAuthority(extractedPattern)
		?? normalizeDomain(extractedPattern, true);
}

function normalizeEmbeddedIpv4(value: string): string | undefined {
	const mappedMatch = /^\[::ffff:(?<high>[0-9a-f]{1,4}):(?<low>[0-9a-f]{1,4})\]$/.exec(value);
	const compatibleMatch = mappedMatch ? undefined : /^\[::(?:(?<high>[0-9a-f]{1,4}):)?(?<low>[0-9a-f]{1,4})\]$/.exec(value);
	const groups = (mappedMatch ?? compatibleMatch)?.groups;
	if (!groups) {
		return undefined;
	}

	const high = Number.parseInt(groups.high ?? '0', 16);
	const low = Number.parseInt(groups.low, 16);
	if (compatibleMatch && high === 0 && low <= 1) {
		return undefined;
	}

	return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

export function extractDomainPattern(pattern: string): string {
	const trimmed = pattern.trim();
	if (trimmed === '*') {
		return trimmed;
	}
	if (!trimmed.includes('://')) {
		return trimmed;
	}
	try {
		return URI.parse(trimmed).authority;
	} catch {
		return trimmed;
	}
}

export function matchesDomainPattern(domain: string, pattern: string): boolean {
	const normalizedPattern = normalizeDomainPattern(pattern);
	if (!normalizedPattern) {
		return false;
	}
	if (normalizedPattern === '*') {
		return true;
	}
	if (normalizedPattern.startsWith('*.')) {
		const suffix = normalizedPattern.slice(2);
		const normalizedDomain = normalizeEmbeddedIpv4(domain) ?? domain;
		return normalizedDomain === suffix || normalizedDomain.endsWith(`.${suffix}`);
	}
	return (normalizeEmbeddedIpv4(domain) ?? domain) === (normalizeEmbeddedIpv4(normalizedPattern) ?? normalizedPattern);
}

export function extractDomainFromUri(uri: URI): string | undefined {
	return normalizeUriAuthority(uri.authority);
}

export function isDomainAllowed(domain: string, allowedPatterns: string[], deniedPatterns: string[]): boolean {
	if (allowedPatterns.length === 0 && deniedPatterns.length === 0) {
		return false;
	}

	if (deniedPatterns.some(pattern => matchesDomainPattern(domain, pattern))) {
		return false;
	}

	if (allowedPatterns.length === 0) {
		return true;
	}

	return allowedPatterns.some(pattern => matchesDomainPattern(domain, pattern));
}
