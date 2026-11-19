/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { IFolderRepositoryManager } from '../../../chatSessions/common/folderRepositoryManager';


export function computeFolderSlug(folderUri: URI): string {
	return folderUri.path
		.replace(/^\/([a-z]):/i, (_, driveLetter: string) => driveLetter.toUpperCase() + '-')
		.replace(/[\/ .]/g, '-');
}



export interface ProjectFolder {
	readonly slug: string;
	readonly folderUri: URI;
}

export async function getProjectFolders(
	workspace: IWorkspaceService,
	folderRepositoryManager: IFolderRepositoryManager
): Promise<ProjectFolder[]> {
	const folders = workspace.getWorkspaceFolders();

	if (folders.length > 0) {
		return folders.map(folder => ({ slug: computeFolderSlug(folder), folderUri: folder }));
	}

	const mruEntries = await folderRepositoryManager.getFolderMRU();
	if (mruEntries.length > 0) {
		return mruEntries.map(entry => ({ slug: computeFolderSlug(entry.folder), folderUri: entry.folder }));
	}

	return [];
}

