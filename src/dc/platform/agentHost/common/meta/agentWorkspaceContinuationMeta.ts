/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const AGENT_WORKSPACE_CONTINUATION_META_KEY = 'vscode.chat.workspaceContinuation';

interface IHasAgentWorkspaceContinuationMeta {
	readonly _meta?: Record<string, unknown>;
}

export function isAgentWorkspaceContinuationMessage(source: IHasAgentWorkspaceContinuationMeta): boolean {
	return source._meta?.[AGENT_WORKSPACE_CONTINUATION_META_KEY] === true;
}

export function toAgentWorkspaceContinuationMessageMeta(): Record<string, unknown> {
	return { [AGENT_WORKSPACE_CONTINUATION_META_KEY]: true };
}
