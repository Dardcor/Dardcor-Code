/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionModelInfo } from './state/protocol/state.js';
import type { IAgentModelInfo } from './agent.js';

export const BYOK_MODEL_IDENTIFIER_META_KEY = 'byokModelIdentifier';

export function createAgentModelByokMeta(modelIdentifier: string | undefined): Record<string, unknown> | undefined {
	return modelIdentifier !== undefined ? { [BYOK_MODEL_IDENTIFIER_META_KEY]: modelIdentifier } : undefined;
}

export function readAgentModelByokIdentifier(model: IAgentModelInfo | SessionModelInfo): string | undefined {
	const meta = model._meta;
	if (!meta) {
		return undefined;
	}
	const value = meta[BYOK_MODEL_IDENTIFIER_META_KEY];
	return typeof value === 'string' ? value : undefined;
}
