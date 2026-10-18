/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { McpServerConfig, OnElicitation, Options, PermissionMode, SDKUserMessage, SyncHookJSONOutput, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Sequencer } from '../../../../base/common/async.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { INativeEnvironmentService } from '../../../environment/common/environment.js';
import { IFileService } from '../../../files/common/files.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { IAgentConfigurationService } from '../agentConfigurationService.js';
import { ISyncedCustomization } from '../../common/agentPluginManager.js';
import { ClaudePermissionMode } from '../../common/claudeSessionConfigKeys.js';
import { ClaudeRuntimeEffortLevel, toRuntimeEffortLevel, resolveClaudeEffort } from '../../common/claudeModelConfig.js';
import { AgentSignal, IAgentSessionProjectInfo } from '../../common/agent.js';
import type { IAgentHostClientTelemetryContext } from '../../common/agentHostTelemetry.js';
import type { IAgentServerToolHost } from '../../common/agentServerTools.js';
import { PendingRequestRegistry } from '../../common/pendingRequestRegistry.js';
import { ISessionDatabase, ISessionDataService } from '../../common/sessionDataService.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { areAdditionalWorkingDirectoriesEqual, areSessionWorkingDirectoriesEqual } from '../../common/state/sessionWorkingDirectories.js';
import { PendingMessage, ChatInputAnswer, ChatInputRequest, ChatInputResponseKind, ToolCallContributorKind, ToolCallPendingConfirmationState, type AgentSelection, type ModelSelection, type ToolDefinition } from '../../common/state/protocol/state.js';
import type { ClientPluginCustomization, CustomizationEnablement } from '../../common/state/protocol/channels-session/state.js';
import { CustomizationType, parseRequiredSessionUriFromChatUri, type Customization, type ToolCallResult } from '../../common/state/sessionState.js';
import { IClaudeAgentSdkService } from './claudeAgentSdkService.js';
import { buildClientMcpServers, buildOptions, toClaudeMcpServers, type ClaudeDeniedMcpServerSpec } from './claudeSdkOptions.js';
import { claudeTransportForProvider, parseClaudeModelSelection, toClaudeSdkModelId } from './claudeModelSelection.js';
import { buildServerToolMcpServer, CLAUDE_SERVER_TOOL_MCP_SERVER_NAME, serverToolAllowList } from './claudeServerToolMcpServer.js';
import { convertToolCallResult } from './clientTools/claudeClientToolResult.js';
import { readClaudePermissionMode } from './claudeSessionPermissionMode.js';
import { SessionClientToolsDiff } from './clientTools/claudeSessionClientToolsModel.js';
import { SessionClientCustomizationsDiff } from './customizations/claudeSessionClientCustomizationsModel.js';
import { ClaudeCustomizationWatcher, buildDiscoveredCustomizations, createClaudeInternalMcpServerCustomization, resolveClaudeAgentName } from './customizations/claudeSessionCustomizationDiscovery.js';
import { applyMcpServerEnablement, findMcpChildId, findMcpServerName } from '../shared/mcpCustomizationController.js';
import { scanClaudeHooks } from './customizations/scan/claudeHookScan.js';
import { scanClaudeMcpServers } from './customizations/scan/claudeMcpScan.js';
import { IAgentHostCustomizationEnablementService } from '../agentHostCustomizationEnablementService.js';
import { IAgentHostOTelService } from '../../common/otel/agentHostOTelService.js';
import { isCustomizationEnabled } from '../../common/customizationEnablement.js';
import { scanClaudeRules } from './customizations/scan/claudeRuleScan.js';
import { discoverClaudeMultiRootCustomizations } from './customizations/claudeMultiRootCustomizationDiscovery.js';
import { resolvePromptToContentBlocks } from './claudePromptResolver.js';
import type { ClaudeTransport } from './claudeProxyService.js';
import { SessionMcpDiscovery } from '../shared/sessionMcpDiscovery.js';
import { parsePlugin, type IMcpServerDefinition } from '../../../agentPlugins/common/pluginParsers.js';
import { hasClientPluginMcpDefaultCwds, readClientPluginMcpDefaultCwd } from '../../common/meta/clientPluginCustomizationMeta.js';
import { ClaudeSdkPipeline, IRematerializer, type ISdkResolvedCustomizations } from './claudeSdkPipeline.js';
import { SubagentRegistry } from './claudeSubagentRegistry.js';
import { ClaudePermissionKind } from './claudeToolDisplay.js';
import { getSdkMcpServerEnablement, isCustomizationSdkEligible, resolveCustomizationEnablement } from '../shared/customizationEnablementGate.js';
import { AGENT_MERGE_GITHUB_TOOL_RESTRICTION, getAgentMergeGitHubToolRestriction } from '../shared/agentMergeToolRestrictions.js';

export type { IRematerializer } from './claudeSdkPipeline.js';

export interface IMaterializeContext {
	readonly transport: ClaudeTransport;
	readonly canUseTool: NonNullable<Options['canUseTool']>;
	readonly onElicitation: OnElicitation;
	readonly isResume: boolean;
	readonly resource: URI;
	readonly configResource: URI;
	readonly customizations?: readonly Customization[];
	readonly workingDirectory?: URI;
	readonly workingDirectories?: readonly URI[];
	readonly serverToolHost?: IAgentServerToolHost;
}

function resolveCurrentPermissionMode(
	configurationService: IAgentConfigurationService,
	resource: URI,
	inheritedPermissionMode: ClaudePermissionMode | undefined,
	permissionModeFallback: ClaudePermissionMode,
): ClaudePermissionMode {
	return readClaudePermissionMode(configurationService, resource) ?? inheritedPermissionMode ?? permissionModeFallback;
}

function toClaudeDeniedMcpServer(definition: IMcpServerDefinition): ClaudeDeniedMcpServerSpec {
	return { serverName: definition.name };
}

