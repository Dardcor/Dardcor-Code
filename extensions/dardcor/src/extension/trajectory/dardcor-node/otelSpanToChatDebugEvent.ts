/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { IDebugLogEntry } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { DardcorChatAttr, DardcorSdkAttr, GenAiAttr, GenAiOperationName } from '../../../platform/otel/common/index';
import { type ICompletedSpanData, type ISpanEventData, SpanStatusCode } from '../../../platform/otel/common/otelService';


function userMsgId(spanId: string): string { return `user-msg-${spanId}`; }
function agentMsgId(spanId: string): string { return `agent-msg-${spanId}`; }

export function extractSessionId(span: ICompletedSpanData): string | undefined {
	return asString(span.attributes[DardcorChatAttr.SESSION_ID])
		?? asString(span.attributes[GenAiAttr.CONVERSATION_ID]);
}

export function completedSpanToDebugEvent(span: ICompletedSpanData): vscode.ChatDebugEvent | undefined {
	const opName = asString(span.attributes[GenAiAttr.OPERATION_NAME]);

	switch (opName) {
		case GenAiOperationName.EXECUTE_TOOL:
			return spanToToolCallEvent(span);
		case GenAiOperationName.CHAT:
			return spanToModelTurnEvent(span);
		case GenAiOperationName.INVOKE_AGENT:
			if (span.parentSpanId) {
				const hasAgentName = !!asString(span.attributes[GenAiAttr.AGENT_NAME])
					|| span.name.replace(/^invoke_agent\s*/, '').trim().length > 0;
				if (hasAgentName) {
					return spanToSubagentEvent(span);
				}
			}
			return undefined;
		case GenAiOperationName.EXECUTE_HOOK:
			return spanToHookExecutionEvent(span);
		case GenAiOperationName.CONTENT_EVENT:
		case 'core_event':
			return spanToGenericEvent(span);
		default:
			if (span.name.startsWith('hook ') && asString(span.attributes[DardcorSdkAttr.HOOK_TYPE])) {
				return spanToSdkHookEvent(span);
			}
			return undefined;
	}
}

export function extractConversationEvents(spans: readonly ICompletedSpanData[]): vscode.ChatDebugEvent[] {
	const events: vscode.ChatDebugEvent[] = [];
	for (const span of spans) {
		const opName = asString(span.attributes[GenAiAttr.OPERATION_NAME]);
		if (opName !== GenAiOperationName.CHAT) {
			continue;
		}

		const outputMessages = asString(span.attributes[GenAiAttr.OUTPUT_MESSAGES]);
		if (outputMessages) {
			const hasTextContent = hasAgentTextResponse(outputMessages);
			const agentName = asString(span.attributes[GenAiAttr.AGENT_NAME])
				?? asString(span.attributes[GenAiAttr.RESPONSE_MODEL]);
			const summary = extractAgentResponseSummary(outputMessages, agentName);
			if (hasTextContent && summary) {
				const evt = new vscode.ChatDebugAgentResponseEvent(
					truncate(summary, 200),
					new Date(span.endTime),
				);
				evt.id = agentMsgId(span.spanId);
				evt.parentEventId = span.parentSpanId;
				events.push(evt);
			}
		}
	}
	return events;
}

export function spanEventToUserMessage(event: ISpanEventData): vscode.ChatDebugUserMessageEvent | undefined {
	if (event.eventName !== 'user_message') {
		return undefined;
	}
	const content = asString(event.attributes.content as string) ?? '';
	const evt = new vscode.ChatDebugUserMessageEvent(
		truncate(content, 200),
		new Date(event.timestamp),
	);
	evt.id = userMsgId(event.spanId);
	evt.parentEventId = event.parentSpanId;
	return evt;
}


export function resolveSpanToContent(span: ICompletedSpanData): vscode.ChatDebugResolvedEventContent | undefined {
	const opName = asString(span.attributes[GenAiAttr.OPERATION_NAME]);
	if (opName === GenAiOperationName.EXECUTE_TOOL) {
		return resolveToolCallContent(span);
	}
	if (opName === GenAiOperationName.CHAT) {
		return resolveModelTurnContent(span);
	}
	if (opName === GenAiOperationName.EXECUTE_HOOK) {
		return resolveHookExecutionContent(span);
	}
	return undefined;
}

