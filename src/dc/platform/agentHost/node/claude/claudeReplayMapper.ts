/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import type { ILogService } from '../../../log/common/log.js';
import {
	ResponsePartKind,
	ToolCallCancellationReason,
	ToolCallConfirmationReason,
	ToolCallStatus,
	ToolResultContentType,
	TurnState,
	MessageKind,
	type ResponsePart,
	type ToolCallCancelledState,
	type ToolCallCompletedState,
	type ToolCallResponsePart,
	type ToolResultContent,
	type Turn,
} from '../../common/state/protocol/state.js';
import { buildSubagentSessionUri } from '../../common/state/sessionState.js';
import { readToolCallMeta } from '../../common/meta/agentToolCallMeta.js';
import { formatGenericToolInput } from '../../common/streamingToolCallDisplay.js';
import { buildClaudeToolMeta, getClaudeInvocationMessage, getClaudePastTenseMessage, getClaudeToolDisplayName, getClaudeToolInputString } from './claudeToolDisplay.js';
import { hasClientToolNamePrefix, stripClientToolNamePrefix } from './clientTools/claudeClientToolMcpServer.js';

export function mapSessionMessagesToTurns(
	messages: readonly SessionMessage[],
	session: URI,
	logService: ILogService,
): readonly Turn[] {
	const builder = new ReplayBuilder(session, logService);
	for (const msg of messages) {
		const parsed = parseSessionMessage(msg);
		if (parsed === undefined) {
			continue;
		}
		builder.consume(parsed);
	}
	return builder.finish();
}

export function resolveForkAnchorUuid(messages: readonly SessionMessage[], turnId: string): string | undefined {
	let turnOpen = false;
	let seenTarget = false;
	let lastAssistantUuid: string | undefined;
	for (const msg of messages) {
		const parsed = parseSessionMessage(msg);
		if (parsed === undefined) {
			continue;
		}
		if (parsed.kind === 'user-text') {
			if (seenTarget) {
				break;
			}
			turnOpen = true;
			if (parsed.uuid === turnId) {
				seenTarget = true;
			}
		} else if (parsed.kind === 'assistant') {
			if (!turnOpen) {
				turnOpen = true;
				if (parsed.uuid === turnId) {
					seenTarget = true;
				}
			}
			if (seenTarget) {
				lastAssistantUuid = parsed.uuid;
			}
		}
	}
	if (!seenTarget) {
		return undefined;
	}
	return lastAssistantUuid;
}


interface UserTextBlock { readonly type: 'text'; readonly text: string }
interface UserToolResultBlock { readonly type: 'tool_result'; readonly tool_use_id: string; readonly content: unknown; readonly is_error: boolean }
interface AssistantBlock { readonly type: string; readonly text?: string; readonly thinking?: string; readonly id?: string; readonly name?: string; readonly input?: unknown }

type ParsedSessionMessage =
	| { readonly kind: 'user-text'; readonly uuid: string; readonly text: string; readonly timestamp?: string }
	| { readonly kind: 'user-tool-results'; readonly uuid: string; readonly results: readonly UserToolResultBlock[]; readonly timestamp?: string }
	| { readonly kind: 'assistant'; readonly uuid: string; readonly blocks: readonly AssistantBlock[]; readonly isInner: boolean; readonly timestamp?: string }
	| { readonly kind: 'system-notification'; readonly uuid: string; readonly subtype: string; readonly text: string; readonly timestamp?: string };

function parseSessionMessage(msg: SessionMessage): ParsedSessionMessage | undefined {
	const timestamp = readTimestamp(msg);
	switch (msg.type) {
		case 'user': return parseUserMessage(msg, timestamp);
		case 'assistant': return parseAssistantMessage(msg, timestamp);
		case 'system': return parseSystemMessage(msg, timestamp);
		default: return undefined;
	}
}

