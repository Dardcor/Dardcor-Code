/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolCallContributorKind, type ToolCallContributor } from '../../common/state/sessionState.js';


export function toolSourceKindFromContributor(contributor: ToolCallContributor | undefined): string {
	if (!contributor) {
		return 'agentHost';
	}
	const kind: string = contributor.kind;
	switch (kind) {
		case ToolCallContributorKind.MCP:
			return 'mcp';
		case ToolCallContributorKind.Client:
			return 'client';
		default:
			return kind;
	}
}

export function canRefineContributor(current: ToolCallContributor | undefined, next: ToolCallContributor): boolean {
	if (current?.kind === ToolCallContributorKind.Client) {
		return next.kind === ToolCallContributorKind.Client && next.clientId === current.clientId;
	}
	return next.kind !== ToolCallContributorKind.Client;
}
