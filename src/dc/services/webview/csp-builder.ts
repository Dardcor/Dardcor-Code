/**
 * Dardcor Code - Strict Webview CSP Header Generator (Task 182)
 * Mirrors: vs/workbench/contrib/webview/common/webview.ts CSP generator
 */

import { generateNonce } from '../../core/security/nonce';

export interface IWebviewCSPOptions {
	enableScripts?: boolean;
	enableForms?: boolean;
	allowResourceRoots?: string[];
	useNonce?: boolean;
}

export function buildWebviewCSPHeader(options: IWebviewCSPOptions = {}): string {
	const scriptNonce = options.useNonce ? generateNonce() : undefined;

	const scriptSrc = options.enableScripts
		? `'self' ${scriptNonce ? `'nonce-${scriptNonce}'` : "'unsafe-inline'"}`
		: "'none'";
	const formAction = options.enableForms ? "'self'" : "'none'";
	const resourceSrc = options.allowResourceRoots && options.allowResourceRoots.length > 0
		? ` ${options.allowResourceRoots.join(' ')}`
		: '';

	const directives = [
		"default-src 'none'",
		`script-src ${scriptSrc}`,
		"style-src 'self' 'unsafe-inline'",
		`img-src 'self' data: https:${resourceSrc}`,
		`font-src 'self' data: https:`,
		`connect-src 'self' https: wss:${resourceSrc}`,
		`frame-src 'self'${resourceSrc}`,
		"base-uri 'none'",
		`form-action ${formAction}`,
		"frame-ancestors 'self'",
	];

	return directives.join('; ');
}

export function buildWebviewCSPMetaTag(options: IWebviewCSPOptions = {}): string {
	const nonce = options.useNonce ? generateNonce() : undefined;
	const header = buildWebviewCSPHeader(options);
	return `<meta http-equiv="Content-Security-Policy" content="${escapeMeta(header)}"${nonce ? ` nonce="${nonce}"` : ''}>`;
}

function escapeMeta(value: string): string {
	return value.replace(/"/g, '&quot;');
}
