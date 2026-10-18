/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Emitter } from '../../../base/common/event.js';
import { isCancellationError } from '../../../base/common/errors.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { DeferredPromise, raceTimeout } from '../../../base/common/async.js';
import { autorun, derived, IObservable, observableValue } from '../../../base/common/observable.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ILabelService } from '../../label/common/label.js';
import { ILogService } from '../../log/common/log.js';
import { observableConfigValue } from '../../observable/common/platformObservableUtils.js';
import { hasKey } from '../../../base/common/types.js';

import { AgentHostAhpJsonlLoggingSettingId, type IAgentConnection } from '../common/agentService.js';
import {
	IRemoteAgentHostService,
	RemoteAgentHostConnectionStatus,
	RemoteAgentHostAutoConnectSettingId,
	RemoteAgentHostsEnabledSettingId,
	RemoteAgentHostsSettingId,
	WEBSOCKET_ENTRY_TYPE_CONFIG,
	getEntryTypeConfig,
	isLegacySshRawEntry,
	isRawRemoteAgentHostEntry,
	type IRemoteAgentHostConnectionFactory,
	type IRemoteAgentHostConnectionInfo,
	type IRemoteAgentHostConnectOptions,
	type IRemoteAgentHostCreatedConnection,
	type IRemoteAgentHostEntry,
	type IRawRemoteAgentHostEntry,
	type IRemoteAgentHostProtocolClient,
	RemoteAgentHostEntryType,
} from '../common/remoteAgentHostService.js';
import { computeReconnectDelay, hasExhaustedReconnectAttempts } from '../common/reconnectPolicy.js';
import { AgentHostTransportFailureReason, NonReconnectableTransportError } from '../common/state/sessionTransport.js';
import { AgentHostProtocolClient, InitialAuthenticationError } from './agentHostProtocolClient.js';
import { WebSocketClientTransport } from './webSocketClientTransport.js';
import { AGENT_HOST_LABEL_FORMATTER, AGENT_HOST_SCHEME, agentHostAuthority, normalizeRemoteAgentHostAddress } from '../common/agentHostUri.js';
import { PROTOCOL_VERSION } from '../common/state/protocol/version/registry.js';
import { type IVscodeUpgradeResult } from '../common/state/protocolUpgrade.js';
import { editorWindowAgentHostClientInfo } from '../common/agentHostClientInfo.js';

interface IConnectionEntry {
	readonly store: DisposableStore;
	client?: IRemoteAgentHostProtocolClient;
	readonly transportDisposable?: IDisposable;
	readonly reconnectTransfersTransportOwnership: boolean;
	connected: boolean;
	status: RemoteAgentHostConnectionStatus;
}

function disposeEntry(entry: IConnectionEntry): void {
	entry.store.dispose();
	entry.transportDisposable?.dispose();
}

function isTerminalConnectError(err: unknown): boolean {
	return err instanceof NonReconnectableTransportError || isCancellationError(err);
}

class WebSocketConnectionFactory extends Disposable implements IRemoteAgentHostConnectionFactory {
	readonly kind = RemoteAgentHostEntryType.WebSocket;
	readonly entries: IObservable<readonly IRemoteAgentHostEntry[]>;
	private readonly _rawEntries: IObservable<readonly IRawRemoteAgentHostEntry[]>;

	constructor(
		private readonly _instantiationService: IInstantiationService,
		private readonly _configurationService: IConfigurationService,
		private readonly _environmentService: IEnvironmentService,
		private readonly _clientInfo: () => typeof editorWindowAgentHostClientInfo,
	) {
		super();
		this._rawEntries = observableConfigValue<readonly IRawRemoteAgentHostEntry[]>(
			RemoteAgentHostsSettingId,
			[],
			this._configurationService,
		);
		this.entries = derived(this, reader => this._rawEntries.read(reader)
			.filter(isRawRemoteAgentHostEntry)
			.filter(entry => !isLegacySshRawEntry(entry))
			.map(entry => WEBSOCKET_ENTRY_TYPE_CONFIG.fromRaw(entry))
		);
	}

