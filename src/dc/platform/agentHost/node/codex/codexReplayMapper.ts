/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js';
import { toAgentMessageDelegationMeta } from '../../common/meta/agentMessageDelegationMeta.js';
import { toToolCallMeta } from '../../common/meta/agentToolCallMeta.js';
import { SessionServerToolName } from '../../common/serverToolNames.js';
import {
	MessageKind,
	ResponsePartKind,
	ToolCallConfirmationReason,
	ToolCallStatus,
	ToolResultContentType,
	type ResponsePart,
	type ToolCallResponsePart,
	type ToolResultContent,
	type Turn,
	type ModelSelection,
} from '../../common/state/sessionState.js';
import {
	describeFileChange,
	describeWebSearch,
	codexCompactionLabels,
	codexImageGenerationLabels,
	fileChangeOutput,
	mapCodexTurnError,
	turnStateFromStatus,
	webSearchInvocationMessage,
	webSearchPastTenseMessage,
} from './codexMapAppServerEvents.js';
import { unwrapShellInvocation } from './codexShellCommand.js';
import { parseCodexDelegation } from './codexDelegation.js';
import { buildCodexThreadOpenLink, extractCodexCreatedThreadDirectives, getCodexThreadCoordinationCall, type ICodexThreadCoordinationCall } from './codexThreadCoordination.js';
import { getServerToolDisplay } from '../shared/serverToolGroups.js';
import type { Thread } from './protocol/generated/v2/Thread.js';
import type { ThreadItem } from './protocol/generated/v2/ThreadItem.js';
import type { Turn as CodexTurn } from './protocol/generated/v2/Turn.js';

export function replayThreadToTurns(
	thread: Thread,
	modelsByTurnId?: ReadonlyMap<string, ModelSelection>,
	_threadCoordinationByTurnId?: ReadonlyMap<string, readonly ICodexThreadCoordinationCall[]>,
): Turn[] {
	const turns: Turn[] = [];
	for (const codexTurn of thread.turns ?? []) {
		const turn = replayTurnToTurn(
			codexTurn,
			modelsByTurnId?.get(codexTurn.id),
			_threadCoordinationByTurnId?.get(codexTurn.id),
		);
		if (turn) {
			turns.push(turn);
		}
	}
	return turns;
}

type CommandExecutionItem = Extract<ThreadItem, { type: 'commandExecution' }>;

