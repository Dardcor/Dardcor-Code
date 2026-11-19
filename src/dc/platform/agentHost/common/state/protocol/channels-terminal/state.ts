/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';


export interface TerminalInfo {
	resource: URI;
	title: string;
	claim: TerminalClaim;
	lifecycle: TerminalLifecycleState;
}

export const enum TerminalLifecycleStatus {
	Running = 'running',
	Exited = 'exited',
}

export interface TerminalRunningLifecycleState {
	status: TerminalLifecycleStatus.Running;
}

export interface TerminalExitedLifecycleState {
	status: TerminalLifecycleStatus.Exited;
	exitCode?: number;
}

export type TerminalLifecycleState =
	| TerminalRunningLifecycleState
	| TerminalExitedLifecycleState;

export const enum TerminalClaimKind {
	Client = 'client',
	Session = 'session',
}

export interface TerminalClientClaim {
	kind: TerminalClaimKind.Client;
	clientId: string;
}

export interface TerminalSessionClaim {
	kind: TerminalClaimKind.Session;
	session: URI;
	chat: URI;
	turnId?: string;
	toolCallId?: string;
}

export type TerminalClaim = TerminalClientClaim | TerminalSessionClaim;

export interface TerminalState {
	title: string;
	cwd?: URI;
	cols?: number;
	rows?: number;
	content: TerminalContentPart[];
	lifecycle: TerminalLifecycleState;
	claim: TerminalClaim;
	supportsCommandDetection?: boolean;
	isPty?: boolean;
}


export type TerminalContentPart =
	| TerminalUnclassifiedPart
	| TerminalCommandPart;

export interface TerminalUnclassifiedPart {
	type: 'unclassified';
	value: string;
}

export interface TerminalCommandPart {
	type: 'command';
	commandId: string;
	commandLine: string;
	output: string;
	timestamp: number;
	isComplete: boolean;
	exitCode?: number;
	durationMs?: number;
}
