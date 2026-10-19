/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, ChatParticipantToolToken, Uri } from 'vscode';
import { IEndpointProvider } from '../../../../../lib/node/chatLibMain';
import { ILogger, ILogService } from '../../../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../../../platform/networking/common/networking';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry';
import { LazyStatefulPromise, Queue } from '../../../../../util/dardcor/base/common/async';
import { Disposable, MutableDisposable } from '../../../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { IBuildPromptContext } from '../../../../prompt/common/intents';
import { ITodoListContextProvider } from '../../../../prompt/node/todoListContextProvider';
import { ToolName } from '../../../../tools/common/toolNames';
import { normalizeToolSchema } from '../../../../tools/common/toolSchemaNormalizer';
import { IToolsService } from '../../../../tools/common/toolsService';
import { BackgroundTodoAgentSessionHistoryStore, ReadOnlyTurnHistory } from './backgroundTodoAgentSessionHistoryStore';
import { ChatFetchResponseType, ChatLocation } from '../../../../../platform/chat/common/commonTypes';
import { renderPromptElement } from '../../base/promptRenderer';
import { BackgroundTodoPrompt } from './backgroundTodoAgentPrompt';
import { CancellationTokenSource } from '../../../../../util/dardcor/base/common/cancellation';

export interface IBackgroundTodoPolicyInput {
	readonly backgroundTodoAgentEnabled: boolean;
	readonly todoToolExplicitlyEnabled: boolean;
	readonly isAgentPrompt: boolean;
	readonly promptContext: IBuildPromptContext;
	readonly turnId?: string;
	readonly todoListExists?: boolean;
}


const enum BackgroundTodoAgentProcessorState {
	Idle = 'Idle',
	InProgress = 'InProgress',
}

type ToolCall = { name: string; arguments: string; id: string };

export class BackgroundTodoAgentProcessor extends Disposable {
	private readonly sessionHistoryStore = this._register(new BackgroundTodoAgentSessionHistoryStore());
	private readonly queue = this._register(new Queue());
	private readonly backOffTracker = new BackOffTracker();
	private readonly logger: ILogger;

	private state = BackgroundTodoAgentProcessorState.Idle;

	private readonly _cts = this._register(new MutableDisposable<CancellationTokenSource>());
	private get cts(): CancellationTokenSource {
		return this._cts.value!;
	}

	private oldTurnTodos: string | undefined = undefined;

	private currentTurnId: string | undefined;
	private currentUserRequest: string | undefined;

	constructor(
		private readonly sessionId: string,
		private readonly sessionResource: string | undefined,
		private readonly toolsService: IToolsService,
		private readonly telemetryService: ITelemetryService,
		private readonly instantiationService: IInstantiationService,
		logService: ILogService
	) {
		super();
		this._cts.value = new CancellationTokenSource();
		this.currentTurnId = undefined;
		this.logger = logService.createSubLogger(['BackgroundTodoAgentProcessor', sessionId]);
	}

	private lazyTodoListContextProvider = new LazyStatefulPromise(() =>
		this.instantiationService.invokeFunction(async (accessor) => accessor.get<ITodoListContextProvider>(ITodoListContextProvider)));

	private lazyEndpointProvider = new LazyStatefulPromise(() =>
		this.instantiationService.invokeFunction(async (accessor) => accessor.get<IEndpointProvider>(IEndpointProvider)));