export function resolveUserMessageFromSpan(span: ICompletedSpanData): vscode.ChatDebugUserMessageEvent {
	const sections: vscode.ChatDebugMessageSection[] = [];

	const systemInstr = asString(span.attributes[GenAiAttr.SYSTEM_INSTRUCTIONS]);
	if (systemInstr) {
		sections.push(new vscode.ChatDebugMessageSection('System', systemInstr));
	}
	const promptContext = asString(span.attributes[DardcorChatAttr.PROMPT_CONTEXT]);
	if (promptContext) {
		sections.push(new vscode.ChatDebugMessageSection('Context', promptContext));
	}
	const promptInstructions = asString(span.attributes[DardcorChatAttr.PROMPT_INSTRUCTIONS]);
	if (promptInstructions) {
		sections.push(new vscode.ChatDebugMessageSection('Instructions', promptInstructions));
	}
	const userRequest = asString(span.attributes[DardcorChatAttr.USER_REQUEST]);
	if (userRequest) {
		sections.push(new vscode.ChatDebugMessageSection('User Request', userRequest));
	}

	if (sections.length === 0) {
		const inputMessages = asString(span.attributes[GenAiAttr.INPUT_MESSAGES]);
		if (inputMessages) {
			try {
				const parsed = JSON.parse(inputMessages) as Array<{ role?: string; parts?: Array<{ type?: string; content?: unknown }> }>;
				for (const msg of parsed) {
					if (!msg.parts) { continue; }
					const textContent = msg.parts
						.filter(p => p.type === 'text' && typeof p.content === 'string')
						.map(p => p.content as string)
						.join('\n');
					if (textContent) {
						sections.push(new vscode.ChatDebugMessageSection(
							capitalize(msg.role ?? 'unknown'),
							textContent,
						));
					}
				}
			} catch { }
		}
	}

	if (sections.length === 0) {
		const inputMessages = asString(span.attributes[GenAiAttr.INPUT_MESSAGES]);
		if (inputMessages) {
			sections.push(new vscode.ChatDebugMessageSection('Input Messages', inputMessages));
		}
	}

	const summary = userRequest ?? 'User Message';
	const evt = new vscode.ChatDebugUserMessageEvent(truncate(summary, 200), new Date(span.startTime));
	evt.id = userMsgId(span.spanId);
	evt.sections = sections;
	return evt;
}

export function resolveAgentResponseFromSpan(span: ICompletedSpanData): vscode.ChatDebugAgentResponseEvent {
	const sections: vscode.ChatDebugMessageSection[] = [];

	const outputMessages = asString(span.attributes[GenAiAttr.OUTPUT_MESSAGES]);
	if (outputMessages) {
		try {
			const parsed = JSON.parse(outputMessages) as Array<{ role?: string; parts?: Array<{ type?: string; content?: string; name?: string; arguments?: unknown }> }>;
			for (const msg of parsed) {
				if (!msg.parts) { continue; }
				const textContent = msg.parts
					.filter(p => p.type === 'text' && typeof p.content === 'string' && p.content.trim())
					.map(p => p.content!)
					.join('\n');
				if (textContent) {
					sections.push(new vscode.ChatDebugMessageSection('Response', textContent));
				}
				const toolCalls = msg.parts.filter(p => p.type === 'tool_call');
				if (toolCalls.length > 0) {
					const toolSection = toolCalls.map(tc =>
						`${tc.name ?? 'unknown'}(${typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {})})`
					).join('\n');
					sections.push(new vscode.ChatDebugMessageSection('Tool Calls', toolSection));
				}
			}
		} catch { }
	}

	const reasoning = asString(span.attributes[DardcorChatAttr.REASONING_CONTENT]);
	if (reasoning) {
		sections.push(new vscode.ChatDebugMessageSection('Reasoning', reasoning));
	}

	const agentName = asString(span.attributes[GenAiAttr.AGENT_NAME])
		?? asString(span.attributes[GenAiAttr.RESPONSE_MODEL]);
	const summary = extractAgentResponseSummary(outputMessages ?? '', agentName);
	const evt = new vscode.ChatDebugAgentResponseEvent(truncate(summary, 200), new Date(span.endTime));
	evt.id = agentMsgId(span.spanId);
	evt.sections = sections;
	return evt;
}


export function groupToolCallsByParent(spans: readonly ICompletedSpanData[]): Map<string, ICompletedSpanData[]> {
	const groups = new Map<string, ICompletedSpanData[]>();
	for (const span of spans) {
		if (asString(span.attributes[GenAiAttr.OPERATION_NAME]) !== GenAiOperationName.EXECUTE_TOOL) {
			continue;
		}
		const parent = span.parentSpanId;
		if (!parent) { continue; }
		let group = groups.get(parent);
		if (!group) {
			group = [];
			groups.set(parent, group);
		}
		group.push(span);
	}
	for (const group of groups.values()) {
		group.sort((a, b) => a.startTime - b.startTime);
	}
	return groups;
}