function readTimestamp(msg: SessionMessage & { readonly timestamp?: unknown }): string | undefined {
	if (typeof msg.timestamp !== 'string') {
		return undefined;
	}
	const timestamp = Date.parse(msg.timestamp);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function parseUserMessage(msg: SessionMessage, timestamp: string | undefined): ParsedSessionMessage | undefined {
	const content = readUserContent(msg.message);
	if (content === undefined) {
		return undefined;
	}
	if (isCliEchoContent(content)) {
		return undefined;
	}
	if (typeof content === 'string') {
		return { kind: 'user-text', uuid: msg.uuid, text: content, timestamp };
	}
	const textBlocks = content.filter((b): b is UserTextBlock => b.type === 'text');
	if (textBlocks.length === 0) {
		const results = content.filter((b): b is UserToolResultBlock => b.type === 'tool_result');
		return results.length > 0 ? { kind: 'user-tool-results', uuid: msg.uuid, results, timestamp } : undefined;
	}
	return { kind: 'user-text', uuid: msg.uuid, text: textBlocks.map(b => b.text).join('\n'), timestamp };
}

function parseAssistantMessage(msg: SessionMessage, timestamp: string | undefined): ParsedSessionMessage | undefined {
	const blocks = readAssistantBlocks(msg.message);
	if (blocks === undefined || blocks.length === 0) {
		return undefined;
	}
	return { kind: 'assistant', uuid: msg.uuid, blocks, isInner: msg.parent_tool_use_id !== null, timestamp };
}

function parseSystemMessage(msg: SessionMessage, timestamp: string | undefined): ParsedSessionMessage | undefined {
	const subtype = readSystemSubtype(msg.message);
	if (subtype === undefined || !ALLOWED_SYSTEM_SUBTYPES.has(subtype)) {
		return undefined;
	}
	const text = readSystemText(msg.message) ?? `[${subtype}]`;
	return { kind: 'system-notification', uuid: msg.uuid, subtype, text, timestamp };
}



const ALLOWED_SYSTEM_SUBTYPES: ReadonlySet<string> = new Set([
	'compact_boundary',
	'notification',
]);

const CLI_ECHO_MARKER_PATTERN = /^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;

export function missingPromptPlaceholder(): string {
	return localize('claude.replay.missingPrompt', "Message content could not be retrieved");
}

interface InProgressTurn {
	readonly id: string;
	readonly userText: string;
	readonly startedAt?: string;
	lastResponseAt?: string;
	readonly responseParts: ResponsePart[];
	readonly pendingToolUseIds: Set<string>;
	readonly toolCallParts: Map<string, ToolCallResponsePart>;
}

class ReplayBuilder {
	private readonly _turns: Turn[] = [];
	private _active: InProgressTurn | undefined;
	private readonly _toolUses = new Map<string, { readonly turnId: string; readonly parsedInput: Record<string, unknown> | undefined; readonly isClientTool: boolean }>();

	private _recoveredPromptlessTurns = 0;

	private _orphanToolResults = 0;

	constructor(private readonly _session: URI, private readonly _logService: ILogService) { }

	consume(msg: ParsedSessionMessage): void {
		switch (msg.kind) {
			case 'user-text':
				this._closeActive();
				this._active = {
					id: msg.uuid,
					userText: msg.text,
					startedAt: msg.timestamp,
					responseParts: [],
					pendingToolUseIds: new Set(),
					toolCallParts: new Map(),
				};
				return;
			case 'user-tool-results': {
				let updatesActiveTurn = false;
				for (const block of msg.results) {
					updatesActiveTurn = this._attachToolResult(block) === this._active?.id || updatesActiveTurn;
				}
				if (updatesActiveTurn && this._active && msg.timestamp) {
					this._active.lastResponseAt = msg.timestamp;
				}
				return;
			}
			case 'assistant':
				this._consumeAssistant(msg);
				return;
			case 'system-notification':
				if (this._active === undefined) {
					return;
				}
				this._active.responseParts.push({
					kind: ResponsePartKind.SystemNotification,
					content: msg.text,
				});
				if (msg.timestamp) {
					this._active.lastResponseAt = msg.timestamp;
				}
				return;
		}
	}

	finish(): readonly Turn[] {
		this._closeActive();
		if (this._recoveredPromptlessTurns > 0 || this._orphanToolResults > 0) {
			this._logService.warn(`[claudeReplayMapper] incomplete transcript for ${this._session.toString()}: ${this._recoveredPromptlessTurns} turn(s) recovered without their prompt, ${this._orphanToolResults} orphaned tool_result(s)`);
		}
		return this._turns;
	}

	private _consumeAssistant(msg: ParsedSessionMessage & { kind: 'assistant' }): void {
		if (this._active === undefined) {
			if (!msg.isInner) {
				this._recoveredPromptlessTurns++;
			}
			this._active = {
				id: msg.uuid,
				userText: msg.isInner ? '' : missingPromptPlaceholder(),
				startedAt: msg.timestamp,
				responseParts: [],
				pendingToolUseIds: new Set(),
				toolCallParts: new Map(),
			};
		}
		let textPartCounter = 0;
		let reasoningPartCounter = 0;
		for (const block of msg.blocks) {
			if (block.type === 'text' && typeof block.text === 'string') {
				this._active.responseParts.push({
					kind: ResponsePartKind.Markdown,
					id: `${this._active.id}#${msg.uuid}#text-${textPartCounter++}`,
					content: block.text,
				});
			} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
				this._active.responseParts.push({
					kind: ResponsePartKind.Reasoning,
					id: `${this._active.id}#${msg.uuid}#thinking-${reasoningPartCounter++}`,
					content: block.thinking,
				});
			} else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
				this._openToolUse(block.id, stripClientToolNamePrefix(block.name), block.input, hasClientToolNamePrefix(block.name));
			}
		}
		if (msg.timestamp) {
			this._active.lastResponseAt = msg.timestamp;
		}
	}

	private _openToolUse(toolUseId: string, toolName: string, input: unknown, isClientTool: boolean): void {
		if (this._active === undefined) {
			return;
		}
		const displayName = isClientTool ? toolName : getClaudeToolDisplayName(toolName);
		const parsedInput = input !== null && typeof input === 'object' ? input as Record<string, unknown> : undefined;
		const meta = isClientTool ? undefined : buildClaudeToolMeta(toolName);
		const placeholder: ToolCallCancelledState = {
			status: ToolCallStatus.Cancelled,
			toolCallId: toolUseId,
			toolName,
			displayName,
			invocationMessage: isClientTool ? displayName : getClaudeInvocationMessage(toolName, displayName, parsedInput),
			toolInput: parsedInput !== undefined
				? isClientTool ? formatGenericToolInput(parsedInput) : getClaudeToolInputString(toolName, parsedInput)
				: (typeof input === 'string' ? input : input !== undefined ? safeStringify(input) : undefined),
			reason: ToolCallCancellationReason.Skipped,
			...(meta ? { _meta: meta } : {}),
		};
		const part: ToolCallResponsePart = {
			kind: ResponsePartKind.ToolCall,
			toolCall: placeholder,
		};
		this._active.responseParts.push(part);
		this._active.toolCallParts.set(toolUseId, part);
		this._active.pendingToolUseIds.add(toolUseId);
		this._toolUses.set(toolUseId, { turnId: this._active.id, parsedInput, isClientTool });
	}

	private _attachToolResult(block: UserToolResultBlock): string | undefined {
		const entry = this._toolUses.get(block.tool_use_id);
		if (entry === undefined) {
			this._orphanToolResults++;
			return undefined;
		}
		const announcingTurnId = entry.turnId;
		const part = this._findToolCallPart(announcingTurnId, block.tool_use_id);
		if (part === undefined) {
			return undefined;
		}
		const isError = block.is_error;
		const previousState = part.toolCall;
		const isSubagent = readToolCallMeta(previousState).toolKind === 'subagent';
		const content: ToolResultContent[] = extractToolResultContent(block.content) ?? [];
		const resultText = content
			.filter((c): c is { type: ToolResultContentType.Text; text: string } => c.type === ToolResultContentType.Text)
			.map(c => c.text)
			.join('\n');
		if (isSubagent) {
			content.push({
				type: ToolResultContentType.Subagent,
				resource: buildSubagentSessionUri(this._session.toString(), previousState.toolCallId),
				title: previousState.displayName,
			});
		}
		const completed: ToolCallCompletedState = {
			status: ToolCallStatus.Completed,
			toolCallId: previousState.toolCallId,
			toolName: previousState.toolName,
			displayName: previousState.displayName,
			invocationMessage: previousState.invocationMessage ?? previousState.displayName,
			toolInput: previousState.status === ToolCallStatus.Streaming ? undefined : previousState.toolInput,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success: !isError,
			pastTenseMessage: entry.isClientTool
				? previousState.displayName
				: getClaudePastTenseMessage(previousState.toolName, previousState.displayName, entry.parsedInput, !isError, resultText),
			content: content.length > 0 ? content : undefined,
			...(previousState._meta ? { _meta: previousState._meta } : {}),
		};
		part.toolCall = completed;
		if (this._active?.id === announcingTurnId) {
			this._active.pendingToolUseIds.delete(block.tool_use_id);
		}
		return announcingTurnId;
	}

	private _findToolCallPart(turnId: string, toolUseId: string): ToolCallResponsePart | undefined {
		if (this._active && this._active.id === turnId) {
			return this._active.toolCallParts.get(toolUseId);
		}
		for (let i = this._turns.length - 1; i >= 0; i--) {
			if (this._turns[i].id !== turnId) {
				continue;
			}
			for (const part of this._turns[i].responseParts) {
				if (part.kind === ResponsePartKind.ToolCall && part.toolCall.toolCallId === toolUseId) {
					return part;
				}
			}
			return undefined;
		}
		return undefined;
	}

	private _closeActive(): void {
		if (this._active === undefined) {
			return;
		}
		const a = this._active;
		const state = a.pendingToolUseIds.size === 0 ? TurnState.Complete : TurnState.Cancelled;
		const startedAt = a.startedAt === undefined ? undefined : Date.parse(a.startedAt);
		const endedAt = a.lastResponseAt === undefined ? undefined : Date.parse(a.lastResponseAt);
		const duration = startedAt !== undefined && endedAt !== undefined && Number.isFinite(startedAt) && Number.isFinite(endedAt)
			? Math.max(0, endedAt - startedAt)
			: undefined;
		const turn: Turn = {
			id: a.id,
			startedAt: a.startedAt,
			duration,
			message: { text: a.userText, origin: { kind: MessageKind.User } },
			responseParts: a.responseParts,
			usage: undefined,
			state,
		};
		this._turns.push(turn);
		this._active = undefined;
	}
}



