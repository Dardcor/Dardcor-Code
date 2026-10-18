/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { URI } from '../../../../base/common/uri.js';
import { LogLevel, type ILogService } from '../../../log/common/log.js';
import type { AgentSignal } from '../../common/agent.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { createErrorResponsePart, ResponsePartKind, ToolResultContentType, type ToolResultContent, type ToolResultFileEditContent } from '../../common/state/sessionState.js';
import { extractForwardedErrorInfo } from '../shared/proxyChatError.js';
import { buildTopLevelSubagentReadyAction, emitInnerAssistantSignals, mapSubagentSystemMessage, SUBAGENT_SPAWNING_TOOL_NAMES, tagWithParent } from './claudeSubagentSignals.js';
import type { SubagentRegistry } from './claudeSubagentRegistry.js';
import { stripClientToolNamePrefix, hasClientToolNamePrefix } from './clientTools/claudeClientToolMcpServer.js';
import { buildClaudeToolMeta, getClaudePastTenseMessage, getClaudeToolDisplayName, isClaudeFileEditTool } from './claudeToolDisplay.js';
import { claudeToolDenialCode } from './claudeToolDenial.js';
import { ClaudeToolCallRegistry } from './claudeToolCallRegistry.js';
import { ToolCallConfirmationReason, ToolCallContributorKind, type StringOrMarkdown } from '../../common/state/protocol/state.js';

export class ClaudeMapperState {
	private readonly _activeToolBlocks = new Map<number, { toolUseId: string; toolName: string; isClientTool: boolean }>();
	readonly toolCalls = new ClaudeToolCallRegistry();
	private _currentMessageId: string | undefined;

	private readonly _completedFileEdits = new Map<string, ToolResultFileEditContent>();

	resetMessage(messageId: string): void {
		this._activeToolBlocks.clear();
		this._currentMessageId = messageId;
	}

	getCurrentMessageId(): string | undefined {
		return this._currentMessageId;
	}

	startToolBlock(index: number, toolUseId: string, toolName: string, turnId: string, isClientTool = false): void {
		this._activeToolBlocks.set(index, { toolUseId, toolName, isClientTool });
		this.toolCalls.begin(toolUseId, toolName, turnId, isClientTool);
	}

	getActiveToolBlock(index: number): { toolUseId: string; toolName: string; isClientTool: boolean } | undefined {
		return this._activeToolBlocks.get(index);
	}

	endToolBlock(index: number): void {
		this._activeToolBlocks.delete(index);
	}

	appendToolBlockInputDelta(index: number, partialJson: string): void {
		const tracked = this._activeToolBlocks.get(index);
		if (!tracked) {
			return;
		}
		this.toolCalls.appendInputDelta(tracked.toolUseId, partialJson);
	}

	finalizeToolBlock(index: number): void {
		const tracked = this._activeToolBlocks.get(index);
		if (!tracked) {
			return;
		}
		this.toolCalls.finalize(tracked.toolUseId);
	}

	lookupToolCall(toolUseId: string): { turnId: string; toolName: string; isClientTool: boolean } | undefined {
		const entry = this.toolCalls.lookup(toolUseId);
		return entry ? { turnId: entry.turnId, toolName: entry.toolName, isClientTool: entry.isClientTool } : undefined;
	}

	completeToolCall(toolUseId: string): void {
		this.toolCalls.complete(toolUseId);
	}

	cacheFileEdit(toolUseId: string, content: ToolResultFileEditContent): void {
		this._completedFileEdits.set(toolUseId, content);
	}

	takeFileEdit(toolUseId: string): ToolResultFileEditContent | undefined {
		const content = this._completedFileEdits.get(toolUseId);
		if (content) {
			this._completedFileEdits.delete(toolUseId);
		}
		return content;
	}

	clearPendingToolCalls(logService: ILogService): void {
		this.toolCalls.clearPending(logService);
	}
}

function fileEditToolDelta(chat: URI, turnId: string, toolCallId: string, invocationMessage: StringOrMarkdown): AgentSignal {
	return {
		kind: 'action',
		resource: chat,
		action: {
			type: ActionType.ChatToolCallDelta,
			turnId,
			toolCallId,
			content: '',
			invocationMessage,
		},
	};
}