export class ClaudeAgentSession extends Disposable {
	private _hostInstructions: readonly string[] | undefined;

	private _pipeline: ClaudeSdkPipeline | undefined;
	private _chatChannelUri: URI;
	private readonly _mcpEnablementSequencer = new Sequencer();
	private _lastReconciledMcpEnablement: ReadonlyMap<string, boolean> | undefined;

	get chatChannelUri(): URI {
		return this._chatChannelUri;
	}

	private get _configurationResource(): URI {
		return URI.parse(parseRequiredSessionUriFromChatUri(this._chatChannelUri.toString()));
	}

	bindChatChannel(chatChannelUri: URI): void {
		if (this.isPipelineReady && this._chatChannelUri.toString() !== chatChannelUri.toString()) {
			throw new Error(`Cannot rebind materialized Claude session ${this.sessionId}`);
		}
		this._chatChannelUri = chatChannelUri;
	}

	private _hostCustomizations: readonly Customization[] = [];

	private _provisionalModel: ModelSelection | undefined;
	private _provisionalAgent: AgentSelection | undefined;
	readonly provisionalConfig: Record<string, unknown> | undefined;
	readonly project: IAgentSessionProjectInfo | undefined;
	readonly abortController: AbortController;

	get workingDirectory(): URI | undefined {
		return this._workingDirectory ?? this.workspace;
	}
	private _workingDirectory: URI | undefined;

	private _desiredAdditionalDirectories: readonly URI[];
	private _appliedAdditionalDirectories: readonly URI[];

	get workingDirectories(): readonly URI[] | undefined {
		const primary = this.workingDirectory;
		return primary ? [primary, ...this._desiredAdditionalDirectories] : undefined;
	}
	private readonly _customizationWatcher = this._register(new MutableDisposable<DisposableStore>());
	private _mcpDiscovery: SessionMcpDiscovery | undefined;
	private _mcpLaunchEnablementRevision = 0;
	private _appliedMcpLaunchEnablementRevision = 0;

	get pendingClientToolCalls(): PendingRequestRegistry<CallToolResult> { return this._pendingClientToolCalls; }
	get permissionModeFallback(): ClaudePermissionMode { return this._permissionModeFallback; }
	private _inheritedPermissionMode: ClaudePermissionMode | undefined;

	static createProvisional(
		sessionId: string,
		chatChannelUri: URI,
		workspace: URI | undefined,
		project: IAgentSessionProjectInfo | undefined,
		model: ModelSelection | undefined,
		agent: AgentSelection | undefined,
		config: Record<string, unknown> | undefined,
		pendingClientToolCalls: PendingRequestRegistry<CallToolResult>,
		permissionModeFallback: ClaudePermissionMode,
		instantiationService: IInstantiationService,
		additionalDirectories: readonly URI[] = [],
	): ClaudeAgentSession {
		return instantiationService.createInstance(
			ClaudeAgentSession,
			sessionId,
			chatChannelUri,
			workspace,
			project,
			model,
			agent,
			config,
			new AbortController(),
			pendingClientToolCalls,
			new SessionClientToolsDiff(),
			permissionModeFallback,
			additionalDirectories,
		);
	}

	readonly subagents: SubagentRegistry = this._register(new SubagentRegistry());

	private readonly _pendingPermissions = new PendingRequestRegistry<boolean>();
	private _agentMergeTurn = false;

	private readonly _pendingUserInputs = new PendingRequestRegistry<{ response: ChatInputResponseKind; answers?: Record<string, ChatInputAnswer> }>();

	readonly toolDiff: SessionClientToolsDiff;

	readonly clientCustomizationsDiff: SessionClientCustomizationsDiff = this._register(new SessionClientCustomizationsDiff());

	private readonly _onDidSessionProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidSessionProgress: Event<AgentSignal> = this._onDidSessionProgress.event;

	private _transportKind: ClaudeTransport['kind'] = 'proxy';

	private _pendingTransportSwitch = false;

	private _pendingSwitchTransport: ClaudeTransport | undefined;

	private _materializedTransport: ClaudeTransport | undefined;

	private _enrichSignalWithMcpContributor(signal: AgentSignal): AgentSignal {
		if (signal.kind !== 'action' || signal.action.type !== ActionType.ChatToolCallStart || signal.action.contributor !== undefined) {
			return signal;
		}
		const toolName = signal.action.toolName;
		if (!toolName.startsWith('mcp__')) {
			return signal;
		}
		const serverName = toolName.split('__')[1];
		const customizationId = serverName ? findMcpChildId(this._lastCustomizations, serverName) : undefined;
		if (customizationId === undefined) {
			return signal;
		}
		return { ...signal, action: { ...signal.action, contributor: { kind: ToolCallContributorKind.MCP, customizationId } } };
	}

	constructor(
		readonly sessionId: string,
		chatChannelUri: URI,
		readonly workspace: URI | undefined,
		project: IAgentSessionProjectInfo | undefined,
		model: ModelSelection | undefined,
		agent: AgentSelection | undefined,
		config: Record<string, unknown> | undefined,
		abortController: AbortController,
		private readonly _pendingClientToolCalls: PendingRequestRegistry<CallToolResult>,
		toolDiff: SessionClientToolsDiff,
		private readonly _permissionModeFallback: ClaudePermissionMode,
		additionalDirectories: readonly URI[],
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
		@IAgentHostOTelService private readonly _otelService: IAgentHostOTelService,
		@IClaudeAgentSdkService private readonly _sdkService: IClaudeAgentSdkService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@ILogService private readonly _logService: ILogService,
		@IFileService private readonly _fileService: IFileService,
		@INativeEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@IAgentHostCustomizationEnablementService private readonly _customizationEnablementService: IAgentHostCustomizationEnablementService,
	) {
		super();
		this._chatChannelUri = chatChannelUri;
		this.project = project;
		this._register(this._configurationService.onDidRootConfigChange(() => this.markMcpConfigurationDirty()));
		this._provisionalModel = model;
		this._provisionalAgent = agent;
		this.provisionalConfig = config;
		this.abortController = abortController;
		this._desiredAdditionalDirectories = additionalDirectories;
		this._appliedAdditionalDirectories = additionalDirectories;
		this._hostCustomizations = [];
		this.toolDiff = this._register(toolDiff);
		this._register(this.clientCustomizationsDiff.onDidChange(() => this._onDidCustomizationsChange.fire()));
		this._register(this._customizationEnablementService.onDidChange(event => {
			if (!event.sessions.includes(this._configurationResource.toString())) {
				return;
			}
			this._mcpLaunchEnablementRevision++;
			this._onDidCustomizationsChange.fire();
			if (this._pipeline) {
				this._reconcileMcpServerEnablement(true).catch(error => this._logService.error(error, `[Claude:${this.sessionId}] Failed to reconcile MCP enablement after customizations changed`));
			}
		}));

		this._watchCustomizations(this.workingDirectories);
	}