function readUserContent(raw: unknown): string | ReadonlyArray<UserTextBlock | UserToolResultBlock> | undefined {
	if (raw === null || typeof raw !== 'object') {
		return undefined;
	}
	const content = (raw as { content?: unknown }).content;
	if (typeof content === 'string') {
		return content.length > 0 ? content : undefined;
	}
	if (!Array.isArray(content) || content.length === 0) {
		return undefined;
	}
	const out: (UserTextBlock | UserToolResultBlock)[] = [];
	for (const block of content) {
		if (block === null || typeof block !== 'object') {
			continue;
		}
		const b = block as { type?: unknown; text?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown };
		if (b.type === 'text' && typeof b.text === 'string') {
			out.push({ type: 'text', text: b.text });
		} else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
			out.push({ type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error === true });
		}
	}
	return out.length > 0 ? out : undefined;
}

function readAssistantBlocks(raw: unknown): readonly AssistantBlock[] | undefined {
	if (raw === null || typeof raw !== 'object') {
		return undefined;
	}
	const content = (raw as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		return undefined;
	}
	const out: AssistantBlock[] = [];
	for (const block of content) {
		if (block === null || typeof block !== 'object') {
			continue;
		}
		const b = block as { type?: unknown; text?: unknown; thinking?: unknown; id?: unknown; name?: unknown; input?: unknown };
		if (typeof b.type !== 'string') {
			continue;
		}
		out.push({
			type: b.type,
			text: typeof b.text === 'string' ? b.text : undefined,
			thinking: typeof b.thinking === 'string' ? b.thinking : undefined,
			id: typeof b.id === 'string' ? b.id : undefined,
			name: typeof b.name === 'string' ? b.name : undefined,
			input: b.input,
		});
	}
	return out;
}

