/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import type { IObservable } from '../../../base/common/observable.js';
import { connectionTokenQueryName } from '../../../base/common/network.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ConfigurationTarget, type IConfigurationService } from '../../configuration/common/configuration.js';
import { StorageScope, StorageTarget, type IStorageService } from '../../storage/common/storage.js';
import type { IAgentConnection } from './agentService.js';
import type { UnsupportedProtocolVersionErrorData } from './state/protocol/errors.js';
import { AHP_UNSUPPORTED_PROTOCOL_VERSION, ProtocolError } from './state/sessionProtocol.js';
import { AgentHostTransportFailureReason } from './state/sessionTransport.js';
import { readUnsupportedProtocolVersionErrorMeta, type IVscodeUpgradeResult } from './state/protocolUpgrade.js';
import { TUNNEL_ADDRESS_PREFIX } from './tunnelAgentHost.js';
import { DEFAULT_RECONNECT_POLICY, type IRemoteAgentHostReconnectPolicy } from './reconnectPolicy.js';
import { normalizeRemoteAgentHostAddress } from './agentHostUri.js';
import { getGlobalConfigurationValue } from './agentHostConfigurationSync.js';
import type { SSHAgentHostLifecycle } from './sshRemoteAgentHost.js';
import type { AgentHostServerType } from './agentHostEndpointRegistry.js';

export type RemoteAgentHostConnectionStatus =
	| { readonly kind: 'connected' }
	| { readonly kind: 'connecting' }
	| {
		readonly kind: 'reconnecting';
		readonly nextAttemptAt?: number;
	}
	| { readonly kind: 'disconnected'; readonly reason: AgentHostTransportFailureReason }
	| {
		readonly kind: 'incompatible';
		readonly message: string;
		readonly supportedByClient: readonly string[];
		readonly offeredByServer?: readonly string[];
		readonly vscodeUpgradeMethod?: string;
	};

export namespace RemoteAgentHostConnectionStatus {
	export const connected: RemoteAgentHostConnectionStatus = Object.freeze({ kind: 'connected' });
	export const connecting: RemoteAgentHostConnectionStatus = Object.freeze({ kind: 'connecting' });
	export const reconnecting: RemoteAgentHostConnectionStatus = Object.freeze({ kind: 'reconnecting' });
	export function reconnectingUntil(nextAttemptAt: number | undefined): RemoteAgentHostConnectionStatus {
		return nextAttemptAt === undefined
			? reconnecting
			: Object.freeze({ kind: 'reconnecting', nextAttemptAt });
	}
	export const disconnected: RemoteAgentHostConnectionStatus = Object.freeze({ kind: 'disconnected', reason: AgentHostTransportFailureReason.Unknown });
	export function disconnectedBecause(reason: AgentHostTransportFailureReason): RemoteAgentHostConnectionStatus {
		return reason === AgentHostTransportFailureReason.Unknown
			? disconnected
			: Object.freeze({ kind: 'disconnected', reason });
	}
	export function incompatible(message: string, supportedByClient: readonly string[], offeredByServer?: readonly string[], vscodeUpgradeMethod?: string): RemoteAgentHostConnectionStatus {
		return Object.freeze({ kind: 'incompatible', message, supportedByClient, offeredByServer, vscodeUpgradeMethod });
	}
	export function isConnected(status: RemoteAgentHostConnectionStatus | undefined): boolean {
		return status?.kind === 'connected';
	}
	export function isConnecting(status: RemoteAgentHostConnectionStatus | undefined): boolean {
		return status?.kind === 'connecting';
	}
	export function isReconnecting(status: RemoteAgentHostConnectionStatus | undefined): boolean {
		return status?.kind === 'reconnecting';
	}
	export function isDisconnected(status: RemoteAgentHostConnectionStatus | undefined): boolean {
		return status?.kind === 'disconnected';
	}
	export function isIncompatible(status: RemoteAgentHostConnectionStatus | undefined): status is RemoteAgentHostConnectionStatus & { kind: 'incompatible' } {
		return status?.kind === 'incompatible';
	}
	export function isUnavailable(status: RemoteAgentHostConnectionStatus | undefined): boolean {
		return status?.kind !== 'connected';
	}
	export function fromConnectError(err: unknown, supportedByClient: readonly string[]): RemoteAgentHostConnectionStatus | undefined {
		if (err instanceof ProtocolError && err.code === AHP_UNSUPPORTED_PROTOCOL_VERSION) {
			const data = err.data as Partial<UnsupportedProtocolVersionErrorData> | undefined;
			const offeredByServer = Array.isArray(data?.supportedVersions) ? data.supportedVersions : undefined;
			const vscodeUpgradeMethod = readUnsupportedProtocolVersionErrorMeta(err.data)?.vscodeUpgradeMethod;
			return incompatible(err.message, supportedByClient, offeredByServer, vscodeUpgradeMethod);
		}
		return undefined;
	}
}

