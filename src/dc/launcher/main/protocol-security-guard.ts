import { BrowserWindow } from 'electron';
import { parseProtocolUrl, dispatchProtocolUrl } from './protocol-url-dispatcher.js';
import { isProtocolRegistered } from './protocol-handler.js';

export interface UrlValidation {
	safe: boolean;
	reason?: string;
}

const REGISTERED_SCHEMES = new Set(['dc', 'dardcor']);
const ALLOWED_SCHEMES = new Set(['dc', 'dardcor', 'file', 'http', 'https']);
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:///etc', 'chrome:', 'about:']);

export function validateProtocolUrl(url: string): UrlValidation {
	if (!url || typeof url !== 'string') {
		return { safe: false, reason: 'URL is empty' };
	}
	if (url.length > 8192) {
		return { safe: false, reason: 'URL too long' };
	}
	const lower = url.toLowerCase();
	for (const blocked of BLOCKED_SCHEMES) {
		if (lower.startsWith(blocked)) {
			return { safe: false, reason: `Blocked scheme: ${blocked}` };
		}
	}
	let scheme: string;
	try {
		scheme = new URL(url).protocol.replace(':', '');
	} catch {
		return { safe: false, reason: 'Malformed URL' };
	}
	if (!ALLOWED_SCHEMES.has(scheme)) {
		return { safe: false, reason: `Scheme '${scheme}' is not allowed` };
	}
	if (scheme === 'http' || scheme === 'https') {
		return { safe: true };
	}
	if (REGISTERED_SCHEMES.has(scheme) && !isProtocolRegistered(scheme)) {
		return { safe: false, reason: `Protocol '${scheme}' is not registered` };
	}
	if (scheme === 'file') {
		try {
			const pathname = new URL(url).pathname;
			if (pathname.includes('..')) {
				return { safe: false, reason: 'Path traversal detected' };
			}
		} catch {
			return { safe: false, reason: 'Malformed file URL' };
		}
	}
	const action = parseProtocolUrl(url);
	if (action.type === 'unknown') {
		return { safe: false, reason: 'Unrecognized protocol action' };
	}
	return { safe: true };
}

export function guardAndDispatch(url: string, window?: BrowserWindow | null): boolean {
	const validation = validateProtocolUrl(url);
	if (!validation.safe) {
		console.warn(`[protocol-security-guard] blocked URL '${url}': ${validation.reason}`);
		return false;
	}
	return dispatchProtocolUrl(url, window);
}

export function sanitizeProtocolUrl(url: string): string | null {
	const validation = validateProtocolUrl(url);
	if (!validation.safe) {
		return null;
	}
	return url;
}

export function isSafeProtocolUrl(url: string): boolean {
	return validateProtocolUrl(url).safe;
}

export function getBlockReason(url: string): string | null {
	const result = validateProtocolUrl(url);
	return result.safe ? null : (result.reason ?? 'Unknown reason');
}

export function getRegisteredSchemes(): string[] {
	return [...REGISTERED_SCHEMES];
}

export function assertSafeDispatch(url: string, window?: BrowserWindow | null): boolean {
	return guardAndDispatch(url, window);
}
