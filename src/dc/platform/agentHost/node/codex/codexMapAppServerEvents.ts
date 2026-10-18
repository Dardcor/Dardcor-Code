/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import type { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import type { IAgentModelCallCompletedSignal } from '../../common/agent.js';
import { toToolCallMeta } from '../../common/meta/agentToolCallMeta.js';
import { ActionType, type SessionAction, type ChatAction } from '../../common/state/sessionActions.js';
import { createErrorResponsePart, MessageKind, ResponsePartKind, ToolCallConfirmationReason, ToolCallContributorKind, ToolResultContentType, TurnState, type ErrorInfo } from '../../common/state/sessionState.js';
import { extractForwardedErrorInfo } from '../shared/proxyChatError.js';
import { getServerToolDisplay } from '../shared/serverToolGroups.js';
import { ActiveClientToolSet } from '../activeClientState.js';
import { toAgentMessageDelegationMeta } from '../../common/meta/agentMessageDelegationMeta.js';
import { parseCodexDelegation } from './codexDelegation.js';
import { unwrapShellInvocation } from './codexShellCommand.js';
import type { AgentMessageDeltaNotification } from './protocol/generated/v2/AgentMessageDeltaNotification.js';
import type { CommandExecutionOutputDeltaNotification } from './protocol/generated/v2/CommandExecutionOutputDeltaNotification.js';
import type { FileChangeOutputDeltaNotification } from './protocol/generated/v2/FileChangeOutputDeltaNotification.js';
import type { FileChangePatchUpdatedNotification } from './protocol/generated/v2/FileChangePatchUpdatedNotification.js';
import type { FileUpdateChange } from './protocol/generated/v2/FileUpdateChange.js';
import type { ItemCompletedNotification } from './protocol/generated/v2/ItemCompletedNotification.js';
import type { ItemStartedNotification } from './protocol/generated/v2/ItemStartedNotification.js';
import type { McpToolCallProgressNotification } from './protocol/generated/v2/McpToolCallProgressNotification.js';
import type { McpToolCallResult } from './protocol/generated/v2/McpToolCallResult.js';
import type { ReasoningSummaryPartAddedNotification } from './protocol/generated/v2/ReasoningSummaryPartAddedNotification.js';
import type { ReasoningSummaryTextDeltaNotification } from './protocol/generated/v2/ReasoningSummaryTextDeltaNotification.js';
import type { ReasoningTextDeltaNotification } from './protocol/generated/v2/ReasoningTextDeltaNotification.js';
import type { ThreadTokenUsageUpdatedNotification } from './protocol/generated/v2/ThreadTokenUsageUpdatedNotification.js';
import type { TurnCompletedNotification } from './protocol/generated/v2/TurnCompletedNotification.js';
import type { TurnError } from './protocol/generated/v2/TurnError.js';
import type { TurnStartedNotification } from './protocol/generated/v2/TurnStartedNotification.js';
import type { UserInput } from './protocol/generated/v2/UserInput.js';
import type { WebSearchAction } from './protocol/generated/v2/WebSearchAction.js';
import type { DynamicToolCallOutputContentItem } from './protocol/generated/v2/DynamicToolCallOutputContentItem.js';
import type { JsonValue } from './protocol/generated/serde_json/JsonValue.js';
import type { CollabAgentTool } from './protocol/generated/v2/CollabAgentTool.js';
import type { CollabAgentState } from './protocol/generated/v2/CollabAgentState.js';

export interface ICodexSessionMapState {
	readonly itemToPartId: Map<string, string>;
	readonly itemToToolCall: Map<string, ICodexToolCallEntry>;
	readonly itemToReasoningPartId: Map<string, string>;
	currentTurnId: string | undefined;
	clientToolSet: ActiveClientToolSet;
	serverToolNames: ReadonlySet<string>;
	readonly mcpCustomizationIds: Map<string, string>;
	readonly declinedToolCalls: Set<string>;
	readonly deferredResponseActions: (SessionAction | ChatAction)[];
	pendingPreflight: ICodexPendingPreflight | undefined;
	agentMessagePartCount: number;
}

interface ICodexPendingPreflight {
	readonly toolCallId: string;
	readonly turnId: string;
	readonly command: string;
	readonly completion: (SessionAction | ChatAction)[];
}

export interface ICodexToolCallEntry {
	readonly toolCallId: string;
	readonly turnId: string;
	readonly toolName: string;
	output: string;
	progressMessage?: string;
	meta?: Record<string, unknown>;
}

export function createCodexSessionMapState(serverToolNames: ReadonlySet<string> = new Set(), clientToolSet: ActiveClientToolSet = new ActiveClientToolSet()): ICodexSessionMapState {
	return {
		itemToPartId: new Map(),
		itemToToolCall: new Map(),
		itemToReasoningPartId: new Map(),
		currentTurnId: undefined,
		clientToolSet,
		serverToolNames,
		mcpCustomizationIds: new Map(),
		declinedToolCalls: new Set(),
		deferredResponseActions: [],
		pendingPreflight: undefined,
		agentMessagePartCount: 0,
	};
}

export function resetCodexTurnMapState(state: ICodexSessionMapState): void {
	state.itemToPartId.clear();
	state.itemToToolCall.clear();
	state.itemToReasoningPartId.clear();
	state.declinedToolCalls.clear();
	state.deferredResponseActions.length = 0;
	state.pendingPreflight = undefined;
	state.agentMessagePartCount = 0;
}

export function finalizeCodexTurnMapState(state: ICodexSessionMapState, unresolvedToolMessage: string): (SessionAction | ChatAction)[] {
	const preflightFlush = flushPendingPreflight(state);
	const orphanedToolCallActions = completeOrphanedToolCalls(state, unresolvedToolMessage);
	const deferredResponseActions = flushDeferredResponseActions(state);
	resetCodexTurnMapState(state);
	return [...preflightFlush, ...orphanedToolCallActions, ...deferredResponseActions];
}

function flushPendingPreflight(state: ICodexSessionMapState): (SessionAction | ChatAction)[] {
	const pending = state.pendingPreflight;
	if (!pending) {
		return [];
	}
	state.pendingPreflight = undefined;
	return pending.completion;
}

function deferResponseWhileToolCallIsOpen(state: ICodexSessionMapState, actions: (SessionAction | ChatAction)[]): (SessionAction | ChatAction)[] {
	if (!hasOpenCommandExecution(state) && !state.pendingPreflight) {
		return actions;
	}
	state.deferredResponseActions.push(...actions);
	return [];
}

function flushDeferredResponseActions(state: ICodexSessionMapState): (SessionAction | ChatAction)[] {
	if (hasOpenCommandExecution(state) || state.pendingPreflight || state.deferredResponseActions.length === 0) {
		return [];
	}
	return state.deferredResponseActions.splice(0);
}

function hasOpenCommandExecution(state: ICodexSessionMapState): boolean {
	return [...state.itemToToolCall.values()].some(entry => entry.toolName === 'shell');
}

function completeOrphanedToolCalls(state: ICodexSessionMapState, errorMessage: string): (SessionAction | ChatAction)[] {
	const orphanedToolCalls = [...state.itemToToolCall.values()];
	state.itemToToolCall.clear();
	return orphanedToolCalls.map(entry => ({
		type: ActionType.ChatToolCallComplete,
		turnId: entry.turnId,
		toolCallId: entry.toolCallId,
		result: {
			success: false,
			pastTenseMessage: `Stopped ${entry.toolName}`,
			content: entry.output ? [{ type: ToolResultContentType.Text as const, text: entry.output }] : undefined,
			error: { message: errorMessage },
		},
	}));
}

export function extractUserInputText(content: readonly UserInput[]): string {
	const collected: string[] = [];
	for (const c of content) {
		if (c.type === 'text') {
			collected.push(c.text);
		}
	}
	return collected.join('\n\n');
}

function reasoningKey(itemId: string, kind: 'summary' | 'text', index: number): string {
	return `${itemId}:${kind}:${index}`;
}

function ensureReasoningPart(state: ICodexSessionMapState, turnId: string, key: string): { readonly partId: string; readonly actions: (SessionAction | ChatAction)[] } {
	const existing = state.itemToReasoningPartId.get(key);
	if (existing) {
		return { partId: existing, actions: [] };
	}
	const partId = generateUuid();
	state.itemToReasoningPartId.set(key, partId);
	return {
		partId,
		actions: [{
			type: ActionType.ChatResponsePart,
			turnId,
			part: { kind: ResponsePartKind.Reasoning, id: partId, content: '' },
		}],
	};
}

export function describeWebSearch(query: string, action: WebSearchAction | null): string {
	if (action?.type === 'search') {
		return action.queries?.join(', ') ?? action.query ?? query;
	}
	if (action?.type === 'openPage') {
		return action.url ?? query;
	}
	if (action?.type === 'findInPage') {
		return [action.pattern, action.url].filter(Boolean).join(' in ') || query;
	}
	return query;
}

export function webSearchInvocationMessage(query: string): string {
	return localize('codex.webSearch.inProgress', "Searching the web for {0}", query);
}

export function webSearchPastTenseMessage(query: string): string {
	return localize('codex.webSearch.completed', "Searched the web for {0}", query);
}

export function describeFileChange(changes: readonly FileUpdateChange[]): string {
	return changes.map(change => {
		const kind = change.kind.type === 'update' && change.kind.move_path
			? `rename from ${change.kind.move_path}`
			: change.kind.type;
		return `${kind}: ${change.path}`;
	}).join('\n');
}

export function fileChangeOutput(changes: readonly FileUpdateChange[]): string {
	return changes.map(change => `${describeFileChange([change])}\n${change.diff}`.trim()).join('\n\n');
}

export function codexCompactionLabels(): { readonly displayName: string; readonly invocationMessage: string; readonly pastTenseMessage: string } {
	return {
		displayName: localize('codex.compaction.displayName', "Compact conversation"),
		invocationMessage: localize('codex.compaction.inProgress', "Compacting conversation"),
		pastTenseMessage: localize('codex.compaction.completed', "Compacted conversation"),
	};
}

export function codexImageGenerationLabels(status?: string): { readonly displayName: string; readonly invocationMessage: string; readonly pastTenseMessage: string; readonly failedMessage: string; readonly errorMessage: string } {
	return {
		displayName: localize('codex.imageGeneration.displayName', "Generate image"),
		invocationMessage: localize('codex.imageGeneration.inProgress', "Generating image"),
		pastTenseMessage: localize('codex.imageGeneration.completed', "Generated image"),
		failedMessage: localize('codex.imageGeneration.failed', "Failed to generate image"),
		errorMessage: localize('codex.imageGeneration.error', "Image generation {0}", status ?? ''),
	};
}

function jsonValueToText(value: JsonValue): string {
	return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function toolInputText(value: JsonValue): string {
	return JSON.stringify(value, null, 2);
}

function dynamicToolOutput(contentItems: readonly DynamicToolCallOutputContentItem[] | null): string {
	return contentItems?.map(item => item.type === 'inputText' ? item.text : item.type === 'inputImage' ? item.imageUrl : item.audioUrl).join('\n') ?? '';
}

function mcpToolOutput(result: McpToolCallResult | null, errorMessage?: string): string {
	if (errorMessage) {
		return errorMessage;
	}
	if (!result) {
		return '';
	}
	const content = result.content.map(jsonValueToText).join('\n');
	const structuredContent = result.structuredContent !== null ? jsonValueToText(result.structuredContent) : '';
	return [content, structuredContent].filter(Boolean).join('\n');
}

function collabAgentToolLabels(tool: CollabAgentTool): { readonly displayName: string; readonly present: string; readonly past: string } {
	switch (tool) {
		case 'spawnAgent': return { displayName: 'Spawn agent', present: 'Spawning agent', past: 'Spawned agent' };
		case 'sendInput': return { displayName: 'Send input to agent', present: 'Sending input to agent', past: 'Sent input to agent' };
		case 'resumeAgent': return { displayName: 'Resume agent', present: 'Resuming agent', past: 'Resumed agent' };
		case 'wait': return { displayName: 'Wait for agents', present: 'Waiting for agents', past: 'Finished waiting' };
		case 'closeAgent': return { displayName: 'Close agent', present: 'Closing agent', past: 'Closed agent' };
		default: return { displayName: tool, present: tool, past: tool };
	}
}

function collabAgentStateSummary(state: CollabAgentState): string {
	switch (state.status) {
		case 'completed': return state.message ? `Completed — ${state.message}` : 'Completed';
		case 'errored': return state.message ? `Errored — ${state.message}` : 'Errored';
		case 'running': return state.message ? `Running — ${state.message}` : 'Running';
		case 'interrupted': return state.message ? `Interrupted — ${state.message}` : 'Interrupted';
		case 'pendingInit': return 'Pending init';
		case 'shutdown': return 'Shutdown';
		case 'notFound': return 'Not found';
		default: return state.status;
	}
}

function collabAgentResultOutput(receiverThreadIds: readonly string[], agentsStates: { readonly [key: string]: CollabAgentState | undefined }): string {
	const seen = new Set<string>();
	const states: CollabAgentState[] = [];
	for (const id of receiverThreadIds) {
		const state = agentsStates[id];
		if (state) {
			states.push(state);
			seen.add(id);
		}
	}
	for (const id of Object.keys(agentsStates).sort()) {
		if (seen.has(id)) {
			continue;
		}
		const state = agentsStates[id];
		if (state) {
			states.push(state);
		}
	}
	if (states.length === 0) {
		return '';
	}
	if (states.length === 1) {
		return collabAgentStateSummary(states[0]);
	}
	return states.map((state, index) => `Agent ${index + 1}: ${collabAgentStateSummary(state)}`).join('\n');
}

export function mapTurnStarted(
	state: ICodexSessionMapState,
	params: TurnStartedNotification,
	fallbackUserText: string,
): (SessionAction | ChatAction)[] {
	state.currentTurnId = params.turn.id;
	resetCodexTurnMapState(state);
	let userText = fallbackUserText;
	const first = params.turn.items?.[0];
	if (first && first.type === 'userMessage') {
		const collected = extractUserInputText(first.content);
		if (collected.length > 0) {
			userText = collected;
		}
	}
	const delegation = parseCodexDelegation(userText);
	return [
		{
			type: ActionType.ChatTurnStarted,
			turnId: params.turn.id,
			startedAt: typeof params.turn.startedAt === 'number' ? new Date(params.turn.startedAt * 1000).toISOString() : new Date().toISOString(),
			message: {
				text: delegation?.input ?? userText,
				origin: { kind: MessageKind.User },
				...(delegation ? { _meta: toAgentMessageDelegationMeta({ sourceThreadId: delegation.sourceThreadId }) } : {}),
			},
		},
	];
}

export function mapReasoningSummaryPartAdded(
	state: ICodexSessionMapState,
	params: ReasoningSummaryPartAddedNotification,
): (SessionAction | ChatAction)[] {
	return deferResponseWhileToolCallIsOpen(state, ensureReasoningPart(state, params.turnId, reasoningKey(params.itemId, 'summary', params.summaryIndex)).actions);
}

export function mapReasoningSummaryTextDelta(
	state: ICodexSessionMapState,
	params: ReasoningSummaryTextDeltaNotification,
): (SessionAction | ChatAction)[] {
	const ensured = ensureReasoningPart(state, params.turnId, reasoningKey(params.itemId, 'summary', params.summaryIndex));
	return deferResponseWhileToolCallIsOpen(state, [
		...ensured.actions,
		{ type: ActionType.ChatReasoning, turnId: params.turnId, partId: ensured.partId, content: params.delta },
	]);
}

export function mapReasoningTextDelta(
	state: ICodexSessionMapState,
	params: ReasoningTextDeltaNotification,
): (SessionAction | ChatAction)[] {
	const ensured = ensureReasoningPart(state, params.turnId, reasoningKey(params.itemId, 'text', params.contentIndex));
	return deferResponseWhileToolCallIsOpen(state, [
		...ensured.actions,
		{ type: ActionType.ChatReasoning, turnId: params.turnId, partId: ensured.partId, content: params.delta },
	]);
}

export function clearReasoningForItem(state: ICodexSessionMapState, itemId: string): void {
	for (const key of [...state.itemToReasoningPartId.keys()]) {
		if (key.startsWith(`${itemId}:`)) {
			state.itemToReasoningPartId.delete(key);
		}
	}
}

export function mapTokenUsageUpdated(params: ThreadTokenUsageUpdatedNotification, modelId?: string): (SessionAction | ChatAction)[] {
	const last = params.tokenUsage.last;
	return [{
		type: ActionType.ChatUsage,
		turnId: params.turnId,
		usage: {
			inputTokens: last.inputTokens,
			outputTokens: last.outputTokens,
			...(modelId ? { model: modelId } : {}),
			cacheReadTokens: last.cachedInputTokens,
			_meta: {
				reasoningOutputTokens: last.reasoningOutputTokens,
				modelContextWindow: params.tokenUsage.modelContextWindow,
			},
		},
	}];
}

export function mapTokenUsageModelCallCompleted(params: ThreadTokenUsageUpdatedNotification, resource: URI): IAgentModelCallCompletedSignal {
	const total = params.tokenUsage.total;
	return {
		kind: 'model_call_completed',
		resource,
		turnId: params.turnId,
		modelCallId: [
			total.inputTokens,
			total.cachedInputTokens,
			total.cacheWriteInputTokens,
			total.outputTokens,
			total.reasoningOutputTokens,
			total.totalTokens,
		].join(':'),
	};
}

export function mapItemStarted(
	state: ICodexSessionMapState,
	params: ItemStartedNotification,
): (SessionAction | ChatAction)[] {
	if (params.item.type === 'commandExecution') {
		const pending = state.pendingPreflight;
		if (pending && pending.turnId === params.turnId && pending.command === unwrapShellInvocation(params.item.command ?? '')) {
			state.pendingPreflight = undefined;
			state.itemToToolCall.set(params.item.id, {
				toolCallId: pending.toolCallId,
				turnId: params.turnId,
				toolName: 'shell',
				output: '',
			});
			return [];
		}
	}
	const flushed = flushPendingPreflight(state);
	const deferredResponseActions = flushDeferredResponseActions(state);
	const body = mapItemStartedBody(state, params);
	const orderedBody = params.item.type === 'agentMessage'
		? deferResponseWhileToolCallIsOpen(state, body)
		: body;
	return [...flushed, ...deferredResponseActions, ...orderedBody];
}

function mapItemStartedBody(
	state: ICodexSessionMapState,
	params: ItemStartedNotification,
): (SessionAction | ChatAction)[] {
	if (params.item.type === 'agentMessage') {
		const partId = generateUuid();
		state.itemToPartId.set(params.item.id, partId);
		const separator = state.agentMessagePartCount > 0 ? '\n\n' : '';
		state.agentMessagePartCount++;
		return [
			{
				type: ActionType.ChatResponsePart,
				turnId: params.turnId,
				part: {
					kind: ResponsePartKind.Markdown,
					id: partId,
					content: separator + (params.item.text ?? ''),
				},
			},
		];
	}
	if (params.item.type === 'commandExecution') {
		const toolCallId = generateUuid();
		const meta = toToolCallMeta({ toolKind: 'terminal' });
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName: 'shell',
			output: '',
			meta,
		});
		const command = unwrapShellInvocation(params.item.command ?? '');
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName: 'shell',
				displayName: 'Run shell command',
				_meta: meta,
			},
			{
				type: ActionType.ChatToolCallDelta,
				turnId: params.turnId,
				toolCallId,
				content: command,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: command,
				toolInput: command,
				confirmed: ToolCallConfirmationReason.NotNeeded,
				_meta: meta,
			},
		];
	}
	if (params.item.type === 'webSearch') {
		const toolCallId = generateUuid();
		const meta = toToolCallMeta({ toolKind: 'search' });
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName: 'web_search',
			output: '',
			meta,
		});
		const query = describeWebSearch(params.item.query, params.item.action);
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName: 'web_search',
				displayName: 'Web search',
				_meta: meta,
			},
			{
				type: ActionType.ChatToolCallDelta,
				turnId: params.turnId,
				toolCallId,
				content: query,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: webSearchInvocationMessage(query),
				toolInput: query,
				confirmed: ToolCallConfirmationReason.NotNeeded,
				_meta: meta,
			},
		];
	}
	if (params.item.type === 'imageGeneration') {
		const toolCallId = generateUuid();
		const labels = codexImageGenerationLabels();
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName: 'image_gen.imagegen',
			output: '',
		});
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName: 'image_gen.imagegen',
				displayName: labels.displayName,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: labels.invocationMessage,
				toolInput: JSON.stringify({ prompt: params.item.revisedPrompt ?? labels.displayName }),
				confirmed: ToolCallConfirmationReason.NotNeeded,
			},
		];
	}
	if (params.item.type === 'fileChange') {
		const toolCallId = generateUuid();
		const output = fileChangeOutput(params.item.changes);
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName: 'file_edit',
			output,
		});
		const summary = describeFileChange(params.item.changes) || 'Apply file changes';
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName: 'file_edit',
				displayName: 'Apply file changes',
			},
			{
				type: ActionType.ChatToolCallDelta,
				turnId: params.turnId,
				toolCallId,
				content: summary,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: summary,
				toolInput: summary,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			},
			...(output ? [{
				type: ActionType.ChatToolCallContentChanged,
				turnId: params.turnId,
				toolCallId,
				content: [{ type: ToolResultContentType.Text, text: output }],
			} satisfies SessionAction | ChatAction] : []),
		];
	}
	if (params.item.type === 'mcpToolCall') {
		const toolCallId = generateUuid();
		const toolName = `${params.item.server}.${params.item.tool}`;
		const toolInput = toolInputText(params.item.arguments);
		const customizationId = state.mcpCustomizationIds.get(params.item.server);
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName,
			output: '',
		});
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName,
				displayName: params.item.tool,
				...(customizationId ? { contributor: { kind: ToolCallContributorKind.MCP, customizationId } } : {}),
			},
			{
				type: ActionType.ChatToolCallDelta,
				turnId: params.turnId,
				toolCallId,
				content: toolInput,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: `Calling ${toolName}`,
				toolInput,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			},
		];
	}
	if (params.item.type === 'dynamicToolCall') {
		const toolCallId = generateUuid();
		const toolName = params.item.namespace ? `${params.item.namespace}.${params.item.tool}` : params.item.tool;
		const toolInput = toolInputText(params.item.arguments);
		const output = dynamicToolOutput(params.item.contentItems);
		const isServerTool = params.item.namespace === null && state.serverToolNames.has(params.item.tool);
		const ownerClientId = isServerTool ? undefined : state.clientToolSet.ownerOf(params.item.tool);
		const serverDisplay = getServerToolDisplay(params.item.tool, params.item.arguments);
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName,
			output,
		});
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName,
				displayName: serverDisplay?.displayName ?? params.item.tool,
				...(ownerClientId ? { contributor: { kind: ToolCallContributorKind.Client, clientId: ownerClientId } } : {}),
			},
			{
				type: ActionType.ChatToolCallDelta,
				turnId: params.turnId,
				toolCallId,
				content: toolInput,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: serverDisplay?.invocationMessage ?? `Calling ${toolName}`,
				toolInput,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			},
			...(output ? [{
				type: ActionType.ChatToolCallContentChanged,
				turnId: params.turnId,
				toolCallId,
				content: [{ type: ToolResultContentType.Text, text: output }],
			} satisfies SessionAction | ChatAction] : []),
		];
	}
	if (params.item.type === 'collabAgentToolCall') {
		const toolCallId = generateUuid();
		const labels = collabAgentToolLabels(params.item.tool);
		const toolName = `codex.${params.item.tool}`;
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName,
			output: '',
		});
		if (params.item.tool === 'spawnAgent') {
			return [
				{
					type: ActionType.ChatToolCallStart,
					turnId: params.turnId,
					toolCallId,
					toolName,
					displayName: labels.displayName,
				},
				{
					type: ActionType.ChatToolCallReady,
					turnId: params.turnId,
					toolCallId,
					invocationMessage: labels.present,
					confirmed: ToolCallConfirmationReason.NotNeeded,
				},
			];
		}
		const inputParts: string[] = [];
		if (params.item.prompt) {
			inputParts.push(params.item.prompt);
		}
		if (params.item.model) {
			inputParts.push(`Model: ${params.item.model}`);
		}
		const toolInput = inputParts.join('\n\n');
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName,
				displayName: labels.displayName,
			},
			...(toolInput ? [{
				type: ActionType.ChatToolCallDelta,
				turnId: params.turnId,
				toolCallId,
				content: toolInput,
			} satisfies SessionAction | ChatAction] : []),
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: labels.present,
				toolInput,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			},
		];
	}
	if (params.item.type === 'contextCompaction') {
		const toolCallId = generateUuid();
		const labels = codexCompactionLabels();
		state.itemToToolCall.set(params.item.id, {
			toolCallId,
			turnId: params.turnId,
			toolName: 'compact',
			output: '',
		});
		return [
			{
				type: ActionType.ChatToolCallStart,
				turnId: params.turnId,
				toolCallId,
				toolName: 'compact',
				displayName: labels.displayName,
			},
			{
				type: ActionType.ChatToolCallReady,
				turnId: params.turnId,
				toolCallId,
				invocationMessage: labels.invocationMessage,
				confirmed: ToolCallConfirmationReason.NotNeeded,
			},
		];
	}
	return [];
}