export function mapSDKMessageToAgentSignals(
	message: SDKMessage,
	chat: URI,
	turnId: string,
	state: ClaudeMapperState,
	logService: ILogService,
	registry: SubagentRegistry,
	clientToolOwner?: (toolName: string) => string | undefined,
	turnDuration?: number,
): AgentSignal[] {
	if (logService.getLevel() <= LogLevel.Trace) {
		try {
			const snippet = JSON.stringify(message, (k, v) => typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v);
			logService.trace(`[claudeMapSessionEvents] SDK message type=${message.type}: ${snippet?.slice(0, 2000) ?? '<unserializable>'}`);
		} catch {
			logService.trace(`[claudeMapSessionEvents] SDK message type=${message.type} (unserializable)`);
		}
	}
	switch (message.type) {
		case 'stream_event':
			return tagWithParent(
				mapStreamEvent(message.event, chat, turnId, state, logService, message.parent_tool_use_id, registry, clientToolOwner),
				chat,
				message.parent_tool_use_id,
				registry,
			);
		case 'result':
			return mapResult(message, chat, turnId, turnDuration, state, logService, registry);
		case 'assistant':
			return tagWithParent(
				mapAssistantCanonical(message, chat, turnId, state, message.parent_tool_use_id, registry, clientToolOwner),
				chat,
				message.parent_tool_use_id,
				registry,
			);
		case 'user':
			return tagWithParent(
				mapUserMessage(message, chat, state, logService, registry),
				chat,
				message.parent_tool_use_id,
				registry,
			);
		default:
			if (message.type === 'system') {
				return mapSubagentSystemMessage(message, chat, registry);
			}
			return [];
	}
}

function mapAssistantCanonical(
	message: Extract<SDKMessage, { type: 'assistant' }>,
	chat: URI,
	turnId: string,
	state: ClaudeMapperState,
	parentToolUseId: string | null,
	registry: SubagentRegistry,
	clientToolOwner?: (toolName: string) => string | undefined,
): AgentSignal[] {
	const completedSignal: AgentSignal = {
		kind: 'model_call_completed',
		resource: chat,
		turnId,
		modelCallId: message.message.id,
	};
	const completedSignals = message.aborted ? [] : [completedSignal];
	if (parentToolUseId === null) {
		const top: AgentSignal[] = [...completedSignals];
		for (const block of message.message.content) {
			if (block.type !== 'tool_use' || !SUBAGENT_SPAWNING_TOOL_NAMES.has(block.name)) {
				continue;
			}
			top.push(buildTopLevelSubagentReadyAction(block, chat, turnId, registry));
		}
		return top;
	}
	return [...completedSignals, ...emitInnerAssistantSignals(message, chat, turnId, state, parentToolUseId, registry, clientToolOwner)];
}

function mapUserMessage(
	message: Extract<SDKMessage, { type: 'user' }>,
	chat: URI,
	state: ClaudeMapperState,
	logService: ILogService,
	registry: SubagentRegistry,
): AgentSignal[] {
	const content = message.message.content;
	if (!Array.isArray(content)) {
		return [];
	}

	const signals: AgentSignal[] = [];
	for (const block of content) {
		if (block.type !== 'tool_result') {
			continue;
		}
		const tracked = state.lookupToolCall(block.tool_use_id);
		if (!tracked) {
			logService.warn(`[claudeMapSessionEvents] tool_result for unknown tool_use_id ${block.tool_use_id}`);
			continue;
		}
		const isError = block.is_error === true;
		const content: ToolResultContent[] = extractToolResultContent(block.content) ?? [];
		const fileEdit = state.takeFileEdit(block.tool_use_id);
		if (fileEdit) {
			content.push(fileEdit);
		}
		const info = state.toolCalls.lookup(block.tool_use_id)?.info;
		const resultText = content
			.filter((c): c is { type: ToolResultContentType.Text; text: string } => c.type === ToolResultContentType.Text)
			.map(c => c.text)
			.join('\n');
		const pastTenseMessage: StringOrMarkdown = info
			? info.isClientTool
				? info.displayName
				: getClaudePastTenseMessage(info.toolName, info.displayName, info.parsedInput, !isError, resultText)
			: tracked.isClientTool
				? tracked.toolName
				: `${getClaudeToolDisplayName(tracked.toolName)} finished`;
		const denialCode = isError ? claudeToolDenialCode(resultText) : undefined;
		signals.push({
			kind: 'action',
			resource: chat,
			action: {
				type: ActionType.ChatToolCallComplete,
				turnId: tracked.turnId,
				toolCallId: block.tool_use_id,
				result: {
					success: !isError,
					pastTenseMessage,
					content: content.length > 0 ? content : undefined,
					...(denialCode ? { error: { message: resultText, code: denialCode } } : {}),
				},
			},
		});
		state.completeToolCall(block.tool_use_id);
		const spawn = registry.getSpawn(block.tool_use_id);
		if (spawn && !spawn.background && spawn.markCompleted()) {
			signals.push({
				kind: 'subagent_completed',
				chat,
				toolCallId: block.tool_use_id,
			});
			registry.removeSpawn(block.tool_use_id);
		}
	}
	return signals;
}

