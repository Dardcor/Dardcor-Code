/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentModelInfo } from './agent.js';
import type { SessionModelInfo } from './state/protocol/state.js';

export const CHATGPT_SUBSCRIPTION_MODEL_SOURCE_ID = 'chatgptSubscription';

export const AGENT_MODEL_SOURCE_ID_META_KEY = 'modelSourceId';

export function createAgentModelSourceMeta(sourceId: string | undefined): Record<string, unknown> | undefined {
	return sourceId !== undefined ? { [AGENT_MODEL_SOURCE_ID_META_KEY]: sourceId } : undefined;
}

export function readAgentModelSourceId(model: IAgentModelInfo | SessionModelInfo): string | undefined {
	const meta = model._meta;
	if (!meta) {
		return undefined;
	}
	const value = meta[AGENT_MODEL_SOURCE_ID_META_KEY];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const AGENT_MODEL_GROUP_ID_META_KEY = 'modelGroupId';

export function createAgentModelGroupMeta(groupId: string): Record<string, unknown> {
	return { [AGENT_MODEL_GROUP_ID_META_KEY]: groupId };
}

export function readAgentModelGroupId(model: IAgentModelInfo | SessionModelInfo): string | undefined {
	const meta = model._meta;
	if (!meta) {
		return undefined;
	}
	const value = meta[AGENT_MODEL_GROUP_ID_META_KEY];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
