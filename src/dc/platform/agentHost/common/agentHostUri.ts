/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, encodeHex, VSBuffer } from '../../../base/common/buffer.js';
import { Schemas } from '../../../base/common/network.js';
import { OperatingSystem } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import type { ResourceLabelFormatter } from '../../label/common/label.js';

export const AGENT_HOST_SCHEME = 'vscode-agent-host';

export interface IAgentHostResourceUriMapper {
	fromAgentHost(resource: URI): URI;
	toAgentHost(resource: URI): URI;
}

export const identityAgentHostResourceUriMapper: IAgentHostResourceUriMapper = {
	fromAgentHost: resource => resource,
	toAgentHost: resource => resource,
};

const AGENT_HOST_META_PARAM = '_ah';

interface IAgentHostUriMeta {
	readonly scheme: string;
	readonly authority?: string;
	readonly query?: string;
	readonly contentRef?: true;
}

export function toAgentHostUri(originalUri: URI, connectionAuthority: string): URI {
	return wrapAgentHostUri(originalUri, connectionAuthority, false);
}

export function toAgentHostContentUri(originalUri: URI, connectionAuthority: string): URI {
	return wrapAgentHostUri(originalUri, connectionAuthority, true);
}

export type AgentHostUriMapper = (uri: URI, options?: { readonly contentRef?: boolean }) => URI;

function wrapAgentHostUri(originalUri: URI, connectionAuthority: string, contentRef: boolean): URI {
	if (connectionAuthority === 'local' && originalUri.scheme === Schemas.file) {
		return originalUri;
	}

	const meta: IAgentHostUriMeta = {
		scheme: originalUri.scheme,
		...(originalUri.authority ? { authority: originalUri.authority } : {}),
		...(originalUri.query ? { query: originalUri.query } : {}),
		...(contentRef ? { contentRef: true } as const : {}),
	};
	const params = new URLSearchParams();
	params.set(AGENT_HOST_META_PARAM, encodeBase64(VSBuffer.fromString(JSON.stringify(meta)), false, true));
	return URI.from({
		scheme: AGENT_HOST_SCHEME,
		authority: connectionAuthority,
		path: originalUri.path || '/',
		query: params.toString(),
		fragment: originalUri.fragment,
	});
}

function readAgentHostUriMeta(agentHostUri: URI): Partial<IAgentHostUriMeta> | undefined {
	const encoded = agentHostUri.query ? new URLSearchParams(agentHostUri.query).get(AGENT_HOST_META_PARAM) : null;
	if (!encoded) {
		return undefined;
	}
	try {
		return JSON.parse(decodeBase64(encoded).toString()) as Partial<IAgentHostUriMeta>;
	} catch {
		return undefined;
	}
}

export function isAgentHostContentRefUri(agentHostUri: URI): boolean {
	if (agentHostUri.scheme !== AGENT_HOST_SCHEME) {
		return false;
	}
	return readAgentHostUriMeta(agentHostUri)?.contentRef === true;
}

export function fromAgentHostUri(agentHostUri: URI): URI {
	if (agentHostUri.scheme !== AGENT_HOST_SCHEME) {
		return agentHostUri;
	}

	const meta = readAgentHostUriMeta(agentHostUri);

	if (!meta || typeof meta.scheme !== 'string') {
		return URI.from({ scheme: Schemas.file, path: agentHostUri.path, fragment: agentHostUri.fragment });
	}

	return URI.from({
		scheme: meta.scheme,
		authority: meta.authority || undefined,
		path: agentHostUri.path,
		query: meta.query || '',
		fragment: agentHostUri.fragment,
	});
}

export function createAgentHostResourceUriMapper(connectionAuthority: string): IAgentHostResourceUriMapper {
	return {
		fromAgentHost: resource => toAgentHostUri(resource, connectionAuthority),
		toAgentHost: resource => fromAgentHostUri(resource),
	};
}

export function normalizeRemoteAgentHostAddress(address: string): string {
	if (address.startsWith('ws://')) {
		return address.slice('ws://'.length);
	}
	return address;
}

const REMOTE_LOCAL_AGENT_HOST_AUTHORITY = 'remote_local';
const HEX_AGENT_HOST_AUTHORITY_PREFIX = 'hex-';

export function agentHostAuthority(address: string): string {
	const normalized = normalizeRemoteAgentHostAddress(address);
	if (normalized === 'local') {
		return REMOTE_LOCAL_AGENT_HOST_AUTHORITY;
	}
	if (/^[a-z0-9]+$/.test(normalized)) {
		return normalized;
	}
	if (/^[a-z0-9.:\-]+$/.test(normalized) && !/^hex-/i.test(normalized)) {
		return normalized.replaceAll(':', '__');
	}
	return `${HEX_AGENT_HOST_AUTHORITY_PREFIX}${encodeHex(VSBuffer.fromString(normalized))}`;
}

export const LOCAL_AGENT_HOST_AUTHORITY = 'local';

export const AGENT_HOST_LABEL_FORMATTER: ResourceLabelFormatter = {
	scheme: AGENT_HOST_SCHEME,
	formatting: {
		label: '${path}',
		separator: '/',
	},
};

export function agentHostLabelFormatter(authority: string, os: OperatingSystem): ResourceLabelFormatter {
	const isWindows = os === OperatingSystem.Windows;
	return {
		scheme: AGENT_HOST_SCHEME,
		authority,
		formatting: {
			label: '${path}',
			separator: isWindows ? '\\' : '/',
			normalizeDriveLetter: isWindows,
		},
	};
}