	trackTurnRound(promptContext: IBuildPromptContext, token: CancellationToken) {
		const cts = this.cts;
		this.queue.queue(async () => {
			if (cts.token.isCancellationRequested) {
				return;
			}

			const turnId = promptContext.conversation?.getLatestTurn().id;

			if (turnId === undefined) {
				this.logger.warn('skipping turn round: no turn ID found in prompt context');
				return;
			}

			const toolInvocationToken = promptContext.tools?.toolInvocationToken;
			if (toolInvocationToken === undefined) {
				this.logger.error(`no tool invocation token found for ${turnId} in session ${this.sessionId}`);
				return;
			}

			if (this.currentTurnId === undefined) {
				this.logger.debug(`starting to track turn ${turnId}`);
				this.currentTurnId = turnId;
				this.currentUserRequest = promptContext.query;
				this.backOffTracker.reset();
				await this.clearCurrentTodos(toolInvocationToken);
			}

			if (turnId !== this.currentTurnId) {
				this.logger.error(`tracked not current turn ID ${turnId} for session ${this.sessionId}`);
				return;
			}

			this.sessionHistoryStore.trackPromptContext(turnId, promptContext);

			const linkedCts = new CancellationTokenSource(token);
			const sub = cts.token.onCancellationRequested(() => linkedCts.cancel());
			try {
				await this.doWork(turnId, toolInvocationToken, false, linkedCts.token);
			} finally {
				sub.dispose();
				linkedCts.dispose();
			}
		});
	}

	endTurn(turnId: string, toolInvocationToken: ChatParticipantToolToken) {
		const cts = this.cts;
		return this.queue.queue(async () => {
			if (cts.token.isCancellationRequested) {
				return;
			}
			try {
				if (this.currentTurnId !== turnId) {
					this.logger.error(`Requested end turn ${turnId} but current tracked turn is ${this.currentTurnId}`);
					return;
				}

				this.logger.debug(`ending turn ${turnId}, running final pass`);

				await this.doWork(turnId, toolInvocationToken, true, cts.token);

				const oldTodos = await this.getCurrentTodoContext();
				if (oldTodos !== undefined) {
					this.oldTurnTodos = oldTodos;
				}
			} finally {
				if (this.currentTurnId === turnId) {
					this.currentTurnId = undefined;
				}
			}
		});
	}

	cancel() {
		if (this._store.isDisposed) {
			return;
		}
		this.logger.debug('cancelling background todo agent generation');
		this.cts.cancel();
		this._cts.value = new CancellationTokenSource();
		this.currentTurnId = undefined;
	}

	override dispose(): void {
		this._cts.value?.cancel();
		super.dispose();
	}

	private async doWork(turnId: string, toolInvocationToken: ChatParticipantToolToken, isFinal: boolean, token: CancellationToken) {
		if (this.state === BackgroundTodoAgentProcessorState.InProgress) {
			this.logger.debug(`skipping pass for turn ${turnId}: a pass is already in progress`);
			return;
		}

		try {
			this.state = BackgroundTodoAgentProcessorState.InProgress;

			const history = this.sessionHistoryStore.getTurnHistory(turnId);
			if (history === undefined || history.new.length === 0) {
				this.logger.debug(`skipping pass for turn ${turnId}: no unprocessed history`);
				return;
			}

			if (!this.backOffTracker.isReady(history.unprocessedSubstantiveRoundCount) && !isFinal) {
				this.logger.debug(`skipping pass for turn ${turnId}: ${history.unprocessedSubstantiveRoundCount} substantive round(s) below threshold ${this.backOffTracker.threshold}`);
				return;
			}

			try {
				this.logger.debug(`running ${isFinal ? 'final ' : ''}pass for turn ${turnId} with ${history.new.length} new round(s)`);
				const res = await this.makeChatRequest(history, toolInvocationToken, isFinal, token);

				if (res !== 'error') {
					this.sessionHistoryStore.markToolCallsAsProcessed(turnId, history.new);
				}

				this.backOffTracker.recordPass();

				if (res === 'error' || res === 'noop') {
					this.backOffTracker.recordNoop();
				} else {
					this.backOffTracker.clearNoops();
				}

			} catch (err) {
				this.logger.error(err instanceof Error ? err : new Error(String(err)), `background todo pass failed for turn ${turnId}`);
			}

		} finally {
			this.state = BackgroundTodoAgentProcessorState.Idle;
		}
	}

