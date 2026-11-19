/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDardcorRouterModel } from '../../common/dardcorRouterModel.js';
import type { ModelInfo, OnElicitation, Options, SDKSessionInfo, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Limiter, retry, SequencerByKey } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable, observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { INativeEnvironmentService } from '../../../environment/common/environment.js';
import { ILogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { IAgentPluginManager, ISyncedCustomization } from '../../common/agentPluginManager.js';
import { IAgentSdkDownloader } from '../agentSdkDownloader.js';
import { AgentSdkSetupChannel } from '../agentSdkSetupChannel.js';
import { decodeProviderData, encodeProviderData, type IPersistedChat } from '../agentChatBackings.js';
import { AgentHostConfigKey, agentHostCustomizationConfigSchema } from '../../common/agentHostCustomizationConfig.js';
import { AgentHostAutoApprovePolicyRestrictedConfigKey, AgentHostClaudeMultiRootEnabledConfigKey, createSchema, platformRootSchema, platformSessionSchema, schemaProperty } from '../../common/agentHostSchema.js';
import { ClaudePermissionMode, ClaudeSessionConfigKey, narrowClaudePermissionMode } from '../../common/claudeSessionConfigKeys.js';
import { createClaudeThinkingLevelSchema, isClaudeEffortLevel } from '../../common/claudeModelConfig.js';
import { SessionConfigKey } from '../../common/sessionConfigKeys.js';
import { AgentChatMigrationDeferred, type AgentChatMigrationResult, AgentProvider, AgentSession, AgentSignal, CLAUDE_AGENT_PROVIDER_ID, IActiveClient, IAgent, IAgentChatContext, IAgentChatDataChange, IAgentChatMetadata, type IAgentChatMetadataOptions, IAgentChats, IAgentChatConfigCompletionsParams, IAgentCreateChatOptions, IAgentCreateChatResult, IAgentDescriptor, IAgentDiscoveredChat, IAgentMaterializeChatEvent, IAgentModelInfo, IAgentResolveChatConfigParams, IAgentSessionProjectInfo, IAgentSpawnChatEvent, IAgentSpawnedChatParent, SubagentChatSignal, resolveAgentChatContext, resolveAgentHostCustomizations, resolveAgentHostInstructions, resolveSubagentChatParent } from '../../common/agent.js';
import { ensureWorkspacelessScratchDir } from '../workspacelessScratchDir.js';
import { ActionType } from '../../common/state/sessionActions.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../../common/state/protocol/commands.js';
import { PolicyState, ProtectedResourceMetadata, type AgentSelection, type ModelSelection, type ToolDefinition } from '../../common/state/protocol/state.js';
import { buildDefaultChatUri, ChatInputResponseKind, isDefaultChatUri, parseRequiredSessionUriFromChatUri, type ClientPluginCustomization, type Customization, type ISessionFolderPickerDecision, type MessageAttachment, type PendingMessage, type ChatInputAnswer, type ToolCallResult, type Turn } from '../../common/state/sessionState.js';
import { IFileService } from '../../../files/common/files.js';
import { computeFolderPickerDecisionForRoots } from '../shared/folderPickerDecision.js';
import { claudeDirectoryQualifiesForPrimary } from './claudeFolderPickerCriteria.js';
import { IAgentConfigurationService } from '../agentConfigurationService.js';
import { IAgentHostGitHubEndpointService } from '../agentHostGitHubEndpointService.js';
import { IAgentHostGitService } from '../../common/agentHostGitService.js';
import { IAgentHostCheckpointService } from '../../common/agentHostCheckpointService.js';
import { PendingRequestRegistry } from '../../common/pendingRequestRegistry.js';
import { projectFromCopilotContext } from '../shared/agentGitProject.js';
import { IDardcorRouterService } from '../shared/dardcorRouterService.js';
import { ClaudeSdkPackage, IClaudeAgentSdkService } from './claudeAgentSdkService.js';
import { buildModelEnumerationOptions } from './claudeSdkOptions.js';
import { isClaudeAccountSetUp, resolveClaudeTransportMode, type ClaudeTransportMode } from './claudeTransportMode.js';
import { mergeClaudeModelCatalogs, resolveClaudeSessionTransport } from './claudeModelSelection.js';
import { mapSessionMessagesToTurns, resolveForkAnchorUuid } from './claudeReplayMapper.js';
import { getSubagentTranscript } from './claudeSubagentResolver.js';
import { SubagentRegistry } from './claudeSubagentRegistry.js';
import { ClaudeAgentSession } from './claudeAgentSession.js';
import { handleCanUseTool } from './claudeCanUseTool.js';
import { handleElicitation } from './claudeElicitationBridge.js';
import type { IAgentServerToolHost } from '../../common/agentServerTools.js';
import { createPricingMetaFromBilling, normalizeCAPIBilling } from '../../common/agentModelPricing.js';
import { tryParseClaudeModelId } from './claudeModelId.js';
import { resolvePromptToContentBlocks } from './claudePromptResolver.js';
import { IClaudeProxyHandle, IClaudeProxyService, type ClaudeTransport } from './claudeProxyService.js';
import { readClaudePermissionMode } from './claudeSessionPermissionMode.js';
import { ClaudeSessionMetadataStore, IClaudeSessionOverlay } from './claudeSessionMetadataStore.js';
import { IAgentHostSessionTitleSignal } from '../agentHostSessionTitleSignal.js';
import { IAgentHostOTelService } from '../../common/otel/agentHostOTelService.js';

const USER_AGENT_PREFIX = 'vscode_claude_code';

const CLAUDE_SETUP_DOCS_URL = 'https://code.claude.com/docs/en/third-party-integrations';

function isClaudeModel(m: IDardcorRouterModel): boolean {
	return (
		m.vendor === 'Anthropic' &&
		!!m.supported_endpoints?.includes('/v1/messages') &&
		!!m.model_picker_enabled &&
		!!m.capabilities?.supports?.tool_calls &&
		tryParseClaudeModelId(m.id) !== undefined
	);
}
interface IClaudeModelSupports {
	readonly adaptive_thinking?: boolean;
	readonly reasoning_effort?: readonly string[];
}

function toAgentModelInfo(m: IDardcorRouterModel, provider: AgentProvider): IAgentModelInfo {
	const supports = m.capabilities?.supports;
	const supportedEfforts = ((supports as IClaudeModelSupports | undefined)?.reasoning_effort ?? []).filter(isClaudeEffortLevel);
	const configSchema = createClaudeThinkingLevelSchema(supportedEfforts);
	const policyState = m.policy?.state as PolicyState | undefined;
	const billing = normalizeCAPIBilling(m.billing);
	const priceCategory = typeof m.model_picker_price_category === 'string'
		? m.model_picker_price_category
		: undefined;
	return {
		provider,
		id: m.id,
		name: m.name,
		maxContextWindow: m.capabilities?.limits?.max_context_window_tokens,
		maxOutputTokens: m.capabilities?.limits?.max_output_tokens,
		maxPromptTokens: m.capabilities?.limits?.max_prompt_tokens,
		supportsVision: !!supports?.vision,
		...(configSchema ? { configSchema } : {}),
		...(policyState ? { policyState } : {}),
		_meta: createPricingMetaFromBilling(billing, priceCategory),
	};
}

const SDK_DEFAULT_MODEL_VALUE = 'default';

function isSdkDefaultModel(m: ModelInfo): boolean {
	return m.value === SDK_DEFAULT_MODEL_VALUE;
}

export function fromSdkModelInfo(m: ModelInfo, provider: AgentProvider): IAgentModelInfo {
	const supportedEfforts = (m.supportedEffortLevels ?? []).filter(isClaudeEffortLevel);
	const configSchema = createClaudeThinkingLevelSchema(supportedEfforts);
	return {
		provider,
		id: m.value,
		name: m.displayName,
		supportsVision: false,
		...(configSchema ? { configSchema } : {}),
	};
}



interface IClaudeChatBacking {
	readonly sdkSessionId: string;
	readonly model?: ModelSelection;
}

interface IClaudeInheritedConversation {
	readonly sdkSessionId?: string;
	readonly inheritedTurnId?: string;
}

interface IChatScopeBinding {
	readonly configurationResource: URI;
	readonly resource: URI;
}

interface IResolvedClaudeChatContext {
	readonly configurationResource: URI;
	readonly sessionId: string;
	readonly resource: URI;
	readonly chat: URI;
	readonly chatKey: string;
	readonly spawnedFrom: IAgentSpawnedChatParent | undefined;
	readonly customizations: readonly Customization[] | undefined;
	readonly sdkSessionId: string | undefined;
	readonly sequencerKey: string;
	readonly target: ClaudeAgentSession | undefined;
}

function _toPersistedChat(backing: IClaudeChatBacking): IPersistedChat {
	return {
		sdkSessionId: backing.sdkSessionId,
		...(backing.model ? { model: backing.model } : {}),
	};
}

class ClaudeActiveClientHandle implements IActiveClient {
	private _tools: readonly ToolDefinition[] = [];
	private _customizations: readonly ClientPluginCustomization[] = [];
	private _customizationsAssigned = false;
	private _hostCustomizations: readonly Customization[] | undefined;

	constructor(
		readonly clientId: string,
		readonly displayName: string | undefined,
		readonly chat: URI,
		private readonly _setTools: (chat: URI, tools: readonly ToolDefinition[]) => void,
		private readonly _syncCustomizations: (chat: URI, customizations: readonly ClientPluginCustomization[], hostCustomizations: readonly Customization[] | undefined) => void,
	) { }

	get tools(): readonly ToolDefinition[] {
		return this._tools;
	}
	set tools(tools: readonly ToolDefinition[]) {
		this._tools = tools;
		this._setTools(this.chat, tools);
	}

	get customizations(): readonly ClientPluginCustomization[] {
		return this._customizations;
	}
	set customizations(customizations: readonly ClientPluginCustomization[]) {
		this._customizations = customizations;
		this._customizationsAssigned = true;
		this._syncCustomizations(this.chat, customizations, this._hostCustomizations);
	}

	get hostCustomizations(): readonly Customization[] | undefined {
		return this._hostCustomizations;
	}

	setHostCustomizations(hostCustomizations: readonly Customization[] | undefined): void {
		if (hostCustomizations !== undefined) {
			this._hostCustomizations = hostCustomizations;
		}
	}

	refresh(): void {
		this._setTools(this.chat, this._tools);
		if (this._customizationsAssigned) {
			this._syncCustomizations(this.chat, this._customizations, this._hostCustomizations);
		}
	}
}

export class ClaudeAgent extends Disposable implements IAgent {
	readonly id: AgentProvider = CLAUDE_AGENT_PROVIDER_ID;
	readonly agentHostCapabilities = { workspaceConversion: false } as const;

	private readonly _onDidChatProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidChatProgress = this._onDidChatProgress.event;

	private readonly _onDidCustomizationsChange = this._register(new Emitter<void>());
	readonly onDidCustomizationsChange = this._onDidCustomizationsChange.event;

	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, []);
	readonly models: IObservable<readonly IAgentModelInfo[]> = this._models;
	private _modelRefreshInFlight: Promise<void> | undefined;

	private _proxyHandle: IClaudeProxyHandle | undefined;
	private _proxyStartPromise: Promise<IClaudeProxyHandle> | undefined;
	private _isDisposing = false;
	private _modelCatalogGeneration = 0;
	private _serverToolHost: IAgentServerToolHost | undefined;

	private _shutdownPromise: Promise<void> | undefined;

	private readonly _chatEntriesBySdkId = this._register(new DisposableMap<string, ClaudeChatEntry>());

	private readonly _chatBackings = new Map<string, IClaudeChatBacking>();

	private readonly _chatConfigScopes = new Map<string, IChatScopeBinding>();

	private readonly _onDidChangeChatData = this._register(new Emitter<IAgentChatDataChange>());
	readonly onDidChangeChatData: Event<IAgentChatDataChange> = this._onDidChangeChatData.event;

	private readonly _onDidSpawnChat = this._register(new Emitter<IAgentSpawnChatEvent>());
	readonly onDidSpawnChat: Event<IAgentSpawnChatEvent> = this._onDidSpawnChat.event;

	private readonly _onDidDiscoverChats = this._register(new Emitter<readonly IAgentDiscoveredChat[]>());
	readonly onDidDiscoverChats = this._onDidDiscoverChats.event;
	private _claudeCodeChatDiscovery: Promise<void> | undefined;

	private readonly _activeClientHandles = new Map<string, ClaudeActiveClientHandle>();

	private readonly _onDidMaterializeChat = this._register(new Emitter<IAgentMaterializeChatEvent>());
	readonly onDidMaterializeChat = this._onDidMaterializeChat.event;

	private readonly _disposeSequencer = new SequencerByKey<string>();

	private readonly _sessionSequencer = new SequencerByKey<string>();

	private readonly _metadataStore: ClaudeSessionMetadataStore;

	private _findAnySession(sessionId: string): ClaudeAgentSession | undefined {
		return this._chatEntriesBySdkId.get(sessionId)?.chatSession;
	}

	private _chatBackingResult(backing: IClaudeChatBacking): IAgentCreateChatResult {
		return {
			providerData: encodeProviderData(_toPersistedChat(backing)),
			backingSession: AgentSession.uri(this.id, backing.sdkSessionId),
		};
	}

	private _findChatByUri(chat: URI | string): ClaudeAgentSession | undefined {
		const sdkSessionId = this._chatBackings.get(typeof chat === 'string' ? chat : chat.toString())?.sdkSessionId;
		return sdkSessionId ? this._findAnySession(sdkSessionId) : undefined;
	}

	private _resolveChatContext(chat: URI, context: URI | IAgentChatContext): IResolvedClaudeChatContext {
		const resolved = resolveAgentChatContext(context, chat);
		const chatKey = chat.toString();
		const backing = this._chatBackings.get(chatKey);
		const sdkSessionId = backing?.sdkSessionId;
		return {
			configurationResource: resolved.configurationResource,
			sessionId: AgentSession.id(resolved.configurationResource),
			resource: resolved.resource,
			chat,
			chatKey,
			spawnedFrom: resolveSubagentChatParent(resolved),
			customizations: resolveAgentHostCustomizations(resolved),
			sdkSessionId,
			sequencerKey: sdkSessionId ?? chatKey,
			target: sdkSessionId ? this._findAnySession(sdkSessionId) : undefined,
		};
	}

	private _recordChatScope(chat: URI, configurationResource: URI, resource: URI): void {
		this._chatConfigScopes.set(chat.toString(), { configurationResource, resource });
	}

	private _sourceChatScope(source: URI): IChatScopeBinding | undefined {
		return this._chatConfigScopes.get(source.toString());
	}

	private _requireChatContext(chat: URI, context: URI | IAgentChatContext | undefined, operation: string): URI | IAgentChatContext {
		if (!context) {
			throw new Error(`[Claude] ${operation} requires host chat context for ${chat.toString()}`);
		}
		return context;
	}

	private _findSessionBySdkId(sdkSessionId: string): ClaudeAgentSession | undefined {
		return this._findAnySession(sdkSessionId);
	}

	private _wireEntry(session: ClaudeAgentSession): ClaudeChatEntry {
		const entry = new ClaudeChatEntry(session);
		entry.addDisposable(session.onDidSessionProgress(signal => {
			this._onDidChatProgress.fire(signal);
			this._emitSpawnedChatEvents(signal);
		}));
		entry.addDisposable(session.onDidCustomizationsChange(() => this._onDidCustomizationsChange.fire()));
		return entry;
	}

	private _registerLiveChat(chat: URI, session: ClaudeAgentSession): void {
		const current = this._chatBackings.get(chat.toString());
		this._deleteLiveChat(chat.toString());
		this._chatEntriesBySdkId.deleteAndDispose(session.sessionId);
		this._chatEntriesBySdkId.set(session.sessionId, this._wireEntry(session));
		this._chatBackings.set(chat.toString(), {
			sdkSessionId: session.sessionId,
			...(current?.model ? { model: current.model } : {}),
		});
	}

	private _deleteLiveChat(chatKey: string): void {
		const backing = this._chatBackings.get(chatKey);
		if (backing?.sdkSessionId) {
			this._chatEntriesBySdkId.deleteAndDispose(backing.sdkSessionId);
		}
	}

	private _deleteSession(session: ClaudeAgentSession): void {
		this._chatEntriesBySdkId.deleteAndDispose(session.sessionId);
	}

	private _emitSpawnedChatEvents(signal: AgentSignal): void {
		const spawn = SubagentChatSignal.toSpawnEvent(signal);
		if (spawn) {
			this._onDidSpawnChat.fire(spawn);
		}
	}

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IDardcorRouterService private readonly _dardcorRouterService: IDardcorRouterService,
		@IClaudeProxyService private readonly _claudeProxyService: IClaudeProxyService,
		@IClaudeAgentSdkService private readonly _sdkService: IClaudeAgentSdkService,
		@IAgentSdkDownloader private readonly _agentSdkDownloader: IAgentSdkDownloader,
		@IAgentHostSessionTitleSignal private readonly _sessionTitleSignal: IAgentHostSessionTitleSignal,
		@IAgentHostOTelService private readonly _otelService: IAgentHostOTelService,
		@IAgentHostGitService private readonly _gitService: IAgentHostGitService,
		@IAgentHostCheckpointService private readonly _checkpointService: IAgentHostCheckpointService,
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
		@IAgentHostGitHubEndpointService private readonly _gitHubEndpointService: IAgentHostGitHubEndpointService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IAgentPluginManager private readonly _pluginManager: IAgentPluginManager,
		@IProductService private readonly _productService: IProductService,
		@INativeEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		this._metadataStore = _instantiationService.createInstance(ClaudeSessionMetadataStore);
		this._register(this._sessionTitleSignal.onDidChangeSessionTitle(({ provider, session, conversationId, title }) => {
			if (provider === this.id) {
				this._otelService.emitSessionTitleChanged(conversationId, session.toString(), title);
			}
		}));

		queueMicrotask(() => { void this._startModelRefresh(); });

		this._sdkSetupChannel = this._register(new AgentSdkSetupChannel({
			id: this.id,
			sdkPackage: ClaudeSdkPackage,
			setupInfo: { setupDocsUrl: CLAUDE_SETUP_DOCS_URL },
			isSdkLocal: () => this._sdkService.canLoadWithoutDownload(),
			downloadSdk: () => this._sdkService.ensureAvailable(),
			restartChatDiscovery: () => this._restartChatDiscovery(),
			refreshModels: () => this._startModelRefresh(),
		}, this._configurationService, this._agentSdkDownloader, this._logService));
	}

	private readonly _sdkSetupChannel: AgentSdkSetupChannel;

	private _defaultTransportMode(): ClaudeTransportMode {
		const allowSignedOutWhenUsable = this._configurationService.getRootValue(agentHostCustomizationConfigSchema, AgentHostConfigKey.AllowSignedOutWhenUsable) === true;
		return resolveClaudeTransportMode({ allowSignedOutWhenUsable, hasExistingSetup: this._nativeAccountSetUp });
	}

	private _nativeAccountSetUp = false;


	getDescriptor(): IAgentDescriptor {
		return {
			provider: this.id,
			displayName: localize('claudeAgent.displayName', "Claude"),
			description: localize('claudeAgent.description', "Claude agent backed by the Anthropic Claude Agent SDK"),
			capabilities: {
				multipleChats: { fork: true, sideChat: true },
				...(this._isMultiRootEnabled() ? { multipleWorkingDirectories: { immutablePrimary: true } } : {}),
			},
		};
	}

	private _isMultiRootEnabled(): boolean {
		return this._configurationService.getRootValue(platformRootSchema, AgentHostClaudeMultiRootEnabledConfigKey) === true;
	}

	async setWorkingDirectory(_chat: URI, _context: URI | IAgentChatContext, _workingDirectory: URI): Promise<void> {
		throw new Error('Claude does not support changing the working directory of an existing session.');
	}

	getProtectedResources(): ProtectedResourceMetadata[] {
		return [this._gitHubEndpointService.getRepoResource()];
	}

	private async _ensureAuthenticated(model?: ModelSelection): Promise<ClaudeTransport> {
		const transport = resolveClaudeSessionTransport({
			model,
			defaultMode: this._defaultTransportMode(),
		});
		if (transport !== 'proxy') {
			return { kind: 'native' };
		}
		const handle = await this._ensureProxyHandle();
		return { kind: 'proxy', handle };
	}

	private _ensureProxyHandle(): Promise<IClaudeProxyHandle> {
		if (this._proxyHandle) {
			return Promise.resolve(this._proxyHandle);
		}
		if (!this._proxyStartPromise) {
			const startPromise = this._claudeProxyService.start().then(handle => {
				if (this._isDisposing) {
					handle.dispose();
					throw new Error('Claude Router transport was stopped before it finished starting.');
				}
				this._proxyHandle = handle;
				return handle;
			}).finally(() => {
				if (this._proxyStartPromise === startPromise) {
					this._proxyStartPromise = undefined;
				}
			});
			this._proxyStartPromise = startPromise;
		}
		return this._proxyStartPromise!;
	}

	async authenticate(resource: string, _token: string): Promise<boolean> {
		return resource === this._gitHubEndpointService.getRepoResource().resource;
	}

	refreshModels(): Promise<void> {
		return this._modelRefreshInFlight ?? this._startModelRefresh();
	}

	private _startModelRefresh(): Promise<void> {
		const generation = ++this._modelCatalogGeneration;
		const refresh = this._refreshModels(generation).finally(() => {
			if (this._modelRefreshInFlight === refresh) {
				this._modelRefreshInFlight = undefined;
			}
		});
		this._modelRefreshInFlight = refresh;
		return refresh;
	}

	private async _refreshModels(generation: number): Promise<void> {
		const canAttemptNative = await this._sdkService.canLoadWithoutDownload();
		if (!canAttemptNative) {
			this._nativeAccountSetUp = false;
		}
		const [proxyOutcome, nativeOutcome] = await Promise.allSettled([
			this._fetchProxyModels(),
			canAttemptNative ? this._fetchNativeModels() : Promise.resolve<readonly IAgentModelInfo[]>([]),
		]);
		if (generation !== this._modelCatalogGeneration) {
			return;
		}
		const attempted = 1 + (canAttemptNative ? 1 : 0);
		const failed = (proxyOutcome.status === 'rejected' ? 1 : 0) + (nativeOutcome.status === 'rejected' ? 1 : 0);
		if (attempted > 0 && failed === attempted) {
			this._logService.error('[Claude] All attempted model sources failed (merged refresh); keeping last known-good catalog');
		} else {
			const settledCatalog = (outcome: PromiseSettledResult<readonly IAgentModelInfo[]>, label: string): readonly IAgentModelInfo[] => {
				if (outcome.status === 'fulfilled') {
					return outcome.value;
				}
				this._logService.error(outcome.reason, `[Claude] Failed to fetch ${label} models (merged refresh); keeping the other provider`);
				return [];
			};
			const proxyModels = settledCatalog(proxyOutcome, 'proxy');
			const nativeModels = settledCatalog(nativeOutcome, 'native');
			const merged = mergeClaudeModelCatalogs(proxyModels, nativeModels);
			this._logService.info(`[Claude] Models refreshed (merged). Count: ${merged.length}, ${merged.map(m => m.name).join(', ')}`);
			this._models.set(merged, undefined);
		}
		this._sdkSetupChannel.refresh();
	}

	private async _fetchNativeModels(): Promise<readonly IAgentModelInfo[]> {
		const neverYieldingPrompt: AsyncIterable<SDKUserMessage> = {
			[Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SDKUserMessage>>(() => { }) }),
		};
		const options = buildModelEnumerationOptions();
		const query = await this._sdkService.query({ prompt: neverYieldingPrompt, options });
		try {
			const [account, models] = await Promise.all([query.accountInfo(), query.supportedModels()]);
			const setUp = isClaudeAccountSetUp(account);
			this._nativeAccountSetUp = setUp;
			this._logService.info(`[Claude] Native account check: setUp=${setUp}, provider=${account.apiProvider ?? 'none'}, tokenSource=${account.tokenSource ?? 'absent'}, apiKeySource=${account.apiKeySource ?? 'absent'}`);
			if (!setUp) {
				return [];
			}
			return models
				.filter(m => !isSdkDefaultModel(m))
				.map(m => fromSdkModelInfo(m, this.id));
		} finally {
			query.close();
			options.abortController?.abort();
		}
	}

	private async _fetchProxyModels(): Promise<readonly IAgentModelInfo[]> {
		const userAgent = `${USER_AGENT_PREFIX}/${this._productService.version}`;
		const all = await this._dardcorRouterService.models({ headers: { 'User-Agent': userAgent } });
		return all
			.filter(isClaudeModel)
			.sort((a, b) => Number(b.is_chat_default) - Number(a.is_chat_default))
			.map(m => toAgentModelInfo(m, this.id));
	}



	private async _seedEagerActiveClient(chat: URI, context: IAgentChatContext, activeClient: IAgentCreateChatOptions['activeClient']): Promise<void> {
		if (!activeClient) {
			return;
		}
		const handle = this.getOrCreateActiveClient(chat, context, { clientId: activeClient.clientId, displayName: activeClient.displayName });
		handle.tools = activeClient.tools;
		if (activeClient.customizations !== undefined) {
			await this.syncClientCustomizations(chat, context, activeClient.clientId, activeClient.customizations, { quiet: true });
		}
	}

	async truncateChat(chat: URI, turnId: string | undefined, context?: URI | IAgentChatContext): Promise<void> {
		if (!context) {
			throw new Error(`[Claude] truncateChat requires host chat context for ${chat.toString()}`);
		}
		const initialContext = this._resolveChatContext(chat, context);
		await this._sessionSequencer.queue(initialContext.sequencerKey, async () => {
			const current = this._resolveChatContext(chat, context);
			const existing = current.target;
			const sdkSessionId = current.sdkSessionId;
			if (!sdkSessionId) {
				throw new Error(`Cannot truncate chat ${chat.toString()}: backing SDK session not found`);
			}
			if (existing && !existing.isPipelineReady) {
				this._logService.info(`[Claude:${sdkSessionId}] truncateChat on a provisional chat — nothing to truncate`);
				return;
			}

			if (turnId === undefined) {
				await this._removeAllTurns(current, sdkSessionId, existing);
				return;
			}

			const messages = await this._sdkService.getSessionMessages(sdkSessionId, { includeSystemMessages: true });
			const anchor = resolveForkAnchorUuid(messages, turnId);
			if (anchor === undefined) {
				throw new Error(`Cannot truncate session ${sdkSessionId}: turn ${turnId} not found in transcript`);
			}

			const live = existing ?? await this._ensureResolvedChatSession(current);
			await live.truncateToTurn(turnId, anchor, current.resource);
			this._logService.info(`[Claude:${sdkSessionId}] truncateChat kept [0..${turnId}] (anchor=${anchor})`);
		});
	}

	private async _removeAllTurns(context: IResolvedClaudeChatContext, sdkSessionId: string, existing: ClaudeAgentSession | undefined): Promise<void> {
		const info = existing ? undefined : await this._sdkService.getSessionInfo(sdkSessionId);
		const workingDirectories = existing?.workingDirectories
			?? (info?.cwd ? [URI.file(info.cwd)] : undefined);
		await existing?.shutdownLiveQuery();
		if (existing) {
			this._deleteSession(existing);
		}
		await this._sdkService.deleteSession(sdkSessionId);
		const fresh = await this._createProvisionalChatSession(context.configurationResource, context.chat, context.resource, workingDirectories);
		await fresh.pruneAllTurns(context.resource);
		this._logService.info(`[Claude:${sdkSessionId}] truncateChat removed all turns (deleteSession + fresh same-id)`);
	}


	readonly chats: IAgentChats = {
		createChat: (chat, context, options) =>
			this._createChat(chat, resolveAgentChatContext(context, chat), options),
		disposeChat: (chat, context) => this._disposeChat(chat, context),
		releaseChat: (chat, context) => this._releaseChat(chat, context),
		sendMessage: (chatUri, prompt, workingDirectoriesOrDirectory, attachments, turnId, senderClientId, clientTypeOrContext, context) => {
			const workingDirectories = Array.isArray(workingDirectoriesOrDirectory) ? workingDirectoriesOrDirectory : workingDirectoriesOrDirectory ? [workingDirectoriesOrDirectory] : undefined;
			const operationContext = context ?? (typeof clientTypeOrContext === 'string' ? undefined : clientTypeOrContext);
			return this._sendMessage(chatUri, prompt, workingDirectories, attachments, turnId, senderClientId, operationContext);
		},
		abort: (chatUri, context) => {
			return this._abortSession(chatUri, context);
		},
		getModel: chatUri => this._chatBackings.get(chatUri.toString())?.model,
		changeModel: (chatUri, model, context) => {
			return this._changeModel(chatUri, model, context);
		},
		changeAgent: (chatUri, agent, context) => {
			return this._changeAgent(chatUri, agent, context);
		},
		getMessages: (chat, context) => this._getChatMessages(chat, context),
	};

	private _makeCanUseTool(sdkSessionId: string, configurationResource: URI): NonNullable<Options['canUseTool']> {
		return (toolName, input, options) =>
			handleCanUseTool(
				{
					getSession: id => this._findSessionBySdkId(id),
					configurationService: this._configurationService,
					configurationResource,
					serverToolHost: this._serverToolHost,
				},
				sdkSessionId, toolName, input, options,
			);
	}

	private _makeOnElicitation(sdkSessionId: string): OnElicitation {
		return (request, options) =>
			handleElicitation(
				{ getSession: id => this._findSessionBySdkId(id) },
				sdkSessionId, request, options,
			);
	}

	private async _materializeProvisional(sessionId: string, context: IResolvedClaudeChatContext, workingDirectories?: readonly URI[]): Promise<ClaudeAgentSession> {
		const session = this._findAnySession(sessionId);
		if (!session) {
			throw new Error(`Cannot materialize unknown provisional session: ${sessionId}`);
		}
		const resource = context.resource;
		const transport = await this._ensureAuthenticated(session.provisionalModel);

		const canUseTool = this._makeCanUseTool(sessionId, context.configurationResource);
		const onElicitation = this._makeOnElicitation(sessionId);
		this._recordChatScope(context.chat, context.configurationResource, context.resource);
		try {
			await session.materialize({
				transport,
				canUseTool,
				onElicitation,
				isResume: false,
				resource,
				configResource: context.configurationResource,
				customizations: context.customizations,
				workingDirectories,
				serverToolHost: this._serverToolHost,
			});
			await this._persistSessionOverlay(resource, context.configurationResource, session, transport.kind);
			if (session.abortController.signal.aborted) {
				throw new CancellationError();
			}
		} catch (err) {
			this._deleteSession(session);
			throw err;
		}

		const materializedWorkingDirectories = workingDirectories ?? session.workingDirectories;

		this._checkpointService.captureBaselineCheckpoint(context.configurationResource, materializedWorkingDirectories).catch(err => {
			this._logService.warn(`[Claude:${sessionId}] Baseline checkpoint capture failed: ${err instanceof Error ? err.message : String(err)}`);
		});

		this._onDidMaterializeChat.fire({
			chat: context.chat,
			project: session.project,
			workingDirectories: materializedWorkingDirectories,
		});

		return session;
	}

	private async _persistSessionOverlay(resource: URI, configResource: URI, session: ClaudeAgentSession, transportKind: ClaudeTransport['kind']): Promise<void> {
		try {
			await this._metadataStore.write(resource, {
				customizationDirectory: session.workingDirectory,
				model: session.provisionalModel,
				permissionMode: readClaudePermissionMode(this._configurationService, configResource) ?? session.permissionModeFallback,
				transport: transportKind,
				workingDirectories: session.workingDirectories,
				...(session.provisionalAgent ? { agent: session.provisionalAgent } : {}),
			});
		} catch (err) {
			this._logService.error(`[Claude] Failed to persist customization directory; aborting materialize`, err);
			throw err;
		}
	}

	private _resolvePermissionMode(config: Record<string, unknown> | undefined): ClaudePermissionMode {
		return narrowClaudePermissionMode(config?.[ClaudeSessionConfigKey.PermissionMode]) ?? 'default';
	}

	private async _disposeLiveSession(session: ClaudeAgentSession): Promise<void> {
		session.abortController.abort();
		if (!session.isPipelineReady) {
		} else {
			session.abort();
		}
		this._deleteSession(session);
	}


	private async _createChat(chat: URI, context: IAgentChatContext, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult> {
		const model = options?.importConversation?.model ?? options?.model;
		if (model || !options?.fork) {
			await this._ensureAuthenticated(model);
		}
		const chatKey = chat.toString();
		this._recordChatScope(chat, context.configurationResource, context.resource);
		return this._sessionSequencer.queue(chatKey, async () => {
			const existing = this._chatBackings.get(chatKey);
			const created = existing
				? this._recreatedChatResult(existing, options)
				: await this._bindChatConversation(chat, context, model, options);
			await this._seedEagerActiveClient(chat, context, options?.activeClient);
			return created;
		});
	}

	private _recreatedChatResult(backing: IClaudeChatBacking, options?: IAgentCreateChatOptions): IAgentCreateChatResult {
		const live = this._findAnySession(backing.sdkSessionId);
		const resolvedWorkingDirectory = live?.workingDirectory ?? options?.workingDirectories?.[0];
		return {
			...(live?.project ? { project: live.project } : {}),
			...(resolvedWorkingDirectory ? { resolvedWorkingDirectory } : {}),
			...(live && !live.isPipelineReady ? { provisional: true } : {}),
			...this._chatBackingResult(backing),
		};
	}

	private async _bindChatConversation(chat: URI, context: IAgentChatContext, model: ModelSelection | undefined, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult> {
		const inherited = await this._inheritSourceConversation(options);
		return inherited.sdkSessionId !== undefined
			? this._bindInheritedConversation(chat, context, { ...inherited, sdkSessionId: inherited.sdkSessionId }, model, options)
			: this._bindFreshConversation(chat, context, inherited, model, options);
	}

	private async _inheritSourceConversation(options?: IAgentCreateChatOptions): Promise<IClaudeInheritedConversation> {
		if (!options?.fork) {
			return {};
		}
		const forked = await this._forkChat(options.fork);
		return {
			...(forked ? { sdkSessionId: forked.sessionId } : {}),
			...(forked?.inheritedTurnId !== undefined ? { inheritedTurnId: forked.inheritedTurnId } : {}),
		};
	}

	private async _bindInheritedConversation(
		chat: URI,
		context: IAgentChatContext,
		inherited: IClaudeInheritedConversation & { readonly sdkSessionId: string },
		model: ModelSelection | undefined,
		options?: IAgentCreateChatOptions,
	): Promise<IAgentCreateChatResult> {
		const { sdkSessionId } = inherited;
		const sourceChat = options?.fork?.source;
		const sourceBinding = sourceChat ? this._sourceChatScope(sourceChat) : undefined;
		const sourceResource = sourceBinding?.resource ?? sourceChat ?? context.resource;
		let sourceOverlay: IClaudeSessionOverlay = {};
		try {
			sourceOverlay = await this._metadataStore.read(sourceResource);
		} catch (err) {
			this._logService.warn(`[Claude] createChat: source overlay read failed for ${sourceResource.toString()}; continuing with defaults`, err);
		}
		const sourceSdkId = sourceChat ? this._sourceChatSdkId(sourceChat) : undefined;
		const liveSource = sourceSdkId ? this._findAnySession(sourceSdkId) : undefined;
		const backingModel = sourceChat ? this._chatBackings.get(sourceChat.toString())?.model : undefined;
		const inheritedModel = model ?? liveSource?.provisionalModel ?? sourceOverlay.model ?? backingModel;
		const agent = options?.agent ?? liveSource?.provisionalAgent ?? sourceOverlay.agent;
		const permissionMode = narrowClaudePermissionMode(options?.config?.[ClaudeSessionConfigKey.PermissionMode]) ?? liveSource?.permissionModeFallback ?? sourceOverlay.permissionMode;

		const sdkInfo = await this._sdkService.getSessionInfo(sdkSessionId);
		const inheritedDirectories = liveSource?.workingDirectories ?? sourceOverlay.workingDirectories ?? options?.workingDirectories;
		const workingDirectory = sdkInfo?.cwd ? URI.file(sdkInfo.cwd) : inheritedDirectories?.[0];
		if (!workingDirectory) {
			throw new Error(`Cannot create chat ${chat.toString()}: inherited conversation ${sdkSessionId} has no working directory (SDK cwd and source working directories missing)`);
		}
		const workingDirectories = [workingDirectory, ...(inheritedDirectories?.slice(1) ?? [])];

		await this._metadataStore.write(context.resource, {
			...(inheritedModel ? { model: inheritedModel } : {}),
			...(permissionMode ? { permissionMode } : {}),
			...(agent ? { agent } : {}),
			workingDirectories,
		});
		const project = await this._resolveProject(workingDirectory);
		const backing = this._recordChatBacking(chat, {
			sdkSessionId,
			...(inheritedModel ? { model: inheritedModel } : {}),
		});
		this._logService.info(`[Claude] Bound chat ${chat.toString()} to inherited conversation ${sdkSessionId} for scope ${context.configurationResource.toString()}`);
		return {
			resolvedWorkingDirectory: workingDirectory,
			...(project ? { project } : {}),
			...(inherited.inheritedTurnId !== undefined ? { inheritedTurnId: inherited.inheritedTurnId } : {}),
			...this._chatBackingResult(backing),
		};
	}

	private async _bindFreshConversation(
		chat: URI,
		context: IAgentChatContext,
		inherited: IClaudeInheritedConversation,
		model: ModelSelection | undefined,
		options?: IAgentCreateChatOptions,
	): Promise<IAgentCreateChatResult> {
		const sdkSessionId = generateUuid();
		const requestedWorkingDirectory = options?.workingDirectories?.[0];
		const workingDirectory = requestedWorkingDirectory ?? await ensureWorkspacelessScratchDir(this._environmentService.userHome, AgentSession.id(context.configurationResource));
		const project = requestedWorkingDirectory ? await this._resolveProject(requestedWorkingDirectory) : undefined;
		const backing = this._recordChatBacking(chat, {
			sdkSessionId,
			...(model ? { model } : {}),
		});
		const session = ClaudeAgentSession.createProvisional(
			sdkSessionId,
			chat,
			workingDirectory,
			project,
			model,
			options?.agent,
			options?.config,
			new PendingRequestRegistry<CallToolResult>(),
			this._resolvePermissionMode(options?.config),
			this._instantiationService,
			options?.workingDirectories?.slice(1) ?? [],
		);
		this._registerLiveChat(chat, session);
		this._logService.info(`[Claude] Bound chat ${chat.toString()} to fresh conversation ${sdkSessionId} for scope ${context.configurationResource.toString()}`);
		return {
			resolvedWorkingDirectory: workingDirectory,
			provisional: true,
			...(project ? { project } : {}),
			...this._chatBackingResult(backing),
		};
	}

	private _recordChatBacking(chat: URI, backing: IClaudeChatBacking): IClaudeChatBacking {
		this._chatBackings.set(chat.toString(), backing);
		return backing;
	}

	private async _resolveProject(workingDirectory: URI): Promise<IAgentSessionProjectInfo | undefined> {
		try {
			return await projectFromCopilotContext({ cwd: workingDirectory.fsPath }, this._gitService);
		} catch (err) {
			this._logService.warn(`[Claude] project resolution failed for ${workingDirectory.toString()}; continuing without project`, err);
			return undefined;
		}
	}

	private async _disposeChat(chat: URI, operationContext: URI | IAgentChatContext): Promise<void> {
		const chatKey = chat.toString();
		const initialContext = this._resolveChatContext(chat, operationContext);
		await this._sessionSequencer.queue(initialContext.sequencerKey, async () => {
			const target = this._findChatByUri(chatKey);
			if (target) {
				await this._disposeLiveSession(target);
			}
			this._chatBackings.delete(chatKey);
			this._chatConfigScopes.delete(chatKey);
			this._pruneActiveClientHandlesForChat(chat);
			this._otelService.releaseSessionTraceContext(initialContext.resource.toString());
		});
	}

	private async _releaseChat(chat: URI, operationContext: URI | IAgentChatContext): Promise<void> {
		const chatKey = chat.toString();
		const initialContext = this._resolveChatContext(chat, operationContext);
		await this._sessionSequencer.queue(initialContext.sequencerKey, async () => {
			const target = this._findChatByUri(chatKey);
			if (!target || !target.isPipelineReady || target.hasActiveTurn) {
				return;
			}
			this._logService.info(`[Claude:${target.sessionId}] Releasing idle chat from memory (durable state preserved)`);
			await this._disposeLiveSession(target);
		});
	}

	private async _forkChat(fork: { readonly source: URI; readonly turnId: string }): Promise<{ sessionId: string; inheritedTurnId: string | undefined } | undefined> {
		const sourceSdkId = this._sourceChatSdkId(fork.source);
		if (!sourceSdkId) {
			this._logService.warn(`[Claude] createChat fork: source ${fork.source.toString()} has no SDK chat; creating fresh chat`);
			return undefined;
		}
		const messages = await this._sdkService.getSessionMessages(sourceSdkId, { includeSystemMessages: true });
		const upToMessageId = resolveForkAnchorUuid(messages, fork.turnId);
		if (upToMessageId === undefined) {
			this._logService.warn(`[Claude] createChat fork: turn ${fork.turnId} not found in source ${sourceSdkId}; creating fresh chat`);
			return undefined;
		}
		const { sessionId } = await this._sdkService.forkSession(sourceSdkId, { upToMessageId });
		const anchorIndex = messages.findIndex(message => message.uuid === upToMessageId);
		const inheritedTurns = mapSessionMessagesToTurns(messages.slice(0, anchorIndex + 1), fork.source, this._logService);
		return { sessionId, inheritedTurnId: inheritedTurns.at(-1)?.id };
	}


	private _sourceChatSdkId(source: URI): string | undefined {
		return this._chatBackings.get(source.toString())?.sdkSessionId;
	}

	private async _resolveOrResumeChatSessionLocked(context: IResolvedClaudeChatContext, workingDirectories?: readonly URI[]): Promise<ClaudeAgentSession> {
		const { configurationResource, chat, chatKey, resource } = context;
		const existing = this._findChatByUri(chatKey);
		if (existing?.isPipelineReady) {
			return existing;
		}
		const chatSession = existing ?? await this._createProvisionalChatSession(configurationResource, chat, resource, workingDirectories);
		const sdkInfo = await this._sdkService.getSessionInfo(chatSession.sessionId);
		const transport = await this._ensureAuthenticated(chatSession.provisionalModel);
		const canUseTool = this._makeCanUseTool(chatSession.sessionId, configurationResource);
		const onElicitation = this._makeOnElicitation(chatSession.sessionId);
		this._recordChatScope(chat, configurationResource, resource);
		try {
			await chatSession.materialize({
				transport,
				canUseTool,
				onElicitation,
				isResume: !!sdkInfo,
				resource,
				configResource: configurationResource,
				customizations: context.customizations,
				workingDirectories,
				serverToolHost: this._serverToolHost,
			});
			await this._persistSessionOverlay(resource, configurationResource, chatSession, transport.kind);
		} catch (err) {
			this._deleteLiveChat(chatKey);
			throw err;
		}
		this._onDidMaterializeChat.fire({
			chat: context.chat,
			project: chatSession.project,
			workingDirectories: workingDirectories ?? chatSession.workingDirectories,
		});
		return chatSession;
	}

	private async _ensureResolvedChatSession(context: IResolvedClaudeChatContext, workingDirectories?: readonly URI[]): Promise<ClaudeAgentSession> {
		const existing = context.target;
		if (existing?.isPipelineReady) {
			return existing;
		}
		if (existing) {
			return this._materializeProvisional(existing.sessionId, context, workingDirectories);
		}
		return this._resolveOrResumeChatSessionLocked(context, workingDirectories);
	}

	private async _createProvisionalChatSession(configurationResource: URI, chat: URI, resource: URI, fallbackWorkingDirectories?: readonly URI[]): Promise<ClaudeAgentSession> {
		const info = this._chatBackings.get(chat.toString());
		if (!info) {
			throw new Error(`[Claude] no backing chat for chat ${chat.toString()}`);
		}
		let overlay: IClaudeSessionOverlay = {};
		try {
			overlay = await this._metadataStore.read(resource);
		} catch (err) {
			this._logService.warn(`[Claude] chat overlay read failed for ${chat.toString()}; continuing with defaults`, err);
		}
		const sdkInfo = await this._sdkService.getSessionInfo(info.sdkSessionId);
		const workingDirectories = sdkInfo?.cwd
			? [URI.file(sdkInfo.cwd), ...(overlay.workingDirectories?.slice(1) ?? [])]
			: overlay.workingDirectories ?? fallbackWorkingDirectories;
		const workingDirectory = workingDirectories?.[0];
		if (!workingDirectory) {
			throw new Error(`[Claude] cannot materialize chat ${chat.toString()}: working directory missing (no SDK transcript and no persisted overlay)`);
		}
		const additionalDirectories = workingDirectories.slice(1);
		let project: IAgentSessionProjectInfo | undefined;
		try {
			project = await projectFromCopilotContext({ cwd: workingDirectory.fsPath }, this._gitService);
		} catch (err) {
			this._logService.warn(`[Claude] project resolution failed for chat ${chat.toString()}; continuing without project`, err);
		}
		const permissionMode = readClaudePermissionMode(this._configurationService, configurationResource) ?? overlay.permissionMode ?? 'default';
		const model = overlay.model ?? info.model;
		const chatSession = ClaudeAgentSession.createProvisional(
			info.sdkSessionId,
			chat,
			workingDirectory,
			project,
			model,
			overlay.agent,
			undefined,
			new PendingRequestRegistry<CallToolResult>(),
			permissionMode,
			this._instantiationService,
			additionalDirectories,
		);
		this._registerLiveChat(chat, chatSession);
		this._recordChatScope(chat, configurationResource, resource);
		this._forEachActiveClientHandleForChat(chat, handle => handle.refresh());
		return chatSession;
	}

	private _forEachActiveClientHandleForChat(chat: URI, visit: (handle: ClaudeActiveClientHandle) => void): void {
		const prefix = `${chat.toString()}\u0000`;
		for (const [key, handle] of this._activeClientHandles) {
			if (key.startsWith(prefix)) {
				visit(handle);
			}
		}
	}

	private _pruneActiveClientHandlesForChat(chat: URI): void {
		const prefix = `${chat.toString()}\u0000`;
		for (const key of [...this._activeClientHandles.keys()]) {
			if (key.startsWith(prefix)) {
				this._activeClientHandles.delete(key);
			}
		}
	}

	private async _updateChatBackingModel(chat: URI, model: ModelSelection): Promise<void> {
		const existing = this._chatBackings.get(chat.toString());
		if (!existing) {
			return;
		}
		const updated: IClaudeChatBacking = { ...existing, model };
		this._chatBackings.set(chat.toString(), updated);
		this._onDidChangeChatData.fire({ chat, providerData: encodeProviderData(_toPersistedChat(updated)) });
	}

	async materializeChat(chat: URI, context: URI | IAgentChatContext, providerData: string | undefined): Promise<IAgentCreateChatResult | void> {
		const resolved = resolveAgentChatContext(context, chat);
		this._recordChatScope(chat, resolved.configurationResource, resolved.resource);
		if (providerData === undefined) {
			if (!isDefaultChatUri(chat)) {
				return;
			}
			const backing = { sdkSessionId: AgentSession.id(resolved.configurationResource) };
			this._chatBackings.set(chat.toString(), backing);
			return { providerData: encodeProviderData(_toPersistedChat(backing)) };
		}
		const persisted = decodeProviderData(providerData);
		if (!persisted) {
			this._logService.warn(`[Claude] materializeChat: dropping corrupt providerData for ${chat.toString()}`);
			return;
		}
		this._chatBackings.set(chat.toString(), {
			sdkSessionId: persisted.sdkSessionId,
			...(persisted.model ? { model: persisted.model } : {}),
		});
	}

	async recoverLegacyChat(chat: URI, context: URI | IAgentChatContext): Promise<IAgentCreateChatResult> {
		const { configurationResource, resource } = resolveAgentChatContext(context, chat);
		const chatKey = chat.toString();
		const backing = this._chatBackings.get(chatKey) ?? { sdkSessionId: AgentSession.id(configurationResource) };
		this._chatBackings.set(chatKey, backing);
		this._recordChatScope(chat, configurationResource, resource);
		return { providerData: encodeProviderData(_toPersistedChat(backing)) };
	}

	private async _getChatMessages(chat: URI, context: URI | IAgentChatContext): Promise<readonly Turn[]> {
		return this._readChatMessages(this._resolveChatContext(chat, context));
	}


	getSessionForTesting(session: URI): ClaudeAgentSession | undefined {
		const sess = this._findChatByUri(URI.parse(buildDefaultChatUri(session))) ?? this._findAnySession(AgentSession.id(session));
		return sess?.isPipelineReady ? sess : undefined;
	}

	private async _readChatMessages(context: IResolvedClaudeChatContext): Promise<readonly Turn[]> {
		if (!(await this._sdkService.canLoadWithoutDownload())) {
			this._logService.info('[Claude] SDK not downloaded yet; deferring passive session messages');
			return [];
		}
		if (context.spawnedFrom) {
			return this._readSubagentMessages(context);
		}

		const sess = context.target;
		if (sess && !sess.isPipelineReady) {
			this._logService.info(`[Claude] getMessages: chat ${context.chatKey} is not materialized yet; returning no turns`);
			return [];
		}
		if (!context.sdkSessionId) {
			return [];
		}
		return this._reconstructTurns(context.sdkSessionId, context.chat, sess?.subagents);
	}

	private async _readSubagentMessages(context: IResolvedClaudeChatContext): Promise<readonly Turn[]> {
		const spawnedFrom = context.spawnedFrom;
		if (!spawnedFrom) {
			return [];
		}
		const parentChat = spawnedFrom.chat;
		const parentSessionId = this._chatBackings.get(parentChat.toString())?.sdkSessionId;
		if (!parentSessionId) {
			return [];
		}
		const parentSession = this._findAnySession(parentSessionId);
		const store = new DisposableStore();
		const subagents = parentSession?.subagents ?? store.add(new SubagentRegistry());
		try {
			if (!parentSession) {
				await this._reconstructTurns(parentSessionId, parentChat, subagents);
			}
			return await getSubagentTranscript(context.chat, parentChat, parentSessionId, spawnedFrom.toolCallId, subagents, this._sdkService, this._logService, CancellationToken.None);
		} catch (err) {
			this._logService.warn(`[Claude] getSubagentTranscript threw for ${context.chatKey}`, err);
			return [];
		} finally {
			store.dispose();
		}
	}

	private async _reconstructTurns(sdkSessionId: string, routingUri: URI, subagents: SubagentRegistry | undefined): Promise<readonly Turn[]> {
		let messages;
		try {
			messages = await this._sdkService.getSessionMessages(sdkSessionId, { includeSystemMessages: true });
		} catch (err) {
			this._logService.warn(`[Claude] getSessionMessages SDK fetch failed for ${sdkSessionId}`, err);
			return [];
		}
		let turns: readonly Turn[];
		try {
			turns = mapSessionMessagesToTurns(messages, routingUri, this._logService);
		} catch (err) {
			this._logService.warn(`[Claude] replay mapper threw for ${sdkSessionId}`, err);
			return [];
		}
		if (turns.length === 0 && messages.length > 0) {
			this._logService.warn(`[Claude] replay produced no turns from ${messages.length} transcript message(s) for ${sdkSessionId}; chat will render empty`);
		}
		try {
			subagents?.primeFromTranscript(turns);
		} catch (err) {
			this._logService.warn(`[Claude] primeFromTranscript threw for ${sdkSessionId}`, err);
		}
		return turns;
	}

	private async _listClaudeCodeChats(): Promise<IAgentChatMetadata[] | undefined> {
		let sdkEntries: readonly SDKSessionInfo[];
		try {
			sdkEntries = await this._sdkService.listSessions();
		} catch (err) {
			this._logService.warn('[Claude] SDK listSessions failed; deferring chat discovery', err);
			return undefined;
		}
		return Promise.all(sdkEntries.map(entry => {
			const session = AgentSession.uri(this.id, entry.sessionId);
			const chat = URI.parse(buildDefaultChatUri(session));
			return this._withPersistedWorkingDirectories(session, { chat, ...this._metadataStore.project(entry) });
		}));
	}

	startChatDiscovery(): Promise<void> {
		return this._startClaudeCodeChatDiscovery();
	}

	async listChatsToMigrate(): Promise<AgentChatMigrationResult> {
		if (!(await this._sdkService.canLoadWithoutDownload())) {
			this._logService.info('[Claude] SDK not downloaded yet; deferring the migratable chat list');
			return AgentChatMigrationDeferred;
		}
		const chats = await this._listClaudeCodeChats();
		if (!chats) {
			return undefined;
		}
		const limiter = new Limiter<IAgentChatMetadata | undefined>(4);
		const known = await Promise.all(chats.map(chat => limiter.queue(async () => {
			return await this._isKnownClaudeCodeChat(chat) ? chat : undefined;
		})));
		return known.filter((chat): chat is IAgentChatMetadata => chat !== undefined);
	}

	private _startClaudeCodeChatDiscovery(): Promise<void> {
		if (!this._claudeCodeChatDiscovery) {
			this._claudeCodeChatDiscovery = retry(async () => {
				if (!(await this._sdkService.canLoadWithoutDownload())) {
					this._logService.info('[Claude] SDK not downloaded yet; deferring chat discovery');
					return;
				}
				if (!(await this._emitClaudeCodeChats())) {
					throw new Error('Claude chat catalog is not available');
				}
			}, 5000, 3)
				.catch(err => this._logService.warn('[Claude] Chat discovery failed', err));
		}
		return this._claudeCodeChatDiscovery;
	}

	private _restartChatDiscovery(): void {
		if (this._claudeCodeChatDiscovery) {
			this._claudeCodeChatDiscovery = undefined;
			void this._startClaudeCodeChatDiscovery();
		}
	}

	private async _emitClaudeCodeChats(): Promise<boolean> {
		try {
			const chats = await this._listClaudeCodeChats();
			if (chats) {
				const limiter = new Limiter<IAgentDiscoveredChat | undefined>(4);
				const unknown = await Promise.all(chats.map(chat => limiter.queue(async () => {
					return await this._isKnownClaudeCodeChat(chat) ? undefined : { ...chat, external: true };
				})));
				this._onDidDiscoverChats.fire(unknown.filter((chat): chat is IAgentDiscoveredChat => chat !== undefined));
				return true;
			}
		} catch (err) {
			this._logService.warn('[Claude] Failed to emit discovered chats', err);
		}
		return false;
	}

	private async _isKnownClaudeCodeChat(chat: IAgentChatMetadata): Promise<boolean> {
		try {
			const session = URI.parse(parseRequiredSessionUriFromChatUri(chat.chat));
			return await this._metadataStore.hasKnownSession(session);
		} catch (err) {
			this._logService.warn(`[Claude] Failed to inspect stored metadata for ${chat.chat.toString()}`, err);
			return false;
		}
	}

	async getChatMetadata(chat: URI, context: URI | IAgentChatContext, providerData?: string, options?: IAgentChatMetadataOptions): Promise<IAgentChatMetadata | undefined> {
		if (options?.activation === 'restore') {
			await this._sdkService.ensureAvailable();
		} else if (!(await this._sdkService.canLoadWithoutDownload())) {
			this._logService.info('[Claude] SDK not downloaded yet; deferring passive chat metadata');
			return undefined;
		}
		const { configurationResource } = resolveAgentChatContext(context, chat);
		const sessionId = providerData ? decodeProviderData(providerData)?.sdkSessionId : AgentSession.id(configurationResource);
		if (!sessionId) {
			return undefined;
		}
		const sdkInfo = await this._sdkService.getSessionInfo(sessionId);
		if (!sdkInfo) {
			return undefined;
		}
		return this._withPersistedWorkingDirectories(configurationResource, { chat, ...this._metadataStore.project(sdkInfo) });
	}

	private async _withPersistedWorkingDirectories(session: URI, meta: IAgentChatMetadata): Promise<IAgentChatMetadata> {
		const primary = meta.workingDirectories?.[0];
		if (!primary) {
			return meta;
		}
		let overlay: IClaudeSessionOverlay = {};
		try {
			overlay = await this._metadataStore.read(session);
		} catch (err) {
			this._logService.warn(`[Claude] overlay read failed while hydrating working directories for ${session.toString()}; using SDK cwd only`, err);
		}
		const tail = overlay.workingDirectories?.slice(1) ?? [];
		if (tail.length === 0) {
			return meta;
		}
		return { ...meta, workingDirectories: [primary, ...tail] };
	}

	resolveChatConfig(_params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		const sessionSchema = createSchema({
			[ClaudeSessionConfigKey.PermissionMode]: schemaProperty<ClaudePermissionMode>({
				type: 'string',
				title: localize('claude.sessionConfig.permissionMode', "Approvals"),
				description: localize('claude.sessionConfig.permissionModeDescription', "How Claude handles tool approvals."),
				enum: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'],
				enumLabels: [
					localize('claude.sessionConfig.permissionMode.default', "Ask Before Edits"),
					localize('claude.sessionConfig.permissionMode.acceptEdits', "Edit Automatically"),
					localize('claude.sessionConfig.permissionMode.plan', "Plan Mode"),
					localize('claude.sessionConfig.permissionMode.auto', "Auto Mode"),
					localize('claude.sessionConfig.permissionMode.bypassPermissions', "Bypass Permissions"),
				],
				enumDescriptions: [
					localize('claude.sessionConfig.permissionMode.defaultDescription', "Claude asks before editing files."),
					localize('claude.sessionConfig.permissionMode.acceptEditsDescription', "Claude edits files without asking, and asks before using other tools."),
					localize('claude.sessionConfig.permissionMode.planDescription', "Claude creates a plan before making changes."),
					localize('claude.sessionConfig.permissionMode.autoDescription', "Claude decides whether to ask for each tool operation."),
					localize('claude.sessionConfig.permissionMode.bypassPermissionsDescription', "Claude runs all tools without asking."),
				],
				default: 'default',
				sessionMutable: true,
			}),
			[SessionConfigKey.Permissions]: platformSessionSchema.definition[SessionConfigKey.Permissions],
		});

		const values = sessionSchema.validateOrDefault(_params.config, {
			[ClaudeSessionConfigKey.PermissionMode]: 'default' satisfies ClaudePermissionMode,
		});

		return Promise.resolve({
			schema: sessionSchema.toProtocol(),
			values,
		});
	}

	getInheritedChatConfig(config: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
		const inherited: Record<string, unknown> = {};
		for (const key of [ClaudeSessionConfigKey.PermissionMode, SessionConfigKey.Permissions]) {
			if (config[key] !== undefined) {
				inherited[key] = config[key];
			}
		}
		return Object.keys(inherited).length > 0 ? inherited : undefined;
	}

	getAutonomousSessionConfig(_config: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
		return this._configurationService.getRootValue(platformRootSchema, AgentHostAutoApprovePolicyRestrictedConfigKey) !== true
			? { [ClaudeSessionConfigKey.PermissionMode]: 'auto' satisfies ClaudePermissionMode }
			: undefined;
	}

	chatConfigCompletions(_params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return Promise.resolve({ items: [] });
	}

	shutdown(): Promise<void> {
		return this._shutdownPromise ??= (async () => {
			const sessions = this._allLiveSessions();
			for (const chat of sessions) {
				if (!chat.isPipelineReady) {
					chat.abortController.abort();
				}
			}

			await Promise.all(sessions.map(chat =>
				this._disposeSequencer.queue(chat.sessionId, async () => {
					await this._disposeLiveSession(chat);
				})
			));
			this._chatBackings.clear();
			this._activeClientHandles.clear();
		})();
	}

	private async _sendMessage(chat: URI, prompt: string, workingDirectories: readonly URI[] | undefined, attachments?: readonly MessageAttachment[], turnId?: string, _senderClientId?: string, operationContext?: URI | IAgentChatContext): Promise<void> {
		const effectiveTurnId = turnId ?? generateUuid();
		const sendContext = this._requireChatContext(chat, operationContext, 'sendMessage');
		const clientTelemetryContext = URI.isUri(operationContext) ? undefined : operationContext?.clientTelemetryContext;
		const context = this._resolveChatContext(chat, sendContext);

		return this._sessionSequencer.queue(context.sequencerKey, async () => {
			const current = this._resolveChatContext(chat, sendContext);
			const session = await this._ensureResolvedChatSession(current, workingDirectories);
			if (current.customizations) {
				session.setHostCustomizations(current.customizations);
			}
			const switchTransport = session.hasPendingTransportSwitch ? await this._ensureAuthenticated(session.provisionalModel) : undefined;
			await session.send(this._buildSdkPrompt(session.sessionId, prompt, attachments, effectiveTurnId), effectiveTurnId, current.configurationResource, workingDirectories, switchTransport, resolveAgentHostInstructions(operationContext), clientTelemetryContext, !!operationContext && !URI.isUri(operationContext) && operationContext.agentMergeTurn === true);
			if (workingDirectories) {
				await this._metadataStore.write(current.resource, { workingDirectories });
			}
		});
	}

	private _buildSdkPrompt(sdkSessionId: string, prompt: string, attachments: readonly MessageAttachment[] | undefined, turnId: string): SDKUserMessage {
		const contentBlocks = resolvePromptToContentBlocks(prompt, attachments);
		return {
			type: 'user',
			message: { role: 'user', content: contentBlocks },
			session_id: sdkSessionId,
			parent_tool_use_id: null,
			uuid: turnId as `${string}-${string}-${string}-${string}-${string}`,
		};
	}

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		for (const sess of this._allLiveSessions()) {
			if (sess.respondToPermissionRequest(requestId, approved)) {
				return;
			}
		}
	}

	respondToUserInputRequest(requestId: string, response: ChatInputResponseKind, answers?: Record<string, ChatInputAnswer>): void {
		for (const sess of this._allLiveSessions()) {
			if (sess.respondToUserInputRequest(requestId, response, answers)) {
				return;
			}
		}
	}

	private _allLiveSessions(): ClaudeAgentSession[] {
		return [...this._chatEntriesBySdkId.values()].map(entry => entry.chatSession);
	}

	private async _abortSession(chat: URI, context: URI | IAgentChatContext): Promise<void> {
		resolveAgentChatContext(context, chat);
		const sess = this._findChatByUri(chat);
		if (!sess) {
			return;
		}
		if (!sess.isPipelineReady) {
			sess.abortController.abort();
			return;
		}
		sess.abort();
	}

	setPendingMessages(chat: URI, steeringMessage: PendingMessage | undefined, _queuedMessages: readonly PendingMessage[]): void {
		const target = this._findChatByUri(chat);
		this._logService.info(`[Claude] setPendingMessages for ${chat.toString()}: steering=${steeringMessage?.id ?? 'none'} queued=${_queuedMessages.length}`);
		if (!target) {
			this._logService.warn(`[Claude] setPendingMessages: target not found for ${chat.toString()}`);
			return;
		}
		if (steeringMessage) {
			target.injectSteering(steeringMessage);
		}
	}

	private async _changeModel(chat: URI, model: ModelSelection, operationContext: URI | IAgentChatContext): Promise<void> {
		const context = this._resolveChatContext(chat, operationContext);
		await this._sessionSequencer.queue(context.sequencerKey, async () => {
			const current = this._resolveChatContext(chat, operationContext);
			await this._metadataStore.write(current.resource, { model });
			const sess = current.target;
			if (sess) {
				await sess.setModel(model);
			}
			if (current.sdkSessionId !== current.sessionId) {
				await this._updateChatBackingModel(chat, model);
			}
		});
	}

	private async _changeAgent(chat: URI, agent: AgentSelection | undefined, operationContext: URI | IAgentChatContext): Promise<void> {
		const context = this._resolveChatContext(chat, operationContext);
		await this._sessionSequencer.queue(context.sequencerKey, async () => {
			const current = this._resolveChatContext(chat, operationContext);
			await this._metadataStore.write(current.resource, { agent: agent ?? null });
			const sess = current.target;
			if (sess) {
				await sess.setAgent(agent);
			}
		});
	}

	setServerToolHost(host: IAgentServerToolHost): void {
		this._serverToolHost = host;
	}

	getOrCreateActiveClient(chat: URI, context: URI | IAgentChatContext, client: { readonly clientId: string; readonly displayName?: string }, hostCustomizations?: readonly Customization[]): IActiveClient {
		const { configurationResource } = resolveAgentChatContext(context, chat);
		const key = `${chat.toString()}\u0000${client.clientId}`;
		let handle = this._activeClientHandles.get(key);
		if (!handle) {
			handle = new ClaudeActiveClientHandle(
				client.clientId,
				client.displayName,
				chat,
				(targetChat, tools) => {
					this._logService.info(`[Claude:${AgentSession.id(configurationResource)}] active client ${client.clientId} tools=[${tools.map(t => t.name).join(', ') || '(none)'}] chat=${targetChat.toString()}`);
					this._findChatByUri(targetChat)?.setClientTools(client.clientId, tools);
				},
				(targetChat, customizations, snapshot) => { void this._syncClientCustomizations(targetChat, configurationResource, client.clientId, [...customizations], snapshot); },
			);
			this._activeClientHandles.set(key, handle);
		}
		handle.setHostCustomizations(hostCustomizations);
		return handle;
	}

	removeActiveClient(chat: URI, _context: URI | IAgentChatContext, clientId: string): void {
		const key = `${chat.toString()}\u0000${clientId}`;
		if (!this._activeClientHandles.delete(key)) {
			return;
		}
		const target = this._findChatByUri(chat);
		if (!target) {
			return;
		}
		target.removeClientTools(clientId);
		void this._sessionSequencer.queue(target.sessionId, async () => target.removeClientCustomizations(clientId)).catch(() => { });
	}

	onClientToolCallComplete(chat: URI, toolCallId: string, result: ToolCallResult, context?: IAgentChatContext): void {
		const addressed = this._findChatByUri(chat);
		if (addressed) {
			addressed.completeClientToolCall(toolCallId, result);
			return;
		}
		const spawnedFrom = resolveSubagentChatParent(context);
		if (!spawnedFrom) {
			return;
		}
		this._findChatByUri(spawnedFrom.chat)?.completeClientToolCall(toolCallId, result);
	}

	async syncClientCustomizations(chat: URI, context: URI | IAgentChatContext, clientId: string, customizations: ClientPluginCustomization[], options?: { readonly quiet?: boolean }): Promise<ISyncedCustomization[]> {
		const { configurationResource } = resolveAgentChatContext(context, chat);
		const handle = this._activeClientHandles.get(`${chat.toString()}\u0000${clientId}`);
		return this._syncClientCustomizations(chat, configurationResource, clientId, customizations, handle?.hostCustomizations, options);
	}

	private async _syncClientCustomizations(chat: URI, configurationResource: URI, clientId: string, customizations: ClientPluginCustomization[], hostCustomizations: readonly Customization[] | undefined, options?: { readonly quiet?: boolean }): Promise<ISyncedCustomization[]> {
		const sync = () => this._pluginManager.syncCustomizations(
			clientId,
			customizations,
			options?.quiet ? undefined : status => this._fireCustomizationUpdated(configurationResource, { customization: status }),
		);
		const target = this._findChatByUri(chat);
		if (target) {
			return this._sessionSequencer.queue(target.sessionId, async () => {
				const synced = await sync();
				if (hostCustomizations) {
					target.setHostCustomizations(hostCustomizations);
				}
				target.adoptClientCustomizations(clientId, synced, customizations);
				return synced;
			});
		}
		return sync();
	}

	private _fireCustomizationUpdated(session: URI, item: ISyncedCustomization): void {
		this._onDidChatProgress.fire({
			kind: 'action',
			resource: session,
			action: {
				type: ActionType.SessionCustomizationUpdated,
				customization: item.customization,
			},
		});
	}

	getCustomizations(): readonly Customization[] {
		return [];
	}

	async getChatCustomizations(chat: URI, _context: URI | IAgentChatContext, hostCustomizations?: readonly Customization[]): Promise<readonly Customization[]> {
		const sess = this._findChatByUri(chat);
		if (!sess) {
			return [];
		}
		if (hostCustomizations) {
			sess.setHostCustomizations(hostCustomizations);
		}
		return sess.getSessionCustomizations();
	}

	async computeFolderPickerDecision(workingDirectories: readonly URI[], token: CancellationToken = CancellationToken.None): Promise<ISessionFolderPickerDecision | undefined> {
		if (!this._isMultiRootEnabled()) {
			return undefined;
		}
		return computeFolderPickerDecisionForRoots(workingDirectories, (directory, t) => claudeDirectoryQualifiesForPrimary(this._fileService, directory, this._environmentService.userHome, t), token);
	}

	async startMcpServer(session: URI, id: string): Promise<void> {
		const sess = this._findAnySession(AgentSession.id(session));
		await sess?.startMcpServer(id);
	}

	async stopMcpServer(session: URI, id: string): Promise<void> {
		const sess = this._findAnySession(AgentSession.id(session));
		await sess?.stopMcpServer(id);
	}


	override dispose(): void {
		this._isDisposing = true;
		for (const chat of this._allLiveSessions()) {
			chat.abortController.abort();
		}
		super.dispose();
		this._proxyHandle?.dispose();
		this._proxyHandle = undefined;
		this._models.set([], undefined);
	}
}

class ClaudeChatEntry extends Disposable {
	constructor(readonly chatSession: ClaudeAgentSession) {
		super();
		this._register(chatSession);
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}
