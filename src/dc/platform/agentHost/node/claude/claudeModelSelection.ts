/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentModelInfo } from '../../common/agent.js';
import { createAgentModelGroupMeta } from '../../common/agentModelSource.js';
import { CLAUDE_PROVIDER_ANTHROPIC, CLAUDE_PROVIDER_DARDCOR_ROUTER } from '../../common/claudeProviders.js';
import type { ModelSelection } from '../../common/state/protocol/state.js';
import { toSdkModelId } from './claudeModelId.js';
import type { ClaudeTransportMode } from './claudeTransportMode.js';

const CLAUDE_MODEL_SELECTION_PREFIX = '@provider=';

export function toClaudeModelSelectionId(provider: string, modelId: string): string {
	return `${CLAUDE_MODEL_SELECTION_PREFIX}${encodeURIComponent(provider)}:${encodeURIComponent(modelId)}`;
}

export function parseClaudeModelSelection(selection: ModelSelection): { readonly provider: string; readonly modelId: string; readonly explicitProvider: boolean } {
	const { id } = selection;
	if (!id.startsWith(CLAUDE_MODEL_SELECTION_PREFIX)) {
		return { provider: CLAUDE_PROVIDER_DARDCOR_ROUTER, modelId: id, explicitProvider: false };
	}
	const separator = id.indexOf(':', CLAUDE_MODEL_SELECTION_PREFIX.length);
	if (separator < CLAUDE_MODEL_SELECTION_PREFIX.length) {
		return { provider: CLAUDE_PROVIDER_DARDCOR_ROUTER, modelId: id, explicitProvider: false };
	}
	try {
		const storedProvider = decodeURIComponent(id.slice(CLAUDE_MODEL_SELECTION_PREFIX.length, separator));
		return {
			provider: storedProvider === 'copilot' ? CLAUDE_PROVIDER_DARDCOR_ROUTER : storedProvider,
			modelId: decodeURIComponent(id.slice(separator + 1)),
			explicitProvider: true,
		};
	} catch {
		return { provider: CLAUDE_PROVIDER_DARDCOR_ROUTER, modelId: id, explicitProvider: false };
	}
}

export function toClaudeSdkModelId(model: ModelSelection): string;
export function toClaudeSdkModelId(model: ModelSelection | undefined): string | undefined;
export function toClaudeSdkModelId(model: ModelSelection | undefined): string | undefined {
	if (!model) {
		return undefined;
	}
	return toSdkModelId(parseClaudeModelSelection(model).modelId);
}

export function claudeTransportForProvider(provider: string): ClaudeTransportMode {
	return provider === CLAUDE_PROVIDER_ANTHROPIC ? 'native' : 'proxy';
}

export function resolveClaudeSessionTransport(inputs: {
	readonly model: ModelSelection | undefined;
	readonly defaultMode: ClaudeTransportMode;
}): ClaudeTransportMode {
	const { model, defaultMode } = inputs;
	if (!model) {
		return defaultMode;
	}
	const parsed = parseClaudeModelSelection(model);
	if (!parsed.explicitProvider) {
		return defaultMode;
	}
	return claudeTransportForProvider(parsed.provider);
}

export function mergeClaudeModelCatalogs(proxy: readonly IAgentModelInfo[], native: readonly IAgentModelInfo[]): IAgentModelInfo[] {
	return [
		...withQualifiedProvider(proxy, CLAUDE_PROVIDER_DARDCOR_ROUTER),
		...withQualifiedProvider(native, CLAUDE_PROVIDER_ANTHROPIC),
	];
}

function withQualifiedProvider(models: readonly IAgentModelInfo[], provider: string): IAgentModelInfo[] {
	return models.map(model => ({
		...model,
		id: toClaudeModelSelectionId(provider, model.id),
		_meta: { ...model._meta, ...createAgentModelGroupMeta(provider) },
	}));
}
