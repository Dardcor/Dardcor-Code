/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IObservable, observableFromEvent } from '../../../base/common/observable.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ILogService } from '../../log/common/log.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IDialogService } from '../../dialogs/common/dialogs.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { INotificationService, Severity } from '../../notification/common/notification.js';
import { toAction } from '../../../base/common/actions.js';
import { IProductService } from '../../product/common/productService.js';
import { IStorageService, StorageScope } from '../../storage/common/storage.js';
import { ISharedProcessService } from '../../ipc/electron-browser/services.js';
import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IRemoteAgentHostService, RemoteAgentHostConnectionStatus, RemoteAgentHostEntryType, RemoteAgentHostsEnabledSettingId, RemoteAgentHostsSettingId, SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY, getEntryAddress, isLegacySshRawEntry, isRawRemoteAgentHostEntry, parseLegacyRawEntry, readRemoteAgentHostSettings, readSSHRemoteAgentHostEntries, removeSSHRemoteAgentHostEntry, storeSSHRemoteAgentHostEntries, upsertRemoteAgentHostEntry, type IRemoteAgentHostConnectOptions, type IRemoteAgentHostConnectionFactory, type IRemoteAgentHostCreatedConnection, type IRemoteAgentHostEntry } from '../common/remoteAgentHostService.js';
import { createDecorator, IInstantiationService } from '../../instantiation/common/instantiation.js';
import { IQuickInputService } from '../../quickinput/common/quickInput.js';
import { AhpJsonlLogger } from '../common/ahpJsonlLogger.js';
import { AgentHostAhpJsonlLoggingSettingId } from '../common/agentService.js';
import type { AgentHostServerType } from '../common/agentHostEndpointRegistry.js';
import { AgentHostClientConnectionKind } from '../common/agentHostTelemetry.js';
import { IRemoteAgentHostLocationPreferenceService } from '../common/remoteAgentHostLocationPreference.js';
import { promptRemoteAgentHostLocationPreference } from '../common/remoteAgentHostLocationPreferenceDialog.js';
import { ReconnectingRelayTransport, type IRelayConnectionHandle } from '../common/relayTransport.js';
import { AgentHostProtocolClient } from '../browser/agentHostProtocolClient.js';
import { editorWindowAgentHostClientInfo } from '../common/agentHostClientInfo.js';
import { NonReconnectableTransportError } from '../common/state/sessionTransport.js';
import {
	ISSHRemoteAgentHostService,
	SSH_REMOTE_AGENT_HOST_CHANNEL,
	computeSSHConnectionKey,
	isSSHHostKeyDeniedError,
	SSH_HOST_KEY_DENIED_ERROR_NAME,
	SSHAuthMethod,
	type ISSHAgentHostConfig,
	type ISSHAgentHostConnection,
	type ISSHConnectResult,
	type ISSHEndpointCandidate,
	type ISSHEndpointSelection,
	type ISSHEndpointSelectionRequest,
	type ISSHHostKeyVerificationRequest,
	type ISSHHostKeysAnnouncement,
	type ISSHKeyboardInteractiveRequest,
	type ISSHRemoteAgentHostMainService,
	type ISSHResolvedConfig,
	type ISSHConnectProgress,
} from '../common/sshRemoteAgentHost.js';
import { ISSHHostKeyTrustService } from '../common/sshHostKeyTrust.js';
import { decideHostKeyTrust, type SSHHostKeyDenial } from '../common/sshHostKeyPolicy.js';

export function describeHostKeyType(keyType: string): string {
	switch (keyType) {
		case 'ssh-ed25519': return 'ED25519';
		case 'ssh-rsa':
		case 'rsa-sha2-256':
		case 'rsa-sha2-512': return 'RSA';
		case 'ssh-dss': return 'DSA';
		case 'ecdsa-sha2-nistp256':
		case 'ecdsa-sha2-nistp384':
		case 'ecdsa-sha2-nistp521': return 'ECDSA';
		default: return keyType;
	}
}

export const ISSHRelayClientFactory = createDecorator<ISSHRelayClientFactory>('sshRelayClientFactory');

export interface ISSHRelayClientFactory {
	readonly _serviceBrand: undefined;
	createClient(mainService: ISSHRemoteAgentHostMainService, connectionId: string, address: string, reestablish: () => Promise<IRelayConnectionHandle>): AgentHostProtocolClient;
}

