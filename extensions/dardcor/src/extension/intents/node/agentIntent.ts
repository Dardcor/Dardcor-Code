/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import { BudgetExceededError } from '@vscode/prompt-tsx/dist/base/materialized';
import type * as vscode from 'vscode';
import { IChatSessionService } from '../../../platform/chat/common/chatSessionService';
import { ChatFetchResponseType, ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { getTextPart } from '../../../platform/chat/common/globalStringUtils';
import { ISessionTranscriptService } from '../../../platform/chat/common/sessionTranscriptService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { isAnthropicFamily, isXAiFamily, modelCanUseApplyPatchExclusively, modelCanUseReplaceStringExclusively, modelSupportsApplyPatch, modelSupportsMultiReplaceString, modelSupportsReplaceString, modelSupportsSimplifiedApplyPatchInstructions } from '../../../platform/endpoint/common/chatModelCapabilities';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IAutomodeService } from '../../../platform/endpoint/node/automodeService';
import { IEnvService } from '../../../platform/env/common/envService';
import { ILogService } from '../../../platform/log/common/logService';
import { IEditLogService } from '../../../platform/multiFileEdit/common/editLogService';
import { CUSTOM_TOOL_SEARCH_NAME, isAnthropicContextEditingEnabled } from '../../../platform/networking/common/anthropic';
import { IChatEndpoint, isCAPIEndpoint } from '../../../platform/networking/common/networking';
import { modelsWithoutResponsesContextManagement, nanoAiuToCredits } from '../../../platform/networking/common/openai';
import { INotebookService } from '../../../platform/notebook/common/notebookService';
import { GenAiMetrics } from '../../../platform/otel/common/genAiMetrics';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { PromptConfig } from '../../../platform/promptFiles/common/promptsService';
import { CustomInstructionsReferenceLogger, IAutomaticInstructionsCollector } from '../../../platform/promptFiles/node/automaticInstructionsCollector';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { ITasksService } from '../../../platform/tasks/common/tasksService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ITestProvider } from '../../../platform/testing/common/testProvider';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';

import { findLast } from '../../../util/dardcor/base/common/arraysFind';
import { raceTimeout } from '../../../util/dardcor/base/common/async';
import { isCancellationError } from '../../../util/dardcor/base/common/errors';
import { Iterable } from '../../../util/dardcor/base/common/iterator';
import { DisposableMap, DisposableStore } from '../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';

import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { ChatResponseAutoModeResolutionPart, ChatResponseProgressPart2 } from '../../../dardcorTypes';
import { ICommandService } from '../../commands/node/commandService';
import { Intent } from '../../common/constants';
import { ChatVariablesCollection } from '../../prompt/common/chatVariablesCollection';
import { Conversation, normalizeSummariesOnRounds, RenderedUserMessageMetadata, TurnStatus, TurnTokenUsageMetadata } from '../../prompt/common/conversation';
import { IBuildPromptContext, InternalToolReference } from '../../prompt/common/intents';
import { getRequestedToolCallIterationLimit, IContinueOnErrorConfirmation } from '../../prompt/common/specialRequestTypes';
import { ChatTelemetryBuilder } from '../../prompt/node/chatParticipantTelemetry';
import { IDefaultIntentRequestHandlerOptions } from '../../prompt/node/defaultIntentRequestHandler';
import { IDocumentContext } from '../../prompt/node/documentContext';
import { IBuildPromptResult, IIntent, IIntentInvocation } from '../../prompt/node/intents';
import { AgentPrompt, AgentPromptProps } from '../../prompts/node/agent/agentPrompt';
import { BackgroundSummarizationState, BackgroundSummarizationThresholds, BackgroundSummarizer, IBackgroundSummarizationResult, resolveSummaryAnchorRoundId, shouldKickOffBackgroundSummarization } from '../../prompts/node/agent/backgroundSummarizer';
import { BackgroundTodoAgentProcessor, getSessionResource } from '../../prompts/node/agent/backgroundTodoAgent/backgroundTodoAgentProcessor';
import { AgentPromptCustomizations, PromptRegistry } from '../../prompts/node/agent/promptRegistry';
import { appendTranscriptHintToSummary, computeSummarizationRoundCounts, extractSummary, SummarizationUserMessage, SummarizedConversationHistory, SummarizedConversationHistoryMetadata, SummarizedConversationHistoryPropsBuilder } from '../../prompts/node/agent/summarizedConversationHistory';
import { PromptRenderer, renderPromptElement } from '../../prompts/node/base/promptRenderer';
import { ICodeMapperService } from '../../prompts/node/codeMapper/codeMapperService';
import { EditCodePrompt2 } from '../../prompts/node/panel/editCodePrompt2';
import { NotebookInlinePrompt } from '../../prompts/node/panel/notebookInlinePrompt';
import { ToolResultMetadata } from '../../prompts/node/panel/toolCalling';
import { IEditToolLearningService } from '../../tools/common/editToolLearningService';
import { ContributedToolName, ToolName } from '../../tools/common/toolNames';
import { normalizeToolSchema } from '../../tools/common/toolSchemaNormalizer';
import { IToolsService } from '../../tools/common/toolsService';
import { applyPatch5Description } from '../../tools/node/applyPatchTool';
import { multiReplaceStringPrimaryDescription } from '../../tools/node/multiReplaceStringTool';
import { replaceStringBatchDescription } from '../../tools/node/replaceStringTool';
import { getAgentMaxRequests } from '../common/agentConfig';
import { addCacheBreakpoints } from './cacheBreakpoints';
import { EditCodeIntent, EditCodeIntentInvocation, EditCodeIntentInvocationOptions, mergeMetadata, toNewChatReferences } from './editCodeIntent';
import { ToolCallingLoop } from './toolCallingLoop';

function isResponsesCompactionContextManagementEnabled(endpoint: IChatEndpoint, configurationService: IConfigurationService, experimentationService: IExperimentationService): boolean {
	return endpoint.apiType === 'responses'
		&& configurationService.getExperimentBasedConfig(ConfigKey.ResponsesApiContextManagementEnabled, experimentationService)
		&& !modelsWithoutResponsesContextManagement.has(endpoint.family);
}

export function applyContextSizeOverride(endpoint: IChatEndpoint, request: vscode.ChatRequest, preferLongContext: boolean = false): IChatEndpoint {
	const contextSize = request.modelConfiguration?.contextSize;
	const hasLongContextSurcharge = !!endpoint.tokenPricing?.longContext;
	const useDefaultTierFallback = !preferLongContext || hasLongContextSurcharge;
	const effectiveSize = (typeof contextSize === 'number' && Number.isFinite(contextSize) && contextSize > 0)
		? contextSize
		: useDefaultTierFallback ? endpoint.tokenPricing?.default.contextMax : undefined;
	if (typeof effectiveSize === 'number' && effectiveSize > 0 && effectiveSize < endpoint.modelMaxPromptTokens) {
		return endpoint.cloneWithTokenOverride(effectiveSize);
	}
	return endpoint;
}

export function isTodoToolExplicitlyEnabled(request: vscode.ChatRequest): boolean {
	const todoReferenceName = 'todo';
	return request.toolReferences.some(ref =>
		ref.name === todoReferenceName
		|| ref.name === ToolName.CoreManageTodoList
	);
}

export function isBackgroundTodoAgentEnabled(
	endpoint: IChatEndpoint,
	configurationService: IConfigurationService,
	experimentationService: IExperimentationService,
	authenticationService: IAuthenticationService,
	request: vscode.ChatRequest): boolean {
	const token = authenticationService.dardcorToken;

	if (endpoint.modelProvider?.toLowerCase() === 'experimental') {
		return false;
	}

	const isEnabledForCapiUser = token !== undefined && !token.isFreeUser && !token.isNoAuthUser && isCAPIEndpoint(endpoint);
	const isEnabledForRouterModel = endpoint.modelProvider?.toLowerCase() === 'dardcor' && endpoint.supportsToolCalls;
	return (isEnabledForCapiUser || isEnabledForRouterModel)
		&& configurationService.getExperimentBasedConfig(ConfigKey.Advanced.BackgroundTodoAgentEnabled, experimentationService)
		&& !isTodoToolExplicitlyEnabled(request);
}

export function resolveSummarizeThresholdTokens(value: number | undefined, effectiveMaxTokens: number, settingId: string): number | undefined {
	if (typeof value !== 'number' || value <= 0) {
		return undefined;
	}
	if (value <= 1) {
		return Math.max(1, Math.floor(effectiveMaxTokens * value));
	}
	if (value < 100) {
		throw new Error(`Setting github.dardcor.${settingId} is too low; use a ratio in the range (0, 1] (e.g. 0.8 for 80%) or an absolute token count of at least 100.`);
	}
	return value;
}

export const getAgentTools = async (accessor: ServicesAccessor, request: vscode.ChatRequest, model?: IChatEndpoint) => {
	const toolsService = accessor.get<IToolsService>(IToolsService);
	const testService = accessor.get<ITestProvider>(ITestProvider);
	const tasksService = accessor.get<ITasksService>(ITasksService);
	const configurationService = accessor.get<IConfigurationService>(IConfigurationService);
	const experimentationService = accessor.get<IExperimentationService>(IExperimentationService);
	const endpointProvider = accessor.get<IEndpointProvider>(IEndpointProvider);
	const editToolLearningService = accessor.get<IEditToolLearningService>(IEditToolLearningService);
	const authenticationService = accessor.get<IAuthenticationService>(IAuthenticationService);
	const logService = accessor.get<ILogService>(ILogService);

	model ??= await endpointProvider.getChatEndpoint(request);

	const allowTools: Record<string, boolean> = {};

	const learned = editToolLearningService.getPreferredEndpointEditTool(model);
	if (learned) {
		allowTools[ToolName.EditFile] = learned.includes(ToolName.EditFile);
		allowTools[ToolName.ReplaceString] = learned.includes(ToolName.ReplaceString);
		allowTools[ToolName.MultiReplaceString] = learned.includes(ToolName.MultiReplaceString);
		allowTools[ToolName.ApplyPatch] = learned.includes(ToolName.ApplyPatch);
	} else {
		allowTools[ToolName.EditFile] = true;
		allowTools[ToolName.ReplaceString] = modelSupportsReplaceString(model);
		allowTools[ToolName.ApplyPatch] = modelSupportsApplyPatch(model) && !!toolsService.getTool(ToolName.ApplyPatch);

		if (allowTools[ToolName.ApplyPatch] && modelCanUseApplyPatchExclusively(model)) {
			allowTools[ToolName.EditFile] = false;
		}

		if (modelCanUseReplaceStringExclusively(model)) {
			allowTools[ToolName.ReplaceString] = true;
			allowTools[ToolName.EditFile] = false;
		}

		if (allowTools[ToolName.ReplaceString] && modelSupportsMultiReplaceString(model)) {
			allowTools[ToolName.MultiReplaceString] = true;
		}
	}

	allowTools[ToolName.CoreRunTest] = await testService.hasAnyTests();
	allowTools[ToolName.CoreRunTask] = tasksService.getTasks().length > 0;

	const searchSubagentEnabled = configurationService.getExperimentBasedConfig(ConfigKey.Advanced.SearchSubagentToolEnabled, experimentationService);
	const exploreAgentEnabled = configurationService.getExperimentBasedConfig(ConfigKey.ExploreAgentEnabled, experimentationService);
	const executionSubagentEnabled = configurationService.getExperimentBasedConfig(ConfigKey.Advanced.ExecutionSubagentToolEnabled, experimentationService);
	const canInvokeSubagents = !!model.supportsToolCalls;
	allowTools[ToolName.SearchSubagent] = searchSubagentEnabled && exploreAgentEnabled && canInvokeSubagents;
	allowTools[ToolName.ExploreSubagent] = searchSubagentEnabled && !exploreAgentEnabled && canInvokeSubagents;
	allowTools[ToolName.ExecutionSubagent] = executionSubagentEnabled && canInvokeSubagents;

	const skillToolEnabled = configurationService.getExperimentBasedConfig(ConfigKey.Advanced.SkillToolEnabled, experimentationService);
	allowTools[ToolName.Skill] = skillToolEnabled;

	const getSCMChangesEnabled = configurationService.getExperimentBasedConfig(ConfigKey.Advanced.GetChangedFilesToolEnabled, experimentationService);
	allowTools[ToolName.GetScmChanges] = getSCMChangesEnabled;

	allowTools[ToolName.SessionStoreSql] = true;

	allowTools[CUSTOM_TOOL_SEARCH_NAME] = !!model.supportsToolSearch;

	if (isXAiFamily(model)) {
		allowTools[ToolName.CoreManageTodoList] = false;
	}

	if (isBackgroundTodoAgentEnabled(model, configurationService, experimentationService, authenticationService, request)) {
		allowTools[ToolName.CoreManageTodoList] = false;
	}

	allowTools['task_complete'] = request.permissionLevel === 'autopilot' || request.permissionLevel === 'autoApprove';

	allowTools[ToolName.EditFilesPlaceholder] = false;
	if (Iterable.some(request.tools, ([t, enabled]) => (typeof t === 'string' ? t : t.name) === ContributedToolName.EditFilesPlaceholder && enabled === false)) {
		allowTools[ToolName.ApplyPatch] = false;
		allowTools[ToolName.EditFile] = false;
		allowTools[ToolName.ReplaceString] = false;
		allowTools[ToolName.MultiReplaceString] = false;
	}

	if (model.family.toLowerCase().includes('gemini-3') && configurationService.getExperimentBasedConfig(ConfigKey.Advanced.Gemini3MultiReplaceString, experimentationService)) {
		allowTools[ToolName.MultiReplaceString] = true;
	}

	const tools = toolsService.getEnabledTools(request, model, tool => {
		if (typeof allowTools[tool.name] === 'boolean') {
			return allowTools[tool.name];
		}

		return undefined;
	});

	if (modelSupportsSimplifiedApplyPatchInstructions(model) && configurationService.getExperimentBasedConfig(ConfigKey.Advanced.Gpt5AlternativePatch, experimentationService)) {
		const ap = tools.findIndex(t => t.name === ToolName.ApplyPatch);
		if (ap !== -1) {
			tools[ap] = { ...tools[ap], description: applyPatch5Description };
		}
	}

	if (configurationService.getExperimentBasedConfig(ConfigKey.Advanced.BatchReplaceStringDescriptions, experimentationService)) {
		const rs = tools.findIndex(t => t.name === ToolName.ReplaceString);
		if (rs !== -1) {
			tools[rs] = { ...tools[rs], description: replaceStringBatchDescription };
		}
		const mrs = tools.findIndex(t => t.name === ToolName.MultiReplaceString);
		if (mrs !== -1) {
			tools[mrs] = { ...tools[mrs], description: multiReplaceStringPrimaryDescription };
		}
	}

	return tools;
};

export class AgentIntent extends EditCodeIntent {

	static override readonly ID = Intent.Agent;

	override readonly id = AgentIntent.ID;

	private readonly _backgroundSummarizers = new Map<string, BackgroundSummarizer>();
	private readonly _backgroundTodoProcessors = new DisposableMap<string, BackgroundTodoAgentProcessor>();

	private readonly _sessionListeners = new DisposableStore();

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEndpointProvider endpointProvider: IEndpointProvider,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@ICodeMapperService codeMapperService: ICodeMapperService,
		@IWorkspaceService workspaceService: IWorkspaceService,
		@IChatSessionService chatSessionService: IChatSessionService,
		@IAutomodeService private readonly _automodeService: IAutomodeService,
		@ILogService private readonly _logService: ILogService,
		@IToolsService private readonly _toolsService: IToolsService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService
	) {
		super(instantiationService, endpointProvider, configurationService, expService, codeMapperService, workspaceService, { intentInvocation: AgentIntentInvocation, processCodeblocks: false });
		this._sessionListeners.add(chatSessionService.onDidDisposeChatSession(sessionId => {
			const summarizer = this._backgroundSummarizers.get(sessionId);
			if (summarizer) {
				summarizer.cancel();
				this._backgroundSummarizers.delete(sessionId);
			}
			this._backgroundTodoProcessors.deleteAndDispose(sessionId);
		}));
	}

	getOrCreateBackgroundSummarizer(sessionId: string, modelMaxPromptTokens: number, endpointId: string): BackgroundSummarizer {
		let summarizer = this._backgroundSummarizers.get(sessionId);
		if (summarizer && summarizer.endpointId !== endpointId) {
			summarizer.cancel();
			this._backgroundSummarizers.delete(sessionId);
			summarizer = undefined;
		}
		if (!summarizer) {
			summarizer = new BackgroundSummarizer(modelMaxPromptTokens, endpointId);
			this._backgroundSummarizers.set(sessionId, summarizer);
		}
		return summarizer;
	}

	cancelBackgroundSummarizer(sessionId: string): void {
		const summarizer = this._backgroundSummarizers.get(sessionId);
		if (summarizer) {
			summarizer.cancel();
			this._backgroundSummarizers.delete(sessionId);
		}
	}

	getOrCreateBackgroundTodoProcessor(promptContext: IBuildPromptContext): BackgroundTodoAgentProcessor | undefined {
		const sessionId = promptContext.conversation?.sessionId;
		if (sessionId === undefined) {
			return undefined;
		}
		let processor = this._backgroundTodoProcessors.get(sessionId);
		if (!processor) {
			processor = new BackgroundTodoAgentProcessor(
				sessionId,
				getSessionResource(promptContext),
				this._toolsService,
				this._telemetryService,
				this.instantiationService,
				this._logService
			);
			this._backgroundTodoProcessors.set(sessionId, processor);
		}
		return processor;
	}

	protected override getIntentHandlerOptions(request: vscode.ChatRequest): IDefaultIntentRequestHandlerOptions | undefined {
		return {
			maxToolCallIterations: getRequestedToolCallIterationLimit(request) ??
				this.instantiationService.invokeFunction(getAgentMaxRequests),
			temperature: this.configurationService.getConfig(ConfigKey.Advanced.AgentTemperature) ?? 0,
			overrideRequestLocation: ChatLocation.Agent
		};
	}

	override async handleRequest(
		conversation: Conversation,
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken,
		documentContext: IDocumentContext | undefined,
		agentName: string,
		location: ChatLocation,
		chatTelemetry: ChatTelemetryBuilder,
		yieldRequested: () => boolean
	): Promise<vscode.ChatResult> {
		if (request.command === 'compact') {
			return this.handleSummarizeCommand(conversation, request, stream, token);
		}

		const routingDecision = this._automodeService.consumeLastRoutingDecision();
		if (routingDecision) {
			stream.push(new ChatResponseAutoModeResolutionPart({ id: routingDecision.resolvedModel, name: routingDecision.resolvedModelName }));
		}

		try {
			return await super.handleRequest(conversation, request, stream, token, documentContext, agentName, location, chatTelemetry, yieldRequested);
		} finally {
			await this._runFinalBackgroundTodoPass(conversation, request);
		}
	}

	private async _runFinalBackgroundTodoPass(conversation: Conversation, request: vscode.ChatRequest): Promise<void> {
		if (request.subAgentInvocationId !== undefined || request.subAgentName !== undefined) {
			return;
		}
		const todoProcessor = this._backgroundTodoProcessors.get(conversation.sessionId);
		if (!todoProcessor) {
			return;
		}
		const endpoint = await this.endpointProvider.getChatEndpoint(request).catch(() => undefined);
		if (!endpoint || !isBackgroundTodoAgentEnabled(endpoint, this.configurationService, this.expService, this._authenticationService, request)) {
			return;
		}
		await raceTimeout(
			todoProcessor.endTurn(conversation.getLatestTurn().id, request.toolInvocationToken),
			5000,
			() => todoProcessor.cancel()
		);
	}

	private async handleSummarizeCommand(
		conversation: Conversation,
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<vscode.ChatResult> {
		normalizeSummariesOnRounds(conversation.turns);

		const history = conversation.turns.slice(0, -1);
		if (history.length === 0) {
			stream.markdown(l10n.t('Nothing to compact. Start a conversation first.'));
			return {};
		}

		const lastRoundId = history.at(-1)?.rounds.at(-1)?.id;
		if (!lastRoundId) {
			stream.markdown(l10n.t('Nothing to compact. Start a conversation with tool calls first.'));
			return {};
		}

		const endpoint = await this.endpointProvider.getChatEndpoint(request);
		if (isResponsesCompactionContextManagementEnabled(endpoint, this.configurationService, this.expService)) {
			stream.markdown(l10n.t('Compaction is already managed by context management for this session.'));
			return {};
		}

		this.cancelBackgroundSummarizer(conversation.sessionId);

		const availableTools = await this.instantiationService.invokeFunction(getAgentTools, request, endpoint);
		const promptContext: IBuildPromptContext = {
			history,
			chatVariables: new ChatVariablesCollection([]),
			query: '',
			toolCallRounds: [],
			conversation,
			tools: {
				availableTools,
				toolReferences: request.toolReferences.map(InternalToolReference.from),
				toolInvocationToken: request.toolInvocationToken,
			},
		};

		try {
			const propsBuilder = this.instantiationService.createInstance(SummarizedConversationHistoryPropsBuilder);
			const propsInfo = propsBuilder.getProps({
				priority: 1,
				endpoint,
				location: ChatLocation.Agent,
				promptContext,
				tools: availableTools,
				maxToolResultLength: Infinity,
			});
			if (!propsInfo) {
				stream.markdown(l10n.t('Nothing to compact yet.'));
				return {};
			}

			stream.progress(l10n.t('Compacting conversation...'));

			const progress: vscode.Progress<vscode.ChatResponseReferencePart | vscode.ChatResponseProgressPart> = {
				report: () => { }
			};
			const renderer = PromptRenderer.create(this.instantiationService, endpoint, SummarizedConversationHistory, {
				...propsInfo.props,
				triggerSummarize: true,
				summarizationInstructions: request.prompt || undefined,
			});
			const result = await renderer.render(progress, token);
			const summaryMetadata = result.metadata.get(SummarizedConversationHistoryMetadata);
			if (!summaryMetadata) {
				stream.markdown(l10n.t('Unable to compact conversation.'));
				return {};
			}

			if (summaryMetadata.usage) {
				const credits = nanoAiuToCredits(summaryMetadata.usage.dardcor_usage?.total_nano_aiu);
				stream.usage({
					promptTokens: summaryMetadata.usage.prompt_tokens,
					completionTokens: summaryMetadata.usage.completion_tokens,
					copilotCredits: credits,
					dardcorCredits: credits,
					promptTokenDetails: summaryMetadata.promptTokenDetails,
				});
			}

			stream.markdown(l10n.t('Compacted conversation.'));
			const lastTurn = conversation.getLatestTurn();
			this._automodeService.invalidateRouterCache(request);

			const chatResult: vscode.ChatResult = {
				metadata: {
					summary: {
						toolCallRoundId: summaryMetadata.toolCallRoundId,
						text: summaryMetadata.text,
					}
				}
			};

			lastTurn.setResponse(
				TurnStatus.Success,
				{ type: 'model', message: '' },
				undefined,
				chatResult,
			);

			lastTurn.setMetadata(summaryMetadata);

			return chatResult;
		} catch (e) {
			if (isCancellationError(e)) {
				return {};
			}

			const message = e instanceof Error ? e.message : String(e);
			stream.markdown(l10n.t('Failed to compact conversation: {0}', message));
			return {};
		}
	}
}

export class AgentIntentInvocation extends EditCodeIntentInvocation implements IIntentInvocation {

	public override readonly codeblocksRepresentEdits = false;

	protected prompt: typeof AgentPrompt | typeof EditCodePrompt2 | typeof NotebookInlinePrompt = AgentPrompt;

	protected extraPromptProps: Partial<AgentPromptProps> | undefined;

	private _resolvedCustomizations: AgentPromptCustomizations | undefined;

	private _lastRenderTokenCount: number = 0;

	private _lastModelCapabilities: { enableThinking: boolean; reasoningEffort: string | undefined; enableToolSearch: boolean; enableContextEditing: boolean } | undefined;

	private _thresholdRng: () => number = Math.random;

	constructor(
		intent: IIntent,
		location: ChatLocation,
		endpoint: IChatEndpoint,
		request: vscode.ChatRequest,
		intentOptions: EditCodeIntentInvocationOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeMapperService codeMapperService: ICodeMapperService,
		@IEnvService envService: IEnvService,
		@IPromptPathRepresentationService promptPathRepresentationService: IPromptPathRepresentationService,
		@IEndpointProvider endpointProvider: IEndpointProvider,
		@IWorkspaceService workspaceService: IWorkspaceService,
		@IToolsService toolsService: IToolsService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEditLogService editLogService: IEditLogService,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotebookService notebookService: INotebookService,
		@ILogService private readonly logService: ILogService,
		@IExperimentationService private readonly expService: IExperimentationService,
		@IAutomodeService private readonly automodeService: IAutomodeService,
		@IOTelService protected override readonly otelService: IOTelService,
		@ISessionTranscriptService private readonly sessionTranscriptService: ISessionTranscriptService,
		@IAutomaticInstructionsCollector private readonly _automaticInstructionsCollector: IAutomaticInstructionsCollector,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
	) {
		super(intent, location, applyContextSizeOverride(endpoint, request, configurationService.getConfig(ConfigKey.PreferLongContext)), request, intentOptions, instantiationService, codeMapperService, envService, promptPathRepresentationService, endpointProvider, workspaceService, toolsService, configurationService, editLogService, commandService, telemetryService, notebookService, otelService);
	}

	public override getAvailableTools(): Promise<vscode.LanguageModelToolInformation[]> {
		return this.instantiationService.invokeFunction(getAgentTools, this.request);
	}

	override async buildPrompt(
		promptContext: IBuildPromptContext,
		progress: vscode.Progress<vscode.ChatResponseReferencePart | vscode.ChatResponseProgressPart>,
		token: vscode.CancellationToken
	): Promise<IBuildPromptResult> {
		this._resolvedCustomizations = await PromptRegistry.resolveAllCustomizations(this.instantiationService, this.endpoint);

		const collectInstructionsInExtension = this.configurationService.getNonExtensionConfig<boolean>(PromptConfig.COLLECT_INSTRUCTIONS_IN_EXTENSION) === true;
		if (collectInstructionsInExtension) {
			const addedInstructionsAndIndex = await this._automaticInstructionsCollector.collect(this.request, token);
			if (addedInstructionsAndIndex.length > 0) {
				promptContext = { ...promptContext, chatVariables: ChatVariablesCollection.merge(promptContext.chatVariables, new ChatVariablesCollection(addedInstructionsAndIndex)) };
			}
		} else {
			await this.instantiationService.createInstance(CustomInstructionsReferenceLogger).compare(this.request, this._automaticInstructionsCollector, token);
		}
		await this.instantiationService.createInstance(CustomInstructionsReferenceLogger).logReferences(promptContext.conversation?.sessionId, promptContext.chatVariables.references, collectInstructionsInExtension);


		const codebase = await this._getCodebaseReferences(promptContext, token);

		let variables = promptContext.chatVariables;
		let toolReferences: vscode.ChatPromptReference[] = [];
		if (codebase) {
			toolReferences = toNewChatReferences(variables, codebase.references);
			variables = new ChatVariablesCollection([...variables.references, ...toolReferences]);
		}

		const tools = promptContext.tools?.availableTools;
		const toolSearchEnabled = !!this.endpoint.supportsToolSearch;
		const toolTokens = tools?.length ? await this.endpoint.acquireTokenizer().countToolTokens(tools) : 0;

		const summarizeThresholdOverride = this.configurationService.getConfig<number | undefined>(ConfigKey.Advanced.SummarizeAgentConversationHistoryThreshold);

		const configuredContextSize = this.request.modelConfiguration?.contextSize;
		const effectiveMaxTokens = typeof configuredContextSize === 'number' && configuredContextSize < this.endpoint.modelMaxPromptTokens
			? configuredContextSize
			: this.endpoint.modelMaxPromptTokens;

		const summarizeThresholdTokens = resolveSummarizeThresholdTokens(summarizeThresholdOverride, effectiveMaxTokens, ConfigKey.Advanced.SummarizeAgentConversationHistoryThreshold.id);

		const baseBudget = Math.min(
			summarizeThresholdTokens ?? effectiveMaxTokens,
			effectiveMaxTokens
		);
		const useTruncation = this.endpoint.apiType === 'responses' && this.configurationService.getConfig(ConfigKey.Advanced.UseResponsesApiTruncation);
		const responsesCompactionContextManagementEnabled = isResponsesCompactionContextManagementEnabled(this.endpoint, this.configurationService, this.expService);
		const summarizationEnabled = this.configurationService.getConfig(ConfigKey.SummarizeAgentConversationHistory) && this.prompt === AgentPrompt && !responsesCompactionContextManagementEnabled;

		const messageBudget = Math.max(1, Math.floor((baseBudget - toolTokens) * 0.9));
		const safeBudget = useTruncation ? Number.MAX_SAFE_INTEGER : messageBudget;
		const endpoint = toolTokens > 0 ? this.endpoint.cloneWithTokenOverride(safeBudget) : this.endpoint;

		this.logService.debug(`[Agent] rendering with budget=${safeBudget} (baseBudget: ${baseBudget}, toolTokens: ${toolTokens}, totalTools: ${tools?.length ?? 0}, toolSearchEnabled: ${toolSearchEnabled}), summarizationEnabled=${summarizationEnabled}`);
		let result: RenderPromptResult;
		const isMessagesApi = this.endpoint.apiType === 'messages';
		const props: AgentPromptProps = {
			endpoint,
			promptContext: {
				...promptContext,
				chatVariables: variables,
				tools: promptContext.tools && {
					...promptContext.tools,
					toolReferences: this.stableToolReferences.filter((r) => r.name !== ToolName.Codebase),
				}
			},
			location: this.location,
			enableSummarization: summarizationEnabled,
			enableCacheBreakpoints: summarizationEnabled && !isMessagesApi,
			...this.extraPromptProps,
			customizations: this._resolvedCustomizations
		};

		const backgroundSummarizer = summarizationEnabled ? this._getOrCreateBackgroundSummarizer(promptContext.conversation?.sessionId) : undefined;
		const lastTurnPromptTokens = findLast(promptContext.conversation?.turns ?? [], turn => !!turn.getMetadata(TurnTokenUsageMetadata))
			?.getMetadata(TurnTokenUsageMetadata)?.promptTokens;
		const contextRatio = backgroundSummarizer && baseBudget > 0
			? Math.max(this._lastRenderTokenCount + toolTokens, lastTurnPromptTokens ?? 0) / baseBudget
			: 0;

		let didSummarizeThisIteration = false;

		if (summarizationEnabled && backgroundSummarizer?.state === BackgroundSummarizationState.Completed) {
			if (contextRatio >= BackgroundSummarizationThresholds.applyMinRatio) {
				const bgResult = backgroundSummarizer.consumeAndReset();
				if (bgResult) {
					this.logService.debug(`[ConversationHistorySummarizer] applying completed background summary (roundId=${bgResult.toolCallRoundId})`);
					progress.report(new ChatResponseProgressPart2(l10n.t('Compacted conversation'), async () => l10n.t('Compacted conversation')));
					this._applySummaryToRounds(bgResult, promptContext);
					this._persistSummaryOnTurn(bgResult, promptContext, this._lastRenderTokenCount);
					this._sendBackgroundCompactionTelemetry('preRender', 'applied', contextRatio, promptContext);
					didSummarizeThisIteration = true;
				} else {
					this.logService.warn(`[ConversationHistorySummarizer] background compaction state was Completed but consumeAndReset returned no result`);
					this._sendBackgroundCompactionTelemetry('preRender', 'noResult', contextRatio, promptContext);
					this._recordBackgroundCompactionFailure(promptContext, 'preRender');
				}
			} else {
				backgroundSummarizer.consumeAndReset();
				this.logService.debug(`[ConversationHistorySummarizer] discarding completed background summary; contextRatio ${(contextRatio * 100).toFixed(0)}% below applyMinRatio ${(BackgroundSummarizationThresholds.applyMinRatio * 100).toFixed(0)}% (likely model switch or context-size override)`);
				this._sendBackgroundCompactionTelemetry('preRender', 'discardedBelowApplyMinRatio', contextRatio, promptContext);
			}
		}

		const renderWithoutSummarization = async (reason: string, renderProps: AgentPromptProps = props): Promise<RenderPromptResult> => {
			this.logService.debug(`[Agent] ${reason}, rendering without summarization`);
			const renderer = PromptRenderer.create(this.instantiationService, this.endpoint, this.prompt, {
				...renderProps,
				endpoint: this.endpoint,
				enableSummarization: false,
				enableCacheBreakpoints: false
			});
			try {
				return await renderer.render(progress, token);
			} catch (e) {
				if (e instanceof BudgetExceededError) {
					this.logService.error(e, `[Agent] fallback render failed due to budget exceeded`);
					const maxTokens = this.endpoint.modelMaxPromptTokens;
					throw new Error(`Unable to build prompt, modelMaxPromptTokens = ${maxTokens} (${e.message})`);
				}
				throw e;
			}
		};

		const renderWithSummarization = async (reason: string, renderProps: AgentPromptProps = props): Promise<RenderPromptResult> => {
			const turn = promptContext.conversation?.getLatestTurn();
			const previousForegroundSummary = turn?.getMetadata(SummarizedConversationHistoryMetadata);
			if (previousForegroundSummary?.source === 'foreground' && previousForegroundSummary.outcome && previousForegroundSummary.outcome !== 'success') {
				this.logService.debug(`[ConversationHistorySummarizer] ${reason}, skipping repeated foreground summarization after prior failure (${previousForegroundSummary.outcome})`);
				this.telemetryService.sendMSFTTelemetryEvent('triggerSummarizeSkipped', { previousOutcome: previousForegroundSummary.outcome, model: renderProps.endpoint.model });
				GenAiMetrics.incrementAgentSummarizationCount(this.otelService, 'skipped');
				return renderWithoutSummarization(`skipping repeated foreground summarization after prior failure (${previousForegroundSummary.outcome})`, renderProps);
			}

			this.logService.debug(`[ConversationHistorySummarizer] ${reason}, triggering summarization`);
			try {
				const renderer = PromptRenderer.create(this.instantiationService, this.endpoint, this.prompt, {
					...renderProps,
					endpoint: this.endpoint,
					promptContext: renderProps.promptContext,
					triggerSummarize: true,
					forceSimpleSummary: true,
				});
				return await renderer.render(progress, token);
			} catch (e) {
				this.logService.error(e, `[ConversationHistorySummarizer] summarization failed`);
				const errorKind = e instanceof BudgetExceededError ? 'budgetExceeded' : 'error';
				this.telemetryService.sendMSFTTelemetryEvent('triggerSummarizeFailed', { errorKind, model: renderProps.endpoint.model });
				GenAiMetrics.incrementAgentSummarizationCount(this.otelService, 'failed');

				const turn = promptContext.conversation?.getLatestTurn();
				turn?.setMetadata(new SummarizedConversationHistoryMetadata(
					'',
					'',
					{
						model: renderProps.endpoint.model,
						source: 'foreground',
						outcome: errorKind,
						contextLengthBefore: this._lastRenderTokenCount,
					},
				));

				return renderWithoutSummarization(`summarization failed (${errorKind})`, renderProps);
			}
		};

		const contextLengthBefore = this._lastRenderTokenCount;

		try {
			const renderer = PromptRenderer.create(this.instantiationService, endpoint, this.prompt, props);
			result = await renderer.render(progress, token);
		} catch (e) {
			if (e instanceof BudgetExceededError && summarizationEnabled) {
				if (!promptContext.toolCallResults) {
					promptContext = {
						...promptContext,
						toolCallResults: {}
					};
				}
				e.metadata.getAll(ToolResultMetadata).forEach((metadata) => {
					promptContext.toolCallResults![metadata.toolCallId] = metadata.result;
				});

				if (backgroundSummarizer && (backgroundSummarizer.state === BackgroundSummarizationState.InProgress || backgroundSummarizer.state === BackgroundSummarizationState.Completed)) {
					let budgetExceededTrigger: string;
					if (backgroundSummarizer.state === BackgroundSummarizationState.InProgress) {
						budgetExceededTrigger = 'budgetExceededWaited';
						this.logService.debug(`[ConversationHistorySummarizer] budget exceeded — waiting on in-progress background compaction instead of new request`);
						const summaryPromise = backgroundSummarizer.waitForCompletion();
						progress.report(new ChatResponseProgressPart2(l10n.t('Compacting conversation...'), async () => {
							try { await summaryPromise; } catch { }
							return l10n.t('Compacted conversation');
						}));
						await summaryPromise;
					} else {
						budgetExceededTrigger = 'budgetExceededReady';
						this.logService.debug(`[ConversationHistorySummarizer] budget exceeded — applying already-completed background compaction`);
						progress.report(new ChatResponseProgressPart2(l10n.t('Compacted conversation'), async () => l10n.t('Compacted conversation')));
					}
					const bgResult = backgroundSummarizer.consumeAndReset();
					if (bgResult) {
						this.logService.debug(`[ConversationHistorySummarizer] background compaction applied after budget exceeded (roundId=${bgResult.toolCallRoundId})`);
						this._applySummaryToRounds(bgResult, promptContext);
						this._persistSummaryOnTurn(bgResult, promptContext, contextLengthBefore);
						didSummarizeThisIteration = true;
						try {
							const reRenderer = PromptRenderer.create(this.instantiationService, endpoint, this.prompt, { ...props, promptContext });
							result = await reRenderer.render(progress, token);
							this._sendBackgroundCompactionTelemetry(budgetExceededTrigger, 'applied', contextRatio, promptContext);
						} catch (reRenderError) {
							if (reRenderError instanceof BudgetExceededError) {
								this.logService.debug(`[ConversationHistorySummarizer] re-render after background compaction still exceeded budget — falling back`);
								this._sendBackgroundCompactionTelemetry(budgetExceededTrigger, 'appliedButReRenderFailed', contextRatio, promptContext);
								result = await renderWithoutSummarization('budget exceeded after background compaction applied', { ...props, promptContext });
							} else {
								throw reRenderError;
							}
						}
					} else {
						this.logService.debug(`[ConversationHistorySummarizer] background compaction produced no usable result after budget exceeded — falling back to synchronous summarization`);
						this._sendBackgroundCompactionTelemetry(budgetExceededTrigger, 'noResult', contextRatio, promptContext);
						this._recordBackgroundCompactionFailure(promptContext, budgetExceededTrigger);
						result = await renderWithSummarization(`budget exceeded(${e.message}), background compaction failed`);
						didSummarizeThisIteration = true;
					}
				} else {
					result = await renderWithSummarization(`budget exceeded(${e.message})`);
					didSummarizeThisIteration = true;
				}
			} else {
				throw e;
			}
		}

		this._lastRenderTokenCount = result.tokenCount;

		const summaryMeta = result.metadata.get(SummarizedConversationHistoryMetadata);
		if (summaryMeta) {
			const turn = promptContext.conversation?.getLatestTurn();
			turn?.setMetadata(new SummarizedConversationHistoryMetadata(
				summaryMeta.toolCallRoundId,
				summaryMeta.text,
				{
					thinking: summaryMeta.thinking,
					usage: summaryMeta.usage,
					promptTokenDetails: summaryMeta.promptTokenDetails,
					model: summaryMeta.model,
					summarizationMode: summaryMeta.summarizationMode,
					numRounds: summaryMeta.numRounds,
					numRoundsSinceLastSummarization: summaryMeta.numRoundsSinceLastSummarization,
					durationMs: summaryMeta.durationMs,
					source: 'foreground',
					outcome: 'success',
					contextLengthBefore,
				},
			));
		}

		if (summarizationEnabled && backgroundSummarizer && !didSummarizeThisIteration) {
			const localPostRender = result.tokenCount + toolTokens;
			const effectivePostRender = Math.max(localPostRender, lastTurnPromptTokens ?? 0);
			const postRenderRatio = baseBudget > 0
				? effectivePostRender / baseBudget
				: 0;

			const idleOrFailed = backgroundSummarizer.state === BackgroundSummarizationState.Idle
				|| backgroundSummarizer.state === BackgroundSummarizationState.Failed;

			const cacheWarm = (promptContext.toolCallRounds?.length ?? 0) > 0;
			const kickOff = shouldKickOffBackgroundSummarization(postRenderRatio, cacheWarm, this._thresholdRng);
			if (kickOff && idleOrFailed) {
				const strippedMessages = ToolCallingLoop.stripInternalToolCallIds(result.messages);
				const rawEffort = this.request.modelConfiguration?.reasoningEffort;
				const isSubagent = !!this.request.subAgentInvocationId;
				const shouldDisableThinking = !!promptContext.isContinuation && isAnthropicFamily(this.endpoint) && !ToolCallingLoop.messagesContainThinking(strippedMessages);
				this._lastModelCapabilities = {
					enableThinking: !shouldDisableThinking,
					reasoningEffort: typeof rawEffort === 'string' ? rawEffort : undefined,
					enableToolSearch: !isSubagent && !!this.endpoint.supportsToolSearch,
					enableContextEditing: !isSubagent && isAnthropicContextEditingEnabled(this.endpoint, this.configurationService, this.expService),
				};
				this._startBackgroundSummarization(backgroundSummarizer, result.messages, promptContext, props, token, postRenderRatio);
			}
		}

		this._maybeStartBackgroundTodoAgentPass(endpoint, promptContext, token);

		const lastMessage = result.messages.at(-1);
		if (lastMessage?.role === Raw.ChatRole.User) {
			const currentTurn = promptContext.conversation?.getLatestTurn();
			if (currentTurn && !currentTurn.getMetadata(RenderedUserMessageMetadata)) {
				currentTurn.setMetadata(new RenderedUserMessageMetadata(lastMessage.content));
			}
		}

		if (this.endpoint.apiType !== 'messages') {
			addCacheBreakpoints(result.messages, this.endpoint.apiType);
		}

		if (this.request.command === 'error') {
			result.messages.push({
				role: Raw.ChatRole.Assistant,
				content: [],
				toolCalls: [{ type: 'function', id: '', function: { name: 'tool', arguments: '{' } }]
			});
		}


		return {
			...result,
			metadata: codebase ? mergeMetadata(result.metadata, codebase.metadatas) : result.metadata,
		};
	}

	modifyErrorDetails(errorDetails: vscode.ChatErrorDetails, response: ChatResponse): vscode.ChatErrorDetails {
		if (!errorDetails.responseIsFiltered) {
			errorDetails.confirmationButtons = [
				...(errorDetails.confirmationButtons ?? []),
				{ data: { dardcorContinueOnError: true } satisfies IContinueOnErrorConfirmation, label: l10n.t('Try Again') },
			];
		}
		return errorDetails;
	}

	getAdditionalVariables(promptContext: IBuildPromptContext): ChatVariablesCollection | undefined {
		const lastTurn = promptContext.conversation?.turns.at(-1);
		if (!lastTurn) {
			return;
		}

		if (lastTurn.acceptedConfirmationData) {
			const turns = promptContext.conversation!.turns.slice(0, -1);
			for (const turn of Iterable.reverse(turns)) {
				if (!turn.acceptedConfirmationData) {
					return turn.promptVariables;
				}
			}
		}
	}

	private _startBackgroundSummarization(
		backgroundSummarizer: BackgroundSummarizer,
		mainRenderMessages: Raw.ChatMessage[],
		promptContext: IBuildPromptContext,
		props: AgentPromptProps,
		token: vscode.CancellationToken,
		contextRatio: number,
	): void {
		const rounds = [...(promptContext.toolCallRounds ?? [])];
		const history = promptContext.history;

		const toolCallRoundId = resolveSummaryAnchorRoundId(rounds, history);
		if (!toolCallRoundId) {
			this.logService.debug(`[ConversationHistorySummarizer] skipping background compaction at ${(contextRatio * 100).toFixed(0)}% — no tool call round to attach summary to (rounds=${rounds.length}, history=${history.length})`);
			return;
		}

		this.logService.debug(`[ConversationHistorySummarizer] context at ${(contextRatio * 100).toFixed(0)}% — starting background compaction`);

		const bgStartTime = Date.now();

		const availableTools = promptContext.tools?.availableTools;
		const normalizedTools = availableTools?.length ? normalizeToolSchema(
			this.endpoint.family,
			availableTools.map(tool => ({
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.inputSchema && Object.keys(tool.inputSchema).length ? tool.inputSchema : undefined
				},
				type: 'function' as const,
			})),
			(tool, rule) => {
				this.logService.warn(`[ConversationHistorySummarizer] Tool ${tool} failed validation: ${rule}`);
			},
		) : undefined;
		const toolOpts = normalizedTools?.length ? {
			tools: normalizedTools,
		} : undefined;

		const associatedRequestId = promptContext.conversation?.getLatestTurn()?.id;
		const conversationId = promptContext.conversation?.sessionId;
		const modelCapabilities = this._lastModelCapabilities;

		backgroundSummarizer.start(async bgToken => {
			try {
				const strippedMainMessages = ToolCallingLoop.stripInternalToolCallIds(mainRenderMessages);
				const summaryMsgResult = await renderPromptElement(
					this.instantiationService,
					this.endpoint,
					SummarizationUserMessage,
					{ endpoint: this.endpoint },
					undefined,
					bgToken,
				);
				const messages = [
					...strippedMainMessages,
					...summaryMsgResult.messages,
				];

				const response = await this.endpoint.makeChatRequest2({
					debugName: 'summarizeConversationHistory',
					messages,
					ignoreStatefulMarker: true,
					finishedCb: undefined,
					location: ChatLocation.Agent,
					conversationId,
					requestOptions: {
						temperature: 0,
						...toolOpts,
					},
					modelCapabilities,
					telemetryProperties: associatedRequestId ? { associatedRequestId } : undefined,
					enableRetryOnFilter: true,
					interactionTypeOverride: 'conversation-compaction',
				}, bgToken);
				if (response.type !== ChatFetchResponseType.Success) {
					throw new Error(`Background summarization request failed: ${response.type}`);
				}
				const rawSummaryText = extractSummary(response.value);
				if (rawSummaryText === undefined) {
					throw new Error('Background summarization: no <summary> tags found in response');
				}
				if (conversationId && this.sessionTranscriptService.getTranscriptPath(conversationId)) {
					await this.sessionTranscriptService.flush(conversationId);
				}
				const summaryText = conversationId
					? appendTranscriptHintToSummary(rawSummaryText, conversationId, this.sessionTranscriptService)
					: rawSummaryText;
				this.logService.debug(`[ConversationHistorySummarizer] background compaction completed (${summaryText.length} chars, roundId=${toolCallRoundId})`);

				const { numRounds, numRoundsSinceLastSummarization } = computeSummarizationRoundCounts(history, rounds);
				const numRoundsInCurrentTurn = rounds.length;
				const lastUsedTool = rounds.at(-1)?.toolCalls?.at(-1)?.name
					?? history.at(-1)?.rounds.at(-1)?.toolCalls?.at(-1)?.name ?? 'none';
				const promptTypes = messages.map(msg => `${msg.role}${'name' in msg && msg.name ? `-${msg.name}` : ''}:${getTextPart(msg.content).length}`).join(',');
				this.telemetryService.sendMSFTTelemetryEvent('summarizedConversationHistory', {
					outcome: 'success',
					model: this.endpoint.model,
					summarizationMode: 'full',
					conversationId,
					chatRequestId: associatedRequestId,
					lastUsedTool,
					requestId: response.requestId,
					promptTypes,
				}, {
					numRounds,
					turnIndex: history.length,
					curTurnRoundIndex: numRoundsInCurrentTurn,
					isDuringToolCalling: numRoundsInCurrentTurn > 0 ? 1 : 0,
					duration: Date.now() - bgStartTime,
					promptTokenCount: response.usage?.prompt_tokens,
					promptCacheTokenCount: response.usage?.prompt_tokens_details?.cached_tokens,
					responseTokenCount: response.usage?.completion_tokens,
				});

				return {
					summary: summaryText,
					toolCallRoundId,
					promptTokens: response.usage?.prompt_tokens,
					promptCacheTokens: response.usage?.prompt_tokens_details?.cached_tokens,
					outputTokens: response.usage?.completion_tokens,
					durationMs: Date.now() - bgStartTime,
					model: this.endpoint.model,
					summarizationMode: 'full',
					numRounds,
					numRoundsSinceLastSummarization,
				};
			} catch (err) {
				this.logService.error(err, `[ConversationHistorySummarizer] background compaction failed`);

				this.telemetryService.sendMSFTTelemetryEvent('summarizedConversationHistory', {
					outcome: 'failed',
					detailedOutcome: err instanceof Error ? err.message : String(err),
					model: this.endpoint.model,
					summarizationMode: 'full',
					conversationId,
					chatRequestId: associatedRequestId,
				}, {
					duration: Date.now() - bgStartTime,
				});

				throw err;
			}
		}, token);
	}

	private _getOrCreateBackgroundSummarizer(sessionId: string | undefined): BackgroundSummarizer | undefined {
		if (!sessionId || !(this.intent instanceof AgentIntent)) {
			return undefined;
		}
		const endpointId = `${this.endpoint.modelProvider}:${this.endpoint.model}${this.endpoint.apiType ? `:${this.endpoint.apiType}` : ''}`;
		return this.intent.getOrCreateBackgroundSummarizer(sessionId, this.endpoint.modelMaxPromptTokens, endpointId);
	}

	private _applySummaryToRounds(bgResult: { summary: string; toolCallRoundId: string }, promptContext: IBuildPromptContext): void {
		const currentRound = promptContext.toolCallRounds?.find(r => r.id === bgResult.toolCallRoundId);
		if (currentRound) {
			currentRound.summary = bgResult.summary;
		} else {
			let found = false;
			for (const turn of [...promptContext.history].reverse()) {
				const round = turn.rounds.find(r => r.id === bgResult.toolCallRoundId);
				if (round) {
					round.summary = bgResult.summary;
					found = true;
					break;
				}
			}
			if (!found) {
				this.logService.warn(`[ConversationHistorySummarizer] background compaction round ${bgResult.toolCallRoundId} not found in toolCallRounds or history — summary dropped`);
			}
		}
		this.automodeService.invalidateRouterCache(this.request);
	}

	private _persistSummaryOnTurn(bgResult: IBackgroundSummarizationResult, promptContext: IBuildPromptContext, contextLengthBefore?: number): void {
		const turn = promptContext.conversation?.getLatestTurn();
		const chatResult = turn?.responseChatResult;
		if (chatResult) {
			const metadata = (chatResult.metadata ?? {}) as Record<string, unknown>;
			const existingSummaries = (metadata['summaries'] as unknown[] ?? []);
			existingSummaries.push({ toolCallRoundId: bgResult.toolCallRoundId, text: bgResult.summary });
			metadata['summaries'] = existingSummaries;
			(chatResult as { metadata: unknown }).metadata = metadata;
		}
		turn?.addPendingSummary(bgResult.toolCallRoundId, bgResult.summary);
		const usage = bgResult.promptTokens !== undefined && bgResult.outputTokens !== undefined
			? { prompt_tokens: bgResult.promptTokens, completion_tokens: bgResult.outputTokens, total_tokens: bgResult.promptTokens + bgResult.outputTokens, ...(bgResult.promptCacheTokens !== undefined ? { prompt_tokens_details: { cached_tokens: bgResult.promptCacheTokens } } : {}) }
			: undefined;
		turn?.setMetadata(new SummarizedConversationHistoryMetadata(
			bgResult.toolCallRoundId,
			bgResult.summary,
			{
				usage,
				model: bgResult.model,
				summarizationMode: bgResult.summarizationMode,
				numRounds: bgResult.numRounds,
				numRoundsSinceLastSummarization: bgResult.numRoundsSinceLastSummarization,
				durationMs: bgResult.durationMs,
				source: 'background',
				outcome: 'success',
				contextLengthBefore,
			},
		));
	}

	private _recordBackgroundCompactionFailure(promptContext: IBuildPromptContext, trigger: string): void {
		const turn = promptContext.conversation?.getLatestTurn();
		turn?.setMetadata(new SummarizedConversationHistoryMetadata(
			'',
			'',
			{
				model: this.endpoint.model,
				source: 'background',
				outcome: `noResult_${trigger}`,
				contextLengthBefore: this._lastRenderTokenCount,
			},
		));
	}

	private _sendBackgroundCompactionTelemetry(
		trigger: string,
		outcome: string,
		contextRatio: number,
		promptContext: IBuildPromptContext,
	): void {
		this.telemetryService.sendMSFTTelemetryEvent('backgroundSummarizationApplied', {
			trigger,
			outcome,
			conversationId: promptContext.conversation?.sessionId,
			chatRequestId: promptContext.conversation?.getLatestTurn()?.id,
			model: this.endpoint.model,
		}, {
			contextRatio,
		});
		GenAiMetrics.incrementAgentSummarizationCount(this.otelService, outcome);
	}

	private _getOrCreateBackgroundTodoAgentProcessor(promptContext: IBuildPromptContext) {
		if (!(this.intent instanceof AgentIntent)) {
			return undefined;
		}
		return this.intent.getOrCreateBackgroundTodoProcessor(promptContext);
	}
	private _maybeStartBackgroundTodoAgentPass(endpoint: IChatEndpoint, promptContext: IBuildPromptContext, token: vscode.CancellationToken) {
		if (
			!isBackgroundTodoAgentEnabled(endpoint, this.configurationService, this.expService, this.authenticationService, this.request) ||
			isTodoToolExplicitlyEnabled(this.request) ||
			this.request.subAgentInvocationId !== undefined ||
			this.request.subAgentName !== undefined ||
			!isBackgroundTodoAgentEnabled(endpoint, this.configurationService, this.expService, this.authenticationService, this.request) ||
			isTodoToolExplicitlyEnabled(this.request)
		) {
			return;
		}

		const processor = this._getOrCreateBackgroundTodoAgentProcessor(promptContext);
		if (processor === undefined) {
			return;
		}

		processor.trackTurnRound(promptContext, token);
	}

	override processResponse = undefined;
}
