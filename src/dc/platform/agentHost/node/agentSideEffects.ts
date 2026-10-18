/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getErrorCode } from '../../../base/common/errors.js';
import type { Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { NKeyMap } from '../../../base/common/map.js';
import { equals } from '../../../base/common/objects.js';
import { autorun, IObservable, IReader } from '../../../base/common/observable.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import { hasKey } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IAgentHostChangesetService } from '../common/agentHostChangesetService.js';
import { IAgentHostCheckpointService } from '../common/agentHostCheckpointService.js';
import { IAgentHostChatContributions, type ISendTurnMessageOptions } from '../common/agentHostChatContributionsService.js';
import { AgentHostClientType } from '../common/agentHostClientInfo.js';
import { AgentHostLaunchKind, createUnknownAgentHostClientTelemetryContext, type IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { AgentSession, AgentSignal, IAgent, IAgentChatContext, IAgentToolPendingConfirmationSignal, type AgentSubagentTaskModelSource, type IAgentModelCallCompletedSignal } from '../common/agent.js';
import { readToolCallMeta, toToolCallMeta } from '../common/meta/agentToolCallMeta.js';
import { isAgentMergeMessage } from '../common/meta/agentMergeMessageMeta.js';

import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { ISessionDataService } from '../common/sessionDataService.js';
import { SessionConfigKey } from '../common/sessionConfigKeys.js';
import { resolveChatAttachment } from '../common/state/chatAttachmentContext.js';
import { buildOpenSessionLinkForChatResource } from '../common/openSessionLink.js';
import { ToolCallContributorKind, type AgentInfo, type SessionActiveClient } from '../common/state/protocol/state.js';
import type { CustomizationEnablement } from '../common/state/protocol/channels-session/state.js';
import { ActionType, isChatAction, StateAction, type ChatToolCallCompleteAction } from '../common/state/sessionActions.js';
import {
	buildSubagentChatUri,
	createErrorResponsePart,
	getErrorResponsePart,
	getToolFileEdits,
	getInlineToolInput,
	isAhpChatChannel,
	buildDefaultChatUri,
	isSubagentChatUri,
	mergeLogicalTurnUsage,
	MessageAttachmentKind,
	MessageKind,
	parseRequiredSessionUriFromChatUri,
	PendingMessageKind,
	ResponsePartKind,
	readUsageInfoMeta,
	ROOT_STATE_URI,
	SessionLifecycle,
	CustomizationType,
	ToolCallStatus,
	ToolResultContentType,
	type ErrorInfo,
	type ISessionWithDefaultChat,
	type Message,
	type MessageAttachment,
	type URI as ProtocolURI,
	type ToolCallResult,
	type ToolResultContent,
	type Turn,
	type UsageInfo,
	type Customization,
	type McpServerCustomization,
	type PluginCustomization
} from '../common/state/sessionState.js';
import { AgentHostInputRequestTracker } from './agentHostInputRequestTracker.js';
import { AgentHostLocalTurns } from './agentHostLocalTurns.js';
import { IAgentHostSessionTitleController } from './agentHostSessionTitleController.js';
import { AgentHostStateManager, resolveChatStateForUri } from './agentHostStateManager.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';
import { createAgentChatContext, getSessionChatsForFanOut } from './agentChatContext.js';
import { AgentHostTelemetryReporter, getMessageOriginTelemetryKind, IAgentHostTelemetryReporter, type AgentHostMessageOriginTelemetryKind, type AgentHostTurnFailureStage, type AgentHostTurnResult, type IAgentHostTurnFailure } from './agentHostTelemetryReporter.js';
import { AgentHostToolCallTracker, IAgentHostToolCallTracker } from './agentHostToolCallTracker.js';
import { updateAgentHostTelemetryLevelFromConfig } from './agentHostTelemetryService.js';
import { getConfiguredSessionMode, getModelTelemetryContext, getTurnTelemetryContext } from './agentHostTurnTelemetryContext.js';
import { AgentHostTurnTracker, IAgentHostTurnTracker } from './agentHostTurnTracker.js';
import { IAgentHostTurnService } from './agentHostTurnService.js';
import type { IAgentHostCustomizationEnablementService } from './agentHostCustomizationEnablementService.js';
import './localCommands/localChatCommands.contribution.js';
import { SessionPermissionManager } from './sessionPermissions.js';
import { stripProxyErrorMarker, toChatErrorMeta, tryParseForwardedChatError } from './shared/proxyChatError.js';
import { customChatTitleMetadataKey, customChatTitleSourceMetadataKey, SESSION_CUSTOM_TITLE_SOURCE_KEY } from './shared/persistSessionMetadata.js';
import { targetForMcpServer, targetForPlugin } from './shared/customizationEnablementGate.js';
import { IAgentHostWorktreeIsolation } from './shared/worktreeIsolation.js';

export interface IAgentSideEffectsOptions {
	readonly getAgent: (session: ProtocolURI) => IAgent | undefined;
	readonly agents: IObservable<readonly IAgent[]>;
	readonly sessionDataService: ISessionDataService;
	readonly localTurns: AgentHostLocalTurns;
	readonly resolveWorkingDirectoryBeforeSend?: (params: { session: ProtocolURI; chat: ProtocolURI; turnId: string; prompt: string }) => Promise<readonly URI[] | undefined>;
	readonly resolveChatAttachmentTurns?: (resource: ProtocolURI) => Promise<readonly Turn[]>;
	readonly hostLaunchKind?: AgentHostLaunchKind;
}

interface IPendingSubagentSignal {
	readonly signal: AgentSignal;
	readonly agent: IAgent;
}

interface ISubagentSessionRef {
	readonly parentChatUri: ProtocolURI;
	readonly immediateParentChatUri: ProtocolURI | undefined;
	readonly toolCallId: string;
	readonly sessionUri: ProtocolURI;
	readonly chatUri: ProtocolURI;
	readonly turnStopWatch: StopWatch;
	readonly taskModelSource: AgentSubagentTaskModelSource | undefined;
}

interface ISubagentParentTurnTelemetryContext {
	readonly parentTurnId: string | undefined;
	readonly parentClientContext: IAgentHostClientTelemetryContext | undefined;
	readonly messageOriginKind: AgentHostMessageOriginTelemetryKind;
	readonly correlatedParentTurnId: string | undefined;
	readonly initiatorClientId: string | undefined;
}

interface ICustomizationEnablementCandidate {
	readonly customization: PluginCustomization | McpServerCustomization;
	readonly owningPluginUri?: string;
}

const MAX_SUPERSEDED_CUSTOMIZATION_PUBLISH_RETRIES = 3;

function getCustomizationEnablementCandidates(customizations: readonly Customization[] | undefined, mcpServerOwners?: ReadonlyMap<string, string>): readonly ICustomizationEnablementCandidate[] {
	const candidates: ICustomizationEnablementCandidate[] = [];
	for (const customization of customizations ?? []) {
		if (customization.type === CustomizationType.Plugin) {
			candidates.push({ customization });
			for (const child of customization.children ?? []) {
				if (child.type === CustomizationType.McpServer) {
					candidates.push({ customization: child, owningPluginUri: customization.uri });
				}
			}
		} else if (customization.type === CustomizationType.McpServer) {
			candidates.push({ customization, owningPluginUri: mcpServerOwners?.get(customization.name) });
		} else if (customization.type === CustomizationType.Directory) {
			for (const child of customization.children ?? []) {
				if (child.type === CustomizationType.McpServer) {
					candidates.push({ customization: child });
				}
			}
		}
	}
	return candidates;
}

type AgentSignalTurnIdRouting = 'preserve' | 'remap';

interface IResumedTurnExecution {
	readonly duration: number;
	readonly usage: UsageInfo | undefined;
	readonly stopWatch: StopWatch;
}

export class AgentSideEffects extends Disposable {

	private readonly _toolCallAgents = new Map<string, string>();
	private readonly _managedApprovalToolCalls = new Set<string>();
	private readonly _resumedTurnExecutions = new Map<string, IResumedTurnExecution>();
	private _lastAgentInfos: readonly AgentInfo[] = [];

	private readonly _permissionManager: SessionPermissionManager;

	private readonly _subagentChats = new NKeyMap<ISubagentSessionRef, [ProtocolURI, string]>();
	private readonly _cancelledTurnIds = new Map<ProtocolURI, Set<string>>();
	private readonly _pendingSessionCustomizationPublishes = new Map<ProtocolURI, Promise<void>>();
	private readonly _pendingCustomizationEnablementRefreshes = new Set<ProtocolURI>();

	private readonly _pendingSubagentSignals = new NKeyMap<IPendingSubagentSignal[], [ProtocolURI, string]>();
	private readonly _inputRequestTracker: AgentHostInputRequestTracker;
	readonly onDidStartTurn: Event<string>;
	constructor(
		private readonly _stateManager: AgentHostStateManager,
		private readonly _customizationEnablementService: IAgentHostCustomizationEnablementService,
		private readonly _options: IAgentSideEffectsOptions,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostChangesetService private readonly _changesets: IAgentHostChangesetService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IAgentHostCheckpointService private readonly _checkpointService: IAgentHostCheckpointService,
		@IAgentConfigurationService private readonly _agentConfigService: IAgentConfigurationService,
		@IAgentHostChatContributions private readonly _chatContributions: IAgentHostChatContributions,
		@IAgentHostSessionTitleController private readonly _titleController: IAgentHostSessionTitleController,
		@IAgentHostTelemetryReporter private readonly _telemetryReporter: AgentHostTelemetryReporter,
		@IAgentHostTurnTracker private readonly _turnTracker: AgentHostTurnTracker,
		@IAgentHostToolCallTracker private readonly _toolCallTracker: AgentHostToolCallTracker,
		@IAgentHostWorktreeIsolation private readonly _worktree: IAgentHostWorktreeIsolation,
		@IAgentHostTurnService private readonly _turnService: IAgentHostTurnService,
	) {
		super();
		this.onDidStartTurn = this._turnTracker.onDidStartTurn;
		this._inputRequestTracker = new AgentHostInputRequestTracker(this._telemetryReporter, undefined, (session, turnId) => this._turnTracker.getClientTelemetryContext(session, turnId));
		this._permissionManager = this._register(this._instantiationService.createInstance(SessionPermissionManager, this._stateManager, {}));
		this._register(this._stateManager.onDidSnapshotDefaultChatTitle(event => this._persistDefaultChatTitleSnapshot(event.session, event.chat, event.title)));
		this._register(this._chatContributions.registerHost({
			hostLaunchKind: this._options.hostLaunchKind ?? AgentHostLaunchKind.Unknown,
			sendTurnMessage: options => void this._sendTurnMessage(options),
		}));
		this._register(this._stateManager.onDidChangeSessionConfig(e => {
			const previousMode = getConfiguredSessionMode(e.previous);
			const currentMode = getConfiguredSessionMode(e.current);
			if (!previousMode || !currentMode || previousMode === currentMode) {
				return;
			}

			const agent = this._options.getAgent(e.session);
			const sessionState = this._stateManager.getSessionState(e.session);
			if (!agent || !sessionState) {
				return;
			}

			this._telemetryReporter.executionModeChanged(agent.id, e.session, previousMode, currentMode, sessionState.turns.length, e.clientContext);
		}));
		this._register(this._customizationEnablementService.onDidChange(event => {
			for (const session of event.sessions) {
				const agent = this._options.getAgent(session);
				if (agent === undefined) {
					this._pendingCustomizationEnablementRefreshes.add(session);
				} else if (this._stateManager.getSessionState(session)?.customizations !== undefined) {
					this._publishSessionCustomizationsSoon(agent, session);
				}
			}
		}));

		this._register(autorun(reader => {
			const agents = this._options.agents.read(reader);
			this._publishAgentInfos(agents, reader);
			this._publishPendingCustomizationEnablementRefreshes();
		}));

		this._register(this._stateManager.onDidEmitEnvelope(envelope => {
			const action = envelope.action;
			if (action.type === ActionType.SessionCustomizationToggled) {
				const sessionState = this._stateManager.getSessionState(envelope.channel);
				const mcpServerOwners = this._options.getAgent(envelope.channel)?.getMcpServerOwners?.(URI.parse(envelope.channel));
				const customization = getCustomizationEnablementCandidates(sessionState?.customizations, mcpServerOwners)
					.find(candidate => candidate.customization.id === action.id);
				if (customization === undefined) {
					this._logService.warn(`[AgentSideEffects] Ignoring customization toggle for missing ${action.id} in ${envelope.channel}`);
				} else {
					this._recordCustomizationEnablement(envelope.channel, customization, action.enablement);
				}
			}
			if (isAhpChatChannel(envelope.channel) && isChatAction(envelope.action)) {
				const chatState = this._stateManager.getChatState(envelope.channel);
				const action = envelope.action;
				switch (action.type) {
					case ActionType.ChatTurnStarted: {
						if (envelope.rejectionReason) {
							break;
						}
						const sessionChannel = parseRequiredSessionUriFromChatUri(envelope.channel);
						const previousTurn = chatState?.turns.at(-1);
						if (!this._stateManager.isEphemeralSession(sessionChannel)
							&& previousTurn
							&& previousTurn.id !== action.turnId
							&& getErrorResponsePart(previousTurn)?.resumable === true) {
							void this._checkpointService.discardTurnStartCheckpoint(URI.parse(sessionChannel), URI.parse(envelope.channel), previousTurn.id).catch(error => {
								this._logService.warn(`[AgentSideEffects] Failed to discard checkpoint for superseded resumable turn ${previousTurn.id}`, error);
							});
						}
						break;
					}
					case ActionType.ChatInputRequested: {
						const turnId = chatState?.activeTurn?.id;
						const provider = this._options.getAgent(parseRequiredSessionUriFromChatUri(envelope.channel))?.id;
						if (turnId && provider) {
							this._inputRequestTracker.inputRequested(provider, envelope.channel, turnId, action.request);
						}
						break;
					}
					case ActionType.ChatInputCompleted:
						this._inputRequestTracker.inputCompleted(envelope.channel, action, chatState);
						break;
					case ActionType.ChatTurnComplete:
					case ActionType.ChatTurnCancelled:
					case ActionType.ChatError:
						this._inputRequestTracker.clearTurn(envelope.channel, action.turnId);
						break;
					case ActionType.ChatTruncated:
						this._inputRequestTracker.clearChat(envelope.channel);
						break;
				}
				if (envelope.action.type === ActionType.ChatTurnCancelled) {
					let turnIds = this._cancelledTurnIds.get(envelope.channel);
					if (!turnIds) {
						turnIds = new Set();
						this._cancelledTurnIds.set(envelope.channel, turnIds);
					}
					turnIds.add(envelope.action.turnId);
					const sessionChannel = parseRequiredSessionUriFromChatUri(envelope.channel);
					void this._checkpointService.discardTurnStartCheckpoint(URI.parse(sessionChannel), URI.parse(envelope.channel), envelope.action.turnId).catch(() => undefined);
				}
			}
			if (!envelope.origin && envelope.action.type === ActionType.ChatToolCallComplete) {
				const action = envelope.action;
				if (isAhpChatChannel(envelope.channel)) {
					const sessionChannel = parseRequiredSessionUriFromChatUri(envelope.channel);
					this._notifyClientToolCallComplete(sessionChannel, envelope.channel, action.toolCallId, action.result, 'server-envelope');
				}
			}
			if (envelope.action.type === ActionType.SessionChatAdded) {
				for (const activeClient of this._stateManager.getSessionState(envelope.channel)?.activeClients ?? []) {
					this._fanOutActiveClient(envelope.channel, activeClient);
				}
			}
			this._chatContributions.didDispatchAction({
				channel: envelope.channel,
				session: isAhpChatChannel(envelope.channel) ? parseRequiredSessionUriFromChatUri(envelope.channel) : envelope.channel,
				action: envelope.action,
				...(envelope.rejectionReason !== undefined ? { rejectionReason: envelope.rejectionReason } : {}),
			});
		}));
	}

	private _chatContext(session: ProtocolURI, chat: ProtocolURI): IAgentChatContext {
		return createAgentChatContext(this._stateManager, session, chat);
	}

	private _hostCustomizations(session: ProtocolURI): readonly Customization[] | undefined {
		return this._stateManager.getSessionState(session)?.customizations;
	}

	private _fanOutActiveClient(session: ProtocolURI, activeClient: SessionActiveClient): void {
		const agent = this._options.getAgent(session);
		if (!agent) {
			return;
		}
		const chats = getSessionChatsForFanOut(this._stateManager, session);
		if (!chats) {
			this._logService.warn(`[AgentSideEffects] Skipping active-client fan-out for session without host state: session=${session}, clientId=${activeClient.clientId}`);
			return;
		}
		const hostCustomizations = this._hostCustomizations(session);
		for (const chat of chats) {
			const handle = agent.getOrCreateActiveClient(chat, this._chatContext(session, chat.toString()), {
				clientId: activeClient.clientId,
				displayName: activeClient.displayName,
			}, hostCustomizations);
			handle.tools = activeClient.tools;
			handle.customizations = activeClient.customizations ?? [];
		}
	}

	private _publishAgentInfos(agents: readonly IAgent[], reader?: IReader): void {
		const infos: AgentInfo[] = agents.map(a => {
			const d = a.getDescriptor();
			const protectedResources = a.getProtectedResources();
			const models = reader ? a.models.read(reader) : a.models.get();
			const customizations = a.getCustomizations?.();
			return {
				provider: d.provider, displayName: d.displayName, description: d.description, models: models.map(m => ({
					id: m.id,
					provider: m.provider,
					name: m.name,
					maxContextWindow: m.maxContextWindow,
					maxOutputTokens: m.maxOutputTokens,
					maxPromptTokens: m.maxPromptTokens,
					supportsVision: m.supportsVision,
					policyState: m.policyState,
					configSchema: m.configSchema,
					_meta: m._meta,
				})),
				customizations: customizations?.length ? [...customizations] : undefined,
				protectedResources: protectedResources.length > 0 ? protectedResources : undefined,
				capabilities: d.capabilities ? { ...d.capabilities } : undefined,
			};
		});
		if (equals(this._lastAgentInfos, infos)) {
			return;
		}
		this._lastAgentInfos = infos;
		this._stateManager.dispatchServerAction(ROOT_STATE_URI, { type: ActionType.RootAgentsChanged, agents: infos });
	}

	private async _publishSessionCustomizations(agent: IAgent, session: ProtocolURI, supersededRetries: number): Promise<void> {
		const currentBeforeFetch = this._stateManager.getSessionState(session)?.customizations;
		const chat = URI.parse(this._stateManager.getSessionState(session)?.defaultChat ?? buildDefaultChatUri(session));
		const customizations = await agent.getChatCustomizations(chat, this._chatContext(session, chat.toString()), currentBeforeFetch);

		const current = this._stateManager.getSessionState(session)?.customizations;
		if (current !== currentBeforeFetch) {
			if (supersededRetries < MAX_SUPERSEDED_CUSTOMIZATION_PUBLISH_RETRIES) {
				this._publishSessionCustomizationsSoon(agent, session, supersededRetries + 1);
			}
			return;
		}
		if (current && equals(current, customizations)) {
			return;
		}

		this._stateManager.dispatchServerAction(session, {
			type: ActionType.SessionCustomizationsChanged,
			customizations: [...customizations],
		});
	}

	private _publishSessionCustomizationsSoon(agent: IAgent, session: ProtocolURI, supersededRetries = 0): void {
		const previous = this._pendingSessionCustomizationPublishes.get(session) ?? Promise.resolve();
		const publish = previous.then(() => this._publishSessionCustomizations(agent, session, supersededRetries)).catch(err => {
			this._logService.error('[AgentSideEffects] getChatCustomizations failed', err);
		});
		this._pendingSessionCustomizationPublishes.set(session, publish);
		void publish.finally(() => {
			if (this._pendingSessionCustomizationPublishes.get(session) === publish) {
				this._pendingSessionCustomizationPublishes.delete(session);
			}
		});
	}

	private _publishPendingCustomizationEnablementRefreshes(): void {
		for (const session of this._pendingCustomizationEnablementRefreshes) {
			const agent = this._options.getAgent(session);
			if (agent === undefined) {
				continue;
			}
			this._pendingCustomizationEnablementRefreshes.delete(session);
			this._publishSessionCustomizationsSoon(agent, session);
		}
	}

	private _publishSessionCustomizationsForAgent(agent: IAgent): void {
		for (const session of this._stateManager.getSessionUris()) {
			if (this._options.getAgent(session) === agent) {
				this._publishSessionCustomizationsSoon(agent, session);
			}
		}
	}

	private _publishAllSessionCustomizations(): void {
		for (const session of this._stateManager.getSessionUris()) {
			const agent = this._options.getAgent(session);
			if (agent) {
				this._publishSessionCustomizationsSoon(agent, session);
			}
		}
	}


	initialize(): Promise<void> {
		return this._permissionManager.initialize();
	}


	registerProgressListener(agent: IAgent): IDisposable {
		const disposables = new DisposableStore();
		disposables.add(agent.onDidChatProgress(signal => {
			this._handleAgentSignal(agent, signal);
		}));
		if (agent.onDidCustomizationsChange) {
			disposables.add(agent.onDidCustomizationsChange(() => {
				this._publishAgentInfos(this._options.agents.get());
				this._publishSessionCustomizationsForAgent(agent);
			}));
		}
		if (agent.authenticationRequired) {
			disposables.add(autorun(reader => {
				const requirement = agent.authenticationRequired?.read(reader);
				if (requirement) {
					this._stateManager.emitAuthRequired(requirement);
				}
			}));
		}
		return disposables;
	}

	private _handleAgentSignal(agent: IAgent, signal: AgentSignal): void {
		if (signal.kind === 'subagent_started') {
			this._handleSubagentStarted(signal.chat.toString(), signal.toolCallId, signal.agentName, signal.agentDisplayName, signal.agentDescription, signal.taskPrompt, signal.parentToolCallId, signal.taskModelSource);
			this._drainPendingSubagentSignals(signal.chat.toString(), signal.toolCallId);
			return;
		}

		if (signal.kind === 'subagent_resumed') {
			this._resumeSubagentSession(signal.chat.toString(), signal.toolCallId, signal.message);
			return;
		}

		if (signal.kind === 'subagent_completed') {
			this.completeSubagentSession(signal.chat.toString(), signal.toolCallId);
			return;
		}

		if (signal.kind === 'steering_consumed') {
			this._stateManager.dispatchServerAction(signal.chat.toString(), {
				type: ActionType.ChatPendingMessageRemoved,
				kind: PendingMessageKind.Steering,
				id: signal.id,
			});
			return;
		}
		const signalResource = signal.kind === 'action' || signal.kind === 'model_call_completed' ? signal.resource.toString() : signal.chat.toString();
		if (signal.kind === 'action' && !isChatAction(signal.action) && isAhpChatChannel(signalResource)) {
			throw new Error(`Session action ${signal.action.type} must not be dispatched on chat channel ${signalResource}`);
		}
		const sessionKey = signalResource;

		const parentToolCallId = signal.parentToolCallId;
		if (parentToolCallId) {
			const subagentSession = this._subagentChats.get(sessionKey, parentToolCallId);
			if (subagentSession) {
				const subTurnId = this._stateManager.getActiveTurnId(subagentSession.chatUri);
				if (subTurnId) {
					if (signal.kind === 'model_call_completed') {
						this._recordModelCallCompleted(agent, signal, subagentSession.chatUri, subTurnId, 'remap');
					} else {
						this._dispatchActionForSession(signal, subagentSession.chatUri, subTurnId, 'remap', agent);
					}
				} else {
					this._logService.error(`[AgentSideEffects] Dropping ${this._describeSignal(signal)} for inactive subagent ${sessionKey}/${parentToolCallId}`);
					if (signal.kind === 'pending_confirmation') {
						agent.respondToPermissionRequest(signal.state.toolCallId, false);
					}
				}
				return;
			}

			const pendingSignals = this._pendingSubagentSignals.get(sessionKey, parentToolCallId);
			if (signal.kind === 'pending_confirmation' && !pendingSignals) {
				this._logService.error(`[AgentSideEffects] Denying permission for unroutable subagent ${sessionKey}/${parentToolCallId}: toolCallId=${signal.state.toolCallId}`);
				agent.respondToPermissionRequest(signal.state.toolCallId, false);
				return;
			}

			this._logService.trace(`[AgentSideEffects] Buffering ${this._describeSignal(signal)} for pending subagent ${sessionKey}/${parentToolCallId}`);
			let buffer = pendingSignals;
			if (!buffer) {
				buffer = [];
				this._pendingSubagentSignals.set(buffer, sessionKey, parentToolCallId);
			}
			buffer.push({ signal, agent });
			return;
		}

		if (signal.kind === 'pending_confirmation') {
			const subagentChatUri = this._findSubagentChatForToolCall(sessionKey, signal.state.toolCallId);
			if (subagentChatUri) {
				const subTurnId = this._stateManager.getActiveTurnId(subagentChatUri) ?? '';
				void this._handleToolReady(signal, subagentChatUri, subTurnId, agent).catch(err => {
					this._logService.error('[AgentSideEffects] _handleToolReady failed', err);
				});
				return;
			}
		}

		const turnId = this._stateManager.getActiveTurnId(sessionKey);
		if (turnId) {
			if (signal.kind === 'model_call_completed') {
				this._recordModelCallCompleted(agent, signal, sessionKey, turnId, 'preserve');
			} else {
				this._dispatchActionForSession(signal, sessionKey, turnId, 'preserve', agent);
			}
			return;
		}

		if (signal.kind === 'pending_confirmation') {
			void this._handleToolReady(signal, sessionKey, '', agent).catch(err => {
				this._logService.error('[AgentSideEffects] _handleToolReady failed', err);
			});
			return;
		}
		if (signal.kind === 'action') {
			const action = signal.action;
			if (action.type === ActionType.ChatTurnComplete && this._cancelledTurnIds.get(sessionKey)?.has(action.turnId)) {
				this._logService.trace(`[AgentSideEffects] Dropping completion for cancelled turn ${action.turnId} on ${sessionKey}`);
				return;
			}
			this._stateManager.dispatchServerAction(sessionKey, action);
			if (action.type === ActionType.ChatTurnComplete) {
				this._runTurnCompleteSideEffects(sessionKey, undefined);
			}
		}
	}

	private _dispatchActionForSession(signal: AgentSignal, sessionKey: ProtocolURI, turnId: string, turnIdRouting: AgentSignalTurnIdRouting, agent?: IAgent): void {
		if (signal.kind === 'pending_confirmation') {
			if (agent) {
				void this._handleToolReady(signal, sessionKey, turnId, agent).catch(err => {
					this._logService.error('[AgentSideEffects] _handleToolReady failed', err);
				});
			}
			return;
		}
		if (signal.kind !== 'action') {
			return;
		}
		let action = signal.action;
		if (action.type !== ActionType.ChatTruncated && hasKey(action, { turnId: true }) && action.turnId !== turnId) {
			if (turnIdRouting === 'remap') {
				action = { ...action, turnId };
			} else {
				this._logService.trace(`[AgentSideEffects] Dropping stale ${action.type} for ${sessionKey}: producerTurnId=${action.turnId}, activeTurnId=${turnId}`);
				return;
			}
		}
		const attemptUsage = action.type === ActionType.ChatUsage ? action.usage : undefined;
		const resumedExecution = this._resumedTurnExecutions.get(this._resumedTurnExecutionKey(sessionKey, turnId));
		if (resumedExecution) {
			if (action.type === ActionType.ChatUsage) {
				action = { ...action, usage: mergeLogicalTurnUsage(resumedExecution.usage, action.usage) ?? action.usage };
			} else if (action.type === ActionType.ChatTurnComplete || action.type === ActionType.ChatTurnCancelled || action.type === ActionType.ChatError) {
				action = { ...action, duration: resumedExecution.duration + action.duration };
			}
		}

		if (action.type === ActionType.ChatToolCallStart && agent) {
			this._toolCallAgents.set(`${sessionKey}:${action.toolCallId}`, agent.id);
			const modelContext = this._turnTracker.getModelTelemetryContext(sessionKey, action.turnId);
			this._toolCallTracker.toolCallStarted(agent.id, sessionKey, action.turnId, action.toolCallId, action.toolName, action.contributor, modelContext?.model, modelContext?.modelTelemetryKind);
		} else if (action.type === ActionType.ChatToolCallReady) {
			this._toolCallTracker.toolCallMetadataUpdated(sessionKey, action.toolCallId, action.contributor);
			if (action.confirmed) {
				this._toolCallTracker.toolCallExecutionStarted(sessionKey, action.toolCallId);
			}
		}
		if (action.type === ActionType.ChatUsage) {
			const usageMeta = readUsageInfoMeta(attemptUsage ?? action.usage);
			this._turnTracker.updateDirectUsage(
				sessionKey,
				action.turnId,
				usageMeta.directTurnTokenTotals,
				usageMeta.directCopilotUsage?.totalNanoAiu,
			);
			if (!isSubagentChatUri(sessionKey)) {
				this._turnTracker.updateBilledNanoAiu(sessionKey, action.turnId, usageMeta.copilotUsage?.totalNanoAiu);
			}
			if (action.usage.model && agent) {
				const modelContext = getModelTelemetryContext(agent, action.usage.model);
				this._turnTracker.updateModel(sessionKey, action.turnId, modelContext.model, modelContext.modelTelemetryKind);
				this._toolCallTracker.updateTurnModel(sessionKey, action.turnId, modelContext.model, modelContext.modelTelemetryKind);
			}
		}

		const sessionUri = isAhpChatChannel(sessionKey) ? parseRequiredSessionUriFromChatUri(sessionKey) : sessionKey;

		if (
			(action.type === ActionType.ChatToolCallStart || action.type === ActionType.ChatToolCallDelta || action.type === ActionType.ChatToolCallReady)
			&& readToolCallMeta(action).toolKind === 'subagent'
			&& readToolCallMeta(action).subagentChatUri === undefined
		) {
			action = { ...action, _meta: { ...action._meta, subagentChatUri: buildSubagentChatUri(sessionUri, action.toolCallId) } };
		}

		if (action.type === ActionType.ChatToolCallComplete) {
			const subagent = this._subagentChats.get(sessionKey, action.toolCallId);
			if (subagent) {
				const parentState = this._stateManager.getSessionState(sessionKey);
				const runningContent = this._getRunningToolCallContent(parentState, turnId, action.toolCallId);
				const subagentEntry = runningContent.find(c => hasKey(c, { type: true }) && c.type === ToolResultContentType.Subagent);
				if (subagentEntry) {
					const mergedContent = [...(action.result.content ?? []), subagentEntry];
					const merged: ChatToolCallCompleteAction = { ...action, result: { ...action.result, content: mergedContent } };
					action = merged;
				}

			}
		}

		this._stateManager.dispatchServerAction(sessionKey, action);

		if (hasKey(action, { turnId: true })) {
			this._turnTracker.markActivity(sessionKey, turnId, action.type);
		}

		if (action.type === ActionType.ChatDelta
			|| action.type === ActionType.ChatResponsePart
			|| action.type === ActionType.ChatToolCallStart
			|| action.type === ActionType.ChatReasoning) {
			this._turnTracker.markFirstProgress(sessionKey, turnId);
		}

		if (action.type === ActionType.ChatToolCallStart) {
			this._turnTracker.toolCallStarted(sessionKey, turnId, action.toolCallId, action.toolName, action.contributor);
		} else if (action.type === ActionType.ChatToolCallReady) {
			this._turnTracker.toolCallMetadataUpdated(sessionKey, turnId, action.toolCallId, action.contributor);
		}

		if (action.type === ActionType.ChatToolCallConfirmed && !action.approved) {
			this._turnTracker.toolCallEnded(sessionKey, turnId, action.toolCallId);
		}

		if (action.type === ActionType.ChatToolCallComplete) {
			this._turnTracker.toolCallEnded(sessionKey, turnId, action.toolCallId);

			this._toolCallTracker.toolCallCompleted(sessionKey, action.toolCallId, action.result);

			this._pendingSubagentSignals.delete(sessionKey, action.toolCallId);
			if (getToolFileEdits(action.result).length > 0) {
				this._changesets.onToolCallEditsApplied(sessionUri, turnId, this._turnTracker.getClientTelemetryContext(sessionKey, turnId));
			}
		}

		if (action.type === ActionType.ChatTurnComplete) {
			const clientContext = this._turnTracker.getClientTelemetryContext(sessionKey, turnId);
			this._completeTurn(sessionKey, turnId, 'success');
			this._toolCallTracker.clearSession(sessionKey);
			this._runTurnCompleteSideEffects(sessionKey, turnId, clientContext);
		}

		if (action.type === ActionType.ChatTurnCancelled) {
			const clientContext = this._turnTracker.getClientTelemetryContext(sessionKey, turnId);
			this._completeTurn(sessionKey, turnId, 'cancelled');
			this._toolCallTracker.clearSession(sessionKey);
			this._chatContributions.turnEnd({ session: sessionUri, channel: sessionKey, turnId, reason: { kind: 'cancelled' }, clientContext });
		}

		if (action.type === ActionType.ChatError) {
			const clientContext = this._turnTracker.getClientTelemetryContext(sessionKey, turnId);
			this._completeTurn(sessionKey, turnId, 'error', { stage: 'provider', error: action.part.error });
			this._toolCallTracker.clearSession(sessionKey);
			this._chatContributions.turnEnd({
				session: sessionUri,
				channel: sessionKey,
				turnId,
				reason: { kind: 'error', error: action.part.error, resumable: action.part.resumable === true },
				clientContext
			});
		}
		if (action.type === ActionType.ChatTurnComplete || action.type === ActionType.ChatTurnCancelled || action.type === ActionType.ChatError) {
			this._resumedTurnExecutions.delete(this._resumedTurnExecutionKey(sessionKey, turnId));
		}
	}

	private _resumedTurnExecutionKey(chat: ProtocolURI, turnId: string): string {
		return `${chat}\0${turnId}`;
	}

	private _recordModelCallCompleted(agent: IAgent, signal: IAgentModelCallCompletedSignal, sessionKey: ProtocolURI, turnId: string, turnIdRouting: AgentSignalTurnIdRouting): void {
		if (signal.turnId !== turnId && turnIdRouting === 'preserve') {
			this._logService.trace(`[AgentSideEffects] Dropping stale model_call_completed for ${sessionKey}: producerTurnId=${signal.turnId}, activeTurnId=${turnId}`);
			return;
		}
		agent.recordModelCallTurnCorrelation?.(signal.resource, signal.modelCallId, turnId);
		this._turnTracker.modelCallCompleted(sessionKey, turnId, signal.modelCallId);
	}

	private _completeTurn(channel: string, turnId: string, result: AgentHostTurnResult, failure?: IAgentHostTurnFailure): boolean {
		const sessionUri = isAhpChatChannel(channel) ? parseRequiredSessionUriFromChatUri(channel) : channel;
		const folderCount = this._agentConfigService.getEffectiveWorkingDirectories(sessionUri)?.length ?? 0;
		return this._turnTracker.turnCompleted(channel, turnId, result, failure, { isMultiRoot: folderCount > 1, folderCount });
	}

	private _runTurnCompleteSideEffects(sessionKey: ProtocolURI, turnId: string | undefined, clientContext?: IAgentHostClientTelemetryContext): void {
		const sessionUri = isAhpChatChannel(sessionKey) ? parseRequiredSessionUriFromChatUri(sessionKey) : sessionKey;
		this._chatContributions.turnEnd({ session: sessionUri, channel: sessionKey, turnId, reason: { kind: 'success' }, clientContext });
	}

	private _describeSignal(signal: AgentSignal): string {
		return signal.kind === 'action' ? `action(${signal.action.type})` : signal.kind;
	}

	private _drainPendingSubagentSignals(parentChatURI: ProtocolURI, parentToolCallId: string): void {
		const buffer = this._pendingSubagentSignals.get(parentChatURI, parentToolCallId);
		if (!buffer) {
			return;
		}
		this._pendingSubagentSignals.delete(parentChatURI, parentToolCallId);
		this._logService.trace(`[AgentSideEffects] Draining ${buffer.length} buffered signal(s) for subagent ${parentChatURI}/${parentToolCallId}`);
		for (const { signal, agent } of buffer) {
			this._handleAgentSignal(agent, signal);
		}
	}


	private _handleSubagentStarted(
		chatURI: ProtocolURI,
		toolCallId: string,
		agentName: string,
		agentDisplayName: string,
		agentDescription?: string,
		taskPrompt?: string,
		spawningToolParentId?: string,
		taskModelSource?: AgentSubagentTaskModelSource,
	): void {
		const parentSessionUri = parseRequiredSessionUriFromChatUri(chatURI);
		const subagentChatUri = buildSubagentChatUri(parentSessionUri, toolCallId);
		const immediateParentChatUri = spawningToolParentId
			? this._subagentChats.get(chatURI, spawningToolParentId)?.chatUri
			: chatURI;
		const contentChatUri = immediateParentChatUri ?? chatURI;

		const existing = this._subagentChats.get(chatURI, toolCallId);
		if (existing) {
			this._resumeSubagentSession(chatURI, toolCallId, taskPrompt ? { text: taskPrompt, origin: { kind: MessageKind.User } } : undefined, immediateParentChatUri);
			return;
		}

		this._logService.info(`[AgentSideEffects] Starting subagent turn: ${subagentChatUri} (parent=${chatURI}, toolCallId=${toolCallId})`);

		const turnId = generateUuid();
		const parentTurnId = this._stateManager.getActiveTurnId(contentChatUri);
		const { parentClientContext, correlatedParentTurnId, initiatorClientId, messageOriginKind } = this._getSubagentParentTurnTelemetryContext(immediateParentChatUri, contentChatUri);
		this._stateManager.dispatchServerAction(subagentChatUri, {
			type: ActionType.ChatTurnStarted,
			turnId,
			startedAt: new Date().toISOString(),
			message: { text: taskPrompt ?? '', origin: { kind: MessageKind.User } },
		});
		const agent = this._options.getAgent(parentSessionUri);
		if (agent) {
			const interactionMode = getConfiguredSessionMode(this._stateManager.getSessionState(parentSessionUri)?.config);
			this._turnTracker.turnStarted(agent, subagentChatUri, turnId, undefined, undefined, 'default', undefined, interactionMode, parentClientContext, initiatorClientId, correlatedParentTurnId, toolCallId, messageOriginKind, taskModelSource);
			this._turnTracker.setCurrentStage(subagentChatUri, turnId, 'provider');
		}

		this._subagentChats.set({ parentChatUri: chatURI, immediateParentChatUri, toolCallId, sessionUri: parentSessionUri, chatUri: subagentChatUri, turnStopWatch: StopWatch.create(false), taskModelSource }, chatURI, toolCallId);

		if (parentTurnId) {
			const parentState = this._stateManager.getSessionState(contentChatUri);
			const existingContent = this._getRunningToolCallContent(parentState, parentTurnId, toolCallId);
			this._stateManager.dispatchServerAction(contentChatUri, {
				type: ActionType.ChatToolCallContentChanged,
				turnId: parentTurnId,
				toolCallId,
				content: [
					...existingContent,
					{
						type: ToolResultContentType.Subagent,
						resource: subagentChatUri,
						title: agentDisplayName,
						agentName,
						description: agentDescription,
					},
				],
			});
		}
	}

	private _getRunningToolCallContent(
		state: ISessionWithDefaultChat | undefined,
		turnId: string,
		toolCallId: string,
	): ToolResultContent[] {
		if (!state?.activeTurn || state.activeTurn.id !== turnId) {
			return [];
		}
		for (const rp of state.activeTurn.responseParts) {
			if (rp.kind === ResponsePartKind.ToolCall && rp.toolCall.toolCallId === toolCallId && rp.toolCall.status === ToolCallStatus.Running) {
				return rp.toolCall.content ? [...rp.toolCall.content] : [];
			}
		}
		return [];
	}

	private _turnDuration(stopWatch: StopWatch | undefined): number {
		const elapsed = stopWatch?.elapsed();
		return typeof elapsed === 'number' && Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
	}

	private _resumeSubagentSession(parentChatURI: ProtocolURI, toolCallId: string, message: Message | undefined, immediateParentChatURI?: ProtocolURI): void {
		const subagent = this._subagentChats.get(parentChatURI, toolCallId);
		if (!subagent) {
			this._logService.error(`[AgentSideEffects] Cannot resume unknown subagent ${parentChatURI}/${toolCallId}`);
			return;
		}
		if (this._stateManager.getActiveTurnId(subagent.chatUri)) {
			return;
		}

		const turnId = generateUuid();
		const correlatedParentChatUri = immediateParentChatURI ?? subagent.immediateParentChatUri;
		const parentChatUri = correlatedParentChatUri ?? parentChatURI;
		const { parentClientContext, correlatedParentTurnId, initiatorClientId, messageOriginKind } = this._getSubagentParentTurnTelemetryContext(correlatedParentChatUri, parentChatUri);
		this._logService.info(`[AgentSideEffects] Resuming subagent turn: ${subagent.chatUri} (parent=${parentChatURI}, toolCallId=${toolCallId})`);
		this._stateManager.dispatchServerAction(subagent.chatUri, {
			type: ActionType.ChatTurnStarted,
			turnId,
			startedAt: new Date().toISOString(),
			message: message ?? { text: '', origin: { kind: MessageKind.User } },
		});
		const agent = this._options.getAgent(subagent.sessionUri);
		if (agent) {
			const interactionMode = getConfiguredSessionMode(this._stateManager.getSessionState(subagent.sessionUri)?.config);
			this._turnTracker.turnStarted(agent, subagent.chatUri, turnId, undefined, undefined, 'default', undefined, interactionMode, parentClientContext, initiatorClientId, correlatedParentTurnId, toolCallId, messageOriginKind, subagent.taskModelSource);
			this._turnTracker.setCurrentStage(subagent.chatUri, turnId, 'provider');
		}
		this._subagentChats.set({ ...subagent, immediateParentChatUri: correlatedParentChatUri, turnStopWatch: StopWatch.create(false) }, parentChatURI, toolCallId);
	}

	private _getSubagentParentTurnTelemetryContext(immediateParentChatUri: ProtocolURI | undefined, fallbackParentChatUri: ProtocolURI): ISubagentParentTurnTelemetryContext {
		const parentChatUri = immediateParentChatUri ?? fallbackParentChatUri;
		const parentTurnId = this._stateManager.getActiveTurnId(parentChatUri);
		const parentSessionUri = parseRequiredSessionUriFromChatUri(parentChatUri);
		const parentMessageOriginKind = parentTurnId ? this._turnTracker.getMessageOriginKind(parentChatUri, parentTurnId) : undefined;
		return {
			parentTurnId,
			parentClientContext: parentTurnId ? this._turnTracker.getClientTelemetryContext(parentChatUri, parentTurnId) : undefined,
			messageOriginKind: parentMessageOriginKind === 'inline' || (!parentMessageOriginKind && this._stateManager.isEphemeralSession(parentSessionUri))
				? 'inline'
				: MessageKind.Tool,
			correlatedParentTurnId: immediateParentChatUri ? parentTurnId : undefined,
			initiatorClientId: parentTurnId ? this._turnTracker.getInitiatorClientId(parentChatUri, parentTurnId) : undefined,
		};
	}

	cancelSubagentSessions(parentChatURI: ProtocolURI): void {
		for (const subagent of this._subagentChats.getAll(parentChatURI)) {
			const turnId = this._stateManager.getActiveTurnId(subagent.chatUri);
			if (turnId) {
				this._stateManager.dispatchServerAction(subagent.chatUri, {
					type: ActionType.ChatTurnCancelled,
					turnId,
					duration: this._turnDuration(subagent.turnStopWatch),
				});
				this._completeTurn(subagent.chatUri, turnId, 'cancelled');
			}
			this._toolCallTracker.clearSession(subagent.chatUri);
			this._turnTracker.clearSession(subagent.chatUri);
		}
		this._subagentChats.deleteAll(parentChatURI);
		this._pendingSubagentSignals.deleteAll(parentChatURI);
	}

	completeSubagentSession(parentChatURI: ProtocolURI, toolCallId: string): void {
		this._pendingSubagentSignals.delete(parentChatURI, toolCallId);

		const subagent = this._subagentChats.get(parentChatURI, toolCallId);
		if (!subagent) {
			return;
		}

		const turnId = this._stateManager.getActiveTurnId(subagent.chatUri);
		if (turnId) {
			this._stateManager.dispatchServerAction(subagent.chatUri, {
				type: ActionType.ChatTurnComplete,
				turnId,
				duration: this._turnDuration(subagent.turnStopWatch),
			});
			this._completeTurn(subagent.chatUri, turnId, 'success');
			this._toolCallTracker.clearSession(subagent.chatUri);
		}
	}

	removeSubagentSessions(parentSession: ProtocolURI): void {
		for (const chatUri of this._cancelledTurnIds.keys()) {
			if (parseRequiredSessionUriFromChatUri(chatUri) === parentSession) {
				this._cancelledTurnIds.delete(chatUri);
			}
		}

		const parentChatURIs = new Set<ProtocolURI>();
		for (const subagent of this._subagentChats.values()) {
			if (subagent.sessionUri === parentSession) {
				this._stateManager.removeChat(subagent.sessionUri, subagent.chatUri);
				this._toolCallTracker.clearSession(subagent.chatUri);
				this._turnTracker.clearSession(subagent.chatUri);
				parentChatURIs.add(subagent.parentChatUri);
			}
		}
		for (const parentChatURI of parentChatURIs) {
			this._subagentChats.deleteAll(parentChatURI);
			this._pendingSubagentSignals.deleteAll(parentChatURI);
		}
	}

	clearChannelTelemetry(channel: ProtocolURI): void {
		this._toolCallTracker.clearSession(channel);
		this._turnTracker.clearSession(channel);
		const prefix = `${channel}\0`;
		for (const key of this._resumedTurnExecutions.keys()) {
			if (key.startsWith(prefix)) {
				this._resumedTurnExecutions.delete(key);
			}
		}
	}

	clearInputRequestsForSession(session: ProtocolURI): void {
		this._inputRequestTracker.clearAgentSession(session);
	}

	getResumedTurnDuration(channel: ProtocolURI, turnId: string): number | undefined {
		const execution = this._resumedTurnExecutions.get(this._resumedTurnExecutionKey(channel, turnId));
		return execution ? execution.duration + execution.stopWatch.elapsed() : undefined;
	}

	private _findSubagentChatForToolCall(parentChatURI: ProtocolURI, toolCallId: string): ProtocolURI | undefined {
		for (const subagent of this._subagentChats.getAll(parentChatURI)) {
			if (this._toolCallAgents.has(`${subagent.chatUri}:${toolCallId}`)) {
				return subagent.chatUri;
			}
		}
		return undefined;
	}

	private _toolCallCompletionChat(chatChannel: ProtocolURI): ProtocolURI {
		if (!isSubagentChatUri(chatChannel)) {
			return chatChannel;
		}

		for (const subagent of this._subagentChats.values()) {
			if (subagent.chatUri === chatChannel) {
				return this._toolCallCompletionChat(subagent.parentChatUri);
			}
		}

		this._logService.warn(`[AgentSideEffects] Missing parent chat for subagent tool completion: chat=${chatChannel}`);
		return chatChannel;
	}

	private _notifyClientToolCallComplete(sessionChannel: ProtocolURI, chatChannel: ProtocolURI, toolCallId: string, result: ToolCallResult, source: 'client-dispatch' | 'server-envelope'): void {
		const completionChat = this._toolCallCompletionChat(chatChannel);
		const agent = this._options.getAgent(sessionChannel);
		if (!agent) {
			this._logService.warn(`[AgentSideEffects] No agent for client tool completion: source=${source}, session=${sessionChannel}, chat=${chatChannel}, completionChat=${completionChat}, toolCallId=${toolCallId}`);
			return;
		}
		this._logService.info(`[AgentSideEffects] Forwarding client tool completion: source=${source}, session=${sessionChannel}, chat=${chatChannel}, completionChat=${completionChat}, toolCallId=${toolCallId}, success=${result.success}`);
		agent.onClientToolCallComplete(URI.parse(completionChat), toolCallId, result, this._chatContext(sessionChannel, chatChannel));
	}


	private async _handleToolReady(e: IAgentToolPendingConfirmationSignal, sessionKey: ProtocolURI, turnId: string, agent: IAgent): Promise<void> {
		const approvalEvent = {
			toolCallId: e.state.toolCallId,
			session: e.chat,
			permissionKind: e.permissionKind,
			permissionPath: e.permissionPath,
			toolInput: getInlineToolInput(e.state.toolInput),
			requestSandboxBypass: e.requestSandboxBypass,
			shellLanguage: e.shellLanguage,
		};
		const forbiddenSnapshotWrite = this._permissionManager.isForbiddenSnapshotWrite(approvalEvent, sessionKey);
		const autoApproval = e.managedApprovalRequired || forbiddenSnapshotWrite
			? undefined
			: await this._permissionManager.getAutoApproval(approvalEvent, sessionKey);
		const part = this._stateManager.getSessionState(sessionKey)?.activeTurn?.responseParts.find(part => part.kind === ResponsePartKind.ToolCall && part.toolCall.toolCallId === e.state.toolCallId);
		const toolCall = part?.kind === ResponsePartKind.ToolCall ? part.toolCall : undefined;
		if (toolCall
			&& toolCall.status !== ToolCallStatus.Streaming
			&& toolCall.status !== ToolCallStatus.Running
			&& toolCall.status !== ToolCallStatus.PendingConfirmation) {
			const toolCallKey = `${sessionKey}:${e.state.toolCallId}`;
			this._toolCallAgents.delete(toolCallKey);
			this._managedApprovalToolCalls.delete(toolCallKey);
			this._logService.trace(`[AgentSideEffects] Dropping stale tool ready for ${e.state.toolCallId}: status=${toolCall.status}`);
			return;
		}
		const contributor = e.state.contributor ?? toolCall?.contributor;
		let effective = e;
		const toolCallKey = `${sessionKey}:${e.state.toolCallId}`;
		if (forbiddenSnapshotWrite) {
			this._logService.warn(`[AgentSideEffects] Denying write to read-only attachment snapshot: toolCallId=${e.state.toolCallId}`);
			this._toolCallAgents.delete(toolCallKey);
			this._managedApprovalToolCalls.delete(toolCallKey);
			agent.respondToPermissionRequest(e.state.toolCallId, false);
			return;
		}
		if (e.managedApprovalRequired) {
			this._managedApprovalToolCalls.add(toolCallKey);
		} else {
			this._managedApprovalToolCalls.delete(toolCallKey);
		}
		const clientShouldAutoApprove = autoApproval !== undefined
			&& contributor?.kind === ToolCallContributorKind.Client
			&& !!e.state.confirmationTitle;
		if (clientShouldAutoApprove) {
			this._toolCallAgents.set(toolCallKey, agent.id);
			effective = { ...e, state: { ...e.state, _meta: { ...toolCall?._meta, ...e.state._meta, ...toToolCallMeta({ autoApproveBySetting: true }) } } };
		} else if (autoApproval !== undefined) {
			this._toolCallAgents.delete(toolCallKey);
			agent.respondToPermissionRequest(e.state.toolCallId, true);
			effective = { ...e, state: { ...e.state, confirmationTitle: undefined } };
		} else if (effective.state.confirmationTitle) {
			this._toolCallAgents.set(toolCallKey, agent.id);
		}
		if (autoApproval === undefined && !e.managedApprovalRequired && this._permissionManager.isAutoApproveRuleResolvable(approvalEvent, sessionKey)) {
			effective = { ...effective, state: { ...effective.state, _meta: { ...toolCall?._meta, ...effective.state._meta, ...toToolCallMeta({ autoApproveRuleResolvable: true }) } } };
		}
		const readyAction = this._permissionManager.createToolReadyAction(effective, sessionKey, turnId);
		this._toolCallTracker.toolCallMetadataUpdated(sessionKey, readyAction.toolCallId, readyAction.contributor);
		this._turnTracker.toolCallMetadataUpdated(sessionKey, turnId, readyAction.toolCallId, readyAction.contributor);
		if (readyAction.confirmed) {
			this._toolCallTracker.toolCallExecutionStarted(sessionKey, readyAction.toolCallId);
		}
		this._stateManager.dispatchServerAction(sessionKey, readyAction);
		this._turnTracker.markActivity(sessionKey, turnId, readyAction.type);
	}

	handleAction(channel: ProtocolURI, action: StateAction, clientId?: string, clientContextOrType: IAgentHostClientTelemetryContext | AgentHostClientType = AgentHostClientType.Unknown, resumedTurn?: Turn): void {
		let clientContext = typeof clientContextOrType === 'string'
			? createUnknownAgentHostClientTelemetryContext(clientContextOrType)
			: clientContextOrType;
		if (this._options.hostLaunchKind !== undefined) {
			clientContext = { ...clientContext, hostLaunchKind: this._options.hostLaunchKind };
		}
		const chatChannel = isAhpChatChannel(channel) ? channel : undefined;
		const sessionChannel = chatChannel ? parseRequiredSessionUriFromChatUri(chatChannel) : channel;
		switch (action.type) {
			case ActionType.ChatTurnStarted: {
				if (!chatChannel) {
					throw new Error(`ChatTurnStarted must be handled on an AHP chat channel: ${channel}`);
				}
				this._turnService.handleTurnStarted(channel, action, clientId, clientContext);
				break;
			}
			case ActionType.ChatTurnResume: {
				if (!chatChannel || !resumedTurn) {
					throw new Error(`ChatTurnResume must be accepted with its previous turn on an AHP chat channel: ${channel}`);
				}
				const agent = this._options.getAgent(sessionChannel);
				if (!agent?.chats.resumeTurn) {
					throw new Error(`ChatTurnResume reached side effects without provider support: ${sessionChannel}`);
				}
				const state = this._stateManager.getSessionState(channel);
				const { model, modelTelemetryKind, modelSelectionKind, permissionLevel, interactionMode } = getTurnTelemetryContext(agent, channel, this._chatContext(sessionChannel, channel), state, resumedTurn.message.model?.id);
				this._turnTracker.turnStarted(agent, channel, action.turnId, model, modelTelemetryKind, modelSelectionKind, permissionLevel, interactionMode, clientContext, clientId, undefined, undefined, getMessageOriginTelemetryKind(resumedTurn.message, this._stateManager.isEphemeralSession(sessionChannel)));
				this._turnTracker.setCurrentStage(channel, action.turnId, 'provider');
				const key = this._resumedTurnExecutionKey(channel, action.turnId);
				const execution: IResumedTurnExecution = {
					duration: resumedTurn.duration ?? 0,
					usage: resumedTurn.usage,
					stopWatch: StopWatch.create(false),
				};
				this._resumedTurnExecutions.set(key, execution);
				void agent.chats.resumeTurn(
					URI.parse(channel),
					action.turnId,
					{
						...this._chatContext(sessionChannel, channel),
						clientTelemetryContext: clientContext,
						agentMergeTurn: resumedTurn.message.origin.kind === MessageKind.SystemNotification && isAgentMergeMessage(resumedTurn.message),
					},
					clientId,
					clientContext.clientType,
				).catch(error => {
					if (this._resumedTurnExecutions.get(key) !== execution) {
						return;
					}
					const failure = buildTurnFailure('sendMessage', error);
					this._stateManager.dispatchServerAction(channel, {
						type: ActionType.ChatError,
						turnId: action.turnId,
						duration: execution.duration + execution.stopWatch.elapsed(),
						part: createErrorResponsePart(failure.error),
					});
					const endedTurn = this._completeTurn(channel, action.turnId, 'error', failure);
					this._toolCallTracker.clearSession(channel);
					if (endedTurn) {
						this._chatContributions.turnEnd({
							session: sessionChannel,
							channel,
							turnId: action.turnId,
							reason: { kind: 'error', error: failure.error, resumable: false },
							clientContext,
						});
					}
					this._resumedTurnExecutions.delete(key);
				});
				break;
			}
			case ActionType.ChatToolCallConfirmed: {
				if (!chatChannel) {
					throw new Error(`ChatToolCallConfirmed must be handled on an AHP chat channel: ${channel}`);
				}
				const toolCallKey = `${channel}:${action.toolCallId}`;
				if (action.approved) {
					this._toolCallTracker.toolCallExecutionStarted(channel, action.toolCallId);
				} else {
					this._turnTracker.toolCallEnded(channel, action.turnId, action.toolCallId);
				}
				const managedApprovalRequired = this._managedApprovalToolCalls.delete(toolCallKey);
				const agentId = this._toolCallAgents.get(toolCallKey);
				if (agentId) {
					this._toolCallAgents.delete(toolCallKey);
					const agent = this._options.agents.get().find(a => a.id === agentId);
					agent?.respondToPermissionRequest(action.toolCallId, action.approved);
				} else {
					this._logService.warn(`[AgentSideEffects] No agent for tool call confirmation: ${action.toolCallId}`);
				}

				if (action.approved && !managedApprovalRequired) {
					this._permissionManager.handleToolCallConfirmed(channel, action.toolCallId, action.selectedOptionId);
				}
				break;
			}
			case ActionType.ChatInputCompleted: {
				if (!chatChannel) {
					throw new Error(`ChatInputCompleted must be handled on an AHP chat channel: ${channel}`);
				}
				const agent = this._options.getAgent(sessionChannel);
				agent?.respondToUserInputRequest(action.requestId, action.response, action.answers);
				break;
			}
			case ActionType.ChatTurnCancelled: {
				if (!chatChannel) {
					throw new Error(`ChatTurnCancelled must be handled on an AHP chat channel: ${channel}`);
				}
				const endedTurn = this._completeTurn(channel, action.turnId, 'cancelled');
				this._resumedTurnExecutions.delete(this._resumedTurnExecutionKey(channel, action.turnId));
				this._toolCallTracker.clearSession(channel);
				if (endedTurn) {
					this._chatContributions.turnEnd({
						session: sessionChannel,
						channel,
						turnId: action.turnId,
						reason: { kind: 'cancelled' },
						clientContext,
					});
				}
				void this._checkpointService.discardTurnStartCheckpoint(URI.parse(sessionChannel), URI.parse(channel), action.turnId).catch(() => undefined);
				this.cancelSubagentSessions(channel);
				const agent = this._options.getAgent(sessionChannel);
				if (agent) {
					const chat = URI.parse(channel);
					const session = parseRequiredSessionUriFromChatUri(channel);
					agent.chats.abort(chat, { ...this._chatContext(session, channel), clientTelemetryContext: clientContext }).catch(err => {
						this._logService.error('[AgentSideEffects] abort failed', err);
					});
				}
				break;
			}
			case ActionType.SessionTitleChanged: {
				break;
			}
			case ActionType.ChatPendingMessageSet:
			case ActionType.ChatPendingMessageRemoved:
			case ActionType.ChatQueuedMessagesReordered: {
				if (!chatChannel) {
					throw new Error(`${action.type} must be handled on an AHP chat channel: ${channel}`);
				}
				break;
			}
			case ActionType.ChatTruncated: {
				if (!chatChannel) {
					throw new Error(`ChatTruncated must be handled on an AHP chat channel: ${channel}`);
				}
				void this._checkpointService.discardChatTurnStartCheckpoints(URI.parse(sessionChannel), URI.parse(chatChannel)).catch(() => undefined);
				const agent = this._options.getAgent(sessionChannel);
				const sdkTurnId = action.turnId !== undefined
					? this._options.localTurns.resolveConcreteTurnId(chatChannel, action.turnId)
					: action.turnId;
				agent?.truncateChat?.(URI.parse(chatChannel), sdkTurnId, this._chatContext(sessionChannel, chatChannel)).catch(err => {
					this._logService.error('[AgentSideEffects] truncateChat failed', err);
				});
				const survivingIds = new Set((this._stateManager.getChatState(chatChannel)?.turns ?? []).map(t => t.id));
				const removed = this._options.localTurns.getLocalTurnIds(chatChannel).filter(id => !survivingIds.has(id));
				this._options.localTurns.deleteLocals(sessionChannel, removed);
				const trackedTurnIds = new Set(survivingIds);
				const activeTurnId = this._stateManager.getActiveTurnId(chatChannel);
				if (activeTurnId) {
					trackedTurnIds.add(activeTurnId);
				}
				this._turnTracker.clearTurnsExcept(chatChannel, trackedTurnIds);
				this._changesets.onSessionTruncated(sessionChannel);
				break;
			}
			case ActionType.SessionActiveClientSet: {
				this._fanOutActiveClient(channel, action.activeClient);
				break;
			}
			case ActionType.SessionActiveClientRemoved: {
				const agent = this._options.getAgent(channel);
				for (const chat of getSessionChatsForFanOut(this._stateManager, channel) ?? []) {
					agent?.removeActiveClient(chat, this._chatContext(channel, chat.toString()), action.clientId);
				}
				break;
			}
			case ActionType.RootConfigChanged: {
				updateAgentHostTelemetryLevelFromConfig(this._telemetryService, action.config);
				this._publishAgentInfos(this._options.agents.get());
				this._publishAllSessionCustomizations();
				break;
			}
			case ActionType.SessionMcpServerStartRequested: {
				const agent = this._options.getAgent(sessionChannel);
				agent?.startMcpServer?.(URI.parse(sessionChannel), action.id).catch(err => {
					this._logService.warn(`[AgentSideEffects] startMcpServer failed for ${sessionChannel}`, err);
				});
				break;
			}
			case ActionType.SessionMcpServerStopRequested: {
				const agent = this._options.getAgent(sessionChannel);
				agent?.stopMcpServer?.(URI.parse(sessionChannel), action.id).catch(err => {
					this._logService.warn(`[AgentSideEffects] stopMcpServer failed for ${sessionChannel}`, err);
				});
				break;
			}
			case ActionType.SessionIsArchivedChanged: {
				const sessionUri = URI.parse(channel);
				const sessionId = AgentSession.id(channel);
				const worktreeOp = action.isArchived
					? this._worktree.cleanupWorktreeOnArchive(sessionUri, sessionId)
					: this._worktree.recreateWorktreeOnUnarchive(sessionUri, sessionId);
				worktreeOp.catch(err => this._logService.warn(`[AgentSideEffects] worktree ${action.isArchived ? 'cleanup' : 'recreate'} failed for ${channel}`, err));
				const agent = this._options.getAgent(channel);
				agent?.onArchivedChanged?.(URI.parse(channel), action.isArchived).catch(err => {
					this._logService.warn(`[AgentSideEffects] onArchivedChanged failed for ${channel}`, err);
				});
				break;
			}
			case ActionType.SessionConfigChanged: {
				const sessionState = this._stateManager.getSessionState(channel);
				const values = sessionState?.config?.values;
				if (sessionState?.lifecycle === SessionLifecycle.Creating) {
					const sessionId = AgentSession.id(channel);
					const isolation = values?.[SessionConfigKey.Isolation];
					if (isolation === 'worktree') {
						this._worktree.notePending(sessionId);
					} else if (isolation === 'folder') {
						this._worktree.clearPending(sessionId);
					}
				}
				break;
			}
			case ActionType.ChatToolCallComplete: {
				if (!chatChannel) {
					break;
				}
				this._notifyClientToolCallComplete(sessionChannel, chatChannel, action.toolCallId, action.result, 'client-dispatch');
				break;
			}
		}
		this._chatContributions.didApplyClientAction({ channel, session: sessionChannel, action, clientId, clientContext });
	}

	private _recordCustomizationEnablement(session: ProtocolURI, candidate: ICustomizationEnablementCandidate, enablement: readonly CustomizationEnablement[]): void {
		const target = candidate.customization.type === CustomizationType.Plugin
			? targetForPlugin(candidate.customization)
			: targetForMcpServer(candidate.customization, candidate.owningPluginUri, false);
		this._customizationEnablementService.replaceEnablement(session, target, enablement);
	}

	cancelSessionTitleGeneration(session: ProtocolURI): void {
		this._titleController.cancelTitleGeneration(session);
	}

	clearSessionTitleState(session: ProtocolURI, chats: readonly ProtocolURI[]): void {
		this._titleController.clearSession(session, chats);
	}

	generateForkedTitle(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, turns: readonly Turn[], fallbackTitle: string, sourceTitle?: string): void {
		this._titleController.generateForkedTitle(channel, chatChannel, turns, fallbackTitle, sourceTitle);
	}

	markTitleAuto(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, title: string): void {
		this._titleController.markTitleAuto(channel, chatChannel, title);
	}

	generateExternalSessionTitle(session: ProtocolURI, userPrompt: string): Promise<void> {
		return this._titleController.generateExternalSessionTitle(session, userPrompt);
	}

	markTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI): void {
		this._titleController.markTitleRenamed(channel, chatChannel);
	}

	private _persistDefaultChatTitleSnapshot(session: ProtocolURI, chat: ProtocolURI, title: string): void {
		const ref = (() => {
			try {
				return this._options.sessionDataService.openDatabase(URI.parse(session));
			} catch (error) {
				this._logService.warn('[AgentSideEffects] Failed to open session database for default chat title snapshot', error);
				return undefined;
			}
		})();
		if (!ref) {
			return;
		}
		const persist = async () => {
			if (this._stateManager.getChatState(chat)?.title !== title) {
				return;
			}
			const titleKey = customChatTitleMetadataKey(chat);
			await ref.object.setMetadataValuesIfAbsent(
				titleKey,
				{ [titleKey]: title },
				{ [customChatTitleSourceMetadataKey(chat)]: SESSION_CUSTOM_TITLE_SOURCE_KEY },
			);
		};
		void persist().catch(error => {
			this._logService.warn('[AgentSideEffects] Failed to persist default chat title snapshot', error);
		}).finally(() => ref.dispose());
	}

	private async _sendTurnMessage(options: ISendTurnMessageOptions): Promise<void> {
		const { agent, sessionChannel, turnChannel, chat, message, turnId, senderClientId, clientContext, turnStopWatch } = options;

		const chatUri = URI.parse(chat);

		let failureStage: AgentHostTurnFailureStage = 'workingDirectory';
		try {
			this._turnTracker.setCurrentStage(turnChannel, turnId, failureStage);
			const resolvedWorkingDirectories = await this._options.resolveWorkingDirectoryBeforeSend?.({ session: options.sessionChannel, chat, turnId, prompt: message.text });
			const chatContext = this._chatContext(options.sessionChannel, chat);
			const clientOperationContext = {
				...chatContext,
				clientTelemetryContext: clientContext,
				agentMergeTurn: message.origin.kind === MessageKind.SystemNotification && isAgentMergeMessage(message),
			};

			const selectionUpdates: Promise<void>[] = [];
			this._turnTracker.setCurrentStage(turnChannel, turnId, 'modelSelection');
			if (message.model) {
				failureStage = 'modelSelection';
				selectionUpdates.push(agent.chats.changeModel(chatUri, message.model, clientOperationContext));
			}
			selectionUpdates.push(agent.chats.changeAgent(chatUri, message.agent, clientOperationContext).catch(err => {
				this._logService.error('[AgentSideEffects] changeAgent failed', err);
			}));

			await Promise.all(selectionUpdates);

			failureStage = 'sendMessage';
			this._turnTracker.setCurrentStage(turnChannel, turnId, failureStage);
			const resolvedAttachments = await this._resolveChatAttachments(message.attachments);
			const contribution = await this._chatContributions.outgoingTurn({ session: sessionChannel, chat, message, turnId });
			const sendContext = { ...clientOperationContext, ...(contribution.instructions?.length ? { hostInstructions: contribution.instructions } : {}) };
			if (this._cancelledTurnIds.get(turnChannel)?.has(turnId)) { return; }
			if (!this._stateManager.isEphemeralSession(sessionChannel)) {
				await this._checkpointService.captureTurnStartCheckpoint(URI.parse(sessionChannel), chatUri, turnId, resolvedWorkingDirectories);
			}
			if (this._cancelledTurnIds.get(turnChannel)?.has(turnId)) {
				await this._checkpointService.discardTurnStartCheckpoint(URI.parse(sessionChannel), chatUri, turnId);
				return;
			}
			this._turnTracker.setCurrentStage(turnChannel, turnId, 'provider');
			await agent.chats.sendMessage(chatUri, contribution.message.text, resolvedWorkingDirectories, resolvedAttachments, turnId, senderClientId, clientContext.clientType, sendContext);
		} catch (err) {
			const failure = buildTurnFailure(failureStage, err);
			const error = failure.error;
			this._logService.error(`[AgentSideEffects] ${failureStage} failed for session=${turnChannel}: code=${failure.errorCode}, message=${error.message}, type=${failure.errorName}`, err);
			this._stateManager.dispatchServerAction(turnChannel, {
				type: ActionType.ChatError,
				turnId,
				duration: this._turnDuration(turnStopWatch),
				part: createErrorResponsePart(error),
			});
			const endedTurn = this._completeTurn(turnChannel, turnId, 'error', failure);
			this._toolCallTracker.clearSession(turnChannel);
			if (endedTurn) {
				this._chatContributions.turnEnd({
					session: sessionChannel,
					channel: turnChannel,
					turnId,
					reason: { kind: 'error', error, resumable: false },
					clientContext,
				});
			}
			this._failSessionCreationIfStillCreating(sessionChannel, error);
		}
	}

	private async _resolveChatAttachments(attachments: readonly MessageAttachment[] | undefined): Promise<readonly MessageAttachment[] | undefined> {
		if (!attachments?.some(attachment => attachment.type === MessageAttachmentKind.Chat)) {
			return attachments;
		}
		return Promise.all(attachments.map(async attachment => {
			if (attachment.type !== MessageAttachmentKind.Chat) {
				return attachment;
			}
			const openLink = buildOpenSessionLinkForChatResource(attachment.resource);
			const sourceTurns = await this._resolveChatAttachmentSourceTurns(attachment.resource);
			if (sourceTurns === undefined) {
				return resolveChatAttachment({ ...attachment, endTurn: undefined }, [], openLink);
			}
			const sourceState = resolveChatStateForUri(this._stateManager, attachment.resource);
			if (attachment.endTurn !== undefined && sourceState?.activeTurn?.id === attachment.endTurn) {
				throw new Error(`Chat attachment endTurn must reference a completed turn: ${attachment.resource}#${attachment.endTurn}`);
			}
			return resolveChatAttachment(attachment, sourceTurns, openLink);
		}));
	}

	private async _resolveChatAttachmentSourceTurns(resource: ProtocolURI): Promise<readonly Turn[] | undefined> {
		try {
			if (this._options.resolveChatAttachmentTurns) {
				return await this._options.resolveChatAttachmentTurns(resource);
			}
			return resolveChatStateForUri(this._stateManager, resource)?.turns ?? [];
		} catch (err) {
			this._logService.warn(`[AgentSideEffects] Unable to resolve chat attachment source ${resource}; degrading to a pointer without an excerpt`, err);
			return undefined;
		}
	}

	private _failSessionCreationIfStillCreating(sessionChannel: ProtocolURI, error: ErrorInfo): void {
		const state = this._stateManager.getSessionState(sessionChannel);
		if (state?.lifecycle !== SessionLifecycle.Creating) {
			return;
		}
		this._stateManager.dispatchServerAction(sessionChannel, {
			type: ActionType.SessionCreationFailed,
			error,
		});
		const summary = this._stateManager.getSessionSummary(sessionChannel);
		if (summary) {
			this._stateManager.markSessionPersisted(sessionChannel, summary);
		}
	}


	override dispose(): void {
		this._toolCallAgents.clear();
		this._managedApprovalToolCalls.clear();
		this._toolCallTracker.clear();
		this._inputRequestTracker.clear();
		super.dispose();
	}
}

function buildTurnFailure(stage: AgentHostTurnFailureStage, err: unknown): IAgentHostTurnFailure {
	const error = buildTurnFailureError(stage, err);
	return {
		stage,
		error,
		errorName: err instanceof Error ? err.name : typeof err,
		errorCode: getErrorCode(err),
		errorStack: err instanceof Error ? err.stack : undefined,
	};
}

function buildTurnFailureError(stage: AgentHostTurnFailureStage, err: unknown): ErrorInfo {
	const message = String(err);
	const forwarded = tryParseForwardedChatError(err instanceof Error ? err.message : message);
	const errorType = stage === 'modelSelection' ? 'modelSelectionFailed'
		: stage === 'workingDirectory' ? 'workingDirectoryFailed' : 'sendFailed';
	if (forwarded) {
		return { errorType, message: stripProxyErrorMarker(message), _meta: toChatErrorMeta(forwarded) };
	}
	return { errorType, message };
}
