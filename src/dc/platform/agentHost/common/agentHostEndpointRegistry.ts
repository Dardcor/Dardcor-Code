/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vEnum, vLiteral, vNumber, vObj, vOptionalProp, vString, vUnion } from '../../../base/common/validation.js';

export const AGENT_HOST_ENDPOINT_REGISTRY_SCHEMA_VERSION = 2;

export type AgentHostServerType = 'editor' | 'standalone';

export type AgentHostEndpointAddress =
	| { readonly type: 'socket'; readonly path: string }
	| { readonly type: 'tcp'; readonly host: string; readonly port: number };

export interface IAgentHostEndpointMetadata {
	readonly schemaVersion: typeof AGENT_HOST_ENDPOINT_REGISTRY_SCHEMA_VERSION;
	readonly type: AgentHostServerType;
	readonly pid: number;
	readonly instanceId: string;
	readonly protocolVersion: string;
	readonly connectionToken: string;
	readonly endpoint: AgentHostEndpointAddress;
	readonly quality?: string;
	readonly tunnelName?: string;
}

export interface IAgentHostEndpointIdentity {
	readonly type: AgentHostServerType;
	readonly pid: number;
	readonly instanceId: string;
}

const endpointAddressValidator = vUnion(
	vObj({ type: vLiteral('socket'), path: vString() }),
	vObj({ type: vLiteral('tcp'), host: vString(), port: vNumber() }),
);

const entryValidator = vObj({
	schemaVersion: vNumber(),
	type: vEnum('editor', 'standalone'),
	pid: vNumber(),
	instanceId: vString(),
	protocolVersion: vString(),
	connectionToken: vString(),
	endpoint: endpointAddressValidator,
	quality: vOptionalProp(vString()),
	tunnelName: vOptionalProp(vString()),
});

export function parseAgentHostEndpointMetadataEntry(raw: unknown): IAgentHostEndpointMetadata | undefined {
	const { content, error } = entryValidator.validate(raw);
	if (error) {
		return undefined;
	}
	if (content.schemaVersion !== AGENT_HOST_ENDPOINT_REGISTRY_SCHEMA_VERSION) {
		return undefined;
	}
	if (!Number.isSafeInteger(content.pid) || content.pid <= 0) {
		return undefined;
	}
	if (content.endpoint.type === 'tcp' && (!Number.isSafeInteger(content.endpoint.port) || content.endpoint.port <= 0 || content.endpoint.port > 65535)) {
		return undefined;
	}

	return {
		schemaVersion: AGENT_HOST_ENDPOINT_REGISTRY_SCHEMA_VERSION,
		type: content.type,
		pid: content.pid,
		instanceId: content.instanceId,
		protocolVersion: content.protocolVersion,
		connectionToken: content.connectionToken,
		endpoint: content.endpoint,
		quality: content.quality,
		tunnelName: content.tunnelName,
	};
}

export function parseAgentHostEndpointRegistry(raw: unknown): IAgentHostEndpointMetadata[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const entries: IAgentHostEndpointMetadata[] = [];
	for (const item of raw) {
		const entry = parseAgentHostEndpointMetadataEntry(item);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

export function getAgentHostEndpointIdentityKey(identity: IAgentHostEndpointIdentity): string {
	return `${identity.type}:${identity.pid}:${identity.instanceId}`;
}

export function getAgentHostEndpointIdentityHashInput(identity: IAgentHostEndpointIdentity): string {
	return `${identity.type}\0${identity.pid}\0${identity.instanceId}`;
}

export function isSameAgentHostEndpointIdentity(a: IAgentHostEndpointIdentity, b: IAgentHostEndpointIdentity): boolean {
	return a.type === b.type && a.pid === b.pid && a.instanceId === b.instanceId;
}

export function dedupeAgentHostEndpointMetadata(entries: readonly IAgentHostEndpointMetadata[]): IAgentHostEndpointMetadata[] {
	const byIdentity = new Map<string, IAgentHostEndpointMetadata>();
	for (const entry of entries) {
		byIdentity.set(getAgentHostEndpointIdentityKey(entry), entry);
	}
	return [...byIdentity.values()];
}
