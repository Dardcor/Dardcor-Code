/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const DEFAULT_ROUTER_PORT = 25128;
const DEFAULT_ROUTER_KEY = 'sk-dardcor-local-key';

export function getDardcorRouterBaseUrl(): string {
	const configuredUrl = process.env.DARDCOR_ROUTER_URL?.trim();
	if (configuredUrl) {
		const url = new URL(configuredUrl);
		if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
			throw new Error('DARDCOR_ROUTER_URL must use HTTP(S) and must not contain credentials.');
		}
		url.pathname = url.pathname.replace(/\/$/, '').replace(/\/v1$/, '');
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/$/, '');
	}

	const configuredPort = process.env.DARDCOR_PORT?.trim();
	const port = configuredPort ? Number(configuredPort) : DEFAULT_ROUTER_PORT;
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('DARDCOR_PORT must be an integer between 1 and 65535.');
	}
	return `http://127.0.0.1:${port}`;
}

export function getDardcorRouterApiKey(): string {
	return process.env.DARDCOR_API_KEY || DEFAULT_ROUTER_KEY;
}
