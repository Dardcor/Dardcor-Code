/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';

export function getRemoteAuthority(uri: URI): string | undefined {
	return uri.scheme === Schemas.vscodeRemote ? uri.authority : undefined;
}

export function getRemoteName(authority: string): string;
export function getRemoteName(authority: undefined): undefined;
export function getRemoteName(authority: string | undefined): string | undefined;
export function getRemoteName(authority: string | undefined): string | undefined {
	if (!authority) {
		return undefined;
	}
	const pos = authority.indexOf('+');
	if (pos < 0) {
		return authority;
	}
	return authority.substr(0, pos);
}

export function getRemoteServerRootPath(authority: string): string | undefined;
export function getRemoteServerRootPath(authority: undefined): undefined;
export function getRemoteServerRootPath(authority: string | undefined): string | undefined;
export function getRemoteServerRootPath(authority: string | undefined): string | undefined {
	if (!authority) {
		return undefined;
	}
	const pos = authority.indexOf('+');
	if (pos < 0) {
		return undefined;
	}
	return authority.substring(pos + 1);
}

export function parseAuthorityWithPort(authority: string): { host: string; port: number } {
	const { host, port } = parseAuthority(authority);
	if (typeof port === 'undefined') {
		throw new Error(`Invalid remote authority: ${authority}. It must either be a remote of form <remoteName>+<arg> or a remote host of form <host>:<port>.`);
	}
	return { host, port };
}

export function parseAuthorityWithOptionalPort(authority: string, defaultPort: number): { host: string; port: number } {
	let { host, port } = parseAuthority(authority);
	if (typeof port === 'undefined') {
		port = defaultPort;
	}
	return { host, port };
}

function parseAuthority(authority: string): { host: string; port: number | undefined } {
	const m1 = authority.match(/^(\[[0-9a-z:]+\]):(\d+)$/);
	if (m1) {
		return { host: m1[1], port: parseInt(m1[2], 10) };
	}

	const m2 = authority.match(/^(\[[0-9a-z:]+\])$/);
	if (m2) {
		return { host: m2[1], port: undefined };
	}

	const m3 = authority.match(/(.*):(\d+)$/);
	if (m3) {
		return { host: m3[1], port: parseInt(m3[2], 10) };
	}

	return { host: authority, port: undefined };
}

const loopbackHosts = new Set([
	'localhost',
	'127.0.0.1',
	'::1',
	'[::1]',
	'0000:0000:0000:0000:0000:0000:0000:0001',
	'[0000:0000:0000:0000:0000:0000:0000:0001]'
]);

export function isLoopbackHost(host: string): boolean {
	return loopbackHosts.has(host.toLowerCase());
}