export function mapCommandExecutionOutputDelta(
	state: ICodexSessionMapState,
	params: CommandExecutionOutputDeltaNotification,
): (SessionAction | ChatAction)[] {
	const entry = state.itemToToolCall.get(params.itemId);
	if (!entry) {
		return [];
	}
	entry.output += params.delta;
	return [{
		type: ActionType.ChatToolCallContentChanged,
		turnId: entry.turnId,
		toolCallId: entry.toolCallId,
		content: [{ type: ToolResultContentType.Text, text: entry.output }],
	}];
}

export function mapFileChangePatchUpdated(
	state: ICodexSessionMapState,
	params: FileChangePatchUpdatedNotification,
): (SessionAction | ChatAction)[] {
	const entry = state.itemToToolCall.get(params.itemId);
	if (!entry) {
		return [];
	}
	entry.output = fileChangeOutput(params.changes);
	return [{
		type: ActionType.ChatToolCallContentChanged,
		turnId: entry.turnId,
		toolCallId: entry.toolCallId,
		content: entry.output ? [{ type: ToolResultContentType.Text, text: entry.output }] : [],
	}];
}

export function mapFileChangeOutputDelta(
	state: ICodexSessionMapState,
	params: FileChangeOutputDeltaNotification,
): (SessionAction | ChatAction)[] {
	const entry = state.itemToToolCall.get(params.itemId);
	if (!entry) {
		return [];
	}
	entry.output += params.delta;
	return [{
		type: ActionType.ChatToolCallContentChanged,
		turnId: entry.turnId,
		toolCallId: entry.toolCallId,
		content: [{ type: ToolResultContentType.Text, text: entry.output }],
	}];
}

