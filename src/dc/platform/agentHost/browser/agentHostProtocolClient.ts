/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { DeferredPromise, TimeoutTimer } from '../../../base/common/async.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable, IReference } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { hasKey } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { ILogService } from '../../log/common/log.js';
import { FileSystemProviderErrorCode, toFileSystemProviderErrorCode } from '../../files/common/files.js';
import { ConfigurationTarget, ConfigurationTargetToString, IConfigurationService } from '../../configuration/common/configuration.js';
import { AgentSession, IAgentCreateChatRequestOptions, IAgentCreateSessionConfig, IAgentResolveSessionConfigParams, IAgentSessionConfigCompletionsParams, IAgentSessionMetadata, AuthenticateParams, AuthenticateResult, IMcpNotification } from '../common/agent.js';
import { AGENT_HOST_DEBUG_LOGS_CHUNK_BYTES, AGENT_HOST_DEBUG_LOGS_MAX_ENTRIES, IAgentConnection, IAgentHostManagedSettingsDiagnostics, IAgentHostNetworkDiagnosticsInfo, IAgentHostNetworkFetchResult, type AgentHostDebugLogsArtifactKind, type IAgentHostDebugLogsArtifact, type IAgentHostDebugLogsChunk } from '../common/agentService.js';
import { ClaimAgentHostDetachedWorktreeExtensionMethod, CollectAgentHostDebugLogsExtensionMethod, CreateAgentHostDetachedWorktreeExtensionMethod, DeleteAgentHostDetachedWorktreeExtensionMethod, GetAgentHostSessionStateFileExtensionMethod, ReadAgentHostDebugLogsChunkExtensionMethod, ReconcileAgentHostDetachedWorktreesExtensionMethod, RequestAgentHostWorkspaceTrustExtensionMethod, SetAgentHostDetachedWorktreeArchivedExtensionMethod, supportsAgentHostChatStateFile, type IAgentHostExtensionCommandMap, type IAgentHostExtensionInitializeResult, type IAgentHostExtensionServerCommandMap } from '../common/agentHostExtensionProtocol.js';
import { AMBIENT_AGENT_HOST_AUTHORITY } from '../common/agentHostConnectionsService.js';
import { createRemoteWatchHandle, type IRemoteWatchHandle } from '../common/agentHostFileSystemProvider.js';
import { AgentSubscriptionManager, type IActiveSubscriptionInfo, type IAgentSubscription } from '../common/state/agentSubscription.js';
import { agentHostAuthority, createAgentHostResourceUriMapper, fromAgentHostUri, identityAgentHostResourceUriMapper, type IAgentHostResourceUriMapper, toAgentHostUri } from '../common/agentHostUri.js';
import { AgentHostResourceIdentity, AgentHostResourcePermissionError, IAgentHostResourceService, LOCAL_AGENT_HOST_RESOURCE_IDENTITY } from '../common/agentHostResourceService.js';
import type { ClientNotificationMap, CommandMap, JsonRpcErrorResponse, JsonRpcRequest, JsonRpcResponse } from '../common/state/protocol/messages.js';
import { ActionType, type ActionEnvelope, type ChatAction, type ClientAnnotationsAction, type ClientAutomationAction, type ClientAutomationRunAction, type ClientChangesetAction, type INotification, type IRootConfigChangedAction, type SessionAction, type TerminalAction } from '../common/state/sessionActions.js';
import { MessageAttachmentKind, SessionSummary, ROOT_STATE_URI, StateComponents, isAhpRootChannel, isDefaultChatUri, type ClientPluginCustomization, type Message, type RootState } from '../common/state/sessionState.js';
import { normalizeLegacyActionEnvelope } from '../common/state/legacyProtocolCompatibility.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '../common/state/protocol/version/registry.js';
import { isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse, ProtocolError, ReconnectResultType, type ProtocolMessage, type IStateSnapshot } from '../common/state/sessionProtocol.js';
import { type IVscodeUpgradeResult } from '../common/state/protocolUpgrade.js';
import { isClientTransport, NonReconnectableTransportError, type AgentHostTransportFailureReason, type IProtocolTransport } from '../common/state/sessionTransport.js';
import { AhpErrorCodes, JsonRpcErrorCodes } from '../common/state/protocol/errors.js';
import { ChatSourceKind, ContentEncoding, ResourceRequestParams, type CompletionsParams, type CompletionsResult, type CreateTerminalParams, type ResolveSessionConfigResult, type SessionConfigCompletionsResult } from '../common/state/protocol/commands.js';
import type { InvokeChangesetOperationParams, InvokeChangesetOperationResult } from '../common/state/protocol/channels-changeset/commands.js';
import { decodeBase64, encodeBase64 } from '../../../base/common/buffer.js';
import type { FetchAutomationRunsParams, FetchAutomationRunsResult, ListAutomationTriggerDefinitionsParams, ListAutomationTriggerDefinitionsResult, RunAutomationParams, RunAutomationResult } from '../common/state/protocol/channels-automation/commands.js';
import { ILoadEstimator, LoadEstimator } from '../../../base/parts/ipc/common/ipc.net.js';
import { ITelemetryService, TelemetryLevel, TELEMETRY_CRASH_REPORTER_SETTING_ID, TELEMETRY_OLD_SETTING_ID, TELEMETRY_SETTING_ID } from '../../telemetry/common/telemetry.js';
import { getTelemetryLevel } from '../../telemetry/common/telemetryUtils.js';
import { AgentHostAutoApprovePolicyRestrictedConfigKey, AgentHostTelemetryLevelConfigKey, AgentHostTerminalAutoApproveEnabledConfigKey, AgentHostTerminalAutoApproveRulesConfigKey, AgentHostDisableRepoInfoTelemetryConfigKey, getAgentHostTerminalAutoApproveRulesConfig, GLOBAL_AUTO_APPROVE_SETTING_ID, TERMINAL_AUTO_APPROVE_ENABLED_SETTING_ID, TERMINAL_AUTO_APPROVE_SETTING_ID, TERMINAL_IGNORE_DEFAULT_AUTO_APPROVE_RULES_SETTING_ID, DISABLE_REPO_INFO_TELEMETRY_SETTING_ID, telemetryLevelToAgentHostConfigValue } from '../common/agentHostSchema.js';
import { formatAgentHostConfigurationSyncValueForLog, getAgentHostConfigurationSyncEntries, getAgentHostConfigurationSyncTarget, resolveAgentHostConfigurationSyncPatch, resolveAgentHostConfigurationSyncValue } from '../common/agentHostConfigurationSync.js';
import { managedPermissionsConfigurationIds, resolveManagedSettingsPermissions, type IAgentHostManagedSettingsPermissions } from '../common/agentHostManagedSettings.js';
import { AgentHostClientConnectionKind, toAgentHostClientMeta } from '../common/agentHostTelemetry.js';
import type { OtlpExportLogsParams } from '../common/state/protocol/channels-otlp/notifications.js';
import type { Implementation, InitializeResult } from '../common/state/protocol/common/commands.js';
import { observableValue, type IObservable } from '../../../base/common/observable.js';
import { isFileResourceRead } from '../common/resourceReadLogging.js';
import { ResourceSet } from '../../../base/common/map.js';
import { computeReconnectDelay, DEFAULT_RECONNECT_POLICY, hasExhaustedReconnectAttempts, type IRemoteAgentHostReconnectPolicy } from '../common/reconnectPolicy.js';
import type { IRemoteAgentHostProtocolClient } from '../common/remoteAgentHostService.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../workspace/common/workspaceTrust.js';
import { isWorktreeUnderRepository } from '../common/worktreePaths.js';

const AHP_CLIENT_CONNECTION_CLOSED = -32000;
const CLIENT_SUPPORTED_PROTOCOL_VERSIONS = SUPPORTED_PROTOCOL_VERSIONS.filter(version => version !== '0.8.0');

const PING_INTERVAL_MS = 5_000;

const LIVENESS_TIMEOUT_MS = 20_000;

function connectionTimeoutError(address: string, silenceMs: number): ProtocolError {
	return new ProtocolError(
		AHP_CLIENT_CONNECTION_CLOSED,
		`Connection appears dead: ${address}; no message received for ${silenceMs}ms.`,
	);
}

function connectionClosedError(address: string): ProtocolError {
	return new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, `Connection closed: ${address}`);
}

function connectionDisposedError(address: string): ProtocolError {
	return new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, `Connection disposed: ${address}`);
}

function transportLostError(address: string): ProtocolError {
	return new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, `Transport lost (reconnecting): ${address}`);
}

function isConnectionClosedError(error: unknown): boolean {
	return error instanceof ProtocolError && error.code === AHP_CLIENT_CONNECTION_CLOSED;
}

interface IRemoteAgentHostExtensionNotificationMap {
	'setClientManagedSettingsPermissions': { params: { permissions: IAgentHostManagedSettingsPermissions } };
}

interface IPendingRequest {
	readonly deferred: DeferredPromise<unknown>;
	readonly suppressNotFoundWarning: boolean;
	readonly sentAt: number;
}

export const enum AgentHostClientState {
	Connecting = 'connecting',
	Incompatible = 'incompatible',
	Connected = 'connected',
	Reconnecting = 'reconnecting',
	Closed = 'closed',
}

interface IReconnectState {
	gate: DeferredPromise<void>;
	readonly outbox: ProtocolMessage[];
	attempt: number;
	timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	nextAttemptAt: number | undefined;
}

type ClientState =
	| { readonly kind: AgentHostClientState.Connecting; readonly outbox: ProtocolMessage[] }
	| { readonly kind: AgentHostClientState.Incompatible; readonly error: ProtocolError }
	| { readonly kind: AgentHostClientState.Connected }
	| { readonly kind: AgentHostClientState.Reconnecting; readonly reconnect: IReconnectState }
	| { readonly kind: AgentHostClientState.Closed; readonly error: ProtocolError };