export const RemoteAgentHostsSettingId = 'chat.remoteAgentHosts';

export const RemoteAgentHostsEnabledSettingId = 'chat.remoteAgentHostsEnabled';

export const RemoteAgentHostAutoConnectSettingId = 'chat.remoteAgentHostsAutoConnect';

export const enum RemoteAgentHostEntryType {
	WebSocket = 'websocket',
	SSH = 'ssh',
	WSL = 'wsl',
	Tunnel = 'tunnel',
	CloudSandbox = 'cloudSandbox',
	DevContainer = 'devContainer',
}

export interface IRemoteAgentHostWebSocketConnection {
	readonly type: RemoteAgentHostEntryType.WebSocket;
	readonly address: string;
}

export interface IRemoteAgentHostSSHConnection {
	readonly type: RemoteAgentHostEntryType.SSH;
	readonly address: string;
	readonly sshConfigHost?: string;
	readonly hostName: string;
	readonly user?: string;
	readonly port?: number;
	readonly serverType?: AgentHostServerType;
	readonly instanceId?: string;
	readonly primary?: boolean;
	readonly lifecycle?: SSHAgentHostLifecycle;
}

export interface IRemoteAgentHostTunnelConnection {
	readonly type: RemoteAgentHostEntryType.Tunnel;
	readonly tunnelId: string;
	readonly clusterId: string;
	readonly label?: string;
	readonly authProvider?: 'github' | 'microsoft';
}

export interface IRemoteAgentHostWSLConnection {
	readonly type: RemoteAgentHostEntryType.WSL;
	readonly address: string;
	readonly distro: string;
}

export interface IRemoteAgentHostCloudSandboxConnection {
	readonly type: RemoteAgentHostEntryType.CloudSandbox;
	readonly address: string;
	readonly environmentId: string;
	readonly sessionId?: string;
}

export interface IRemoteAgentHostDevContainerConnection {
	readonly type: RemoteAgentHostEntryType.DevContainer;
	readonly address: string;
	readonly hostPath: string;
}

export type RemoteAgentHostConnection = IRemoteAgentHostWebSocketConnection | IRemoteAgentHostSSHConnection | IRemoteAgentHostWSLConnection | IRemoteAgentHostTunnelConnection | IRemoteAgentHostCloudSandboxConnection | IRemoteAgentHostDevContainerConnection;

export interface IRemoteAgentHostEntry {
	readonly name: string;
	readonly connectionToken?: string;
	readonly connection: RemoteAgentHostConnection;
}

export type RemoteAgentHostProtocolClientState = 'connecting' | 'incompatible' | 'connected' | 'reconnecting' | 'closed';

export interface IRemoteAgentHostProtocolClient extends IAgentConnection, IDisposable {
	readonly defaultDirectory: string | undefined;
	readonly nextReconnectAt: number | undefined;
	readonly onDidClose: Event<AgentHostTransportFailureReason | undefined>;
	readonly onDidChangeConnectionState: Event<RemoteAgentHostProtocolClientState>;
	readonly onDidScheduleReconnect: Event<void>;
	connect(): Promise<void>;
	reconnectNow(): boolean;
	notifyTransportClosed(): void;
	triggerVscodeUpgrade(method: string): Promise<IVscodeUpgradeResult>;
}

export interface IRemoteAgentHostConnectOptions {
	readonly userInitiated: boolean;
}

export interface IRemoteAgentHostCreatedConnection {
	readonly connection: IRemoteAgentHostProtocolClient;
	readonly transportDisposable?: IDisposable;
	readonly reconnectTransfersTransportOwnership?: boolean;
}

export interface IRemoteAgentHostConnectionFactory {
	readonly kind: RemoteAgentHostEntryType;
	readonly entries: IObservable<readonly IRemoteAgentHostEntry[]>;
	createConnection(entry: IRemoteAgentHostEntry, options: IRemoteAgentHostConnectOptions): Promise<IRemoteAgentHostCreatedConnection>;
}

