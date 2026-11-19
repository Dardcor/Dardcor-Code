/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Mutable } from '../../../../base/common/types.js';

interface IHasToolCallMeta {
	readonly _meta?: Record<string, unknown>;
}

export interface IToolCallMeta {
	readonly toolKind?: ToolKind;
	readonly language?: string;
	readonly subagentDescription?: string;
	readonly subagentAgentName?: string;
	readonly subagentChatUri?: string;
	readonly mcpServerName?: string;
	readonly mcpToolName?: string;
	readonly ui?: IToolCallUiMeta;
	readonly autoApproveBySetting?: boolean;
	readonly autoApproveRuleResolvable?: boolean;
	readonly toolSearchCandidates?: readonly IToolSearchCandidate[];
	readonly progressMessage?: string;
}

export interface IToolSearchCandidate {
	readonly name: string;
	readonly description: string;
}

export type ToolKind = 'terminal' | 'subagent' | 'search' | 'read';

export interface IToolCallUiMeta {
	readonly resourceUri: string;
	readonly channel?: string;
}

function isToolKind(value: unknown): value is ToolKind {
	return value === 'terminal' || value === 'subagent' || value === 'search' || value === 'read';
}

function readToolCallUiMeta(value: unknown): IToolCallUiMeta | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw['resourceUri'] !== 'string' || raw['resourceUri'].length === 0) {
		return undefined;
	}
	const result: Mutable<IToolCallUiMeta> = { resourceUri: raw['resourceUri'] };
	if (typeof raw['channel'] === 'string' && raw['channel'].length > 0) {
		result.channel = raw['channel'];
	}
	return result;
}

function readToolSearchCandidates(value: unknown): readonly IToolSearchCandidate[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const result: IToolSearchCandidate[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			return undefined;
		}
		const raw = candidate as Record<string, unknown>;
		if (typeof raw['name'] !== 'string' || typeof raw['description'] !== 'string') {
			return undefined;
		}
		result.push({
			name: raw['name'],
			description: raw['description'],
		});
	}
	return result;
}

export function readToolCallMeta(source: IHasToolCallMeta): IToolCallMeta {
	const meta = source._meta;
	if (!meta) {
		return {};
	}
	const result: Mutable<IToolCallMeta> = {};
	if (isToolKind(meta['toolKind'])) { result.toolKind = meta['toolKind']; }
	if (typeof meta['language'] === 'string') { result.language = meta['language']; }
	if (typeof meta['subagentDescription'] === 'string') { result.subagentDescription = meta['subagentDescription']; }
	if (typeof meta['subagentAgentName'] === 'string') { result.subagentAgentName = meta['subagentAgentName']; }
	if (typeof meta['subagentChatUri'] === 'string') { result.subagentChatUri = meta['subagentChatUri']; }
	if (typeof meta['mcpServerName'] === 'string') { result.mcpServerName = meta['mcpServerName']; }
	if (typeof meta['mcpToolName'] === 'string') { result.mcpToolName = meta['mcpToolName']; }
	if (typeof meta['progressMessage'] === 'string') { result.progressMessage = meta['progressMessage']; }
	if (typeof meta['autoApproveBySetting'] === 'boolean') { result.autoApproveBySetting = meta['autoApproveBySetting']; }
	if (typeof meta['autoApproveRuleResolvable'] === 'boolean') { result.autoApproveRuleResolvable = meta['autoApproveRuleResolvable']; }
	const toolSearchCandidates = readToolSearchCandidates(meta['toolSearchCandidates']);
	if (toolSearchCandidates) { result.toolSearchCandidates = toolSearchCandidates; }
	const ui = readToolCallUiMeta(meta['ui']);
	if (ui) { result.ui = ui; }
	return result;
}

export function toToolCallMeta(meta: IToolCallMeta): Record<string, unknown> | undefined {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(meta)) {
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}
