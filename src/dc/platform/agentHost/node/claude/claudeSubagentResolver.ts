/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { vObjAny, vString as vStringValidator } from '../../../../base/common/validation.js';
import { ILogService } from '../../../log/common/log.js';
import {
	ResponsePartKind,
	ToolCallStatus,
	ToolResultContentType,
	type Turn,
} from '../../common/state/protocol/state.js';
import { IClaudeAgentSdkService } from './claudeAgentSdkService.js';
import { mapSessionMessagesToTurns } from './claudeReplayMapper.js';
import { scanTranscriptForAgentIds, SUBAGENT_TOOL_NAMES, type SubagentRegistry } from './claudeSubagentRegistry.js';

export interface ISubagentLookupStrategy {
	readonly name: string;
	lookup(toolCallId: string, ctx: ISubagentLookupContext): Promise<string | undefined>;
}

export interface ISubagentLookupContext {
	readonly parentUri: URI;
	readonly parentSessionId: string;
	readonly parentTranscript?: readonly Turn[];
	readonly token: CancellationToken;
}

export class TextSuffixStrategy implements ISubagentLookupStrategy {
	readonly name = 'text_suffix';

	constructor(
		private readonly _sdk: IClaudeAgentSdkService,
		private readonly _logService: ILogService,
	) { }

	async lookup(toolCallId: string, ctx: ISubagentLookupContext): Promise<string | undefined> {
		const transcript = await fetchParentTurns(this._sdk, this._logService, ctx, 'TextSuffix');
		if (!transcript) {
			return undefined;
		}
		return scanTranscriptForAgentIds(transcript).get(toolCallId);
	}
}

export async function fetchParentTurns(
	sdk: IClaudeAgentSdkService,
	logService: ILogService,
	ctx: ISubagentLookupContext,
	strategyLabel: string,
): Promise<readonly Turn[] | undefined> {
	if (ctx.parentTranscript) {
		return ctx.parentTranscript;
	}
	try {
		const messages = await sdk.getSessionMessages(ctx.parentSessionId, { includeSystemMessages: true });
		return mapSessionMessagesToTurns(messages, ctx.parentUri, logService);
	} catch (err) {
		logService.warn(`[claudeSubagentResolver] ${strategyLabel}: parent transcript fetch failed: ${err}`);
		return undefined;
	}
}


function vString(input: unknown): string | undefined {
	const r = vStringValidator().validate(input);
	return r.error ? undefined : r.content;
}

function vObj(input: unknown): Record<string, unknown> | undefined {
	const r = vObjAny().validate(input);
	if (r.error || r.content === null || Array.isArray(r.content)) {
		return undefined;
	}
	return r.content as Record<string, unknown>;
}


export class PromptMatchStrategy implements ISubagentLookupStrategy {
	readonly name = 'prompt_match';

	constructor(
		private readonly _sdk: IClaudeAgentSdkService,
		private readonly _logService: ILogService,
	) { }

	async lookup(toolCallId: string, ctx: ISubagentLookupContext): Promise<string | undefined> {
		const prompt = await this._loadParentPrompt(toolCallId, ctx);
		if (!prompt) {
			return undefined;
		}

		let agentIds: readonly string[];
		try {
			agentIds = await this._sdk.listSubagents(ctx.parentSessionId);
		} catch (err) {
			this._logService.warn(`[claudeSubagentResolver] PromptMatch: listSubagents failed: ${err}`);
			return undefined;
		}
		for (const agentId of agentIds) {
			if (ctx.token.isCancellationRequested) {
				return undefined;
			}
			let messages;
			try {
				messages = await this._sdk.getSubagentMessages(ctx.parentSessionId, agentId);
			} catch (err) {
				this._logService.warn(`[claudeSubagentResolver] PromptMatch: getSubagentMessages(${agentId}) failed: ${err}`);
				continue;
			}
			const firstMessage = extractFirstUserText(messages);
			if (firstMessage === undefined) {
				continue;
			}
			if (firstMessage === prompt) {
				return agentId;
			}
		}
		return undefined;
	}

	private async _loadParentPrompt(toolCallId: string, ctx: ISubagentLookupContext): Promise<string | undefined> {
		const transcript = await fetchParentTurns(this._sdk, this._logService, ctx, 'PromptMatch');
		if (!transcript) {
			return undefined;
		}
		return extractSpawningPromptFromTranscript(transcript, toolCallId);
	}
}

export function extractSpawningPromptFromTranscript(transcript: readonly Turn[], toolCallId: string): string | undefined {
	for (const turn of transcript) {
		for (const part of turn.responseParts) {
			if (part.kind !== ResponsePartKind.ToolCall) {
				continue;
			}
			const state = part.toolCall;
			if (state.toolCallId !== toolCallId) {
				continue;
			}
			if (!SUBAGENT_TOOL_NAMES.has(state.toolName)) {
				return undefined;
			}
			if (state.status === ToolCallStatus.Streaming) {
				return undefined;
			}
			const inputRaw = state.toolInput;
			if (typeof inputRaw !== 'string') {
				return undefined;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(inputRaw);
			} catch {
				return undefined;
			}
			const bag = vObj(parsed);
			if (!bag) {
				return undefined;
			}
			return vString(bag.prompt);
		}
	}
	return undefined;
}

export class ResultMatchStrategy implements ISubagentLookupStrategy {
	readonly name = 'result_match';

	constructor(
		private readonly _sdk: IClaudeAgentSdkService,
		private readonly _logService: ILogService,
	) { }