export function detectParallelSubagents(spans: readonly ICompletedSpanData[]): ParallelSubagentGroup[] {
	const subagentToolSpans = spans.filter(s => {
		const opName = asString(s.attributes[GenAiAttr.OPERATION_NAME]);
		const toolName = asString(s.attributes[GenAiAttr.TOOL_NAME]);
		return opName === GenAiOperationName.EXECUTE_TOOL && toolName === 'runSubagent';
	});

	const byParent = new Map<string, ICompletedSpanData[]>();
	for (const span of subagentToolSpans) {
		const parent = span.parentSpanId;
		if (!parent) { continue; }
		let group = byParent.get(parent);
		if (!group) {
			group = [];
			byParent.set(parent, group);
		}
		group.push(span);
	}

	const result: ParallelSubagentGroup[] = [];
	for (const [parentId, group] of byParent) {
		if (group.length < 2) { continue; }
		group.sort((a, b) => a.startTime - b.startTime);
		const hasOverlap = group.some((span, i) => {
			if (i === 0) { return false; }
			return span.startTime < group[i - 1].endTime;
		});
		if (hasOverlap) {
			result.push({
				parallelGroupId: parentId,
				spans: group,
			});
		}
	}
	return result;
}

export interface ParallelSubagentGroup {
	readonly parallelGroupId: string;
	readonly spans: readonly ICompletedSpanData[];
}


function spanToToolCallEvent(span: ICompletedSpanData): vscode.ChatDebugToolCallEvent {
	let toolName = asString(span.attributes[GenAiAttr.TOOL_NAME]) ?? 'unknown';
	if (toolName === 'runSubagent') {
		const agentName = extractJsonField(asString(span.attributes[GenAiAttr.TOOL_CALL_ARGUMENTS]), 'agentName');
		if (agentName) {
			toolName = `runSubagent (${agentName})`;
		}
	}
	const displayName = span.name || `execute_tool ${toolName}`;
	const evt = new vscode.ChatDebugToolCallEvent(displayName, new Date(span.startTime));
	evt.id = span.spanId;
	evt.parentEventId = span.parentSpanId;
	evt.toolCallId = asString(span.attributes[GenAiAttr.TOOL_CALL_ID]);
	evt.input = asString(span.attributes[GenAiAttr.TOOL_CALL_ARGUMENTS]);
	evt.output = asString(span.attributes[GenAiAttr.TOOL_CALL_RESULT]);
	evt.result = span.status.code === SpanStatusCode.OK
		? vscode.ChatDebugToolCallResult.Success
		: span.status.code === SpanStatusCode.ERROR
			? vscode.ChatDebugToolCallResult.Error
			: undefined;
	evt.durationInMillis = span.endTime - span.startTime;
	return evt;
}

function spanToModelTurnEvent(span: ICompletedSpanData): vscode.ChatDebugModelTurnEvent {
	const evt = new vscode.ChatDebugModelTurnEvent(new Date(span.startTime));
	evt.id = span.spanId;
	evt.parentEventId = span.parentSpanId;
	evt.model = asString(span.attributes[GenAiAttr.REQUEST_MODEL]);
	evt.inputTokens = asNumber(span.attributes[GenAiAttr.USAGE_INPUT_TOKENS]);
	evt.outputTokens = asNumber(span.attributes[GenAiAttr.USAGE_OUTPUT_TOKENS]);
	evt.cachedTokens = asNumber(span.attributes[GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]);
	evt.totalTokens = (evt.inputTokens ?? 0) + (evt.outputTokens ?? 0);
	evt.durationInMillis = span.endTime - span.startTime;
	evt.timeToFirstTokenInMillis = asNumber(span.attributes[DardcorChatAttr.TIME_TO_FIRST_TOKEN]);
	evt.maxInputTokens = asNumber(span.attributes[DardcorChatAttr.MAX_PROMPT_TOKENS]);
	evt.maxOutputTokens = asNumber(span.attributes[GenAiAttr.REQUEST_MAX_TOKENS]);
	evt.requestName = asString(span.attributes[DardcorChatAttr.DEBUG_NAME])
		?? asString(span.attributes[GenAiAttr.AGENT_NAME]);
	evt.status = spanStatusToString(span.status.code as SpanStatusCode);
	evt.dardcorUsageNanoAiu = asNumber(span.attributes[DardcorChatAttr.DARDCOR_USAGE_NANO_AIU]);
	return evt;
}