export class SSHRelayClientFactory implements ISSHRelayClientFactory {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@ILogService private readonly _logService: ILogService,
	) { }

	createClient(mainService: ISSHRemoteAgentHostMainService, connectionId: string, address: string, reestablish: () => Promise<IRelayConnectionHandle>): AgentHostProtocolClient {
		const ahpLoggingEnabled = !!this._configurationService.getValue<boolean>(AgentHostAhpJsonlLoggingSettingId);
		let seedConnection = true;
		const establish = async () => {
			if (seedConnection) {
				seedConnection = false;
				return { connectionId };
			}
			try {
				const result = await reestablish();
				return {
					connectionId: result.connectionId,
					close: () => mainService.disconnect(result.connectionId),
				};
			} catch (error) {
				if (isSSHHostKeyDeniedError(error)) {
					throw new NonReconnectableTransportError(error.message);
				}
				throw error;
			}
		};
		return this._instantiationService.createInstance(AgentHostProtocolClient, address, () => {
			const createLogger = () => ahpLoggingEnabled ? this._instantiationService.createInstance(
				AhpJsonlLogger,
				{ logsHome: this._environmentService.logsHome, connectionId, transport: 'ssh' },
			) : undefined;
			return new ReconnectingRelayTransport(
				establish,
				mainService,
				createLogger,
				this._logService,
				'[SSHRelayTransport]',
				AgentHostClientConnectionKind.SSH,
			);
		}, { clientInfo: editorWindowAgentHostClientInfo });
	}
}

class SSHConnectionFactory extends Disposable implements IRemoteAgentHostConnectionFactory {
	readonly kind = RemoteAgentHostEntryType.SSH;
	readonly entries: IObservable<readonly IRemoteAgentHostEntry[]>;

	private readonly _stagedConfigurations = new Map<string, ISSHAgentHostConfig>();
	private readonly _lastConnectedServerTypeByAddress = new Map<string, AgentHostServerType>();

	constructor(
		private readonly _storageService: IStorageService,
		private readonly _configurationService: IConfigurationService,
		private readonly _logService: ILogService,
		private readonly _mainService: ISSHRemoteAgentHostMainService,
		private readonly _remoteAgentHostService: IRemoteAgentHostService,
		private readonly _relayClientFactory: ISSHRelayClientFactory,
		private readonly _locationPreferenceService: IRemoteAgentHostLocationPreferenceService,
		private readonly _notificationService: INotificationService,
		private readonly _connections: Map<string, SSHAgentHostConnectionHandle>,
		private readonly _onDidChangeConnections: () => void,
	) {
		super();
		this.entries = observableFromEvent(
			this,
			this._storageService.onDidChangeValue(StorageScope.APPLICATION, SSH_REMOTE_AGENT_HOSTS_STORAGE_KEY, this._store),
			() => readSSHRemoteAgentHostEntries(this._storageService),
		);
		void this._migrateLegacyEntries();
	}

	stageConfiguration(config: ISSHAgentHostConfig): IRemoteAgentHostEntry {
		const address = computeSSHConnectionKey(config);
		const entry: IRemoteAgentHostEntry = {
			name: config.name,
			connection: {
				type: RemoteAgentHostEntryType.SSH,
				address,
				sshConfigHost: config.sshConfigHost,
				hostName: config.host,
				user: config.username,
				port: config.port,
			},
		};
		this._stagedConfigurations.set(address, config);
		storeSSHRemoteAgentHostEntries(this._storageService, upsertRemoteAgentHostEntry(readSSHRemoteAgentHostEntries(this._storageService), entry));
		return entry;
	}

	getEntryForSSHConfigHost(sshConfigHost: string): IRemoteAgentHostEntry | undefined {
		return readSSHRemoteAgentHostEntries(this._storageService).find(entry =>
			entry.connection.type === RemoteAgentHostEntryType.SSH && entry.connection.sshConfigHost === sshConfigHost
		);
	}

