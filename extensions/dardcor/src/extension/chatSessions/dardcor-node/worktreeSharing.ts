/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IChatSessionMetadataStore } from '../common/chatSessionMetadataStore';
import { IChatSessionWorkspaceFolderService } from '../common/chatSessionWorkspaceFolderService';

export async function getBlockingSiblingSessionsForFolder(
	folder: vscode.Uri,
	excludeSessionId: string,
	metadataStore: IChatSessionMetadataStore,
	workspaceFolderService: IChatSessionWorkspaceFolderService,
): Promise<string[]> {
	const candidates = new Set<string>([
		...metadataStore.getSessionIdsForFolder(folder),
		...workspaceFolderService.getAssociatedSessions(folder),
	]);
	candidates.delete(excludeSessionId);

	const results: string[] = [];
	await Promise.all(Array.from(candidates).map(async id => {
		const [parent, archived] = await Promise.all([
			metadataStore.getSessionParentId(id),
			metadataStore.getSessionArchived(id),
		]);
		if (archived) {
			return;
		}
		if (parent?.kind === 'sub-session') {
			return;
		}
		results.push(id);
	}));
	return results;
}