function readSystemSubtype(raw: unknown): string | undefined {
	if (raw === null || typeof raw !== 'object') {
		return undefined;
	}
	const subtype = (raw as { subtype?: unknown }).subtype;
	return typeof subtype === 'string' ? subtype : undefined;
}

function readSystemText(raw: unknown): string | undefined {
	if (raw === null || typeof raw !== 'object') {
		return undefined;
	}
	const r = raw as { text?: unknown; message?: unknown };
	if (typeof r.text === 'string') {
		return r.text;
	}
	if (typeof r.message === 'string') {
		return r.message;
	}
	return undefined;
}

function extractToolResultContent(content: unknown): { type: ToolResultContentType.Text; text: string }[] | undefined {
	if (typeof content === 'string') {
		return content.length > 0 ? [{ type: ToolResultContentType.Text, text: content }] : undefined;
	}
	if (!Array.isArray(content)) {
		return undefined;
	}
	const out: { type: ToolResultContentType.Text; text: string }[] = [];
	for (const block of content) {
		if (block === null || typeof block !== 'object') {
			continue;
		}
		const b = block as { type?: unknown; text?: unknown };
		if (b.type === 'text' && typeof b.text === 'string') {
			out.push({ type: ToolResultContentType.Text, text: b.text });
		}
	}
	return out.length > 0 ? out : undefined;
}

function safeStringify(v: unknown): string | undefined {
	try {
		return JSON.stringify(v);
	} catch {
		return undefined;
	}
}

function isCliEchoContent(content: string | ReadonlyArray<UserTextBlock | UserToolResultBlock>): boolean {
	if (typeof content === 'string') {
		return CLI_ECHO_MARKER_PATTERN.test(content);
	}
	const firstText = content.find((b): b is UserTextBlock => b.type === 'text');
	return firstText !== undefined && CLI_ECHO_MARKER_PATTERN.test(firstText.text);
}

