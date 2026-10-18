/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LoggedInfo, LoggedInfoKind } from '../../../platform/requestLogger/common/requestLogger';

/**
 * Type for a log entry in an exported chat log file.
 * These types correspond to LoggedInfoKind from the request logger.
 */
type ExportedLogKind = 'element' | 'request' | 'toolCall' | 'error';

interface ExportedLogMetadata {
	model?: string;
	duration?: number;
	startTime?: string;
	endTime?: string;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
}

interface ExportedLogEntry {
	id: string;
	kind: ExportedLogKind;
	name?: string;
	tool?: string;
	type?: string;
	tokens?: number;
	maxTokens?: number;
	args?: Record<string, unknown>;
	response?: object;
	content?: string;
	metadata?: ExportedLogMetadata;
	requestMessages?: {
		messages?: unknown[];
	};
	time?: string;
	thinking?: {
		id?: string;
		text?: string;
	};
	error?: string;
	timestamp?: string;
}

/**
 * Structure of an exported prompt in a chat log export file.
 * Each prompt represents a user query and its associated log entries.
 */
export interface ExportedPrompt {
	prompt: string;
	promptId?: string;
	hasSeen?: boolean;
	logCount: number;
	logs: ExportedLogEntry[];
}

export interface ChatLogExport {
	exportedAt: string;
	totalPrompts: number;
	totalLogEntries: number;
	/** Array of exported prompts */
	prompts: ExportedPrompt[];
	mcpServers?: object[];
}

async function entryToJson(entry: LoggedInfo): Promise<object> {
	if (entry.kind === LoggedInfoKind.ToolCall) {
		return await (entry as { toJSON(): Promise<object> }).toJSON();
	} else {
		return (entry as { toJSON(): object }).toJSON();
	}
}

/**
 * Creates an exported prompt from a collection of log entries.
 * Use this when entries are already grouped by prompt (e.g., from tree view).
 *
 * @param label - The prompt label
 * @param entries - The log entries for this prompt
 * @param options - Additional options
 * @returns The exported prompt structure
 */
export async function createExportedPrompt(
	label: string,
	entries: LoggedInfo[],
	options?: { promptId?: string; hasSeen?: boolean }
): Promise<ExportedPrompt> {
	const logs: ExportedLogEntry[] = [];
	for (const entry of entries) {
		try {
			logs.push(await entryToJson(entry) as ExportedLogEntry);
		} catch (error) {
			logs.push({
				id: entry.id,
				kind: 'error',
				error: error?.toString() || 'Unknown error',
				timestamp: new Date().toISOString()
			});
		}
	}

	return {
		prompt: label,
		promptId: options?.promptId,
		hasSeen: options?.hasSeen,
		logCount: logs.length,
		logs
	};
}

/**
 * Assembles a complete ChatLogExport from exported prompts.
 *
 * @param prompts - Array of exported prompts
 * @param mcpServers - Optional MCP server definitions
 * @returns The complete export structure
 */
export function assembleChatLogExport(
	prompts: ExportedPrompt[],
	mcpServers?: object[]
): ChatLogExport {
	const totalLogEntries = prompts.reduce((sum, p) => sum + p.logCount, 0);

	return {
		exportedAt: new Date().toISOString(),
		totalPrompts: prompts.length,
		totalLogEntries,
		prompts,
		mcpServers
	};
}

export function serializeChatLogExport(exportData: ChatLogExport): string {
	return JSON.stringify(exportData, null, 2);
}
