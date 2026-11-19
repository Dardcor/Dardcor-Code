/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IWorkingCopyBackupService } from '../common/workingCopyBackup.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IFilesConfigurationService, AutoSaveMode } from '../../filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyService } from '../common/workingCopyService.js';
import { IWorkingCopy, IWorkingCopyIdentifier, WorkingCopyCapabilities } from '../common/workingCopy.js';
import { ILifecycleService, ShutdownReason } from '../../lifecycle/common/lifecycle.js';
import { ConfirmResult, IFileDialogService, IDialogService, getFileNamesMessage } from '../../../../platform/dialogs/common/dialogs.js';
import { WorkbenchState, IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { HotExitConfiguration } from '../../../../platform/files/common/files.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { WorkingCopyBackupTracker } from '../common/workingCopyBackupTracker.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { SaveReason } from '../../../common/editor.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { Promises, raceCancellation } from '../../../../base/common/async.js';
import { IWorkingCopyEditorService } from '../common/workingCopyEditorService.js';

export class NativeWorkingCopyBackupTracker extends WorkingCopyBackupTracker implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.nativeWorkingCopyBackupTracker';

	constructor(
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ILogService logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IProgressService private readonly progressService: IProgressService,
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService editorService: IEditorService,
	) {
		super(workingCopyBackupService, workingCopyService, logService, lifecycleService, filesConfigurationService, workingCopyEditorService, editorService);
	}

	protected async onFinalBeforeShutdown(reason: ShutdownReason): Promise<boolean> {


		this.cancelBackupOperations();


		const { resume } = this.suspendBackupOperations();

		try {

			const modifiedWorkingCopies = this.workingCopyService.modifiedWorkingCopies;
			if (modifiedWorkingCopies.length) {
				return await this.onBeforeShutdownWithModified(reason, modifiedWorkingCopies);
			}

			else {
				return await this.onBeforeShutdownWithoutModified();
			}
		} finally {
			resume();
		}
	}

	protected async onBeforeShutdownWithModified(reason: ShutdownReason, modifiedWorkingCopies: readonly IWorkingCopy[]): Promise<boolean> {


		const workingCopiesToAutoSave = modifiedWorkingCopies.filter(wc => !(wc.capabilities & WorkingCopyCapabilities.Untitled) && this.filesConfigurationService.getAutoSaveMode(wc.resource).mode !== AutoSaveMode.OFF);
		if (workingCopiesToAutoSave.length > 0) {

			try {
				await this.doSaveAllBeforeShutdown(workingCopiesToAutoSave, SaveReason.AUTO);
			} catch (error) {
				this.logService.error(`[backup tracker] error saving modified working copies: ${error}`);
			}

			const remainingModifiedWorkingCopies = this.workingCopyService.modifiedWorkingCopies;
			if (remainingModifiedWorkingCopies.length) {
				return this.handleModifiedBeforeShutdown(remainingModifiedWorkingCopies, reason);
			}

			return this.noVeto([...modifiedWorkingCopies]);
		}

		return this.handleModifiedBeforeShutdown(modifiedWorkingCopies, reason);
	}

	private async handleModifiedBeforeShutdown(modifiedWorkingCopies: readonly IWorkingCopy[], reason: ShutdownReason): Promise<boolean> {

		let backups: IWorkingCopy[] = [];
		let backupError: Error | undefined = undefined;
		const modifiedWorkingCopiesToBackup = await this.shouldBackupBeforeShutdown(reason, modifiedWorkingCopies);
		if (modifiedWorkingCopiesToBackup.length > 0) {
			try {
				const backupResult = await this.backupBeforeShutdown(modifiedWorkingCopiesToBackup);
				backups = backupResult.backups;
				backupError = backupResult.error;

				if (backups.length === modifiedWorkingCopies.length) {
					return false;
				}
			} catch (error) {
				backupError = error;
			}
		}

		const remainingModifiedWorkingCopies = modifiedWorkingCopies.filter(workingCopy => !backups.includes(workingCopy));

		if (backupError) {
			if (this.environmentService.isExtensionDevelopment) {
				this.logService.error(`[backup tracker] error creating backups: ${backupError}`);

				return false;
			}

			return this.showErrorDialog(localize('backupTrackerBackupFailed', "The following editors with unsaved changes could not be saved to the backup location."), remainingModifiedWorkingCopies, backupError, reason);
		}


		try {
			return await this.confirmBeforeShutdown(remainingModifiedWorkingCopies);
		} catch (error) {
			if (this.environmentService.isExtensionDevelopment) {
				this.logService.error(`[backup tracker] error saving or reverting modified working copies: ${error}`);

				return false;
			}

			return this.showErrorDialog(localize('backupTrackerConfirmFailed', "The following editors with unsaved changes could not be saved or reverted."), remainingModifiedWorkingCopies, error, reason);
		}
	}

	private async shouldBackupBeforeShutdown(reason: ShutdownReason, modifiedWorkingCopies: readonly IWorkingCopy[]): Promise<readonly IWorkingCopy[]> {
		if (!this.filesConfigurationService.isHotExitEnabled) {
			return [];
		}

		if (this.environmentService.isExtensionDevelopment) {
			return modifiedWorkingCopies;
		}

		switch (reason) {

			case ShutdownReason.CLOSE:
				if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.filesConfigurationService.hotExitConfiguration === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
					return modifiedWorkingCopies;
				}

				if (isMacintosh || await this.nativeHostService.getWindowCount() > 1) {
					if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY) {
						return modifiedWorkingCopies.filter(modifiedWorkingCopy => modifiedWorkingCopy.capabilities & WorkingCopyCapabilities.Scratchpad);
					}

					return [];
				}

				return modifiedWorkingCopies;

			case ShutdownReason.QUIT:
				return modifiedWorkingCopies;

			case ShutdownReason.RELOAD:
				return modifiedWorkingCopies;

			case ShutdownReason.LOAD:
				if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY) {
					if (this.filesConfigurationService.hotExitConfiguration === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
						return modifiedWorkingCopies;
					}

					return modifiedWorkingCopies.filter(modifiedWorkingCopy => modifiedWorkingCopy.capabilities & WorkingCopyCapabilities.Scratchpad);
				}

				return [];
		}
	}

	private async showErrorDialog(message: string, workingCopies: readonly IWorkingCopy[], error: Error, reason: ShutdownReason): Promise<boolean> {
		this.logService.error(`[backup tracker] ${message}: ${error}`);

		const modifiedWorkingCopies = workingCopies.filter(workingCopy => workingCopy.isModified());

		const advice = localize('backupErrorDetails', "Try saving or reverting the editors with unsaved changes first and then try again.");
		const detail = modifiedWorkingCopies.length
			? `${getFileNamesMessage(modifiedWorkingCopies.map(x => x.name))}\n${advice}`
			: advice;

		const { result } = await this.dialogService.prompt({
			type: 'error',
			message,
			detail,
			buttons: [
				{
					label: localize({ key: 'ok', comment: ['&& denotes a mnemonic'] }, "&&OK"),
					run: () => true
				},
				{
					label: this.toForceShutdownLabel(reason),
					run: () => false
				}
			],
		});

		return result ?? true;
	}

	private toForceShutdownLabel(reason: ShutdownReason): string {
		switch (reason) {
			case ShutdownReason.CLOSE:
			case ShutdownReason.LOAD:
				return localize('shutdownForceClose', "Close Anyway");
			case ShutdownReason.QUIT:
				return localize('shutdownForceQuit', "Quit Anyway");
			case ShutdownReason.RELOAD:
				return localize('shutdownForceReload', "Reload Anyway");
		}
	}

	private async backupBeforeShutdown(modifiedWorkingCopies: readonly IWorkingCopy[]): Promise<{ backups: IWorkingCopy[]; error?: Error }> {
		const backups: IWorkingCopy[] = [];
		let error: Error | undefined = undefined;

		await this.withProgressAndCancellation(async token => {

			try {
				await Promises.settled(modifiedWorkingCopies.map(async workingCopy => {

					const contentVersion = this.getContentVersion(workingCopy);
					if (this.workingCopyBackupService.hasBackupSync(workingCopy, contentVersion)) {
						backups.push(workingCopy);
					}

					else {
						const backup = await workingCopy.backup(token);
						if (token.isCancellationRequested) {
							return;
						}

						await this.workingCopyBackupService.backup(workingCopy, backup.content, contentVersion, backup.meta, token);
						if (token.isCancellationRequested) {
							return;
						}

						backups.push(workingCopy);
					}
				}));
			} catch (backupError) {
				error = backupError;
			}
		},
			localize('backupBeforeShutdownMessage', "Backing up editors with unsaved changes is taking a bit longer..."),
			localize('backupBeforeShutdownDetail', "Click 'Cancel' to stop waiting and to save or revert editors with unsaved changes.")
		);

		return { backups, error };
	}

	private async confirmBeforeShutdown(modifiedWorkingCopies: IWorkingCopy[]): Promise<boolean> {

		const confirm = await this.fileDialogService.showSaveConfirm(modifiedWorkingCopies.map(workingCopy => workingCopy.name));
		if (confirm === ConfirmResult.SAVE) {
			const modifiedCountBeforeSave = this.workingCopyService.modifiedCount;

			try {
				await this.doSaveAllBeforeShutdown(modifiedWorkingCopies, SaveReason.EXPLICIT);
			} catch (error) {
				this.logService.error(`[backup tracker] error saving modified working copies: ${error}`);
			}

			const savedWorkingCopies = modifiedCountBeforeSave - this.workingCopyService.modifiedCount;
			if (savedWorkingCopies < modifiedWorkingCopies.length) {
				return true;
			}

			return this.noVeto(modifiedWorkingCopies);
		}

		else if (confirm === ConfirmResult.DONT_SAVE) {
			try {
				await this.doRevertAllBeforeShutdown(modifiedWorkingCopies);
			} catch (error) {
				this.logService.error(`[backup tracker] error reverting modified working copies: ${error}`);
			}

			return this.noVeto(modifiedWorkingCopies);
		}

		return true;
	}

	private doSaveAllBeforeShutdown(workingCopies: IWorkingCopy[], reason: SaveReason): Promise<void> {
		return this.withProgressAndCancellation(async () => {

			const saveOptions = { skipSaveParticipants: true, reason };

			let result: boolean | undefined = undefined;
			if (workingCopies.length === this.workingCopyService.modifiedCount) {
				result = (await this.editorService.saveAll({
					includeUntitled: { includeScratchpad: true },
					...saveOptions
				})).success;
			}

			if (result !== false) {
				await Promises.settled(workingCopies.map(workingCopy => workingCopy.isModified() ? workingCopy.save(saveOptions) : Promise.resolve(true)));
			}
		},
			localize('saveBeforeShutdown', "Saving editors with unsaved changes is taking a bit longer..."),
			undefined,
			workingCopies.some(workingCopy => workingCopy.capabilities & WorkingCopyCapabilities.Untitled || workingCopy.capabilities & WorkingCopyCapabilities.Scratchpad) ? ProgressLocation.Window : ProgressLocation.Dialog);
	}

	private doRevertAllBeforeShutdown(modifiedWorkingCopies: IWorkingCopy[]): Promise<void> {
		return this.withProgressAndCancellation(async () => {

			const revertOptions = { soft: true };

			if (modifiedWorkingCopies.length === this.workingCopyService.modifiedCount) {
				await this.editorService.revertAll(revertOptions);
			}

			await Promises.settled(modifiedWorkingCopies.map(workingCopy => workingCopy.isModified() ? workingCopy.revert(revertOptions) : Promise.resolve()));
		}, localize('revertBeforeShutdown', "Reverting editors with unsaved changes is taking a bit longer..."));
	}

	private onBeforeShutdownWithoutModified(): Promise<boolean> {


		return this.noVeto({ except: this.contextService.getWorkbenchState() === WorkbenchState.EMPTY ? [] : Array.from(this.unrestoredBackups) });
	}

	private noVeto(backupsToDiscard: IWorkingCopyIdentifier[]): Promise<boolean>;
	private noVeto(backupsToKeep: { except: IWorkingCopyIdentifier[] }): Promise<boolean>;
	private async noVeto(arg1: IWorkingCopyIdentifier[] | { except: IWorkingCopyIdentifier[] }): Promise<boolean> {


		await this.discardBackupsBeforeShutdown(arg1);

		return false;
	}

	private discardBackupsBeforeShutdown(backupsToDiscard: IWorkingCopyIdentifier[]): Promise<void>;
	private discardBackupsBeforeShutdown(backupsToKeep: { except: IWorkingCopyIdentifier[] }): Promise<void>;
	private discardBackupsBeforeShutdown(backupsToDiscardOrKeep: IWorkingCopyIdentifier[] | { except: IWorkingCopyIdentifier[] }): Promise<void>;
	private async discardBackupsBeforeShutdown(arg1: IWorkingCopyIdentifier[] | { except: IWorkingCopyIdentifier[] }): Promise<void> {


		if (!this.isReady) {
			return;
		}

		await this.withProgressAndCancellation(async () => {


			try {
				if (Array.isArray(arg1)) {
					await Promises.settled(arg1.map(workingCopy => this.workingCopyBackupService.discardBackup(workingCopy)));
				} else {
					await this.workingCopyBackupService.discardBackups(arg1);
				}
			} catch (error) {
				this.logService.error(`[backup tracker] error discarding backups: ${error}`);
			}
		}, localize('discardBackupsBeforeShutdown', "Discarding backups is taking a bit longer..."));
	}

	private withProgressAndCancellation(promiseFactory: (token: CancellationToken) => Promise<void>, title: string, detail?: string, location = ProgressLocation.Dialog): Promise<void> {
		const cts = new CancellationTokenSource();

		return this.progressService.withProgress({
			location,
			cancellable: true,
			delay: 800,
			title,
			detail
		}, () => raceCancellation(promiseFactory(cts.token), cts.token), () => cts.dispose(true));
	}
}