	setHostCustomizations(customizations: readonly Customization[]): void {
		this._hostCustomizations = customizations;
	}

	markMcpConfigurationDirty(): void {
		if (this._pipeline) {
			this.clientCustomizationsDiff.markDirty();
		}
	}

	private _watchCustomizations(directories: readonly URI[] | undefined): void {
		const store = new DisposableStore();
		const watcher = store.add(new ClaudeCustomizationWatcher(
			directories,
			this._environmentService.userHome,
			this._fileService,
			this._logService,
		));
		store.add(watcher.onDidChange(() => this._onDidCustomizationsChange.fire()));
		this._mcpDiscovery = directories?.length ? store.add(new SessionMcpDiscovery(directories, this._fileService)) : undefined;
		if (this._mcpDiscovery) {
			store.add(this._mcpDiscovery.onDidChange(() => {
				this.clientCustomizationsDiff.markDirty();
				this._onDidCustomizationsChange.fire();
			}));
		}
		this._customizationWatcher.value = store;
	}

	private _pendingResumeSessionAt: string | undefined;

	async truncateToTurn(turnId: string, resumeAnchorUuid: string, resource: URI): Promise<void> {
		await this._withDatabase(resource, db => db.deleteTurnsAfter(turnId));
		this._pendingResumeSessionAt = resumeAnchorUuid;
	}

	async pruneAllTurns(resource: URI): Promise<void> {
		await this._withDatabase(resource, db => db.deleteAllTurns());
	}

	private async _withDatabase(resource: URI, fn: (db: ISessionDatabase) => Promise<void>): Promise<void> {
		const ref = this._sessionDataService.openDatabase(resource);
		try {
			await fn(ref.object);
		} finally {
			ref.dispose();
		}
	}

