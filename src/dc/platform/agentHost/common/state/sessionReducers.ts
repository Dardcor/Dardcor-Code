/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export { rootReducer, sessionReducer, chatReducer, changesetReducer, annotationsReducer, automationReducer, automationRunReducer, softAssertNever, isClientDispatchable } from './protocol/reducers.js';

import { AgentPermissionRequestKind, readAgentPermissionRequestMeta } from '../meta/agentPermissionRequestMeta.js';
import { readToolCallMeta, type ToolKind } from '../meta/agentToolCallMeta.js';
import type { ICompletedToolCall, ToolCallState } from './sessionState.js';

const PERMISSION_REQUEST_TOOL_KINDS: Readonly<Partial<Record<AgentPermissionRequestKind, ToolKind>>> = {
	[AgentPermissionRequestKind.Commands]: 'terminal',
	[AgentPermissionRequestKind.Read]: 'read',
};

export function getToolKind(tc: ToolCallState | ICompletedToolCall): ToolKind | undefined {
	const kind = readToolCallMeta(tc).toolKind;
	if (kind) {
		return kind;
	}
	const permissionKind = readAgentPermissionRequestMeta(tc).kind;
	return permissionKind ? PERMISSION_REQUEST_TOOL_KINDS[permissionKind] : undefined;
}
