/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const AGENT_MERGE_MESSAGE_META_KEY = 'vscode.chat.agentMerge';

interface IHasAgentMergeMessageMeta {
	readonly _meta?: Record<string, unknown>;
}

export function isAgentMergeMessage(source: IHasAgentMergeMessageMeta): boolean {
	return source._meta?.[AGENT_MERGE_MESSAGE_META_KEY] === true;
}

export function toAgentMergeMessageMeta(): Record<string, unknown> {
	return { [AGENT_MERGE_MESSAGE_META_KEY]: true };
}
