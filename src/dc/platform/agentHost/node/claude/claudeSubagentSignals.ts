/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { URI } from '../../../../base/common/uri.js';
import type { Mutable } from '../../../../base/common/types.js';
import { toToolCallMeta, type IToolCallMeta } from '../../common/meta/agentToolCallMeta.js';
import type { AgentSignal, IAgentSubagentStartedSignal } from '../../common/agent.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { ResponsePartKind, ToolCallConfirmationReason, ToolCallContributorKind } from '../../common/state/sessionState.js';
import type { ClaudeMapperState } from './claudeMapSessionEvents.js';
import { SUBAGENT_TOOL_NAMES, type SubagentRegistry } from './claudeSubagentRegistry.js';
import { buildClaudeToolCallMeta, buildClaudeToolMeta, getClaudeInvocationMessage, getClaudeToolDisplayName, getClaudeToolInputString } from './claudeToolDisplay.js';
import { hasClientToolNamePrefix, stripClientToolNamePrefix } from './clientTools/claudeClientToolMcpServer.js';

export const SUBAGENT_SPAWNING_TOOL_NAMES: ReadonlySet<string> = SUBAGENT_TOOL_NAMES;

export function tagWithParent(
	signals: AgentSignal[],
	chat: URI,
	parentToolUseId: string | null,
	registry: SubagentRegistry,
): AgentSignal[] {
	if (!parentToolUseId) {
		return signals;
	}
	const tagged: AgentSignal[] = signals.map(s => {
		if (s.kind === 'action') {
			return { ...s, parentToolCallId: parentToolUseId };
		}
		if (s.kind === 'pending_confirmation') {
			return { ...s, parentToolCallId: parentToolUseId };
		}
		if (s.kind === 'model_call_completed') {
			return { ...s, parentToolCallId: parentToolUseId };
		}
		return s;
	});
	const spawn = registry.getSpawn(parentToolUseId);
	if (!spawn || !spawn.markAnnounced()) {
		return tagged;
	}
	const started: IAgentSubagentStartedSignal = {
		kind: 'subagent_started',
		chat,
		toolCallId: parentToolUseId,
		agentName: spawn.subagentType ?? 'subagent',
		agentDisplayName: spawn.subagentType ?? 'Subagent',
		agentDescription: spawn.description,
		taskDescription: spawn.description,
		taskPrompt: spawn.prompt,
		parentToolCallId: registry.getParentSpawn(parentToolUseId)?.toolUseId,
	};
	return [started, ...tagged];
}

export function mapSubagentSystemMessage(
	message: Extract<SDKMessage, { type: 'system' }>,
	chat: URI,
	registry: SubagentRegistry,
): AgentSignal[] {
	const sub = (message as { subtype?: string }).subtype;
	if (sub === 'task_started') {
		const toolUseId = (message as { tool_use_id?: string }).tool_use_id;
		const spawn = toolUseId ? registry.getSpawn(toolUseId) : undefined;
		if (spawn) {
			spawn.background = true;
		}
		return [];
	}
	if (sub === 'task_notification') {
		const m = message as { tool_use_id?: string; status?: string };
		if (!m.tool_use_id) {
			return [];
		}
		const status = m.status;
		if (status !== 'completed' && status !== 'failed' && status !== 'stopped') {
			return [];
		}
		const spawn = registry.getSpawn(m.tool_use_id);
		if (!spawn || !spawn.markCompleted()) {
			return [];
		}
		const toolUseId = m.tool_use_id;
		registry.removeSpawn(toolUseId);
		return [{ kind: 'subagent_completed', chat, toolCallId: toolUseId }];
	}
	return [];
}

