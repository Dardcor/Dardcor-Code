/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';
import type { BaseParams, PaginatedParams, PaginatedResult } from '../common/commands.js';
import type { SessionSummary, SessionConfigSchema } from '../channels-session/state.js';

export type { ConfigPropertySchema, ConfigSchema } from '../common/state.js';
export type { SessionConfigPropertySchema, SessionConfigSchema } from '../channels-session/state.js';


export interface ListSessionsParams extends BaseParams, PaginatedParams {
	channel: 'ahp-root://';
}

export interface ListSessionsResult extends PaginatedResult {
	items: SessionSummary[];
}


export interface ResolveSessionConfigParams extends BaseParams {
	channel: 'ahp-root://';
	provider?: string;
	workingDirectory?: URI;
	config?: Record<string, unknown>;
}

export interface ResolveSessionConfigResult {
	schema: SessionConfigSchema;
	values: Record<string, unknown>;
}


export interface SessionConfigValueItem {
	value: string;
	label: string;
	description?: string;
}

export interface SessionConfigCompletionsParams extends BaseParams {
	channel: 'ahp-root://';
	provider?: string;
	workingDirectory?: URI;
	config?: Record<string, unknown>;
	property: string;
	query?: string;
}

export interface SessionConfigCompletionsResult {
	items: SessionConfigValueItem[];
}