export interface IRawRemoteAgentHostEntry {
	readonly address: string;
	readonly name: string;
	readonly connectionToken?: string;
	readonly sshConfigHost?: string;
	readonly sshHostName?: string;
	readonly sshUser?: string;
	readonly sshPort?: number;
	readonly sshServerType?: AgentHostServerType;
	readonly sshInstanceId?: string;
	readonly sshPrimary?: boolean;
	readonly sshLifecycle?: SSHAgentHostLifecycle;
}

export const SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY = 'remoteAgentHost.sshConnections';

export function isRawRemoteAgentHostEntry(value: unknown): value is IRawRemoteAgentHostEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Partial<Record<keyof IRawRemoteAgentHostEntry, unknown>>;
	return typeof candidate.address === 'string'
		&& typeof candidate.name === 'string'
		&& (candidate.connectionToken === undefined || typeof candidate.connectionToken === 'string')
		&& (candidate.sshConfigHost === undefined || typeof candidate.sshConfigHost === 'string')
		&& (candidate.sshHostName === undefined || typeof candidate.sshHostName === 'string')
		&& (candidate.sshUser === undefined || typeof candidate.sshUser === 'string')
		&& (candidate.sshPort === undefined || typeof candidate.sshPort === 'number')
		&& (candidate.sshServerType === undefined || candidate.sshServerType === 'editor' || candidate.sshServerType === 'standalone')
		&& (candidate.sshInstanceId === undefined || typeof candidate.sshInstanceId === 'string')
		&& (candidate.sshPrimary === undefined || typeof candidate.sshPrimary === 'boolean')
		&& (candidate.sshLifecycle === undefined || candidate.sshLifecycle === 'managed' || candidate.sshLifecycle === 'external');
}

export function isLegacySshRawEntry(entry: IRawRemoteAgentHostEntry): boolean {
	return entry.sshConfigHost !== undefined
		|| entry.sshHostName !== undefined
		|| entry.sshUser !== undefined
		|| entry.sshPort !== undefined;
}

export type RemoteAgentHostEntryStore = 'settings' | 'storage' | 'runtime';

interface IRemoteAgentHostEntryTypeConfigBase<TConnection extends RemoteAgentHostConnection> {
	readonly type: TConnection['type'];
	readonly dialedFromEntries: boolean;
	readonly autoConnectGated?: boolean;
	readonly normalizedAddress: boolean;
	readonly reconnect: IRemoteAgentHostReconnectPolicy;
	address(connection: TConnection): string;
}

export interface IPersistedEntryTypeConfig<TConnection extends RemoteAgentHostConnection = RemoteAgentHostConnection> extends IRemoteAgentHostEntryTypeConfigBase<TConnection> {
	readonly store: 'settings' | 'storage';
	toRaw(entry: IRemoteAgentHostEntry, connection: TConnection): IRawRemoteAgentHostEntry;
	fromRaw(raw: IRawRemoteAgentHostEntry): IRemoteAgentHostEntry;
}

interface IRuntimeEntryTypeConfig<TConnection extends RemoteAgentHostConnection = RemoteAgentHostConnection> extends IRemoteAgentHostEntryTypeConfigBase<TConnection> {
	readonly store: 'runtime';
	readonly toRaw?: never;
	readonly fromRaw?: never;
}

export type IRemoteAgentHostEntryTypeConfig<TConnection extends RemoteAgentHostConnection = RemoteAgentHostConnection> =
	IPersistedEntryTypeConfig<TConnection> | IRuntimeEntryTypeConfig<TConnection>;

export const WEBSOCKET_ENTRY_TYPE_CONFIG: IPersistedEntryTypeConfig<IRemoteAgentHostWebSocketConnection> = {
	type: RemoteAgentHostEntryType.WebSocket,
	store: 'settings',
	dialedFromEntries: true,
	autoConnectGated: false,
	normalizedAddress: true,
	reconnect: DEFAULT_RECONNECT_POLICY,
	address: connection => connection.address,
	toRaw: (entry, connection) => ({
		address: connection.address, name: entry.name, connectionToken: entry.connectionToken,
	}),
	fromRaw: raw => ({ name: raw.name, connectionToken: raw.connectionToken, connection: { type: RemoteAgentHostEntryType.WebSocket, address: raw.address } }),
};

