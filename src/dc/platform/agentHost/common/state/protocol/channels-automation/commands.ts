/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { BaseParams } from '../common/commands.js';
import type { URI } from '../common/state.js';
import type { AutomationTriggerDefinition } from './state.js';

export interface ListAutomationTriggerDefinitionsParams extends BaseParams {
	channel: 'ahp-root://';
	provider?: string;
	workingDirectories?: URI[];
	sessionConfig?: Record<string, unknown>;
}

export interface ListAutomationTriggerDefinitionsResult {
	items: AutomationTriggerDefinition[];
}

export interface RunAutomationParams extends BaseParams {
	channel: 'ahp-automations://';
	automation: URI;
	requestId: string;
}

export interface RunAutomationResult {
	resource: URI;
}

export interface FetchAutomationRunsParams extends BaseParams {
	channel: 'ahp-automations://';
	automation: URI;
	cursor?: string;
}

export interface FetchAutomationRunsResult { }
