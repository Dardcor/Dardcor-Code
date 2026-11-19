/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { getModelId, modelSupportsContextEditing } from '../../endpoint/common/chatModelCapabilities';
import type { LanguageModelChat } from 'vscode';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ChatLocation } from '../../chat/common/commonTypes';
import { IChatEndpoint } from './networking';

export interface AnthropicMessagesTool {
	name: string;
	type?: string;
	description?: string;
	input_schema?: {
		type: 'object';
		properties?: Record<string, unknown>;
		required?: string[];
	};
	defer_loading?: boolean;
	cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
}

export const CUSTOM_TOOL_SEARCH_NAME = 'tool_search';

export type ContextManagementTrigger =
	| { type: 'input_tokens'; value: number }
	| { type: 'tool_uses'; value: number };

export type ContextManagementKeep =
	| { type: 'tool_uses'; value: number }
	| { type: 'thinking_turns'; value: number }
	| 'all';

export type ContextManagementClearAtLeast = {
	type: 'input_tokens';
	value: number;
};

export interface ClearToolUsesEdit {
	type: 'clear_tool_uses_20250919';
	trigger?: ContextManagementTrigger;
	keep?: ContextManagementKeep;
	clear_at_least?: ContextManagementClearAtLeast;
	exclude_tools?: string[];
	clear_tool_inputs?: boolean;
}

export interface ClearThinkingEdit {
	type: 'clear_thinking_20251015';
	keep?: ContextManagementKeep;
}

export type ContextManagementEdit = ClearToolUsesEdit | ClearThinkingEdit;

export interface ContextManagement {
	edits: ContextManagementEdit[];
}

export interface AppliedContextEdit {
	type: 'clear_thinking_20251015' | 'clear_tool_uses_20250919';
	cleared_thinking_turns?: number;
	cleared_tool_uses?: number;
	cleared_input_tokens?: number;
}

export interface ContextManagementResponse {
	applied_edits: AppliedContextEdit[];
}

export function modelSupportsInterleavedThinking(modelId: string): boolean {
	const normalized = modelId.toLowerCase().replace(/\./g, '-');
	return normalized.startsWith('claude-sonnet-4-5') ||
		normalized.startsWith('claude-sonnet-4') ||
		normalized.startsWith('claude-haiku-4-5') ||
		normalized.startsWith('claude-opus-4-5');
}

export function modelSupportsMemory(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const id = typeof model === 'string' ? model : getModelId(model);
	const family = typeof model === 'string' ? model : model.family;
	const matches = (s: string) => {
		const n = s.toLowerCase().replace(/\./g, '-');
		return n.startsWith('claude-fable-5') ||
			n.startsWith('claude-haiku-4-5') ||
			n.startsWith('claude-sonnet-4-6') ||
			n.startsWith('claude-sonnet-4-5') ||
			n.startsWith('claude-sonnet-4') ||
			n.startsWith('claude-opus-4-8') ||
			n.startsWith('claude-opus-4-7') ||
			n.startsWith('claude-opus-4-6') ||
			n.startsWith('claude-opus-4-5') ||
			n.startsWith('claude-opus-4-1') ||
			n.startsWith('claude-opus-4');
	};
	return matches(id) || matches(family);
}

export function isAnthropicContextEditingEnabled(
	endpoint: IChatEndpoint | string,
	configurationService: IConfigurationService,
	experimentationService: IExperimentationService,
): boolean {
	const supportsIt = typeof endpoint === 'string'
		? modelSupportsContextEditing(endpoint)
		: endpoint.supportsContextEditing ?? modelSupportsContextEditing(endpoint.model);
	if (!supportsIt) {
		return false;
	}
	const mode = configurationService.getExperimentBasedConfig(ConfigKey.AnthropicContextEditingMode, experimentationService);
	return mode !== 'off';
}

export function modelSupportsExtendedCacheTtl(model: LanguageModelChat | IChatEndpoint | string): boolean {
	const id = typeof model === 'string' ? model : getModelId(model);
	const family = typeof model === 'string' ? model : model.family;
	const matches = (s: string) => {
		const n = s.toLowerCase().replace(/\./g, '-');
		return n.startsWith('claude-fable-5') ||
			n.startsWith('claude-opus-4-8') ||
			n.startsWith('claude-opus-4-7') ||
			n.startsWith('claude-opus-4-6') ||
			n.startsWith('claude-opus-4-5') ||
			n.startsWith('claude-sonnet-4-6') ||
			n.startsWith('claude-sonnet-4-5') ||
			n.startsWith('claude-haiku-4-5');
	};
	return matches(id) || matches(family);
}

export function isExtendedCacheTtlEnabled(
	endpoint: IChatEndpoint | string,
	configurationService: IConfigurationService,
	experimentationService: IExperimentationService,
	location: ChatLocation | undefined,
	isSubagent: boolean | undefined,
): boolean {
	if (!modelSupportsExtendedCacheTtl(endpoint)) {
		return false;
	}
	if (location !== ChatLocation.Agent) {
		return false;
	}
	if (isSubagent) {
		return false;
	}
	return configurationService.getExperimentBasedConfig(ConfigKey.Advanced.AnthropicExtendedCacheTtl, experimentationService);
}

export function isExtendedCacheTtlMessagesEnabled(
	parentEnabled: boolean,
	configurationService: IConfigurationService,
	experimentationService: IExperimentationService,
): boolean {
	if (!parentEnabled) {
		return false;
	}
	return configurationService.getExperimentBasedConfig(ConfigKey.Advanced.AnthropicExtendedCacheTtlMessages, experimentationService);
}

export type ContextEditingMode = 'off' | 'clear-thinking' | 'clear-tooluse' | 'clear-both';

export function buildContextManagement(
	mode: ContextEditingMode,
	thinkingEnabled: boolean
): ContextManagement | undefined {
	if (mode === 'off') {
		return undefined;
	}

	const edits: ContextManagementEdit[] = [];

	if ((mode === 'clear-thinking' || mode === 'clear-both') && thinkingEnabled) {
		edits.push({
			type: 'clear_thinking_20251015',
			keep: { type: 'thinking_turns', value: 1 },
		});
	}

	if (mode === 'clear-tooluse' || mode === 'clear-both') {
		edits.push({
			type: 'clear_tool_uses_20250919',
			trigger: { type: 'input_tokens', value: 100000 },
			keep: { type: 'tool_uses', value: 3 },
		});
	}

	return edits.length > 0 ? { edits } : undefined;
}

export function getContextManagementFromConfig(
	configurationService: IConfigurationService,
	experimentationService: IExperimentationService,
	thinkingEnabled: boolean,
): ContextManagement | undefined {
	const mode = configurationService.getExperimentBasedConfig(ConfigKey.AnthropicContextEditingMode, experimentationService);
	return buildContextManagement(mode, thinkingEnabled);
}
