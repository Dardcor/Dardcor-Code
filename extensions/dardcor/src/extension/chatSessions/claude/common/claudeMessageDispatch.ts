/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SDKAssistantMessage, SDKCompactBoundaryMessage, SDKHookProgressMessage, SDKHookResponseMessage, SDKHookStartedMessage, SDKMessage, SDKResultMessage, SDKUserMessage, SDKUserMessageReplay } from '@anthropic-ai/claude-agent-sdk';
import type { TodoWriteInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import type Anthropic from '@anthropic-ai/sdk';
import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import type { ChatFetchError } from '../../../../platform/chat/common/commonTypes';
import { vBoolean, vLiteral, vObj, vString, type ValidatorType } from '../../../../platform/configuration/common/validator';
import { ILogService } from '../../../../platform/log/common/logService';
import { DardcorChatAttr, GenAiAttr, GenAiOperationName, DardcorAttr, IOTelService, SpanKind, SpanStatusCode, truncateForOTel, type ISpanHandle, type TraceContext } from '../../../../platform/otel/common/index';
import { CapturingToken } from '../../../../platform/requestLogger/common/capturingToken';
import { IRequestLogger } from '../../../../platform/requestLogger/common/requestLogger';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { ServicesAccessor } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatResponseThinkingProgressPart, LanguageModelTextPart, type ChatHookType } from '../../../../dardcorTypes';
import { ExternalEditTracker } from '../../../chatSessions/common/externalEditTracker';
import { ToolName } from '../../../tools/common/toolNames';
import { IToolsService } from '../../../tools/common/toolsService';
import { ClaudeSessionUri } from './claudeSessionUri';
import { ClaudeToolNames, claudeEditTools, getAffectedUrisForEditTool } from './claudeTools';
import { IClaudePlanFileTracker } from './claudePlanFileTracker';
import { IClaudeSessionStateService } from './claudeSessionStateService';
import { completeToolInvocation, createFormattedToolInvocation } from './toolInvocationFormatter';


export interface MessageHandlerRequestContext {
	readonly stream: vscode.ChatResponseStream;
	readonly toolInvocationToken: vscode.ChatParticipantToolToken;
	readonly token: vscode.CancellationToken;
	readonly editTracker?: ExternalEditTracker;
}

export interface MessageHandlerState {
	readonly unprocessedToolCalls: Map<string, Anthropic.Beta.Messages.BetaToolUseBlock>;
	readonly toolStartTimes: Map<string, number>;
	readonly otelToolSpans: Map<string, ISpanHandle>;
	readonly otelHookSpans: Map<string, ISpanHandle>;
	readonly hookStartTimes: Map<string, number>;
	readonly parentTraceContext?: TraceContext;
	readonly subagentTraceContexts: Map<string, TraceContext>;
	readonly extractToolParameters: (toolName: string, input: unknown) => { attrs: Record<string, string>; gatedAttrs: Record<string, string> };
}

export interface MessageHandlerResult {
	readonly requestComplete: boolean;
}



export function messageKey(message: SDKMessage): string {
	if (message.type === 'system') {
		return `system:${message.subtype}`;
	}
	return message.type;
}



export const ALL_KNOWN_MESSAGE_KEYS = new Set([
	'assistant',
	'user',
	'result',
	'stream_event',
	'tool_progress',
	'tool_use_summary',
	'auth_status',
	'rate_limit_event',
	'prompt_suggestion',
	'system:init',
	'system:compact_boundary',
	'system:status',
	'system:api_retry',
	'system:local_command_output',
	'system:hook_started',
	'system:hook_progress',
	'system:hook_response',
	'system:task_notification',
	'system:task_started',
	'system:task_progress',
	'system:files_persisted',
	'system:elicitation_complete',
]);



export const DENY_TOOL_MESSAGE = 'The user declined to run the tool';

export const PROXY_ERROR_PREFIX = 'VSCODE_PROXY_ERROR:';

export class KnownClaudeError extends Error { }

export class ClaudeProxyError extends KnownClaudeError {
	constructor(public readonly fetchError: ChatFetchError) {
		super(fetchError.reason);
	}
}

interface IManageTodoListToolInputParams {
	readonly operation?: 'write' | 'read';
	readonly todoList: readonly {
		readonly id: number;
		readonly title: string;
		readonly description: string;
		readonly status: 'not-started' | 'in-progress' | 'completed';
	}[];
}