export const SSH_ENTRY_TYPE_CONFIG: IPersistedEntryTypeConfig<IRemoteAgentHostSSHConnection> = {
	type: RemoteAgentHostEntryType.SSH,
	store: 'storage',
	dialedFromEntries: true,
	autoConnectGated: true,
	normalizedAddress: true,
	reconnect: DEFAULT_RECONNECT_POLICY,
	address: connection => connection.address,
	toRaw: (entry, connection) => ({
		address: connection.address, name: entry.name, connectionToken: entry.connectionToken,
		sshConfigHost: connection.sshConfigHost, sshHostName: connection.hostName, sshUser: connection.user, sshPort: connection.port,
		sshServerType: connection.serverType, sshInstanceId: connection.instanceId, sshPrimary: connection.primary, sshLifecycle: connection.lifecycle,
	}),
	fromRaw: raw => ({
		name: raw.name, connectionToken: raw.connectionToken,
		connection: {
			type: RemoteAgentHostEntryType.SSH,
			address: raw.address,
			sshConfigHost: raw.sshConfigHost,
			hostName: raw.sshHostName ?? raw.address,
			user: raw.sshUser,
			port: raw.sshPort,
			...(raw.sshServerType ? { serverType: raw.sshServerType } : undefined),
			...(raw.sshInstanceId ? { instanceId: raw.sshInstanceId } : undefined),
			...(raw.sshPrimary !== undefined ? { primary: raw.sshPrimary } : undefined),
			...(raw.sshLifecycle ? { lifecycle: raw.sshLifecycle } : undefined),
		},
	}),
};

export interface IRemoteAgentHostSettings {
	readonly target: ConfigurationTarget;
	readonly entries: readonly IRawRemoteAgentHostEntry[];
}

function entryAddressKey(entry: IRemoteAgentHostEntry): string {
	const config = getEntryTypeConfig(entry.connection.type);
	const address = config.address(entry.connection);
	return config.normalizedAddress ? normalizeRemoteAgentHostAddress(address) : address;
}

export function upsertRemoteAgentHostEntry(entries: readonly IRemoteAgentHostEntry[], entry: IRemoteAgentHostEntry): IRemoteAgentHostEntry[] {
	const address = entryAddressKey(entry);
	const existingIndex = entries.findIndex(candidate => entryAddressKey(candidate) === address);
	return existingIndex === -1
		? [...entries, entry]
		: entries.map((candidate, index) => index === existingIndex ? entry : candidate);
}

export function toRawEntriesOfKind(entries: readonly IRemoteAgentHostEntry[], config: IPersistedEntryTypeConfig): IRawRemoteAgentHostEntry[] {
	const raw: IRawRemoteAgentHostEntry[] = [];
	for (const entry of entries) {
		if (entry.connection.type === config.type) {
			raw.push(config.toRaw(entry, entry.connection));
		}
	}
	return raw;
}

export function readRemoteAgentHostSettings(configurationService: IConfigurationService): IRemoteAgentHostSettings {
	const inspected = configurationService.inspect<IRawRemoteAgentHostEntry[]>(RemoteAgentHostsSettingId);
	const target = inspected.userLocalValue !== undefined
		? ConfigurationTarget.USER_LOCAL
		: inspected.userRemoteValue !== undefined
			? ConfigurationTarget.USER_REMOTE
			: ConfigurationTarget.USER;
	return {
		target,
		entries: target === ConfigurationTarget.USER_LOCAL
			? inspected.userLocalValue ?? []
			: target === ConfigurationTarget.USER_REMOTE
				? inspected.userRemoteValue ?? []
				: inspected.userValue ?? [],
	};
}

/** Reads WebSocket entries from the global configuration or its owning target. */
export function readWebSocketRemoteAgentHostEntries(configurationService: IConfigurationService, targetOnly = false): IRemoteAgentHostEntry[] {
	const entries = targetOnly
		? readRemoteAgentHostSettings(configurationService).entries
		: getGlobalConfigurationValue<IRawRemoteAgentHostEntry[]>(configurationService, RemoteAgentHostsSettingId) ?? [];
	return entries
		.filter(isRawRemoteAgentHostEntry)
		.filter(entry => !isLegacySshRawEntry(entry))
		.map(entry => WEBSOCKET_ENTRY_TYPE_CONFIG.fromRaw(entry));
}