	createConnection(entry: IRemoteAgentHostEntry, _options: IRemoteAgentHostConnectOptions): Promise<IRemoteAgentHostCreatedConnection> {
		if (entry.connection.type !== RemoteAgentHostEntryType.WebSocket) {
			throw new Error(`WebSocket factory cannot create a ${entry.connection.type} connection.`);
		}

		const address = entry.connection.address;
		const ahpLoggingEnabled = !!this._configurationService.getValue<boolean>(AgentHostAhpJsonlLoggingSettingId);
		const transportFactory = () => this._instantiationService.createInstance(
			WebSocketClientTransport,
			address,
			entry.connectionToken,
			ahpLoggingEnabled
				? { logsHome: this._environmentService.logsHome, connectionId: address, transport: 'websocket' }
				: undefined,
		);
		const connection = this._instantiationService.createInstance(AgentHostProtocolClient, address, transportFactory, { clientInfo: this._clientInfo() });
		return Promise.resolve({ connection });
	}

}

export class RemoteAgentHostService extends Disposable implements IRemoteAgentHostService {
	private static readonly ConnectionWaitTimeout = 10000;
	private static readonly UpgradeRequestTimeout = 5 * 60 * 1000;

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnections = this._register(new Emitter<void>());
	readonly onDidChangeConnections = this._onDidChangeConnections.event;

	private readonly _entries = new Map<string, IConnectionEntry>();
	private readonly _connectionFactories = new Map<RemoteAgentHostEntryType, IRemoteAgentHostConnectionFactory>();
	private readonly _connectionFactoriesObservable = observableValue(this, [] as readonly IRemoteAgentHostConnectionFactory[]);
	private readonly _remoteAgentHostsEnabled: IObservable<boolean>;
	private readonly _remoteAgentHostsAutoConnect: IObservable<boolean>;
	private readonly _configuredEntries = derived(this, reader => {
		let entries: IRemoteAgentHostEntry[] = [];
		for (const factory of this._connectionFactoriesObservable.read(reader)) {
			for (const entry of factory.entries.read(reader)) {
				entries = this._upsertEntry(entries, entry);
			}
		}
		return entries;
	});
	private readonly _pendingConnects = new Map<string, Promise<void>>();
	private readonly _names = new Map<string, string>();
	private readonly _tokens = new Map<string, string | undefined>();
	private readonly _pendingConnectionWaits = new Map<string, DeferredPromise<IRemoteAgentHostConnectionInfo>>();
	private readonly _failedReconnects = new Map<string, Error>();
	private readonly _reconnectTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly _reconnectAttempts = new Map<string, number>();
	private readonly _labelFormatters = new Map<string, IDisposable>();

