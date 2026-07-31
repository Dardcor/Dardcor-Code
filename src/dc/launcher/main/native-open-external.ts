import { shell } from 'electron';
import { Disposable } from '../../core/lifecycle/disposable';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const ALLOWED_APP_PROTOCOLS = new Set(['dc:', 'dardcor:']);

export interface UrlValidationResult {
	valid: boolean;
	reason?: string;
}

export function validateExternalUrl(url: string): UrlValidationResult {
	if (!url || typeof url !== 'string') {
		return { valid: false, reason: 'Empty URL' };
	}
	if (url.length > 8192) {
		return { valid: false, reason: 'URL too long' };
	}
	try {
		const parsed = new URL(url);
		if (!parsed.protocol) {
			return { valid: false, reason: 'Missing protocol' };
		}
		if (ALLOWED_PROTOCOLS.has(parsed.protocol)) {
			return { valid: true };
		}
		if (ALLOWED_APP_PROTOCOLS.has(parsed.protocol) && parsed.hostname) {
			return { valid: true };
		}
		return { valid: false, reason: `Protocol '${parsed.protocol}' is not allowed` };
	} catch {
		return { valid: false, reason: 'Malformed URL' };
	}
}

export async function openExternal(url: string): Promise<boolean> {
	const validation = validateExternalUrl(url);
	if (!validation.valid) {
		console.warn(`[native-open-external] blocked URL: ${validation.reason}`);
		return false;
	}
	try {
		await shell.openExternal(url);
		return true;
	} catch (err) {
		console.error('[native-open-external] openExternal failed:', err);
		return false;
	}
}

export async function openExternalSafe(url: string): Promise<boolean> {
	if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('vbscript:')) {
		console.warn('[native-open-external] blocked dangerous scheme');
		return false;
	}
	return openExternal(url);
}

export async function openUrl(url: string): Promise<boolean> {
	return openExternal(url);
}

export function isAllowedProtocol(url: string): boolean {
	return validateExternalUrl(url).valid;
}

export function getBlockedReason(url: string): string | null {
	const result = validateExternalUrl(url);
	return result.valid ? null : (result.reason ?? 'Unknown reason');
}

export class ExternalOpener extends Disposable {
	public async open(url: string): Promise<boolean> {
		return openExternal(url);
	}

	public async openSafe(url: string): Promise<boolean> {
		return openExternalSafe(url);
	}

	public canOpen(url: string): boolean {
		return isAllowedProtocol(url);
	}
}

export function createExternalOpener(): ExternalOpener {
	return new ExternalOpener();
}
