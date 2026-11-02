/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { env } from '../../../../base/common/process.js';
import type { IProcessEnvironment } from '../../../../base/common/platform.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { getCopilotHomePath } from '../../../../platform/agentHost/common/dardcorHome.js';
import { parseRemoteAgentHostSessionTypeAuthority } from '../../../../platform/agentHost/common/agentHostSessionType.js';
import { agentHostAuthority, fromAgentHostUri, toAgentHostUri } from '../../../../platform/agentHost/common/agentHostUri.js';
import { IRemoteAgentHostConnectionInfo } from '../../../../platform/agentHost/common/remoteAgentHostService.js';

const COPILOT_CLI_PROVIDER = 'copilotcli';
export const COPILOT_CLI_LOCAL_AH_SCHEME = `agent-host-${COPILOT_CLI_PROVIDER}`;
export const COPILOT_CLI_EH_SCHEME = COPILOT_CLI_PROVIDER;
export const COPILOT_CLI_AGENT_PROVIDER = COPILOT_CLI_PROVIDER;

export function buildLocalEventsUri(userHome: URI, rawSessionId: string, environment: IProcessEnvironment = env): URI {
	return joinPath(buildLocalCopilotHomeUri(userHome, environment), 'session-state', rawSessionId, 'events.jsonl');
}

export function buildLocalCopilotLogsUri(userHome: URI, environment: IProcessEnvironment = env): URI {
	return joinPath(buildLocalCopilotHomeUri(userHome, environment), 'logs');
}

export function buildLocalSessionStateUri(userHome: URI, environment: IProcessEnvironment = env): URI {
	return joinPath(buildLocalCopilotHomeUri(userHome, environment), 'session-state');
}

export function buildRemoteEventsUri(connection: IRemoteAgentHostConnectionInfo, rawSessionId: string): URI | undefined {
	const homePath = connection.defaultDirectory;
	if (!homePath) {
		return undefined;
	}
	const trimmed = homePath.endsWith('/') ? homePath.slice(0, -1) : homePath;
	const remoteFileUri = URI.from({
		scheme: 'file',
		path: `${trimmed}/.copilot/session-state/${rawSessionId}/events.jsonl`,
	});
	const authority = agentHostAuthority(connection.address);
	return toAgentHostUri(remoteFileUri, authority);
}

export function buildRemoteCopilotLogsUri(connection: IRemoteAgentHostConnectionInfo): URI | undefined {
	const homePath = connection.defaultDirectory;
	if (!homePath) {
		return undefined;
	}
	const trimmed = homePath.endsWith('/') ? homePath.slice(0, -1) : homePath;
	const remoteFileUri = URI.from({
		scheme: 'file',
		path: `${trimmed}/.copilot/logs`,
	});
	const authority = agentHostAuthority(connection.address);
	return toAgentHostUri(remoteFileUri, authority);
}

export function parseRemoteAuthorityFromScheme(scheme: string): string | undefined {
	return parseRemoteAgentHostSessionTypeAuthority(scheme, COPILOT_CLI_PROVIDER);
}

export function getCopilotCliSessionRawId(sessionResource: URI | undefined): string | undefined {
	if (!sessionResource) {
		return undefined;
	}
	if (sessionResource.scheme !== COPILOT_CLI_LOCAL_AH_SCHEME && sessionResource.scheme !== COPILOT_CLI_EH_SCHEME && !parseRemoteAuthorityFromScheme(sessionResource.scheme)) {
		return undefined;
	}
	return getRawSessionId(sessionResource);
}

export function dedupeMigratedCopilotCliSessions<T>(items: readonly T[], resourceOf: (item: T) => URI): T[] {
	let migratedRawIds: Set<string> | undefined;
	for (const item of items) {
		const resource = resourceOf(item);
		if (resource.scheme === COPILOT_CLI_LOCAL_AH_SCHEME) {
			const rawId = getCopilotCliSessionRawId(resource);
			if (rawId) {
				(migratedRawIds ??= new Set<string>()).add(rawId);
			}
		}
	}
	if (!migratedRawIds) {
		return items.slice();
	}
	return items.filter(item => {
		const resource = resourceOf(item);
		if (resource.scheme !== COPILOT_CLI_EH_SCHEME) {
			return true;
		}
		const rawId = getCopilotCliSessionRawId(resource);
		return !rawId || !migratedRawIds.has(rawId);
	});
}

export function migratedCopilotCliResource(resource: URI | undefined): URI | undefined {
	if (resource?.scheme !== COPILOT_CLI_EH_SCHEME) {
		return undefined;
	}
	const rawId = getCopilotCliSessionRawId(resource);
	return rawId ? URI.from({ scheme: COPILOT_CLI_LOCAL_AH_SCHEME, path: `/${rawId}` }) : undefined;
}

export type ResolveEventsUriResult =
	| { readonly kind: 'ok'; readonly resource: URI }
	| { readonly kind: 'no-session' }
	| { readonly kind: 'unsupported-scheme'; readonly scheme: string }
	| { readonly kind: 'remote-not-connected'; readonly authority: string }
	| { readonly kind: 'remote-no-home'; readonly authority: string };

export function resolveEventsUri(
	sessionResource: URI | undefined,
	userHome: URI,
	getConnectionByAuthority: (authority: string) => IRemoteAgentHostConnectionInfo | undefined,
	environment: IProcessEnvironment = env,
): ResolveEventsUriResult {
	if (!sessionResource) {
		return { kind: 'no-session' };
	}
	const rawId = getRawSessionId(sessionResource);
	if (!rawId) {
		return { kind: 'no-session' };
	}

	if (sessionResource.scheme === COPILOT_CLI_LOCAL_AH_SCHEME || sessionResource.scheme === COPILOT_CLI_EH_SCHEME) {
		return { kind: 'ok', resource: buildLocalEventsUri(userHome, rawId, environment) };
	}

	const remoteAuthority = parseRemoteAuthorityFromScheme(sessionResource.scheme);
	if (remoteAuthority) {
		const connection = getConnectionByAuthority(remoteAuthority);
		if (!connection) {
			return { kind: 'remote-not-connected', authority: remoteAuthority };
		}
		const resource = buildRemoteEventsUri(connection, rawId);
		if (!resource) {
			return { kind: 'remote-no-home', authority: remoteAuthority };
		}
		return { kind: 'ok', resource };
	}

	return { kind: 'unsupported-scheme', scheme: sessionResource.scheme };
}

function getRawSessionId(sessionResource: URI): string | undefined {
	const rawId = sessionResource.path.startsWith('/') ? sessionResource.path.substring(1) : sessionResource.path;
	return rawId || undefined;
}

export function buildHostLocalEventsPath(
	sessionResource: URI | undefined,
	userHome: URI,
	getConnectionByAuthority: (authority: string) => IRemoteAgentHostConnectionInfo | undefined,
	environment: IProcessEnvironment = env,
): string | undefined {
	const result = resolveEventsUri(sessionResource, userHome, getConnectionByAuthority, environment);
	if (result.kind !== 'ok') {
		return undefined;
	}
	if (result.resource.scheme === Schemas.file) {
		return result.resource.fsPath;
	}
	return fromAgentHostUri(result.resource).path.replace(/^\/([a-zA-Z]:)/, '$1');
}

function buildLocalCopilotHomeUri(userHome: URI, environment: IProcessEnvironment): URI {
	return URI.file(getCopilotHomePath(userHome.fsPath, environment));
}