function extractToolResultContent(content: unknown): { type: ToolResultContentType.Text; text: string }[] | undefined {
	if (typeof content === 'string') {
		return [{ type: ToolResultContentType.Text, text: content }];
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const out: { type: ToolResultContentType.Text; text: string }[] = [];
	for (const block of content) {
		if (isToolResultTextBlock(block)) {
			out.push({ type: ToolResultContentType.Text, text: block.text });
		}
	}
	return out.length > 0 ? out : undefined;
}

function isToolResultTextBlock(block: unknown): block is { type: 'text'; text: string } {
	if (block === null || typeof block !== 'object') {
		return false;
	}
	const candidate = block as { type?: unknown; text?: unknown };
	return candidate.type === 'text' && typeof candidate.text === 'string';
}

function mapResult(
	message: Extract<SDKMessage, { type: 'result' }>,
	session: URI,
	turnId: string,
	turnDuration: number | undefined,
	state: ClaudeMapperState,
	logService: ILogService,
	registry: SubagentRegistry,
): AgentSignal[] {
	const signals: AgentSignal[] = [];
	if (message.subtype === 'success') {
		const modelKey = Object.keys(message.modelUsage)[0];
		signals.push({
			kind: 'action',
			resource: session,
			action: {
				type: ActionType.ChatUsage,
				turnId,
				usage: {
					inputTokens: message.usage.input_tokens,
					outputTokens: message.usage.output_tokens,
					cacheReadTokens: message.usage.cache_read_input_tokens,
					...(modelKey ? { model: modelKey } : {}),
				},
			},
		});
	}

	const errorText = getResultErrorText(message);
	if (errorText !== undefined) {
		signals.push({
			kind: 'action',
			resource: session,
			action: {
				type: ActionType.ChatError,
				turnId,
				duration: typeof turnDuration === 'number' && Number.isFinite(turnDuration) ? Math.max(0, turnDuration) : 0,
				part: createErrorResponsePart({
					errorType: message.subtype,
					...extractForwardedErrorInfo(errorText),
				}),
			},
		});
	}
	state.clearPendingToolCalls(logService);
	for (const orphan of registry.drainForegroundSpawns()) {
		logService.warn(`[claudeMapSessionEvents] turn ended with pending subagent-spawning tool_use ${orphan.toolUseId} (agentId=${orphan.agentId ?? '<unresolved>'}); dropping cross-message state`);
	}
	return signals;
}

function getResultErrorText(message: Extract<SDKMessage, { type: 'result' }>): string | undefined {
	if (message.subtype === 'success') {
		return message.is_error ? message.result : undefined;
	}
	if (message.subtype === 'error_during_execution') {
		return message.errors?.join('\n');
	}
	return undefined;
}

function mapStreamEvent(
	event: Extract<SDKMessage, { type: 'stream_event' }>['event'],
	chat: URI,
	turnId: string,
	state: ClaudeMapperState,
	logService: ILogService,
	parentToolUseId: string | null,
	registry: SubagentRegistry,
	clientToolOwner: ((toolName: string) => string | undefined) | undefined,
): AgentSignal[] {
	switch (event.type) {
		case 'message_start':
			state.resetMessage(event.message.id);
			return [];

		case 'content_block_start': {
			const block = event.content_block;
			if (block.type === 'text') {
				return [{
					kind: 'action',
					resource: chat,
					action: {
						type: ActionType.ChatResponsePart,
						turnId,
						part: {
							kind: ResponsePartKind.Markdown,
							id: makeContentBlockPartId(turnId, state, event.index, logService),
							content: '',
						},
					},
				}];
			}
			if (block.type === 'thinking') {
				return [{
					kind: 'action',
					resource: chat,
					action: {
						type: ActionType.ChatResponsePart,
						turnId,
						part: {
							kind: ResponsePartKind.Reasoning,
							id: makeContentBlockPartId(turnId, state, event.index, logService),
							content: '',
						},
					},
				}];
			}
			if (block.type === 'tool_use') {
				const toolName = stripClientToolNamePrefix(block.name);
				const isClientTool = hasClientToolNamePrefix(block.name);
				state.startToolBlock(event.index, block.id, toolName, turnId, isClientTool);
				const isSubagentSpawn = !isClientTool && SUBAGENT_SPAWNING_TOOL_NAMES.has(toolName);
				if (parentToolUseId === null) {
					if (isSubagentSpawn) {
						registry.recordSpawn(block.id);
					}
				} else {
					registry.noteInnerTool(block.id, parentToolUseId);
				}
				const meta = isClientTool ? undefined : buildClaudeToolMeta(toolName);
				const toolClientId = isClientTool ? clientToolOwner?.(toolName) : undefined;
				return [{
					kind: 'action',
					resource: chat,
					action: {
						type: ActionType.ChatToolCallStart,
						turnId,
						toolCallId: block.id,
						toolName,
						displayName: isClientTool ? toolName : getClaudeToolDisplayName(toolName),
						...(toolClientId ? { contributor: { kind: ToolCallContributorKind.Client, clientId: toolClientId } } : {}),
						...(meta ? { _meta: meta } : {}),
					},
				}];
			}
			return [];
		}

		case 'content_block_delta': {
			if (event.delta.type === 'text_delta') {
				return [{
					kind: 'action',
					resource: chat,
					action: {
						type: ActionType.ChatDelta,
						turnId,
						partId: makeContentBlockPartId(turnId, state, event.index, logService),
						content: event.delta.text,
					},
				}];
			}
			if (event.delta.type === 'thinking_delta') {
				return [{
					kind: 'action',
					resource: chat,
					action: {
						type: ActionType.ChatReasoning,
						turnId,
						partId: makeContentBlockPartId(turnId, state, event.index, logService),
						content: event.delta.thinking,
					},
				}];
			}
			if (event.delta.type === 'input_json_delta') {
				const tracked = state.getActiveToolBlock(event.index);
				if (!tracked) {
					logService.warn(`[claudeMapSessionEvents] input_json_delta for unknown content-block index ${event.index}`);
					return [];
				}
				state.appendToolBlockInputDelta(event.index, event.delta.partial_json);
				if (!tracked.isClientTool && isClaudeFileEditTool(tracked.toolName)) {
					const update = state.toolCalls.streamingInputUpdate(tracked.toolUseId);
					if (!update) {
						return [];
					}
					return [fileEditToolDelta(chat, turnId, tracked.toolUseId, update.invocationMessage)];
				}
				return [{
					kind: 'action',
					resource: chat,
					action: {
						type: ActionType.ChatToolCallDelta,
						turnId,
						toolCallId: tracked.toolUseId,
						content: event.delta.partial_json,
					},
				}];
			}
			return [];
		}

		case 'content_block_stop': {
			const tracked = state.getActiveToolBlock(event.index);
			const finalStreamingUpdate = tracked && !tracked.isClientTool && isClaudeFileEditTool(tracked.toolName)
				? state.toolCalls.streamingInputUpdate(tracked.toolUseId, true)
				: undefined;
			state.finalizeToolBlock(event.index);
			state.endToolBlock(event.index);
			if (!tracked) {
				return [];
			}
			const entry = state.toolCalls.lookup(tracked.toolUseId);
			const info = entry?.info;
			if (!info) {
				return [];
			}
			const meta = tracked.isClientTool ? undefined : buildClaudeToolMeta(tracked.toolName);
			const signals: AgentSignal[] = [];
			if (finalStreamingUpdate) {
				signals.push(fileEditToolDelta(chat, turnId, tracked.toolUseId, finalStreamingUpdate.invocationMessage));
			}
			signals.push({
				kind: 'action',
				resource: chat,
				action: {
					type: ActionType.ChatToolCallReady,
					turnId,
					toolCallId: tracked.toolUseId,
					invocationMessage: info.invocationMessage,
					...(info.toolInput !== undefined ? { toolInput: info.toolInput } : {}),
					confirmed: ToolCallConfirmationReason.NotNeeded,
					...(meta ? { _meta: meta } : {}),
				},
			});
			return signals;
		}

		case 'message_delta':
		case 'message_stop':
			return [];

		default:
			return [];
	}
}

function makeContentBlockPartId(
	turnId: string,
	state: ClaudeMapperState,
	index: number,
	logService: ILogService,
): string {
	const messageId = state.getCurrentMessageId();
	if (messageId === undefined) {
		logService.warn(`[claudeMapSessionEvents] content block at index ${index} arrived before message_start; using turn-scoped id`);
		return `${turnId}#${index}`;
	}
	return `${turnId}#${messageId}#${index}`;
}
