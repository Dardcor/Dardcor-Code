/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { ProtectedResourceMetadata } from './state/protocol/state.js';

export interface IGitHubEndpoints {
	readonly apiBaseUri: string;
	readonly graphQlUri: string;
	readonly oauthServer: string;
	readonly enterpriseHost: string | undefined;
}

export const GITHUB_DOT_COM_COPILOT_API_BASE_URI = 'https://api.githubcopilot.com';

const GITHUB_DOT_COM_ENDPOINTS: IGitHubEndpoints = {
	apiBaseUri: 'https://api.github.com',
	graphQlUri: 'https://api.github.com/graphql',
	oauthServer: 'https://github.com/login/oauth',
	enterpriseHost: undefined,
};

export function deriveGitHubEndpoints(enterpriseUri: string | undefined): IGitHubEndpoints {
	if (!enterpriseUri) {
		return GITHUB_DOT_COM_ENDPOINTS;
	}

	let uri: URI;
	try {
		uri = URI.parse(enterpriseUri);
	} catch {
		return GITHUB_DOT_COM_ENDPOINTS;
	}

	const authority = uri.authority;
	if (!authority) {
		return GITHUB_DOT_COM_ENDPOINTS;
	}

	if (authority === 'github.com' || authority === 'www.github.com' || authority === 'api.github.com') {
		return GITHUB_DOT_COM_ENDPOINTS;
	}

	const scheme = uri.scheme || 'https';
	const isCloud = /\.ghe\.com$/.test(authority);
	return {
		apiBaseUri: isCloud ? `${scheme}://api.${authority}` : `${scheme}://${authority}/api/v3`,
		graphQlUri: isCloud ? `${scheme}://api.${authority}/graphql` : `${scheme}://${authority}/api/graphql`,
		oauthServer: `${scheme}://${authority}/login/oauth`,
		enterpriseHost: authority,
	};
}

export function gitHubMcpServerUrl(copilotApiBaseUri: string | undefined): string | undefined {
	try {
		const uri = URI.parse(copilotApiBaseUri ?? GITHUB_DOT_COM_COPILOT_API_BASE_URI, true);
		if (!uri.authority) {
			return undefined;
		}
		return uri.with({ path: '/mcp', query: null, fragment: null }).toString(true);
	} catch {
		return undefined;
	}
}

export function gitHubCopilotResource(endpoints: IGitHubEndpoints): ProtectedResourceMetadata {
	return {
		resource: endpoints.apiBaseUri,
		resource_name: 'GitHub',
		authorization_servers: [endpoints.oauthServer],
		scopes_supported: ['read:user', 'user:email'],
		required: true,
	};
}

export function gitHubRepoResource(endpoints: IGitHubEndpoints): ProtectedResourceMetadata {
	return {
		resource: `${endpoints.apiBaseUri}/repos`,
		resource_name: 'GitHub Repository',
		authorization_servers: [endpoints.oauthServer],
		scopes_supported: ['repo'],
		required: false,
	};
}
