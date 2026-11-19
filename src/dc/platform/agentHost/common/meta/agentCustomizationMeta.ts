/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Mutable } from '../../../../base/common/types.js';
import type { AgentCustomization } from '../state/protocol/state.js';

export interface IAgentCustomizationMeta {
	readonly userInvocable?: boolean;
}

export function readAgentCustomizationMeta(agent: AgentCustomization): IAgentCustomizationMeta {
	const meta = agent._meta;
	const result: Mutable<IAgentCustomizationMeta> = {};
	if (agent.disableUserInvocation === true) {
		result.userInvocable = false;
	} else if (typeof meta?.['userInvocable'] === 'boolean') {
		result.userInvocable = meta['userInvocable'];
	}
	return result;
}

export function toAgentCustomizationMeta(meta: IAgentCustomizationMeta): Record<string, unknown> | undefined {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(meta)) {
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}
