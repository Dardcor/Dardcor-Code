/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { feedbackServerToolGroup } from './agentFeedbackServerTools.js';
import { createSessionServerToolGroup, type ISessionServerToolAccessor } from './sessionServerTools.js';
import type { IServerToolDisplay, IServerToolDisplayResult, IServerToolGroup } from './agentServerToolHost.js';
import { createAgentMergeServerToolGroup, type IAgentMergeToolAccessor } from './agentMergeServerTools.js';
import { createArtifactServerToolGroup, type IArtifactServerToolAccessor } from './artifactServerTools.js';

export function buildServerToolGroups(sessionAccessor?: ISessionServerToolAccessor, agentMergeAccessor?: IAgentMergeToolAccessor, artifactAccessor?: IArtifactServerToolAccessor): readonly IServerToolGroup[] {
	return [
		feedbackServerToolGroup,
		createSessionServerToolGroup(sessionAccessor),
		createAgentMergeServerToolGroup(agentMergeAccessor),
		createArtifactServerToolGroup(artifactAccessor),
	];
}

const serverToolGroupsForDisplay: readonly IServerToolGroup[] = buildServerToolGroups();

function matchesServerToolName(toolName: string, bareName: string): boolean {
	return toolName === bareName || toolName.endsWith(`__${bareName}`);
}

export function getServerToolDisplay(toolName: string, args: unknown, result?: IServerToolDisplayResult): IServerToolDisplay | undefined {
	for (const group of serverToolGroupsForDisplay) {
		if (!group.getDisplay) {
			continue;
		}
		for (const def of group.definitions) {
			if (matchesServerToolName(toolName, def.name)) {
				return group.getDisplay(def.name, args, result);
			}
		}
	}
	for (const group of serverToolGroupsForDisplay) {
		if (!group.getDisplay) {
			continue;
		}
		for (const [legacyName, currentName] of group.legacyToolNames ?? []) {
			if (matchesServerToolName(toolName, legacyName)) {
				return group.getDisplay(currentName, args, result);
			}
		}
	}
	return undefined;
}