export const SYNTHETIC_MODEL_ID = '<synthetic>';

export function handleAssistantMessage(
	message: SDKAssistantMessage,
	accessor: ServicesAccessor,
	sessionId: string,
	request: MessageHandlerRequestContext,
	state: MessageHandlerState,
): void {
	if (message.message.model === SYNTHETIC_MODEL_ID) {
		accessor.get(ILogService).trace('[ClaudeMessageDispatch] Skipping synthetic message');
		return;
	}

	const logService = accessor.get(ILogService);
	const otelService = accessor.get(IOTelService);
	const { stream } = request;
	const { otelToolSpans, unprocessedToolCalls } = state;

	const spanParentContext = (message.parent_tool_use_id
		? state.subagentTraceContexts.get(message.parent_tool_use_id)
		: undefined) ?? state.parentTraceContext;

	for (const item of message.message.content) {
		if (item.type === 'text') {
			stream.markdown(item.text);
		} else if (item.type === 'thinking') {
			stream.push(new ChatResponseThinkingProgressPart(item.thinking));
		} else if (item.type === 'tool_use') {
			unprocessedToolCalls.set(item.id, item);
			state.toolStartTimes.set(item.id, Date.now());

			const toolSpan = otelService.startSpan(`execute_tool ${item.name}`, {
				kind: SpanKind.INTERNAL,
				attributes: {
					[GenAiAttr.OPERATION_NAME]: GenAiOperationName.EXECUTE_TOOL,
					[GenAiAttr.CONVERSATION_ID]: sessionId,
					[GenAiAttr.TOOL_NAME]: item.name,
					[GenAiAttr.TOOL_CALL_ID]: item.id,
					[DardcorChatAttr.SESSION_ID]: sessionId,
					[DardcorChatAttr.CHAT_SESSION_ID]: sessionId,
				},
				parentTraceContext: spanParentContext,
			});
			if (item.input !== undefined) {
				try {
					toolSpan.setAttribute(GenAiAttr.TOOL_CALL_ARGUMENTS, truncateForOTel(
						typeof item.input === 'string' ? item.input : JSON.stringify(item.input),
						otelService.config.maxAttributeSizeChars
					));
				} catch (e) {
					logService.warn(`[ClaudeMessageDispatch] Failed to serialize tool arguments for ${item.name}: ${e}`);
				}
			}

			try {
				const { attrs: paramAttrs, gatedAttrs: gatedParamAttrs } = state.extractToolParameters(item.name, item.input);
				for (const [k, v] of Object.entries(paramAttrs)) {
					toolSpan.setAttribute(k, v);
				}
				if (otelService.config.captureContent) {
					for (const [k, v] of Object.entries(gatedParamAttrs)) {
						toolSpan.setAttribute(k, v);
					}
				}
			} catch { }
			otelToolSpans.set(item.id, toolSpan);

			if (item.name === ClaudeToolNames.Task || item.name === 'Agent') {
				const toolSpanCtx = toolSpan.getSpanContext();
				if (toolSpanCtx) {
					state.subagentTraceContexts.set(item.id, toolSpanCtx);
				}
			}

			if (claudeEditTools.includes(item.name)) {
				let uris: vscode.Uri[] = [];
				try {
					uris = getAffectedUrisForEditTool(item.name, item.input);
				} catch (e) {
					logService.warn(`[ClaudeMessageDispatch] Failed to resolve affected URIs for ${item.name}: ${e}`);
				}
				if (request.editTracker) {
					try {
						void request.editTracker.trackEdit(item.id, uris, stream, request.token);
					} catch (e) {
						logService.warn(`[ClaudeMessageDispatch] Failed to track edit for ${item.name}: ${e}`);
					}
				}

				const planFileTracker = accessor.get(IClaudePlanFileTracker);
				for (const uri of uris) {
					planFileTracker.recordIfPlanFile(sessionId, uri.fsPath);
				}
			}

			const invocation = createFormattedToolInvocation(item, false);
			if (invocation) {
				if (message.parent_tool_use_id) {
					invocation.subAgentInvocationId = message.parent_tool_use_id;
				}
				invocation.enablePartialUpdate = true;
				stream.push(invocation);
			}
		}
	}
}