async function storeWebSocketRemoteAgentHostEntries(configurationService: IConfigurationService, entries: readonly IRemoteAgentHostEntry[]): Promise<void> {
	const settings = readRemoteAgentHostSettings(configurationService);
	const preservedEntries = settings.entries.filter(entry => !isRawRemoteAgentHostEntry(entry) || isLegacySshRawEntry(entry));
	const rawEntries = [
		...preservedEntries,
		...toRawEntriesOfKind(entries, WEBSOCKET_ENTRY_TYPE_CONFIG),
	];
	if (JSON.stringify(settings.entries) !== JSON.stringify(rawEntries)) {
		await configurationService.updateValue(RemoteAgentHostsSettingId, rawEntries, settings.target);
	}
}

export async function addWebSocketRemoteAgentHostEntry(configurationService: IConfigurationService, entry: IRemoteAgentHostEntry): Promise<void> {
	if (entry.connection.type !== RemoteAgentHostEntryType.WebSocket) {
		throw new Error(`Expected a WebSocket remote agent host entry, got ${entry.connection.type}.`);
	}
	const normalizedEntry: IRemoteAgentHostEntry = {
		...entry,
		connection: { ...entry.connection, address: normalizeRemoteAgentHostAddress(entry.connection.address) },
	};
	await storeWebSocketRemoteAgentHostEntries(configurationService, upsertRemoteAgentHostEntry(readWebSocketRemoteAgentHostEntries(configurationService, true), normalizedEntry));
}

export async function removeWebSocketRemoteAgentHostEntry(configurationService: IConfigurationService, address: string): Promise<void> {
	const normalizedAddress = normalizeRemoteAgentHostAddress(address);
	await storeWebSocketRemoteAgentHostEntries(
		configurationService,
		readWebSocketRemoteAgentHostEntries(configurationService, true).filter(entry => entryAddressKey(entry) !== normalizedAddress),
	);
}

export function readSSHRemoteAgentHostEntries(storageService: IStorageService): IRemoteAgentHostEntry[] {
	const raw = storageService.get(SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY, StorageScope.APPLICATION);
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter(isRawRemoteAgentHostEntry).filter(isLegacySshRawEntry).map(entry => SSH_ENTRY_TYPE_CONFIG.fromRaw(entry))
			: [];
	} catch {
		return [];
	}
}

export function storeSSHRemoteAgentHostEntries(storageService: IStorageService, entries: readonly IRemoteAgentHostEntry[]): void {
	const rawEntries = toRawEntriesOfKind(entries, SSH_ENTRY_TYPE_CONFIG);
	const raw = JSON.stringify(rawEntries);
	const stored = storageService.get(SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY, StorageScope.APPLICATION);
	if (stored === raw) {
		return;
	}
	if (rawEntries.length === 0) {
		if (stored !== undefined) {
			storageService.remove(SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY, StorageScope.APPLICATION);
		}
		return;
	}
	storageService.store(SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY, raw, StorageScope.APPLICATION, StorageTarget.USER);
}

export function addSSHRemoteAgentHostEntry(storageService: IStorageService, entry: IRemoteAgentHostEntry): void {
	if (entry.connection.type !== RemoteAgentHostEntryType.SSH) {
		throw new Error(`Expected an SSH remote agent host entry, got ${entry.connection.type}.`);
	}
	storeSSHRemoteAgentHostEntries(storageService, upsertRemoteAgentHostEntry(readSSHRemoteAgentHostEntries(storageService), entry));
}

export function removeSSHRemoteAgentHostEntry(storageService: IStorageService, address: string): void {
	const normalizedAddress = normalizeRemoteAgentHostAddress(address);
	storeSSHRemoteAgentHostEntries(
		storageService,
		readSSHRemoteAgentHostEntries(storageService).filter(entry => entryAddressKey(entry) !== normalizedAddress),
	);
}

function runtimeEntryTypeConfig<TConnection extends RemoteAgentHostConnection>(type: TConnection['type'], normalizedAddress: boolean, address: (connection: TConnection) => string, reconnect: IRemoteAgentHostReconnectPolicy = DEFAULT_RECONNECT_POLICY): IRuntimeEntryTypeConfig<TConnection> {
	return { type, store: 'runtime', dialedFromEntries: false, normalizedAddress, reconnect, address };
}