function replayTurnToTurn(codexTurn: CodexTurn, model: ModelSelection | undefined, rolloutCoordination: readonly ICodexThreadCoordinationCall[] | undefined): Turn | undefined {
	let userText = '';
	const parts: ResponsePart[] = [];
	const linkedCreatedThreadIds = new Set<string>();
	const remainingRolloutCoordination = new Map<string, number>();
	for (const coordination of rolloutCoordination ?? []) {
		const key = threadCoordinationKey(coordination);
		remainingRolloutCoordination.set(key, (remainingRolloutCoordination.get(key) ?? 0) + 1);
		if (coordination.toolName === SessionServerToolName.CreateSession) {
			linkedCreatedThreadIds.add(coordination.targetThreadId);
		}
		parts.push(threadCoordinationToolCallPart(coordination));
	}
	let agentMessageCount = 0;
	let pendingPreflight: { command: string; item: CommandExecutionItem } | undefined;
	const flushPreflight = () => {
		if (pendingPreflight) {
			parts.push(shellToolCallPart(pendingPreflight.item, pendingPreflight.command));
			pendingPreflight = undefined;
		}
	};

	for (const item of codexTurn.items ?? []) {
		if (item.type === 'commandExecution') {
			const command = unwrapShellInvocation(item.command ?? '');
			if (pendingPreflight && pendingPreflight.command === command) {
				pendingPreflight = undefined;
				parts.push(shellToolCallPart(item, command));
				continue;
			}
			flushPreflight();
			const success = item.status === 'completed' && (item.exitCode === 0 || item.exitCode === null);
			const output = item.aggregatedOutput ?? '';
			if (success && !output) {
				pendingPreflight = { command, item };
				continue;
			}
			parts.push(shellToolCallPart(item, command));
			continue;
		}

		flushPreflight();

		if (item.type === 'userMessage') {
			const collected: string[] = [];
			for (const c of item.content) {
				if (c.type === 'text') {
					collected.push(c.text);
				}
			}
			if (collected.length > 0) {
				userText = collected.join('\n\n');
			}
		} else if (item.type === 'agentMessage') {
			const message = extractCodexCreatedThreadDirectives(item.text ?? '');
			if (message.text.length > 0) {
				const separator = agentMessageCount > 0 ? '\n\n' : '';
				agentMessageCount++;
				parts.push({
					kind: ResponsePartKind.Markdown,
					id: generateUuid(),
					content: separator + message.text,
				});
			}
			for (const threadId of message.threadIds) {
				if (!linkedCreatedThreadIds.has(threadId)) {
					linkedCreatedThreadIds.add(threadId);
					parts.push(threadCoordinationToolCallPart({
						toolName: SessionServerToolName.CreateSession,
						targetThreadId: threadId,
						openLink: buildCodexThreadOpenLink(threadId),
						toolInput: { prompt: getServerToolPastTenseMessage(SessionServerToolName.CreateSession) },
					}));
				}
			}
		} else if (item.type === 'webSearch') {
			parts.push(webSearchToolCallPart(item));
		} else if (item.type === 'imageGeneration') {
			parts.push(imageGenerationToolCallPart(item));
		} else if (item.type === 'fileChange') {
			parts.push(fileChangeToolCallPart(item));
		} else if (item.type === 'dynamicToolCall') {
			const coordination = getCodexThreadCoordinationCall(item);
			if (coordination) {
				const key = threadCoordinationKey(coordination);
				const duplicateCount = remainingRolloutCoordination.get(key) ?? 0;
				if (duplicateCount > 0) {
					remainingRolloutCoordination.set(key, duplicateCount - 1);
				} else {
					if (coordination.toolName === SessionServerToolName.CreateSession) {
						linkedCreatedThreadIds.add(coordination.targetThreadId);
					}
					parts.push(threadCoordinationToolCallPart(coordination));
				}
			}
		} else if (item.type === 'contextCompaction') {
			if (!userText) {
				userText = '/compact';
			}
			parts.push(compactionToolCallPart());
		}
	}
	flushPreflight();
	const delegation = parseCodexDelegation(userText);

	if (!userText && parts.length === 0) {
		return undefined;
	}
	if (codexTurn.status === 'failed' && codexTurn.error) {
		parts.push({ kind: ResponsePartKind.Error, error: mapCodexTurnError(codexTurn.error) });
	}
	return {
		id: codexTurn.id,
		...codexTurnTiming(codexTurn),
		message: {
			text: delegation?.input ?? userText,
			origin: { kind: MessageKind.User },
			...(model ? { model } : {}),
			...(delegation ? { _meta: toAgentMessageDelegationMeta({ sourceThreadId: delegation.sourceThreadId }) } : {}),
		},
		responseParts: parts,
		usage: model ? { model: model.id } : undefined,
		state: turnStateFromStatus(codexTurn.status),
	};
}

function threadCoordinationToolCallPart(coordination: ICodexThreadCoordinationCall): ToolCallResponsePart {
	const display = getServerToolDisplay(coordination.toolName, coordination.toolInput, { text: coordination.openLink, success: true });
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId: generateUuid(),
			toolName: coordination.toolName,
			displayName: display?.displayName ?? coordination.toolName,
			invocationMessage: display?.invocationMessage ?? coordination.toolName,
			toolInput: JSON.stringify(coordination.toolInput, null, 2),
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success: true,
			pastTenseMessage: display?.pastTenseMessage ?? coordination.toolName,
			content: [{ type: ToolResultContentType.Text, text: coordination.openLink }],
		},
	};
}

function threadCoordinationKey(coordination: ICodexThreadCoordinationCall): string {
	return `${coordination.toolName}\0${coordination.targetThreadId}`;
}

function getServerToolPastTenseMessage(toolName: SessionServerToolName.CreateSession): string {
	const pastTenseMessage = getServerToolDisplay(toolName, {})?.pastTenseMessage;
	return typeof pastTenseMessage === 'string' ? pastTenseMessage : pastTenseMessage?.markdown ?? toolName;
}