	protected get clientInfo() {
		return editorWindowAgentHostClientInfo;
	}

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@ILabelService private readonly _labelService: ILabelService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
	) {
		super();

		this._remoteAgentHostsEnabled = observableConfigValue(RemoteAgentHostsEnabledSettingId, true, this._configurationService);
		this._remoteAgentHostsAutoConnect = observableConfigValue(RemoteAgentHostAutoConnectSettingId, true, this._configurationService);

		this._register(this.registerConnectionFactory(this._register(new WebSocketConnectionFactory(
			this._instantiationService,
			this._configurationService,
			this._environmentService,
			() => this.clientInfo,
		))));
		this._register(autorun(reader => {
			this._configuredEntries.read(reader);
			this._remoteAgentHostsEnabled.read(reader);
			this._remoteAgentHostsAutoConnect.read(reader);
			this._reconcileConnections();
		}));

	}

	private _entryAddress(entry: IRemoteAgentHostEntry): string {
		const config = getEntryTypeConfig(entry.connection.type);
		const address = config.address(entry.connection);
		return config.normalizedAddress ? normalizeRemoteAgentHostAddress(address) : address;
	}

	private _normalizeEntry(entry: IRemoteAgentHostEntry): IRemoteAgentHostEntry {
		const config = getEntryTypeConfig(entry.connection.type);
		if (!config.normalizedAddress || !hasKey(entry.connection, { address: true })) {
			return entry;
		}
		return { ...entry, connection: { ...entry.connection, address: normalizeRemoteAgentHostAddress(entry.connection.address) } };
	}

	get connections(): readonly IRemoteAgentHostConnectionInfo[] {
		const result: IRemoteAgentHostConnectionInfo[] = [];
		for (const [address, entry] of this._entries) {
			result.push({
				address,
				name: this._names.get(address) ?? address,
				clientId: entry.client?.clientId,
				defaultDirectory: entry.client?.defaultDirectory,
				status: entry.status,
			});
		}
		return result;
	}

	get configuredEntries(): readonly IRemoteAgentHostEntry[] {
		return this._configuredEntries.get().map(entry => this._normalizeEntry(entry));
	}

	registerConnectionFactory(factory: IRemoteAgentHostConnectionFactory): IDisposable {
		if (this._connectionFactories.has(factory.kind)) {
			throw new Error(`A remote agent host connection factory is already registered for ${factory.kind}.`);
		}

		this._connectionFactories.set(factory.kind, factory);
		this._connectionFactoriesObservable.set([...this._connectionFactories.values()], undefined);
		return toDisposable(() => {
			if (this._connectionFactories.get(factory.kind) === factory) {
				this._connectionFactories.delete(factory.kind);
				this._connectionFactoriesObservable.set([...this._connectionFactories.values()], undefined);
			}
		});
	}

	getConnection(address: string): IAgentConnection | undefined {
		const normalized = normalizeRemoteAgentHostAddress(address);
		const entry = this._entries.get(normalized);
		return entry?.connected ? entry.client : undefined;
	}

	getConnectionByAuthority(authority: string): IAgentConnection | undefined {
		for (const [address, entry] of this._entries) {
			if (entry.connected && agentHostAuthority(address) === authority) {
				return entry.client;
			}
		}
		return undefined;
	}

	getEntryByAddress(address: string): IRemoteAgentHostEntry | undefined {
		const normalized = normalizeRemoteAgentHostAddress(address);
		return this.configuredEntries.find(
			entry => this._entryAddress(entry) === normalized
		);
	}

	async triggerServerUpgrade(address: string, method: string): Promise<IVscodeUpgradeResult> {
		const normalized = normalizeRemoteAgentHostAddress(address);
		const client = this._entries.get(normalized)?.client;
		if (!client) {
			throw new Error(`No usable remote agent host client found for ${address}.`);
		}
		const result = await raceTimeout(
			client.triggerVscodeUpgrade(method),
			RemoteAgentHostService.UpgradeRequestTimeout,
		);
		if (result === undefined) {
			throw new Error(`Server upgrade request timed out after ${RemoteAgentHostService.UpgradeRequestTimeout}ms.`);
		}
		return result;
	}

	reconnect(address: string, userInitiated = true): void {
		if (this._store.isDisposed) {
			return;
		}
		const normalized = normalizeRemoteAgentHostAddress(address);
		if (this._pendingConnects.has(normalized)) {
			if (userInitiated) {
				this._failedReconnects.delete(normalized);
				this._cancelReconnect(normalized);
				this._reconnectAttempts.delete(normalized);
			}
			return;
		}
		this._failedReconnects.delete(normalized);

		const configuredEntry = this._configuredEntries.get().find(
			entry => this._entryAddress(entry) === normalized
		);
		if (!configuredEntry) {
			this._failedReconnects.set(normalized, new Error(`No remote agent host entry is staged for ${normalized}.`));
			return;
		}
		if (!this._connectionFactories.has(configuredEntry.connection.type)) {
			this._failedReconnects.set(normalized, new Error(`No connection factory is registered for ${configuredEntry.connection.type}.`));
			return;
		}

		const entryToReconnect = {
			...configuredEntry,
			connectionToken: this._tokens.get(normalized) ?? configuredEntry.connectionToken,
		};

		this._cancelReconnect(normalized);
		if (userInitiated) {
			this._reconnectAttempts.delete(normalized);
		}

		const entry = this._entries.get(normalized);
		if (entry) {
			this._entries.delete(normalized);
			entry.store.dispose();
			if (!entry.reconnectTransfersTransportOwnership) {
				entry.transportDisposable?.dispose();
			}
			this._onDidChangeConnections.fire();
		}

		void this._connectTo(entryToReconnect, { userInitiated });
	}

	reconnectNow(address: string): void {
		const normalized = normalizeRemoteAgentHostAddress(address);
		if (this._entries.get(normalized)?.client?.reconnectNow()) {
			return;
		}
		this.reconnect(normalized, true);
	}

	async waitForConnection(address: string): Promise<IRemoteAgentHostConnectionInfo> {
		if (this._store.isDisposed) {
			throw new Error('Remote agent host service is disposed.');
		}
		if (!this._remoteAgentHostsEnabled.get()) {
			throw new Error('Remote agent host connections are not enabled.');
		}

		const normalizedAddress = normalizeRemoteAgentHostAddress(address);
		const existingConnection = this._getConnectionInfo(normalizedAddress);
		if (existingConnection) {
			return existingConnection;
		}
		const reconnectFailure = this._failedReconnects.get(normalizedAddress);
		if (reconnectFailure) {
			throw reconnectFailure;
		}

		const wait = this._getOrCreateConnectionWait(normalizedAddress);

		const pendingConnect = this._pendingConnects.get(normalizedAddress);
		if (pendingConnect) {
			await pendingConnect;
			const connected = this._getConnectionInfo(normalizedAddress);
			if (connected) {
				return connected;
			}
			return wait.p;
		}

		const connection = await raceTimeout(wait.p, RemoteAgentHostService.ConnectionWaitTimeout, () => {
			this._pendingConnectionWaits.delete(normalizedAddress);
		});
		if (!connection) {
			throw new Error(`Timed out connecting to ${normalizedAddress}`);
		}

		return connection;
	}

	async removeRemoteAgentHost(address: string): Promise<void> {
		const normalized = normalizeRemoteAgentHostAddress(address);
		this._names.delete(normalized);
		this._tokens.delete(normalized);
		this._failedReconnects.delete(normalized);
		this._clearHostLabelFormatter(normalized);
		this._cancelReconnect(normalized);
		this._reconnectAttempts.delete(normalized);
		this._removeConnection(normalized);
	}

	private _removeConnection(address: string): void {
		const entry = this._entries.get(address);
		if (entry) {
			this._entries.delete(address);
			disposeEntry(entry);
			this._rejectPendingConnectionWait(address, new Error(`Connection closed: ${address}`));
			this._onDidChangeConnections.fire();
		}
	}

	notifyConnectionClosed(address: string): void {
		const normalized = normalizeRemoteAgentHostAddress(address);
		const entry = this._entries.get(normalized);
		if (entry?.client) {
			this._logService.info(`[RemoteAgentHost] notifyConnectionClosed: notifying protocol client for ${normalized}`);
			entry.client.notifyTransportClosed();
		} else {
			this._logService.info(`[RemoteAgentHost] notifyConnectionClosed: no active client found for ${normalized}`);
		}
	}

	private _reconcileConnections(): void {
		if (this._store.isDisposed) {
			return;
		}

		if (!this._remoteAgentHostsEnabled.get()) {
			for (const address of [...this._entries.keys()]) {
				this._cancelReconnect(address);
				this._removeConnection(address);
			}
			this._names.clear();
			this._tokens.clear();
			this._reconnectAttempts.clear();
			for (const address of [...this._labelFormatters.keys()]) {
				this._clearHostLabelFormatter(address);
			}
			return;
		}

		const configuredEntries = this._configuredEntries.get();
		const entriesWithAddress = configuredEntries.map(entry => ({ entry, address: this._entryAddress(entry) }));
		const desired = new Set(entriesWithAddress.map(e => e.address));

		this._logService.info(`[RemoteAgentHost] Reconciling: desired=[${[...desired].join(', ')}], current=[${[...this._entries.keys()].map(a => `${a}(${this._entries.get(a)!.connected ? 'connected' : 'pending'})`).join(', ')}]`);

		let namesChanged = false;
		const oldNames = new Map(this._names);
		this._names.clear();
		this._tokens.clear();
		for (const { entry, address } of entriesWithAddress) {
			this._names.set(address, entry.name);
			this._tokens.set(address, entry.connectionToken);
			this._updateHostLabelFormatter(address, entry.name);
			if (this._entries.has(address) && oldNames.get(address) !== entry.name) {
				namesChanged = true;
			}
		}

		for (const address of [...this._labelFormatters.keys()]) {
			if (!desired.has(address)) {
				this._clearHostLabelFormatter(address);
			}
		}

		for (const address of [...this._entries.keys()]) {
			if (!desired.has(address)) {
				this._logService.info(`[RemoteAgentHost] Disconnecting from ${address}`);
				this._cancelReconnect(address);
				this._reconnectAttempts.delete(address);
				this._removeConnection(address);
			}
		}

		for (const { entry, address } of entriesWithAddress) {
			if (!this._entries.has(address) && !this._pendingConnects.has(address) && this._shouldAutoConnect(entry)) {
				void this._connectTo(entry, { userInitiated: false });
			}
		}

		if (namesChanged) {
			this._onDidChangeConnections.fire();
		}
	}

	private _connectTo(entryToConnect: IRemoteAgentHostEntry, options: IRemoteAgentHostConnectOptions): Promise<void> {
		if (this._store.isDisposed) {
			return Promise.resolve();
		}
		const entryToCreate = this._normalizeEntry(entryToConnect);
		const address = this._entryAddress(entryToCreate);
		const existingPendingConnect = this._pendingConnects.get(address);
		if (existingPendingConnect) {
			return existingPendingConnect;
		}

		const pendingConnect = new DeferredPromise<void>();
		this._pendingConnects.set(address, pendingConnect.p);
		void (async () => {
			try {
				await this._createAndConnect(entryToCreate, address, options);
			} catch (err) {
				this._logService.error(`[RemoteAgentHost] Unexpected error connecting to ${address}`, err);
			} finally {
				if (this._pendingConnects.get(address) === pendingConnect.p) {
					this._pendingConnects.delete(address);
				}
				void pendingConnect.complete();
			}
		})();
		return pendingConnect.p;
	}

	private async _createAndConnect(entryToCreate: IRemoteAgentHostEntry, address: string, options: IRemoteAgentHostConnectOptions): Promise<void> {
		if (this._store.isDisposed || !this._remoteAgentHostsEnabled.get()) {
			return;
		}

		const factory = this._connectionFactories.get(entryToCreate.connection.type);
		if (!factory) {
			const error = new Error(`No connection factory is registered for ${entryToCreate.connection.type}.`);
			this._logService.error(`[RemoteAgentHost] ${error.message} at ${address}`);
			this._failedReconnects.set(address, error);
			this._rejectPendingConnectionWait(address, error);
			return;
		}

		const existingEntry = this._entries.get(address);
		if (existingEntry) {
			this._entries.delete(address);
			disposeEntry(existingEntry);
		}

		let createdConnection: IRemoteAgentHostCreatedConnection;
		try {
			createdConnection = await factory.createConnection(entryToCreate, options);
		} catch (err) {
			this._logService.error(`[RemoteAgentHost] Failed to create a connection to ${address}. Verify address and connectionToken`, err);
			const disconnectReason = err instanceof NonReconnectableTransportError ? err.reason : AgentHostTransportFailureReason.Unknown;
			this._entries.set(address, {
				store: new DisposableStore(),
				connected: false,
				status: RemoteAgentHostConnectionStatus.disconnectedBecause(disconnectReason),
				reconnectTransfersTransportOwnership: false,
			});
			this._rejectPendingConnectionWait(address, err);
			this._pendingConnects.delete(address);
			this._onDidChangeConnections.fire();
			if (!isTerminalConnectError(err) && !this._store.isDisposed && this._remoteAgentHostsEnabled.get()) {
				this._scheduleReconnect(address, entryToCreate.connectionToken);
			}
			return;
		}

		if (
			this._store.isDisposed
			|| !this._remoteAgentHostsEnabled.get()
			|| !this._configuredEntries.get().some(entry => this._entryAddress(entry) === address)
			|| this._entries.has(address)
		) {
			createdConnection.connection.dispose();
			createdConnection.transportDisposable?.dispose();
			this._rejectPendingConnectionWait(address, new Error(`Connection attempt for ${address} was discarded because it is no longer active.`));
			return;
		}

		const store = new DisposableStore();
		const client = store.add(createdConnection.connection);
		const entry: IConnectionEntry = {
			store,
			client,
			transportDisposable: createdConnection.transportDisposable,
			reconnectTransfersTransportOwnership: createdConnection.reconnectTransfersTransportOwnership ?? false,
			connected: false,
			status: RemoteAgentHostConnectionStatus.connecting,
		};
		this._entries.set(address, entry);

		const isCurrentEntry = () => this._entries.get(address) === entry;

		store.add(client.onDidClose(reason => {
			if (!isCurrentEntry()) {
				return;
			}
			this._logService.warn(`[RemoteAgentHost] Connection closed: ${address}`);
			entry.connected = false;
			entry.status = RemoteAgentHostConnectionStatus.disconnectedBecause(reason ?? AgentHostTransportFailureReason.Unknown);
			entry.client = undefined;
			disposeEntry(entry);
			this._onDidChangeConnections.fire();
			this._scheduleReconnect(address, entryToCreate.connectionToken);
		}));

		store.add(client.onDidScheduleReconnect(() => {
			if (!isCurrentEntry() || entry.status.kind !== 'reconnecting') {
				return;
			}
			entry.status = RemoteAgentHostConnectionStatus.reconnectingUntil(client.nextReconnectAt);
			this._onDidChangeConnections.fire();
		}));
		store.add(client.onDidChangeConnectionState(state => {
			if (!isCurrentEntry()) {
				return;
			}
			switch (state) {
				case 'reconnecting':
					entry.connected = false;
					entry.status = RemoteAgentHostConnectionStatus.reconnectingUntil(client.nextReconnectAt);
					this._onDidChangeConnections.fire();
					break;
				case 'connected':
					entry.connected = true;
					entry.status = RemoteAgentHostConnectionStatus.connected;
					this._reconnectAttempts.delete(address);
					this._resolvePendingConnectionWait(address);
					this._onDidChangeConnections.fire();
					break;
				case 'connecting':
				case 'closed':
					break;
				case 'incompatible':
					entry.connected = false;
					entry.status = RemoteAgentHostConnectionStatus.incompatible('Authentication failed during connection initialization.', [PROTOCOL_VERSION]);
					this._reconnectAttempts.delete(address);
					this._onDidChangeConnections.fire();
					break;
			}
		}));

		try {
			this._logService.info(`[RemoteAgentHost] Connecting to ${address}`);
			this._onDidChangeConnections.fire();
			await client.connect();
			if (store.isDisposed || !isCurrentEntry()) {
				if (!store.isDisposed) {
					disposeEntry(entry);
				}
				return;
			}
			this._logService.info(`[RemoteAgentHost] Connected to ${address}`);
			entry.connected = true;
			entry.status = RemoteAgentHostConnectionStatus.connected;
			this._reconnectAttempts.delete(address);
			this._resolvePendingConnectionWait(address);
			this._onDidChangeConnections.fire();
		} catch (err) {
			if (!isCurrentEntry()) {
				if (!store.isDisposed) {
					disposeEntry(entry);
				}
				return;
			}

			const incompatible = err instanceof InitialAuthenticationError
				? RemoteAgentHostConnectionStatus.incompatible(err.message, [PROTOCOL_VERSION])
				: RemoteAgentHostConnectionStatus.fromConnectError(err, [PROTOCOL_VERSION]);
			if (incompatible) {
				this._logService.warn(`[RemoteAgentHost] Incompatible with ${address}: ${incompatible.kind === 'incompatible' ? incompatible.message : ''}`);
				entry.status = incompatible;
				this._reconnectAttempts.delete(address);
				this._rejectPendingConnectionWait(address, err);
				this._onDidChangeConnections.fire();
				return;
			}

			this._logService.error(`[RemoteAgentHost] Failed to connect to ${address}. Verify address and connectionToken`, err);

			if (RemoteAgentHostConnectionStatus.isReconnecting(entry.status)) {
				this._logService.info(`[RemoteAgentHost] Handshake with ${address} was interrupted; the protocol client is restoring the connection`);
				return;
			}

			const disconnectReason = err instanceof NonReconnectableTransportError ? err.reason : AgentHostTransportFailureReason.Unknown;
			entry.status = RemoteAgentHostConnectionStatus.disconnectedBecause(disconnectReason);
			entry.client = undefined;
			disposeEntry(entry);
			this._rejectPendingConnectionWait(address, err);
			this._onDidChangeConnections.fire();
			this._scheduleReconnect(address, entryToCreate.connectionToken);
		}
	}

	private _scheduleReconnect(address: string, connectionToken?: string): void {
		const configuredEntry = this._configuredEntries.get().find(entry => this._entryAddress(entry) === address);
		if (!configuredEntry) {
			this._logService.info(`[RemoteAgentHost] Not reconnecting to ${address}: no longer configured`);
			return;
		}

		const reconnectPolicy = getEntryTypeConfig(configuredEntry.connection.type).reconnect;
		if (!reconnectPolicy.autoRestore) {
			this._logService.info(`[RemoteAgentHost] Not reconnecting to ${address}: automatic restore is disabled`);
			return;
		}
		if (getEntryTypeConfig(configuredEntry.connection.type).dialedFromEntries && !this._shouldAutoConnect(configuredEntry)) {
			this._logService.info(`[RemoteAgentHost] Not reconnecting to ${address}: automatic connection is disabled`);
			return;
		}

		const previousAttempts = this._reconnectAttempts.get(address) ?? 0;
		if (hasExhaustedReconnectAttempts(reconnectPolicy, previousAttempts)) {
			this._logService.warn(`[RemoteAgentHost] Stopped reconnecting to ${address}: reached attempt limit (${previousAttempts})`);
			return;
		}

		const attempt = previousAttempts + 1;
		this._reconnectAttempts.set(address, attempt);

		const delay = computeReconnectDelay(reconnectPolicy, attempt);

		this._logService.info(`[RemoteAgentHost] Scheduling reconnect to ${address} in ${delay}ms (attempt ${attempt})`);

		this._cancelReconnect(address);
		const timeout = setTimeout(() => {
			this._reconnectTimeouts.delete(address);
			const currentEntry = this._configuredEntries.get().find(entry => this._entryAddress(entry) === address);
			if (currentEntry && (!getEntryTypeConfig(currentEntry.connection.type).dialedFromEntries || this._shouldAutoConnect(currentEntry))) {
				void this._connectTo({
					...currentEntry,
					connectionToken: connectionToken ?? this._tokens.get(address) ?? currentEntry.connectionToken,
				}, { userInitiated: false });
			}
		}, delay);
		this._reconnectTimeouts.set(address, timeout);
	}

	private _shouldAutoConnect(entry: IRemoteAgentHostEntry): boolean {
		const config = getEntryTypeConfig(entry.connection.type);
		return config.dialedFromEntries
			&& (!config.autoConnectGated || this._remoteAgentHostsAutoConnect.get());
	}

	private _cancelReconnect(address: string): void {
		const timeout = this._reconnectTimeouts.get(address);
		if (timeout !== undefined) {
			clearTimeout(timeout);
			this._reconnectTimeouts.delete(address);
		}
	}

	private _getConnectionInfo(address: string): IRemoteAgentHostConnectionInfo | undefined {
		return this.connections.find(connection => connection.address === address && RemoteAgentHostConnectionStatus.isConnected(connection.status));
	}

	private _upsertEntry(entries: readonly IRemoteAgentHostEntry[], entry: IRemoteAgentHostEntry): IRemoteAgentHostEntry[] {
		const address = this._entryAddress(entry);
		const existingIndex = entries.findIndex(candidate => this._entryAddress(candidate) === address);
		return existingIndex === -1
			? [...entries, entry]
			: entries.map((candidate, index) => index === existingIndex ? entry : candidate);
	}

	private _getOrCreateConnectionWait(address: string): DeferredPromise<IRemoteAgentHostConnectionInfo> {
		let wait = this._pendingConnectionWaits.get(address);
		if (wait) {
			return wait;
		}

		const existingConnection = this._getConnectionInfo(address);
		if (existingConnection) {
			const immediateWait = new DeferredPromise<IRemoteAgentHostConnectionInfo>();
			immediateWait.complete(existingConnection);
			return immediateWait;
		}

		wait = new DeferredPromise<IRemoteAgentHostConnectionInfo>();
		wait.p.then(undefined, () => { });
		this._pendingConnectionWaits.set(address, wait);
		return wait;
	}

	private _resolvePendingConnectionWait(address: string): void {
		const wait = this._pendingConnectionWaits.get(address);
		const connection = this._getConnectionInfo(address);
		if (!wait || !connection) {
			return;
		}

		this._pendingConnectionWaits.delete(address);
		void wait.complete(connection);
	}

	private _rejectPendingConnectionWait(address: string, err: unknown): void {
		const wait = this._pendingConnectionWaits.get(address);
		if (!wait) {
			return;
		}

		this._pendingConnectionWaits.delete(address);
		void wait.error(err);
	}

	private _updateHostLabelFormatter(address: string, name: string): void {
		this._clearHostLabelFormatter(address);
		const handle = this._labelService.registerFormatter({
			scheme: AGENT_HOST_SCHEME,
			authority: agentHostAuthority(address),
			priority: true,
			formatting: {
				...AGENT_HOST_LABEL_FORMATTER.formatting,
				workspaceSuffix: name,
			},
		});
		this._labelFormatters.set(address, handle);
	}

	private _clearHostLabelFormatter(address: string): void {
		const existing = this._labelFormatters.get(address);
		if (existing) {
			existing.dispose();
			this._labelFormatters.delete(address);
		}
	}

	override dispose(): void {
		for (const timeout of this._reconnectTimeouts.values()) {
			clearTimeout(timeout);
		}
		this._reconnectTimeouts.clear();
		this._reconnectAttempts.clear();
		this._pendingConnects.clear();
		for (const [address, wait] of this._pendingConnectionWaits) {
			void wait.error(new Error(`Remote agent host service disposed before connecting to ${address}`));
		}
		this._pendingConnectionWaits.clear();
		for (const entry of this._entries.values()) {
			disposeEntry(entry);
		}
		this._entries.clear();
		for (const handle of this._labelFormatters.values()) {
			handle.dispose();
		}
		this._labelFormatters.clear();
		super.dispose();
	}
}
