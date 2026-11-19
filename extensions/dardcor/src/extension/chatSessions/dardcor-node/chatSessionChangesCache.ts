/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatSessionWorkspaceFolderService } from '../common/chatSessionWorkspaceFolderService';
import { IChatSessionWorktreeService } from '../common/chatSessionWorktreeService';
import { IChatSessionMetadataStore } from '../common/chatSessionMetadataStore';

export async function clearChangesCacheForAffectedSessions(folder: vscode.Uri, sessionsToIgnore: string[], logService: ILogService, metadataStore: IChatSessionMetadataStore, workspaceFolderService: IChatSessionWorkspaceFolderService, worktreeService: IChatSessionWorktreeService): Promise<void> {
	logService.trace(`[ChatSessionChangesCache] Repository state changed for ${folder.toString()}. Updating session properties.`);

	const sessionIds = metadataStore.getSessionIdsForFolder(folder).filter(id => !sessionsToIgnore.includes(id));
	const workspaceSessionIds = workspaceFolderService.clearWorkspaceChanges(folder).filter(id => !sessionsToIgnore.includes(id));
	sessionIds.forEach(id => workspaceFolderService.clearWorkspaceChanges(id));
	sessionIds.push(...workspaceSessionIds);
	await Promise.all(Array.from(new Set(sessionIds)).map(async sessionId => {
		const worktreeProperties = await worktreeService.getWorktreeProperties(sessionId);
		if (worktreeProperties) {
			await worktreeService.setWorktreeProperties(sessionId, {
				...worktreeProperties,
				changes: undefined
			});
		}
	}));
	logService.trace(`[ChatSessionChangesCache] Updated session properties for worktree ${folder.toString()}.`);
}