export function buildTopLevelSubagentReadyAction(
	block: Extract<import('@anthropic-ai/claude-agent-sdk').SDKAssistantMessage['message']['content'][number], { type: 'tool_use' }>,
	chat: URI,
	turnId: string,
	registry: SubagentRegistry,
): AgentSignal {
	const input = block.input as Record<string, unknown> | undefined;
	const description = typeof input?.description === 'string' ? input.description : undefined;
	const agentName = typeof input?.subagent_type === 'string' ? input.subagent_type : undefined;
	const prompt = typeof input?.prompt === 'string' ? input.prompt : undefined;
	const inputJson = block.input !== undefined ? safeStringify(block.input) : undefined;
	registry.recordSpawn(block.id, { subagentType: agentName, description, prompt });
	const meta: Mutable<IToolCallMeta> = { ...buildClaudeToolCallMeta(block.name) };
	if (!meta.toolKind) {
		meta.toolKind = 'subagent';
	}
	if (description) {
		meta.subagentDescription = description;
	}
	if (agentName) {
		meta.subagentAgentName = agentName;
	}
	return {
		kind: 'action',
		resource: chat,
		action: {
			type: ActionType.ChatToolCallReady,
			turnId,
			toolCallId: block.id,
			invocationMessage: getClaudeInvocationMessage(block.name, getClaudeToolDisplayName(block.name), block.input),
			...(inputJson !== undefined ? { toolInput: inputJson } : {}),
			confirmed: ToolCallConfirmationReason.NotNeeded,
			_meta: toToolCallMeta(meta),
		},
	};
}

export function emitInnerAssistantSignals(
	message: Extract<SDKMessage, { type: 'assistant' }>,
	chat: URI,
	turnId: string,
	state: ClaudeMapperState,
	parentToolUseId: string,
	registry: SubagentRegistry,
	clientToolOwner?: (toolName: string) => string | undefined,
): AgentSignal[] {
	const messageId = message.message.id;
	const signals: AgentSignal[] = [];
	for (let index = 0; index < message.message.content.length; index++) {
		const block = message.message.content[index];
		if (block.type === 'text') {
			signals.push({
				kind: 'action',
				resource: chat,
				action: {
					type: ActionType.ChatResponsePart,
					turnId,
					part: {
						kind: ResponsePartKind.Markdown,
						id: `${turnId}#${messageId}#${index}`,
						content: block.text,
					},
				},
			});
			continue;
		}
		if (block.type === 'thinking') {
			signals.push({
				kind: 'action',
				resource: chat,
				action: {
					type: ActionType.ChatResponsePart,
					turnId,
					part: {
						kind: ResponsePartKind.Reasoning,
						id: `${turnId}#${messageId}#${index}`,
						content: block.thinking,
					},
				},
			});
			continue;
		}
		if (block.type === 'tool_use') {
			const toolName = stripClientToolNamePrefix(block.name);
			const isClientTool = hasClientToolNamePrefix(block.name);
			const clientId = isClientTool ? clientToolOwner?.(toolName) : undefined;
			state.startToolBlock(index, block.id, toolName, turnId, isClientTool);
			state.toolCalls.seedParsedInput(block.id, block.input);
			registry.noteInnerTool(block.id, parentToolUseId);
			const displayName = isClientTool ? toolName : getClaudeToolDisplayName(toolName);
			const meta = isClientTool ? undefined : buildClaudeToolMeta(toolName);
			const info = state.toolCalls.lookup(block.id)?.info;
			const toolInputStr = info?.toolInput ?? getClaudeToolInputString(toolName, block.input);
			signals.push({
				kind: 'action',
				resource: chat,
				action: {
					type: ActionType.ChatToolCallStart,
					turnId,
					toolCallId: block.id,
					toolName,
					displayName,
					...(clientId ? { contributor: { kind: ToolCallContributorKind.Client, clientId } } : {}),
					...(meta ? { _meta: meta } : {}),
				},
			});
			signals.push({
				kind: 'action',
				resource: chat,
				action: {
					type: ActionType.ChatToolCallReady,
					turnId,
					toolCallId: block.id,
					invocationMessage: isClientTool ? displayName : getClaudeInvocationMessage(toolName, displayName, block.input),
					...(toolInputStr !== undefined ? { toolInput: toolInputStr } : {}),
					confirmed: ToolCallConfirmationReason.NotNeeded,
				},
			});
			continue;
		}
	}
	return signals;
}

function safeStringify(value: unknown): string | undefined {
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}