function codexTurnTiming(codexTurn: CodexTurn): { startedAt?: string; duration?: number } {
	const startedAtSeconds = codexTurn.startedAt;
	if (typeof startedAtSeconds !== 'number' || !Number.isFinite(startedAtSeconds)) {
		return {};
	}
	const duration = typeof codexTurn.durationMs === 'number' && Number.isFinite(codexTurn.durationMs) && codexTurn.durationMs >= 0
		? codexTurn.durationMs
		: typeof codexTurn.completedAt === 'number' && Number.isFinite(codexTurn.completedAt)
			? Math.max(0, (codexTurn.completedAt - startedAtSeconds) * 1000)
			: undefined;
	return {
		startedAt: new Date(startedAtSeconds * 1000).toISOString(),
		...(duration !== undefined ? { duration } : {}),
	};
}

function textContent(output: string): ToolResultContent[] | undefined {
	return output ? [{ type: ToolResultContentType.Text, text: output }] : undefined;
}

function shellToolCallPart(item: CommandExecutionItem, command: string): ToolCallResponsePart {
	const success = item.status === 'completed' && (item.exitCode === 0 || item.exitCode === null);
	const output = item.aggregatedOutput ?? '';
	const exit = item.exitCode;
	const pastTense = success
		? `Ran \`${command}\``
		: exit !== null
			? `Ran \`${command}\` (exit ${exit})`
			: `Ran \`${command}\` (failed)`;
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId: generateUuid(),
			toolName: 'shell',
			displayName: 'Run shell command',
			_meta: toToolCallMeta({ toolKind: 'terminal' }),
			invocationMessage: command,
			toolInput: command,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success,
			pastTenseMessage: pastTense,
			content: textContent(output),
			error: success ? undefined : { message: exit !== null ? `Exit code ${exit}` : 'Command failed' },
		},
	};
}

function webSearchToolCallPart(item: Extract<ThreadItem, { type: 'webSearch' }>): ToolCallResponsePart {
	const query = describeWebSearch(item.query, item.action);
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId: generateUuid(),
			toolName: 'web_search',
			displayName: 'Web search',
			_meta: toToolCallMeta({ toolKind: 'search' }),
			invocationMessage: webSearchInvocationMessage(query),
			toolInput: query,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success: true,
			pastTenseMessage: webSearchPastTenseMessage(query),
		},
	};
}

function imageGenerationToolCallPart(item: Extract<ThreadItem, { type: 'imageGeneration' }>): ToolCallResponsePart {
	const success = item.status === 'completed' && item.result.length > 0;
	const labels = codexImageGenerationLabels(item.status);
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId: generateUuid(),
			toolName: 'image_gen.imagegen',
			displayName: labels.displayName,
			invocationMessage: labels.invocationMessage,
			toolInput: JSON.stringify({ prompt: item.revisedPrompt ?? labels.displayName }),
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success,
			pastTenseMessage: success ? labels.pastTenseMessage : labels.failedMessage,
			content: success ? [{ type: ToolResultContentType.EmbeddedResource, data: item.result, contentType: 'image/png' }] : undefined,
			error: success ? undefined : { message: labels.errorMessage },
		},
	};
}

function fileChangeToolCallPart(item: Extract<ThreadItem, { type: 'fileChange' }>): ToolCallResponsePart {
	const success = item.status === 'completed';
	const summary = describeFileChange(item.changes) || 'Apply file changes';
	const output = fileChangeOutput(item.changes);
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId: generateUuid(),
			toolName: 'file_edit',
			displayName: 'Apply file changes',
			invocationMessage: summary,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success,
			pastTenseMessage: success ? summary : 'Failed to apply file changes',
			content: textContent(output),
			error: success ? undefined : { message: `Patch ${item.status}` },
		},
	};
}

function compactionToolCallPart(): ToolCallResponsePart {
	const labels = codexCompactionLabels();
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId: generateUuid(),
			toolName: 'compact',
			displayName: labels.displayName,
			invocationMessage: labels.invocationMessage,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success: true,
			pastTenseMessage: labels.pastTenseMessage,
		},
	};
}