export function handleUserMessage(
	message: SDKUserMessage | SDKUserMessageReplay,
	accessor: ServicesAccessor,
	sessionId: string,
	request: MessageHandlerRequestContext,
	state: MessageHandlerState,
): void {
	if (!Array.isArray(message.message.content)) {
		return;
	}
	for (const toolResult of message.message.content) {
		if (toolResult.type === 'tool_result') {
			processToolResult(toolResult, accessor, sessionId, request, state);
		}
	}
}

function logToolResult(
	toolUseId: string,
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	toolResult: Anthropic.Messages.ToolResultBlockParam,
	sessionId: string,
	logService: ILogService,
	requestLogger: IRequestLogger,
	telemetryService: ITelemetryService,
	otelToolSpans: Map<string, ISpanHandle>,
	toolStartTimes: Map<string, number>,
	capturingToken: CapturingToken | undefined,
	maxAttributeSizeChars: number,
): void {
	sendToolInvokedTelemetry(toolUseId, toolUse, toolResult, sessionId, telemetryService, toolStartTimes);

	const toolSpan = otelToolSpans.get(toolUseId);
	if (toolSpan) {
		if (toolResult.is_error) {
			const errContent = typeof toolResult.content === 'string' ? toolResult.content : 'tool error';
			toolSpan.setStatus(SpanStatusCode.ERROR, errContent);
			toolSpan.setAttribute(GenAiAttr.TOOL_CALL_RESULT, truncateForOTel(`ERROR: ${errContent}`, maxAttributeSizeChars));
		} else {
			toolSpan.setStatus(SpanStatusCode.OK);
			if (toolResult.content !== undefined) {
				try {
					const result = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
					toolSpan.setAttribute(GenAiAttr.TOOL_CALL_RESULT, truncateForOTel(result, maxAttributeSizeChars));
				} catch (e) {
					logService.warn(`[ClaudeMessageDispatch] Failed to serialize tool result: ${e}`);
				}
			}
		}
		toolSpan.end();
		otelToolSpans.delete(toolUseId);
	}

	try {
		const resultContent = typeof toolResult.content === 'string'
			? toolResult.content
			: JSON.stringify(toolResult.content, undefined, 2) ?? '';
		const response = { content: [new LanguageModelTextPart(resultContent)] };
		if (capturingToken) {
			void requestLogger.captureInvocation(capturingToken, async () =>
				requestLogger.logToolCall(toolUseId, toolUse.name, toolUse.input, response));
		} else {
			requestLogger.logToolCall(toolUseId, toolUse.name, toolUse.input, response);
		}
	} catch (e) {
		logService.warn(`[ClaudeMessageDispatch] Failed to log tool result: ${e}`);
	}
}

function processToolResult(
	toolResult: Anthropic.Messages.ToolResultBlockParam,
	accessor: ServicesAccessor,
	sessionId: string,
	request: MessageHandlerRequestContext,
	state: MessageHandlerState,
): void {
	const logService = accessor.get(ILogService);
	const requestLogger = accessor.get(IRequestLogger);
	const claudeSessionStateService = accessor.get(IClaudeSessionStateService);
	const otelService = accessor.get(IOTelService);
	const telemetryService = accessor.get(ITelemetryService);

	const { stream } = request;
	const { unprocessedToolCalls, otelToolSpans, toolStartTimes } = state;

	const toolUseId = toolResult.tool_use_id;
	const toolUse = unprocessedToolCalls.get(toolUseId);
	if (!toolUse) {
		logService.warn(`[ClaudeMessageDispatch] Received tool result for unknown tool use ID: ${toolUseId}`);
		return;
	}

	unprocessedToolCalls.delete(toolUseId);

	logToolResult(
		toolUseId,
		toolUse,
		toolResult,
		sessionId,
		logService,
		requestLogger,
		telemetryService,
		otelToolSpans,
		toolStartTimes,
		claudeSessionStateService.getCapturingTokenForSession(sessionId),
		otelService.config.maxAttributeSizeChars,
	);

	if (toolUse.name === ClaudeToolNames.TodoWrite) {
		processTodoWriteTool(toolUse, accessor, request);
	} else if (toolUse.name === ClaudeToolNames.EnterPlanMode) {
		claudeSessionStateService.setPermissionModeForSession(sessionId, 'plan');
	} else if (toolUse.name === ClaudeToolNames.ExitPlanMode) {
		claudeSessionStateService.setPermissionModeForSession(sessionId, 'acceptEdits');
	} else if (claudeEditTools.includes(toolUse.name)) {
		request.editTracker?.completeEdit(toolUseId);
	}

	const invocation = createFormattedToolInvocation(toolUse, true);
	if (invocation) {
		invocation.enablePartialUpdate = true;
		invocation.isComplete = true;
		invocation.isError = toolResult.is_error;
		if (toolResult.content === DENY_TOOL_MESSAGE) {
			invocation.isConfirmed = false;
		}
		completeToolInvocation(toolUse, toolResult, invocation);
		stream.push(invocation);
	}
}