function spanToSubagentEvent(span: ICompletedSpanData): vscode.ChatDebugSubagentInvocationEvent {
	const agentName = asString(span.attributes[GenAiAttr.AGENT_NAME])
		?? (span.name.replace(/^invoke_agent\s*/, '').trim() || 'agent');
	const displayName = span.name || `invoke_agent ${agentName}`;
	const evt = new vscode.ChatDebugSubagentInvocationEvent(displayName, new Date(span.startTime));
	evt.id = span.spanId;
	evt.parentEventId = span.parentSpanId;
	evt.durationInMillis = span.endTime - span.startTime;
	const agentDescription = asString(span.attributes[GenAiAttr.AGENT_DESCRIPTION]);
	evt.description = agentDescription ?? `Subagent: ${agentName}`;
	evt.status = span.status.code === SpanStatusCode.OK
		? vscode.ChatDebugSubagentStatus.Completed
		: span.status.code === SpanStatusCode.ERROR
			? vscode.ChatDebugSubagentStatus.Failed
			: vscode.ChatDebugSubagentStatus.Running;
	const turnCount = asNumber(span.attributes[DardcorChatAttr.TURN_COUNT]);
	evt.modelTurnCount = turnCount;
	return evt;
}

function resolveHookExecutionContent(span: ICompletedSpanData): vscode.ChatDebugEventHookContent {
	const hookType = asString(span.attributes[DardcorChatAttr.HOOK_TYPE]) ?? 'unknown';
	const content = new vscode.ChatDebugEventHookContent(hookType);
	content.command = asString(span.attributes['dardcor_chat.hook_command']);
	const resultKind = asString(span.attributes[DardcorChatAttr.HOOK_RESULT_KIND]);
	content.result = resultKind === 'success'
		? vscode.ChatDebugHookResult.Success
		: resultKind === 'error'
			? vscode.ChatDebugHookResult.Error
			: resultKind === 'non_blocking_error'
				? vscode.ChatDebugHookResult.NonBlockingError
				: undefined;
	content.durationInMillis = span.endTime - span.startTime;
	content.input = asString(span.attributes[DardcorChatAttr.HOOK_INPUT]);
	content.output = asString(span.attributes[DardcorChatAttr.HOOK_OUTPUT]);
	if (span.status.code === SpanStatusCode.ERROR && span.status.message) {
		content.errorMessage = span.status.message;
	}
	content.exitCode = asNumber(span.attributes['dardcor_chat.hook_exit_code']);
	return content;
}

function spanToHookExecutionEvent(span: ICompletedSpanData): vscode.ChatDebugGenericEvent {
	const hookType = asString(span.attributes[DardcorChatAttr.HOOK_TYPE]) ?? 'unknown';
	const hookCommand = asString(span.attributes['dardcor_chat.hook_command']);
	const resultKind = asString(span.attributes[DardcorChatAttr.HOOK_RESULT_KIND]);
	const durationMs = Math.round(span.endTime - span.startTime);

	const name = `Hook: ${hookType}`;
	const level = resultKind === 'error'
		? vscode.ChatDebugLogLevel.Error
		: resultKind === 'non_blocking_error'
			? vscode.ChatDebugLogLevel.Warning
			: vscode.ChatDebugLogLevel.Info;
	const evt = new vscode.ChatDebugGenericEvent(name, level, new Date(span.startTime));
	evt.id = span.spanId;
	evt.parentEventId = span.parentSpanId;
	const prefix = hookCommand ? `${hookCommand} ` : '';
	evt.details = `${prefix}(${durationMs}ms, ${resultKind ?? 'unknown'})`;
	evt.category = 'discovery';
	return evt;
}

function spanToSdkHookEvent(span: ICompletedSpanData): vscode.ChatDebugGenericEvent {
	const hookType = asString(span.attributes[DardcorSdkAttr.HOOK_TYPE]) ?? 'unknown';
	const durationMs = span.endTime - span.startTime;
	const isError = span.status.code === SpanStatusCode.ERROR;
	const level = isError ? vscode.ChatDebugLogLevel.Error : vscode.ChatDebugLogLevel.Info;
	const evt = new vscode.ChatDebugGenericEvent(`Hook: ${hookType}`, level, new Date(span.startTime));
	evt.id = span.spanId;
	evt.parentEventId = span.parentSpanId;
	evt.details = `${span.name} (${durationMs}ms, ${isError ? 'error' : 'success'})`;
	evt.category = 'discovery';
	return evt;
}