export interface IAgentHostProtocolClientOptions {
	readonly loadEstimator?: ILoadEstimator;
	readonly clientId?: string;
	readonly clientInfo?: Implementation;
	readonly reconnectPolicy?: IRemoteAgentHostReconnectPolicy;
	readonly resolveInitialAuthentication?: () => Promise<AuthenticateParams | undefined>;
}

export class InitialAuthenticationError extends Error {
	constructor(error: unknown) {
		super(`Initial authentication failed: ${error instanceof Error ? error.message : String(error)}`);
		this.name = 'InitialAuthenticationError';
	}
}

export class AgentHostProtocolClient extends Disposable implements IAgentConnection, IRemoteAgentHostProtocolClient {

	declare readonly _serviceBrand: undefined;

	private readonly _clientId: string;
	private readonly _address: string;
	private readonly _resourceIdentity: AgentHostResourceIdentity;
	private readonly _transportFactory: (() => IProtocolTransport) | undefined;
	private _transport!: IProtocolTransport;
	private readonly _transportListeners = this._register(new MutableDisposable<DisposableStore>());
	private readonly _connectionAuthority: string;
	readonly resourceUris: IAgentHostResourceUriMapper;
	private _serverSeq = 0;
	private _nextClientSeq = 1;
	private _defaultDirectory: string | undefined;
	private readonly _initializeResult = observableValue<IAgentHostExtensionInitializeResult | undefined>('agentHostInitializeResult', undefined);
	private readonly _subscriptionManager: AgentSubscriptionManager;

	private readonly _onDidAction = this._register(new Emitter<ActionEnvelope>());
	readonly onDidAction = this._onDidAction.event;

	private readonly _onDidNotification = this._register(new Emitter<INotification>());
	readonly onDidNotification = this._onDidNotification.event;

	private readonly _onMcpNotification = this._register(new Emitter<IMcpNotification>());
	readonly onMcpNotification = this._onMcpNotification.event;

	private readonly _onDidReceiveOtlpLogs = this._register(new Emitter<OtlpExportLogsParams>());
	readonly onDidReceiveOtlpLogs = this._onDidReceiveOtlpLogs.event;

	private readonly _onDidClose = this._register(new Emitter<AgentHostTransportFailureReason | undefined>());
	readonly onDidClose = this._onDidClose.event;

	private readonly _onDidFatalClose = this._register(new Emitter<ProtocolError>());
	readonly onDidFatalClose = this._onDidFatalClose.event;

	private readonly _onDidChangeConnectionState = this._register(new Emitter<AgentHostClientState>());
	readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;
	private readonly _onDidScheduleReconnect = this._register(new Emitter<void>());
	readonly onDidScheduleReconnect = this._onDidScheduleReconnect.event;

	private _state: ClientState = { kind: AgentHostClientState.Connecting, outbox: [] };

	private readonly _pendingRequests = new Map<number, IPendingRequest>();
	private readonly _authentication = new Map<string, AuthenticateParams>();
	private _nextRequestId = 1;

	private readonly _pendingReverseRequests = new WeakMap<IProtocolTransport, number>();

	private _livenessDeferred = false;
	private _livenessDeferredSince: number | undefined;

	private readonly _subscriptionsAwaitingRestore = new Set<string>();












	private _authenticationRestorePending = false;

	private _lastReadTime = Date.now();

	private readonly _pingTimer = this._register(new TimeoutTimer());
	private readonly _closeTimer = this._register(new TimeoutTimer());

	private readonly _loadEstimator: ILoadEstimator;
	private readonly _clientInfo: Implementation | undefined;
	private readonly _reconnectPolicy: IRemoteAgentHostReconnectPolicy;
	private readonly _resolveInitialAuthentication: (() => Promise<AuthenticateParams | undefined>) | undefined;

	private readonly _grantedImplicitReadUris = new ResourceSet();
	private readonly _implicitReadGrants = this._register(new DisposableStore());

	get clientId(): string {
		return this._clientId;
	}

	get address(): string {
		return this._address;
	}

	get defaultDirectory(): string | undefined {
		return this._defaultDirectory;
	}

	get connectionState(): AgentHostClientState {
		return this._state.kind;
	}

	get nextReconnectAt(): number | undefined {
		return this._state.kind === AgentHostClientState.Reconnecting
			? this._state.reconnect.nextAttemptAt
			: undefined;
	}

	get initializeResult(): IObservable<InitializeResult | undefined> {
		return this._initializeResult;
	}

