/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { getReasoningEffortDescription, getReasoningEffortLabel } from './reasoningEffort.js';
import type { ConfigSchema, ModelSelection } from './state/protocol/state.js';

export const CLAUDE_THINKING_LEVEL_KEY = 'thinkingLevel';

export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ClaudeRuntimeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh';

export function toRuntimeEffortLevel(effort: ClaudeEffortLevel | undefined): ClaudeRuntimeEffortLevel | undefined {
	return effort as ClaudeRuntimeEffortLevel | undefined;
}

export function resolveClaudeEffort(model: ModelSelection | undefined): ClaudeEffortLevel | undefined {
	const raw = model?.config?.[CLAUDE_THINKING_LEVEL_KEY];
	switch (raw) {
		case 'low':
		case 'medium':
		case 'high':
		case 'xhigh':
		case 'max':
			return raw;
		default:
			return undefined;
	}
}

const CLAUDE_EFFORT_LEVELS: readonly ClaudeEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function isClaudeEffortLevel(value: string): value is ClaudeEffortLevel {
	return (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value);
}

export function createClaudeThinkingLevelSchema(supportedEfforts: readonly ClaudeEffortLevel[]): ConfigSchema | undefined {
	if (supportedEfforts.length === 0) {
		return undefined;
	}
	const defaultEffort: ClaudeEffortLevel | undefined = supportedEfforts.includes('high') ? 'high' : undefined;
	return {
		type: 'object',
		properties: {
			[CLAUDE_THINKING_LEVEL_KEY]: {
				type: 'string',
				title: localize('claude.modelThinkingLevel.title', "Thinking Level"),
				description: localize('claude.modelThinkingLevel.description', "Controls how much reasoning effort Claude uses."),
				enum: [...supportedEfforts],
				enumLabels: supportedEfforts.map(getReasoningEffortLabel),
				enumDescriptions: supportedEfforts.map(effort => getReasoningEffortDescription(effort) ?? ''),
				...(defaultEffort !== undefined ? { default: defaultEffort } : {}),
			},
		},
	};
}