function spanToGenericEvent(span: ICompletedSpanData): vscode.ChatDebugGenericEvent {
	const name = asString(span.attributes[DardcorChatAttr.DEBUG_NAME]) ?? span.name;
	const evt = new vscode.ChatDebugGenericEvent(name, vscode.ChatDebugLogLevel.Info, new Date(span.startTime));
	evt.id = span.spanId;
	evt.parentEventId = span.parentSpanId;
	evt.details = asString(span.attributes[DardcorChatAttr.MARKDOWN_CONTENT])
		?? asString(span.attributes['dardcor_chat.event_details']);
	evt.category = asString(span.attributes['dardcor_chat.event_category']);
	return evt;
}

function resolveToolCallContent(span: ICompletedSpanData): vscode.ChatDebugEventToolCallContent {
	const toolName = asString(span.attributes[GenAiAttr.TOOL_NAME]) ?? 'unknown';
	const content = new vscode.ChatDebugEventToolCallContent(toolName);
	content.input = asString(span.attributes[GenAiAttr.TOOL_CALL_ARGUMENTS]);
	content.output = asString(span.attributes[GenAiAttr.TOOL_CALL_RESULT]);
	content.result = span.status.code === SpanStatusCode.OK
		? vscode.ChatDebugToolCallResult.Success
		: span.status.code === SpanStatusCode.ERROR
			? vscode.ChatDebugToolCallResult.Error
			: undefined;
	content.durationInMillis = span.endTime - span.startTime;
	return content;
}

function resolveModelTurnContent(span: ICompletedSpanData): vscode.ChatDebugEventModelTurnContent {
	const requestName = asString(span.attributes[DardcorChatAttr.DEBUG_NAME])
		?? asString(span.attributes[GenAiAttr.AGENT_NAME])
		?? span.name;
	const content = new vscode.ChatDebugEventModelTurnContent(requestName);
	content.model = asString(span.attributes[GenAiAttr.REQUEST_MODEL]);
	content.status = spanStatusToString(span.status.code as SpanStatusCode);
	content.durationInMillis = span.endTime - span.startTime;
	content.timeToFirstTokenInMillis = asNumber(span.attributes[DardcorChatAttr.TIME_TO_FIRST_TOKEN]);
	content.requestId = asString(span.attributes[GenAiAttr.RESPONSE_ID]);
	content.requestOptions = asString(span.attributes[DardcorChatAttr.REQUEST_OPTIONS]);
	content.maxInputTokens = asNumber(span.attributes[DardcorChatAttr.MAX_PROMPT_TOKENS]);
	content.maxOutputTokens = asNumber(span.attributes[GenAiAttr.REQUEST_MAX_TOKENS]);
	content.inputTokens = asNumber(span.attributes[GenAiAttr.USAGE_INPUT_TOKENS]);
	content.outputTokens = asNumber(span.attributes[GenAiAttr.USAGE_OUTPUT_TOKENS]);
	content.cachedTokens = asNumber(span.attributes[GenAiAttr.USAGE_CACHE_READ_INPUT_TOKENS]);
	content.totalTokens = (content.inputTokens ?? 0) + (content.outputTokens ?? 0);

	const sections: vscode.ChatDebugMessageSection[] = [];
	const systemInstr = asString(span.attributes[GenAiAttr.SYSTEM_INSTRUCTIONS]);
	if (systemInstr) {
		sections.push(new vscode.ChatDebugMessageSection('System', systemInstr));
	}
	const inputMessages = asString(span.attributes[GenAiAttr.INPUT_MESSAGES]);
	if (inputMessages) {
		sections.push(new vscode.ChatDebugMessageSection('Input Messages', inputMessages));
	}
	const requestShape = asString(span.attributes[DardcorChatAttr.REQUEST_SHAPE]);
	if (requestShape) {
		sections.push(new vscode.ChatDebugMessageSection('Request Shape', requestShape));
	}
	const toolDefinitions = asString(span.attributes[GenAiAttr.TOOL_DEFINITIONS]);
	if (toolDefinitions) {
		sections.push(new vscode.ChatDebugMessageSection('Tools', toolDefinitions));
	}
	const outputMessages = asString(span.attributes[GenAiAttr.OUTPUT_MESSAGES]);
	if (outputMessages) {
		sections.push(new vscode.ChatDebugMessageSection('Output Messages', outputMessages));
	}
	if (sections.length > 0) {
		content.sections = sections;
	}
	if (span.status.code === SpanStatusCode.ERROR && span.status.message) {
		content.errorMessage = span.status.message;
	}
	return content;
}

