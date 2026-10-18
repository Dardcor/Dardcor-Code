/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../base/common/async.js';
import { encodeBase64 } from '../../../base/common/buffer.js';
import { Emitter } from '../../../base/common/event.js';
import { isJsonRpcResponse } from '../../../base/common/jsonRpcProtocol.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import { hasKey } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AHPFileSystemProvider } from '../common/agentHostFileSystemProvider.js';
import { getAgentHostClientType } from '../common/agentHostClientInfo.js';
import { AgentHostClientConnectionKind, AgentHostLaunchKind, AgentHostTransportKind, readClientConnectionKind, readClientDevDeviceId, readClientMachineId, readClientTelemetryLevel, type IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { AgentSession, type IAgentCreateChatRequestOptions, type IMcpNotification } from '../common/agent.js';
import { isManagedSettingsPermissions } from '../common/agentHostManagedSettings.js';
import { type IAgentService } from '../common/agentService.js';
import { ClaimAgentHostDetachedWorktreeExtensionMethod, collectAgentHostDebugLogsParamsValidator, CollectAgentHostDebugLogsExtensionMethod, CreateAgentHostDetachedWorktreeExtensionMethod, DeleteAgentHostDetachedWorktreeExtensionMethod, getAgentHostExtensionInitializeResultMeta, GetAgentHostSessionStateFileExtensionMethod, ReadAgentHostDebugLogsChunkExtensionMethod, ReconcileAgentHostDetachedWorktreesExtensionMethod, RequestAgentHostWorkspaceTrustExtensionMethod, SetAgentHostDetachedWorktreeArchivedExtensionMethod, type IAgentHostExtensionInitializeResult, type IAgentHostExtensionServerCommandMap, type IAgentHostWorkspaceTrustRequest } from '../common/agentHostExtensionProtocol.js';
import { isAgentDevContainerWorktreeHandle } from '../common/meta/agentDevContainerWorktreeMeta.js';
import { isActionEnvelopeRelevantToSubscriptionUris } from '../common/state/agentSubscription.js';
import { ChatSourceKind } from '../common/state/protocol/channels-chat/commands.js';
import type { CommandMap } from '../common/state/protocol/messages.js';
import { ActionEnvelope, ActionType, INotification, isAnnotationsAction, isAutomationAction, isAutomationRunAction, isChangesetAction, isChatAction, isSessionAction, isTerminalAction, type ChatAction, type ClientAnnotationsAction, type ClientAutomationAction, type ClientAutomationRunAction, type ClientChangesetAction, type IRootConfigChangedAction, type SessionAction, type TerminalAction } from '../common/state/sessionActions.js';
import { PROTOCOL_VERSION } from '../common/state/protocol/version/registry.js';
import { negotiateProtocolVersion } from '../common/state/protocol/version/negotiation.js';
import { VSCODE_UPGRADE_METHOD, type UnsupportedProtocolVersionErrorDataEx } from '../common/state/protocolUpgrade.js';
import { getAgentHostManagementSocketPath, requestAgentHostUpgrade } from './agentHostUpgradeChannel.js';
import {
	AHP_AUTH_REQUIRED,
	AhpErrorCodes,
	AHP_PROVIDER_NOT_FOUND,
	AHP_SESSION_NOT_FOUND,
	AHP_UNSUPPORTED_PROTOCOL_VERSION,
	JsonRpcRequest,
	isJsonRpcNotification,
	isJsonRpcRequest,
	JSON_RPC_INTERNAL_ERROR,
	JsonRpcErrorCodes,
	ProtocolError,
	type AhpServerNotification,
	type InitializeParams,
	type JsonRpcResponse,
	type ReconnectParams,
	type IStateSnapshot,
	type SubscribeResult,
	type ListSessionsResult,
} from '../common/state/sessionProtocol.js';
import { isAhpAutomationCatalogChannel, isAhpResourceWatchChannel, ResponsePartKind, SessionStatus, ToolCallConfirmationReason, ToolCallContributorKind, ToolCallStatus, ToolResultContentType, buildDefaultChatUri, isAhpChatChannel, parseChatUri, parseRequiredSessionUriFromChatUri, type ISessionWithDefaultChat, type SessionState } from '../common/state/sessionState.js';
import type { IProtocolServer, IProtocolTransport } from '../common/state/sessionTransport.js';
import { IAgentHostManagedSettingsService } from './agentHostManagedSettingsService.js';
import { AgentHostStateManager } from './agentHostStateManager.js';
import {
	buildOtlpLogsChannelUri,
	extractLevelFromOtlpLogsUri,
	levelToSeverityNumber,
	OTLP_CHANNEL_SCHEME,
	OTLP_LOGS_CHANNEL_TEMPLATE,
	OtlpLogEmitter,
	toResourceLogsPayload,
	type IOtlpLogRecord,
	type OtlpLogLevelName,
} from '../common/otlp/otlpLogEmitter.js';
import { isFileResourceRead } from '../common/resourceReadLogging.js';
import type { Implementation } from '../common/state/protocol/common/commands.js';
import { AGENT_HOST_CLIENT_CONNECTION_HISTORY_RETENTION, IAgentHostClientConnectionService, type IAgentHostClientConnectionSource } from './agentHostClientConnectionService.js';
import { AgentHostTelemetryReporter } from './agentHostTelemetryReporter.js';
import { isAgentHostTelemetryService } from './agentHostTelemetryService.js';

const REPLAY_BUFFER_CAPACITY = 1000;

const CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT = 30_000;

const UNSUPPORTED_CLIENT_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
	ActionType.ChatWorkingDirectorySet,
	ActionType.ChatWorkingDirectoryRemoved,
]);

function isPendingToolCallStatus(status: ToolCallStatus): boolean {
	return status === ToolCallStatus.Streaming
		|| status === ToolCallStatus.Running
		|| status === ToolCallStatus.PendingConfirmation;
}

