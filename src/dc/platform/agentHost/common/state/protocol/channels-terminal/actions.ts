/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { URI } from '../common/state.js';
import type { TerminalClaim } from './state.js';


export interface TerminalDataAction {
	type: ActionType.TerminalData;
	data: string;
}

export interface TerminalInputAction {
	type: ActionType.TerminalInput;
	data: string;
}

export interface TerminalResizedAction {
	type: ActionType.TerminalResized;
	cols: number;
	rows: number;
}

export interface TerminalClaimedAction {
	type: ActionType.TerminalClaimed;
	claim: TerminalClaim;
}

export interface TerminalTitleChangedAction {
	type: ActionType.TerminalTitleChanged;
	title: string;
}

export interface TerminalCwdChangedAction {
	type: ActionType.TerminalCwdChanged;
	cwd: URI;
}

export interface TerminalExitedAction {
	type: ActionType.TerminalExited;
	exitCode?: number;
}

export interface TerminalClearedAction {
	type: ActionType.TerminalCleared;
}

export interface TerminalCommandDetectionAvailableAction {
	type: ActionType.TerminalCommandDetectionAvailable;
}

export interface TerminalCommandExecutedAction {
	type: ActionType.TerminalCommandExecuted;
	commandId: string;
	commandLine: string;
	timestamp: number;
}

export interface TerminalCommandFinishedAction {
	type: ActionType.TerminalCommandFinished;
	commandId: string;
	exitCode?: number;
	durationMs?: number;
}