	async lookup(toolCallId: string, ctx: ISubagentLookupContext): Promise<string | undefined> {
		const transcript = await fetchParentTurns(this._sdk, this._logService, ctx, 'ResultMatch');
		const expected = transcript ? extractCompletedResultTextFromTranscript(transcript, toolCallId) : undefined;
		if (!expected) {
			return undefined;
		}
		let agentIds: readonly string[];
		try {
			agentIds = await this._sdk.listSubagents(ctx.parentSessionId);
		} catch (err) {
			this._logService.warn(`[claudeSubagentResolver] ResultMatch: listSubagents failed: ${err}`);
			return undefined;
		}
		let matchedAgentId: string | undefined;
		for (const agentId of agentIds) {
			if (ctx.token.isCancellationRequested) {
				return undefined;
			}
			try {
				const messages = await this._sdk.getSubagentMessages(ctx.parentSessionId, agentId);
				if (extractLastAssistantText(messages)?.trim() === expected.trim()) {
					if (matchedAgentId) {
						return undefined;
					}
					matchedAgentId = agentId;
				}
			} catch (err) {
				this._logService.warn(`[claudeSubagentResolver] ResultMatch: getSubagentMessages(${agentId}) failed: ${err}`);
			}
		}
		return matchedAgentId;
	}
}

export function extractCompletedResultTextFromTranscript(transcript: readonly Turn[], toolCallId: string): string | undefined {
	for (const turn of transcript) {
		for (const part of turn.responseParts) {
			if (part.kind !== ResponsePartKind.ToolCall || part.toolCall.toolCallId !== toolCallId || part.toolCall.status !== ToolCallStatus.Completed) {
				continue;
			}
			const text = (part.toolCall.content ?? [])
				.filter(item => item.type === ToolResultContentType.Text)
				.map(item => item.text)
				.join('\n')
				.trim();
			return text || undefined;
		}
	}
	return undefined;
}

function extractLastAssistantText(messages: readonly { readonly type?: string; readonly message?: unknown }[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.type !== 'assistant') {
			continue;
		}
		const inner = vObj(message.message);
		if (!inner) {
			continue;
		}
		if (typeof inner.content === 'string') {
			return inner.content;
		}
		if (Array.isArray(inner.content)) {
			const text = inner.content.flatMap(block => {
				const item = vObj(block);
				const value = item?.type === 'text' ? vString(item.text) : undefined;
				return value === undefined ? [] : [value];
			}).join('');
			if (text) {
				return text;
			}
		}
	}
	return undefined;
}

function extractFirstUserText(messages: readonly { readonly type?: string; readonly message?: unknown }[]): string | undefined {
	for (const msg of messages) {
		if (msg.type !== 'user') {
			continue;
		}
		const inner = vObj(msg.message);
		if (!inner) {
			continue;
		}
		const content = inner.content;
		if (typeof content === 'string') {
			return content;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			const obj = vObj(block);
			if (!obj || obj.type !== 'text') {
				continue;
			}
			const text = vString(obj.text);
			if (text !== undefined) {
				return text;
			}
		}
	}
	return undefined;
}

export class NativeStrategy implements ISubagentLookupStrategy {
	readonly name = 'native';
	async lookup(): Promise<string | undefined> {
		return undefined;
	}
}

interface IResolveChainDeps {
	readonly strategies: readonly ISubagentLookupStrategy[];
	readonly cacheGet: (toolCallId: string) => string | undefined;
	readonly cacheSet: (toolCallId: string, agentId: string) => void;
}

export async function resolveAgentIdViaChain(
	toolCallId: string,
	ctx: ISubagentLookupContext,
	deps: IResolveChainDeps,
): Promise<string | undefined> {
	const cached = deps.cacheGet(toolCallId);
	if (cached) {
		return cached;
	}
	for (const strategy of deps.strategies) {
		if (ctx.token.isCancellationRequested) {
			return undefined;
		}
		const hit = await strategy.lookup(toolCallId, ctx);
		if (hit) {
			deps.cacheSet(toolCallId, hit);
			return hit;
		}
	}
	return undefined;
}

function buildDefaultStrategies(sdk: IClaudeAgentSdkService, logService: ILogService): readonly ISubagentLookupStrategy[] {
	return [
		new TextSuffixStrategy(sdk, logService),
		new PromptMatchStrategy(sdk, logService),
		new ResultMatchStrategy(sdk, logService),
		new NativeStrategy(),
	];
}

export async function getSubagentTranscript(
	subagentUri: URI,
	parentUri: URI,
	parentSessionId: string,
	toolCallId: string,
	parentRegistry: SubagentRegistry,
	sdk: IClaudeAgentSdkService,
	logService: ILogService,
	token: CancellationToken,
): Promise<readonly Turn[]> {
	const agentId = await resolveAgentIdViaChain(toolCallId, {
		parentUri,
		parentSessionId,
		token,
	}, {
		strategies: buildDefaultStrategies(sdk, logService),
		cacheGet: id => parentRegistry.getSpawn(id)?.agentId,
		cacheSet: (id, resolved) => { parentRegistry.recordSpawn(id, { agentId: resolved }); },
	});
	if (!agentId) {
		return [];
	}
	let messages;
	try {
		messages = await sdk.getSubagentMessages(parentSessionId, agentId);
	} catch (err) {
		logService.warn(`[getSubagentTranscript] getSubagentMessages(${agentId}) failed: ${err}`);
		return [];
	}
	return mapSessionMessagesToTurns(messages, subagentUri, logService);
}