	async createConnection(entry: IRemoteAgentHostEntry, options: IRemoteAgentHostConnectOptions): Promise<IRemoteAgentHostCreatedConnection> {
		if (entry.connection.type !== RemoteAgentHostEntryType.SSH) {
			throw new Error(`SSH factory cannot create a ${entry.connection.type} connection.`);
		}

		const stagedConfig = this._stagedConfigurations.get(entry.connection.address);
		this._stagedConfigurations.delete(entry.connection.address);
		let result;
		try {
			result = stagedConfig
				? await this._mainService.connect(this._augmentConfig({ ...stagedConfig, userInitiated: stagedConfig.userInitiated ?? options.userInitiated }))
				: entry.connection.sshConfigHost
					? await this._mainService.reconnect(
						entry.connection.sshConfigHost,
						entry.name,
						this._getRemoteAgentHostCommand(),
						this._isSSHAgentForwardingEnabled(),
						options.userInitiated,
						this._locationPreferenceService.getPreference(computeSSHConnectionKey({ sshConfigHost: entry.connection.sshConfigHost })),
					)
					: await this._mainService.connect(this._augmentConfig({
						host: entry.connection.hostName,
						port: entry.connection.port,
						username: entry.connection.user ?? entry.connection.hostName,
						authMethod: SSHAuthMethod.Agent,
						name: entry.name,
						userInitiated: options.userInitiated,
					}));
		} catch (error) {
			if (isSSHHostKeyDeniedError(error)) {
				const denied = new NonReconnectableTransportError(error instanceof Error ? error.message : String(error));
				denied.name = SSH_HOST_KEY_DENIED_ERROR_NAME;
				throw denied;
			}
			throw error;
		}
		this._logService.trace(`[SSHRemoteAgentHost] SSH tunnel established, connectionId=${result.connectionId}`);

		const existing = this._connections.get(result.connectionId);
		const persistedEntry: IRemoteAgentHostEntry = {
			name: result.name,
			connectionToken: result.connectionToken,
			connection: {
				type: RemoteAgentHostEntryType.SSH,
				address: result.address,
				sshConfigHost: result.sshConfigHost,
				hostName: result.config.host,
				user: result.config.username || undefined,
				port: result.config.port,
				serverType: result.serverType,
				instanceId: result.instanceId,
				primary: result.primary,
				lifecycle: result.lifecycle,
			},
		};
		if (existing) {
			if (this._remoteAgentHostService.getConnection(result.address)) {
				this._logService.trace('[SSHRemoteAgentHost] Returning existing connection handle');
				this.storeEntry(persistedEntry);
				return {
					connection: this._createRelayClient(result),
					transportDisposable: this._createTransportDisposable(result.connectionId, existing, this._observeSuccessfulConnection(result, options.userInitiated)),
					reconnectTransfersTransportOwnership: true,
				};
			}
			this._logService.info(`[SSHRemoteAgentHost] Replacing stale connection handle for ${result.address}`);
			this._connections.delete(result.connectionId);
			existing.fireClose();
			existing.dispose();
			this._onDidChangeConnections();
		}

		const handle = new SSHAgentHostConnectionHandle(
			result.config,
			result.address,
			result.name,
			result.serverType,
			result.instanceId,
			result.primary,
			result.lifecycle,
			() => this._mainService.disconnect(result.connectionId),
		);
		try {
			this._connections.set(result.connectionId, handle);
			this._onDidChangeConnections();
			this.storeEntry(persistedEntry);
			const endpointSelectionObserver = this._observeSuccessfulConnection(result, options.userInitiated);
			return {
				connection: this._createRelayClient(result),
				transportDisposable: this._createTransportDisposable(result.connectionId, handle, endpointSelectionObserver),
				reconnectTransfersTransportOwnership: true,
			};
		} catch (err) {
			this._logService.error('[SSHRemoteAgentHost] Connection setup failed', err);
			if (this._connections.get(result.connectionId) === handle) {
				this._connections.delete(result.connectionId);
				this._onDidChangeConnections();
			}
			handle.dispose();
			this._mainService.disconnect(result.connectionId).catch(() => { });
			throw err;
		}
	}

	storeEntry(entry: IRemoteAgentHostEntry): void {
		storeSSHRemoteAgentHostEntries(this._storageService, upsertRemoteAgentHostEntry(readSSHRemoteAgentHostEntries(this._storageService), entry));
	}

	private _observeSuccessfulConnection(result: ISSHConnectResult, userInitiated: boolean): IDisposable {
		const listener = this._remoteAgentHostService.onDidChangeConnections(() => {
			const status = this._remoteAgentHostService.connections.find(connection => connection.address === result.address)?.status;
			if (RemoteAgentHostConnectionStatus.isConnected(status)) {
				listener?.dispose();
				this._recordEndpointSelection(result, userInitiated);
			} else if (!status || RemoteAgentHostConnectionStatus.isIncompatible(status)) {
				listener?.dispose();
			}
		});
		return listener;
	}

