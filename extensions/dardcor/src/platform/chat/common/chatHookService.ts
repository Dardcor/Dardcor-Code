/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const IChatHookService = createServiceIdentifier<IChatHookService>('IChatHookService');

export interface IChatHookService {
	readonly _serviceBrand: undefined;

	logConfiguredHooks(hooks: vscode.ChatRequestHooks | undefined): void;

	executeHook(hookType: vscode.ChatHookType, hooks: vscode.ChatRequestHooks | undefined, input: unknown, sessionId?: string, token?: vscode.CancellationToken): Promise<vscode.ChatHookResult[]>;

	executePreToolUseHook(toolName: string, toolInput: unknown, toolCallId: string, hooks: vscode.ChatRequestHooks | undefined, sessionId?: string, token?: vscode.CancellationToken, outputStream?: vscode.ChatResponseStream): Promise<IPreToolUseHookResult | undefined>;

	executePostToolUseHook(toolName: string, toolInput: unknown, toolResponseText: string, toolCallId: string, hooks: vscode.ChatRequestHooks | undefined, sessionId?: string, token?: vscode.CancellationToken, outputStream?: vscode.ChatResponseStream): Promise<IPostToolUseHookResult | undefined>;
}

export interface IPreToolUseHookResult {
	permissionDecision?: 'allow' | 'deny' | 'ask';
	permissionDecisionReason?: string;
	updatedInput?: object;
	additionalContext?: string[];
}

export interface IPostToolUseHookResult {
	decision?: 'block';
	reason?: string;
	additionalContext?: string[];
}


export interface UserPromptSubmitHookInput {
	readonly prompt: string;
}

export interface UserPromptSubmitHookOutput {
	readonly decision?: 'block';
	readonly reason?: string;
	readonly hookSpecificOutput?: {
		readonly hookEventName?: string;
		readonly additionalContext?: string;
	};
}

export interface StopHookInput {
	readonly stop_hook_active: boolean;
}

export interface StopHookOutput {
	readonly hookSpecificOutput?: {
		readonly hookEventName?: string;
		readonly decision?: 'block';
		readonly reason?: string;
	};
}

export interface SessionStartHookInput {
	readonly source: 'new';
	readonly model: string;
	readonly agent_type?: string;
}

export interface SessionStartHookOutput {
	readonly hookSpecificOutput?: {
		readonly hookEventName?: string;
		readonly additionalContext?: string;
	};
}

export interface SubagentStartHookInput {
	readonly agent_id: string;
	readonly agent_type: string;
}

export interface SubagentStartHookOutput {
	readonly hookSpecificOutput?: {
		readonly hookEventName?: string;
		readonly additionalContext?: string;
	};
}

export interface SubagentStopHookInput {
	readonly agent_id: string;
	readonly agent_type: string;
	readonly stop_hook_active: boolean;
}

export interface SubagentStopHookOutput {
	readonly hookSpecificOutput?: {
		readonly hookEventName?: string;
		readonly decision?: 'block';
		readonly reason?: string;
	};
}

export interface PreCompactHookInput {
	readonly trigger: 'auto';
	readonly custom_instructions?: string;
}

