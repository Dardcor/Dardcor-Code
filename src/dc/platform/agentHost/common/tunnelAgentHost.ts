/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const ITunnelAgentHostService = createDecorator<ITunnelAgentHostService>('tunnelAgentHostService');
export const ITunnelAgentHostHostingService = createDecorator<ITunnelAgentHostHostingService>('tunnelAgentHostHostingService');

export const TUNNEL_AGENT_HOST_CHANNEL = 'tunnelAgentHost';
export const TUNNEL_HOST_CHANNEL = TUNNEL_AGENT_HOST_CHANNEL;
export const TUNNEL_HOST_LOG_ID = 'tunnelAgentHost';

export type TunnelHostStatus = { active: true; info: ITunnelHostInfo } | { active: false; info?: undefined };

export interface ITunnelAgentHostHostingService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeStatus: Event<TunnelHostStatus>;
	startHosting(token: string, authProvider: 'github' | 'microsoft', socketInfo: any): Promise<ITunnelHostInfo>;
	stopHosting(): Promise<void>;
	getStatus(): Promise<TunnelHostStatus>;
}

export const TunnelAgentHostsSettingId = 'chat.remoteAgentTunnels';

export const TUNNEL_MIN_PROTOCOL_VERSION = 5;

export const TUNNEL_AGENT_HOST_PORT = 31546;

export const TUNNEL_LAUNCHER_LABEL = 'vscode-server-launcher';

export const TUNNEL_ADDRESS_PREFIX = 'tunnel:';

export const TUNNEL_GATEWAY_SELECT_PATH = '/agent-host/select';

export const TUNNEL_GATEWAY_MIN_PROTOCOL_VERSION = 6;

export const PROTOCOL_VERSION_TAG_PREFIX = 'protocolv';

export class TunnelTags {
	public readonly protocolVersion: number = 2;
	public readonly name: string | undefined;

	constructor(readonly value: readonly string[] | undefined) {
		if (value) {
			let protocolVersion: number | undefined;
			let name: string | undefined;
			for (const tag of value) {
				if (tag.startsWith(PROTOCOL_VERSION_TAG_PREFIX)) {
					const parsed = Number(tag.slice(PROTOCOL_VERSION_TAG_PREFIX.length));
					if (!isNaN(parsed)) {
						protocolVersion = parsed;
					}
				} else if (!tag.startsWith('_') && tag !== TUNNEL_LAUNCHER_LABEL && !name) {
					name = tag;
				}
			}
			if (protocolVersion !== undefined) {
				this.protocolVersion = protocolVersion;
			}
			if (name !== undefined) {
				this.name = name;
			}
		}
	}
}

export interface ICachedTunnel {
	readonly tunnelId: string;
	readonly clusterId: string;
	readonly name: string;
	readonly protocolVersion?: number;
	readonly authProvider?: 'github' | 'microsoft';
}

export interface ITunnelInfo {
	readonly tunnelId: string;
	readonly clusterId: string;
	readonly name: string;
	readonly tags: readonly string[];
	readonly protocolVersion: number;
	readonly hostConnectionCount: number;
}

export type TunnelAutoConnectMode = 'background' | 'prompt';

export type TunnelGatewayServerType = 'editor' | 'standalone';

export type TunnelGatewayLifecycle = 'external' | 'managed';

export interface ITunnelGatewayEndpoint {
	readonly type: TunnelGatewayServerType;
	readonly pid: number;
	readonly instanceId: string;
	readonly quality?: string;
	readonly tunnelName?: string;
	readonly endpointKind: 'tcp' | 'socket';
	readonly endpointLabel: string;
}

export interface ITunnelGatewayInventory {
	readonly userDataPath: string;
	readonly endpoints: readonly ITunnelGatewayEndpoint[];
	readonly delegatedInstanceId?: string;
}

export type ITunnelGatewaySelection =
	| { readonly instanceId: string }
	| { readonly newDedicated: true };

export interface ITunnelGatewaySelectedInfo {
	readonly serverType: TunnelGatewayServerType | 'unknown';
	readonly instanceId: string;
	readonly role: 'primary';
	readonly lifecycle: TunnelGatewayLifecycle;
}