	private _recordEndpointSelection(result: ISSHConnectResult, userInitiated: boolean): void {
		if (!result.serverType) {
			return;
		}
		const previousServerType = this._lastConnectedServerTypeByAddress.get(result.address);
		const isUnattendedFailoverFromEditor = userInitiated === false
			&& previousServerType === 'editor'
			&& result.serverType === 'standalone';
		this._lastConnectedServerTypeByAddress.set(result.address, result.serverType);
		if (isUnattendedFailoverFromEditor) {
			this._notificationService.info(localize(
				'sshEditorAgentHostReplacedByStandalone',
				"The editor agent host exited. Reconnected to a dedicated agent host. In-progress work may have been interrupted."
			));
		}
	}

	private _createTransportDisposable(connectionId: string, handle: SSHAgentHostConnectionHandle, endpointSelectionObserver?: IDisposable): IDisposable {
		return toDisposable(() => {
			endpointSelectionObserver?.dispose();
			if (this._connections.get(connectionId) === handle) {
				this._connections.delete(connectionId);
				this._onDidChangeConnections();
			}
			handle.fireClose();
			handle.dispose();
			this._mainService.disconnect(connectionId).catch(() => { });
		});
	}

	private _createRelayClient(result: Pick<ISSHConnectResult, 'connectionId' | 'address' | 'name' | 'sshConfigHost'>): AgentHostProtocolClient {
		const reestablish = async (): Promise<IRelayConnectionHandle> => {
			if (!result.sshConfigHost) {
				throw new NonReconnectableTransportError('Cannot automatically reconnect an SSH connection without an SSH config host.');
			}
			const preferredAgentLocation = this._locationPreferenceService.getPreference(computeSSHConnectionKey({ sshConfigHost: result.sshConfigHost }));
			const reconnected = await this._mainService.reconnect(result.sshConfigHost, result.name, this._getRemoteAgentHostCommand(), this._isSSHAgentForwardingEnabled(), false, preferredAgentLocation);
			return { connectionId: reconnected.connectionId };
		};
		return this._relayClientFactory.createClient(this._mainService, result.connectionId, result.address, reestablish);
	}

	private _augmentConfig(config: ISSHAgentHostConfig): ISSHAgentHostConfig {
		const result = { ...config };
		const commandOverride = this._getRemoteAgentHostCommand();
		if (commandOverride) {
			result.remoteAgentHostCommand = commandOverride;
		}
		if (this._isSSHAgentForwardingEnabled() && config.agentForward) {
			result.agentForward = true;
		}
		const preferredAgentLocation = this._locationPreferenceService.getPreference(computeSSHConnectionKey(config));
		if (preferredAgentLocation) {
			result.preferredAgentLocation = preferredAgentLocation;
		}
		return result;
	}

	private _getRemoteAgentHostCommand(): string | undefined {
		return this._configurationService.getValue<string>('chat.sshRemoteAgentHostCommand') || undefined;
	}

	private _isSSHAgentForwardingEnabled(): boolean | undefined {
		return this._configurationService.getValue<boolean>('chat.agentHost.forwardSSHAgent') || undefined;
	}

	private async _migrateLegacyEntries(): Promise<void> {
		try {
			const settings = readRemoteAgentHostSettings(this._configurationService);
			const legacyEntries = settings.entries
				.filter(isRawRemoteAgentHostEntry)
				.filter(isLegacySshRawEntry)
				.map(parseLegacyRawEntry)
				.filter(entry => entry.connection.type === RemoteAgentHostEntryType.SSH);
			if (legacyEntries.length === 0) {
				return;
			}

			let sshEntries = readSSHRemoteAgentHostEntries(this._storageService);
			for (const entry of legacyEntries) {
				sshEntries = upsertRemoteAgentHostEntry(sshEntries, entry);
			}
			storeSSHRemoteAgentHostEntries(this._storageService, sshEntries);
			const remainingEntries = settings.entries.filter(entry => !isRawRemoteAgentHostEntry(entry) || !isLegacySshRawEntry(entry));
			await this._configurationService.updateValue(RemoteAgentHostsSettingId, remainingEntries, settings.target);
		} catch (err) {
			this._logService.error('[RemoteAgentHost] Failed to migrate SSH connection details from settings to storage', err);
		}
	}
}

export class SSHRemoteAgentHostService extends Disposable implements ISSHRemoteAgentHostService {
	declare readonly _serviceBrand: undefined;

	private readonly _mainService: ISSHRemoteAgentHostMainService;
	private readonly _connectionFactory: SSHConnectionFactory;