const WSL_ENTRY_TYPE_CONFIG: IRemoteAgentHostEntryTypeConfig<IRemoteAgentHostWSLConnection> = {
	...runtimeEntryTypeConfig<IRemoteAgentHostWSLConnection>(RemoteAgentHostEntryType.WSL, true, connection => connection.address),
	dialedFromEntries: true,
	autoConnectGated: true,
};
const TUNNEL_ENTRY_TYPE_CONFIG: IRemoteAgentHostEntryTypeConfig<IRemoteAgentHostTunnelConnection> = {
	...runtimeEntryTypeConfig<IRemoteAgentHostTunnelConnection>(RemoteAgentHostEntryType.Tunnel, false, connection => `${TUNNEL_ADDRESS_PREFIX}${connection.tunnelId}`),
	dialedFromEntries: true,
	autoConnectGated: true,
};
const CLOUD_SANDBOX_ENTRY_TYPE_CONFIG = runtimeEntryTypeConfig<IRemoteAgentHostCloudSandboxConnection>(RemoteAgentHostEntryType.CloudSandbox, true, connection => connection.address);
const DEV_CONTAINER_RECONNECT_POLICY: IRemoteAgentHostReconnectPolicy = {
	autoRestore: true,
	initialDelayMs: 2000,
	maxDelayMs: 60_000,
	maxAttempts: 3,
};
const DEV_CONTAINER_ENTRY_TYPE_CONFIG = runtimeEntryTypeConfig<IRemoteAgentHostDevContainerConnection>(RemoteAgentHostEntryType.DevContainer, true, connection => connection.address, DEV_CONTAINER_RECONNECT_POLICY);

const ENTRY_TYPE_CONFIGS: { readonly [K in RemoteAgentHostEntryType]: IRemoteAgentHostEntryTypeConfig<Extract<RemoteAgentHostConnection, { type: K }>> } = {
	[RemoteAgentHostEntryType.WebSocket]: WEBSOCKET_ENTRY_TYPE_CONFIG,
	[RemoteAgentHostEntryType.SSH]: SSH_ENTRY_TYPE_CONFIG,
	[RemoteAgentHostEntryType.WSL]: WSL_ENTRY_TYPE_CONFIG,
	[RemoteAgentHostEntryType.Tunnel]: TUNNEL_ENTRY_TYPE_CONFIG,
	[RemoteAgentHostEntryType.CloudSandbox]: CLOUD_SANDBOX_ENTRY_TYPE_CONFIG,
	[RemoteAgentHostEntryType.DevContainer]: DEV_CONTAINER_ENTRY_TYPE_CONFIG,
};

export function getEntryTypeConfig(type: RemoteAgentHostEntryType): IRemoteAgentHostEntryTypeConfig {
	return ENTRY_TYPE_CONFIGS[type] as IRemoteAgentHostEntryTypeConfig;
}

export function getEntryAddress(entry: IRemoteAgentHostEntry): string {
	return getEntryTypeConfig(entry.connection.type).address(entry.connection);
}

export function remoteAgentHostLogOutputChannelId(address: string): string {
	return `agentHost.otlp.${address}`;
}

export const AGENT_HOST_LOG_OUTPUT_CHANNEL_ID = 'agenthost';

export const enum RemoteAgentHostInputValidationError {
	Empty = 'empty',
	Invalid = 'invalid',
}

export interface IParsedRemoteAgentHostInput {
	readonly address: string;
	readonly connectionToken?: string;
	readonly suggestedName: string;
}

export type RemoteAgentHostInputParseResult =
	| { readonly parsed: IParsedRemoteAgentHostInput; readonly error?: undefined }
	| { readonly parsed?: undefined; readonly error: RemoteAgentHostInputValidationError };

export const IRemoteAgentHostService = createDecorator<IRemoteAgentHostService>('remoteAgentHostService');

export interface IRemoteAgentHostService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConnections: Event<void>;

	readonly connections: readonly IRemoteAgentHostConnectionInfo[];

	readonly configuredEntries: readonly IRemoteAgentHostEntry[];

	registerConnectionFactory(factory: IRemoteAgentHostConnectionFactory): IDisposable;

	getConnection(address: string): IAgentConnection | undefined;

	getConnectionByAuthority(authority: string): IAgentConnection | undefined;

	waitForConnection(address: string): Promise<IRemoteAgentHostConnectionInfo>;

	removeRemoteAgentHost(address: string): Promise<void>;

	reconnect(address: string, userInitiated?: boolean): void;
	reconnectNow(address: string): void;

	notifyConnectionClosed(address: string): void;

	getEntryByAddress(address: string): IRemoteAgentHostEntry | undefined;

	triggerServerUpgrade(address: string, method: string): Promise<IVscodeUpgradeResult>;
}