export function mapMcpToolCallProgress(
	state: ICodexSessionMapState,
	params: McpToolCallProgressNotification,
): (SessionAction | ChatAction)[] {
	const entry = state.itemToToolCall.get(params.itemId);
	if (!entry || params.message === entry.progressMessage) {
		return [];
	}
	entry.progressMessage = params.message;
	return [{
		type: ActionType.ChatToolCallContentChanged,
		turnId: entry.turnId,
		toolCallId: entry.toolCallId,
		content: entry.output ? [{ type: ToolResultContentType.Text, text: entry.output }] : [],
		_meta: { ...entry.meta, ...toToolCallMeta({ progressMessage: params.message }) },
	}];
}

export function mapAgentMessageDelta(
	state: ICodexSessionMapState,
	params: AgentMessageDeltaNotification,
): (SessionAction | ChatAction)[] {
	const partId = state.itemToPartId.get(params.itemId);
	if (!partId) {
		return [];
	}
	return deferResponseWhileToolCallIsOpen(state, [
		{
			type: ActionType.ChatDelta,
			turnId: params.turnId,
			partId,
			content: params.delta,
		},
	]);
}

export function mapItemCompleted(
	state: ICodexSessionMapState,
	params: ItemCompletedNotification,
): (SessionAction | ChatAction)[] {
	if (params.item.type === 'agentMessage') {
		state.itemToPartId.delete(params.item.id);
		return [];
	}
	if (params.item.type === 'reasoning') {
		clearReasoningForItem(state, params.item.id);
		return [];
	}
	const entry = state.itemToToolCall.get(params.item.id);
	if (!entry) {
		return [];
	}
	state.itemToToolCall.delete(params.item.id);
	const declined = state.declinedToolCalls.delete(entry.toolCallId);
	if (params.item.type === 'contextCompaction') {
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result: {
				success: true,
				pastTenseMessage: codexCompactionLabels().pastTenseMessage,
			},
		}];
	}
	if (params.item.type === 'commandExecution') {
		const success = params.item.status === 'completed' && (params.item.exitCode === 0 || params.item.exitCode === null);
		const output = params.item.aggregatedOutput || entry.output;
		const command = unwrapShellInvocation(params.item.command ?? '');
		const exit = params.item.exitCode;
		const pastTense = success
			? `Ran \`${command}\``
			: exit !== null
				? `Ran \`${command}\` (exit ${exit})`
				: `Ran \`${command}\` (failed)`;
		const completion: (SessionAction | ChatAction)[] = [
			{
				type: ActionType.ChatToolCallComplete,
				turnId: entry.turnId,
				toolCallId: entry.toolCallId,
				result: {
					success,
					pastTenseMessage: pastTense,
					content: output
						? [{ type: ToolResultContentType.Text, text: output }]
						: undefined,
					error: success ? undefined : {
						message: exit !== null ? `Exit code ${exit}` : 'Command failed',
						...(declined ? { code: 'denied' } : {}),
					},
				},
			},
		];
		if (success && !output && !declined) {
			const flushed = flushPendingPreflight(state);
			state.pendingPreflight = { toolCallId: entry.toolCallId, turnId: entry.turnId, command, completion };
			return [...flushed, ...flushDeferredResponseActions(state)];
		}
		return [...flushPendingPreflight(state), ...completion, ...flushDeferredResponseActions(state)];
	}
	if (params.item.type === 'webSearch') {
		const query = describeWebSearch(params.item.query, params.item.action);
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result: {
				success: true,
				pastTenseMessage: webSearchPastTenseMessage(query),
			},
		}];
	}
	if (params.item.type === 'imageGeneration') {
		const success = params.item.status === 'completed' && params.item.result.length > 0;
		const labels = codexImageGenerationLabels(params.item.status);
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result: {
				success,
				pastTenseMessage: success ? labels.pastTenseMessage : labels.failedMessage,
				content: success ? [{
					type: ToolResultContentType.EmbeddedResource,
					data: params.item.result,
					contentType: 'image/png',
				}] : undefined,
				...(success ? {} : { error: { message: labels.errorMessage } }),
			},
		}];
	}
	if (params.item.type === 'fileChange') {
		const output = fileChangeOutput(params.item.changes) || entry.output;
		const success = params.item.status === 'completed';
		const summary = describeFileChange(params.item.changes) || 'Apply file changes';
		const content = output ? [{ type: ToolResultContentType.Text as const, text: output }] : undefined;
		const result = {
			success,
			pastTenseMessage: success ? summary : 'Failed to apply file changes',
			content,
			...(success ? {} : { error: { message: `Patch ${params.item.status}`, ...(declined ? { code: 'denied' } : {}) } }),
		};
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result,
		}];
	}
	if (params.item.type === 'mcpToolCall') {
		const success = params.item.status === 'completed' && !params.item.error;
		const output = mcpToolOutput(params.item.result, params.item.error?.message);
		const content = output ? [{ type: ToolResultContentType.Text as const, text: output }] : undefined;
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result: {
				success,
				pastTenseMessage: success ? `Called ${entry.toolName}` : `Failed to call ${entry.toolName}`,
				content,
				...(success ? {} : { error: { message: params.item.error?.message ?? `MCP tool ${params.item.status}`, ...(declined ? { code: 'denied' } : {}) } }),
			},
		}];
	}
	if (params.item.type === 'dynamicToolCall') {
		const success = params.item.success === true || params.item.status === 'completed';
		const output = dynamicToolOutput(params.item.contentItems) || entry.output;
		const content = output ? [{ type: ToolResultContentType.Text as const, text: output }] : undefined;
		const serverDisplay = success ? getServerToolDisplay(entry.toolName, params.item.arguments, { text: output, success }) : undefined;
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result: {
				success,
				pastTenseMessage: serverDisplay?.pastTenseMessage ?? serverDisplay?.invocationMessage ?? (success ? `Called ${entry.toolName}` : `Failed to call ${entry.toolName}`),
				content,
				...(success ? {} : { error: { message: `Dynamic tool ${params.item.status}`, ...(declined ? { code: 'denied' } : {}) } }),
			},
		}];
	}
	if (params.item.type === 'collabAgentToolCall') {
		const labels = collabAgentToolLabels(params.item.tool);
		const success = params.item.status === 'completed';
		const output = collabAgentResultOutput(params.item.receiverThreadIds, params.item.agentsStates) || entry.output;
		const content = output ? [{ type: ToolResultContentType.Text as const, text: output }] : undefined;
		return [{
			type: ActionType.ChatToolCallComplete,
			turnId: entry.turnId,
			toolCallId: entry.toolCallId,
			result: {
				success,
				pastTenseMessage: success ? labels.past : `${labels.displayName} failed`,
				content,
				...(success ? {} : { error: { message: `Collab agent ${params.item.status}`, ...(declined ? { code: 'denied' } : {}) } }),
			},
		}];
	}
	return [];
}

