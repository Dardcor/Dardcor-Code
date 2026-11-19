/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';

export const AGENT_CLIENT_SCHEME = 'vscode-agent-client';

export function toAgentClientUri(originalUri: URI, clientId: string): URI {
	const originalAuthority = originalUri.authority || '-';
	const isOpaque = originalUri.path.length > 0 && !originalUri.path.startsWith('/');
	const schemeSlot = isOpaque ? `${originalUri.scheme}!` : originalUri.scheme;
	const pathBody = isOpaque ? `/${originalUri.path}` : originalUri.path;
	return URI.from({
		scheme: AGENT_CLIENT_SCHEME,
		authority: clientId,
		path: `/${schemeSlot}/${originalAuthority}${pathBody}`,
		query: originalUri.query || undefined,
		fragment: originalUri.fragment || undefined,
	});
}

export function fromAgentClientUri(agentClientUri: URI): URI {
	const path = agentClientUri.path;
	const query = agentClientUri.query || undefined;
	const fragment = agentClientUri.fragment || undefined;

	const schemeEnd = path.indexOf('/', 1);
	if (schemeEnd === -1) {
		return URI.from({ scheme: 'file', path, query, fragment });
	}

	let originalScheme = path.substring(1, schemeEnd);
	const isOpaque = originalScheme.endsWith('!');
	if (isOpaque) {
		originalScheme = originalScheme.substring(0, originalScheme.length - 1);
	}

	const authorityEnd = path.indexOf('/', schemeEnd + 1);
	if (authorityEnd === -1) {
		const originalAuthority = path.substring(schemeEnd + 1);
		return URI.from({ scheme: originalScheme, authority: originalAuthority === '-' ? '' : originalAuthority, path: '/', query, fragment });
	}

	let originalAuthority = path.substring(schemeEnd + 1, authorityEnd);
	if (originalAuthority === '-') {
		originalAuthority = '';
	}

	let originalPath = path.substring(authorityEnd);
	if (isOpaque) {
		originalPath = originalPath.substring(1);
	}

	return URI.from({
		scheme: originalScheme,
		authority: originalAuthority || undefined,
		path: originalPath,
		query,
		fragment,
	});
}