	private async makeChatRequest(history: ReadOnlyTurnHistory, toolInvocationToken: ChatParticipantToolToken, isFinalReview: boolean, token: CancellationToken): Promise<'success' | 'error' | 'noop'> {
		const startTime = Date.now();
		const endPoint = await this.getUtilitySmallEndpoint();
		const normalizedTodoTools = getNormalizedTodoToolsSchema(endPoint, this.logger);

		const { messages } = await renderPromptElement(
			this.instantiationService,
			endPoint,
			BackgroundTodoPrompt,
			{
				currentTodos: await this.getCurrentTodoContext(),
				userRequest: this.currentUserRequest,
				previousTurnTodos: this.oldTurnTodos,
				history: history,
				isFinalReview,
			},
			undefined,
			token
		);

		if (token.isCancellationRequested) {
			this.logger.debug('aborting pass before request: cancellation requested during prompt rendering');
			return 'noop';
		}

		const toolCalls: ToolCall[] = [];
		const response = await endPoint.makeChatRequest2({
			debugName: 'backgroundTodoAgent',
			messages: messages,
			finishedCb: async (_text, _index, fetchDelta) => {
				if (fetchDelta.dardcorToolCalls) {
					toolCalls.push(...fetchDelta.dardcorToolCalls);
				}
				return undefined;
			},
			location: ChatLocation.Other,
			requestOptions: {
				temperature: 0,
				tools: normalizedTodoTools,
			},
			userInitiatedRequest: false,
			interactionTypeOverride: 'conversation-background',
			telemetryProperties: { associatedRequestId: this.currentTurnId },
		}, token);

		const durationMs = Date.now() - startTime;

		if (response.type !== ChatFetchResponseType.Success) {
			this.logger.error(`[BackgroundTodo] dardcor-utility-small returned non-success response: ${response.type}`);
			this.sendTelemetry('modelError', this.currentTurnId, durationMs);
			return 'error';
		}

		const usage = response.usage;

		const res = await this.handleTodoToolCall(toolCalls, toolInvocationToken, token);
		switch (res) {
			case 'noop':
				this.sendTelemetry('noop', this.currentTurnId, durationMs, usage?.prompt_tokens, usage?.completion_tokens, endPoint.model);
				break;
			case 'error':
				this.sendTelemetry('toolInvokeError', this.currentTurnId, durationMs, usage?.prompt_tokens, usage?.completion_tokens, endPoint.model);
				break;
			case 'success':
				this.sendTelemetry('success', this.currentTurnId, durationMs, usage?.prompt_tokens, usage?.completion_tokens, endPoint.model);
				break;
		}

		return res;
	}

	private async handleTodoToolCall(toolCalls: ToolCall[], toolInvocationToken: ChatParticipantToolToken, token: CancellationToken): Promise<'success' | 'error' | 'noop'> {
		let todoToolCall: ToolCall | undefined;
		for (let i = toolCalls.length - 1; i >= 0; i--) {
			if (toolCalls[i].name === ToolName.CoreManageTodoList) {
				todoToolCall = toolCalls[i];
				break;
			}
		}

		if (todoToolCall === undefined) {
			this.logger.debug('[BackgroundTodo] model returned no todo tool call (no-op)');
			return 'noop';
		}

		let todoList: unknown;
		try {
			const parsed = JSON.parse(todoToolCall.arguments);
			if (typeof parsed !== 'object' || parsed === null) {
				this.logger.warn('[BackgroundTodo] tool call arguments were not a JSON object');
				return 'error';
			}
			todoList = (parsed as { todoList?: unknown }).todoList;
		} catch {
			this.logger.warn('[BackgroundTodo] failed to parse tool call arguments');
			return 'error';
		}

		if (!Array.isArray(todoList)) {
			this.logger.warn('[BackgroundTodo] tool call arguments missing a todoList array');
			return 'error';
		}

		try {
			await this.toolsService.invokeTool(ToolName.CoreManageTodoList, {
				input: { operation: 'write', todoList },
				toolInvocationToken,
			}, token);
		} catch (err) {
			this.logger.warn(`[BackgroundTodo] tool invocation failed: ${err}`);
			return 'error';
		}

		this.logger.debug(`[BackgroundTodo] wrote ${todoList.length} todo item(s)`);
		return 'success';
	}