export function mapTurnCompleted(
	state: ICodexSessionMapState,
	params: TurnCompletedNotification,
	fallbackDuration?: number,
): (SessionAction | ChatAction)[] {
	state.currentTurnId = undefined;
	state.itemToPartId.clear();
	state.itemToReasoningPartId.clear();
	const recoveredToolCallActions: (SessionAction | ChatAction)[] = [];
	for (const item of params.turn.items) {
		if (item.type === 'commandExecution' && (item.exitCode !== null || item.status !== 'completed') && state.itemToToolCall.has(item.id)) {
			recoveredToolCallActions.push(...mapItemCompleted(state, {
				threadId: params.threadId,
				turnId: params.turn.id,
				item,
				completedAtMs: typeof params.turn.completedAt === 'number' ? params.turn.completedAt * 1000 : 0,
			}));
		}
	}
	const preflightFlush = flushPendingPreflight(state);
	const turnId = params.turn.id;
	const status = params.turn.status;
	const duration = typeof params.turn.durationMs === 'number' && Number.isFinite(params.turn.durationMs) && params.turn.durationMs >= 0
		? params.turn.durationMs
		: typeof params.turn.startedAt === 'number' && typeof params.turn.completedAt === 'number'
			? Math.max(0, (params.turn.completedAt - params.turn.startedAt) * 1000)
			: typeof fallbackDuration === 'number' && Number.isFinite(fallbackDuration)
				? Math.max(0, fallbackDuration)
				: 0;
	const orphanedToolCallActions = completeOrphanedToolCalls(state, status === 'interrupted' ? 'Turn interrupted before the tool completed' : 'Turn completed before the tool reported completion');
	const deferredResponseActions = flushDeferredResponseActions(state);
	if (status === 'failed' && params.turn.error) {
		return [
			...recoveredToolCallActions,
			...preflightFlush,
			...orphanedToolCallActions,
			...deferredResponseActions,
			{
				type: ActionType.ChatError,
				turnId,
				duration,
				part: createErrorResponsePart(mapCodexTurnError(params.turn.error)),
			},
			{
				type: ActionType.ChatTurnComplete,
				turnId,
				duration,
			},
		];
	}
	if (status === 'interrupted') {
		return [...recoveredToolCallActions, ...preflightFlush, ...orphanedToolCallActions, ...deferredResponseActions, { type: ActionType.ChatTurnCancelled, turnId, duration }];
	}
	return [...recoveredToolCallActions, ...preflightFlush, ...orphanedToolCallActions, ...deferredResponseActions, { type: ActionType.ChatTurnComplete, turnId, duration }];
}

export function mapCodexTurnError(error: TurnError): ErrorInfo {
	return {
		errorType: 'CodexError',
		...extractForwardedErrorInfo(error.message || 'Codex turn failed'),
		...(error.additionalDetails ? { stack: error.additionalDetails } : {}),
	};
}

export function turnStateFromStatus(status: string): TurnState {
	switch (status) {
		case 'completed':
			return TurnState.Complete;
		case 'interrupted':
			return TurnState.Cancelled;
		case 'failed':
			return TurnState.Error;
		default:
			return TurnState.Complete;
	}
}
