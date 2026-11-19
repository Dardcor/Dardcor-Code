/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AgentProvider } from './agent.js';

const REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX = 'remote-';

export function remoteAgentHostSessionTypeId(connectionAuthority: string, agentProvider: AgentProvider): string {
	return `${remoteAgentHostSessionTypeAuthorityPrefix(connectionAuthority)}${agentProvider}`;
}

export function remoteAgentHostSessionTypeAuthorityPrefix(connectionAuthority: string): string {
	return `${REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX}${connectionAuthority}-`;
}

export function isRemoteAgentHostSessionType(sessionType: string): boolean {
	return sessionType.startsWith(REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX);
}

export function findRemoteAgentHostSessionTypeAuthority(sessionType: string, connectionAuthorities: Iterable<string>): string | undefined {
	if (!isRemoteAgentHostSessionType(sessionType)) {
		return undefined;
	}

	let bestMatch: string | undefined;
	for (const authority of connectionAuthorities) {
		if (isRemoteAgentHostSessionTypeForAuthority(sessionType, authority) && (!bestMatch || authority.length > bestMatch.length)) {
			bestMatch = authority;
		}
	}
	return bestMatch;
}

function isRemoteAgentHostSessionTypeForAuthority(sessionType: string, connectionAuthority: string): boolean {
	return !!connectionAuthority && sessionType.startsWith(remoteAgentHostSessionTypeAuthorityPrefix(connectionAuthority));
}

export function parseRemoteAgentHostHarness(sessionType: string): string | undefined {
	if (!isRemoteAgentHostSessionType(sessionType)) {
		return undefined;
	}
	const lastDash = sessionType.lastIndexOf('-');
	const harness = sessionType.slice(lastDash + 1);
	return harness || undefined;
}

export function parseRemoteAgentHostSessionTypeAuthority(sessionType: string, agentProvider: AgentProvider): string | undefined {
	if (!isRemoteAgentHostSessionType(sessionType)) {
		return undefined;
	}

	const providerSuffix = `-${agentProvider}`;
	if (!sessionType.endsWith(providerSuffix)) {
		return undefined;
	}

	const authority = sessionType.slice(REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX.length, sessionType.length - providerSuffix.length);
	return authority || undefined;
}