function sendToolInvokedTelemetry(
	toolUseId: string,
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	toolResult: Anthropic.Messages.ToolResultBlockParam,
	sessionId: string,
	telemetryService: ITelemetryService,
	toolStartTimes: Map<string, number>,
): void {
	const startTime = toolStartTimes.get(toolUseId);
	toolStartTimes.delete(toolUseId);
	if (toolUse.name === ClaudeToolNames.TodoWrite) {
		return;
	}
	const invocationTimeMs = startTime !== undefined ? Date.now() - startTime : undefined;
	const result = toolResult.content === DENY_TOOL_MESSAGE ? 'userCancelled' : toolResult.is_error ? 'error' : 'success';
	const toolSourceKind = toolUse.name.startsWith('mcp__') ? 'mcp' : 'claudeCode';

	telemetryService.sendMSFTTelemetryEvent('languageModelToolInvoked', {
		result,
		chatSessionId: ClaudeSessionUri.forSessionId(sessionId).toString(),
		toolId: toolUse.name,
		toolExtensionId: undefined,
		toolSourceKind,
	}, invocationTimeMs !== undefined ? { invocationTimeMs } : undefined);
}

function processTodoWriteTool(
	toolUse: Anthropic.Beta.Messages.BetaToolUseBlock,
	accessor: ServicesAccessor,
	request: MessageHandlerRequestContext,
): void {
	const toolsService = accessor.get(IToolsService);
	const input = toolUse.input as TodoWriteInput;
	toolsService.invokeTool(ToolName.CoreManageTodoList, {
		input: {
			operation: 'write',
			todoList: input.todos.map((todo, i) => ({
				id: i,
				title: todo.content,
				description: '',
				status: todo.status === 'pending' ?
					'not-started' :
					(todo.status === 'in_progress' ?
						'in-progress' :
						'completed'),
			} satisfies IManageTodoListToolInputParams['todoList'][number])),
		} satisfies IManageTodoListToolInputParams,
		toolInvocationToken: request.toolInvocationToken,
	}, request.token);
}

export function handleCompactBoundary(
	_message: SDKCompactBoundaryMessage,
	request: MessageHandlerRequestContext,
): void {
	request.stream.markdown(`*${l10n.t('Conversation compacted')}*`);
}

export function handleHookStarted(
	message: SDKHookStartedMessage,
	accessor: ServicesAccessor,
	sessionId: string,
	state: MessageHandlerState,
): void {
	const otelService = accessor.get(IOTelService);
	const span = otelService.startSpan(`${GenAiOperationName.EXECUTE_HOOK} ${message.hook_name}`, {
		kind: SpanKind.INTERNAL,
		attributes: {
			[GenAiAttr.OPERATION_NAME]: GenAiOperationName.EXECUTE_HOOK,
			[GenAiAttr.CONVERSATION_ID]: sessionId,
			[DardcorChatAttr.SESSION_ID]: sessionId,
			[DardcorChatAttr.HOOK_TYPE]: message.hook_event,
			'dardcor_chat.hook_command': message.hook_name,
			'dardcor_chat.hook_id': message.hook_id,
			[DardcorChatAttr.CHAT_SESSION_ID]: sessionId,
		},
		parentTraceContext: state.parentTraceContext,
	});
	state.otelHookSpans.set(message.hook_id, span);
	state.hookStartTimes.set(message.hook_id, Date.now());
}


const vHookJsonOutput = vObj({
	continue: vBoolean(),
	stopReason: vString(),
	systemMessage: vString(),
	decision: vLiteral('block'),
	reason: vString(),
});

export type HookJsonOutput = ValidatorType<typeof vHookJsonOutput>;