function extractAgentResponseSummary(outputMessagesJson: string, agentName?: string): string {
	const label = agentName ? `${agentName} response` : 'Agent Response';
	try {
		const parsed = JSON.parse(outputMessagesJson) as Array<{ parts?: Array<{ type?: string; content?: string; name?: string }> }>;
		for (const msg of parsed) {
			if (!msg.parts) { continue; }
			const text = msg.parts.find(p => p.type === 'text' && p.content)?.content;
			if (text) {
				if (text.length <= 40 && agentName) {
					return `${label}: ${text}`;
				}
				return text;
			}
			const toolCalls = msg.parts.filter(p => p.type === 'tool_call');
			if (toolCalls.length > 0) {
				return `Tool calls: ${toolCalls.map(tc => tc.name ?? 'unknown').join(', ')}`;
			}
		}
	} catch { }
	return label;
}

function hasAgentTextResponse(outputMessagesJson: string): boolean {
	try {
		const parsed = JSON.parse(outputMessagesJson) as Array<{ parts?: Array<{ type?: string; content?: string }> }>;
		for (const msg of parsed) {
			if (!msg.parts) { continue; }
			if (msg.parts.some(p => p.type === 'text' && typeof p.content === 'string' && p.content.trim())) {
				return true;
			}
		}
	} catch { }
	return false;
}

function spanStatusToString(code: SpanStatusCode): string {
	switch (code) {
		case 2: return 'error';
		default: return 'success';
	}
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

function extractJsonField(json: string | undefined, field: string): string | undefined {
	if (!json) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(json);
		const value = parsed[field];
		return typeof value === 'string' ? value : undefined;
	} catch {
		return undefined;
	}
}

function truncate(s: string, maxLen: number): string {
	return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}


export function debugLogEntryToDebugEvent(entry: IDebugLogEntry, skipCoreEvents = true): vscode.ChatDebugEvent | undefined {
	switch (entry.type) {
		case 'tool_call':
			return entryToToolCallEvent(entry);
		case 'llm_request':
			return entryToModelTurnEvent(entry);
		case 'user_message':
			return entryToUserMessageEvent(entry);
		case 'agent_response':
			return entryToAgentResponseEvent(entry);
		case 'subagent':
			return entryToSubagentEvent(entry);
		case 'hook':
			return entryToHookEvent(entry);
		case 'child_session_ref':
			return entryToChildSessionRefEvent(entry);
		case 'discovery':
			return skipCoreEvents ? undefined : entryToGenericEvent(entry);
		case 'generic':
			if (skipCoreEvents && entry.attrs.source === 'core') {
				return undefined;
			}
			return entryToGenericEvent(entry);
		case 'session_start':
		case 'turn_start':
		case 'turn_end':
		case 'error':
			return undefined;
		default:
			return undefined;
	}
}

export function entryDedupKey(entry: IDebugLogEntry): string {
	return `${entry.type}:${entry.spanId}:${entry.ts}`;
}

function entryToToolCallEvent(entry: IDebugLogEntry): vscode.ChatDebugToolCallEvent {
	let displayName = entry.name;
	if (entry.name === 'runSubagent') {
		const desc = extractJsonField(entry.attrs.args as string | undefined, 'description');
		if (desc) {
			displayName = `runSubagent: ${desc}`;
		}
	}
	const evt = new vscode.ChatDebugToolCallEvent(displayName, new Date(entry.ts));
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	evt.input = entry.attrs.args as string | undefined;
	evt.output = entry.attrs.result as string | undefined;
	evt.result = entry.status === 'error'
		? vscode.ChatDebugToolCallResult.Error
		: entry.status === 'ok'
			? vscode.ChatDebugToolCallResult.Success
			: undefined;
	evt.durationInMillis = entry.dur;
	return evt;
}

function entryToModelTurnEvent(entry: IDebugLogEntry): vscode.ChatDebugModelTurnEvent {
	const evt = new vscode.ChatDebugModelTurnEvent(new Date(entry.ts));
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	evt.model = entry.attrs.model as string | undefined;
	evt.inputTokens = entry.attrs.inputTokens as number | undefined;
	evt.outputTokens = entry.attrs.outputTokens as number | undefined;
	evt.cachedTokens = entry.attrs.cachedTokens as number | undefined;
	evt.totalTokens = ((entry.attrs.inputTokens as number | undefined) ?? 0)
		+ ((entry.attrs.outputTokens as number | undefined) ?? 0);
	evt.durationInMillis = entry.dur;
	evt.timeToFirstTokenInMillis = entry.attrs.ttft as number | undefined;
	evt.maxOutputTokens = entry.attrs.maxTokens as number | undefined;
	evt.requestName = (entry.attrs.debugName as string | undefined) ?? entry.name;
	evt.status = entry.status === 'error' ? 'error' : 'success';
	evt.dardcorUsageNanoAiu = entry.attrs.dardcorUsageNanoAiu as number | undefined;
	return evt;
}