	async materialize(ctx: IMaterializeContext): Promise<void> {
		if (this._pipeline) {
			throw new Error('ClaudeAgentSession is already materialized');
		}
		await this._customizationEnablementService.initializeSession(this._configurationResource.toString());
		if (ctx.customizations) {
			this._hostCustomizations = ctx.customizations;
		}
		const previousWorkingDirectories = this.workingDirectories;
		const resolvedPrimary = ctx.workingDirectories?.[0] ?? ctx.workingDirectory;
		if (resolvedPrimary && !isEqual(resolvedPrimary, this.workingDirectory)) {
			this._workingDirectory = resolvedPrimary;
		}
		if (ctx.workingDirectories && ctx.workingDirectories.length > 0) {
			this._desiredAdditionalDirectories = ctx.workingDirectories.slice(1);
			this._appliedAdditionalDirectories = this._desiredAdditionalDirectories;
		}
		const currentWorkingDirectories = this.workingDirectories;
		if (!areSessionWorkingDirectoriesEqual(previousWorkingDirectories, currentWorkingDirectories, true)) {
			this._watchCustomizations(currentWorkingDirectories);
		}
		if (!this.workingDirectory) {
			throw new Error(`Cannot materialize Claude session ${this.sessionId}: workingDirectory is required`);
		}
		this._transportKind = ctx.transport.kind;
		this._materializedTransport = ctx.transport;

		const permissionMode = resolveCurrentPermissionMode(this._configurationService, ctx.configResource, this._inheritedPermissionMode, this._permissionModeFallback);
		const plugins = this._desiredClientPluginConfigs();
		this.clientCustomizationsDiff.consume(plugins.map(plugin => plugin.uri));
		const mcpLaunchEnablementRevision = this._mcpLaunchEnablementRevision;
		const { mcpServers, deniedMcpServers, allowedTools } = await this._buildStartupToolWiring(ctx.resource, ctx.serverToolHost);
		const agentName = await resolveClaudeAgentName(this._provisionalAgent, this._fileService, this._logService, this.sessionId);
		const telemetry = await this._otelService.getNativeSdkTelemetryConfig();
		const traceContext = this._otelService.getSessionTraceContext(this.sessionId, ctx.resource.toString());

		const options = await buildOptions(
			{
				sessionId: this.sessionId,
				workingDirectory: this.workingDirectory,
				additionalDirectories: this._appliedAdditionalDirectories,
				model: this._provisionalModel,
				abortController: this.abortController,
				permissionMode,
				canUseTool: ctx.canUseTool,
				onElicitation: ctx.onElicitation,
				isResume: ctx.isResume,
				resumeSessionAt: this._pendingResumeSessionAt,
				mcpServers,
				deniedMcpServers,
				allowedTools,
				plugins,
				agent: agentName,
				telemetry,
				traceContext,
				getUserPromptAdditionalContext: () => this._hostInstructions?.join('\n\n'),
				onPreToolUse: (toolName, input) => this._restrictAgentMergeGitHubTool(toolName, input),
			},
			ctx.transport,
			data => this._logService.error(`[Claude SDK stderr] ${data}`),
		);

		this._logService.info(`[Claude] session ${this.sessionId}: enableFileCheckpointing=${options.enableFileCheckpointing} isResume=${ctx.isResume}`);

		const warm = await this._sdkService.startup({ options });

		if (this.abortController.signal.aborted) {
			await warm[Symbol.asyncDispose]();
			throw new CancellationError();
		}

		const dbRef = this._sessionDataService.openDatabase(ctx.resource);
		let pipeline: ClaudeSdkPipeline;
		try {
			pipeline = this._register(this._instantiationService.createInstance(
				ClaudeSdkPipeline,
				this.sessionId,
				this._chatChannelUri,
				ctx.resource,
				warm,
				this.abortController,
				dbRef,
				this.subagents,
				(toolName: string) => this.toolDiff.model.ownerOf(toolName),
			));
		} catch (err) {
			dbRef.dispose();
			await warm[Symbol.asyncDispose]();
			throw err;
		}
		this._register(pipeline.onDidProduceSignal(s => this._onDidSessionProgress.fire(this._enrichSignalWithMcpContributor(s))));
		this._pipeline = pipeline;
		this._register(this._configurationService.onDidSessionConfigChange(event => {
			if (!event.origin || event.session !== ctx.configResource.toString()) {
				return;
			}
			const inheritedMode = readClaudePermissionMode(this._configurationService, ctx.configResource);
			const mode = inheritedMode ?? this.permissionModeFallback;
			this.setInheritedPermissionMode(inheritedMode).catch(err => {
				this._logService.warn(`[Claude:${this.sessionId}] mid-turn setPermissionMode(${mode}) failed`, err);
			});
		}));
		this._pendingResumeSessionAt = undefined;
		this._appliedMcpLaunchEnablementRevision = mcpLaunchEnablementRevision;

		pipeline.seedCurrentConfig(
			toClaudeSdkModelId(this._provisionalModel),
			toRuntimeEffortLevel(resolveClaudeEffort(this._provisionalModel)),
			permissionMode,
		);

		if (this.abortController.signal.aborted) {
			throw new CancellationError();
		}

		pipeline.attachRematerializer(async (_reason) => {
			const liveMode = resolveCurrentPermissionMode(this._configurationService, ctx.configResource, this._inheritedPermissionMode, this._permissionModeFallback);
			const rebuildAbort = new AbortController();
			let rebuildWarm: WarmQuery | undefined;
			try {
				const rebuildTransport = this._pendingSwitchTransport ?? this._materializedTransport;
				if (!rebuildTransport) {
					throw new Error(`Cannot rebuild Claude session ${this.sessionId}: no transport resolved`);
				}
				this._watchCustomizations(this.workingDirectories);
				const rebuildPlugins = this._desiredClientPluginConfigs();
				this.clientCustomizationsDiff.consume(rebuildPlugins.map(plugin => plugin.uri));
				const rebuildMcpLaunchEnablementRevision = this._mcpLaunchEnablementRevision;
				const { mcpServers: rebuildMcp, deniedMcpServers: rebuildDeniedMcpServers, allowedTools: rebuildAllowedTools } = await this._buildStartupToolWiring(ctx.resource, ctx.serverToolHost);
				const rebuildAgentName = await resolveClaudeAgentName(this._provisionalAgent, this._fileService, this._logService, this.sessionId);
				const rebuildOptions = await buildOptions(
					{
						sessionId: this.sessionId,
						workingDirectory: this.workingDirectory!,
						additionalDirectories: this._desiredAdditionalDirectories,
						model: this._provisionalModel,
						abortController: rebuildAbort,
						permissionMode: liveMode,
						canUseTool: ctx.canUseTool,
						onElicitation: ctx.onElicitation,
						isResume: true,
						resumeSessionAt: this._pendingResumeSessionAt,
						mcpServers: rebuildMcp,
						deniedMcpServers: rebuildDeniedMcpServers,
						allowedTools: rebuildAllowedTools,
						plugins: rebuildPlugins,
						agent: rebuildAgentName,
						telemetry,
						traceContext,
						getUserPromptAdditionalContext: () => this._hostInstructions?.join('\n\n'),
						onPreToolUse: (toolName, input) => this._restrictAgentMergeGitHubTool(toolName, input),
					},
					rebuildTransport,
					data => this._logService.error(`[Claude SDK stderr] ${data}`),
				);
				this._logService.info(`[Claude] session ${this.sessionId}: resume rebuild agent=${rebuildOptions.agent ?? '(none)'}`);
				rebuildWarm = await this._sdkService.startup({ options: rebuildOptions });
				this._pendingResumeSessionAt = undefined;
				this._appliedMcpLaunchEnablementRevision = rebuildMcpLaunchEnablementRevision;
				this._appliedAdditionalDirectories = this._desiredAdditionalDirectories;
				this._transportKind = rebuildTransport.kind;
				this._materializedTransport = rebuildTransport;
				if (this._pendingSwitchTransport) {
					this._pendingTransportSwitch = false;
					this._pendingSwitchTransport = undefined;
				}
				return { warm: rebuildWarm, abortController: rebuildAbort };
			} catch (err) {
				rebuildAbort.abort();
				await rebuildWarm?.[Symbol.asyncDispose]();
				this.toolDiff.markDirty();
				this.clientCustomizationsDiff.markDirty();
				throw err;
			}
		});
		await this._reconcileMcpServerEnablement();

		ctx.serverToolHost?.advertise(ctx.resource.toString());

		this._onDidCustomizationsChange.fire();
	}