export interface IRemoteAgentHostConnectionInfo {
	readonly address: string;
	readonly name: string;
	readonly clientId?: string;
	readonly defaultDirectory?: string;
	readonly status: RemoteAgentHostConnectionStatus;
}

export class NullRemoteAgentHostService implements IRemoteAgentHostService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeConnections = Event.None;
	readonly connections: readonly IRemoteAgentHostConnectionInfo[] = [];
	readonly configuredEntries: readonly IRemoteAgentHostEntry[] = [];
	registerConnectionFactory(): IDisposable {
		throw new Error('Remote agent host connections are not supported in this environment.');
	}
	getConnection(): IAgentConnection | undefined { return undefined; }
	getConnectionByAuthority(): IAgentConnection | undefined { return undefined; }
	async waitForConnection(): Promise<IRemoteAgentHostConnectionInfo> {
		throw new Error('Remote agent host connections are not supported in this environment.');
	}
	async removeRemoteAgentHost(_address: string): Promise<void> { }
	reconnect(_address: string, _userInitiated?: boolean): void { }
	reconnectNow(_address: string): void { }
	notifyConnectionClosed(_address: string): void { }
	getEntryByAddress(): IRemoteAgentHostEntry | undefined { return undefined; }
	async triggerServerUpgrade(): Promise<IVscodeUpgradeResult> {
		throw new Error('Remote agent host connections are not supported in this environment.');
	}
}

export function parseRemoteAgentHostInput(input: string): RemoteAgentHostInputParseResult {
	const trimmedInput = input.trim();
	if (!trimmedInput) {
		return { error: RemoteAgentHostInputValidationError.Empty };
	}

	const candidate = extractRemoteAgentHostCandidate(trimmedInput);
	if (!candidate) {
		return { error: RemoteAgentHostInputValidationError.Invalid };
	}

	const hasExplicitScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(candidate);
	try {
		const url = new URL(hasExplicitScheme ? candidate : `ws://${candidate}`);
		const normalizedProtocol = normalizeRemoteAgentHostProtocol(url.protocol);
		if (!normalizedProtocol || !url.host) {
			return { error: RemoteAgentHostInputValidationError.Invalid };
		}

		const connectionToken = url.searchParams.get(connectionTokenQueryName) ?? undefined;
		url.searchParams.delete(connectionTokenQueryName);

		const address = formatRemoteAgentHostAddress(url, normalizedProtocol === 'wss:' ? normalizedProtocol : undefined);
		if (!address) {
			return { error: RemoteAgentHostInputValidationError.Invalid };
		}

		return {
			parsed: {
				address,
				connectionToken,
				suggestedName: url.host,
			},
		};
	} catch {
		return { error: RemoteAgentHostInputValidationError.Invalid };
	}
}

function extractRemoteAgentHostCandidate(input: string): string | undefined {
	const urlMatch = input.match(/(?<url>(?:https?|wss?):\/\/\S+)/i);
	const candidate = urlMatch?.groups?.url ?? input;
	const trimmedCandidate = candidate.trim().replace(/[),.;\]]+$/, '');
	return trimmedCandidate || undefined;
}

function normalizeRemoteAgentHostProtocol(protocol: string): 'ws:' | 'wss:' | undefined {
	switch (protocol.toLowerCase()) {
		case 'ws:':
		case 'http:':
			return 'ws:';
		case 'wss:':
		case 'https:':
			return 'wss:';
		default:
			return undefined;
	}
}

function formatRemoteAgentHostAddress(url: URL, protocol: 'ws:' | 'wss:' | undefined): string | undefined {
	if (!url.host) {
		return undefined;
	}

	const path = url.pathname !== '/' ? url.pathname : '';
	const query = url.search;
	const base = protocol ? `${protocol}//${url.host}` : url.host;
	return `${base}${path}${query}`;
}

export function parseLegacyRawEntry(raw: IRawRemoteAgentHostEntry): IRemoteAgentHostEntry {
	if (raw.sshConfigHost !== undefined || raw.sshHostName !== undefined || raw.sshUser !== undefined || raw.sshPort !== undefined) {
		return SSH_ENTRY_TYPE_CONFIG.fromRaw(raw);
	}
	return WEBSOCKET_ENTRY_TYPE_CONFIG.fromRaw(raw);
}