	private readonly _onDidChangeConnections = this._register(new Emitter<void>());
	readonly onDidChangeConnections: Event<void> = this._onDidChangeConnections.event;

	readonly onDidReportConnectProgress: Event<ISSHConnectProgress>;

	private readonly _connections = new Map<string, SSHAgentHostConnectionHandle>();

	private readonly _sessionHostKeys = new Map<string, { keyType: string; fingerprint: string }>();

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IRemoteAgentHostService private readonly _remoteAgentHostService: IRemoteAgentHostService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ISSHRelayClientFactory private readonly _relayClientFactory: ISSHRelayClientFactory,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IRemoteAgentHostLocationPreferenceService private readonly _locationPreferenceService: IRemoteAgentHostLocationPreferenceService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IProductService private readonly _productService: IProductService,
		@ISSHHostKeyTrustService private readonly _hostKeyTrustService: ISSHHostKeyTrustService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		this._mainService = ProxyChannel.toService<ISSHRemoteAgentHostMainService>(
			sharedProcessService.getChannel(SSH_REMOTE_AGENT_HOST_CHANNEL),
		);
		this._connectionFactory = this._register(new SSHConnectionFactory(
			this._storageService,
			this._configurationService,
			this._logService,
			this._mainService,
			this._remoteAgentHostService,
			this._relayClientFactory,
			this._locationPreferenceService,
			this._notificationService,
			this._connections,
			() => this._onDidChangeConnections.fire(),
		));
		this._register(this._remoteAgentHostService.registerConnectionFactory(this._connectionFactory));

		this.onDidReportConnectProgress = this._mainService.onDidReportConnectProgress;

		this._register(this._mainService.onDidCloseConnection(connectionId => {
			this._logService.info(`[SSHRemoteAgentHost] onDidCloseConnection: connectionId=${connectionId}`);
			const handle = this._connections.get(connectionId);
			if (handle) {
				this._logService.info(`[SSHRemoteAgentHost] onDidCloseConnection: found handle for ${connectionId}, cleaning up`);
				this._connections.delete(connectionId);
				handle.fireClose();
				handle.dispose();
				this._onDidChangeConnections.fire();

				this._logService.info(`[SSHRemoteAgentHost] onDidCloseConnection: notifying protocol client for ${handle.localAddress}`);
				this._remoteAgentHostService.notifyConnectionClosed(handle.localAddress);
			} else {
				this._logService.info(`[SSHRemoteAgentHost] onDidCloseConnection: no renderer-side handle for ${connectionId} (already cleaned up?)`);
			}
		}));

		this._register(this._mainService.onDidRequestKeyboardInteractive(request => {
			this._handleKeyboardInteractiveRequest(request);
		}));

		this._register(this._mainService.onDidRequestEndpointSelection(request => {
			this._handleEndpointSelectionRequest(request);
		}));

		this._register(this._mainService.onDidRequestHostKeyVerification(request => {
			this._trackHostKeyVerification(this._handleHostKeyVerificationRequest(request));
		}));