	private async getUtilitySmallEndpoint(): Promise<IChatEndpoint> {
		return await (await this.lazyEndpointProvider.getPromise()).getChatEndpoint('dardcor-utility-small');
	}

	private async getCurrentTodoContext() {
		const sessionResource = this.sessionResource;
		if (sessionResource === undefined) {
			return undefined;
		}

		return await (await this.lazyTodoListContextProvider.getPromise()).getCurrentTodoContext(sessionResource);
	}

	private async clearCurrentTodos(toolInvocationToken: ChatParticipantToolToken) {
		return (await this.lazyTodoListContextProvider.getPromise()).clearCurrentTodoContext(toolInvocationToken);
	}

	private sendTelemetry(
		outcome: string,
		chatRequestId: string | undefined,
		durationMs: number,
		promptTokens?: number,
		completionTokens?: number,
		model?: string,
	) {
		this.telemetryService.sendMSFTTelemetryEvent('backgroundTodoAgent', {
			outcome: outcome,
			conversationId: this.sessionId,
			chatRequestId: chatRequestId,
			model: model,
		}, {
			duration: durationMs,
			promptTokenCount: promptTokens,
			completionTokenCount: completionTokens,
		});
	}
}

function getNormalizedTodoToolsSchema(endpoint: IChatEndpoint, logger: ILogger) {
	const schema = [{
		function: {
			name: ToolName.CoreManageTodoList,
			description: 'Update the todo list with current progress.',
			parameters: {
				type: 'object',
				properties: {
					todoList: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								id: { type: 'number' },
								title: { type: 'string' },
								status: { type: 'string', enum: ['not-started', 'in-progress', 'completed'] },
							},
							required: ['id', 'title', 'status'],
						},
					},
				},
				required: ['todoList'],
			},
		},
		type: 'function' as const,
	}];

	return normalizeToolSchema(
		endpoint.family,
		schema,
		(tool, rule) => {
			logger.warn(`[BackgroundTodo] Tool ${tool} failed validation: ${rule}`);
		}
	);
}

export function getSessionResource(promptContext: IBuildPromptContext): string | undefined {
	const fromRequest = promptContext.request?.sessionResource;
	if (fromRequest) {
		return fromRequest.toString();
	}

	const fromToken = (promptContext.tools?.toolInvocationToken as { sessionResource?: string | Uri } | undefined)?.sessionResource;
	if (fromToken) {
		return typeof fromToken === 'string' ? fromToken : fromToken.toString();
	}
	return undefined;
}

export class BackOffTracker {

	private static readonly DEFAULT_INITIAL_THRESHOLD = 3;

	private static readonly DEFAULT_THRESHOLD_STEP = 2;

	private static readonly DEFAULT_MAX_THRESHOLD = 24;

	private passCount = 0;

	private consecutiveNoops = 0;

	constructor(
		private readonly initialThreshold: number = BackOffTracker.DEFAULT_INITIAL_THRESHOLD,
		private readonly thresholdStep: number = BackOffTracker.DEFAULT_THRESHOLD_STEP,
		private readonly maxThreshold: number = BackOffTracker.DEFAULT_MAX_THRESHOLD,
	) { }

	get threshold(): number {
		const grown = this.initialThreshold + (this.passCount + this.consecutiveNoops) * this.thresholdStep;
		return Math.min(grown, this.maxThreshold);
	}

	get isBackedOff(): boolean {
		return this.threshold > this.initialThreshold;
	}

	isReady(substantiveRoundCount: number): boolean {
		return substantiveRoundCount >= this.threshold;
	}

	recordPass(): void {
		this.passCount++;
	}

	recordNoop(): void {
		this.consecutiveNoops++;
	}

	clearNoops(): void {
		this.consecutiveNoops = 0;
	}

	reset(): void {
		this.passCount = 0;
		this.consecutiveNoops = 0;
	}
}
