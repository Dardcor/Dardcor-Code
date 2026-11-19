/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCancellationError, onUnexpectedError } from '../../../../base/common/errors.js';
import { Schemas } from '../../../../base/common/network.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

export async function pruneRecentRemoteFolderIfMissing(
	contextService: IWorkspaceContextService,
	fileService: IFileService,
	workspacesService: IWorkspacesService,
): Promise<void> {
	if (contextService.getWorkbenchState() !== WorkbenchState.FOLDER) {
		return;
	}

	const folderUri = contextService.getWorkspace().folders[0]?.uri;
	if (!folderUri || folderUri.scheme !== Schemas.vscodeRemote) {
		return;
	}

	try {
		await fileService.stat(folderUri);
	} catch (error) {
		if (toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
			await workspacesService.removeRecentlyOpened([folderUri]);
		}
	}
}

class RecentRemoteFolderPrunerContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.recentRemoteFolderPruner';

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
		@IWorkspacesService workspacesService: IWorkspacesService,
	) {
		pruneRecentRemoteFolderIfMissing(contextService, fileService, workspacesService).catch(error => {
			if (!isCancellationError(error)) {
				onUnexpectedError(error);
			}
		});
	}
}

registerWorkbenchContribution2(RecentRemoteFolderPrunerContribution.ID, RecentRemoteFolderPrunerContribution, WorkbenchPhase.Eventually);