		this._register(this._mainService.onDidAnnounceHostKeys(announcement => {
			this._handleAnnouncedHostKeys(announcement);
		}));
	}

	get connections(): readonly ISSHAgentHostConnection[] {
		return [...this._connections.values()];
	}

	async connect(config: ISSHAgentHostConfig): Promise<ISSHAgentHostConnection> {
		if (!this._configurationService.getValue<boolean>(RemoteAgentHostsEnabledSettingId)) {
			throw new Error('Remote agent host connections are not enabled.');
		}

		const entry = this._connectionFactory.stageConfiguration({ ...config, userInitiated: config.userInitiated ?? true });
		const address = getEntryAddress(entry);
		this._remoteAgentHostService.reconnect(address, true);
		await this._remoteAgentHostService.waitForConnection(address);
		return this._getConnectionHandle(address);
	}

	async disconnect(host: string): Promise<void> {
		removeSSHRemoteAgentHostEntry(this._storageService, host);
		await this._mainService.disconnect(host);
	}

	async listSSHConfigHosts(): Promise<string[]> {
		return this._mainService.listSSHConfigHosts();
	}

	async ensureUserSSHConfig(): Promise<URI> {
		return this._mainService.ensureUserSSHConfig();
	}

	async listSSHConfigFiles(): Promise<URI[]> {
		return this._mainService.listSSHConfigFiles();
	}

	async resolveSSHConfig(host: string): Promise<ISSHResolvedConfig> {
		return this._mainService.resolveSSHConfig(host);
	}

	async reconnect(sshConfigHost: string, _name: string, userInitiated?: boolean): Promise<ISSHAgentHostConnection> {
		if (!this._configurationService.getValue<boolean>(RemoteAgentHostsEnabledSettingId)) {
			throw new Error('Remote agent host connections are not enabled.');
		}

		const entry = this._connectionFactory.getEntryForSSHConfigHost(sshConfigHost);
		if (!entry) {
			throw new Error(`No SSH remote agent host entry found for ${sshConfigHost}.`);
		}
		const address = getEntryAddress(entry);
		this._remoteAgentHostService.reconnect(address, userInitiated ?? true);
		await this._remoteAgentHostService.waitForConnection(address);
		return this._getConnectionHandle(address);
	}

	private _getConnectionHandle(address: string): SSHAgentHostConnectionHandle {
		const handle = [...this._connections.values()].find(candidate => candidate.localAddress === address);
		if (!handle) {
			throw new Error(`SSH connection handle not found for ${address}.`);
		}
		return handle;
	}

	private async _handleKeyboardInteractiveRequest(request: ISSHKeyboardInteractiveRequest): Promise<void> {
		this._logService.info(`[SSHRemoteAgentHost] Keyboard-interactive prompt for ${request.displayHost} (${request.prompts.length} prompt(s))`);

		const cts = new CancellationTokenSource();
		const cancelListener = this._mainService.onDidCancelKeyboardInteractive(requestId => {
			if (requestId === request.requestId) {
				cts.cancel();
			}
		});

		try {
			if (request.prompts.length === 0) {
				await this._mainService.respondKeyboardInteractive(request.requestId, []);
				return;
			}

			const responses: string[] = [];
			for (let i = 0; i < request.prompts.length; i++) {
				if (cts.token.isCancellationRequested) {
					return;
				}
				const prompt = request.prompts[i];
				const cleanedPrompt = prompt.prompt.replace(/[\s:]+$/, '');
				const title = request.prompts.length > 1
					? `${request.displayHost} (${i + 1}/${request.prompts.length})`
					: request.displayHost;
				const value = await this._quickInputService.input({
					title,
					prompt: cleanedPrompt || localize('sshKbiDefaultPrompt', "Authentication required for {0}@{1}", request.username, request.displayHost),
					password: !prompt.echo,
					ignoreFocusLost: true,
				}, cts.token);
				if (cts.token.isCancellationRequested) {
					return;
				}
				if (value === undefined) {
					await this._mainService.respondKeyboardInteractive(request.requestId, undefined);
					return;
				}
				responses.push(value);
			}

			if (cts.token.isCancellationRequested) {
				return;
			}
			await this._mainService.respondKeyboardInteractive(request.requestId, responses);
		} catch (err) {
			this._logService.error('[SSHRemoteAgentHost] Failed handling keyboard-interactive prompt', err);
			try {
				await this._mainService.respondKeyboardInteractive(request.requestId, undefined);
			} catch { }
		} finally {
			cancelListener.dispose();
			cts.dispose();
		}
	}

	protected _trackHostKeyVerification(handled: Promise<void>): void {
		void handled;
	}

	private async _handleHostKeyVerificationRequest(request: ISSHHostKeyVerificationRequest): Promise<void> {
		this._logService.info(`[SSHRemoteAgentHost] Host key verification for ${request.displayHost}: ${request.keyType} ${request.fingerprint} (known_hosts: ${request.knownHostsMatch})`);

		const cts = new CancellationTokenSource();
		const cancelListener = this._mainService.onDidCancelHostKeyVerification(requestId => {
			if (requestId === request.requestId) {
				cts.cancel();
			}
		});

		try {
			const decision = decideHostKeyTrust(request, this._hostKeyTrustService.getTrustedKeys(request.host, request.port));
			this._logService.info(`[SSHRemoteAgentHost] Host key decision for ${request.displayHost}: ${decision.kind} (${decision.reason})`);

			let trusted: boolean;
			switch (decision.kind) {
				case 'trust':
					if (decision.persist) {
						this._trustHostKey(request);
					}
					trusted = true;
					break;
				case 'deny':
					this._reportHostKeyDenied(request, decision);
					trusted = false;
					break;
				case 'prompt': {
					trusted = await this._promptForHostKey(request, decision.reason, cts.token);
					if (cts.token.isCancellationRequested) {
						return;
					}
					if (trusted) {
						this._trustHostKey(request);
					}
					break;
				}
			}

			if (cts.token.isCancellationRequested) {
				return;
			}
			this._sessionHostKeys.set(request.connectionKey, { keyType: request.keyType, fingerprint: request.fingerprint });
			await this._mainService.respondHostKeyVerification(request.requestId, trusted);
		} catch (err) {
			this._logService.error('[SSHRemoteAgentHost] Failed handling host key verification', err);
			try {
				await this._mainService.respondHostKeyVerification(request.requestId, false);
			} catch { }
		} finally {
			cancelListener.dispose();
			cts.dispose();
		}
	}

	private _trustHostKey(request: ISSHHostKeyVerificationRequest): void {
		this._hostKeyTrustService.trustHostKey(request.host, request.port, {
			keyType: request.keyType,
			fingerprint: request.fingerprint,
			addedAt: Date.now(),
			...(request.displayHost !== request.host ? { alias: request.displayHost } : undefined),
		});
	}

	private async _promptForHostKey(request: ISSHHostKeyVerificationRequest, reason: 'unknown' | 'ca-only', token: CancellationToken): Promise<boolean> {
		if (token.isCancellationRequested) {
			return false;
		}

		const detail = reason === 'ca-only'
			? localize(
				'sshHostKeyCaOnlyDetail',
				"{0} key fingerprint is {1}.\n\nThis host is configured to use a certificate authority, but certificate-based host keys cannot be verified here, so this key cannot be checked against it.",
				describeHostKeyType(request.keyType), request.fingerprint)
			: localize(
				'sshHostKeyUnknownDetail',
				"{0} key fingerprint is {1}.\n\nVerify this fingerprint matches the host before continuing.",
				describeHostKeyType(request.keyType), request.fingerprint);

		const { confirmed } = await this._dialogService.confirm({
			type: 'warning',
			message: localize('sshHostKeyUnknownMessage', "The authenticity of host '{0}' can't be established.", request.displayHost),
			detail,
			primaryButton: localize('sshHostKeyConnect', "&&Connect"),
			cancelButton: localize('sshHostKeyCancel', "Cancel"),
			custom: { icon: Codicon.shield },
			token,
		});
		return confirmed;
	}

	private _reportHostKeyDenied(request: ISSHHostKeyVerificationRequest, denial: SSHHostKeyDenial): void {
		if (denial.reason === 'not-user-initiated') {
			this._logService.warn(`[SSHRemoteAgentHost] Declining unknown host key for ${request.displayHost} during a background reconnect; connect manually to review it.`);
			return;
		}

		if (denial.reason === 'strict-yes') {
			this._notificationService.error(localize(
				'sshHostKeyStrictUnknown',
				"Can't connect to '{0}': its host key is not known, and StrictHostKeyChecking is set to \"yes\" in your SSH configuration.",
				request.displayHost));
			return;
		}

		if (denial.reason !== 'mismatch') {
			this._notificationService.error(localize(
				'sshHostKeyRevoked',
				"Host key verification failed for '{0}'. This host's {1} key has been marked as revoked in your known_hosts file. Remove the @revoked line from known_hosts if this key should be trusted again.",
				request.displayHost, describeHostKeyType(request.keyType)));
			return;
		}

		if (denial.source === 'known-hosts') {
			this._notificationService.error(localize(
				'sshHostKeyChangedKnownHosts',
				"Host key verification failed for '{0}'. Its {1} host key does not match the entry in your known_hosts file, which could mean someone is impersonating the host — or that the host was legitimately rebuilt. Received {2}. Update or remove the known_hosts entry if this change was expected.",
				request.displayHost, describeHostKeyType(request.keyType), request.fingerprint));
			return;
		}

		this._notificationService.notify({
			severity: Severity.Error,
			message: localize(
				'sshHostKeyChanged',
				"Host key verification failed for '{0}'. Its {1} host key has changed, which could mean someone is impersonating the host — or that the host was legitimately rebuilt. Received {2}.",
				request.displayHost, describeHostKeyType(request.keyType), request.fingerprint),
			actions: {
				primary: [toAction({
					id: 'sshHostKey.forget',
					label: localize('sshHostKeyForgetAction', "Forget Saved Host Key"),
					run: () => this._hostKeyTrustService.forgetHost(request.host, request.port),
				})],
			},
		});
	}

	private _handleAnnouncedHostKeys(announcement: ISSHHostKeysAnnouncement): void {
		const existing = this._hostKeyTrustService.getTrustedKeys(announcement.host, announcement.port);
		if (!existing.length) {
			return;
		}

		const sessionKey = this._sessionHostKeys.get(announcement.connectionKey);
		if (!sessionKey || !existing.some(e => e.keyType === sessionKey.keyType && e.fingerprint === sessionKey.fingerprint)) {
			this._logService.warn(`[SSHRemoteAgentHost] Ignoring announced host keys for ${announcement.host}: the key that authenticated this session is not itself trusted`);
			return;
		}

		for (const key of announcement.keys) {
			if (!existing.some(e => e.keyType === key.keyType && e.fingerprint === key.fingerprint)) {
				this._logService.info(`[SSHRemoteAgentHost] Learned rotated ${key.keyType} host key for ${announcement.host}: ${key.fingerprint}`);
				this._hostKeyTrustService.trustHostKey(announcement.host, announcement.port, {
					keyType: key.keyType,
					fingerprint: key.fingerprint,
					addedAt: Date.now(),
				});
			}
		}
	}

	private async _handleEndpointSelectionRequest(request: ISSHEndpointSelectionRequest): Promise<void> {
		this._logService.info(`[SSHRemoteAgentHost] Endpoint selection requested for ${request.displayHost} (${request.candidates.length} candidate(s))`);

		const cts = new CancellationTokenSource();
		const cancelListener = this._mainService.onDidCancelEndpointSelection(requestId => {
			if (requestId === request.requestId) {
				cts.cancel();
			}
		});

		try {
			const selection = await this._resolveEndpointSelection(request, cts.token);
			await this._mainService.respondEndpointSelection(request.requestId, selection);
		} catch (err) {
			this._logService.error('[SSHRemoteAgentHost] Failed handling endpoint selection prompt', err);
			try {
				await this._mainService.respondEndpointSelection(request.requestId, undefined);
			} catch { }
		} finally {
			cancelListener.dispose();
			cts.dispose();
		}
	}

	private async _resolveEndpointSelection(request: ISSHEndpointSelectionRequest, token: CancellationToken): Promise<ISSHEndpointSelection | undefined> {
		const hasLiveEditor = request.candidates.some(candidate => candidate.type === 'editor');
		const preference = this._locationPreferenceService.getPreference(request.connectionKey);

		if (preference === 'editor') {
			return hasLiveEditor ? this._deterministicSelection(request.candidates, 'editor') : this._dedicatedSelection(request.candidates);
		}

		if (preference === 'dedicated') {
			return this._dedicatedSelection(request.candidates);
		}

		if (!hasLiveEditor) {
			return this._dedicatedSelection(request.candidates);
		}

		const chosen = await promptRemoteAgentHostLocationPreference(this._dialogService, request.displayHost, this._productService.nameShort, undefined, token);
		if (token.isCancellationRequested || !chosen) {
			return undefined;
		}
		this._locationPreferenceService.setPreference(request.connectionKey, chosen);
		return chosen === 'editor' ? this._deterministicSelection(request.candidates, 'editor') : this._dedicatedSelection(request.candidates);
	}

	private _dedicatedSelection(candidates: readonly ISSHEndpointCandidate[]): ISSHEndpointSelection {
		return this._deterministicSelection(candidates, 'standalone') ?? { kind: 'spawn' };
	}

	private _deterministicSelection(candidates: readonly ISSHEndpointCandidate[], type: AgentHostServerType): ISSHEndpointSelection | undefined {
		const matching = candidates.filter(candidate => candidate.type === type);
		if (matching.length === 0) {
			return undefined;
		}
		const [chosen] = matching.slice().sort((a, b) => a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0);
		return { kind: 'candidate', type: chosen.type, pid: chosen.pid, instanceId: chosen.instanceId };
	}
}

class SSHAgentHostConnectionHandle extends Disposable implements ISSHAgentHostConnection {
	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;

	private _closedByMain = false;

	constructor(
		readonly config: ISSHAgentHostConnection['config'],
		readonly localAddress: string,
		readonly name: string,
		readonly serverType: ISSHAgentHostConnection['serverType'],
		readonly instanceId: ISSHAgentHostConnection['instanceId'],
		readonly primary: ISSHAgentHostConnection['primary'],
		readonly lifecycle: ISSHAgentHostConnection['lifecycle'],
		disconnectFn: () => Promise<void>,
	) {
		super();

		this._register(toDisposable(() => {
			if (!this._closedByMain) {
				disconnectFn().catch(() => { });
			}
		}));
	}

	fireClose(): void {
		this._closedByMain = true;
		this._onDidClose.fire();
	}
}