export function parseHookJsonOutput(stdout: string): Partial<HookJsonOutput> | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(stdout);
	} catch {
		return undefined;
	}

	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return undefined;
	}

	const result = vHookJsonOutput.validate(raw);
	if (result.error) {
		const obj = raw as Record<string, unknown>;
		const partial: Partial<HookJsonOutput> = {};

		const continueResult = vBoolean().validate(obj['continue']);
		if (!continueResult.error) {
			partial.continue = continueResult.content;
		}
		const stopReasonResult = vString().validate(obj['stopReason']);
		if (!stopReasonResult.error) {
			partial.stopReason = stopReasonResult.content;
		}
		const systemMessageResult = vString().validate(obj['systemMessage']);
		if (!systemMessageResult.error) {
			partial.systemMessage = systemMessageResult.content;
		}
		const decisionResult = vLiteral('block').validate(obj['decision']);
		if (!decisionResult.error) {
			partial.decision = decisionResult.content;
		}
		const reasonResult = vString().validate(obj['reason']);
		if (!reasonResult.error) {
			partial.reason = reasonResult.content;
		}

		return Object.keys(partial).length > 0 ? partial : undefined;
	}

	return result.content;
}


function formatHookErrorMessage(errorMessage: string): string {
	if (errorMessage) {
		return l10n.t('A hook prevented chat from continuing. Please check the Dardcor Chat Hooks output channel for more details. \nError message: {0}', errorMessage);
	}
	return l10n.t('A hook prevented chat from continuing. Please check the Dardcor Chat Hooks output channel for more details.');
}


export function handleHookProgress(
	message: SDKHookProgressMessage,
	accessor: ServicesAccessor,
	request: MessageHandlerRequestContext,
): void {
	const logService = accessor.get(ILogService);
	const hookType = message.hook_event as ChatHookType;
	const progressText = message.stdout || message.stderr;

	logService.trace(`[ClaudeMessageDispatch] Hook progress "${message.hook_name}" (${message.hook_event}): ${progressText}`);

	if (progressText) {
		request.stream.hookProgress(hookType, undefined, progressText);
	}
}

export function handleHookResponse(
	message: SDKHookResponseMessage,
	accessor: ServicesAccessor,
	request: MessageHandlerRequestContext,
	state: MessageHandlerState,
): void {
	const logService = accessor.get(ILogService);
	const otelService = accessor.get(IOTelService);
	const hookType = message.hook_event as ChatHookType;

	const span = state.otelHookSpans.get(message.hook_id);
	if (span) {
		const startTime = state.hookStartTimes.get(message.hook_id);
		if (startTime !== undefined) {
			span.setAttribute(DardcorAttr.HOOK_DURATION_SECONDS, (Date.now() - startTime) / 1000);
			state.hookStartTimes.delete(message.hook_id);
		}
		const hookDecision = message.outcome === 'success'
			? 'pass'
			: message.exit_code === 2
				? 'block'
				: 'non_blocking_error';
		span.setAttribute(DardcorAttr.HOOK_DECISION, hookDecision);
		if (message.outcome === 'error') {
			span.setStatus(SpanStatusCode.ERROR, message.stderr || message.output);
		} else if (message.outcome === 'cancelled') {
			span.setStatus(SpanStatusCode.ERROR, 'cancelled');
		} else {
			span.setStatus(SpanStatusCode.OK);
		}
		if (message.exit_code !== undefined) {
			span.setAttribute('dardcor_chat.hook_exit_code', message.exit_code);
		}
		if (message.output) {
			span.setAttribute('dardcor_chat.hook_output', truncateForOTel(message.output, otelService.config.maxAttributeSizeChars));
		}
		span.end();
		state.otelHookSpans.delete(message.hook_id);
	}

	if (message.outcome === 'cancelled') {
		logService.trace(`[ClaudeMessageDispatch] Hook "${message.hook_name}" (${message.hook_event}) was cancelled`);
		return;
	}

	if (message.exit_code === 2) {
		const errorMessage = message.stderr || message.output;
		logService.warn(`[ClaudeMessageDispatch] Hook "${message.hook_name}" (${message.hook_event}) blocking error: ${errorMessage}`);
		request.stream.hookProgress(hookType, formatHookErrorMessage(errorMessage));
		return;
	}

	if (message.exit_code !== undefined && message.exit_code !== 0) {
		const warningMessage = message.stderr || message.output;
		const loggedMessage = warningMessage || l10n.t('Exit Code: {0}', message.exit_code);
		logService.warn(`[ClaudeMessageDispatch] Hook "${message.hook_name}" (${message.hook_event}) non-blocking error (exit ${message.exit_code}): ${loggedMessage}`);
		if (warningMessage) {
			request.stream.hookProgress(hookType, undefined, warningMessage);
		}
		return;
	}

	if (message.outcome === 'error') {
		const errorMessage = message.stderr || message.output;
		logService.warn(`[ClaudeMessageDispatch] Hook "${message.hook_name}" (${message.hook_event}) failed: ${errorMessage}`);
		request.stream.hookProgress(hookType, formatHookErrorMessage(errorMessage));
		return;
	}

	if (!message.stdout) {
		return;
	}

	const parsed = parseHookJsonOutput(message.stdout);
	if (!parsed) {
		logService.warn(`[ClaudeMessageDispatch] Hook "${message.hook_name}" returned non-JSON output`);
		return;
	}

	if (parsed.decision === 'block') {
		request.stream.hookProgress(hookType, formatHookErrorMessage(parsed.reason ?? ''));
		return;
	}

	if (parsed.continue === false) {
		request.stream.hookProgress(hookType, formatHookErrorMessage(parsed.stopReason ?? ''));
		return;
	}

	if (parsed.systemMessage) {
		request.stream.hookProgress(hookType, undefined, parsed.systemMessage);
	}
}

