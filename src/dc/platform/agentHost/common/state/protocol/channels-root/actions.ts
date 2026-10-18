/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { AgentInfo } from './state.js';
import type { TerminalInfo } from '../channels-terminal/state.js';
import { ActionType } from '../common/actions.js';


export interface RootAgentsChangedAction {
	type: ActionType.RootAgentsChanged;
	agents: AgentInfo[];
}

export interface RootActiveSessionsChangedAction {
	type: ActionType.RootActiveSessionsChanged;
	activeSessions: number;
}

export interface RootTerminalsChangedAction {
	type: ActionType.RootTerminalsChanged;
	terminals: TerminalInfo[];
}

export interface RootConfigChangedAction {
	type: ActionType.RootConfigChanged;
	config: Record<string, unknown>;
	replace?: boolean;
}