	private async _buildStartupToolWiring(
		resource: URI,
		serverToolHost: IAgentServerToolHost | undefined,
	): Promise<{ mcpServers: Record<string, McpServerConfig> | undefined; deniedMcpServers: readonly ClaudeDeniedMcpServerSpec[]; allowedTools: readonly string[] | undefined }> {
		const externalServers = await this._buildExternalMcpServers();
		const clientServers = await buildClientMcpServers(this.toolDiff, this._pendingClientToolCalls, this._sdkService);
		const serverToolDefinitions = serverToolHost?.getDefinitionsForSession(resource.toString());
		const serverToolServer = serverToolHost && serverToolDefinitions?.length
			? await buildServerToolMcpServer(serverToolHost, this._chatChannelUri.toString(), this._sdkService, serverToolDefinitions)
			: undefined;
		const mcpServers = (Object.keys(externalServers.servers).length === 0 && !clientServers && !serverToolServer)
			? undefined
			: {
				...externalServers.servers,
				...(clientServers ?? {}),
				...(serverToolServer ? { [CLAUDE_SERVER_TOOL_MCP_SERVER_NAME]: serverToolServer } : {}),
			};
		const autoApproveToolNames = serverToolHost && serverToolDefinitions
			? serverToolDefinitions.filter(definition => !serverToolHost.canRequireConfirmation(definition.name)).map(definition => definition.name)
			: undefined;
		return {
			mcpServers,
			deniedMcpServers: externalServers.deniedServers,
			allowedTools: autoApproveToolNames ? serverToolAllowList(autoApproveToolNames) : undefined,
		};
	}