function jsonRpcSuccess(id: number, result: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: number, code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function jsonRpcErrorFrom(id: number, err: unknown): JsonRpcResponse {
	if (err instanceof ProtocolError) {
		return jsonRpcError(id, err.code, err.message, err.data);
	}
	const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
	return jsonRpcError(id, JSON_RPC_INTERNAL_ERROR, message);
}

function shouldLogFailedRequest(method: string, params: unknown, err: unknown): boolean {
	if (!(err instanceof ProtocolError) || err.code !== AhpErrorCodes.NotFound || !isFileResourceRead(method, params)) {
		return true;
	}
	return false;
}

function isParamsObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMcpChannel(params: unknown): string | undefined {
	if (!isParamsObject(params)) {
		return undefined;
	}
	const channel = params['channel'];
	if (typeof channel !== 'string' || !channel.startsWith('mcp://')) {
		return undefined;
	}
	return channel;
}

type RequestMethod = Exclude<keyof CommandMap, 'initialize' | 'reconnect' | 'ping'>;

type RequestHandlerMap = {
	[M in RequestMethod]: (client: IConnectedClient, params: CommandMap[M]['params']) => Promise<CommandMap[M]['result']>;
};

const enum ChannelKind {
	State = 'state',
	ResourceWatch = 'resource-watch',
	OtlpLogs = 'otlp-logs',
}

type ChannelSubscription =
	| { readonly kind: ChannelKind.State; readonly uri: string; readonly active: boolean }
	| { readonly kind: ChannelKind.ResourceWatch; readonly uri: string; readonly active: boolean }
	| { readonly kind: ChannelKind.OtlpLogs; readonly uri: string; readonly level: OtlpLogLevelName };

interface IConnectedClient {
	readonly clientId: string;
	readonly clientInfo: Implementation | undefined;
	readonly telemetryContext: IAgentHostClientTelemetryContext;
	readonly protocolVersion: string;
	readonly transport: IProtocolTransport;
	readonly connectionStopWatch: StopWatch;
	readonly isReconnect: boolean;
	telemetryConnectionActive: boolean;
	readonly subscriptions: Map<string, ChannelSubscription>;
	readonly disposables: DisposableStore;
	readonly initializationDisposables: DisposableStore;
}

type IClientRecord = IActiveClientRecord | IGraceClientRecord;

interface IActiveClientRecord {
	readonly state: 'active';
	clientInfo: Implementation | undefined;
	readonly connections: IConnectedClient[];
}

interface IGraceClientRecord {
	readonly state: 'grace';
	readonly seenConnection: boolean;
	readonly clientInfo: Implementation | undefined;
	readonly telemetryContext: IAgentHostClientTelemetryContext | undefined;
	readonly protocolVersion: string | undefined;
	lastSeenAt: number;
	readonly disconnectTimeouts: DisposableMap<string>;
}

function classifyChannel(channel: string): ChannelSubscription | undefined {
	if (channel.toLowerCase().startsWith(`${OTLP_CHANNEL_SCHEME}:`)) {
		const level = extractLevelFromOtlpLogsUri(channel);
		if (!level) {
			return undefined;
		}
		return { kind: ChannelKind.OtlpLogs, uri: buildOtlpLogsChannelUri(level), level };
	}
	if (isAhpResourceWatchChannel(channel)) {
		return { kind: ChannelKind.ResourceWatch, uri: channel, active: true };
	}
	return { kind: ChannelKind.State, uri: channel, active: true };
}

export interface IProtocolServerConfig {
	readonly hostLaunchKind?: AgentHostLaunchKind;

	readonly defaultDirectory?: string;
	readonly allowExtensionMethods?: boolean;
	readonly completionTriggerCharacters?: readonly string[];
	readonly terminalCommandPrefix?: string;
	readonly otlpLogEmitter?: OtlpLogEmitter;
}

export class ProtocolServerHandler extends Disposable implements IAgentHostClientConnectionSource {

	private readonly _clients = new Map<string, IClientRecord>();
	private readonly _baselineDebt = new Map<string, Set<string>>();
	private readonly _replayBuffer: ActionEnvelope[] = [];
	private readonly _telemetryReporter: AgentHostTelemetryReporter;
	private readonly _managedSettingsOwnerId = generateUuid();
	private readonly _connectionDisposables = this._register(new DisposableMap<IProtocolTransport, DisposableStore>());

	private readonly _onDidChangeConnectionCount = this._register(new Emitter<number>());

	readonly onDidChangeConnectionCount = this._onDidChangeConnectionCount.event;

	constructor(
		private readonly _agentService: IAgentService,
		private readonly _stateManager: AgentHostStateManager,
		private readonly _server: IProtocolServer,
		private readonly _config: IProtocolServerConfig,
		private readonly _clientFileSystemProvider: AHPFileSystemProvider,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IAgentHostManagedSettingsService private readonly _managedSettingsService: IAgentHostManagedSettingsService,
		@IAgentHostClientConnectionService private readonly _clientConnections: IAgentHostClientConnectionService,
	) {
		super();
		this._telemetryReporter = new AgentHostTelemetryReporter(this._telemetryService);
		this._register(this._clientConnections.registerSource(this));

		this._register(this._server.onConnection(transport => {
			this._handleNewConnection(transport);
		}));

		this._register(this._stateManager.onDidEmitEnvelope(envelope => {
			this._replayBuffer.push(envelope);
			if (this._replayBuffer.length > REPLAY_BUFFER_CAPACITY) {
				this._replayBuffer.shift();
			}
			this._broadcastAction(envelope);
			if (envelope.action.type === ActionType.ChatToolCallStart || envelope.action.type === ActionType.ChatToolCallReady) {
				if (!isAhpChatChannel(envelope.channel)) {
					throw new Error(`[ProtocolServer] Chat tool-call action emitted on non-chat channel: ${envelope.channel}`);
				}
				this._checkOrphanedClientToolCalls(parseRequiredSessionUriFromChatUri(envelope.channel), envelope.channel);
			}
		}));

		this._register(this._stateManager.onDidEmitNotification(notification => {
			this._broadcastNotification(notification);
		}));

		this._register(this._agentService.onMcpNotification(notification => {
			this._broadcastMcpNotification(notification);
		}));

		if (this._config.otlpLogEmitter) {
			this._register(this._config.otlpLogEmitter.onDidLog(record => this._broadcastOtlpLog(record)));
		}
	}


	private _handleNewConnection(transport: IProtocolTransport): void {
		const disposables = new DisposableStore();
		this._connectionDisposables.set(transport, disposables);
		let client: IConnectedClient | undefined;

		disposables.add(transport.onMessage(msg => {
			if (isJsonRpcRequest(msg)) {
				this._logService.trace(`[ProtocolServer] request: method=${msg.method} id=${msg.id}`);

				if (msg.method === 'ping') {
					transport.send(jsonRpcSuccess(msg.id, null));
					return;
				}

				if (!client && msg.method === 'initialize') {
					try {
						const result = this._handleInitialize(msg.params, transport, disposables);
						client = result.client;
						transport.send(jsonRpcSuccess(msg.id, result.response));
					} catch (err) {
						transport.send(jsonRpcErrorFrom(msg.id, err));
					}
					return;
				}
				if (!client && msg.method === 'reconnect') {
					let responsePromise: Promise<unknown>;
					try {
						const result = this._handleReconnect(msg.params, transport, disposables);
						client = result.client;
						responsePromise = this._trackRequest(result.responsePromise);
					} catch (err) {
						transport.send(jsonRpcErrorFrom(msg.id, err));
						return;
					}
					responsePromise.then(
						response => transport.send(jsonRpcSuccess(msg.id, response)),
						err => transport.send(jsonRpcErrorFrom(msg.id, err)),
					);
					return;
				}

				if ((msg.method as string) === VSCODE_UPGRADE_METHOD) {
					this._handleVscodeUpgrade(msg.id, transport);
					return;
				}

				if (!client) {
					transport.send(jsonRpcError(msg.id, JsonRpcErrorCodes.MethodNotFound, `Method not found: ${msg.method}`));
					return;
				}
				this._handleRequest(client, msg.method, msg.params, msg.id);
			} else if (isJsonRpcNotification(msg)) {
				this._logService.trace(`[ProtocolServer] notification: method=${msg.method}`);
				if ((msg as { method: string }).method === 'setClientManagedSettingsPermissions') {
					if (client) {
						const permissions = ((msg as { params?: { permissions?: unknown } }).params)?.permissions;
						if (isManagedSettingsPermissions(permissions)) {
							this._managedSettingsService.setClientPermissions(this._managedSettingsContributionId(client.clientId), permissions);
						} else {
							this._logService.warn('[ProtocolServer] Ignoring invalid managed settings permissions contribution.');
						}
					}
					return;
				}
				switch (msg.method) {
					case 'unsubscribe':
						if (client) {
							this._removeSubscription(client, msg.params.channel);
						}
						break;
					case 'dispatchAction':
						if (client) {
							this._logService.trace(`[ProtocolServer] dispatchAction: ${JSON.stringify(msg.params.action.type)}`);
							const action = msg.params.action as SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction;
							const channel = msg.params.channel;
							if (UNSUPPORTED_CLIENT_ACTION_TYPES.has(action.type)) {
								this._logService.warn(`[ProtocolServer] rejecting unsupported client action: ${action.type}`);
								this._stateManager.rejectClientAction(
									channel,
									action,
									{ clientId: client.clientId, clientSeq: msg.params.clientSeq },
									`Unsupported action: ${action.type}`,
								);
							} else if (isSessionAction(action) || isChatAction(action) || isTerminalAction(action) || isChangesetAction(action) || isAnnotationsAction(action) || isAutomationAction(action) || isAutomationRunAction(action) || action.type === ActionType.RootConfigChanged) {
								this._agentService.dispatchAction(channel, action, client.clientId, msg.params.clientSeq, client.telemetryContext);
							}
						}
						break;
				}
			} else if (isJsonRpcResponse(msg)) {
				const pending = this._pendingReverseRequests.get(msg.id);
				if (pending && pending.client === client) {
					this._pendingReverseRequests.delete(msg.id);
					if (hasKey(msg, { error: true })) {
						pending.reject(new ProtocolError(
							msg.error?.code ?? -32000,
							msg.error?.message ?? 'Reverse RPC error',
							msg.error?.data,
						));
					} else {
						pending.resolve(msg.result);
					}
				}
			}
		}));

		disposables.add(transport.onClose(() => {
			const record = client ? this._clients.get(client.clientId) : undefined;
			if (client && record?.state === 'active') {
				const connectionIndex = record.connections.indexOf(client);
				if (connectionIndex !== -1) {
					const subscriptionCount = client.subscriptions.size;
					record.connections.splice(connectionIndex, 1);
					this._releaseClientSubscriptions(client, record);
					this._rejectPendingReverseRequestsForConnection(client);
					if (record.connections.length === 0) {
						this._logService.info(`[ProtocolServer] Client disconnected: ${client.clientId}, subscriptions=${subscriptionCount}`);
						this._clients.set(client.clientId, {
							state: 'grace',
							seenConnection: true,
							clientInfo: record.clientInfo,
							telemetryContext: client.telemetryContext,
							protocolVersion: client.protocolVersion,
							lastSeenAt: Date.now(),
							disconnectTimeouts: new DisposableMap(),
						});
						this._handleClientDisconnected(client.clientId);
						this._onDidChangeConnectionCount.fire(this._connectedClientCount);
					}
					this._reportClientDisconnected(client, subscriptionCount);
				}
			}
			this._connectionDisposables.deleteAndDispose(transport);
		}));

		disposables.add(transport);
	}


	private _handleInitialize(
		params: InitializeParams,
		transport: IProtocolTransport,
		disposables: DisposableStore,
	): { client: IConnectedClient; response: IAgentHostExtensionInitializeResult } {
		const offered = Array.isArray(params.protocolVersions) ? params.protocolVersions : [];
		this._logService.info(`[ProtocolServer] Initialize: clientId=${params.clientId}, protocolVersions=[${offered.join(', ')}]`);

		const negotiated = negotiateProtocolVersion(offered, PROTOCOL_VERSION);
		if (!negotiated) {
			const data: UnsupportedProtocolVersionErrorDataEx = {
				supportedVersions: [`^${PROTOCOL_VERSION}`],
				_meta: getAgentHostManagementSocketPath()
					? { vscodeUpgradeMethod: VSCODE_UPGRADE_METHOD }
					: undefined,
			};
			throw new ProtocolError(
				AHP_UNSUPPORTED_PROTOCOL_VERSION,
				`Client offered protocol versions [${offered.join(', ')}], none of which are compatible with this server's version ${PROTOCOL_VERSION} (server accepts ^${PROTOCOL_VERSION}).`,
				data,
			);
		}

		const previousRecord = this._clients.get(params.clientId);
		this._applyClientTelemetryLevel(params._meta);
		const initializationDisposables = disposables.add(new DisposableStore());
		const telemetryContext = this._createClientTelemetryContext(params.clientInfo, params._meta, transport);
		const client: IConnectedClient = {
			clientId: params.clientId,
			clientInfo: params.clientInfo,
			telemetryContext,
			protocolVersion: negotiated,
			transport,
			connectionStopWatch: StopWatch.create(true),
			isReconnect: this._clientConnections.hasSeenClient(params.clientId),
			telemetryConnectionActive: false,
			subscriptions: new Map(),
			disposables,
			initializationDisposables,
		};
		this._attachConnection(params.clientId, client);
		try {
			this._registerClientFileSystemAuthority(params.clientId, initializationDisposables);

			const snapshots: IStateSnapshot[] = [];
			if (params.initialSubscriptions) {
				for (const uri of params.initialSubscriptions) {
					const snapshot = this._addInitialSubscription(client, uri.toString());
					if (snapshot) {
						snapshots.push(snapshot);
					}
				}
			}

			client.telemetryConnectionActive = true;
			const counts = this._clientConnections.getConnectionCounts(params.clientId);
			this._telemetryReporter.clientConnection({
				action: 'connected',
				context: telemetryContext,
				clientId: client.clientId,
				clientImplementationName: client.clientInfo?.name,
				clientImplementationVersion: client.clientInfo?.version,
				protocolVersion: client.protocolVersion,
				isReconnect: client.isReconnect,
				...counts,
			});
			if (previousRecord?.state === 'grace') {
				previousRecord.disconnectTimeouts.dispose();
			}
			this._onDidChangeConnectionCount.fire(this._connectedClientCount);

			return {
				client,
				response: {
					protocolVersion: negotiated,
					serverSeq: this._stateManager.serverSeq,
					_meta: getAgentHostExtensionInitializeResultMeta(),
					snapshots,
					defaultDirectory: this._config.defaultDirectory,
					completionTriggerCharacters: this._config.completionTriggerCharacters ? [...this._config.completionTriggerCharacters] : undefined,
					terminalCommandPrefix: this._config.terminalCommandPrefix,
					telemetry: this._config.otlpLogEmitter ? { logs: OTLP_LOGS_CHANNEL_TEMPLATE } : undefined,
					automations: this._agentService.automationCapabilities,
				},
			};
		} catch (error) {
			this._rollbackFailedInitialization(client, previousRecord);
			throw error;
		}
	}

	private _addInitialSubscription(client: IConnectedClient, channel: string): IStateSnapshot | undefined {
		const sub = classifyChannel(channel);
		if (!sub) {
			return undefined;
		}
		if (sub.kind === ChannelKind.OtlpLogs) {
			if (!this._config.otlpLogEmitter) {
				this._logService.warn(`[ProtocolServer] Ignoring OTLP initialSubscription ${channel}: no OTLP emitter configured.`);
				return undefined;
			}
			client.subscriptions.set(sub.uri, sub);
			return undefined;
		}
		const snapshot = this._stateManager.getSnapshot(channel);
		client.subscriptions.set(sub.uri, sub);
		this._agentService.addSubscriber(URI.parse(sub.uri), client.clientId);
		this._clearClientToolCallDisconnectTimeout(client.clientId, sub.uri);
		if (snapshot) {
			this._clearBaselineDebt(client.clientId, sub.uri);
		} else {
			this._recordBaselineDebt(client.clientId, sub.uri);
		}
		return snapshot;
	}

	private _recordBaselineDebt(clientId: string, uri: string): void {
		let debt = this._baselineDebt.get(clientId);
		if (!debt) {
			debt = new Set();
			this._baselineDebt.set(clientId, debt);
		}
		debt.add(uri);
	}

	private _clearBaselineDebt(clientId: string, uri: string): void {
		const debt = this._baselineDebt.get(clientId);
		if (debt?.delete(uri) && debt.size === 0) {
			this._baselineDebt.delete(clientId);
		}
	}

	private _hasBaselineDebt(clientId: string, subscriptions: readonly string[]): boolean {
		const debt = this._baselineDebt.get(clientId);
		if (!debt || debt.size === 0) {
			return false;
		}
		return subscriptions.some(subscription => {
			const classified = classifyChannel(subscription.toString());
			return classified !== undefined && debt.has(classified.uri);
		});
	}

	private async _subscribeStateChannel(channel: string, clientId: string, isActive?: () => boolean): Promise<IStateSnapshot> {
		if (!isAhpAutomationCatalogChannel(channel)) {
			return this._agentService.subscribe(URI.parse(channel), clientId, isActive);
		}
		if (isActive && !isActive()) {
			throw new Error(`Subscription cancelled: ${channel}`);
		}
		const snapshot = this._stateManager.getSnapshot(channel);
		if (!snapshot) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Automation catalogue is unavailable: ${channel}`);
		}
		this._agentService.addSubscriber(URI.parse(channel), clientId);
		return snapshot;
	}

	private _handleVscodeUpgrade(id: number, transport: IProtocolTransport): void {
		const socketPath = getAgentHostManagementSocketPath();
		if (!socketPath) {
			transport.send(jsonRpcError(
				id,
				JsonRpcErrorCodes.MethodNotFound,
				`No upgrade supervisor is available for this agent host.`,
			));
			return;
		}
		this._trackRequest(requestAgentHostUpgrade(socketPath)).then(
			(result) => transport.send(jsonRpcSuccess(id, result)),
			(err: unknown) => {
				this._logService.warn(`[ProtocolServer] vscodeUpgrade signal failed: ${err instanceof Error ? err.message : String(err)}`);
				transport.send(jsonRpcErrorFrom(id, err));
			},
		);
	}

	private _handleReconnect(
		params: ReconnectParams,
		transport: IProtocolTransport,
		disposables: DisposableStore,
	): { client: IConnectedClient; responsePromise: Promise<unknown> } {
		this._logService.info(`[ProtocolServer] Reconnect: clientId=${params.clientId}, lastSeenSeq=${params.lastSeenServerSeq}`);
		const existingRecord = this._clients.get(params.clientId);
		if (!existingRecord) {
			throw new ProtocolError(AhpErrorCodes.NotFound, `Reconnect client not found: ${params.clientId}`);
		}
		this._applyClientTelemetryLevel(params._meta);

		const priorTelemetryContext = existingRecord.state === 'active'
			? existingRecord.connections.at(-1)?.telemetryContext
			: existingRecord.telemetryContext;
		const priorProtocolVersion = existingRecord.state === 'active'
			? existingRecord.connections.at(-1)?.protocolVersion
			: existingRecord.protocolVersion;
		const isReconnect = this._clientConnections.hasSeenClient(params.clientId);
		const initializationDisposables = disposables.add(new DisposableStore());
		const client: IConnectedClient = {
			clientId: params.clientId,
			clientInfo: existingRecord.clientInfo,
			telemetryContext: this._createClientTelemetryContext(existingRecord.clientInfo, params._meta, transport, priorTelemetryContext?.connectionKind),
			protocolVersion: priorProtocolVersion ?? PROTOCOL_VERSION,
			transport,
			connectionStopWatch: StopWatch.create(true),
			isReconnect,
			telemetryConnectionActive: false,
			subscriptions: new Map(),
			disposables,
			initializationDisposables,
		};
		this._attachConnection(params.clientId, client);
		try {
			this._registerClientFileSystemAuthority(params.clientId, initializationDisposables);

			const oldestBuffered = this._replayBuffer.length > 0 ? this._replayBuffer[0].serverSeq : this._stateManager.serverSeq;
			// A global cursor only proves the client saw every ACTION; it says
			const canReplay = params.lastSeenServerSeq >= oldestBuffered
				&& !this._hasBaselineDebt(params.clientId, params.subscriptions);
			const responsePromise = this._restoreReconnectSubscriptions(client, params, canReplay);

			client.telemetryConnectionActive = true;
			const counts = this._clientConnections.getConnectionCounts(params.clientId);
			this._telemetryReporter.clientConnection({
				action: 'connected',
				context: client.telemetryContext,
				clientId: client.clientId,
				clientImplementationName: client.clientInfo?.name,
				clientImplementationVersion: client.clientInfo?.version,
				protocolVersion: client.protocolVersion,
				isReconnect: client.isReconnect,
				...counts,
			});
			if (existingRecord.state === 'grace') {
				existingRecord.disconnectTimeouts.dispose();
			}
			this._onDidChangeConnectionCount.fire(this._connectedClientCount);

			return { client, responsePromise };
		} catch (error) {
			this._rollbackFailedInitialization(client, existingRecord);
			throw error;
		}
	}

	private _registerClientFileSystemAuthority(clientId: string, disposables: DisposableStore): void {
		disposables.add(this._clientFileSystemProvider.registerAuthority(clientId, {
			resourceList: (uri) => this._sendReverseRequest(clientId, 'resourceList', { uri: uri.toString() }),
			resourceRead: (uri) => this._sendReverseRequest(clientId, 'resourceRead', { uri: uri.toString() }),
			resourceWrite: (params_) => this._sendReverseRequest(clientId, 'resourceWrite', params_),
			resourceCopy: (params_) => this._sendReverseRequest(clientId, 'resourceCopy', params_),
			resourceDelete: (params_) => this._sendReverseRequest(clientId, 'resourceDelete', params_),
			resourceMove: (params_) => this._sendReverseRequest(clientId, 'resourceMove', params_),
			resourceRequest: (params_) => this._sendReverseRequest(clientId, 'resourceRequest', params_),
			resourceResolve: (params_) => this._sendReverseRequest(clientId, 'resourceResolve', params_),
			resourceMkdir: (params_) => this._sendReverseRequest(clientId, 'resourceMkdir', params_),
		}));
	}

	private async _restoreReconnectSubscriptions(
		client: IConnectedClient,
		params: ReconnectParams,
		canReplay: boolean,
	): Promise<unknown> {
		const missing: string[] = [];
		const restoredUris = new Set<string>();
		const pendingSubscriptions: { readonly pending: ChannelSubscription; readonly active: ChannelSubscription }[] = [];
		const snapshots = await Promise.all(params.subscriptions.map(async sub => {
			const key = sub.toString();
			const classified = classifyChannel(key);
			if (!classified) {
				return undefined;
			}
			if (restoredUris.has(classified.uri)) {
				return undefined;
			}
			restoredUris.add(classified.uri);
			if (classified.kind === ChannelKind.OtlpLogs) {
				if (!this._config.otlpLogEmitter) {
					this._logService.warn(`[ProtocolServer] Reconnect: dropping OTLP subscription ${key}: no OTLP emitter configured.`);
					return undefined;
				}
				client.subscriptions.set(classified.uri, classified);
				return undefined;
			}
			if (classified.kind === ChannelKind.ResourceWatch) {
				const descriptor = this._agentService.onResourceWatchSubscribed(classified.uri);
				if (!descriptor) {
					this._logService.info(`[ProtocolServer] Reconnect: resource watch ${key} no longer parses`);
					missing.push(sub);
					this._clearBaselineDebt(client.clientId, classified.uri);
					return undefined;
				}
				if (canReplay) {
					const pendingSubscription: ChannelSubscription = { ...classified, active: false };
					pendingSubscriptions.push({ pending: pendingSubscription, active: classified });
					client.subscriptions.set(classified.uri, pendingSubscription);
				} else {
					client.subscriptions.set(classified.uri, classified);
				}
				return {
					resource: classified.uri,
					state: descriptor,
					fromSeq: this._stateManager.serverSeq,
				};
			}
			const pendingSubscription: ChannelSubscription = { ...classified, active: false };
			pendingSubscriptions.push({ pending: pendingSubscription, active: classified });
			client.subscriptions.set(classified.uri, pendingSubscription);
			try {
				const snapshot = await this._subscribeStateChannel(
					key,
					client.clientId,
					() => client.subscriptions.get(classified.uri) === pendingSubscription,
				);
				if (client.subscriptions.get(classified.uri) !== pendingSubscription) {
					throw new Error(`Subscription cancelled: ${key}`);
				}
				this._clearClientToolCallDisconnectTimeout(client.clientId, classified.uri);
				return snapshot;
			} catch (err) {
				if (client.subscriptions.get(classified.uri) === pendingSubscription) {
					client.subscriptions.delete(classified.uri);
				}
				this._logService.info(`[ProtocolServer] Reconnect: failed to restore subscription ${key}: ${err instanceof Error ? err.message : String(err)}`);
				missing.push(sub);
				this._clearBaselineDebt(client.clientId, classified.uri);
				return undefined;
			}
		}));

		for (const { pending, active } of pendingSubscriptions) {
			if (client.subscriptions.get(pending.uri) === pending) {
				client.subscriptions.set(active.uri, active);
			}
		}
		this._reconcileActiveClientsAfterReconnect(client);

		if (canReplay) {
			const actions: ActionEnvelope[] = [];
			for (const envelope of this._replayBuffer) {
				if (envelope.serverSeq > params.lastSeenServerSeq) {
					if (this._isRelevantToClient(client, envelope)) {
						actions.push(envelope);
					}
				}
			}
			return { type: 'replay', actions, missing };
		}
		const refreshedSnapshots = snapshots.map(snapshot => {
			if (!snapshot) {
				return undefined;
			}
			const subscription = client.subscriptions.get(snapshot.resource.toString());
			if (subscription?.kind !== ChannelKind.State) {
				return snapshot;
			}
			const refreshed = this._stateManager.getSnapshot(subscription.uri);
			if (refreshed) {
				this._clearBaselineDebt(client.clientId, subscription.uri);
			}
			return refreshed;
		});
		return { type: 'snapshot', snapshots: refreshedSnapshots.filter((s): s is IStateSnapshot => s !== undefined) };
	}

	private _reconcileActiveClientsAfterReconnect(client: IConnectedClient): void {
		const record = this._clients.get(client.clientId);
		const resubscribed = new Set<string>();
		for (const connection of record?.state === 'active' ? record.connections : [client]) {
			for (const sub of connection.subscriptions.values()) {
				if (sub.kind === ChannelKind.State) {
					resubscribed.add(sub.uri);
				}
			}
		}
		for (const session of this._stateManager.getSessionUris()) {
			const state = this._stateManager.getSessionState(session);
			if (state && this._isActiveClient(state, client.clientId)) {
				for (const chat of state.chats) {
					if (!resubscribed.has(session) && !resubscribed.has(chat.resource)) {
						this._releaseActiveClientForSession(session, client.clientId, chat.resource);
					}
				}
			}
		}
	}

	private _handleClientDisconnected(clientId: string): void {
		const record = this._clients.get(clientId);
		if (record?.state === 'grace') {
			record.disconnectTimeouts.set('managed-settings', disposableTimeout(() => {
				record.disconnectTimeouts.deleteAndDispose('managed-settings');
				this._managedSettingsService.removeClientPermissions(this._managedSettingsContributionId(clientId));
			}, CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT));
		}
		for (const session of this._stateManager.getSessionUris()) {
			const state = this._stateManager.getSessionState(session);
			const isActive = state ? this._isActiveClient(state, clientId) : false;
			const ownsPendingToolCall = state ? this._hasPendingClientToolCall(state, clientId) : false;
			if (isActive || ownsPendingToolCall) {
				for (const chat of state?.chats ?? []) {
					this._startClientToolCallDisconnectTimeout(clientId, session, chat.resource);
				}
			}
		}
	}

	private _isActiveClient(state: SessionState, clientId: string): boolean {
		return state.activeClients.some(c => c.clientId === clientId);
	}

	private _removeActiveClient(session: string, clientId: string): void {
		const state = this._stateManager.getSessionState(session);
		if (state && this._isActiveClient(state, clientId)) {
			this._stateManager.dispatchServerAction(session, {
				type: ActionType.SessionActiveClientRemoved,
				clientId,
			});
		}
	}

	private _releaseActiveClientForSession(session: string, clientId: string, chatChannel: string): void {
		this._clearClientToolCallDisconnectTimeout(clientId, chatChannel);
		this._completeDisconnectedClientToolCalls(clientId, session, chatChannel);
		this._removeActiveClient(session, clientId);
	}

	private *_pendingClientToolCalls(state: ISessionWithDefaultChat | undefined) {
		const activeTurn = state?.activeTurn;
		if (!activeTurn) {
			return;
		}
		for (const part of activeTurn.responseParts) {
			if (part.kind !== ResponsePartKind.ToolCall) {
				continue;
			}
			const toolCall = part.toolCall;
			const contributor = toolCall.contributor;
			if (contributor?.kind === ToolCallContributorKind.Client && isPendingToolCallStatus(toolCall.status)) {
				yield { toolCall, clientId: contributor.clientId };
			}
		}
	}

	private _hasPendingClientToolCall(state: ISessionWithDefaultChat | undefined, clientId: string): boolean {
		for (const pending of this._pendingClientToolCalls(state)) {
			if (pending.clientId === clientId) {
				return true;
			}
		}
		return false;
	}

	private _hasReplacementActiveClientTool(state: SessionState, clientId: string, toolName: string): boolean {
		return state.activeClients.some(client =>
			client.clientId !== clientId
			&& client.tools.some(tool => tool.name === toolName));
	}

	private _startClientToolCallDisconnectTimeout(clientId: string, session: string, chatChannel: string): void {
		const record = this._ensureGraceRecord(clientId);
		if (!record) {
			return;
		}
		record.disconnectTimeouts.deleteAndDispose(chatChannel);
		const elapsed = Date.now() - record.lastSeenAt;
		const delay = Math.max(0, CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT - elapsed);
		record.disconnectTimeouts.set(chatChannel, disposableTimeout(() => {
			this._releaseActiveClientForSession(session, clientId, chatChannel);
		}, delay));
	}

	private _checkOrphanedClientToolCalls(session: string, chatChannel: string): void {
		const state = this._stateManager.getSessionState(chatChannel);
		const orphanOwners = new Set<string>();
		for (const { clientId } of this._pendingClientToolCalls(state)) {
			const ownerRecord = this._clients.get(clientId);
			if (ownerRecord?.state === 'grace') {
				orphanOwners.add(clientId);
			}
		}
		for (const ownerId of orphanOwners) {
			this._startClientToolCallDisconnectTimeout(ownerId, session, chatChannel);
		}
	}

	private _attachConnection(clientId: string, client: IConnectedClient): void {
		const existing = this._clients.get(clientId);
		if (existing?.state === 'active') {
			existing.connections.push(client);
			existing.clientInfo = client.clientInfo ?? existing.clientInfo;
		} else {
			this._clients.set(clientId, { state: 'active', clientInfo: client.clientInfo ?? existing?.clientInfo, connections: [client] });
		}
		this._pruneClientRecords();
	}

	private _rollbackFailedInitialization(client: IConnectedClient, previousRecord: IClientRecord | undefined): void {
		client.telemetryConnectionActive = false;
		const record = this._clients.get(client.clientId);
		if (record?.state === 'active') {
			const connectionIndex = record.connections.indexOf(client);
			if (connectionIndex !== -1) {
				record.connections.splice(connectionIndex, 1);
				this._releaseClientSubscriptions(client, record);
				this._rejectPendingReverseRequestsForConnection(client);
			}
			if (record.connections.length === 0) {
				if (previousRecord?.state === 'grace') {
					this._clients.set(client.clientId, previousRecord);
				} else {
					this._clients.delete(client.clientId);
					this._baselineDebt.delete(client.clientId);
				}
			}
		}
		client.initializationDisposables.dispose();
	}

	private _ensureGraceRecord(clientId: string): IGraceClientRecord | undefined {
		const record = this._clients.get(clientId);
		if (record?.state === 'active') {
			return undefined;
		}
		if (record) {
			return record;
		}
		const created: IGraceClientRecord = {
			state: 'grace',
			seenConnection: false,
			clientInfo: undefined,
			telemetryContext: undefined,
			protocolVersion: undefined,
			lastSeenAt: Date.now(),
			disconnectTimeouts: new DisposableMap(),
		};
		this._clients.set(clientId, created);
		return created;
	}

	private _getActiveClient(clientId: string): IConnectedClient | undefined {
		return this._getActiveClientFromRecord(this._clients.get(clientId));
	}

	private _getActiveClientFromRecord(record: IClientRecord | undefined): IConnectedClient | undefined {
		if (record?.state !== 'active') {
			return undefined;
		}
		return record.connections[record.connections.length - 1];
	}

	private _releaseClientSubscriptions(client: IConnectedClient, record: IActiveClientRecord): void {
		for (const sub of client.subscriptions.values()) {
			if (sub.kind === ChannelKind.State) {
				if (this._hasSubscriptionInOtherConnection(record, client, sub.uri)) {
					continue;
				}
				this._agentService.unsubscribe(URI.parse(sub.uri), client.clientId);
			} else if (sub.kind === ChannelKind.ResourceWatch) {
				this._agentService.onResourceWatchUnsubscribed(sub.uri);
			}
		}
		client.subscriptions.clear();
	}

	private _hasSubscriptionInOtherConnection(record: IClientRecord, client: IConnectedClient, uri: string): boolean {
		if (record.state !== 'active') {
			return false;
		}
		for (const other of record.connections) {
			if (other !== client && other.subscriptions.has(uri)) {
				return true;
			}
		}
		return false;
	}

	hasSeenClient(clientId: string): boolean {
		const record = this._clients.get(clientId);
		return record?.state === 'active'
			? record.connections.some(connection => connection.telemetryConnectionActive)
			: record?.seenConnection === true
			&& record.lastSeenAt >= Date.now() - AGENT_HOST_CLIENT_CONNECTION_HISTORY_RETENTION;
	}

	isClientConnected(clientId: string): boolean {
		const record = this._clients.get(clientId);
		return record?.state === 'active'
			&& record.connections.some(connection => connection.telemetryConnectionActive);
	}

	getConnectedClientTransportCounts(): ReadonlyMap<string, number> {
		const result = new Map<string, number>();
		for (const [clientId, record] of this._clients) {
			if (record.state !== 'active') {
				continue;
			}
			const count = record.connections.filter(connection => connection.telemetryConnectionActive).length;
			if (count > 0) {
				result.set(clientId, count);
			}
		}
		return result;
	}

	async requestWorkspaceTrust(clientId: string, request: IAgentHostWorkspaceTrustRequest): Promise<boolean> {
		const result = await this._sendReverseRequest<IAgentHostExtensionServerCommandMap[typeof RequestAgentHostWorkspaceTrustExtensionMethod]['result']>(
			clientId,
			RequestAgentHostWorkspaceTrustExtensionMethod,
			request,
		);
		return result.trusted === true;
	}

	private get _connectedClientCount(): number {
		let count = 0;
		for (const record of this._clients.values()) {
			if (record.state === 'active') {
				count++;
			}
		}
		return count;
	}

	private _createClientTelemetryContext(clientInfo: Implementation | undefined, meta: Record<string, unknown> | undefined, transport: IProtocolTransport, fallbackConnectionKind = AgentHostClientConnectionKind.Unknown): IAgentHostClientTelemetryContext {
		const connectionKind = readClientConnectionKind(meta);
		const machineId = readClientMachineId(meta);
		const devDeviceId = readClientDevDeviceId(meta);
		return {
			clientType: getAgentHostClientType(clientInfo),
			connectionKind: connectionKind === AgentHostClientConnectionKind.Unknown ? fallbackConnectionKind : connectionKind,
			transportKind: transport.transportKind ?? AgentHostTransportKind.Unknown,
			hostLaunchKind: this._config.hostLaunchKind ?? AgentHostLaunchKind.Unknown,
			...(machineId ? { machineId } : {}),
			...(devDeviceId ? { devDeviceId } : {}),
		};
	}

	private _applyClientTelemetryLevel(meta: Record<string, unknown> | undefined): void {
		const telemetryLevel = readClientTelemetryLevel(meta);
		if (telemetryLevel !== undefined && isAgentHostTelemetryService(this._telemetryService)) {
			this._telemetryService.updateTelemetryLevel(telemetryLevel);
		}
	}

	private _reportClientDisconnected(client: IConnectedClient, subscriptionCount: number): void {
		if (!client.telemetryConnectionActive) {
			return;
		}
		client.telemetryConnectionActive = false;
		const counts = this._clientConnections.getConnectionCounts(client.clientId);
		this._telemetryReporter.clientConnection({
			action: 'disconnected',
			context: client.telemetryContext,
			clientId: client.clientId,
			clientImplementationName: client.clientInfo?.name,
			clientImplementationVersion: client.clientInfo?.version,
			protocolVersion: client.protocolVersion,
			isReconnect: client.isReconnect,
			...counts,
			connectionDurationMs: client.connectionStopWatch.elapsed(),
			subscriptionCount,
		});
	}

	private _pruneClientRecords(): void {
		const cutoff = Date.now() - AGENT_HOST_CLIENT_CONNECTION_HISTORY_RETENTION;
		for (const [clientId, record] of this._clients) {
			if (record.state === 'grace'
				&& record.disconnectTimeouts.size === 0
				&& record.lastSeenAt < cutoff) {
				record.disconnectTimeouts.dispose();
				this._clients.delete(clientId);
				this._baselineDebt.delete(clientId);
			}
		}
	}

	private _clearClientToolCallDisconnectTimeout(clientId: string, channel: string): void {
		const record = this._clients.get(clientId);
		if (record?.state === 'grace') {
			record.disconnectTimeouts.deleteAndDispose(channel);
		}
	}

	private _completeDisconnectedClientToolCalls(clientId: string, session: string, chatChannel: string): void {
		const state = this._stateManager.getSessionState(chatChannel);
		const activeTurn = state?.activeTurn;
		if (!state || !activeTurn) {
			return;
		}
		for (const { toolCall, clientId: ownerId } of this._pendingClientToolCalls(state)) {
			if (ownerId !== clientId) {
				continue;
			}
			const mayRetryWithReplacementClient = this._hasReplacementActiveClientTool(state, clientId, toolCall.toolName);
			if (toolCall.status === ToolCallStatus.Streaming) {
				this._stateManager.dispatchServerAction(chatChannel, {
					type: ActionType.ChatToolCallReady,
					turnId: activeTurn.id,
					toolCallId: toolCall.toolCallId,
					invocationMessage: toolCall.invocationMessage ?? toolCall.displayName,
					confirmed: ToolCallConfirmationReason.NotNeeded,
				});
			}
			this._stateManager.dispatchServerAction(chatChannel, {
				type: ActionType.ChatToolCallComplete,
				turnId: activeTurn.id,
				toolCallId: toolCall.toolCallId,
				result: {
					success: false,
					pastTenseMessage: `${toolCall.displayName} failed`,
					...(mayRetryWithReplacementClient ? { content: [{ type: ToolResultContentType.Text, text: `The client that was running ${toolCall.displayName} disconnected, but another active client now provides ${toolCall.displayName}. You may try calling the tool again.` }] } : {}),
					error: { message: `Client ${clientId} disconnected before completing ${toolCall.displayName}` },
				},
			});
		}
	}


	private readonly _requestHandlers: RequestHandlerMap = {
		subscribe: async (client, params) => {
			const classified = classifyChannel(params.channel);
			if (!classified) {
				return {};
			}
			if (classified.kind === ChannelKind.OtlpLogs) {
				if (!this._config.otlpLogEmitter) {
					this._logService.warn(`[ProtocolServer] Ignoring OTLP subscribe for ${params.channel}: no OTLP emitter configured.`);
					return {};
				}
				client.subscriptions.set(classified.uri, classified);
				return {};
			}
			if (classified.kind === ChannelKind.ResourceWatch) {
				const descriptor = this._agentService.onResourceWatchSubscribed(classified.uri);
				if (!descriptor) {
					throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Resource watch not found: ${params.channel}`);
				}
				client.subscriptions.set(classified.uri, classified);
				return {
					snapshot: {
						resource: classified.uri,
						state: descriptor,
						fromSeq: this._stateManager.serverSeq,
					},
				};
			}
			const existingSubscription = client.subscriptions.get(classified.uri);
			const pendingSubscription = existingSubscription?.kind === ChannelKind.State && existingSubscription.active
				? existingSubscription
				: { ...classified, active: false };
			client.subscriptions.set(classified.uri, pendingSubscription);
			try {
				const snapshot = await this._subscribeStateChannel(
					params.channel,
					client.clientId,
					() => client.subscriptions.get(classified.uri) === pendingSubscription,
				);
				if (client.subscriptions.get(classified.uri) !== pendingSubscription) {
					throw new Error(`Subscription cancelled: ${params.channel}`);
				}
				client.subscriptions.set(classified.uri, classified);
				this._clearClientToolCallDisconnectTimeout(client.clientId, classified.uri);
				this._clearBaselineDebt(client.clientId, classified.uri);
				return { snapshot: snapshot as SubscribeResult['snapshot'] };
			} catch (err) {
				if (!pendingSubscription.active && client.subscriptions.get(classified.uri) === pendingSubscription) {
					client.subscriptions.delete(classified.uri);
				}
				if (err instanceof ProtocolError) {
					throw err;
				}
				throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Resource not found: ${params.channel}`);
			}
		},
		createSession: async (_client, params) => {
			let createdSession: URI;
			if (params.activeClient && params.activeClient.clientId !== _client.clientId) {
				throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `createSession.activeClient.clientId must match the connection's clientId`);
			}
			try {
				createdSession = await this._agentService.createSession({
					provider: params.provider,
					_meta: params._meta,
					workingDirectories: params.workingDirectories?.map(d => URI.parse(d)),
					session: URI.parse(params.channel),
					config: params.config,
					activeClient: params.activeClient,
					progressToken: params.progressToken,
				});
			} catch (err) {
				if (err instanceof ProtocolError) {
					throw err;
				}
				throw new ProtocolError(AHP_PROVIDER_NOT_FOUND, err instanceof Error ? err.message : String(err));
			}
			if (createdSession.toString() !== URI.parse(params.channel).toString()) {
				this._logService.warn(`[ProtocolServer] createSession: provider returned URI ${createdSession.toString()} but client requested ${params.channel}`);
			}
			return null;
		},
		disposeSession: async (_client, params) => {
			await this._agentService.disposeSession(URI.parse(params.channel));
			return null;
		},
		createChat: async (_client, params) => {
			const state = this._stateManager.getSessionState(params.channel);
			if (!state) {
				throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session not found: ${params.channel}`);
			}
			const defaultChat = state.defaultChat ?? buildDefaultChatUri(params.channel);
			if (URI.parse(params.chat).toString() === URI.parse(defaultChat).toString()) {
				return null;
			}
			const source = params.source;
			let options: IAgentCreateChatRequestOptions | undefined;
			if (source) {
				switch (source.kind) {
					case ChatSourceKind.Fork:
						options = { fork: { source: URI.parse(source.chat), turnId: source.turnId } };
						break;
					case ChatSourceKind.SideChat:
						options = {
							sideChat: {
								source: URI.parse(source.chat),
								turnId: source.turnId,
								...(source.selection ? { selection: source.selection } : {}),
							},
						};
						break;
					default:
						throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Unsupported createChat source kind: ${String((source as { kind?: unknown }).kind)}`);
				}
			}
			await this._agentService.createChat(
				URI.parse(params.channel),
				URI.parse(params.chat),
				options,
			);
			return null;
		},
		disposeChat: async (_client, params) => {
			const chat = URI.parse(params.channel);
			const parsed = parseChatUri(chat);
			if (!parsed) {
				return null;
			}
			await this._agentService.disposeChat(URI.parse(parsed.session), chat);
			return null;
		},
		resourceWrite: async (_client, params) => {
			return this._agentService.resourceWrite(params);
		},
		listSessions: async () => {
			const sessions = await this._agentService.listSessions();
			const items = sessions.map(s => {
				const provider = AgentSession.provider(s.session);
				if (!provider) {
					throw new Error(`Agent session URI has no provider scheme: ${s.session.toString()}`);
				}
				return {
					resource: s.session.toString(),
					provider,
					title: s.summary ?? 'Session',
					status: s.status ?? SessionStatus.Idle,
					activity: s.activity,
					createdAt: new Date(s.startTime).toISOString(),
					modifiedAt: new Date(s.modifiedTime).toISOString(),
					...(s.project ? { project: { uri: s.project.uri.toString(), displayName: s.project.displayName } } : {}),
					workingDirectories: s.workingDirectories?.map(d => d.toString()),
					changes: s.changes,
					...(s._meta !== undefined ? { _meta: s._meta } : {}),
				} satisfies ListSessionsResult['items'][number];
			});
			return { items: this._stateManager.prepareSessionSummariesForListing(items) };
		},
		listAutomationTriggerDefinitions: async (_client, params) => {
			return this._agentService.listAutomationTriggerDefinitions(params);
		},
		runAutomation: async (_client, params) => {
			return this._agentService.runAutomation(params);
		},
		fetchAutomationRuns: async (_client, params) => {
			return this._agentService.fetchAutomationRuns(params);
		},
		resolveSessionConfig: async (_client, params) => {
			return this._agentService.resolveSessionConfig({
				provider: params.provider,
				workingDirectory: params.workingDirectory ? URI.parse(params.workingDirectory) : undefined,
				config: params.config,
			});
		},
		sessionConfigCompletions: async (_client, params) => {
			return this._agentService.sessionConfigCompletions({
				provider: params.provider,
				workingDirectory: params.workingDirectory ? URI.parse(params.workingDirectory) : undefined,
				config: params.config,
				property: params.property,
				query: params.query,
			});
		},
		completions: async (_client, params) => {
			return this._agentService.completions(params);
		},
		fetchTurns: async (_client, params) => {
			const state = this._stateManager.getChatState(params.channel);
			if (!state) {
				throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session not found: ${params.channel}`);
			}
			if (params.cursor && params.cursor !== state.turnsNextCursor) {
				throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Unrecognized fetchTurns cursor`);
			}
			this._stateManager.dispatchServerAction(params.channel, {
				type: ActionType.ChatTurnsLoaded,
				turns: [],
			});
			return {};
		},
		resourceList: async (_client, params) => {
			return this._agentService.resourceList(URI.parse(params.uri));
		},
		resourceRead: async (_client, params) => {
			return this._agentService.resourceRead(URI.parse(params.uri), params.encoding);
		},
		resourceCopy: async (_client, params) => {
			return this._agentService.resourceCopy(params);
		},
		resourceDelete: async (_client, params) => {
			return this._agentService.resourceDelete(params);
		},
		resourceMove: async (_client, params) => {
			return this._agentService.resourceMove(params);
		},
		resourceResolve: async (_client, params) => {
			return this._agentService.resourceResolve(params);
		},
		resourceMkdir: async (_client, params) => {
			return this._agentService.resourceMkdir(params);
		},
		createResourceWatch: async (_client, params) => {
			return this._agentService.createResourceWatch(params);
		},
		resourceRequest: async (_client, _params) => {
			return {};
		},
		authenticate: async (_client, params) => {
			const result = await this._agentService.authenticate(params);
			if (!result.authenticated) {
				throw new ProtocolError(AHP_AUTH_REQUIRED, `Authentication failed for resource: ${params.resource}`);
			}
			return {};
		},
		createTerminal: async (_client, params) => {
			await this._agentService.createTerminal(params);
			return null;
		},
		disposeTerminal: async (_client, params) => {
			await this._agentService.disposeTerminal(URI.parse(params.channel));
			return null;
		},
		invokeChangesetOperation: async (_client, params) => {
			return this._agentService.invokeChangesetOperation(params);
		},
	};



	private _reverseRequestId = 0;
	private readonly _pendingReverseRequests = new Map<number, { client: IConnectedClient; resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
	private readonly _inflightRequests = new Set<Promise<unknown>>();

	private _sendReverseRequest<T>(clientId: string, method: string, params: unknown): Promise<T> {
		const client = this._getActiveClient(clientId);
		if (!client) {
			return Promise.reject(new Error(`Client ${clientId} is not connected`));
		}
		const id = ++this._reverseRequestId;
		return new Promise<T>((resolve, reject) => {
			this._pendingReverseRequests.set(id, { client, resolve: resolve as (value: unknown) => void, reject });
			const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
			client.transport.send(request);
		});
	}

	private _rejectPendingReverseRequestsForConnection(client: IConnectedClient): void {
		for (const [id, pending] of this._pendingReverseRequests) {
			if (pending.client === client) {
				this._pendingReverseRequests.delete(id);
				pending.reject(new Error(`Client ${client.clientId} disconnected`));
			}
		}
	}

	private _handleRequest(client: IConnectedClient, method: string, params: unknown, id: number): void {
		const handler = this._requestHandlers.hasOwnProperty(method) ? this._requestHandlers[method as RequestMethod] : undefined;
		if (handler) {
			this._trackRequest((handler as (client: IConnectedClient, params: unknown) => Promise<unknown>)(client, params)).then(result => {
				this._logService.trace(`[ProtocolServer] Request '${method}' id=${id} succeeded`);
				client.transport.send(jsonRpcSuccess(id, result ?? null));
			}).catch(err => {
				if (shouldLogFailedRequest(method, params, err)) {
					this._logService.error(`[ProtocolServer] Request '${method}' failed`, err);
				}
				client.transport.send(jsonRpcErrorFrom(id, err));
			});
			return;
		}

		const extensionResult = this._handleExtensionRequest(method, params);
		if (extensionResult) {
			this._trackRequest(extensionResult).then(result => {
				client.transport.send(jsonRpcSuccess(id, result ?? null));
			}).catch(err => {
				this._logService.error(`[ProtocolServer] Extension request '${method}' failed`, err);
				client.transport.send(jsonRpcErrorFrom(id, err));
			});
			return;
		}

		const mcpChannel = readMcpChannel(params);
		if (mcpChannel !== undefined) {
			const paramsObj = isParamsObject(params) ? params : undefined;
			this._trackRequest(this._agentService.handleMcpRequest(mcpChannel, method, paramsObj)).then(result => {
				client.transport.send(jsonRpcSuccess(id, result ?? null));
			}).catch(err => {
				if (err instanceof Error && err.message.startsWith('Method not found')) {
					client.transport.send(jsonRpcError(id, JsonRpcErrorCodes.MethodNotFound, err.message));
					return;
				}
				this._logService.error(`[ProtocolServer] mcp:// request '${method}' on ${mcpChannel} failed`, err);
				client.transport.send(jsonRpcErrorFrom(id, err));
			});
			return;
		}

		client.transport.send(jsonRpcError(id, JsonRpcErrorCodes.MethodNotFound, `Method not found: ${method}`));
	}

	async whenIdle(): Promise<void> {
		while (this._inflightRequests.size > 0) {
			await Promise.all([...this._inflightRequests].map(promise => promise.then(() => { }, () => { })));
		}
	}

	private _trackRequest<T>(promise: Promise<T>): Promise<T> {
		this._inflightRequests.add(promise);
		const remove = () => this._inflightRequests.delete(promise);
		void promise.then(remove, remove);
		return promise;
	}

	private _handleExtensionRequest(method: string, params: unknown): Promise<unknown> | undefined {
		if (this._config.allowExtensionMethods === false) {
			return undefined;
		}

		switch (method) {
			case 'shutdown':
				return this._agentService.shutdown();
			case 'getNetworkDiagnosticsInfo':
				return this._agentService.getNetworkDiagnosticsInfo();
			case 'getManagedSettingsDiagnostics':
				return this._agentService.getManagedSettingsDiagnostics();
			case 'diagnosticsFetch':
				return this._agentService.diagnosticsFetch((params as { url: string }).url);
			case GetAgentHostSessionStateFileExtensionMethod: {
				if (!this._agentService.getSessionStateFile) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const sessionParam = params['session'];
				if (typeof sessionParam !== 'string') {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be a URI string'));
				}
				let session: URI;
				try {
					session = URI.parse(sessionParam, true);
				} catch {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be a valid URI string'));
				}
				if (!AgentSession.provider(session)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be an Agent Session URI'));
				}
				const chatParam = params['chat'];
				let chat: URI | undefined;
				if (chatParam !== undefined) {
					if (typeof chatParam !== 'string') {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'chat must be a URI string'));
					}
					try {
						chat = URI.parse(chatParam, true);
					} catch {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'chat must be a valid URI string'));
					}
					const parsedChat = parseChatUri(chat);
					if (!parsedChat || parsedChat.session !== session.toString()) {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'chat must belong to the requested Agent Session'));
					}
				}
				return this._agentService.getSessionStateFile(session, chat).then(resource => ({ resource: resource?.toString() }));
			}
			case CreateAgentHostDetachedWorktreeExtensionMethod: {
				if (!this._agentService.createDetachedWorktree) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const sessionParam = params['session'];
				const prompt = params['prompt'];
				if (typeof sessionParam !== 'string') {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be a URI string'));
				}
				if (typeof prompt !== 'string') {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'prompt must be a string'));
				}
				let session: URI;
				try {
					session = URI.parse(sessionParam, true);
				} catch {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be a valid URI string'));
				}
				if (!AgentSession.provider(session)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be a valid Agent Session URI'));
				}
				return this._agentService.createDetachedWorktree(session, prompt).then(result => ({
					handle: result.handle,
					resource: result.worktree.toString(),
				}));
			}
			case SetAgentHostDetachedWorktreeArchivedExtensionMethod: {
				if (!this._agentService.setDetachedWorktreeArchived) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const handle = params['handle'];
				const archived = params['archived'];
				if (!isAgentDevContainerWorktreeHandle(handle)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'handle must be a valid worktree handle'));
				}
				if (typeof archived !== 'boolean') {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'archived must be a boolean'));
				}
				return this._agentService.setDetachedWorktreeArchived(handle, archived);
			}
			case ClaimAgentHostDetachedWorktreeExtensionMethod: {
				if (!this._agentService.claimDetachedWorktree) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const handle = params['handle'];
				if (!isAgentDevContainerWorktreeHandle(handle)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'handle must be a valid worktree handle'));
				}
				return this._agentService.claimDetachedWorktree(handle);
			}
			case DeleteAgentHostDetachedWorktreeExtensionMethod: {
				if (!this._agentService.deleteDetachedWorktree) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const handle = params['handle'];
				if (!isAgentDevContainerWorktreeHandle(handle)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'handle must be a valid worktree handle'));
				}
				return this._agentService.deleteDetachedWorktree(handle);
			}
			case ReconcileAgentHostDetachedWorktreesExtensionMethod: {
				if (!this._agentService.reconcileDetachedWorktrees) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const scope = params['scope'];
				const activeHandles = params['activeHandles'];
				if (typeof scope !== 'string' || !scope) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'scope must be a non-empty string'));
				}
				if (!Array.isArray(activeHandles) || !activeHandles.every(isAgentDevContainerWorktreeHandle)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'activeHandles must contain valid worktree handles'));
				}
				return this._agentService.reconcileDetachedWorktrees(scope, activeHandles);
			}
			case CollectAgentHostDebugLogsExtensionMethod: {
				if (!this._agentService.collectDebugLogs) {
					return undefined;
				}
				const validated = collectAgentHostDebugLogsParamsValidator.validate(params);
				if (validated.error) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, validated.error.message));
				}
				const { session: sessionParam, chat: chatParam, kind } = validated.content;
				let session: URI | undefined;
				if (sessionParam !== undefined) {
					try {
						session = URI.parse(sessionParam, true);
					} catch {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be a valid URI string'));
					}
					if (!AgentSession.provider(session)) {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'session must be an Agent Session URI'));
					}
				}
				let chat: URI | undefined;
				if (chatParam !== undefined) {
					try {
						chat = URI.parse(chatParam, true);
					} catch {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'chat must be a valid URI string'));
					}
					const parsedChat = parseChatUri(chat);
					if (!session || !parsedChat || parsedChat.session !== session.toString()) {
						return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'chat must belong to the requested Agent Session'));
					}
				}
				return this._agentService.collectDebugLogs(session, kind, chat).then(result => ({
					kind: result.kind,
					resource: result.resource.toString(),
					providerLogsIncluded: result.providerLogsIncluded,
					size: result.size,
					uncompressedSize: result.uncompressedSize,
					entries: result.entries,
				}));
			}
			case ReadAgentHostDebugLogsChunkExtensionMethod: {
				if (!this._agentService.readDebugLogsChunk) {
					return undefined;
				}
				if (!isParamsObject(params)) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'params must be an object'));
				}
				const resourceParam = params['resource'];
				if (typeof resourceParam !== 'string') {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'resource must be a URI string'));
				}
				let resource: URI;
				try {
					resource = URI.parse(resourceParam, true);
				} catch {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'resource must be a valid URI string'));
				}
				const position = params['position'];
				if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
					return Promise.reject(new ProtocolError(JsonRpcErrorCodes.InvalidParams, 'position must be a non-negative integer'));
				}
				return this._agentService.readDebugLogsChunk(resource, position).then(chunk => ({
					data: encodeBase64(chunk.data),
					eof: chunk.eof,
				}));
			}
			default:
				return undefined;
		}
	}


	private _broadcastAction(envelope: ActionEnvelope): void {
		this._logService.trace(`[ProtocolServer] Broadcasting action: ${envelope.action.type}`);
		const msg: AhpServerNotification<'action'> = { jsonrpc: '2.0', method: 'action', params: envelope };
		for (const record of this._clients.values()) {
			const client = this._getActiveClientFromRecord(record);
			if (client && this._isRelevantToClient(client, envelope)) {
				client.transport.send(msg);
			}
		}
	}

	private _broadcastNotification(notification: INotification): void {
		const { type, ...params } = notification;
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		const msg = { jsonrpc: '2.0', method: type, params } as AhpServerNotification;
		for (const record of this._clients.values()) {
			this._getActiveClientFromRecord(record)?.transport.send(msg);
		}
	}

	private _broadcastMcpNotification(notification: IMcpNotification): void {
		const params: Record<string, unknown> = { ...(notification.params ?? {}), channel: notification.channel };
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		const msg = { jsonrpc: '2.0' as const, method: notification.method, params } as unknown as AhpServerNotification;
		for (const record of this._clients.values()) {
			this._getActiveClientFromRecord(record)?.transport.send(msg);
		}
	}

	private _removeSubscription(client: IConnectedClient, channel: string): void {
		const classified = classifyChannel(channel);
		if (!classified) {
			return;
		}
		const sub = client.subscriptions.get(classified.uri);
		if (!sub) {
			return;
		}
		client.subscriptions.delete(classified.uri);
		this._clearBaselineDebt(client.clientId, classified.uri);
		if (sub.kind === ChannelKind.State) {
			const record = this._clients.get(client.clientId);
			if (record && this._hasSubscriptionInOtherConnection(record, client, sub.uri)) {
				return;
			}
			this._agentService.unsubscribe(URI.parse(sub.uri), client.clientId);
			if (!sub.active) {
				return;
			}
			if (isAhpChatChannel(sub.uri)) {
				this._releaseActiveClientForSession(parseRequiredSessionUriFromChatUri(sub.uri), client.clientId, sub.uri);
			} else {
				const state = this._stateManager.getSessionState(sub.uri);
				for (const chat of state?.chats ?? []) {
					this._releaseActiveClientForSession(sub.uri, client.clientId, chat.resource);
				}
			}
		} else if (sub.kind === ChannelKind.ResourceWatch) {
			this._agentService.onResourceWatchUnsubscribed(sub.uri);
		}
	}

	private _broadcastOtlpLog(record: IOtlpLogRecord): void {
		const payload = toResourceLogsPayload(record);
		for (const clientRecord of this._clients.values()) {
			const client = this._getActiveClientFromRecord(clientRecord);
			if (!client) {
				continue;
			}
			for (const sub of client.subscriptions.values()) {
				if (sub.kind !== ChannelKind.OtlpLogs) {
					continue;
				}
				if (record.severityNumber < levelToSeverityNumber(sub.level)) {
					continue;
				}
				const msg: AhpServerNotification<'otlp/exportLogs'> = {
					jsonrpc: '2.0',
					method: 'otlp/exportLogs',
					params: { channel: sub.uri, payload },
				};
				client.transport.send(msg);
			}
		}
	}

	private _isRelevantToClient(client: IConnectedClient, envelope: ActionEnvelope): boolean {
		const sub = client.subscriptions.get(envelope.channel);
		if ((sub?.kind === ChannelKind.State || sub?.kind === ChannelKind.ResourceWatch) && sub.active) {
			return true;
		}
		return isActionEnvelopeRelevantToSubscriptionUris(envelope, this._stateAndResourceWatchUris(client));
	}

	private *_stateAndResourceWatchUris(client: IConnectedClient): Iterable<string> {
		for (const sub of client.subscriptions.values()) {
			if ((sub.kind === ChannelKind.State || sub.kind === ChannelKind.ResourceWatch) && sub.active) {
				yield sub.uri;
			}
		}
	}

	private _managedSettingsContributionId(clientId: string): string {
		return `${this._managedSettingsOwnerId}:${clientId}`;
	}

	override dispose(): void {
		for (const [clientId, record] of this._clients) {
			this._managedSettingsService.removeClientPermissions(this._managedSettingsContributionId(clientId));
			if (record.state === 'active') {
				for (const connection of [...record.connections]) {
					const subscriptionCount = connection.subscriptions.size;
					const connectionIndex = record.connections.indexOf(connection);
					if (connectionIndex !== -1) {
						record.connections.splice(connectionIndex, 1);
					}
					this._releaseClientSubscriptions(connection, record);
					this._rejectPendingReverseRequestsForConnection(connection);
					this._reportClientDisconnected(connection, subscriptionCount);
					connection.disposables.dispose();
				}
			} else {
				record.disconnectTimeouts.dispose();
			}
		}
		this._clients.clear();
		for (const [, pending] of this._pendingReverseRequests) {
			pending.reject(new Error('ProtocolServerHandler disposed'));
		}
		this._pendingReverseRequests.clear();
		this._replayBuffer.length = 0;
		super.dispose();
	}
}