function getResultErrorText(message: SDKResultMessage): string | undefined {
	if (message.subtype === 'success' && message.is_error) {
		return message.result;
	}
	if (message.subtype === 'error_during_execution') {
		return message.errors?.join('\n');
	}
	return undefined;
}

function tryParseProxyError(errorText: string | undefined): ChatFetchError | undefined {
	if (!errorText) {
		return undefined;
	}
	const idx = errorText.indexOf(PROXY_ERROR_PREFIX);
	if (idx === -1) {
		return undefined;
	}

	const start = idx + PROXY_ERROR_PREFIX.length;
	const end = errorText.slice(start).search(/[\s"']/);
	const b64 = end === -1 ? errorText.slice(start) : errorText.slice(start, start + end);

	try {
		return JSON.parse(Buffer.from(b64, 'base64').toString()) as ChatFetchError;
	} catch {
		return undefined;
	}
}

export function handleResultMessage(
	message: SDKResultMessage,
	request: MessageHandlerRequestContext,
): MessageHandlerResult {
	const isExecutionError =
		message.subtype === 'error_during_execution'
		|| (message.subtype === 'success' && message.is_error === true);

	if (message.subtype === 'error_max_turns') {
		request.stream.progress(l10n.t('Maximum turns reached ({0})', message.num_turns));
	} else if (isExecutionError) {
		const errorText = getResultErrorText(message);
		const fetchError = tryParseProxyError(errorText);
		if (fetchError) {
			throw new ClaudeProxyError(fetchError);
		}
		throw new KnownClaudeError(l10n.t('Error during execution'));
	}
	return { requestComplete: true };
}



export function dispatchMessage(
	accessor: ServicesAccessor,
	message: SDKMessage,
	sessionId: string,
	request: MessageHandlerRequestContext,
	state: MessageHandlerState,
): MessageHandlerResult | undefined {
	const logService = accessor.get(ILogService);

	switch (message.type) {
		case 'assistant':
			handleAssistantMessage(message, accessor, sessionId, request, state);
			return;
		case 'user':
			handleUserMessage(message, accessor, sessionId, request, state);
			return;
		case 'result':
			return handleResultMessage(message, request);
		case 'system':
			if (message.subtype === 'compact_boundary') {
				handleCompactBoundary(message, request);
				return;
			}
			if (message.subtype === 'hook_started') {
				handleHookStarted(message, accessor, sessionId, state);
				return;
			}
			if (message.subtype === 'hook_progress') {
				handleHookProgress(message, accessor, request);
				return;
			}
			if (message.subtype === 'hook_response') {
				handleHookResponse(message, accessor, request, state);
				return;
			}
			break;
	}

	const key = messageKey(message);
	if (ALL_KNOWN_MESSAGE_KEYS.has(key)) {
		logService.trace(`[ClaudeMessageDispatch] Unhandled known message type: ${key}`);
	} else {
		logService.warn(`[ClaudeMessageDispatch] Unknown message type: ${key}`);
	}
	return undefined;
}

