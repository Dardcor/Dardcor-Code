/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkingCopyBackupService } from '../common/workingCopyBackup.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyService } from '../common/workingCopyService.js';
import { ILifecycleService, ShutdownReason } from '../../lifecycle/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { WorkingCopyBackupTracker } from '../common/workingCopyBackupTracker.js';
import { IWorkingCopyEditorService } from '../common/workingCopyEditorService.js';
import { IEditorService } from '../../editor/common/editorService.js';

export class BrowserWorkingCopyBackupTracker extends WorkingCopyBackupTracker implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.browserWorkingCopyBackupTracker';

	constructor(
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService logService: ILogService,
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService editorService: IEditorService,
	) {
		super(workingCopyBackupService, workingCopyService, logService, lifecycleService, filesConfigurationService, workingCopyEditorService, editorService);
	}

	protected onFinalBeforeShutdown(reason: ShutdownReason): boolean {


		const modifiedWorkingCopies = this.workingCopyService.modifiedWorkingCopies;
		if (!modifiedWorkingCopies.length) {
			return false;
		}

		if (!this.filesConfigurationService.isHotExitEnabled) {
			return true;
		}

		for (const modifiedWorkingCopy of modifiedWorkingCopies) {
			if (!this.workingCopyBackupService.hasBackupSync(modifiedWorkingCopy, this.getContentVersion(modifiedWorkingCopy))) {
				this.logService.warn('Unload veto: pending backups');

				return true;
			}
		}

		return false;
	}
}
