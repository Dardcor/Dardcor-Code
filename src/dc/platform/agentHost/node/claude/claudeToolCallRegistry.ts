/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ILogService } from '../../../log/common/log.js';
import { parsePartialToolInput } from '../../common/partialToolInput.js';
import { formatGenericToolInput, STREAMING_TOOL_DISPLAY_INTERVAL_MS, streamingToolDisplayText } from '../../common/streamingToolCallDisplay.js';
import type { StringOrMarkdown } from '../../common/state/protocol/state.js';
import { getClaudeInvocationMessage, getClaudeStreamingInvocationMessage, getClaudeToolDisplayName, getClaudeToolInputString } from './claudeToolDisplay.js';

export interface IClaudeToolStartInfo {
	readonly toolName: string;
	readonly displayName: string;
	readonly parsedInput: Record<string, unknown> | undefined;
	readonly invocationMessage: StringOrMarkdown;
	readonly toolInput: string | undefined;
	readonly isClientTool: boolean;
}

interface IRegistryEntry {
	readonly toolName: string;
	readonly turnId: string;
	readonly isClientTool: boolean;
	inputBuffer: string;
	displayedInputLength: number;
	displayedAt: number | undefined;
	displayedMessage: string | undefined;
	info: IClaudeToolStartInfo | undefined;
}

export interface IClaudeStreamingToolInputUpdate {
	readonly invocationMessage: StringOrMarkdown;
}

export class ClaudeToolCallRegistry {
	private readonly _entries = new Map<string, IRegistryEntry>();

	begin(toolUseId: string, toolName: string, turnId: string, isClientTool = false): void {
		this._entries.set(toolUseId, {
			toolName,
			turnId,
			isClientTool,
			inputBuffer: '',
			displayedInputLength: 0,
			displayedAt: undefined,
			displayedMessage: undefined,
			info: undefined,
		});
	}

	appendInputDelta(toolUseId: string, partialJson: string): void {
		const entry = this._entries.get(toolUseId);
		if (!entry) {
			return;
		}
		entry.inputBuffer += partialJson;
	}

	streamingInputUpdate(toolUseId: string, force = false): IClaudeStreamingToolInputUpdate | undefined {
		const entry = this._entries.get(toolUseId);
		if (!entry || entry.displayedInputLength === entry.inputBuffer.length) {
			return undefined;
		}
		const now = performance.now();
		if (!force && entry.displayedAt !== undefined && now - entry.displayedAt < STREAMING_TOOL_DISPLAY_INTERVAL_MS) {
			return undefined;
		}
		const invocationMessage = getClaudeStreamingInvocationMessage(entry.toolName, parsePartialToolInput(entry.inputBuffer));
		if (!invocationMessage) {
			return undefined;
		}
		entry.displayedInputLength = entry.inputBuffer.length;
		entry.displayedAt = now;
		const message = streamingToolDisplayText(invocationMessage);
		if (message === entry.displayedMessage) {
			return undefined;
		}
		entry.displayedMessage = message;
		return { invocationMessage };
	}

	finalize(toolUseId: string): void {
		const entry = this._entries.get(toolUseId);
		if (!entry) {
			return;
		}
		let parsedInput: Record<string, unknown> | undefined;
		if (entry.inputBuffer.length > 0) {
			try {
				const parsed: unknown = JSON.parse(entry.inputBuffer);
				if (parsed !== null && typeof parsed === 'object') {
					parsedInput = parsed as Record<string, unknown>;
				}
			} catch {
			}
		}
		const rawFallback = entry.inputBuffer.length > 0 ? entry.inputBuffer : undefined;
		this._writeInfo(entry, parsedInput, rawFallback);
		entry.inputBuffer = '';
	}

	seedParsedInput(toolUseId: string, parsedInput: unknown): void {
		const entry = this._entries.get(toolUseId);
		if (!entry) {
			return;
		}
		const normalized = (parsedInput !== null && typeof parsedInput === 'object')
			? parsedInput as Record<string, unknown>
			: undefined;
		this._writeInfo(entry, normalized);
	}

	private _writeInfo(entry: IRegistryEntry, parsedInput: Record<string, unknown> | undefined, rawFallback?: string): void {
		const displayName = entry.isClientTool ? entry.toolName : getClaudeToolDisplayName(entry.toolName);
		entry.info = {
			toolName: entry.toolName,
			displayName,
			parsedInput,
			invocationMessage: entry.isClientTool ? displayName : getClaudeInvocationMessage(entry.toolName, displayName, parsedInput),
			toolInput: entry.isClientTool ? formatGenericToolInput(parsedInput, rawFallback) : getClaudeToolInputString(entry.toolName, parsedInput) ?? rawFallback,
			isClientTool: entry.isClientTool,
		};
	}

	lookup(toolUseId: string): { readonly turnId: string; readonly toolName: string; readonly isClientTool: boolean; readonly info: IClaudeToolStartInfo | undefined } | undefined {
		const entry = this._entries.get(toolUseId);
		if (!entry) {
			return undefined;
		}
		return { turnId: entry.turnId, toolName: entry.toolName, isClientTool: entry.isClientTool, info: entry.info };
	}

	complete(toolUseId: string): void {
		this._entries.delete(toolUseId);
	}

	clearPending(logService: ILogService): void {
		if (this._entries.size === 0) {
			return;
		}
		for (const [toolUseId, entry] of this._entries) {
			logService.warn(`[claudeToolCallRegistry] turn ${entry.turnId} ended with pending tool_use ${toolUseId} (${entry.toolName}); dropping cross-message state`);
		}
		this._entries.clear();
	}
}