export interface ITunnelGatewaySelectionSession {
	readonly selectionId: string;
	readonly inventory: ITunnelGatewayInventory;
}

export class TunnelGatewayProtocolError extends Error { }

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTunnelGatewayEndpoint(value: unknown, index: number): ITunnelGatewayEndpoint {
	if (!isPlainObject(value)) {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} is not an object`);
	}
	const { type, pid, instanceId, quality, tunnelName, endpointKind, endpointLabel } = value;
	if (type !== 'editor' && type !== 'standalone') {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "type"`);
	}
	if (typeof pid !== 'number') {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "pid"`);
	}
	if (typeof instanceId !== 'string' || !instanceId) {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "instanceId"`);
	}
	if (quality !== undefined && typeof quality !== 'string') {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "quality"`);
	}
	if (tunnelName !== undefined && typeof tunnelName !== 'string') {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "tunnelName"`);
	}
	if (endpointKind !== 'tcp' && endpointKind !== 'socket') {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "endpointKind"`);
	}
	if (typeof endpointLabel !== 'string' || !endpointLabel) {
		throw new TunnelGatewayProtocolError(`Gateway inventory endpoint at index ${index} has an invalid "endpointLabel"`);
	}
	return { type, pid, instanceId, quality, tunnelName, endpointKind, endpointLabel };
}

export function parseTunnelGatewayInventory(json: string): ITunnelGatewayInventory {
	const parsed: unknown = JSON.parse(json);
	if (!isPlainObject(parsed)) {
		throw new TunnelGatewayProtocolError('Gateway inventory message is not an object');
	}
	const { userDataPath, endpoints, delegatedInstanceId } = parsed;
	if (typeof userDataPath !== 'string' || !userDataPath) {
		throw new TunnelGatewayProtocolError('Gateway inventory message has an invalid "userDataPath"');
	}
	if (!Array.isArray(endpoints)) {
		throw new TunnelGatewayProtocolError('Gateway inventory message has an invalid "endpoints"');
	}
	if (delegatedInstanceId !== undefined && (typeof delegatedInstanceId !== 'string' || !delegatedInstanceId)) {
		throw new TunnelGatewayProtocolError('Gateway inventory message has an invalid "delegatedInstanceId"');
	}
	const parsedEndpoints = endpoints.map((e, i) => parseTunnelGatewayEndpoint(e, i));
	if (delegatedInstanceId === undefined) {
		return { userDataPath, endpoints: parsedEndpoints };
	}
	return { userDataPath, endpoints: parsedEndpoints, delegatedInstanceId };
}

export function parseTunnelGatewaySelectionResponse(json: string): { ok: true; selected: ITunnelGatewaySelectedInfo } | { ok: false; error: string } {
	const parsed: unknown = JSON.parse(json);
	if (!isPlainObject(parsed) || typeof parsed.ok !== 'boolean') {
		throw new TunnelGatewayProtocolError('Gateway selection acknowledgement is not a valid response');
	}
	if (!parsed.ok) {
		const error = typeof parsed.error === 'string' ? parsed.error : 'Gateway selection failed';
		return { ok: false, error };
	}
	const selected = parsed.selected;
	if (!isPlainObject(selected)
		|| (selected.type !== 'editor' && selected.type !== 'standalone')
		|| typeof selected.instanceId !== 'string' || !selected.instanceId
		|| selected.role !== 'primary'
		|| (selected.lifecycle !== 'external' && selected.lifecycle !== 'managed')
	) {
		throw new TunnelGatewayProtocolError('Gateway selection acknowledgement has an invalid "selected" payload');
	}
	return {
		ok: true,
		selected: {
			serverType: selected.type,
			instanceId: selected.instanceId,
			role: 'primary',
			lifecycle: selected.lifecycle,
		},
	};
}

export const TUNNEL_GATEWAY_SELECTION_REJECTED_ERROR_NAME = 'TunnelGatewaySelectionRejectedError';

export function createTunnelGatewaySelectionRejectedError(message: string): Error {
	const error = new Error(message);
	error.name = TUNNEL_GATEWAY_SELECTION_REJECTED_ERROR_NAME;
	return error;
}

export function isTunnelGatewaySelectionRejectedError(error: unknown): boolean {
	return error instanceof Error && error.name === TUNNEL_GATEWAY_SELECTION_REJECTED_ERROR_NAME;
}

export const TUNNEL_NOT_FOUND_ERROR_NAME = 'TunnelNotFoundError';

export class TunnelNotFoundError extends Error {
	constructor(tunnelId: string) {
		super(`[TunnelAgentHost] Tunnel ${tunnelId} not found`);
		this.name = TUNNEL_NOT_FOUND_ERROR_NAME;
	}
}

export function isTunnelNotFoundError(error: unknown): boolean {
	return error instanceof Error && error.name === TUNNEL_NOT_FOUND_ERROR_NAME;
}

export interface ITunnelConnectResult {
	readonly connectionId: string;
	readonly address: string;
	readonly name: string;
	readonly connectionToken: string;
	readonly selected: ITunnelGatewaySelectedInfo;
}

export interface ITunnelRelayMessage {
	readonly connectionId: string;
	readonly data: string;
}

export const ITunnelAgentHostMainService = createDecorator<ITunnelAgentHostMainService>('tunnelAgentHostMainService');

export interface ITunnelAgentHostMainService {
	readonly _serviceBrand: undefined;

	readonly onDidRelayMessage: Event<ITunnelRelayMessage>;

	readonly onDidRelayClose: Event<string >;

	listTunnels(token: string, authProvider: 'github' | 'microsoft', additionalTunnelNames?: string[]): Promise<ITunnelInfo[]>;

	deleteTunnel(token: string, authProvider: 'github' | 'microsoft', tunnelId: string, clusterId: string): Promise<void>;

	connect(token: string, authProvider: 'github' | 'microsoft', tunnelId: string, clusterId: string): Promise<ITunnelConnectResult>;

	prepareSelection(token: string, authProvider: 'github' | 'microsoft', tunnelId: string, clusterId: string): Promise<ITunnelGatewaySelectionSession | undefined>;

	completeSelection(selectionId: string, selection: ITunnelGatewaySelection): Promise<ITunnelConnectResult>;

	cancelSelection(selectionId: string): Promise<void>;

	relaySend(connectionId: string, message: string): Promise<void>;

	disconnect(connectionId: string): Promise<void>;
}

export interface ITunnelAgentHostService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeTunnels: Event<void>;

	listTunnels(options?: { silent?: boolean }): Promise<ITunnelInfo[]>;

	getAutoConnectMode(tunnel: ITunnelInfo): TunnelAutoConnectMode;

	connect(tunnel: ITunnelInfo, authProvider?: 'github' | 'microsoft', options?: { readonly userInitiated?: boolean }): Promise<void>;

	readonly canDeleteTunnels: boolean;

	deleteTunnel(tunnel: ITunnelInfo): Promise<void>;

	disconnect(address: string): Promise<void>;

	getCachedTunnels(): ICachedTunnel[];

	cacheTunnel(tunnel: ITunnelInfo, authProvider?: 'github' | 'microsoft'): void;

	removeCachedTunnel(tunnelId: string): void;

	isTunnelDismissed(tunnelId: string): boolean;

	dismissTunnel(tunnelId: string): void;

	clearTunnelDismissal(tunnelId: string): void;

	isAutoConnectSuppressed(tunnelId: string): boolean;

	suppressAutoConnect(tunnelId: string): void;

	clearAutoConnectSuppression(tunnelId: string): void;

	getAuthProvider(options?: { silent?: boolean }): Promise<'github' | 'microsoft' | undefined>;
}

export interface ITunnelHostInfo {
	readonly tunnelName: string;
	readonly tunnelId?: string;
	readonly clusterId?: string;
	readonly domain?: string;
	readonly viaRemoteTunnelAccess?: boolean;
}

export function isTunnelHosted(sharingInfo: ITunnelHostInfo | undefined, tunnel: Pick<ITunnelInfo, 'tunnelId' | 'name'>): boolean {
	if (!sharingInfo) {
		return false;
	}
	return sharingInfo.tunnelId !== undefined
		? sharingInfo.tunnelId === tunnel.tunnelId
		: sharingInfo.tunnelName === tunnel.name;
}
