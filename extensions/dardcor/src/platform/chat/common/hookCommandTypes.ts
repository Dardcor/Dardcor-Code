/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



export interface IPreToolUseHookCommandInput {
	readonly tool_name: string;
	readonly tool_input: unknown;
	readonly tool_use_id: string;
}

export interface IPreToolUseHookSpecificCommandOutput {
	readonly hookEventName?: string;
	readonly permissionDecision?: 'allow' | 'deny' | 'ask';
	readonly permissionDecisionReason?: string;
	readonly updatedInput?: object;
	readonly additionalContext?: string;
}



export interface IPostToolUseHookCommandInput {
	readonly tool_name: string;
	readonly tool_input: unknown;
	readonly tool_response: string;
	readonly tool_use_id: string;
}

export interface IPostToolUseHookSpecificCommandOutput {
	readonly hookEventName?: string;
	readonly additionalContext?: string;
}