	constructor(
		identity: AgentHostResourceIdentity,
		transportOrFactory: IProtocolTransport | (() => IProtocolTransport),
		options: IAgentHostProtocolClientOptions | undefined,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostResourceService private readonly _resourceService: IAgentHostResourceService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly _workspaceTrustRequestService: IWorkspaceTrustRequestService,
	) {
		super();
		this._resourceIdentity = identity;
		this._address = identity === LOCAL_AGENT_HOST_RESOURCE_IDENTITY ? AMBIENT_AGENT_HOST_AUTHORITY : identity;
		this._clientId = options?.clientId ?? generateUuid();
		this._connectionAuthority = identity === LOCAL_AGENT_HOST_RESOURCE_IDENTITY ? AMBIENT_AGENT_HOST_AUTHORITY : agentHostAuthority(identity);
		this.resourceUris = identity === LOCAL_AGENT_HOST_RESOURCE_IDENTITY
			? identityAgentHostResourceUriMapper
			: createAgentHostResourceUriMapper(this._connectionAuthority);
		this._loadEstimator = options?.loadEstimator ?? LoadEstimator.getInstance();
		this._clientInfo = options?.clientInfo;
		this._reconnectPolicy = options?.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY;
		this._resolveInitialAuthentication = options?.resolveInitialAuthentication;

		if (typeof transportOrFactory === 'function') {
			this._transportFactory = transportOrFactory;
			this._installTransport(transportOrFactory());
		} else {
			this._transportFactory = undefined;
			this._installTransport(transportOrFactory);
		}

		this._subscriptionManager = this._register(new AgentSubscriptionManager(
			this._clientId,
			() => this.nextClientSeq(),
			msg => this._logService.warn(`[AgentHostProtocolClient] ${msg}`),
			resource => this.subscribe(resource),
			resource => this.unsubscribe(resource),
		));

		this._register(this.onDidAction(envelope => {
			this._subscriptionManager.receiveEnvelope(envelope);
		}));

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (this._state.kind !== AgentHostClientState.Connected) {
				return;
			}
			const patch: Record<string, unknown> = {};
			const mirrored: string[] = [];
			if (e.source !== ConfigurationTarget.WORKSPACE && e.source !== ConfigurationTarget.WORKSPACE_FOLDER && e.source !== ConfigurationTarget.MEMORY) {
				for (const entry of getAgentHostConfigurationSyncEntries(getAgentHostConfigurationSyncTarget(this._resourceIdentity))) {
					if (!e.affectsConfiguration(entry.settingId)) {
						continue;
					}
					const value = resolveAgentHostConfigurationSyncValue(this._configurationService, entry);
					if (value !== undefined) {
						patch[entry.sync.key] = value;
						mirrored.push(`${entry.sync.key}=${formatAgentHostConfigurationSyncValueForLog(entry.settingId, value)} (${entry.settingId})`);
					}
				}
			}
			if (Object.keys(patch).length) {
				this._logService.info(`[RemoteAgentHostProtocol] Mirroring configuration to host root config from ${ConfigurationTargetToString(e.source)}: ${mirrored.join(', ')}`);
				this._dispatchRootConfig(patch);
			}
			if (e.affectsConfiguration(GLOBAL_AUTO_APPROVE_SETTING_ID)) {
				this._updateAutoApprovePolicyRestriction();
			}
			if (e.affectsConfiguration(TELEMETRY_SETTING_ID) || e.affectsConfiguration(TELEMETRY_OLD_SETTING_ID) || e.affectsConfiguration(TELEMETRY_CRASH_REPORTER_SETTING_ID)) {
				this._updateTelemetryLevel();
			}
			if (e.affectsConfiguration(TERMINAL_AUTO_APPROVE_ENABLED_SETTING_ID)) {
				this._updateTerminalAutoApproveEnabled();
			}
			if (e.affectsConfiguration(TERMINAL_AUTO_APPROVE_SETTING_ID) || e.affectsConfiguration(TERMINAL_IGNORE_DEFAULT_AUTO_APPROVE_RULES_SETTING_ID)) {
				this._updateTerminalAutoApproveRules();
			}
			if (e.affectsConfiguration(DISABLE_REPO_INFO_TELEMETRY_SETTING_ID)) {
				this._updateDisableRepoInfoTelemetry();
			}
			if (managedPermissionsConfigurationIds.some(settingId => e.affectsConfiguration(settingId))) {
				void this._updateManagedSettingsPermissions();
			}
		}));

		if (!isClientTransport(this._transport)) {
			this._resetLivenessTimers();
		}
	}

	private _installTransport(transport: IProtocolTransport): void {
		const listeners = new DisposableStore();
		listeners.add(transport);
		listeners.add(transport.onMessage(msg => this._handleMessage(msg)));
		listeners.add(transport.onClose(() => this._handleTransportClose()));
		this._transport = transport;
		this._transportListeners.value = listeners;
	}

	private _transitionTo(next: ClientState): void {
		if (this._state.kind === next.kind) {
			return;
		}
		if (this._state.kind === AgentHostClientState.Reconnecting) {
			const reconnect = this._state.reconnect;
			if (reconnect.timeoutHandle !== undefined) {
				clearTimeout(reconnect.timeoutHandle);
				reconnect.timeoutHandle = undefined;
			}
			reconnect.nextAttemptAt = undefined;
		}
		this._state = next;
		this._onDidChangeConnectionState.fire(next.kind);
	}

	private _newReconnectGate(): DeferredPromise<void> {
		const deferred = new DeferredPromise<void>();
		deferred.p.then(undefined, () => { });
		return deferred;
	}

	private _newReconnectState(): IReconnectState {
		return { gate: this._newReconnectGate(), outbox: [], attempt: 0, timeoutHandle: undefined, nextAttemptAt: undefined };
	}

	override dispose(): void {
		this._handleClose(connectionDisposedError(this._address));
		super.dispose();
	}

	async connect(): Promise<void> {
		try {
			if (isClientTransport(this._transport)) {
				await this._raceClose(this._transport.connect());
			}
			if (this._state.kind !== AgentHostClientState.Connecting) {
				throw transportLostError(this._address);
			}

			const result = await this._dispatchRequest<IAgentHostExtensionInitializeResult>('initialize', {
				channel: ROOT_STATE_URI,
				protocolVersions: [...CLIENT_SUPPORTED_PROTOCOL_VERSIONS],
				clientId: this._clientId,
				clientInfo: this._clientInfo,
				_meta: this._clientMeta(),
				initialSubscriptions: [ROOT_STATE_URI],
			}, { bypassInitializeQueue: true });
			this._applyInitializeResult(result);
			if (this._resolveInitialAuthentication || this._authentication.size > 0) {
				await this._restoreAuthenticationAfterFreshInitialize(AgentHostClientState.Connecting);
				if (this._state.kind !== AgentHostClientState.Connecting) {
					throw transportLostError(this._address);
				}
			}

			for (const snapshot of result.snapshots ?? []) {
				if (isAhpRootChannel(snapshot.resource)) {
					this._subscriptionManager.handleRootSnapshot(snapshot.state as RootState, snapshot.fromSeq);
				}
			}

			if (isClientTransport(this._transport) && this._state.kind === AgentHostClientState.Connecting) {
				for (const message of this._state.outbox) {
					this._transport.send(message);
				}
				this._state.outbox.length = 0;
			}
			this._transitionTo({ kind: AgentHostClientState.Connected });
			this._resetLivenessTimers();
		} catch (error) {
			const protocolError = error instanceof ProtocolError
				? error
				: new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, error instanceof Error ? error.message : String(error));
			if (protocolError.code === AhpErrorCodes.UnsupportedProtocolVersion || error instanceof InitialAuthenticationError) {
				this._cancelLivenessTimers();
				if (this._state.kind === AgentHostClientState.Connecting) {
					this._state.outbox.length = 0;
				}
				this._rejectPendingRequests(protocolError);
				this._transitionTo({ kind: AgentHostClientState.Incompatible, error: protocolError });
				throw error;
			}
			if (error instanceof NonReconnectableTransportError) {
				this._handleFatalClose(protocolError, error.reason);
				throw error;
			}
			if (this._state.kind === AgentHostClientState.Reconnecting) {
				throw error;
			}
			if (protocolError.code === AHP_CLIENT_CONNECTION_CLOSED && this._beginReconnectFromConnecting(protocolError)) {
				throw error;
			}
			this._handleClose(protocolError);
			throw error;
		}
	}

	notifyTransportClosed(): void {
		this._handleTransportClose();
	}

	private _handleTransportClose(): void {
		switch (this._state.kind) {
			case AgentHostClientState.Closed:
				return;
			case AgentHostClientState.Connecting:
				if (!this._beginReconnectFromConnecting(connectionClosedError(this._address))) {
					this._handleClose(connectionClosedError(this._address));
				}
				return;
			case AgentHostClientState.Incompatible:
				this._handleClose(connectionClosedError(this._address));
				return;
			case AgentHostClientState.Connected: {
				if (!this._transportFactory) {
					this._handleClose(connectionClosedError(this._address));
					return;
				}
				if (!this._reconnectPolicy.autoRestore) {
					const error = connectionClosedError(this._address);
					this._logService.info(`[RemoteAgentHostProtocol] Transport lost for ${this._address}; automatic reconnect is disabled.`);
					this._handleFatalClose(error);
					return;
				}
				this._logService.info(`[RemoteAgentHostProtocol] Transport lost for ${this._address}; scheduling reconnect.`);
				this._transitionTo({ kind: AgentHostClientState.Reconnecting, reconnect: this._newReconnectState() });
				this._cancelLivenessTimers();
				this._rejectPendingRequests(transportLostError(this._address));
				this._scheduleReconnect();
				return;
			}
			case AgentHostClientState.Reconnecting:
				this._logService.info(`[RemoteAgentHostProtocol] Transport lost for ${this._address} mid-reconnect; aborting the current attempt.`);
				this._cancelLivenessTimers();
				this._rejectPendingRequests(transportLostError(this._address));
				return;
		}
	}

	private _beginReconnectFromConnecting(error: ProtocolError): boolean {
		if (this._state.kind !== AgentHostClientState.Connecting || !this._transportFactory) {
			return false;
		}
		if (!this._reconnectPolicy.autoRestore) {
			this._logService.info(`[RemoteAgentHostProtocol] Transport lost while connecting to ${this._address}; automatic reconnect is disabled.`);
			this._handleFatalClose(error);
			return true;
		}
		this._logService.info(`[RemoteAgentHostProtocol] Transport lost while connecting to ${this._address}; scheduling a fresh initialize.`);
		const outbox = this._state.outbox;
		this._rejectPendingRequests(error);
		this._grantedImplicitReadUris.clear();
		this._implicitReadGrants.clear();
		this._transitionTo({
			kind: AgentHostClientState.Reconnecting,
			reconnect: { ...this._newReconnectState(), outbox },
		});
		this._cancelLivenessTimers();
		this._scheduleReconnect();
		return true;
	}

	reconnectFromClosed(): boolean {
		if (this._state.kind !== AgentHostClientState.Closed || !this._transportFactory || this._store.isDisposed) {
			return false;
		}
		this._transitionTo({ kind: AgentHostClientState.Reconnecting, reconnect: this._newReconnectState() });
		this._scheduleReconnect(true);
		return true;
	}

	reconnectNow(): boolean {
		if (this._state.kind !== AgentHostClientState.Reconnecting || this._state.reconnect.timeoutHandle === undefined) {
			return false;
		}
		const reconnect = this._state.reconnect;
		clearTimeout(reconnect.timeoutHandle);
		reconnect.timeoutHandle = undefined;
		reconnect.nextAttemptAt = undefined;
		reconnect.attempt = 0;
		this._onDidScheduleReconnect.fire();
		void this._attemptReconnect();
		return true;
	}

	private _scheduleReconnect(userInitiated = false): void {
		if (this._state.kind !== AgentHostClientState.Reconnecting || !this._transportFactory) {
			return;
		}
		const reconnect = this._state.reconnect;
		if (reconnect.timeoutHandle !== undefined) {
			return;
		}
		if (!userInitiated && !this._reconnectPolicy.autoRestore) {
			const error = connectionClosedError(this._address);
			this._logService.info(`[RemoteAgentHostProtocol] Automatic reconnect to ${this._address} is disabled.`);
			this._handleFatalClose(error);
			return;
		}
		if (!userInitiated && hasExhaustedReconnectAttempts(this._reconnectPolicy, reconnect.attempt)) {
			const error = new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, `Automatic reconnect gave up after ${reconnect.attempt} attempts.`);
			this._logService.warn(`[RemoteAgentHostProtocol] Automatic reconnect to ${this._address} gave up after ${reconnect.attempt} attempts.`);
			this._handleFatalClose(error);
			return;
		}
		const attempt = reconnect.attempt + 1;
		const delay = computeReconnectDelay(this._reconnectPolicy, attempt);
		this._logService.info(`[RemoteAgentHostProtocol] Reconnecting to ${this._address} in ${delay}ms (attempt ${attempt}).`);
		reconnect.nextAttemptAt = Date.now() + delay;
		reconnect.timeoutHandle = setTimeout(() => {
			if (this._state.kind === AgentHostClientState.Reconnecting) {
				this._state.reconnect.timeoutHandle = undefined;
				this._state.reconnect.nextAttemptAt = undefined;
			}
			void this._attemptReconnect();
		}, delay);
		this._onDidScheduleReconnect.fire();
	}

	private async _attemptReconnect(): Promise<void> {
		if (this._state.kind !== AgentHostClientState.Reconnecting || !this._transportFactory) {
			return;
		}
		const reconnect = this._state.reconnect;
		reconnect.attempt++;
		let transport: IProtocolTransport | undefined;
		try {
			transport = this._transportFactory();
			this._installTransport(transport);
			if (isClientTransport(transport)) {
				await transport.connect();
			}
			if (this._state.kind !== AgentHostClientState.Reconnecting) {
				return;
			}

			const subscriptions = this._subscriptionManager.currentSubscriptionUris().map(u => u.toString());
			if (!subscriptions.includes(ROOT_STATE_URI)) {
				subscriptions.unshift(ROOT_STATE_URI);
			}
			const lastSeenServerSeq = this._serverSeq;
			const { result, freshInitialize } = await this._reconnectOrInitialize(lastSeenServerSeq, subscriptions);

			if (this._state.kind !== AgentHostClientState.Reconnecting) {
				return;
			}

			this._applyReconnectResult(result, freshInitialize);
			this._updateManagedSettingsPermissions(true);
			if ((freshInitialize && result.type === ReconnectResultType.Snapshot) || this._authenticationRestorePending) {
				if (freshInitialize && result.type === ReconnectResultType.Snapshot) {
					this._markSubscriptionsAwaitingRestore(result.snapshots);
				}
				await this._restoreAuthenticationAfterFreshInitialize(AgentHostClientState.Reconnecting);
				if (this._state.kind !== AgentHostClientState.Reconnecting) {
					return;
				}
			}
			if (this._subscriptionsAwaitingRestore.size > 0) {
				await this._restoreSubscriptionsAwaitingRestore();
				if (this._state.kind !== AgentHostClientState.Reconnecting) {
					return;
				}
			}

			this._forwardClientConfig(false);

			const { gate } = reconnect;
			this._drainAfterReconnect(reconnect.outbox);

			this._lastReadTime = Date.now();
			this._resetLivenessTimers();
			this._transitionTo({ kind: AgentHostClientState.Connected });
			gate.complete();
			this._logService.info(`[RemoteAgentHostProtocol] Reconnected to ${this._address}.`);
		} catch (err) {
			this._logService.warn(`[RemoteAgentHostProtocol] Reconnect attempt failed for ${this._address}: ${err instanceof Error ? err.message : String(err)}`);
			transport?.dispose();
			if (this._state.kind !== AgentHostClientState.Reconnecting) {
				return;
			}
			if (err instanceof NonReconnectableTransportError) {
				const protocolError = new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, err.message);
				this._handleFatalClose(protocolError, err.reason);
				return;
			}
			if (err instanceof InitialAuthenticationError) {
				const protocolError = new ProtocolError(AHP_CLIENT_CONNECTION_CLOSED, err.message);
				this._cancelLivenessTimers();
				this._rejectPendingRequests(protocolError);
				reconnect.gate.error(err);
				this._transitionTo({ kind: AgentHostClientState.Incompatible, error: protocolError });
				return;
			}
			const oldGate = this._state.reconnect.gate;
			this._state.reconnect.gate = this._newReconnectGate();
			oldGate.error(err);
			this._scheduleReconnect();
		}
	}

	private async _reconnectOrInitialize(lastSeenServerSeq: number, subscriptions: string[]): Promise<{ result: CommandMap['reconnect']['result']; freshInitialize: boolean }> {
		try {
			const result = await this._dispatchRequest<CommandMap['reconnect']['result']>('reconnect', {
				clientId: this._clientId,
				lastSeenServerSeq,
				subscriptions,
				_meta: this._clientMeta(),
			}, { bypassReconnectGate: true });
			return { result, freshInitialize: false };
		} catch (error) {
			if (!(error instanceof ProtocolError) || error.code !== AhpErrorCodes.NotFound) {
				throw error;
			}
		}

		this._logService.info(`[RemoteAgentHostProtocol] Server forgot client ${this._clientId}; initializing a fresh connection.`);
		const initializeResult = await this._dispatchRequest<IAgentHostExtensionInitializeResult>('initialize', {
			channel: ROOT_STATE_URI,
			protocolVersions: [...CLIENT_SUPPORTED_PROTOCOL_VERSIONS],
			clientId: this._clientId,
			clientInfo: this._clientInfo,
			_meta: this._clientMeta(),
			initialSubscriptions: subscriptions,
		}, { bypassReconnectGate: true });
		this._applyInitializeResult(initializeResult, false);
		return {
			result: { type: ReconnectResultType.Snapshot, snapshots: initializeResult.snapshots ?? [] },
			freshInitialize: true,
		};
	}

	private _markSubscriptionsAwaitingRestore(initialSnapshots: readonly IStateSnapshot[]): void {
		const restored = new Set(initialSnapshots.map(snapshot => snapshot.resource));
		this._subscriptionsAwaitingRestore.clear();
		for (const subscription of this._subscriptionManager.getActiveSubscriptions()) {
			const resource = subscription.resource.toString();
			if (!restored.has(resource)) {
				this._subscriptionsAwaitingRestore.add(resource);
			}
		}
	}

	private async _restoreSubscriptionsAwaitingRestore(): Promise<void> {
		if (this._subscriptionsAwaitingRestore.size === 0) {
			return;
		}
		const pending = this._subscriptionManager.getActiveSubscriptions()
			.filter(subscription => this._subscriptionsAwaitingRestore.has(subscription.resource.toString()));
		this._subscriptionsAwaitingRestore.clear();
		for (const subscription of pending) {
			this._subscriptionsAwaitingRestore.add(subscription.resource.toString());
			this._subscriptionManager.beginSnapshotRefresh(subscription.resource);
		}
		const restoreGroup = async (subscriptions: typeof pending) => {
			await Promise.all(subscriptions.map(async subscription => {
				const resource = subscription.resource.toString();
				try {
					const result = await this._dispatchRequest<CommandMap['subscribe']['result']>('subscribe', {
						channel: resource,
					}, { bypassReconnectGate: true });
					if (!result.snapshot) {
						throw new Error(`subscribe returned no snapshot for ${resource}`);
					}
					this._subscriptionManager.applyReconnectSnapshot(
						result.snapshot.resource,
						result.snapshot.state,
						result.snapshot.fromSeq,
						true,
					);
					this._serverSeq = Math.max(this._serverSeq, result.snapshot.fromSeq);
					this._subscriptionsAwaitingRestore.delete(resource);
				} catch (error) {
					if (error instanceof ProtocolError && error.code === AHP_CLIENT_CONNECTION_CLOSED) {
						this._subscriptionManager.cancelSnapshotRefresh(subscription.resource);
						throw error;
					}
					this._logService.warn(`[AgentHostProtocolClient] Failed to restore subscription ${resource} after host restart: ${error instanceof Error ? error.message : String(error)}`);
					this._subscriptionManager.cancelSnapshotRefresh(subscription.resource);
					this._subscriptionManager.markSubscriptionsMissing([subscription.resource]);
					this._subscriptionsAwaitingRestore.delete(resource);
				}
			}));
		};

		await restoreGroup(pending.filter(subscription => subscription.kind === StateComponents.Session));
		await Promise.all([
			restoreGroup(pending.filter(subscription => subscription.kind === StateComponents.Chat)),
			restoreGroup(pending.filter(subscription => subscription.kind !== StateComponents.Session && subscription.kind !== StateComponents.Chat)),
		]);
	}

	private async _restoreAuthenticationAfterFreshInitialize(expectedState: AgentHostClientState.Connecting | AgentHostClientState.Reconnecting): Promise<void> {
		this._authenticationRestorePending = true;
		let initialAuthenticationKey: string | undefined;
		if (this._resolveInitialAuthentication) {
			try {
				const initialAuthentication = await this._resolveInitialAuthentication();
				if (initialAuthentication) {
					const normalizedParams = this._normalizeAuthenticationParams(initialAuthentication);
					initialAuthenticationKey = this._authenticationKey(normalizedParams);
					this._authentication.set(initialAuthenticationKey, normalizedParams);
				}
			} catch (error) {
				throw new InitialAuthenticationError(error);
			}
			if (this._state.kind !== expectedState) {
				return;
			}
		}
		await Promise.all([...this._authentication.entries()].map(async ([key, params]) => {
			try {
				await this._dispatchRequest<CommandMap['authenticate']['result']>('authenticate', {
					channel: ROOT_STATE_URI,
					...params,
					scopes: params.scopes ? [...params.scopes] : undefined,
				}, this._state.kind === AgentHostClientState.Connecting
					? { bypassInitializeQueue: true, bypassReconnectGate: true }
					: { bypassReconnectGate: true });
			} catch (error) {
				if (isConnectionClosedError(error)) {
					throw error;
				}
				if (key === initialAuthenticationKey) {
					throw new InitialAuthenticationError(error);
				}
				this._logService.warn(`[AgentHostProtocolClient] Failed to restore authentication for ${params.resource} after host restart: ${error instanceof Error ? error.message : String(error)}`);
			}
		}));
		this._authenticationRestorePending = false;
	}

	private _clientMeta(): Record<string, unknown> {
		const telemetryLevel = this._effectiveTelemetryLevel();
		const sendIdentity = telemetryLevel >= TelemetryLevel.USAGE;
		return toAgentHostClientMeta(
			this._transport.clientConnectionKind,
			telemetryLevel,
			sendIdentity ? this._telemetryService.machineId : undefined,
			sendIdentity ? this._telemetryService.devDeviceId : undefined,
		);
	}

	private _applyInitializeResult(result: IAgentHostExtensionInitializeResult, forwardClientConfig = true): void {
		this._initializeResult.set(result, undefined);
		this._serverSeq = result.serverSeq;
		if (result.defaultDirectory) {
			const directory = result.defaultDirectory;
			this._defaultDirectory = typeof directory === 'string' ? URI.parse(directory).path : URI.revive(directory).path;
		}
		if (forwardClientConfig) {
			this._forwardClientConfig();
		}
	}

	private _forwardClientConfig(includeManagedSettings = true): void {
		this._dispatchRootConfig(resolveAgentHostConfigurationSyncPatch(this._configurationService, getAgentHostConfigurationSyncTarget(this._resourceIdentity)));
		this._updateTelemetryLevel();
		this._updateTerminalAutoApproveEnabled();
		this._updateTerminalAutoApproveRules();
		this._updateAutoApprovePolicyRestriction();
		this._updateDisableRepoInfoTelemetry();
		if (includeManagedSettings) {
			void this._updateManagedSettingsPermissions();
		}
	}

	private _updateAutoApprovePolicyRestriction(): void {
		const policyRestricted = this._configurationService.inspect<boolean>(GLOBAL_AUTO_APPROVE_SETTING_ID)?.policyValue === false;
		this._dispatchRootConfig({ [AgentHostAutoApprovePolicyRestrictedConfigKey]: policyRestricted });
	}

	private _applyReconnectResult(result: CommandMap['reconnect']['result'], preservePending = false): void {
		if (result.type === ReconnectResultType.Replay) {
			let maxSeq = this._serverSeq;
			for (const envelope of result.actions) {
				if (envelope.origin?.clientId === this._clientId
					&& envelope.origin.clientSeq !== undefined
					&& !envelope.rejectionReason) {
					this._subscriptionManager.dropPendingAction(envelope.channel, envelope.origin.clientSeq);
				}
				if (envelope.serverSeq > maxSeq) {
					maxSeq = envelope.serverSeq;
				}
				this._onDidAction.fire(normalizeLegacyActionEnvelope(envelope));
			}
			this._serverSeq = maxSeq;
			if (result.missing.length > 0) {
				this._logService.info(`[RemoteAgentHostProtocol] Server cannot resume ${result.missing.length} subscription(s) after reconnect.`);
				this._subscriptionManager.markSubscriptionsMissing(result.missing.map(u => URI.parse(u)));
				for (const resource of result.missing) {
					this._subscriptionsAwaitingRestore.delete(resource);
				}
			}
		} else {
			let maxSeq = this._serverSeq;
			for (const snapshot of result.snapshots) {
				this._subscriptionManager.applyReconnectSnapshot(snapshot.resource, snapshot.state, snapshot.fromSeq, preservePending);
				this._subscriptionsAwaitingRestore.delete(snapshot.resource);
				if (snapshot.fromSeq > maxSeq) {
					maxSeq = snapshot.fromSeq;
				}
			}
			this._serverSeq = maxSeq;
		}
	}

	private _drainAfterReconnect(outbox: readonly ProtocolMessage[]): void {
		const queuedSeqs = new Set<number>();
		for (const msg of outbox) {
			if (hasKey(msg, { method: true }) && msg.method === 'dispatchAction') {
				queuedSeqs.add(msg.params.clientSeq);
			}
		}

		const replays: ProtocolMessage[] = [];
		for (const entry of this._subscriptionManager.getPendingActions()) {
			if (queuedSeqs.has(entry.clientSeq)) {
				continue;
			}
			this._grantImplicitReadsForOutgoingAction(entry.action);
			replays.push({
				jsonrpc: '2.0',
				method: 'dispatchAction',
				params: { channel: entry.channel, clientSeq: entry.clientSeq, action: entry.action },
			});
		}

		if (replays.length > 0) {
			this._logService.info(`[RemoteAgentHostProtocol] Replaying ${replays.length} pending action(s) after reconnect to ${this._address}.`);
		}

		for (const msg of replays) {
			this._transport.send(msg);
		}
		for (const msg of outbox) {
			this._transport.send(msg);
		}
	}


	get rootState(): IAgentSubscription<RootState> {
		return this._subscriptionManager.rootState;
	}

	getSubscription<T>(kind: StateComponents, resource: URI, owner: string): IReference<IAgentSubscription<T>> {
		return this._subscriptionManager.getSubscription<T>(kind, resource, owner);
	}

	getSubscriptionUnmanaged<T>(_kind: StateComponents, resource: URI): IAgentSubscription<T> | undefined {
		return this._subscriptionManager.getSubscriptionUnmanaged<T>(resource);
	}

	getInflightSessionCreate(resource: URI): Promise<unknown> | undefined {
		return this._subscriptionManager.getInflightSessionCreate(resource);
	}

	trackSessionCreate(resource: URI, promise: Promise<unknown>): void {
		this._subscriptionManager.trackSessionCreate(resource, promise);
	}

	getActiveSubscriptions(): readonly IActiveSubscriptionInfo[] {
		return this._subscriptionManager.getActiveSubscriptions();
	}

	dispatch(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction): void {
		const seq = this._subscriptionManager.dispatchOptimistic(channel, action);
		this.dispatchAction(channel, action, this._clientId, seq);
	}

	async subscribe(resource: URI): Promise<IStateSnapshot> {
		this._logService.trace(`[RemoteAgentHostProtocol] subscribe start: ${resource.toString()}`);
		const result = await this._sendRequest('subscribe', { channel: resource.toString() });
		if (!result.snapshot) {
			throw new Error(`subscribe to ${resource.toString()} returned no snapshot`);
		}
		this._logService.trace(`[RemoteAgentHostProtocol] subscribe done: ${resource.toString()}`);
		return result.snapshot;
	}

	async subscribeStateless(resource: URI): Promise<void> {
		await this._sendRequest('subscribe', { channel: resource.toString() });
	}

	unsubscribe(resource: URI): void {
		this._sendNotification('unsubscribe', { channel: resource.toString() });
	}

	private dispatchAction(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction, _clientId: string, clientSeq: number): void {
		this._grantImplicitReadsForOutgoingAction(action);
		this._sendNotification('dispatchAction', { channel, clientSeq, action });
	}

	createSession(config?: IAgentCreateSessionConfig): Promise<URI> {
		const provider = config?.provider;
		if (!provider) {
			throw new Error('Cannot create remote agent host session without a provider.');
		}
		const session = config?.session ?? AgentSession.uri(provider, generateUuid());
		if (config?.activeClient?.customizations) {
			this._grantImplicitReadsForCustomizations(config.activeClient.customizations);
		}
		const promise = this._sendRequest('createSession', {
			channel: session.toString(),
			_meta: config?._meta,
			provider,
			workingDirectories: config?.workingDirectories?.map(d => fromAgentHostUri(d).toString()),
			config: config?.config,
			activeClient: config?.activeClient,
			progressToken: config?.progressToken,
		}).then(() => session);
		this._subscriptionManager.trackSessionCreate(session, promise);
		return promise;
	}

	async createDetachedWorktree(session: URI, prompt: string): Promise<{ handle: string; worktree: URI }> {
		const result = await this._sendExtensionRequest(CreateAgentHostDetachedWorktreeExtensionMethod, {
			session: session.toString(),
			prompt,
		});
		if (!result) {
			throw new Error('Agent Host does not support detached worktrees.');
		}
		return { handle: result.handle, worktree: URI.parse(result.resource) };
	}

	async setDetachedWorktreeArchived(handle: string, archived: boolean): Promise<void> {
		await this._sendExtensionRequest(SetAgentHostDetachedWorktreeArchivedExtensionMethod, {
			handle,
			archived,
		});
	}

	async claimDetachedWorktree(handle: string): Promise<void> {
		await this._sendExtensionRequest(ClaimAgentHostDetachedWorktreeExtensionMethod, { handle });
	}

	async deleteDetachedWorktree(handle: string): Promise<void> {
		await this._sendExtensionRequest(DeleteAgentHostDetachedWorktreeExtensionMethod, { handle });
	}

	async reconcileDetachedWorktrees(scope: string, activeHandles: readonly string[]): Promise<void> {
		await this._sendExtensionRequest(ReconcileAgentHostDetachedWorktreesExtensionMethod, { scope, activeHandles: [...activeHandles] });
	}

	async resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult> {
		return this._sendRequest('resolveSessionConfig', {
			channel: ROOT_STATE_URI,
			provider: params.provider,
			workingDirectory: params.workingDirectory ? fromAgentHostUri(params.workingDirectory).toString() : undefined,
			config: params.config,
		});
	}

	async sessionConfigCompletions(params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return this._sendRequest('sessionConfigCompletions', {
			channel: ROOT_STATE_URI,
			provider: params.provider,
			workingDirectory: params.workingDirectory ? fromAgentHostUri(params.workingDirectory).toString() : undefined,
			config: params.config,
			property: params.property,
			query: params.query,
		});
	}

	async completions(params: CompletionsParams): Promise<CompletionsResult> {
		return this._sendRequest('completions', params);
	}

	async listAutomationTriggerDefinitions(params: ListAutomationTriggerDefinitionsParams): Promise<ListAutomationTriggerDefinitionsResult> {
		return this._sendRequest('listAutomationTriggerDefinitions', params);
	}

	async runAutomation(params: RunAutomationParams): Promise<RunAutomationResult> {
		return this._sendRequest('runAutomation', params);
	}

	async fetchAutomationRuns(params: FetchAutomationRunsParams): Promise<FetchAutomationRunsResult> {
		return this._sendRequest('fetchAutomationRuns', params);
	}

	async ping(): Promise<void> {
		await this._sendRequest('ping', { channel: ROOT_STATE_URI });
	}

	async getCompletionTriggerCharacters(): Promise<readonly string[]> {
		while (this._state.kind === AgentHostClientState.Connecting) {
			await Event.toPromise(this.onDidChangeConnectionState);
		}
		switch (this._state.kind) {
			case AgentHostClientState.Incompatible:
			case AgentHostClientState.Closed:
				throw this._state.error;
			case AgentHostClientState.Connected:
			case AgentHostClientState.Reconnecting:
				return this._initializeResult.get()?.completionTriggerCharacters ?? [];
		}
	}

	async authenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
		const normalizedParams = this._normalizeAuthenticationParams(params);
		await this._sendRequest('authenticate', {
			channel: ROOT_STATE_URI,
			...normalizedParams,
			scopes: normalizedParams.scopes ? [...normalizedParams.scopes] : undefined,
		});
		const key = this._authenticationKey(normalizedParams);
		if (params.token) {
			this._authentication.set(key, normalizedParams);
		} else {
			this._authentication.delete(key);
		}
		return { authenticated: true };
	}

	private _normalizeAuthenticationParams(params: AuthenticateParams): AuthenticateParams {
		return {
			...params,
			scopes: params.scopes ? [...new Set(params.scopes)].sort() : undefined,
		};
	}

	private _authenticationKey(params: AuthenticateParams): string {
		return `${params.resource}\0${JSON.stringify(params.scopes ?? [])}`;
	}

	async shutdown(): Promise<void> {
		await this._sendExtensionRequest('shutdown');
	}

	async getNetworkDiagnosticsInfo(): Promise<IAgentHostNetworkDiagnosticsInfo> {
		return this._sendExtensionRequest('getNetworkDiagnosticsInfo');
	}

	async getManagedSettingsDiagnostics(): Promise<readonly IAgentHostManagedSettingsDiagnostics[]> {
		return this._sendExtensionRequest('getManagedSettingsDiagnostics');
	}

	async getSessionStateFile(session: URI, chat?: URI): Promise<URI | undefined> {
		const targetChat = chat && !isDefaultChatUri(chat) ? chat : undefined;
		if (targetChat && !supportsAgentHostChatStateFile(this._initializeResult.get())) {
			return undefined;
		}
		const result = await this._sendExtensionRequest(GetAgentHostSessionStateFileExtensionMethod, {
			session: session.toString(),
			chat: targetChat?.toString(),
		});
		if (!result.resource) {
			return undefined;
		}
		const resource = URI.parse(result.resource, true);
		if (resource.scheme !== Schemas.file) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Agent Host returned a non-file session state resource: ${resource.toString()}`);
		}
		return toAgentHostUri(resource, this._connectionAuthority);
	}

	async collectDebugLogs(session: URI | undefined, kind: AgentHostDebugLogsArtifactKind, chat?: URI): Promise<IAgentHostDebugLogsArtifact> {
		const result = await this._sendExtensionRequest(CollectAgentHostDebugLogsExtensionMethod, {
			session: session?.toString(),
			chat: chat?.toString(),
			kind,
		});
		if (result.kind !== kind) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Agent Host returned ${result.kind} debug logs for a ${kind} request`);
		}
		const resource = URI.parse(result.resource, true);
		if (resource.scheme !== Schemas.file) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Agent Host returned a non-file debug log resource: ${resource.toString()}`);
		}
		if (!Number.isSafeInteger(result.size) || result.size < 0
			|| !Number.isSafeInteger(result.uncompressedSize) || result.uncompressedSize < 0) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'Agent Host returned invalid debug log artifact sizes');
		}
		if (!Array.isArray(result.entries) || result.entries.length > AGENT_HOST_DEBUG_LOGS_MAX_ENTRIES) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'Agent Host returned an invalid debug log artifact manifest');
		}
		const entryPaths = new Set<string>();
		let manifestSize = 0;
		for (const entry of result.entries) {
			const segments = entry.path.split('/');
			if (!entry.path || entry.path.includes('\\') || segments.some((segment: string) => !segment || segment === '.' || segment === '..')
				|| !Number.isSafeInteger(entry.size) || entry.size < 0
				|| entryPaths.has(entry.path)) {
				throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'Agent Host returned an invalid debug log artifact manifest entry');
			}
			entryPaths.add(entry.path);
			manifestSize += entry.size;
		}
		if (!Number.isSafeInteger(manifestSize) || manifestSize !== result.uncompressedSize) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'Agent Host debug log artifact manifest size does not match its declared size');
		}
		return {
			kind: result.kind,
			resource: toAgentHostUri(resource, this._connectionAuthority),
			providerLogsIncluded: result.providerLogsIncluded,
			size: result.size,
			uncompressedSize: result.uncompressedSize,
			entries: result.entries,
		};
	}

	async readDebugLogsChunk(resource: URI, position: number): Promise<IAgentHostDebugLogsChunk> {
		const result = await this._sendExtensionRequest(ReadAgentHostDebugLogsChunkExtensionMethod, {
			resource: fromAgentHostUri(resource).toString(),
			position,
		});
		const data = decodeBase64(result.data);
		if (data.byteLength > AGENT_HOST_DEBUG_LOGS_CHUNK_BYTES) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'Agent Host returned an oversized debug log chunk');
		}
		return { data, eof: result.eof === true };
	}

	async diagnosticsFetch(url: string): Promise<IAgentHostNetworkFetchResult> {
		return this._sendExtensionRequest('diagnosticsFetch', { url });
	}

	async disposeSession(session: URI): Promise<void> {
		await this._sendRequest('disposeSession', { channel: session.toString() });
	}

	async createChat(session: URI, chat: URI, options?: IAgentCreateChatRequestOptions): Promise<void> {
		await this._sendRequest('createChat', {
			channel: session.toString(),
			chat: chat.toString(),
			...(options?.fork ? {
				source: { kind: ChatSourceKind.Fork, chat: options.fork.source.toString(), turnId: options.fork.turnId }
			} : {}),
			...(options?.sideChat ? {
				source: {
					kind: ChatSourceKind.SideChat,
					chat: options.sideChat.source.toString(),
					turnId: options.sideChat.turnId,
					...(options.sideChat.selection ? { selection: options.sideChat.selection } : {}),
				}
			} : {}),
		});
	}

	async disposeChat(chat: URI): Promise<void> {
		await this._sendRequest('disposeChat', { channel: chat.toString() });
	}

	async createTerminal(params: CreateTerminalParams): Promise<void> {
		await this._sendRequest('createTerminal', params);
	}

	async disposeTerminal(terminal: URI): Promise<void> {
		await this._sendRequest('disposeTerminal', { channel: terminal.toString() });
	}

	async invokeChangesetOperation(params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult> {
		return await this._sendRequest('invokeChangesetOperation', params);
	}

	async handleMcpRequest(channel: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
		return await this._dispatchRequest<unknown>(method, { ...(params ?? {}), channel });
	}

	async listSessions(): Promise<(IAgentSessionMetadata & { readonly workingDirectory?: URI })[]> {
		const result = await this._sendRequest('listSessions', { channel: ROOT_STATE_URI });
		return result.items.map((s: SessionSummary) => ({
			session: URI.parse(s.resource),
			startTime: Date.parse(s.createdAt),
			modifiedTime: Date.parse(s.modifiedAt),
			...(s.project ? {
				project: {
					uri: this._toClientUri(URI.parse(s.project.uri)),
					displayName: s.project.displayName,
				}
			} : {}),
			summary: s.title,
			status: s.status,
			activity: s.activity,
			workingDirectory: typeof s.workingDirectories?.[0] === 'string' ? this._toClientUri(URI.parse(s.workingDirectories[0])) : undefined,
			workingDirectories: s.workingDirectories?.map(d => this._toClientUri(URI.parse(d))),
			changes: s.changes,
			...(s._meta !== undefined ? { _meta: s._meta } : {}),
		}));
	}

	private _toClientUri(uri: URI): URI {
		return uri.scheme === Schemas.file ? toAgentHostUri(uri, this._connectionAuthority) : uri;
	}

	private _grantImplicitReadsForOutgoingAction(action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction): void {
		switch (action.type) {
			case ActionType.SessionActiveClientSet:
				if (action.activeClient.customizations) {
					this._grantImplicitReadsForCustomizations(action.activeClient.customizations);
				}
				break;
			case ActionType.ChatTurnStarted:
			case ActionType.ChatPendingMessageSet:
				this._grantImplicitReadsForMessage(action.message);
				break;
		}
	}

	private _grantImplicitReadsForMessage(message: Message): void {
		for (const attachment of message.attachments ?? []) {
			if (attachment.type !== MessageAttachmentKind.Resource) {
				continue;
			}
			try {
				this._grantImplicitRead(URI.parse(attachment.uri));
			} catch {
				continue;
			}
		}
	}

	private _grantImplicitReadsForCustomizations(refs: readonly ClientPluginCustomization[]): void {
		for (const ref of refs) {
			let uri: URI;
			try {
				uri = URI.parse(ref.uri);
			} catch {
				continue;
			}
			this._grantImplicitRead(uri);
		}
	}

	private _grantImplicitRead(uri: URI): void {
		if (this._grantedImplicitReadUris.has(uri)) {
			return;
		}
		this._grantedImplicitReadUris.add(uri);
		this._implicitReadGrants.add(this._resourceService.grantImplicitRead(this._resourceIdentity, uri));
	}

	async resourceList(uri: URI): Promise<CommandMap['resourceList']['result']> {
		return await this._sendRequest('resourceList', { channel: ROOT_STATE_URI, uri: uri.toString() });
	}

	async resourceRead(uri: URI, encoding?: ContentEncoding): Promise<CommandMap['resourceRead']['result']> {
		return this._sendRequest('resourceRead', { channel: ROOT_STATE_URI, uri: uri.toString(), encoding });
	}

	async resourceWrite(params: CommandMap['resourceWrite']['params']): Promise<CommandMap['resourceWrite']['result']> {
		return this._sendRequest('resourceWrite', params);
	}

	async resourceCopy(params: CommandMap['resourceCopy']['params']): Promise<CommandMap['resourceCopy']['result']> {
		return this._sendRequest('resourceCopy', params);
	}

	async resourceDelete(params: CommandMap['resourceDelete']['params']): Promise<CommandMap['resourceDelete']['result']> {
		return this._sendRequest('resourceDelete', params);
	}

	async resourceMove(params: CommandMap['resourceMove']['params']): Promise<CommandMap['resourceMove']['result']> {
		return this._sendRequest('resourceMove', params);
	}

	async resourceResolve(params: CommandMap['resourceResolve']['params']): Promise<CommandMap['resourceResolve']['result']> {
		return this._sendRequest('resourceResolve', params);
	}

	async resourceMkdir(params: CommandMap['resourceMkdir']['params']): Promise<CommandMap['resourceMkdir']['result']> {
		return this._sendRequest('resourceMkdir', params);
	}

	async createResourceWatch(params: CommandMap['createResourceWatch']['params']): Promise<CommandMap['createResourceWatch']['result']> {
		return this._sendRequest('createResourceWatch', params);
	}

	watchResource(params: CommandMap['createResourceWatch']['params']): Promise<IRemoteWatchHandle> {
		return createRemoteWatchHandle({
			createResourceWatch: p => this.createResourceWatch(p),
			subscribe: uri => this.subscribe(uri),
			unsubscribe: uri => this.unsubscribe(uri),
			onDidAction: this.onDidAction,
		}, params);
	}

	triggerVscodeUpgrade(method: string): Promise<IVscodeUpgradeResult> {
		return this._dispatchRequest<IVscodeUpgradeResult>(method, {}, { allowIncompatibleUpgrade: true });
	}

	private _handleMessage(msg: ProtocolMessage): void {
		if (this._state.kind === AgentHostClientState.Closed) {
			return;
		}

		this._lastReadTime = Date.now();
		this._resetLivenessTimers();

		if (isJsonRpcRequest(msg)) {
			this._handleReverseRequest(msg.id, msg.method, msg.params);
		} else if (isJsonRpcResponse(msg)) {
			const pending = this._pendingRequests.get(msg.id);
			if (pending) {
				this._pendingRequests.delete(msg.id);
				if (hasKey(msg, { error: true })) {
					if (this._shouldLogFailedRequest(pending, msg.error)) {
						this._logService.warn(`[RemoteAgentHostProtocol] Request ${msg.id} failed:`, msg.error);
					}
					pending.deferred.error(this._toProtocolError(msg.error));
				} else {
					pending.deferred.complete(msg.result);
				}
			} else {
				this._logService.warn(`[RemoteAgentHostProtocol] Received response for unknown request id ${msg.id}`);
			}
		} else if (isJsonRpcNotification(msg)) {
			switch (msg.method) {
				case 'action': {
					const envelope = msg.params;
					this._serverSeq = Math.max(this._serverSeq, envelope.serverSeq);
					this._onDidAction.fire(normalizeLegacyActionEnvelope(envelope));
					break;
				}
				case 'root/sessionAdded':
				case 'root/sessionRemoved':
				case 'root/sessionSummaryChanged':
				case 'root/progress':
				case 'auth/required': {
					this._logService.trace(`[RemoteAgentHostProtocol] Notification: ${msg.method}`);
					// eslint-disable-next-line local/code-no-dangerous-type-assertions
					this._onDidNotification.fire({ type: msg.method, ...msg.params } as INotification);
					break;
				}
				case 'otlp/exportLogs':
					this._onDidReceiveOtlpLogs.fire(msg.params);
					break;
				case 'otlp/exportTraces':
				case 'otlp/exportMetrics':
					break;
				default: {
					const rawChannel = msg.params && typeof msg.params === 'object'
						? (msg.params as { channel?: unknown }).channel
						: undefined;
					if (typeof rawChannel === 'string' && rawChannel.toLowerCase().startsWith('mcp:/')) {
						const { channel: _channel, ...rest } = msg.params as { channel: string;[k: string]: unknown };
						this._onMcpNotification.fire({ channel: rawChannel, method: msg.method, params: rest });
						break;
					}
					this._logService.trace(`[RemoteAgentHostProtocol] Unhandled method: ${msg.method}`);
					break;
				}
			}
		} else {
			this._logService.warn(`[RemoteAgentHostProtocol] Unrecognized message:`, JSON.stringify(msg));
		}
	}

	private _handleFatalClose(error: ProtocolError, reason?: AgentHostTransportFailureReason): void {
		this._onDidFatalClose.fire(error);
		this._handleClose(error, reason);
	}

	private _handleClose(error: ProtocolError, reason?: AgentHostTransportFailureReason): void {
		if (this._state.kind === AgentHostClientState.Closed) {
			return;
		}
		this._cancelLivenessTimers();
		if (this._state.kind === AgentHostClientState.Reconnecting) {
			const reconnect = this._state.reconnect;
			if (reconnect.timeoutHandle !== undefined) {
				clearTimeout(reconnect.timeoutHandle);
			}
			if (!reconnect.gate.isSettled) {
				reconnect.gate.error(error);
			}
		}
		if (this._state.kind === AgentHostClientState.Connecting) {
			this._state.outbox.length = 0;
		}
		this._rejectPendingRequests(error);
		this._grantedImplicitReadUris.clear();
		this._implicitReadGrants.clear();
		this._resourceService.connectionClosed(this._resourceIdentity);
		this._transitionTo({ kind: AgentHostClientState.Closed, error });
		this._onDidClose.fire(reason);
	}

	private async _raceClose<T>(promise: Promise<T>): Promise<T> {
		if (this._state.kind === AgentHostClientState.Closed) {
			return Promise.reject(this._state.error);
		}

		let closeListener = Disposable.None;
		const closePromise = new Promise<never>((_resolve, reject) => {
			closeListener = this.onDidClose(() => reject(this._state.kind === AgentHostClientState.Closed ? this._state.error : connectionClosedError(this._address)));
		});

		try {
			return await Promise.race([promise, closePromise]);
		} finally {
			closeListener.dispose();
		}
	}

	private _handleReverseRequest(id: number, method: string, params: unknown): void {
		const transport = this._transport;
		this._pendingReverseRequests.set(transport, (this._pendingReverseRequests.get(transport) ?? 0) + 1);
		const sendResponse = (response: JsonRpcResponse) => {
			try {
				transport.send(response);
			} finally {
				const pending = this._pendingReverseRequests.get(transport);
				if (pending === 1) {
					this._pendingReverseRequests.delete(transport);
					if (transport === this._transport) {
						this._resetLivenessTimers();
					}
				} else if (pending !== undefined) {
					this._pendingReverseRequests.set(transport, pending - 1);
				}
			}
		};
		const sendResult = (result: unknown) => {
			sendResponse({ jsonrpc: '2.0', id, result });
		};
		const sendError = (err: unknown) => {
			if (err instanceof AgentHostResourcePermissionError) {
				sendResponse({
					jsonrpc: '2.0',
					id,
					error: {
						code: AhpErrorCodes.PermissionDenied,
						message: err.message,
						data: err.request ? { request: err.request } : undefined,
					},
				});
				return;
			}
			const fsCode = toFileSystemProviderErrorCode(err instanceof Error ? err : undefined);
			let code = -32000;
			switch (fsCode) {
				case FileSystemProviderErrorCode.FileNotFound: code = AhpErrorCodes.NotFound; break;
				case FileSystemProviderErrorCode.NoPermissions: code = AhpErrorCodes.PermissionDenied; break;
				case FileSystemProviderErrorCode.FileExists: code = AhpErrorCodes.AlreadyExists; break;
			}
			sendResponse({ jsonrpc: '2.0', id, error: { code, message: err instanceof Error ? err.message : String(err) } });
		};

		const p = (params ?? {}) as Record<string, unknown>;
		const identity = this._resourceIdentity;
		void (async () => {
			try {
				switch (method) {
					case RequestAgentHostWorkspaceTrustExtensionMethod: {
						if (typeof p.workspace !== 'string') {
							throw new Error('Missing workspace');
						}
						const hostWorkspace = URI.parse(p.workspace, true);
						if (hostWorkspace.scheme !== Schemas.file || !hostWorkspace.path.startsWith('/')) {
							throw new Error('Workspace must be an absolute file URI');
						}
						const workspace = this.resourceUris.fromAgentHost(hostWorkspace);
						if (p.trustedParent !== undefined) {
							if (typeof p.trustedParent !== 'string') {
								throw new Error('Invalid trustedParent');
							}
							const hostParent = URI.parse(p.trustedParent, true);
							if (hostParent.scheme !== Schemas.file || !hostParent.path.startsWith('/')) {
								throw new Error('Trusted parent must be an absolute file URI');
							}
							if (!isWorktreeUnderRepository(hostWorkspace, hostParent)) {
								throw new Error('Workspace is not a managed worktree under the trusted parent');
							}
							const parent = this.resourceUris.fromAgentHost(hostParent);
							const parentTrust = await this._workspaceTrustManagementService.getUriTrustInfo(parent);
							if (parentTrust.trusted) {
								const workspaceTrust = await this._workspaceTrustManagementService.getUriTrustInfo(workspace);
								if (!workspaceTrust.trusted) {
									await this._workspaceTrustManagementService.setUrisTrust([workspace], true);
								}
								sendResult({ trusted: true } satisfies IAgentHostExtensionServerCommandMap[typeof RequestAgentHostWorkspaceTrustExtensionMethod]['result']);
								return;
							}
						}
						const trusted = await this._workspaceTrustRequestService.requestResourcesTrust({
							uri: workspace,
							message: localize('agentHost.trustWorkspaceMessage', "An agent session will be able to read files, run commands, and make changes in this folder."),
						});
						sendResult({ trusted: trusted === true } satisfies IAgentHostExtensionServerCommandMap[typeof RequestAgentHostWorkspaceTrustExtensionMethod]['result']);
						return;
					}
					case 'resourceList': {
						if (!p.uri) { throw new Error('Missing uri'); }
						const result = await this._resourceService.list(identity, URI.parse(p.uri as string));
						sendResult({ entries: result.entries });
						return;
					}
					case 'resourceRead': {
						if (!p.uri) { throw new Error('Missing uri'); }
						const result = await this._resourceService.read(identity, URI.parse(p.uri as string));
						sendResult({ data: encodeBase64(result.bytes), encoding: ContentEncoding.Base64 });
						return;
					}
					case 'resourceWrite': {
						if (!p.uri || p.data === undefined) { throw new Error('Missing uri or data'); }
						await this._resourceService.write(identity, p as unknown as Parameters<typeof this._resourceService.write>[1]);
						sendResult({});
						return;
					}
					case 'resourceDelete': {
						if (!p.uri) { throw new Error('Missing uri'); }
						await this._resourceService.del(identity, p as unknown as Parameters<typeof this._resourceService.del>[1]);
						sendResult({});
						return;
					}
					case 'resourceMove': {
						if (!p.source || !p.destination) { throw new Error('Missing source or destination'); }
						await this._resourceService.move(identity, p as unknown as Parameters<typeof this._resourceService.move>[1]);
						sendResult({});
						return;
					}
					case 'resourceCopy': {
						if (!p.source || !p.destination) { throw new Error('Missing source or destination'); }
						await this._resourceService.copy(identity, p as unknown as Parameters<typeof this._resourceService.copy>[1]);
						sendResult({});
						return;
					}
					case 'resourceResolve': {
						if (!p.uri) { throw new Error('Missing uri'); }
						const result = await this._resourceService.resolve(identity, p as unknown as Parameters<typeof this._resourceService.resolve>[1]);
						sendResult(result);
						return;
					}
					case 'resourceMkdir': {
						if (!p.uri) { throw new Error('Missing uri'); }
						await this._resourceService.mkdir(identity, p as unknown as Parameters<typeof this._resourceService.mkdir>[1]);
						sendResult({});
						return;
					}
					case 'resourceRequest': {
						try {
							await this._resourceService.request(identity, p as unknown as ResourceRequestParams);
							sendResult({});
						} catch (err) {
							if (err instanceof CancellationError) {
								throw new AgentHostResourcePermissionError(undefined);
							}
							throw err;
						}
						return;
					}
					default:
						this._logService.warn(`[RemoteAgentHostProtocol] Unhandled reverse request: ${method}`);
						throw new Error(`Unknown method: ${method}`);
				}
			} catch (err) {
				sendError(err);
			}
		})();
	}

	private _sendNotification<M extends keyof ClientNotificationMap>(method: M, params: ClientNotificationMap[M]['params']): void {
		this._sendNotificationMessage(method, params);
	}

	private _sendExtensionNotification<M extends keyof IRemoteAgentHostExtensionNotificationMap>(method: M, params: IRemoteAgentHostExtensionNotificationMap[M]['params'], sendDuringReconnect = false): void {
		this._sendNotificationMessage(method, params, sendDuringReconnect);
	}

	private _sendNotificationMessage(method: string, params: unknown, sendDuringReconnect = false): void {
		if (this._state.kind === AgentHostClientState.Closed || this._state.kind === AgentHostClientState.Incompatible) {
			return;
		}
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		const message = { jsonrpc: '2.0' as const, method, params } as ProtocolMessage;
		if (isClientTransport(this._transport) && this._state.kind === AgentHostClientState.Connecting) {
			this._state.outbox.push(message);
			return;
		}
		if (this._state.kind === AgentHostClientState.Reconnecting && !sendDuringReconnect) {
			this._state.reconnect.outbox.push(message);
			return;
		}
		this._transport.send(message);
	}

	private _sendRequest<M extends keyof CommandMap>(method: M, params: CommandMap[M]['params']): Promise<CommandMap[M]['result']> {
		return this._dispatchRequest<CommandMap[M]['result']>(method, params);
	}

	private _sendExtensionRequest<M extends keyof IAgentHostExtensionCommandMap>(method: M, params?: IAgentHostExtensionCommandMap[M]['params']): Promise<IAgentHostExtensionCommandMap[M]['result']> {
		return this._dispatchRequest<IAgentHostExtensionCommandMap[M]['result']>(method, params);
	}

	private _updateTelemetryLevel(): void {
		this._dispatchRootConfig({ [AgentHostTelemetryLevelConfigKey]: telemetryLevelToAgentHostConfigValue(this._effectiveTelemetryLevel()) });
	}

	private _effectiveTelemetryLevel(): TelemetryLevel {
		return Math.min(getTelemetryLevel(this._configurationService), this._telemetryService.telemetryLevel);
	}

	private _dispatchRootConfig(config: Record<string, unknown>): void {
		this.dispatchAction(ROOT_STATE_URI, {
			type: ActionType.RootConfigChanged,
			config,
		}, this._clientId, 0);
	}

	private _updateDisableRepoInfoTelemetry(): void {
		const disabled = this._configurationService.getValue<boolean>(DISABLE_REPO_INFO_TELEMETRY_SETTING_ID) === true;
		this._dispatchRootConfig({ [AgentHostDisableRepoInfoTelemetryConfigKey]: disabled });
	}

	private _updateTerminalAutoApproveEnabled(): void {

		const enabled = this._configurationService.getValue<boolean>(TERMINAL_AUTO_APPROVE_ENABLED_SETTING_ID) !== false;
		this._dispatchRootConfig({ [AgentHostTerminalAutoApproveEnabledConfigKey]: enabled });
	}

	private _updateTerminalAutoApproveRules(): void {
		this._dispatchRootConfig({ [AgentHostTerminalAutoApproveRulesConfigKey]: getAgentHostTerminalAutoApproveRulesConfig(this._configurationService) });
	}

	private _updateManagedSettingsPermissions(sendDuringReconnect = false): void {
		const permissions = this._resourceIdentity === LOCAL_AGENT_HOST_RESOURCE_IDENTITY
			? resolveManagedSettingsPermissions(this._configurationService)
			: {};
		this._sendExtensionNotification('setClientManagedSettingsPermissions', { permissions }, sendDuringReconnect);
	}

	private async _dispatchRequest<TResult>(
		method: string,
		params: unknown,
		options: { readonly bypassInitializeQueue?: boolean; readonly allowIncompatibleUpgrade?: boolean; readonly bypassReconnectGate?: boolean } = {},
	): Promise<TResult> {
		if (this._state.kind === AgentHostClientState.Closed) {
			throw this._state.error;
		}
		if (this._state.kind === AgentHostClientState.Incompatible) {
			if (!options.allowIncompatibleUpgrade) {
				throw this._state.error;
			}
			const { request, result } = this._createRequest<TResult>(method, params);
			this._transport.send(request);
			return result;
		}
		if (!options.bypassInitializeQueue && isClientTransport(this._transport) && this._state.kind === AgentHostClientState.Connecting) {
			const { request, result } = this._createRequest<TResult>(method, params);
			this._state.outbox.push(request as ProtocolMessage);
			return result;
		}
		while (!options.bypassReconnectGate && this._state.kind === AgentHostClientState.Reconnecting) {
			const current = this._state as ClientState;
			if (current.kind !== AgentHostClientState.Reconnecting) {
				break;
			}
			try {
				await current.reconnect.gate.p;
			} catch {
			}
		}
		const current = this._state as ClientState;
		if (current.kind === AgentHostClientState.Closed || current.kind === AgentHostClientState.Incompatible) {
			throw current.error;
		}

		const { request, result } = this._createRequest<TResult>(method, params);
		this._transport.send(request);
		return result;
	}

	private _createRequest<TResult>(method: string, params: unknown): { request: JsonRpcRequest; result: Promise<TResult> } {
		const id = this._nextRequestId++;
		const deferred = new DeferredPromise<unknown>();
		this._pendingRequests.set(id, { deferred, suppressNotFoundWarning: isFileResourceRead(method, params), sentAt: Date.now() });
		return {
			request: { jsonrpc: '2.0', id, method, params },
			result: deferred.p as Promise<TResult>,
		};
	}

	private _shouldLogFailedRequest(request: IPendingRequest, error: JsonRpcErrorResponse['error']): boolean {
		if (error.code === AhpErrorCodes.NotFound && request.suppressNotFoundWarning) {
			return false;
		}
		return true;
	}

	private _toProtocolError(error: JsonRpcErrorResponse['error']): ProtocolError {
		return new ProtocolError(error.code, error.message, error.data);
	}

	private _rejectPendingRequests(error: ProtocolError): void {
		for (const pending of this._pendingRequests.values()) {
			pending.deferred.error(error);
		}
		this._pendingRequests.clear();
	}

	private _resetLivenessTimers(): void {
		this._cancelLivenessTimers();
		if (this._state.kind === AgentHostClientState.Incompatible
			|| this._state.kind === AgentHostClientState.Reconnecting
			|| this._state.kind === AgentHostClientState.Closed) {
			return;
		}
		this._pingTimer.cancelAndSet(() => this._onPingTimer(), PING_INTERVAL_MS);
		this._closeTimer.cancelAndSet(() => this._onCloseTimer(), PING_INTERVAL_MS + LIVENESS_TIMEOUT_MS);
	}

	private _cancelLivenessTimers(): void {
		this._pingTimer.cancel();
		this._closeTimer.cancel();
		this._livenessDeferred = false;
		this._livenessDeferredSince = undefined;
	}

	private _onPingTimer(): void {
		if (this._state.kind === AgentHostClientState.Incompatible
			|| this._state.kind === AgentHostClientState.Closed
			|| this._state.kind === AgentHostClientState.Reconnecting) {
			return;
		}
		void this.ping().catch(() => undefined);
	}

	private _onCloseTimer(): void {
		if (this._state.kind === AgentHostClientState.Incompatible
			|| this._state.kind === AgentHostClientState.Closed
			|| this._state.kind === AgentHostClientState.Reconnecting) {
			return;
		}
		if (this._transport.clientConnectionKind === AgentHostClientConnectionKind.Local) {
			return;
		}
		const pendingReverseRequests = this._pendingReverseRequests.get(this._transport) ?? 0;
		if (pendingReverseRequests > 0 || this._loadEstimator.hasHighLoad()) {
			this._deferLivenessCheck(pendingReverseRequests);
			return;
		}
		if (this._livenessDeferred) {
			this._livenessDeferred = false;
			this._livenessDeferredSince = undefined;
			this._pingTimer.cancelAndSet(() => this._onPingTimer(), PING_INTERVAL_MS);
			this._closeTimer.cancelAndSet(() => this._onCloseTimer(), PING_INTERVAL_MS + LIVENESS_TIMEOUT_MS);
			return;
		}
		const silence = Date.now() - this._lastReadTime;
		this._logService.info(
			`[RemoteAgentHostProtocol] Liveness: no message from ${this._address} for ${silence}ms; forcing close to trigger reconnect.`,
		);
		this._transportListeners.clear();
		if (this._transportFactory) {
			this._rejectPendingRequests(connectionTimeoutError(this._address, silence));
			this._handleTransportClose();
			return;
		}
		this._handleClose(connectionTimeoutError(this._address, silence));
	}

	private _deferLivenessCheck(pendingReverseRequests: number): void {
		const now = Date.now();
		if (!this._livenessDeferred) {
			this._livenessDeferred = true;
			this._livenessDeferredSince = now;
		}
		const deferredSince = this._livenessDeferredSince ?? now;
		this._logService.trace(
			`[RemoteAgentHostProtocol] Liveness: deferring close for ${now - deferredSince}ms; ${pendingReverseRequests} reverse request(s) outstanding.`,
		);
		this._pingTimer.cancelAndSet(() => this._onPingTimer(), PING_INTERVAL_MS);
		this._closeTimer.cancelAndSet(() => this._onCloseTimer(), PING_INTERVAL_MS);
	}

	nextClientSeq(): number {
		return this._nextClientSeq++;
	}
}
