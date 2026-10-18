/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ConfigSchema, JsonPrimitive, ProtectedResourceMetadata } from '../common/state.js';
import type { TerminalInfo } from '../channels-terminal/state.js';
import type { Customization } from '../channels-session/state.js';


export const enum PolicyState {
	Enabled = 'enabled',
	Disabled = 'disabled',
	Unconfigured = 'unconfigured',
}

export interface RootState {
	agents: AgentInfo[];
	activeSessions?: number;
	terminals?: TerminalInfo[];
	config?: RootConfigState;
	_meta?: Record<string, unknown>;
}

export interface AgentInfo {
	provider: string;
	displayName: string;
	description: string;
	models: SessionModelInfo[];
	protectedResources?: ProtectedResourceMetadata[];
	customizations?: Customization[];
	capabilities?: AgentCapabilities;
}

export interface AgentCapabilities {
	multipleChats?: MultipleChatsCapability;
	multipleWorkingDirectories?: MultipleWorkingDirectoriesCapability;
}

export interface MultipleChatsCapability {
	fork?: boolean;
	sideChat?: boolean;
}

export interface MultipleWorkingDirectoriesCapability {
	immutablePrimary?: boolean;
	primaryReplacement?: boolean;
}

export interface SessionModelInfo {
	id: string;
	provider: string;
	name: string;
	maxContextWindow?: number;
	maxOutputTokens?: number;
	maxPromptTokens?: number;
	supportsVision?: boolean;
	policyState?: PolicyState;
	configSchema?: ConfigSchema;
	_meta?: Record<string, unknown>;
}

export interface ModelSelection {
	id: string;
	config?: Record<string, JsonPrimitive>;
}


export interface RootConfigState {
	schema: ConfigSchema;
	values: Record<string, unknown>;
}
