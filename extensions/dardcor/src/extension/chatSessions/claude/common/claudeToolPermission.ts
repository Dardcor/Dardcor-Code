/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PermissionMode, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type * as vscode from 'vscode';
import { ClaudeToolInputMap, ClaudeToolNames } from './claudeTools';

export type ClaudeToolPermissionResult =
	| { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
	| { behavior: 'deny'; message: string };

export interface ClaudeToolPermissionContext {
	readonly toolInvocationToken: vscode.ChatParticipantToolToken;
	readonly permissionMode?: PermissionMode;
	readonly stream?: vscode.ChatResponseStream;
	readonly sessionId?: string;
}

export interface IClaudeToolConfirmationParams {
	readonly title: string;
	readonly message: string;
}

export interface IClaudeToolPermissionHandler<TToolName extends ClaudeToolNames = ClaudeToolNames> {
	readonly toolNames: readonly TToolName[];

	canAutoApprove?(
		toolName: TToolName,
		input: ClaudeToolInputMap[TToolName],
		context: ClaudeToolPermissionContext
	): Promise<boolean>;

	getConfirmationParams?(
		toolName: TToolName,
		input: ClaudeToolInputMap[TToolName]
	): IClaudeToolConfirmationParams;

	handle?(
		toolName: TToolName,
		input: ClaudeToolInputMap[TToolName],
		context: ClaudeToolPermissionContext
	): Promise<ClaudeToolPermissionResult>;
}

export type IClaudeToolPermissionHandlerCtor<TToolName extends ClaudeToolNames = ClaudeToolNames> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Constructor types for DI require 'any' for parameter compatibility
	new (...args: any[]) => IClaudeToolPermissionHandler<TToolName>;