function entryToUserMessageEvent(entry: IDebugLogEntry): vscode.ChatDebugUserMessageEvent {
	const content = (entry.attrs.content as string) ?? '';
	const evt = new vscode.ChatDebugUserMessageEvent(
		truncate(content, 200),
		new Date(entry.ts),
	);
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	return evt;
}

function entryToAgentResponseEvent(entry: IDebugLogEntry): vscode.ChatDebugAgentResponseEvent {
	const response = (entry.attrs.response as string) ?? '';
	const evt = new vscode.ChatDebugAgentResponseEvent(
		truncate(response, 200),
		new Date(entry.ts),
	);
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	return evt;
}

function entryToSubagentEvent(entry: IDebugLogEntry): vscode.ChatDebugSubagentInvocationEvent {
	const agentName = (entry.attrs.agentName as string) ?? entry.name;
	const evt = new vscode.ChatDebugSubagentInvocationEvent(entry.name, new Date(entry.ts));
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	evt.durationInMillis = entry.dur;
	evt.description = (entry.attrs.description as string) ?? `Subagent: ${agentName}`;
	evt.status = entry.status === 'error'
		? vscode.ChatDebugSubagentStatus.Failed
		: vscode.ChatDebugSubagentStatus.Completed;
	return evt;
}

function entryToHookEvent(entry: IDebugLogEntry): vscode.ChatDebugGenericEvent {
	const resultKind = entry.attrs.resultKind as string | undefined;
	const level = resultKind === 'error'
		? vscode.ChatDebugLogLevel.Error
		: resultKind === 'non_blocking_error'
			? vscode.ChatDebugLogLevel.Warning
			: vscode.ChatDebugLogLevel.Info;
	const evt = new vscode.ChatDebugGenericEvent(`Hook: ${entry.name}`, level, new Date(entry.ts));
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	const command = entry.attrs.command as string | undefined;
	const prefix = command ? `${command} ` : '';
	evt.details = `${prefix}(${entry.dur}ms, ${resultKind ?? 'unknown'})`;
	evt.category = 'discovery';
	return evt;
}

function entryToChildSessionRefEvent(entry: IDebugLogEntry): vscode.ChatDebugGenericEvent | undefined {
	const label = entry.attrs.label as string | undefined ?? entry.name;
	if (label === 'categorization' || label === 'title') {
		return undefined;
	}
	const evt = new vscode.ChatDebugGenericEvent(label, vscode.ChatDebugLogLevel.Info, new Date(entry.ts));
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	evt.category = 'subagent';
	return evt;
}

function entryToGenericEvent(entry: IDebugLogEntry): vscode.ChatDebugGenericEvent {
	const level = entry.status === 'error'
		? vscode.ChatDebugLogLevel.Error
		: vscode.ChatDebugLogLevel.Info;
	const evt = new vscode.ChatDebugGenericEvent(entry.name, level, new Date(entry.ts));
	evt.id = entry.spanId;
	evt.parentEventId = entry.parentSpanId;
	evt.details = entry.attrs.details as string | undefined;
	evt.category = entry.attrs.category as string | undefined;
	return evt;
}


export async function resolveDebugLogEntry(
	entry: IDebugLogEntry,
	readCompanionFile?: (fileName: string) => Promise<string | undefined>,
): Promise<vscode.ChatDebugResolvedEventContent | undefined> {
	switch (entry.type) {
		case 'tool_call':
			return resolveToolCallEntry(entry);
		case 'llm_request':
			return resolveModelTurnEntry(entry, readCompanionFile);
		case 'user_message':
			return resolveUserMessageEntry(entry);
		case 'agent_response':
			return resolveAgentResponseEntry(entry);
		case 'hook':
			return resolveHookEntry(entry);
		default:
			return undefined;
	}
}

function resolveToolCallEntry(entry: IDebugLogEntry): vscode.ChatDebugEventToolCallContent {
	const content = new vscode.ChatDebugEventToolCallContent(entry.name);
	content.input = entry.attrs.args as string | undefined;
	content.output = entry.attrs.result as string | undefined;
	content.result = entry.status === 'error'
		? vscode.ChatDebugToolCallResult.Error
		: entry.status === 'ok'
			? vscode.ChatDebugToolCallResult.Success
			: undefined;
	content.durationInMillis = entry.dur;
	return content;
}

