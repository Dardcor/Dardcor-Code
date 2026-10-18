/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Raw } from '@vscode/prompt-tsx';
import type { CancellationToken, ChatRequest, ChatResponseProgressPart, ChatResponseReferencePart, ChatResponseStream, ChatResult, LanguageModelToolInformation, Progress } from 'vscode';
import { IAuthenticationChatUpgradeService } from '../../../platform/authentication/common/authenticationUpgrade';
import { IChatDebugFileLoggerService } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { IChatHookService, SessionStartHookInput, SessionStartHookOutput, StopHookInput, StopHookOutput, SubagentStartHookInput, SubagentStartHookOutput, SubagentStopHookInput, SubagentStopHookOutput } from '../../../platform/chat/common/chatHookService';
import { FetchStreamSource, IResponsePart } from '../../../platform/chat/common/chatMLFetcher';
import { CanceledResult, ChatFetchResponseType, ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { IHistoricalTurn, ISessionTranscriptService, ToolRequest } from '../../../platform/chat/common/sessionTranscriptService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { isAnthropicFamily, isGeminiFamily } from '../../../platform/endpoint/common/chatModelCapabilities';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { rawPartAsThinkingData } from '../../../platform/endpoint/common/thinkingDataContainer';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IGitService } from '../../../platform/git/common/gitService';
import { ILogService } from '../../../platform/log/common/logService';
import { isOpenAIContextManagementResponse, OpenAiFunctionDef } from '../../../platform/networking/common/fetch';
import { IChatEndpoint, IMakeChatRequestOptions } from '../../../platform/networking/common/networking';
import { nanoAiuToCredits, OpenAIContextManagementResponse } from '../../../platform/networking/common/openai';
import { DardcorChatAttr, emitAgentTurnEvent, emitSessionStartEvent, GenAiAttr, GenAiMetrics, GenAiOperationName, GenAiProviderName, DardcorAttr, normalizeResponseModel, resolveWorkspaceOTelMetadata, StdAttr, stringifyToolDefinitionsForOTel, truncateForOTel, workspaceMetadataToOTelAttributes } from '../../../platform/otel/common/index';
import { IOTelService, ISpanHandle, SpanKind, SpanStatusCode } from '../../../platform/otel/common/otelService';
import { IRequestLogger } from '../../../platform/requestLogger/common/requestLogger';
import { getCurrentCapturingToken } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { computePromptTokenDetails } from '../../../platform/tokenizer/node/promptTokenDetails';
import { tryFinalizeResponseStream } from '../../../util/common/chatResponseStreamImpl';
import { ChatExtPerfMark, markChatExt } from '../../../util/common/performance';
import { DeferredPromise, timeout } from '../../../util/dardcor/base/common/async';
import { CancellationTokenSource } from '../../../util/dardcor/base/common/cancellation';
import { CancellationError, isCancellationError } from '../../../util/dardcor/base/common/errors';
import { Emitter } from '../../../util/dardcor/base/common/event';
import { Disposable, IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { Mutable } from '../../../util/dardcor/base/common/types';
import { URI } from '../../../util/dardcor/base/common/uri';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatResponsePullRequestPart, LanguageModelDataPart2, LanguageModelPartAudience, LanguageModelToolResult2, MarkdownString } from '../../../dardcorTypes';
import { InteractionOutcomeComputer } from '../../inlineChat/node/promptCraftingTypes';
import { ChatVariablesCollection } from '../../prompt/common/chatVariablesCollection';
import { Conversation, IResultMetadata, ResponseStreamParticipant, TurnStatus, TurnTokenUsageMetadata } from '../../prompt/common/conversation';
import { getSubAgentInvocationId, IBuildPromptContext, InternalToolReference, IToolCall, IToolCallRound } from '../../prompt/common/intents';
import { cancelText, IToolCallIterationIncrease } from '../../prompt/common/specialRequestTypes';
import { ThinkingDataItem, ToolCallRound } from '../../prompt/common/toolCallRound';
import { IBuildPromptResult, IResponseProcessor } from '../../prompt/node/intents';
import { PseudoStopStartResponseProcessor } from '../../prompt/node/pseudoStartStopConversationCallback';
import { ResponseProcessorContext } from '../../prompt/node/responseProcessorContext';
import { SummarizedConversationHistoryMetadata } from '../../prompts/node/agent/summarizedConversationHistory';
import { ToolFailureEncountered, ToolResultMetadata } from '../../prompts/node/panel/toolCalling';
import { ToolName } from '../../tools/common/toolNames';
import { IToolsService, ToolCallCancelledError } from '../../tools/common/toolsService';
import { ReadFileParams } from '../../tools/node/readFileTool';
import { isHookAbortError, processHookResults } from './hookResultProcessor';
import { applyConfiguredPromptOverrides } from './promptOverride';

export const enum ToolCallLimitBehavior {
	Confirm,
	Stop,
}

export interface IToolCallingLoopOptions {
	conversation: Conversation;
	toolCallLimit: number;
	onHitToolCallLimit?: ToolCallLimitBehavior;
	streamParticipants?: ResponseStreamParticipant[];
	responseProcessor?: IResponseProcessor;
	interactionContext?: URI;
	request: ChatRequest;
	yieldRequested?: () => boolean;
}

export interface IToolCallingResponseEvent {
	response: ChatResponse;
	interactionOutcome: InteractionOutcomeComputer;
	toolCalls: IToolCall[];
}

export interface IToolCallingBuiltPromptEvent {
	result: IBuildPromptResult;
	tools: LanguageModelToolInformation[];
}

export type ToolCallingLoopFetchOptions = Required<Pick<IMakeChatRequestOptions, 'messages' | 'finishedCb' | 'requestOptions' | 'userInitiatedRequest' | 'turnId'>> & Pick<IMakeChatRequestOptions, 'modelCapabilities' | 'summarizedAtRoundId' | 'topLevelTurnId'> & { iterationNumber: number; isKeepAliveProbe?: boolean };

interface StartHookResult {
	readonly additionalContext?: string;
}

interface StopHookResult {
	readonly shouldContinue: boolean;
	readonly reasons?: readonly string[];
}

interface SubagentStartHookResult {
	readonly additionalContext?: string;
}

interface SubagentStopHookResult {
	readonly shouldContinue: boolean;
	readonly reasons?: readonly string[];
}

function formatHookContext(reasons: readonly string[]): string {
	if (reasons.length === 1) {
		return `You were about to complete but a hook blocked you with the following message: "${reasons[0]}". Please address this requirement before completing.`;
	}
	const formattedReasons = reasons.map((reason, i) => `${i + 1}. ${reason}`).join('\n');
	return `You were about to complete but multiple hooks blocked you with the following messages:\n${formattedReasons}\n\nPlease address all of these requirements before completing.`;
}

export abstract class ToolCallingLoop<TOptions extends IToolCallingLoopOptions = IToolCallingLoopOptions> extends Disposable {
	private static NextToolCallId = Date.now();

	private static readonly TASK_COMPLETE_TOOL_NAME = 'task_complete';

	private toolCallResults: Record<string, LanguageModelToolResult2> = Object.create(null);
	private toolCallRounds: IToolCallRound[] = [];
	private stopHookReason: string | undefined;
	private additionalHookContext: string | undefined;
	private stopHookUserInitiated = false;
	private agentSpan: ISpanHandle | undefined;
	private chatSessionIdForTools: string | undefined;
	private toolsAvailableEmitted = false;
	private lastHeaderRequestId: string | undefined;
	private lastModelCallId: string | undefined;

	private _accumulatedCopilotCredits: number | undefined;

	private lastFetchOptions: ToolCallingLoopFetchOptions | undefined;

	private static readonly KEEP_ALIVE_INTERVAL_MS = 4 * 60 * 1000;

	public appendAdditionalHookContext(context: string): void {
		if (!context) {
			return;
		}
		this.additionalHookContext = this.additionalHookContext
			? `${this.additionalHookContext}\n${context}`
			: context;
	}

	private readonly _onDidBuildPrompt = this._register(new Emitter<{ result: IBuildPromptResult; tools: LanguageModelToolInformation[]; promptTokenLength: number; toolTokenCount: number }>());
	public readonly onDidBuildPrompt = this._onDidBuildPrompt.event;

	private readonly _onDidReceiveResponse = this._register(new Emitter<IToolCallingResponseEvent>());
	public readonly onDidReceiveResponse = this._onDidReceiveResponse.event;

	protected get currentToolCallRounds(): readonly IToolCallRound[] {
		return this.toolCallRounds;
	}

	private get turn() {
		return this.options.conversation.getLatestTurn();
	}

	protected get agentName(): string | undefined {
		return (this.options.request as { subAgentName?: string }).subAgentName
			?? (this.options.request as { participant?: string }).participant;
	}

	constructor(
		protected readonly options: TOptions,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
		@ILogService protected readonly _logService: ILogService,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@IAuthenticationChatUpgradeService private readonly _authenticationChatUpgradeService: IAuthenticationChatUpgradeService,
		@ITelemetryService protected readonly _telemetryService: ITelemetryService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
		@IExperimentationService protected readonly _experimentationService: IExperimentationService,
		@IChatHookService private readonly _chatHookService: IChatHookService,
		@ISessionTranscriptService protected readonly _sessionTranscriptService: ISessionTranscriptService,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IOTelService protected readonly _otelService: IOTelService,
		@IGitService private readonly _gitService: IGitService,
	) {
		super();
	}

	protected abstract buildPrompt(buildPromptContext: IBuildPromptContext, progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, token: CancellationToken): Promise<IBuildPromptResult>;

	protected abstract getAvailableTools(outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<LanguageModelToolInformation[]>;

	protected createPromptContext(availableTools: LanguageModelToolInformation[], outputStream: ChatResponseStream | undefined): Mutable<IBuildPromptContext> {
		const { request } = this.options;
		const chatVariables = new ChatVariablesCollection(request.references);

		const isContinuation = this.turn.isContinuation || !!this.stopHookReason;
		let query: string;
		let hasStopHookQuery = false;
		if (this.stopHookReason) {
			query = formatHookContext([this.stopHookReason]);
			this._logService.info(`[ToolCallingLoop] Using stop hook reason as query: ${query}`);
			this.stopHookReason = undefined;
			hasStopHookQuery = true;
		} else if (isContinuation) {
			query = 'Please continue';
		} else {
			query = this.turn.request.message;
		}
		const history = this.options.conversation.turns.slice(0, -1).filter(turn => turn.responseStatus !== TurnStatus.PromptFiltered);

		return {
			requestId: this.turn.id,
			query,
			history,
			toolCallResults: this.toolCallResults,
			toolCallRounds: this.toolCallRounds,
			editedFileEvents: this.options.request.editedFileEvents,
			request: this.options.request,
			stream: outputStream,
			conversation: this.options.conversation,
			chatVariables,
			tools: {
				toolReferences: request.toolReferences.map(InternalToolReference.from),
				toolInvocationToken: request.toolInvocationToken,
				availableTools
			},
			isContinuation,
			hasStopHookQuery,
			modeInstructions: this.options.request.modeInstructions2,
			additionalHookContext: this.additionalHookContext,
			parentHeaderRequestId: this.lastHeaderRequestId,
			parentModelCallId: this.lastModelCallId,
		};
	}

	protected abstract fetch(
		options: ToolCallingLoopFetchOptions,
		token: CancellationToken
	): Promise<ChatResponse>;

	private shouldReportUsageToContextWidget(): boolean {
		return !this.options.request.subAgentInvocationId;
	}

	protected async executeStopHook(input: StopHookInput, sessionId: string, outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<StopHookResult> {
		try {
			const results = await this._chatHookService.executeHook('Stop', this.options.request.hooks, input, sessionId, token);

			const blockingReasons = new Set<string>();
			processHookResults({
				hookType: 'Stop',
				results,
				outputStream,
				logService: this._logService,
				onSuccess: (output) => {
					if (typeof output === 'object' && output !== null) {
						const hookOutput = output as StopHookOutput;
						const specific = hookOutput.hookSpecificOutput;
						this._logService.trace(`[ToolCallingLoop] Checking hook output: decision=${specific?.decision}, reason=${specific?.reason}`);
						if (specific?.decision === 'block' && specific.reason) {
							this._logService.trace(`[ToolCallingLoop] Stop hook blocked: ${specific.reason}`);
							blockingReasons.add(specific.reason);
						}
					}
				},
				onError: (errorMessage) => {
					if (errorMessage) {
						this._logService.trace(`[ToolCallingLoop] Stop hook error collected as blocking reason: ${errorMessage}`);
						blockingReasons.add(errorMessage);
					}
				},
			});

			if (blockingReasons.size > 0) {
				return { shouldContinue: true, reasons: [...blockingReasons] };
			}
			return { shouldContinue: false };
		} catch (error) {
			if (isHookAbortError(error)) {
				throw error;
			}
			this._logService.error('[ToolCallingLoop] Error executing Stop hook', error);
			return { shouldContinue: false };
		}
	}

	protected showStopHookBlockedMessage(outputStream: ChatResponseStream | undefined, reasons: readonly string[]): void {
		if (outputStream) {
			if (reasons.length === 1) {
				outputStream.hookProgress('Stop', reasons[0]);
			} else {
				const formattedReasons = reasons.map((r, i) => `${i + 1}. ${r}`).join('\n');
				outputStream.hookProgress('Stop', formattedReasons);
			}
		}
		this._logService.trace(`[ToolCallingLoop] Stop hook blocked stopping: ${reasons.join('; ')}`);
	}

	private static readonly MAX_AUTOPILOT_RETRIES = 3;
	private static readonly MAX_AUTOPILOT_ITERATIONS = 3;
	private autopilotRetryCount = 0;
	private autopilotIterationCount = 0;

	private taskCompleted = false;
	private autopilotStopHookActive = false;
	private autopilotProgressDeferred: DeferredPromise<void> | undefined;
	private autopilotLastUserReason: string | undefined;
	private _recentToolCallSignatures: string[] = [];

	protected isAutonomousMode(): boolean {
		const permLevel = this.options.request.permissionLevel;
		return permLevel === 'autopilot' || permLevel === 'autoApprove';
	}

	protected detectToolCallOscillation(toolCalls: readonly any[]): boolean {
		if (!toolCalls || toolCalls.length === 0) {
			return false;
		}
		const sig = toolCalls.map(tc => `${tc.name}:${JSON.stringify(tc.arguments ?? tc.parameters ?? {})}`).sort().join('|');
		this._recentToolCallSignatures.push(sig);
		if (this._recentToolCallSignatures.length > 6) {
			this._recentToolCallSignatures.shift();
		}
		if (this._recentToolCallSignatures.length >= 3) {
			const lastThree = this._recentToolCallSignatures.slice(-3);
			if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
				return true;
			}
		}
		return false;
	}

	protected async shouldAutopilotContinue(result: IToolCallSingleResult, token: CancellationToken): Promise<string | undefined> {
		this.autopilotLastUserReason = undefined;

		const advancedAutopilotEnabled = this._configurationService.getNonExtensionConfig<boolean>('chat.autopilot.advanced.enabled') === true;

		if (advancedAutopilotEnabled) {
			return this.advancedAutopilotContinue(result, token);
		}

		if (this.taskCompleted) {
			this._logService.info('[ToolCallingLoop] Autonomous: task_complete was called, stopping');
			return undefined;
		}

		const calledTaskComplete = this.toolCallRounds.some(
			round => round.toolCalls.some(tc => tc.name === ToolCallingLoop.TASK_COMPLETE_TOOL_NAME)
		);
		if (calledTaskComplete) {
			this.taskCompleted = true;
			this._logService.info('[ToolCallingLoop] Autonomous: task_complete found in history, stopping');
			return undefined;
		}

		const hadToolCalls = this.toolCallRounds.some(round => round.toolCalls.length > 0);
		if (!hadToolCalls && result.round.toolCalls.length === 0 && result.round.response.trim().length > 0) {
			this._logService.info('[ToolCallingLoop] Autonomous: text-only response with no prior tools, treating as done');
			return undefined;
		}

		if (this.autopilotIterationCount >= ToolCallingLoop.MAX_AUTOPILOT_ITERATIONS) {
			this._logService.info(`[ToolCallingLoop] Autonomous: hit max iterations (${ToolCallingLoop.MAX_AUTOPILOT_ITERATIONS}), letting it stop`);
			return undefined;
		}

		if (this.autopilotStopHookActive && result.round.toolCalls.length === 0) {
			this._logService.info('[ToolCallingLoop] Autonomous: prior nudge produced no tool calls, stopping to avoid wasted requests');
			return undefined;
		}

		this.autopilotIterationCount++;
		return 'You have not yet marked the task as complete using the task_complete tool. ' +
			'You must call task_complete when done — whether the task involved code changes, answering a question, or any other interaction.\n\n' +
			'Do NOT repeat or restate your previous response. Pick up where you left off.\n\n' +
			'If you were planning, stop planning and start implementing. ' +
			'You are not done until you have fully completed the task.\n\n' +
			'IMPORTANT: Do NOT call task_complete if:\n' +
			'- You have open questions or ambiguities — make good decisions and keep working\n' +
			'- You encountered an error — try to resolve it or find an alternative approach\n' +
			'- There are remaining steps — complete them first\n\n' +
			'When you ARE done, first provide a brief text summary of what was accomplished, then call task_complete. ' +
			'Both the summary message and the tool call are required.\n\n' +
			'Keep working autonomously until the task is truly finished, then call task_complete.';
	}

	private async advancedAutopilotContinue(result: IToolCallSingleResult, token: CancellationToken): Promise<string | undefined> {
		// overall run is still bounded by the global tool-call limit.
		if (this.autopilotIterationCount >= ToolCallingLoop.MAX_AUTOPILOT_ITERATIONS) {
			this._logService.info(`[ToolCallingLoop] Advanced Autopilot: hit max consecutive iterations (${ToolCallingLoop.MAX_AUTOPILOT_ITERATIONS}), letting it stop`);
			return undefined;
		}

		const classifierResult = await this._runAutopilotGoalClassifier(result, token);
		if (classifierResult?.done) {
			this._logService.info(`[ToolCallingLoop] Advanced Autopilot classifier: complete — ${classifierResult.reason}`);
			return undefined;
		}
		if (classifierResult?.impossible) {
			this._logService.info(`[ToolCallingLoop] Advanced Autopilot classifier: impossible — ${classifierResult.reason}`);
			return undefined;
		}
		if (classifierResult) {
			this.autopilotIterationCount++;
			this._logService.info(`[ToolCallingLoop] Advanced Autopilot classifier: incomplete — ${classifierResult.reason}`);
			this.autopilotLastUserReason = classifierResult.reason;
			return 'The Advanced Autopilot evaluator determined that your original request is not yet complete.\n\n' +
				`Reason: ${classifierResult.reason}\n\n` +
				'Pick up where you left off and keep working autonomously until the original request is fully satisfied. ' +
				'Do NOT repeat or restate your previous response.';
		}

		if (this.autopilotStopHookActive && result.round.toolCalls.length === 0) {
			this._logService.info('[ToolCallingLoop] Advanced Autopilot: classifier unavailable and prior nudge produced no tool calls, stopping');
			return undefined;
		}
		this.autopilotIterationCount++;
		this._logService.warn('[ToolCallingLoop] Advanced Autopilot classifier returned no decision; falling back to a generic nudge');
		return 'Keep working autonomously until the original request is fully satisfied. ' +
			'Do NOT repeat or restate your previous response — pick up where you left off. ' +
			'If you were planning, stop planning and start implementing, and resolve any errors or remaining steps before you stop.';
	}

	private async _runAutopilotGoalClassifier(result: IToolCallSingleResult, token: CancellationToken): Promise<{ done: boolean; impossible?: boolean; reason: string } | undefined> {
		try {
			const endpoint = await this._endpointProvider.getChatEndpoint('dardcor-utility-small');
			const originalRequest = (this.options.request.prompt ?? '').trim();
			const transcript = this._buildAutopilotTranscript(result);

			const systemPrompt = [
				'You are an evaluator inside an autonomous coding agent loop.',
				'You are judging whether the user-provided request has been fully satisfied by the conversation transcript below.',
				'',
				'Your response must be exactly one line in one of these forms, with no other text:',
				'- YES <quote evidence from the transcript that satisfies the request>',
				'- NO <quote what is missing or what still blocks the request>',
				'- IMPOSSIBLE <explain why the request can never be satisfied>',
				'',
				'Always include a reason, quoting specific text from the transcript whenever possible.',
				'If the transcript does not contain clear evidence that the request is satisfied, reply "NO insufficient evidence in transcript".',
				'',
				'Only use IMPOSSIBLE when the request is genuinely unachievable in this session — for example: the request is self-contradictory, depends on a resource or capability that is unavailable, or the assistant has explicitly tried and exhausted reasonable approaches and stated it cannot be done.',
				'The assistant claiming completion is evidence, not proof — independently verify by looking for concrete actions (tool calls, file edits, test runs) in the transcript. When in doubt, reply NO without IMPOSSIBLE.',
			].join('\n');

			const userPrompt = `Original user request:\n${originalRequest || '(empty)'}\n\nConversation transcript:\n${transcript}\n\nHas the original request been fully completed?`;

			const messages: Raw.ChatMessage[] = [
				{ role: Raw.ChatRole.System, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: systemPrompt }] },
				{ role: Raw.ChatRole.User, content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: userPrompt }] },
			];

			const fetchResult = await endpoint.makeChatRequest(
				'autopilotGoalClassifier',
				messages,
				undefined,
				token,
				ChatLocation.Other,
				undefined,
				{ max_tokens: 500, temperature: 0 },
			);

			if (fetchResult.type !== ChatFetchResponseType.Success) {
				this._logService.warn(`[ToolCallingLoop] Autopilot goal classifier non-success response: ${fetchResult.type}`);
				return undefined;
			}

			const text = String(fetchResult.value ?? '').trim();
			const match = text.match(/^(YES|NO|IMPOSSIBLE)\b\s*[:.\-]?\s*([\s\S]*)$/i);
			if (!match) {
				this._logService.warn(`[ToolCallingLoop] Autopilot goal classifier unparseable response: ${text.slice(0, 200)}`);
				return undefined;
			}
			const verdict = match[1].toUpperCase();
			const done = verdict === 'YES';
			const impossible = verdict === 'IMPOSSIBLE';
			const reason = match[2].trim().replace(/\s+/g, ' ') ||
				(done ? 'Task complete' : impossible ? 'Task cannot be completed' : 'Task not yet complete');
			return { done, impossible, reason };
		} catch (e) {
			this._logService.warn(`[ToolCallingLoop] Autopilot goal classifier failed: ${e instanceof Error ? e.message : String(e)}`);
			return undefined;
		}
	}

	private _buildAutopilotTranscript(result: IToolCallSingleResult): string {
		const MAX_ARGS_PER_CALL = 200;
		const MAX_RESPONSE_PER_TURN = 800;
		const MAX_TOTAL = 8000;

		const truncate = (s: string, max: number): string =>
			s.length <= max ? s : s.slice(0, max) + `… (truncated ${s.length - max} chars)`;

		const formatRound = (round: IToolCallRound, index: number): string => {
			const toolCalls = round.toolCalls.length === 0
				? '(none)'
				: round.toolCalls
					.map(tc => `${tc.name}(${truncate(tc.arguments ?? '', MAX_ARGS_PER_CALL)})`)
					.join('; ');
			const response = truncate((round.response ?? '').trim() || '(empty)', MAX_RESPONSE_PER_TURN);
			return `Turn ${index + 1}:\n  Tool calls: ${toolCalls}\n  Assistant response: ${response}`;
		};

		const allRounds = [...this.toolCallRounds, result.round];
		const rendered = allRounds.map(formatRound).join('\n\n');
		if (rendered.length <= MAX_TOTAL) {
			return rendered;
		}
		return `… (earlier turns truncated)\n\n${rendered.slice(-MAX_TOTAL)}`;
	}

	private showAutopilotProgress(outputStream: ChatResponseStream | undefined, message: string, pastTenseMessage: string): void {
		this.resolveAutopilotProgress();
		const deferred = new DeferredPromise<void>();
		this.autopilotProgressDeferred = deferred;
		outputStream?.progress(message, async () => {
			await deferred.p;
			return pastTenseMessage;
		});
	}

	private resolveAutopilotProgress(): void {
		if (this.autopilotProgressDeferred) {
			this.autopilotProgressDeferred.complete(undefined);
			this.autopilotProgressDeferred = undefined;
		}
	}

	protected ensureAutopilotTools(availableTools: LanguageModelToolInformation[]): LanguageModelToolInformation[] {
		if (!this.isAutonomousMode()) {
			return availableTools;
		}
		if (availableTools.some(t => t.name === ToolCallingLoop.TASK_COMPLETE_TOOL_NAME)) {
			return availableTools;
		}
		const taskCompleteTool = this._instantiationService.invokeFunction(
			accessor => accessor.get(IToolsService).getTool(ToolCallingLoop.TASK_COMPLETE_TOOL_NAME)
		);
		if (taskCompleteTool) {
			this._logService.info('[ToolCallingLoop] Added task_complete tool for autonomous mode');
			return [...availableTools, taskCompleteTool];
		}
		this._logService.warn('[ToolCallingLoop] task_complete tool not found — autonomous completion may not work');
		return availableTools;
	}

	protected shouldAutoRetry(response: ChatResponse): boolean {
		const permLevel = this.options.request.permissionLevel;
		if (permLevel !== 'autoApprove' && permLevel !== 'autopilot') {
			return false;
		}
		if (this.autopilotRetryCount >= ToolCallingLoop.MAX_AUTOPILOT_RETRIES) {
			return false;
		}
		switch (response.type) {
			case ChatFetchResponseType.RateLimited:
			case ChatFetchResponseType.QuotaExceeded:
			case ChatFetchResponseType.Canceled:
			case ChatFetchResponseType.OffTopic:
				return false;
			default:
				return response.type !== ChatFetchResponseType.Success;
		}
	}

	protected async executeSessionStartHook(input: SessionStartHookInput, sessionId: string, outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<StartHookResult> {
		try {
			const results = await this._chatHookService.executeHook('SessionStart', this.options.request.hooks, input, sessionId, token);

			const additionalContexts: string[] = [];
			processHookResults({
				hookType: 'SessionStart',
				results,
				outputStream,
				logService: this._logService,
				onSuccess: (output) => {
					if (typeof output === 'object' && output !== null) {
						const hookOutput = output as SessionStartHookOutput;
						const additionalContext = hookOutput.hookSpecificOutput?.additionalContext;
						if (additionalContext) {
							additionalContexts.push(additionalContext);
							this._logService.trace(`[ToolCallingLoop] SessionStart hook provided context: ${additionalContext.substring(0, 100)}...`);
						}
					}
				},
				ignoreErrors: true,
			});

			return {
				additionalContext: additionalContexts.length > 0 ? additionalContexts.join('\n') : undefined
			};
		} catch (error) {
			if (isHookAbortError(error)) {
				throw error;
			}
			this._logService.error('[ToolCallingLoop] Error executing SessionStart hook', error);
			return {};
		}
	}

	protected async executeSubagentStartHook(input: SubagentStartHookInput, sessionId: string, outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<SubagentStartHookResult> {
		try {
			const results = await this._chatHookService.executeHook('SubagentStart', this.options.request.hooks, input, sessionId, token);

			const additionalContexts: string[] = [];
			processHookResults({
				hookType: 'SubagentStart',
				results,
				outputStream,
				logService: this._logService,
				onSuccess: (output) => {
					if (typeof output === 'object' && output !== null) {
						const hookOutput = output as SubagentStartHookOutput;
						const additionalContext = hookOutput.hookSpecificOutput?.additionalContext;
						if (additionalContext) {
							additionalContexts.push(additionalContext);
							this._logService.trace(`[ToolCallingLoop] SubagentStart hook provided context: ${additionalContext.substring(0, 100)}...`);
						}
					}
				},
				ignoreErrors: true,
			});

			return {
				additionalContext: additionalContexts.length > 0 ? additionalContexts.join('\n') : undefined
			};
		} catch (error) {
			if (isHookAbortError(error)) {
				throw error;
			}
			this._logService.error('[ToolCallingLoop] Error executing SubagentStart hook', error);
			return {};
		}
	}

	protected async executeSubagentStopHook(input: SubagentStopHookInput, sessionId: string, outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<SubagentStopHookResult> {
		try {
			const results = await this._chatHookService.executeHook('SubagentStop', this.options.request.hooks, input, sessionId, token);

			const blockingReasons = new Set<string>();
			processHookResults({
				hookType: 'SubagentStop',
				results,
				outputStream,
				logService: this._logService,
				onSuccess: (output) => {
					if (typeof output === 'object' && output !== null) {
						const hookOutput = output as SubagentStopHookOutput;
						const specific = hookOutput.hookSpecificOutput;
						this._logService.trace(`[ToolCallingLoop] Checking SubagentStop hook output: decision=${specific?.decision}, reason=${specific?.reason}`);
						if (specific?.decision === 'block' && specific.reason) {
							this._logService.trace(`[ToolCallingLoop] SubagentStop hook blocked: ${specific.reason}`);
							blockingReasons.add(specific.reason);
						}
					}
				},
				onError: (errorMessage) => {
					if (errorMessage) {
						this._logService.trace(`[ToolCallingLoop] SubagentStop hook error collected as blocking reason: ${errorMessage}`);
						blockingReasons.add(errorMessage);
					}
				},
			});

			if (blockingReasons.size > 0) {
				return { shouldContinue: true, reasons: [...blockingReasons] };
			}
			return { shouldContinue: false };
		} catch (error) {
			if (isHookAbortError(error)) {
				throw error;
			}
			this._logService.error('[ToolCallingLoop] Error executing SubagentStop hook', error);
			return { shouldContinue: false };
		}
	}

	protected showSubagentStopHookBlockedMessage(outputStream: ChatResponseStream | undefined, reasons: readonly string[]): void {
		if (outputStream) {
			if (reasons.length === 1) {
				outputStream.hookProgress('SubagentStop', reasons[0]);
			} else {
				const formattedReasons = reasons.map((r, i) => `${i + 1}. ${r}`).join('\n');
				outputStream.hookProgress('SubagentStop', formattedReasons);
			}
		}
		this._logService.trace(`[ToolCallingLoop] SubagentStop hook blocked stopping: ${reasons.join('; ')}`);
	}

	private throwIfCancelled(token: CancellationToken) {
		if (token.isCancellationRequested) {
			this.turn.setResponse(TurnStatus.Cancelled, undefined, undefined, CanceledResult);
			throw new CancellationError();
		}
	}

	public async runStartHooks(outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<void> {
		const sessionId = this.options.conversation.sessionId;
		const hasHooks = this.options.request.hasHooksEnabled;

		this._chatHookService.logConfiguredHooks(this.options.request.hooks);

		if (this.options.request.subAgentInvocationId) {
			const startHookResult = await this.executeSubagentStartHook({
				agent_id: this.options.request.subAgentInvocationId,
				agent_type: this.options.request.subAgentName ?? 'default',
			}, sessionId, outputStream, token);
			if (startHookResult.additionalContext) {
				this.additionalHookContext = startHookResult.additionalContext;
				this._logService.info(`[ToolCallingLoop] SubagentStart hook provided context for subagent ${this.options.request.subAgentInvocationId}`);
			}
		} else {
			const isFirstTurn = this.options.conversation.turns.length === 1;

			if (hasHooks) {
				const priorTurns = this.options.conversation.turns.slice(0, -1);
				const history: IHistoricalTurn[] = priorTurns.map(turn => ({
					userMessage: turn.request.message,
					timestamp: turn.startTime,
					rounds: turn.rounds.map(round => ({
						response: round.response,
						toolCalls: round.toolCalls.map(tc => ({
							name: tc.name,
							arguments: tc.arguments,
							id: tc.id,
						})),
						reasoningText: round.thinking
							? (Array.isArray(round.thinking.text) ? round.thinking.text.join('') : round.thinking.text)
							: undefined,
						timestamp: round.timestamp,
					})),
				}));

				await this._sessionTranscriptService.startSession(sessionId, undefined, history.length > 0 ? history : undefined);
			}

			if (isFirstTurn) {
				const startHookResult = await this.executeSessionStartHook({
					source: 'new',
					model: this.options.request.model?.id ?? 'unknown',
					agent_type: this.agentName,
				}, sessionId, outputStream, token);
				if (startHookResult.additionalContext) {
					this.additionalHookContext = startHookResult.additionalContext;
					this._logService.info('[ToolCallingLoop] SessionStart hook provided context for session');
				}
			}
		}

		this._sessionTranscriptService.logUserMessage(
			sessionId,
			this.turn.request.message,
		);
	}

	public async run(outputStream: ChatResponseStream | undefined, token: CancellationToken): Promise<IToolCallLoopResult> {
		const agentName = this.agentName ?? 'Dardcor AI Chat';

		const modeInstructions = (this.options.request as { modeInstructions2?: { name?: string; isBuiltin?: boolean } }).modeInstructions2;
		const customModeName = modeInstructions?.name && !modeInstructions.isBuiltin ? modeInstructions.name : undefined;
		const agentType: 'builtin' | 'custom' = modeInstructions && modeInstructions.isBuiltin === false ? 'custom' : 'builtin';

		const subAgentInvocationId = this.options.request.subAgentInvocationId;
		const parentRequestId = this.options.request.parentRequestId;
		const parentTraceContext = (subAgentInvocationId
			? this._otelService.getStoredTraceContext(`subagent:invocation:${subAgentInvocationId}`)
			: undefined)
			?? (() => {
				if (!parentRequestId) { return undefined; }
				const ctx = this._otelService.getStoredTraceContext(`subagent:request:${parentRequestId}`);
				if (ctx) { this._otelService.storeTraceContext(`subagent:request:${parentRequestId}`, ctx); }
				return ctx;
			})();

		const chatSessionId = getCurrentCapturingToken()?.chatSessionId;
		const parentChatSessionId = getCurrentCapturingToken()?.parentChatSessionId;
		const debugLogLabel = getCurrentCapturingToken()?.debugLogLabel;

		return this._otelService.startActiveSpan(
			`invoke_agent ${agentName}`,
			{
				kind: SpanKind.INTERNAL,
				attributes: {
					[GenAiAttr.OPERATION_NAME]: GenAiOperationName.INVOKE_AGENT,
					[GenAiAttr.PROVIDER_NAME]: GenAiProviderName.GITHUB,
					[GenAiAttr.AGENT_NAME]: agentName,
					[GenAiAttr.CONVERSATION_ID]: this.options.conversation.sessionId,
					[DardcorChatAttr.SESSION_ID]: this.options.conversation.sessionId,
					...(chatSessionId ? { [DardcorChatAttr.CHAT_SESSION_ID]: chatSessionId } : {}),
					...(parentChatSessionId ? { [DardcorChatAttr.PARENT_CHAT_SESSION_ID]: parentChatSessionId } : {}),
					...(debugLogLabel ? { [DardcorChatAttr.DEBUG_LOG_LABEL]: debugLogLabel } : {}),
					...(customModeName ? { [DardcorChatAttr.MODE_NAME]: customModeName } : {}),
					[DardcorAttr.AGENT_TYPE]: agentType,
					...workspaceMetadataToOTelAttributes(resolveWorkspaceOTelMetadata(this._gitService)),
				},
				parentTraceContext,
			},
			async (span) => {
				const otelStartTime = Date.now();

				if (chatSessionId) {
					const fileLogger = this._instantiationService.invokeFunction(accessor =>
						accessor.get(IChatDebugFileLoggerService));

					if (parentChatSessionId) {
						const childLabel = debugLogLabel ?? `runSubagent-${agentName}`;
						fileLogger.startChildSession(
							chatSessionId, parentChatSessionId, childLabel, parentTraceContext?.spanId);
						const invokeSpanId = span.getSpanContext()?.spanId;
						if (invokeSpanId) {
							fileLogger.registerSpanSession(invokeSpanId, chatSessionId);
						}
					} else {
						fileLogger.startSession(chatSessionId).catch(() => { });
					}
				}

				let requestModel: string | undefined;
				try {
					const endpoint = await this._endpointProvider.getChatEndpoint(this.options.request);
					requestModel = endpoint.model;
					span.setAttribute(GenAiAttr.REQUEST_MODEL, endpoint.model);
				} catch { }

				if (!parentTraceContext) {
					GenAiMetrics.incrementSessionCount(this._otelService);
					emitSessionStartEvent(this._otelService, this.options.conversation.sessionId, requestModel ?? 'unknown', agentName);
				}

				{
					const userMessage = this.turn.request.message;
					const maxLen = this._otelService.config.maxAttributeSizeChars;
					span.setAttribute(GenAiAttr.INPUT_MESSAGES, truncateForOTel(JSON.stringify([
						{ role: 'user', parts: [{ type: 'text', content: userMessage }] }
					]), maxLen));
					if (userMessage) {
						span.setAttribute(DardcorChatAttr.USER_REQUEST, truncateForOTel(userMessage, maxLen));
					}
					if (userMessage) {
						span.addEvent('user_message', { content: truncateForOTel(userMessage, maxLen), ...(chatSessionId ? { [DardcorChatAttr.CHAT_SESSION_ID]: chatSessionId } : {}) });
					}
				}

				let totalInputTokens = 0;
				let totalOutputTokens = 0;
				let totalCacheReadTokens = 0;
				let totalCacheCreationTokens = 0;
				let totalReasoningTokens = 0;
				let lastResolvedModel: string | undefined;
				let turnIndex = 0;
				const tokenListener = this.onDidReceiveResponse(({ response }) => {
					const turnInputTokens = response.type === ChatFetchResponseType.Success ? (response.usage?.prompt_tokens || 0) : 0;
					const turnOutputTokens = response.type === ChatFetchResponseType.Success ? (response.usage?.completion_tokens || 0) : 0;
					if (response.type === ChatFetchResponseType.Success && response.usage) {
						totalInputTokens += turnInputTokens;
						totalOutputTokens += turnOutputTokens;
						totalCacheReadTokens += (response.usage.prompt_tokens_details?.cached_tokens || 0);
						totalCacheCreationTokens += (response.usage.prompt_tokens_details?.cache_creation_input_tokens || 0);
						totalReasoningTokens += (response.usage.completion_tokens_details?.reasoning_tokens || 0);
					}
					if (response.type === ChatFetchResponseType.Success && response.resolvedModel) {
						lastResolvedModel = response.resolvedModel;
					}
					emitAgentTurnEvent(this._otelService, turnIndex, turnInputTokens, turnOutputTokens, 0);
					turnIndex++;
				});

				try {
					const result = await this._runLoop(outputStream, token, span, chatSessionId);
					span.setAttributes({
						[DardcorChatAttr.TURN_COUNT]: result.toolCallRounds.length,
						[GenAiAttr.USAGE_INPUT_TOKENS]: totalInputTokens,
						[GenAiAttr.USAGE_OUTPUT_TOKENS]: totalOutputTokens,
						...(totalCacheReadTokens ? { [GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]: totalCacheReadTokens } : {}),
						...(totalCacheCreationTokens ? { [GenAiAttr.USAGE_CACHE_CREATION_INPUT_TOKENS]: totalCacheCreationTokens } : {}),
						...(totalReasoningTokens ? { [GenAiAttr.USAGE_REASONING_OUTPUT_TOKENS]: totalReasoningTokens } : {}),
						...(lastResolvedModel ? { [GenAiAttr.RESPONSE_MODEL]: normalizeResponseModel(requestModel, lastResolvedModel) ?? lastResolvedModel } : {}),
					});
					{
						const lastRound = result.toolCallRounds.at(-1);
						if (lastRound?.response) {
							const responseText = Array.isArray(lastRound.response) ? lastRound.response.join('') : lastRound.response;
							span.setAttribute(GenAiAttr.OUTPUT_MESSAGES, truncateForOTel(JSON.stringify([
								{ role: 'assistant', parts: [{ type: 'text', content: responseText }] }
							])));
						}
						if (result.availableTools.length > 0) {
							const toolDefsJson = stringifyToolDefinitionsForOTel(result.availableTools);
							if (toolDefsJson) {
								span.setAttribute(GenAiAttr.TOOL_DEFINITIONS, truncateForOTel(toolDefsJson));
							}
						}
					}
					span.setStatus(SpanStatusCode.OK);

					const durationSec = (Date.now() - otelStartTime) / 1000;
					GenAiMetrics.recordAgentDuration(this._otelService, agentName, durationSec);
					GenAiMetrics.recordAgentTurnCount(this._otelService, agentName, result.toolCallRounds.length);

					return result;
				} catch (err) {
					span.setStatus(SpanStatusCode.ERROR, err instanceof Error ? err.message : String(err));
					span.setAttribute(StdAttr.ERROR_TYPE, err instanceof Error ? err.constructor.name : 'Error');
					throw err;
				} finally {
					tokenListener.dispose();
				}
			},
		);
	}

	private async _runLoop(outputStream: ChatResponseStream | undefined, token: CancellationToken, agentSpan?: ISpanHandle, chatSessionId?: string): Promise<IToolCallLoopResult> {
		let i = 0;
		let lastResult: IToolCallSingleResult | undefined;
		let lastRequestMessagesStartingIndexForRun: number | undefined;
		let stopHookActive = false;
		const sessionId = this.options.conversation.sessionId;

		this.agentSpan = agentSpan;
		this.chatSessionIdForTools = chatSessionId;
		this.toolsAvailableEmitted = false;

		while (true) {
			if (lastResult && i++ >= this.options.toolCallLimit) {
				if (this.isAutonomousMode()) {
					this.options.toolCallLimit = this.options.toolCallLimit + 50;
					this.showAutopilotProgress(outputStream, l10n.t('Autonomous: extending tool call limit\u2026'), l10n.t('Autonomous extended tool call limit'));
				} else {
					lastResult = this.hitToolCallLimit(outputStream, lastResult);
					break;
				}
			}

			if (lastResult && this.options.yieldRequested?.()) {
				if (!this.isAutonomousMode() || this.taskCompleted) {
					break;
				}
			}

			try {
				const turnId = String(i);
				this._sessionTranscriptService.logAssistantTurnStart(sessionId, turnId);
				agentSpan?.addEvent('turn_start', { turnId, ...(chatSessionId ? { [DardcorChatAttr.CHAT_SESSION_ID]: chatSessionId } : {}) });
				this.resolveAutopilotProgress();
				const result = await this.runOne(outputStream, i, token);
				if (lastRequestMessagesStartingIndexForRun === undefined) {
					lastRequestMessagesStartingIndexForRun = result.lastRequestMessages.length - 1;
				}
				lastResult = {
					...result,
					hadIgnoredFiles: lastResult?.hadIgnoredFiles || result.hadIgnoredFiles
				};

				this.toolCallRounds.push(result.round);
				this._sessionTranscriptService.logAssistantTurnEnd(sessionId, turnId);
				agentSpan?.addEvent('turn_end', { turnId, ...(chatSessionId ? { [DardcorChatAttr.CHAT_SESSION_ID]: chatSessionId } : {}) });

				if (this.detectToolCallOscillation(result.round.toolCalls)) {
					this._logService.warn('[ToolCallingLoop] Oscillation detected: repeated identical tool calls 3 times consecutively. Halting loop.');
					this.showAutopilotProgress(outputStream, l10n.t('Autonomous: halted due to repeating tool loop'), l10n.t('Autonomous loop halted (no progress)'));
					break;
				}

				if (this.autopilotStopHookActive && result.round.toolCalls.length && !result.round.toolCalls.some(tc => tc.name === ToolCallingLoop.TASK_COMPLETE_TOOL_NAME)) {
					this.autopilotStopHookActive = false;
					this.autopilotIterationCount = 0;
				}

				if (!result.round.toolCalls.length || result.response.type !== ChatFetchResponseType.Success) {
					if (token.isCancellationRequested) {
						break;
					}

					if (result.response.type !== ChatFetchResponseType.Success && this.shouldAutoRetry(result.response)) {
						this.autopilotRetryCount++;
						this._logService.info(`[ToolCallingLoop] Auto-retrying on error (attempt ${this.autopilotRetryCount}/${ToolCallingLoop.MAX_AUTOPILOT_RETRIES}): ${result.response.type}`);
						if (this.isAutonomousMode()) {
							this.showAutopilotProgress(outputStream, l10n.t('Autonomous: recovering from a request error\u2026'), l10n.t('Autonomous recovered from a request error'));
						} else {
							this.showAutopilotProgress(outputStream, l10n.t('Recovering from a request error\u2026'), l10n.t('Recovered from a request error'));
						}
						await timeout(1000, token);
						continue;
					}

					if (this.options.request.subAgentInvocationId) {
						const stopHookResult = await this.executeSubagentStopHook({
							agent_id: this.options.request.subAgentInvocationId,
							agent_type: this.options.request.subAgentName ?? 'default',
							stop_hook_active: stopHookActive,
						}, sessionId, outputStream, token);
						const joinedReasons = stopHookResult.reasons?.join('; ');
						this._logService.info(`[ToolCallingLoop] Subagent stop hook result: shouldContinue=${stopHookResult.shouldContinue}, reasons=${joinedReasons}`);
						if (stopHookResult.shouldContinue && stopHookResult.reasons?.length) {
							this.showSubagentStopHookBlockedMessage(outputStream, stopHookResult.reasons);
							this.stopHookReason = joinedReasons;
							result.round.hookContext = formatHookContext(stopHookResult.reasons);
							this._logService.info(`[ToolCallingLoop] Subagent stop hook blocked, continuing with reasons: ${joinedReasons}`);
							stopHookActive = true;
							continue;
						}
					} else {
						const stopHookResult = await this.executeStopHook({ stop_hook_active: stopHookActive }, sessionId, outputStream, token);
						const joinedReasons = stopHookResult.reasons?.join('; ');
						this._logService.info(`[ToolCallingLoop] Stop hook result: shouldContinue=${stopHookResult.shouldContinue}, reasons=${joinedReasons}`);
						if (stopHookResult.shouldContinue && stopHookResult.reasons?.length) {
							this.showStopHookBlockedMessage(outputStream, stopHookResult.reasons);
							this.stopHookReason = joinedReasons;
							result.round.hookContext = formatHookContext(stopHookResult.reasons);
							this._logService.info(`[ToolCallingLoop] Stop hook blocked, continuing with reasons: ${joinedReasons}`);
							stopHookActive = true;
							this.stopHookUserInitiated = true;
							continue;
						}
					}

					if (this.isAutonomousMode() && result.response.type === ChatFetchResponseType.Success) {
						const autopilotContinue = await this.shouldAutopilotContinue(result, token);
						if (autopilotContinue) {
							this._logService.info(`[ToolCallingLoop] Autonomous internal stop hook: continuing because task may not be complete`);
							const userReason = this.autopilotLastUserReason;
							const spinnerMessage = userReason
								? l10n.t('Autonomous: continuing — {0}', userReason)
								: l10n.t('Autonomous: verifying task is done\u2026');
							const spinnerPastTense = userReason
								? l10n.t('Autonomous continued: {0}', userReason)
								: l10n.t('Autonomous continued working');
							this.showAutopilotProgress(outputStream, spinnerMessage, spinnerPastTense);
							this.stopHookReason = autopilotContinue;
							result.round.hookContext = formatHookContext([autopilotContinue]);
							this.autopilotStopHookActive = true;
							continue;
						}
					}

					break;
				}
			} catch (e) {
				if (isCancellationError(e) && lastResult) {
					break;
				}

				throw e;
			}
		}

		this.resolveAutopilotProgress();

		this.emitReadFileTrajectories().catch(err => {
			this._logService.error('Error emitting read file trajectories', err);
		});

		const toolCallRoundsToDisplay = lastResult.lastRequestMessages.slice(lastRequestMessagesStartingIndexForRun ?? 0).filter((m): m is Raw.ToolChatMessage => m.role === Raw.ChatRole.Tool);
		for (const toolRound of toolCallRoundsToDisplay) {
			const result = this.toolCallResults[toolRound.toolCallId];
			if (result instanceof LanguageModelToolResult2) {
				for (const part of result.content) {
					if (part instanceof LanguageModelDataPart2 && part.mimeType === 'application/pull-request+json' && part.audience?.includes(LanguageModelPartAudience.User)) {
						const data: { uri: string; title: string; description: string; author: string; linkTag: string } = JSON.parse(part.data.toString());
						outputStream?.push(new ChatResponsePullRequestPart({ command: 'github.dardcor.chat.openPullRequestReroute', title: l10n.t('View Pull Request {0}', data.linkTag), arguments: [Number(data.linkTag.substring(1))] }, data.title, data.description, data.author, data.linkTag));
					}
				}
			}
		}
		return { ...lastResult, toolCallRounds: this.toolCallRounds, toolCallResults: this.toolCallResults };
	}

	private async emitReadFileTrajectories() {

		function tryGetRFArgs(call: IToolCall): ReadFileParams | undefined {
			if (call.name !== ToolName.ReadFile) {
				return undefined;
			}
			try {
				return JSON.parse(call.arguments);
			} catch {
				return undefined;
			}
		}

		const consumed = new Set<string>();
		const tcrs = this.toolCallRounds;
		for (let i = 0; i < tcrs.length; i++) {
			const { toolCalls } = tcrs[i];
			for (const call of toolCalls) {
				if (consumed.has(call.id)) {
					continue;
				}
				const args = tryGetRFArgs(call);
				if (!args) {
					continue;
				}

				const seqArgs = [args];
				consumed.add(call.id);

				for (let k = i + 1; k < tcrs.length; k++) {
					for (const call2 of tcrs[k].toolCalls) {
						if (consumed.has(call2.id)) {
							continue;
						}

						const args2 = tryGetRFArgs(call2);
						if (!args2 || args2.filePath !== args.filePath) {
							continue;
						}

						consumed.add(call2.id);
						seqArgs.push(args2);
					}
				}

				let chunkSizeTotal = 0;
				let chunkSizeNo = 0;
				for (const arg of seqArgs) {
					if ('startLine' in arg) {
						chunkSizeNo++;
						chunkSizeTotal += arg.endLine - arg.startLine + 1;
					} else if (arg.limit) {
						chunkSizeNo++;
						chunkSizeTotal += arg.limit;
					}
				}

				this._telemetryService.sendMSFTTelemetryEvent('readFileTrajectory',
					{
						model: this.options.request.model?.id,
					},
					{
						rounds: seqArgs.length,
						avgChunkSize: chunkSizeNo > 0 ? Math.round(chunkSizeTotal / chunkSizeNo) : -1,
					}
				);
			}
		}
	}

	private hitToolCallLimit(stream: ChatResponseStream | undefined, lastResult: IToolCallSingleResult) {
		if (stream && this.options.onHitToolCallLimit === ToolCallLimitBehavior.Confirm) {
			const messageString = new MarkdownString(l10n.t({
				message: 'Dardcor AI has been working on this problem for a while. It can continue to iterate, or you can send a new message to refine your prompt. [Configure max requests]({0}).',
				args: [`command:workbench.action.openSettings?${encodeURIComponent('["chat.agent.maxRequests"]')}`],
				comment: 'Link to workbench settings for chat.maxRequests, which controls the maximum number of requests Dardcor AI will make before stopping. This is used in the tool calling loop to determine when to stop iterating on a problem.'
			}));
			messageString.isTrusted = { enabledCommands: ['workbench.action.openSettings'] };

			stream.confirmation(
				l10n.t('Continue to iterate?'),
				messageString,
				{ dardcorRequestedRoundLimit: Math.round(this.options.toolCallLimit * 3 / 2) } satisfies IToolCallIterationIncrease,
				[
					l10n.t('Continue'),
					cancelText(),
				]
			);
		}

		lastResult.chatResult = {
			...lastResult.chatResult,
			metadata: {
				...lastResult.chatResult?.metadata,
				maxToolCallsExceeded: true
			} satisfies Partial<IResultMetadata>,
		};

		return lastResult;
	}

	public async runOne(outputStream: ChatResponseStream | undefined, iterationNumber: number, token: CancellationToken): Promise<IToolCallSingleResult> {
		if (iterationNumber === 0) {
			this._accumulatedCopilotCredits = undefined;
		}
		let availableTools = await this.getAvailableTools(outputStream, token);

		if (!this.toolsAvailableEmitted && this.agentSpan && availableTools.length > 0) {
			this.toolsAvailableEmitted = true;
			const toolDefsJson = stringifyToolDefinitionsForOTel(availableTools);
			if (toolDefsJson) {
				this.agentSpan.addEvent('tools_available', {
					toolDefinitions: truncateForOTel(toolDefsJson),
					...(this.chatSessionIdForTools ? { [DardcorChatAttr.CHAT_SESSION_ID]: this.chatSessionIdForTools } : {}),
				});
			}
		}

		const context = this.createPromptContext(availableTools, outputStream);
		const isContinuation = context.isContinuation || false;
		markChatExt(this.options.conversation.sessionId, ChatExtPerfMark.WillBuildPrompt);
		let buildPromptResult: IBuildPromptResult;
		const keepAliveEndpoint = await this._endpointProvider.getChatEndpoint(this.options.request);
		const keepAlive = this.startBuildPromptKeepAlive(token, keepAliveEndpoint);
		try {
			buildPromptResult = await this.buildPrompt2(context, outputStream, token);
		} finally {
			keepAlive.dispose();
			markChatExt(this.options.conversation.sessionId, ChatExtPerfMark.DidBuildPrompt);
		}
		this.throwIfCancelled(token);
		this.turn.addReferences(buildPromptResult.references);
		availableTools = await this.getAvailableTools(outputStream, token);

		const promptOverride = this._configurationService.getConfig(ConfigKey.Advanced.DebugPromptOverrideString);
		const promptOverrideFile = this._configurationService.getConfig(ConfigKey.Advanced.DebugPromptOverrideFile);
		let effectiveBuildPromptResult: IBuildPromptResult = buildPromptResult;
		if (promptOverride || promptOverrideFile) {
			const overrideResult = await applyConfiguredPromptOverrides(
				promptOverride,
				promptOverrideFile,
				buildPromptResult.messages,
				availableTools,
				this._fileSystemService,
				this._logService,
			);
			effectiveBuildPromptResult = { ...buildPromptResult, messages: overrideResult.messages };
			availableTools = overrideResult.tools;
		}

		availableTools = this.ensureAutopilotTools(availableTools);

		const isToolInputFailure = effectiveBuildPromptResult.metadata.get(ToolFailureEncountered);
		const conversationSummary = effectiveBuildPromptResult.metadata.get(SummarizedConversationHistoryMetadata);
		if (conversationSummary) {
			this.turn.setMetadata(conversationSummary);
		}

		let summarizedAtRoundId: string | undefined;
		for (let i = this.toolCallRounds.length - 1; i >= 0; i--) {
			if (this.toolCallRounds[i].summary) {
				summarizedAtRoundId = this.toolCallRounds[i].id;
				break;
			}
		}
		if (!summarizedAtRoundId) {
			for (const turn of [...context.history].reverse()) {
				for (const round of [...turn.rounds].reverse()) {
					if (round.summary) {
						summarizedAtRoundId = round.id;
						break;
					}
				}
				if (summarizedAtRoundId) {
					break;
				}
			}
		}

		const endpoint = await this._endpointProvider.getChatEndpoint(this.options.request);
		const tokenizer = endpoint.acquireTokenizer();
		const promptTokenLength = await tokenizer.countMessagesTokens(effectiveBuildPromptResult.messages);
		const toolTokenCount = availableTools.length > 0 ? await tokenizer.countToolTokens(availableTools) : 0;
		this.throwIfCancelled(token);
		this._onDidBuildPrompt.fire({ result: effectiveBuildPromptResult, tools: availableTools, promptTokenLength, toolTokenCount });
		this._logService.trace('Built prompt');

		if (iterationNumber > 0 && this.options.yieldRequested?.()) {
			throw new CancellationError();
		}

		const interactionOutcomeComputer = new InteractionOutcomeComputer(this.options.interactionContext);

		const that = this;
		const responseProcessor = new class implements IResponseProcessor {

			private readonly context = new ResponseProcessorContext(that.options.conversation.sessionId, that.turn, effectiveBuildPromptResult.messages, interactionOutcomeComputer);

			async processResponse(_context: unknown, inputStream: AsyncIterable<IResponsePart>, responseStream: ChatResponseStream, token: CancellationToken): Promise<ChatResult | void> {
				let chatResult: ChatResult | void = undefined;
				if (that.options.responseProcessor) {
					chatResult = await that.options.responseProcessor.processResponse(this.context, inputStream, responseStream, token);
				} else {
					const subagentInvocationId = getSubAgentInvocationId(context);
					const responseProcessor = that._instantiationService.createInstance(PseudoStopStartResponseProcessor, [], undefined, { subagentInvocationId });
					await responseProcessor.processResponse(this.context, inputStream, responseStream, token);
				}
				return chatResult;
			}
		}();

		this._logService.trace('Sending prompt to model');

		const streamParticipants = outputStream ? [outputStream] : [];
		let fetchStreamSource: FetchStreamSource | undefined;
		let processResponsePromise: Promise<ChatResult | void> | undefined;
		let stopEarly = false;
		if (outputStream) {
			this.options.streamParticipants?.forEach(fn => {
				streamParticipants.push(fn(streamParticipants[streamParticipants.length - 1]));
			});
			const stream = streamParticipants[streamParticipants.length - 1];

			fetchStreamSource = new FetchStreamSource();
			processResponsePromise = responseProcessor.processResponse(undefined, fetchStreamSource.stream, stream, token);

			processResponsePromise.finally(() => {
				stopEarly = true;
			});
		}

		if (effectiveBuildPromptResult.messages.length === 0) {
			fetchStreamSource?.resolve();
			await processResponsePromise;
			await finalizeStreams(streamParticipants);
			throw new EmptyPromptError();
		}

		const promptContextTools = availableTools.length ? availableTools.map(toolInfo => {
			return {
				name: toolInfo.name,
				description: toolInfo.description,
				parameters: toolInfo.inputSchema,
			} satisfies OpenAiFunctionDef;
		}) : undefined;

		let statefulMarker: string | undefined;
		const toolCalls: IToolCall[] = [];
		let thinkingItem: ThinkingDataItem | undefined;
		const shouldDisableThinking = isContinuation && isAnthropicFamily(endpoint) && !ToolCallingLoop.messagesContainThinking(effectiveBuildPromptResult.messages);
		const enableThinking = !shouldDisableThinking;
		let phase: string | undefined;
		let compaction: OpenAIContextManagementResponse | undefined;
		markChatExt(this.options.conversation.sessionId, ChatExtPerfMark.WillFetch);
		const fetchOptions: ToolCallingLoopFetchOptions = {
			messages: this.applyMessagePostProcessing(effectiveBuildPromptResult.messages, { stripOrphanedToolCalls: isGeminiFamily(endpoint) }),
			turnId: this.options.request.id,
			topLevelTurnId: this.options.request.parentRequestId ?? this.turn.id,
			summarizedAtRoundId,
			finishedCb: async (text, index, delta) => {
				fetchStreamSource?.update(text, delta);
				if (delta.dardcorToolCalls) {
					toolCalls.push(...delta.dardcorToolCalls.map((call): IToolCall => ({
						...call,
						id: this.createInternalToolCallId(call.id),
						arguments: call.arguments === '' ? '{}' : call.arguments
					})));
				}
				if (delta.statefulMarker) {
					statefulMarker = delta.statefulMarker;
				}
				if (delta.thinking) {
					thinkingItem = ThinkingDataItem.createOrUpdate(thinkingItem, delta.thinking);
				}
				if (delta.phase) {
					phase = delta.phase;
				}
				if (delta.contextManagement && isOpenAIContextManagementResponse(delta.contextManagement)) {
					compaction = delta.contextManagement;
				}
				return stopEarly ? text.length : undefined;
			},
			requestOptions: {
				tools: promptContextTools?.map(tool => ({
					function: {
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters && Object.keys(tool.parameters).length ? tool.parameters : undefined
					},
					type: 'function',
				})),
			},
			userInitiatedRequest: (iterationNumber === 0 && !isContinuation && !this.options.request.subAgentInvocationId && !this.options.request.isSystemInitiated) || this.stopHookUserInitiated,
			iterationNumber,
			modelCapabilities: {
				enableThinking,
			},
		};
		const fetchResult = await this.fetch(fetchOptions, token).finally(() => {
			this.stopHookUserInitiated = false;
		});
		markChatExt(this.options.conversation.sessionId, ChatExtPerfMark.DidFetch);

		if (fetchResult.type === ChatFetchResponseType.Success) {
			this.lastHeaderRequestId = fetchResult.serverRequestId || fetchResult.requestId;
			this.lastModelCallId = fetchResult.modelCallId;
		}

		this.lastFetchOptions = fetchOptions;

		const promptTokenDetails = await computePromptTokenDetails({
			messages: effectiveBuildPromptResult.messages,
			tokenizer,
			tools: availableTools,
		});
		fetchStreamSource?.resolve();
		const chatResult = await processResponsePromise ?? undefined;

		const stream = streamParticipants[streamParticipants.length - 1];
		if (fetchResult.type === ChatFetchResponseType.Success && fetchResult.usage && stream) {
			const callCredits = nanoAiuToCredits(fetchResult.usage.dardcor_usage?.total_nano_aiu);
			if (callCredits !== undefined) {
				this._accumulatedCopilotCredits = (this._accumulatedCopilotCredits ?? 0) + callCredits;
			}
			if (this.shouldReportUsageToContextWidget()) {
				stream.usage({
					completionTokens: fetchResult.usage.completion_tokens,
					promptTokens: fetchResult.usage.prompt_tokens,
					outputBuffer: endpoint.maxOutputTokens,
					copilotCredits: this._accumulatedCopilotCredits,
					dardcorCredits: this._accumulatedCopilotCredits,
					promptTokenDetails,
				});
			} else if (this._accumulatedCopilotCredits !== undefined) {
				stream.usage({
					completionTokens: 0,
					promptTokens: 0,
					copilotCredits: this._accumulatedCopilotCredits,
					dardcorCredits: this._accumulatedCopilotCredits,
				});
			}
		}

		if (
			outputStream &&
			toolCalls.some(tc => tc.name === ToolName.Codebase) &&
			await this._authenticationChatUpgradeService.shouldRequestPermissiveSessionUpgrade()
		) {
			this._authenticationChatUpgradeService.showPermissiveSessionUpgradeInChat(outputStream, this.options.request);
			throw new ToolCallCancelledError(new CancellationError());
		}

		await finalizeStreams(streamParticipants);
		this._onDidReceiveResponse.fire({ interactionOutcome: interactionOutcomeComputer, response: fetchResult, toolCalls });

		this.turn.setMetadata(interactionOutcomeComputer.interactionOutcome);

		const toolInputRetry = isToolInputFailure ? (this.toolCallRounds.at(-1)?.toolInputRetry || 0) + 1 : 0;
		if (fetchResult.type === ChatFetchResponseType.Success) {
			if (fetchResult.usage) {
				this.turn.setMetadata(new TurnTokenUsageMetadata(
					fetchResult.usage.prompt_tokens,
					fetchResult.usage.completion_tokens
				));
			}

			thinkingItem?.updateWithFetchResult(fetchResult);

			const transcriptToolRequests: ToolRequest[] = toolCalls.map(tc => ({
				toolCallId: tc.id,
				name: tc.name,
				arguments: tc.arguments,
				type: 'function' as const,
			}));
			this._sessionTranscriptService.logAssistantMessage(
				this.options.conversation.sessionId,
				fetchResult.value,
				transcriptToolRequests,
				thinkingItem ? (Array.isArray(thinkingItem.text) ? thinkingItem.text.join('') : thinkingItem.text) : undefined,
			);

			return {
				response: fetchResult,
				round: ToolCallRound.create({
					response: fetchResult.value,
					toolCalls,
					toolInputRetry,
					statefulMarker,
					statefulMarkerSummarizedAtRoundId: statefulMarker && endpoint.isExtensionContributed ? summarizedAtRoundId : undefined,
					thinking: thinkingItem,
					phase,
					modelId: endpoint.model,
					compaction,
				}),
				chatResult,
				hadIgnoredFiles: buildPromptResult.hasIgnoredFiles,
				lastRequestMessages: effectiveBuildPromptResult.messages,
				availableTools,
			};
		}

		return {
			response: fetchResult,
			hadIgnoredFiles: buildPromptResult.hasIgnoredFiles,
			lastRequestMessages: effectiveBuildPromptResult.messages,
			availableTools,
			round: new ToolCallRound('', toolCalls, toolInputRetry),
		};
	}

	private createInternalToolCallId(toolCallId: string): string {
		return toolCallId + `__vscode-${ToolCallingLoop.NextToolCallId++}`;
	}

	private applyMessagePostProcessing(messages: Raw.ChatMessage[], options?: { stripOrphanedToolCalls?: boolean }): Raw.ChatMessage[] {
		return this.validateToolMessages(
			ToolCallingLoop.stripInternalToolCallIds(messages), options);
	}

	public static stripInternalToolCallIds(messages: Raw.ChatMessage[]): Raw.ChatMessage[] {
		return messages.map(m => {
			if (m.role === Raw.ChatRole.Assistant) {
				return {
					...m,
					toolCalls: m.toolCalls?.map(tc => ({
						...tc,
						id: tc.id.split('__vscode-')[0]
					}))
				};
			} else if (m.role === Raw.ChatRole.Tool) {
				return {
					...m,
					toolCallId: m.toolCallId?.split('__vscode-')[0]
				};
			}

			return m;
		});
	}

	public static messagesContainThinking(messages: Raw.ChatMessage[]): boolean {
		let lastUserMessageIndex = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === Raw.ChatRole.User) {
				lastUserMessageIndex = i;
				break;
			}
		}

		if (lastUserMessageIndex === -1) {
			return false;
		}

		for (let i = lastUserMessageIndex + 1; i < messages.length; i++) {
			const m = messages[i];
			if (m.role !== Raw.ChatRole.Assistant) {
				continue;
			}
			return Array.isArray(m.content) && m.content.some(part =>
				part.type === Raw.ChatCompletionContentPartKind.Opaque && rawPartAsThinkingData(part) !== undefined
			);
		}
		return false;
	}

	public static validateToolMessagesCore(messages: Raw.ChatMessage[], options?: { stripOrphanedToolCalls?: boolean }): { messages: Raw.ChatMessage[]; filterReasons: string[]; strippedToolCallCount: number } {
		const filterReasons: string[] = [];
		let strippedToolCallCount = 0;
		let previousAssistantMessage: Raw.AssistantChatMessage | undefined;
		const filtered = messages.filter(m => {
			if (m.role === Raw.ChatRole.Assistant) {
				previousAssistantMessage = m;
			} else if (m.role === Raw.ChatRole.Tool) {
				if (!previousAssistantMessage) {
					filterReasons.push('noPreviousAssistantMessage');
					return false;
				}

				if (!previousAssistantMessage.toolCalls?.length) {
					filterReasons.push('noToolCalls');
					return false;
				}

				const toolCall = previousAssistantMessage.toolCalls.find(tc => tc.id === m.toolCallId);
				if (!toolCall) {
					return false;
				}
			}

			return true;
		});

		if (!options?.stripOrphanedToolCalls) {
			return { messages: filtered, filterReasons, strippedToolCallCount };
		}

		for (let i = 0; i < filtered.length; i++) {
			const m = filtered[i];
			if (m.role !== Raw.ChatRole.Assistant || !m.toolCalls?.length) {
				continue;
			}

			const toolResultIds = new Set<string>();
			for (let j = i + 1; j < filtered.length; j++) {
				const next = filtered[j];
				if (next.role === Raw.ChatRole.Assistant) {
					break;
				}
				if (next.role === Raw.ChatRole.Tool && next.toolCallId !== undefined) {
					toolResultIds.add(next.toolCallId);
				}
			}

			const orphanedToolCalls = m.toolCalls.filter(tc => !toolResultIds.has(tc.id));
			if (orphanedToolCalls.length > 0) {
				strippedToolCallCount += orphanedToolCalls.length;
				const validToolCalls = m.toolCalls.filter(tc => toolResultIds.has(tc.id));
				(m as Mutable<Raw.AssistantChatMessage>).toolCalls = validToolCalls.length > 0 ? validToolCalls : undefined;
			}
		}

		return { messages: filtered, filterReasons, strippedToolCallCount };
	}

	private validateToolMessages(messages: Raw.ChatMessage[], options?: { stripOrphanedToolCalls?: boolean }): Raw.ChatMessage[] {
		const { messages: filtered, filterReasons, strippedToolCallCount } = ToolCallingLoop.validateToolMessagesCore(messages, options);

		if (filterReasons.length || strippedToolCallCount > 0) {
			const allReasons = strippedToolCallCount > 0 ? [...filterReasons, `orphanedToolCalls:${strippedToolCallCount}`] : filterReasons;
			const filterReasonsStr = allReasons.join(', ');
			this._logService.warn('Filtered invalid tool messages: ' + filterReasonsStr);
			this._telemetryService.sendMSFTTelemetryEvent('toolCalling.invalidToolMessages', {
				filterReasons: filterReasonsStr,
			}, {
				filterCount: filterReasons.length,
				strippedToolCallCount,
			});
		}

		return filtered;
	}

	private startBuildPromptKeepAlive(parentToken: CancellationToken, endpoint: IChatEndpoint): IDisposable {
		if (!isAnthropicFamily(endpoint)) {
			return Disposable.None;
		}

		if (!this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.LongToolCallCachePreservation, this._experimentationService)) {
			return Disposable.None;
		}

		const baseFetchOptions = this.lastFetchOptions;
		if (!baseFetchOptions || baseFetchOptions.messages.length === 0) {
			return Disposable.None;
		}

		const latestRound = this.toolCallRounds[this.toolCallRounds.length - 1];
		const hasExecutionSubagent = latestRound?.toolCalls.some(tc => tc.name === ToolName.ExecutionSubagent) ?? false;
		if (!hasExecutionSubagent) {
			return Disposable.None;
		}

		const maxProbes = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.LongToolCallCachePreservationMaxProbes, this._experimentationService);
		const inFlight = new Set<CancellationTokenSource>();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let disposed = false;
		let probeCount = 0;

		const probe = async () => {
			if (disposed || parentToken.isCancellationRequested) {
				return;
			}
			if (probeCount >= maxProbes) {
				this._logService.info(`[ToolCallingLoop] Keep-alive: max probes reached (${probeCount}), stopping`);
				return;
			}
			probeCount++;

			const cts = new CancellationTokenSource(parentToken);
			inFlight.add(cts);

			const processedMessages = baseFetchOptions.messages;
			const lastMessage = processedMessages[processedMessages.length - 1];
			const probeMessages: Raw.ChatMessage[] = lastMessage.role === Raw.ChatRole.Assistant
				? [
					...processedMessages,
					{
						role: Raw.ChatRole.User,
						content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: 'Still working' }],
					},
				]
				: [...processedMessages];

			this._logService.info(`[ToolCallingLoop] Keep-alive: sending probe ${probeCount}/${maxProbes}`);
			try {
				await this.fetch({
					...baseFetchOptions,
					messages: probeMessages,
					finishedCb: async () => 1,
					userInitiatedRequest: false,
					isKeepAliveProbe: true,
				}, cts.token);
			} catch (err) {
				if (!isCancellationError(err)) {
					this._logService.warn(`[ToolCallingLoop] Keep-alive probe failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			} finally {
				inFlight.delete(cts);
				cts.dispose();
			}

			if (!disposed && !parentToken.isCancellationRequested) {
				schedule();
			}
		};

		const schedule = () => {
			timer = setTimeout(probe, ToolCallingLoop.KEEP_ALIVE_INTERVAL_MS);
		};

		schedule();

		return {
			dispose: () => {
				disposed = true;
				if (timer) {
					clearTimeout(timer);
					timer = undefined;
				}
				for (const cts of inFlight) {
					cts.cancel();
					cts.dispose();
				}
				inFlight.clear();
			},
		};
	}

	private async buildPrompt2(buildPromptContext: IBuildPromptContext, stream: ChatResponseStream | undefined, token: CancellationToken): Promise<IBuildPromptResult> {
		const progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart> = {
			report(obj) {
				stream?.push(obj);
			}
		};

		const buildPromptResult = await this.buildPrompt(buildPromptContext, progress, token);
		for (const metadata of buildPromptResult.metadata.getAll(ToolResultMetadata)) {
			this.logToolResult(buildPromptContext, metadata);
			this.toolCallResults[metadata.toolCallId] = metadata.result;
		}

		if (buildPromptResult.metadata.getAll(ToolResultMetadata).some(r => r.isCancelled)) {
			throw new CancellationError();
		}

		return buildPromptResult;
	}


	private logToolResult(buildPromptContext: IBuildPromptContext, metadata: ToolResultMetadata) {
		if (this.toolCallResults[metadata.toolCallId]) {
			return;
		}

		const lastTurn = this.toolCallRounds.at(-1);
		let originalCall = lastTurn?.toolCalls.find(tc => tc.id === metadata.toolCallId);
		if (!originalCall) {
			const byRef = buildPromptContext.tools?.toolReferences.find(r => r.id === metadata.toolCallId);
			if (byRef) {
				originalCall = { id: byRef.id, arguments: JSON.stringify(byRef.input), name: byRef.name };
			}
		}

		if (originalCall) {
			this._requestLogger.logToolCall(originalCall.id || generateUuid(), originalCall.name, originalCall.arguments, metadata.result, lastTurn?.thinking);
		}
	}
}

async function finalizeStreams(streams: readonly ChatResponseStream[]) {
	for (const stream of streams) {
		await tryFinalizeResponseStream(stream);
	}
}

export class EmptyPromptError extends Error {
	constructor() {
		super('Empty prompt');
	}
}

export interface IToolCallSingleResult {
	response: ChatResponse;
	round: IToolCallRound;
	chatResult?: ChatResult;
	hadIgnoredFiles: boolean;
	lastRequestMessages: Raw.ChatMessage[];
	availableTools: readonly LanguageModelToolInformation[];
}

export interface IToolCallLoopResult extends IToolCallSingleResult {
	toolCallRounds: IToolCallRound[];
	toolCallResults: Record<string, LanguageModelToolResult2>;
}