	private async _buildExternalMcpServers(): Promise<{ readonly servers: Record<string, McpServerConfig>; readonly deniedServers: readonly ClaudeDeniedMcpServerSpec[] }> {
		const primaryCwd = this.workingDirectory;
		if (!primaryCwd) {
			return { servers: {}, deniedServers: [] };
		}
		const definitions = new Map<string, IMcpServerDefinition>();
		const discoveredDefinitions = await this._mcpDiscovery?.refresh() ?? [];
		const discoveredCandidates = discoveredDefinitions.map(definition => definition.customization);
		const discoveredResolution = resolveCustomizationEnablement(this._customizationEnablementService, this._configurationResource, discoveredCandidates);
		const discoveredEnablement = getSdkMcpServerEnablement(discoveredResolution);
		const deniedServers: ClaudeDeniedMcpServerSpec[] = [];
		for (const definition of discoveredDefinitions) {
			if (discoveredEnablement.get(definition.customization.id) !== true) {
				if (definition.defaultCwd && isEqual(definition.defaultCwd, primaryCwd)) {
					deniedServers.push(toClaudeDeniedMcpServer(definition));
				}
				continue;
			}
			if (definition.defaultCwd && isEqual(definition.defaultCwd, primaryCwd)) {
				continue;
			}
			definitions.set(definition.name, definition);
		}
		for (const synced of this._desiredClientPlugins()) {
			if (!synced.pluginDir || !hasClientPluginMcpDefaultCwds(synced.customization)) {
				continue;
			}
			try {
				const parsed = await parsePlugin(synced.pluginDir, this._fileService, primaryCwd, this._environmentService.userHome, synced.pluginDir);
				const candidate = { ...synced.customization, children: parsed.mcpServers.map(definition => definition.customization) };
				const resolved = resolveCustomizationEnablement(this._customizationEnablementService, this._configurationResource, [candidate], this._clientChildEnablement, this._clientPluginEnablement);
				if (!isCustomizationSdkEligible(resolved, candidate)) {
					continue;
				}
				const enabledById = getSdkMcpServerEnablement(resolved);
				const internalCandidates = parsed.mcpServers.map(definition => createClaudeInternalMcpServerCustomization(definition.name));
				const internalResolution = resolveCustomizationEnablement(this._customizationEnablementService, this._configurationResource, internalCandidates);
				const internalEnablement = getSdkMcpServerEnablement(internalResolution);
				for (let index = 0; index < parsed.mcpServers.length; index++) {
					const definition = parsed.mcpServers[index];
					if (enabledById.get(definition.customization.id) !== true || internalEnablement.get(internalCandidates[index].id) !== true) {
						deniedServers.push(toClaudeDeniedMcpServer(definition));
						continue;
					}
					definitions.set(definition.name, {
						...definition,
						defaultCwd: readClientPluginMcpDefaultCwd(synced.customization, definition.name, primaryCwd) ?? definition.defaultCwd,
					});
				}
			} catch (error) {
				this._logService.warn(`[Claude:${this.sessionId}] Failed to parse MCP servers from '${synced.customization.uri}': ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		const converted = toClaudeMcpServers([...definitions.values()], primaryCwd);
		for (const name of converted.skipped) {
			this._logService.warn(`[Claude:${this.sessionId}] Skipping MCP server '${name}' because its stdio working directory cannot be represented by the Claude SDK`);
		}
		return { servers: converted.servers, deniedServers };
	}

	get isPipelineReady(): boolean { return this._pipeline !== undefined; }

	get hasActiveTurn(): boolean { return this._pipeline?.hasActiveTurn ?? false; }

	get provisionalModel(): ModelSelection | undefined { return this._provisionalModel; }

	get hasPendingTransportSwitch(): boolean { return this._pendingTransportSwitch; }

	private _requirePipeline(): ClaudeSdkPipeline {
		if (!this._pipeline) {
			throw new Error('ClaudeAgentSession is not materialized');
		}
		return this._pipeline;
	}

	get isResumed(): boolean { return this._requirePipeline().isResumed; }

	async shutdownLiveQuery(): Promise<void> {
		await this._pipeline?.shutdownAndWait();
	}

	seedBijectiveState(state: { model?: string; effort?: ClaudeRuntimeEffortLevel; permissionMode?: PermissionMode }): void {
		this._requirePipeline().seedCurrentConfig(state.model, state.effort, state.permissionMode);
	}

	attachRematerializer(rematerializer: IRematerializer): void {
		this._requirePipeline().attachRematerializer(rematerializer);
	}

	async send(prompt: SDKUserMessage, turnId: string, resource: URI, workingDirectories?: readonly URI[], switchTransport?: ClaudeTransport, hostInstructions?: readonly string[], clientContext?: IAgentHostClientTelemetryContext, agentMergeTurn = false): Promise<void> {
		const pipeline = this._requirePipeline();
		if (workingDirectories) {
			this._replaceDesiredWorkingDirectories(workingDirectories);
		}
		if (switchTransport) {
			this._pendingSwitchTransport = switchTransport;
		}
		if (this.toolDiff.hasDifference
			|| this.clientCustomizationsDiff.hasDifferenceFrom(this._desiredClientPluginPaths())
			|| this._appliedMcpLaunchEnablementRevision !== this._mcpLaunchEnablementRevision
			|| this._pendingResumeSessionAt !== undefined
			|| !areAdditionalWorkingDirectoriesEqual(this._appliedAdditionalDirectories, this._desiredAdditionalDirectories)
			|| this._pendingTransportSwitch) {
			await this._rebindForSyncedState();
		} else {
			await pipeline.setPermissionMode(resolveCurrentPermissionMode(this._configurationService, resource, this._inheritedPermissionMode, this._permissionModeFallback));
		}
		await this._reconcileMcpServerEnablement();
		this._hostInstructions = hostInstructions;
		this._agentMergeTurn = agentMergeTurn;
		try {
			await pipeline.send(prompt, turnId, clientContext);
		} finally {
			this._hostInstructions = undefined;
			this._agentMergeTurn = false;
		}
	}

	private _restrictAgentMergeGitHubTool(toolName: string, input: unknown): SyncHookJSONOutput | undefined {
		const externalMcpTool = toolName.startsWith('mcp__') && !toolName.startsWith(`mcp__${CLAUDE_SERVER_TOOL_MCP_SERVER_NAME}__`);
		const restriction = this._agentMergeTurn
			? getAgentMergeGitHubToolRestriction(toolName, input)
			?? (externalMcpTool ? AGENT_MERGE_GITHUB_TOOL_RESTRICTION : undefined)
			: undefined;
		if (!restriction) {
			return undefined;
		}
		this._logService.warn(`[Claude:${this.sessionId}] Denying restricted Agent Merge tool: ${toolName}`);
		return {
			continue: false,
			stopReason: restriction,
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: restriction,
			},
		};
	}

	private _replaceDesiredWorkingDirectories(workingDirectories: readonly URI[]): void {
		const primary = this.workingDirectory;
		if (!primary || !isEqual(primary, workingDirectories[0])) {
			throw new Error(`Cannot change Claude session primary working directory: ${this.sessionId}`);
		}
		const desiredAdditionalDirectories = workingDirectories.slice(1);
		if (areAdditionalWorkingDirectoriesEqual(this._desiredAdditionalDirectories, desiredAdditionalDirectories)) {
			return;
		}
		this._desiredAdditionalDirectories = desiredAdditionalDirectories;
	}

	private async _rebindForSyncedState(): Promise<void> {
		this._pendingClientToolCalls.rejectAll(new CancellationError());
		await this._requirePipeline().rebindForRestart();
		this._onDidCustomizationsChange.fire();
	}

	abort(): void {
		this._pendingPermissions.denyAll(false);
		this._pendingUserInputs.denyAll({ response: ChatInputResponseKind.Cancel });
		this._requirePipeline().abort();
	}

	async setModel(model: ModelSelection): Promise<void> {
		this._provisionalModel = model;
		const parsed = parseClaudeModelSelection(model);
		const crossesTransport =
			this.isPipelineReady &&
			parsed.explicitProvider &&
			claudeTransportForProvider(parsed.provider) !== this._transportKind;
		if (crossesTransport) {
			this._pendingTransportSwitch = true;
			this._pipeline?.bufferConfigForRebind(toClaudeSdkModelId(model), toRuntimeEffortLevel(resolveClaudeEffort(model)));
		} else if (this._pipeline) {
			this._pendingTransportSwitch = false;
			this._pendingSwitchTransport = undefined;
			await this._pipeline.setModel(toClaudeSdkModelId(model));
			await this._pipeline.setEffort(toRuntimeEffortLevel(resolveClaudeEffort(model)));
		}
	}

	get provisionalAgent(): AgentSelection | undefined { return this._provisionalAgent; }

	async setAgent(agent: AgentSelection | undefined): Promise<void> {
		if (this._provisionalAgent === agent) {
			return;
		}
		this._provisionalAgent = agent;
		if (this._pipeline) {
			this.clientCustomizationsDiff.markDirty();
		}
	}

	injectSteering(steeringMessage: PendingMessage): void {
		const pipeline = this._requirePipeline();
		if (pipeline.isAborted) {
			return;
		}
		const contentBlocks = resolvePromptToContentBlocks(
			steeringMessage.message.text,
			steeringMessage.message.attachments,
		);
		const sdkMessage: SDKUserMessage = {
			type: 'user',
			message: { role: 'user', content: contentBlocks },
			session_id: this.sessionId,
			parent_tool_use_id: null,
			priority: 'now',
			uuid: steeringMessage.id as `${string}-${string}-${string}-${string}-${string}`,
		};
		pipeline.injectSteering(sdkMessage, steeringMessage.id);
	}

	setPermissionMode(mode: PermissionMode): Promise<void> {
		return this._requirePipeline().setPermissionMode(mode);
	}

	setInheritedPermissionMode(mode: ClaudePermissionMode | undefined): Promise<void> {
		this._inheritedPermissionMode = mode;
		if (!this._pipeline) {
			return Promise.resolve();
		}
		return this._pipeline.setPermissionMode(mode ?? this._permissionModeFallback);
	}


	requestPermission(args: {
		readonly toolUseID: string;
		readonly state: ToolCallPendingConfirmationState;
		readonly permissionKind: ClaudePermissionKind;
		readonly permissionPath?: string;
		readonly parentToolCallId?: string;
	}): Promise<boolean> {
		if (!this._pipeline || this._pipeline.isAborted) {
			return Promise.resolve(false);
		}
		return this._pendingPermissions.registerAndFire(args.toolUseID, () => {
			this._onDidSessionProgress.fire({
				kind: 'pending_confirmation',
				chat: this._chatChannelUri,
				state: args.state,
				permissionKind: args.permissionKind,
				...(args.permissionPath !== undefined ? { permissionPath: args.permissionPath } : {}),
				...(args.parentToolCallId !== undefined ? { parentToolCallId: args.parentToolCallId } : {}),
			});
		});
	}

	respondToPermissionRequest(requestId: string, approved: boolean): boolean {
		return this._pendingPermissions.respond(requestId, approved);
	}

	requestUserInput(request: ChatInputRequest, parentToolCallId?: string): Promise<{ response: ChatInputResponseKind; answers?: Record<string, ChatInputAnswer> }> {
		if (!this._pipeline || this._pipeline.isAborted || !this._pipeline.hasActiveTurn) {
			return Promise.resolve({ response: ChatInputResponseKind.Cancel });
		}
		return this._pendingUserInputs.registerAndFire(request.id, () => {
			this._onDidSessionProgress.fire({
				kind: 'action',
				resource: this._chatChannelUri,
				action: {
					type: ActionType.ChatInputRequested,
					request,
				},
				...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
			});
		});
	}

	respondToUserInputRequest(
		requestId: string,
		response: ChatInputResponseKind,
		answers?: Record<string, ChatInputAnswer>,
	): boolean {
		return this._pendingUserInputs.respond(requestId, { response, answers });
	}



	setClientTools(clientId: string, tools: readonly ToolDefinition[]): void {
		this.toolDiff.model.setTools(clientId, tools);
	}

	getClientTools(clientId: string): readonly ToolDefinition[] {
		return this.toolDiff.model.getTools(clientId);
	}

	removeClientTools(clientId: string): void {
		this.toolDiff.model.removeClient(clientId);
	}

	removeClientCustomizations(clientId: string): void {
		this.clientCustomizationsDiff.model.removeClient(clientId);
		if (this._clientCustomizationEnablement.delete(clientId)) {
			this._rebuildClientCustomizationEnablement();
		}
	}

	completeClientToolCall(toolCallId: string, result: ToolCallResult): boolean {
		const converted = convertToolCallResult(result, toolCallId);
		return this._pendingClientToolCalls.respond(toolCallId, converted);
	}

	async rebindForClientTools(): Promise<void> {
		await this._rebindForSyncedState();
	}



	private readonly _onDidCustomizationsChange = this._register(new Emitter<void>());
	readonly onDidCustomizationsChange: Event<void> = this._onDidCustomizationsChange.event;

	adoptClientCustomizations(clientId: string, synced: readonly ISyncedCustomization[], customizations: readonly ClientPluginCustomization[]): void {
		this.clientCustomizationsDiff.model.setSyncedCustomizations(clientId, synced);
		const pluginEnablement = new Map<string, ClientPluginCustomization>();
		const childEnablement = new Map<string, Readonly<Record<string, readonly CustomizationEnablement[]>>>();
		for (const customization of customizations) {
			pluginEnablement.set(customization.uri.toString(), customization);
			if (customization.childEnablement !== undefined) {
				childEnablement.set(customization.uri.toString(), customization.childEnablement);
			}
		}
		this._clientCustomizationEnablement.delete(clientId);
		this._clientCustomizationEnablement.set(clientId, { pluginEnablement, childEnablement });
		this._rebuildClientCustomizationEnablement();
	}

	getClientCustomizations(): readonly ISyncedCustomization[] {
		return this.clientCustomizationsDiff.model.state.get().synced;
	}

	private _lastCustomizations: readonly Customization[] = [];
	private readonly _clientChildEnablement = new Map<string, Readonly<Record<string, readonly CustomizationEnablement[]>>>();
	private readonly _clientPluginEnablement = new Map<string, ClientPluginCustomization>();
	private readonly _clientCustomizationEnablement = new Map<string, {
		readonly pluginEnablement: ReadonlyMap<string, ClientPluginCustomization>;
		readonly childEnablement: ReadonlyMap<string, Readonly<Record<string, readonly CustomizationEnablement[]>>>;
	}>();

	private _rebuildClientCustomizationEnablement(): void {
		this._clientChildEnablement.clear();
		this._clientPluginEnablement.clear();
		for (const enablement of this._clientCustomizationEnablement.values()) {
			for (const [uri, plugin] of enablement.pluginEnablement) {
				this._clientPluginEnablement.set(uri, plugin);
			}
			for (const [uri, children] of enablement.childEnablement) {
				this._clientChildEnablement.set(uri, children);
			}
		}
	}

	async getSessionCustomizations(): Promise<readonly Customization[]> {
		const { synced } = this.clientCustomizationsDiff.model.state.get();
		const userHome = this._environmentService.userHome;
		const [multiRoot, rules, mcpServers, hooks] = await Promise.all([
			discoverClaudeMultiRootCustomizations(this.workingDirectories, userHome, this._fileService, this._logService),
			scanClaudeRules(this.workingDirectory, userHome, this._fileService),
			scanClaudeMcpServers(this.workingDirectory, userHome, this._fileService),
			scanClaudeHooks(this.workingDirectory, userHome, this._fileService),
		]);

		let sdk: ISdkResolvedCustomizations | undefined;
		if (this._pipeline) {
			try {
				sdk = await this._pipeline.snapshotResolvedCustomizations();
			} catch (err) {
				this._logService.warn(`[Claude:${this.sessionId}] snapshotResolvedCustomizations failed`, err);
			}
		}

		const discoveredCustomizations = buildDiscoveredCustomizations([...multiRoot.discovered, ...rules], mcpServers, hooks, multiRoot.nativePlugins, multiRoot.workingDirectories, userHome, sdk);

		const state = this._hostCustomizations;
		const result: Customization[] = synced.map(item => {
			const desired = state.find(customization => customization.id === item.customization.id);
			if (desired?.type !== CustomizationType.Plugin) {
				return item.customization;
			}
			if (desired.enablement?.length) {
				return { ...item.customization, enablement: [...desired.enablement] };
			}
			const { enablement: _enablement, ...withoutEnablement } = item.customization;
			return withoutEnablement;
		});
		result.push(...discoveredCustomizations);
		const projected = applyMcpServerEnablement(result, state);
		const enabled = resolveCustomizationEnablement(this._customizationEnablementService, this._configurationResource, projected, this._clientChildEnablement, this._clientPluginEnablement);
		this._lastCustomizations = enabled.customizations;
		return enabled.customizations;
	}

	private _reconcileMcpServerEnablement(fromCustomizationChange = false): Promise<void> {
		const desired = this._getDesiredMcpServerEnablement();
		if (desired.size === 0) {
			this._lastReconciledMcpEnablement = desired;
			return Promise.resolve();
		}
		if (fromCustomizationChange && this._isMcpEnablementUnchanged(desired)) {
			return Promise.resolve();
		}
		return this._mcpEnablementSequencer.queue(() => this._doReconcileMcpServerEnablement());
	}

	private async _doReconcileMcpServerEnablement(): Promise<void> {
		const pipeline = this._requirePipeline();
		const desired = this._getDesiredMcpServerEnablement();
		if (desired.size === 0) {
			this._lastReconciledMcpEnablement = desired;
			return;
		}

		if (!await pipeline.reconcileMcpServerEnablement(desired)) {
			throw new Error(`Claude SDK cannot reconcile MCP server enablement`);
		}
		this._lastReconciledMcpEnablement = desired;
	}

	private _getDesiredMcpServerEnablement(): Map<string, boolean> {
		const resolved = resolveCustomizationEnablement(
			this._customizationEnablementService,
			this._configurationResource,
			this._hostCustomizations,
			this._clientChildEnablement,
			this._clientPluginEnablement,
		);
		const enabledById = getSdkMcpServerEnablement(resolved);
		return new Map(resolved.customizations.flatMap(customization => {
			if (customization.type === CustomizationType.McpServer) {
				return [[customization.name, enabledById.get(customization.id) ?? false] as const];
			}
			return (customization.children ?? []).flatMap(child =>
				child.type === CustomizationType.McpServer
					? [[child.name, enabledById.get(child.id) ?? false] as const]
					: []);
		}));
	}

	private _isMcpEnablementUnchanged(desired: ReadonlyMap<string, boolean>): boolean {
		if (!this._lastReconciledMcpEnablement || desired.size !== this._lastReconciledMcpEnablement.size) {
			return false;
		}
		return [...desired].every(([name, enabled]) => this._lastReconciledMcpEnablement!.get(name) === enabled);
	}

	private _desiredClientPluginPaths(): readonly URI[] {
		return this._desiredClientPlugins().flatMap(synced => synced.pluginDir ? [synced.pluginDir] : []);
	}

	private _desiredClientPluginConfigs(): readonly { readonly uri: URI; readonly skipMcpDiscovery: boolean }[] {
		return this._desiredClientPlugins().flatMap(synced => synced.pluginDir ? [{
			uri: synced.pluginDir,
			skipMcpDiscovery: hasClientPluginMcpDefaultCwds(synced.customization),
		}] : []);
	}

	private _desiredClientPlugins(): readonly ISyncedCustomization[] {
		const resolved = resolveCustomizationEnablement(this._customizationEnablementService, this._configurationResource, this.clientCustomizationsDiff.model.state.get().synced.map(item => item.customization), this._clientChildEnablement, this._clientPluginEnablement);
		const desiredById = new Map(resolved.customizations
			.filter(customization => isCustomizationSdkEligible(resolved, customization))
			.map(customization => [customization.id, customization.type === CustomizationType.Directory ? customization.enabled : isCustomizationEnabled(customization)]));
		return this.clientCustomizationsDiff.model.state.get().synced.filter(synced =>
			(desiredById.get(synced.customization.id) ?? isCustomizationEnabled(synced.customization)) !== false
		);
	}

	async startMcpServer(id: string): Promise<void> {
		const serverName = await this._resolveMcpServerName(id);
		if (!serverName) {
			this._logService.warn(`[Claude:${this.sessionId}] Cannot start unknown MCP server customization ${id}`);
			return;
		}
		const handled = await this._requirePipeline().startMcpServer(serverName);
		if (!handled) {
			await this._rebindForSyncedState();
		}
		this._onDidCustomizationsChange.fire();
	}

	async stopMcpServer(id: string): Promise<void> {
		const serverName = await this._resolveMcpServerName(id);
		if (!serverName) {
			this._logService.warn(`[Claude:${this.sessionId}] Cannot stop unknown MCP server customization ${id}`);
			return;
		}
		const handled = await this._requirePipeline().stopMcpServer(serverName);
		if (!handled) {
			this._logService.warn(`[Claude:${this.sessionId}] MCP server stop is not supported by the current SDK`);
			return;
		}
		this._onDidCustomizationsChange.fire();
	}

	private async _resolveMcpServerName(id: string): Promise<string | undefined> {
		return findMcpServerName(this._lastCustomizations, id) ?? findMcpServerName(await this.getSessionCustomizations(), id);
	}


	override dispose(): void {
		this._pendingPermissions.denyAll(false);
		this._pendingUserInputs.denyAll({ response: ChatInputResponseKind.Cancel });
		this._pendingClientToolCalls.rejectAll(new CancellationError());
		super.dispose();
	}
}