async function resolveModelTurnEntry(
	entry: IDebugLogEntry,
	readCompanionFile?: (fileName: string) => Promise<string | undefined>,
): Promise<vscode.ChatDebugEventModelTurnContent> {
	const content = new vscode.ChatDebugEventModelTurnContent(entry.name);
	content.model = entry.attrs.model as string | undefined;
	content.status = entry.status === 'error' ? 'error' : 'success';
	content.durationInMillis = entry.dur;
	content.timeToFirstTokenInMillis = entry.attrs.ttft as number | undefined;
	content.requestId = entry.attrs.responseId as string | undefined;
	content.requestOptions = entry.attrs.requestOptions as string | undefined;
	content.maxOutputTokens = entry.attrs.maxTokens as number | undefined;
	content.inputTokens = entry.attrs.inputTokens as number | undefined;
	content.outputTokens = entry.attrs.outputTokens as number | undefined;
	content.cachedTokens = entry.attrs.cachedTokens as number | undefined;
	content.totalTokens = ((entry.attrs.inputTokens as number | undefined) ?? 0)
		+ ((entry.attrs.outputTokens as number | undefined) ?? 0);

	const sections: vscode.ChatDebugMessageSection[] = [];

	const systemPromptFile = entry.attrs.systemPromptFile as string | undefined;
	if (systemPromptFile && readCompanionFile) {
		const systemPrompt = await readCompanionFile(systemPromptFile);
		if (systemPrompt) {
			sections.push(new vscode.ChatDebugMessageSection('System', systemPrompt));
		}
	}

	const inputMessages = entry.attrs.inputMessages as string | undefined;
	if (inputMessages) {
		sections.push(new vscode.ChatDebugMessageSection('Input Messages', inputMessages));
	}
	const requestShape = entry.attrs.requestShape as string | undefined;
	if (requestShape) {
		sections.push(new vscode.ChatDebugMessageSection('Request Shape', requestShape));
	}

	const toolsFile = entry.attrs.toolsFile as string | undefined;
	if (toolsFile && readCompanionFile) {
		const tools = await readCompanionFile(toolsFile);
		if (tools) {
			sections.push(new vscode.ChatDebugMessageSection('Tools', tools));
		}
	}

	const userRequest = entry.attrs.userRequest as string | undefined;
	if (userRequest) {
		sections.push(new vscode.ChatDebugMessageSection('User Request', userRequest));
	}

	if (sections.length > 0) {
		content.sections = sections;
	}
	if (entry.status === 'error' && entry.attrs.error) {
		content.errorMessage = entry.attrs.error as string;
	}
	return content;
}

function resolveUserMessageEntry(entry: IDebugLogEntry): vscode.ChatDebugUserMessageEvent {
	const content = (entry.attrs.content as string) ?? '';
	const evt = new vscode.ChatDebugUserMessageEvent(truncate(content, 200), new Date(entry.ts));
	evt.id = entry.spanId;
	if (content) {
		evt.sections = [new vscode.ChatDebugMessageSection('User Request', content)];
	}
	return evt;
}

function resolveAgentResponseEntry(entry: IDebugLogEntry): vscode.ChatDebugAgentResponseEvent {
	const response = (entry.attrs.response as string) ?? '';
	const reasoning = entry.attrs.reasoning as string | undefined;
	const sections: vscode.ChatDebugMessageSection[] = [];

	if (response) {
		sections.push(new vscode.ChatDebugMessageSection('Response', response));
	}
	if (reasoning) {
		sections.push(new vscode.ChatDebugMessageSection('Reasoning', reasoning));
	}

	const evt = new vscode.ChatDebugAgentResponseEvent(truncate(response, 200), new Date(entry.ts));
	evt.id = entry.spanId;
	evt.sections = sections;
	return evt;
}

function resolveHookEntry(entry: IDebugLogEntry): vscode.ChatDebugEventHookContent {
	const hookType = entry.name;
	const content = new vscode.ChatDebugEventHookContent(hookType);
	content.command = entry.attrs.command as string | undefined;
	const resultKind = entry.attrs.resultKind as string | undefined;
	content.result = resultKind === 'success'
		? vscode.ChatDebugHookResult.Success
		: resultKind === 'error'
			? vscode.ChatDebugHookResult.Error
			: resultKind === 'non_blocking_error'
				? vscode.ChatDebugHookResult.NonBlockingError
				: undefined;
	content.durationInMillis = entry.dur;
	content.input = entry.attrs.input as string | undefined;
	content.output = entry.attrs.output as string | undefined;
	if (entry.status === 'error' && entry.attrs.error) {
		content.errorMessage = entry.attrs.error as string;
	}
	return content;
}
