/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentInfo, Query } from '@anthropic-ai/claude-agent-sdk';
import { Event } from '../../../../util/dardcor/base/common/event';
import { createDecorator } from '../../../../util/dardcor/platform/instantiation/common/instantiation';

export const IClaudeRuntimeDataService = createDecorator<IClaudeRuntimeDataService>('claudeRuntimeDataService');

export interface IClaudeRuntimeDataService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	getAgents(): readonly AgentInfo[];

	update(query: Query): Promise<void>;
}
