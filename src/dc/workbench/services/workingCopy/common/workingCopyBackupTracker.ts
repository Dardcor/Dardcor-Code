/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkingCopyBackupService } from './workingCopyBackup.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { IWorkingCopy, IWorkingCopyIdentifier, WorkingCopyCapabilities } from './workingCopy.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ShutdownReason, ILifecycleService, LifecyclePhase, InternalBeforeShutdownEvent } from '../../lifecycle/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyEditorHandler, IWorkingCopyEditorService } from './workingCopyEditorService.js';
import { Promises } from '../../../../base/common/async.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { EditorsOrder } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export abstract class WorkingCopyBackupTracker extends Disposable {

	constructor(
		protected readonly workingCopyBackupService: IWorkingCopyBackupService,
		protected readonly workingCopyService: IWorkingCopyService,
		protected readonly logService: ILogService,
		private readonly lifecycleService: ILifecycleService,
		protected readonly filesConfigurationService: IFilesConfigurationService,
		private readonly workingCopyEditorService: IWorkingCopyEditorService,
		protected readonly editorService: IEditorService,
	) {
		super();

		this.whenReady = this.resolveBackupsToRestore();

		for (const workingCopy of this.workingCopyService.modifiedWorkingCopies) {
			this.onDidRegister(workingCopy);
		}

		this.registerListeners();
	}

	private registerListeners() {

		this._register(this.workingCopyService.onDidRegister(workingCopy => this.onDidRegister(workingCopy)));
		this._register(this.workingCopyService.onDidUnregister(workingCopy => this.onDidUnregister(workingCopy)));
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.onDidChangeDirty(workingCopy)));
		this._register(this.workingCopyService.onDidChangeContent(workingCopy => this.onDidChangeContent(workingCopy)));

		this._register(this.lifecycleService.onBeforeShutdown(event => (event as InternalBeforeShutdownEvent).finalVeto(() => this.onFinalBeforeShutdown(event.reason), 'veto.backups')));
		this._register(this.lifecycleService.onWillShutdown(() => this.onWillShutdown()));

		this._register(this.workingCopyEditorService.onDidRegisterHandler(handler => this.restoreBackups(handler)));
	}

	protected abstract onFinalBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean>;

	private onWillShutdown(): void {


		this.cancelBackupOperations();
		this.suspendBackupOperations();
	}



	private static readonly DEFAULT_BACKUP_SCHEDULE_DELAYS = {
		['default']: 1000,
		['delayed']: 2000
	};

	private readonly mapWorkingCopyToContentVersion = new Map<IWorkingCopy, number>();

	protected readonly pendingBackupOperations = new Map<IWorkingCopyIdentifier, { disposable: IDisposable; cancel: () => void }>();

	private suspended = false;

	private onDidRegister(workingCopy: IWorkingCopy): void {
		if (this.suspended) {
			this.logService.warn(`[backup tracker] suspended, ignoring register event`, workingCopy.resource.toString(), workingCopy.typeId);
			return;
		}

		if (workingCopy.isModified()) {
			this.scheduleBackup(workingCopy);
		}
	}

	private onDidUnregister(workingCopy: IWorkingCopy): void {

		this.mapWorkingCopyToContentVersion.delete(workingCopy);

		if (this.suspended) {
			this.logService.warn(`[backup tracker] suspended, ignoring unregister event`, workingCopy.resource.toString(), workingCopy.typeId);
			return;
		}

		this.discardBackup(workingCopy);
	}

	private onDidChangeDirty(workingCopy: IWorkingCopy): void {
		if (this.suspended) {
			this.logService.warn(`[backup tracker] suspended, ignoring dirty change event`, workingCopy.resource.toString(), workingCopy.typeId);
			return;
		}

		if (workingCopy.isDirty()) {
			this.scheduleBackup(workingCopy);
		} else {
			this.discardBackup(workingCopy);
		}
	}

	private onDidChangeContent(workingCopy: IWorkingCopy): void {

		const contentVersionId = this.getContentVersion(workingCopy);
		this.mapWorkingCopyToContentVersion.set(workingCopy, contentVersionId + 1);

		if (this.suspended) {
			this.logService.warn(`[backup tracker] suspended, ignoring content change event`, workingCopy.resource.toString(), workingCopy.typeId);
			return;
		}

		if (workingCopy.isModified()) {
			this.scheduleBackup(workingCopy);
		}
	}

	private scheduleBackup(workingCopy: IWorkingCopy): void {

		this.cancelBackupOperation(workingCopy);

		this.logService.trace(`[backup tracker] scheduling backup`, workingCopy.resource.toString(), workingCopy.typeId);

		const workingCopyIdentifier = { resource: workingCopy.resource, typeId: workingCopy.typeId };
		const cts = new CancellationTokenSource();
		const handle = setTimeout(async () => {
			if (cts.token.isCancellationRequested) {
				return;
			}

			if (workingCopy.isModified()) {
				this.logService.trace(`[backup tracker] creating backup`, workingCopy.resource.toString(), workingCopy.typeId);

				try {
					const backup = await workingCopy.backup(cts.token);
					if (cts.token.isCancellationRequested) {
						return;
					}

					if (workingCopy.isModified()) {
						this.logService.trace(`[backup tracker] storing backup`, workingCopy.resource.toString(), workingCopy.typeId);

						await this.workingCopyBackupService.backup(workingCopy, backup.content, this.getContentVersion(workingCopy), backup.meta, cts.token);
					}
				} catch (error) {
					this.logService.error(error);
				}
			}

			if (!cts.token.isCancellationRequested) {
				this.doClearPendingBackupOperation(workingCopyIdentifier);
			}
		}, this.getBackupScheduleDelay(workingCopy));

		this.pendingBackupOperations.set(workingCopyIdentifier, {
			cancel: () => {
				this.logService.trace(`[backup tracker] clearing pending backup creation`, workingCopy.resource.toString(), workingCopy.typeId);

				cts.cancel();
			},
			disposable: toDisposable(() => {
				cts.dispose();
				clearTimeout(handle);
			})
		});
	}

	protected getBackupScheduleDelay(workingCopy: IWorkingCopy): number {
		if (typeof workingCopy.backupDelay === 'number') {
			return workingCopy.backupDelay;
		}

		let backupScheduleDelay: 'default' | 'delayed';
		if (workingCopy.capabilities & WorkingCopyCapabilities.Untitled) {
			backupScheduleDelay = 'default';
		} else {
			backupScheduleDelay = this.filesConfigurationService.hasShortAutoSaveDelay(workingCopy.resource) ? 'delayed' : 'default';
		}

		return WorkingCopyBackupTracker.DEFAULT_BACKUP_SCHEDULE_DELAYS[backupScheduleDelay];
	}

	protected getContentVersion(workingCopy: IWorkingCopy): number {
		return this.mapWorkingCopyToContentVersion.get(workingCopy) || 0;
	}

	private discardBackup(workingCopy: IWorkingCopy): void {

		this.cancelBackupOperation(workingCopy);

		const workingCopyIdentifier = { resource: workingCopy.resource, typeId: workingCopy.typeId };
		const cts = new CancellationTokenSource();
		this.doDiscardBackup(workingCopyIdentifier, cts);

		this.pendingBackupOperations.set(workingCopyIdentifier, {
			cancel: () => {
				this.logService.trace(`[backup tracker] clearing pending backup discard`, workingCopy.resource.toString(), workingCopy.typeId);

				cts.cancel();
			},
			disposable: cts
		});
	}

	private async doDiscardBackup(workingCopyIdentifier: IWorkingCopyIdentifier, cts: CancellationTokenSource) {
		this.logService.trace(`[backup tracker] discarding backup`, workingCopyIdentifier.resource.toString(), workingCopyIdentifier.typeId);

		try {
			await this.workingCopyBackupService.discardBackup(workingCopyIdentifier, cts.token);
		} catch (error) {
			this.logService.error(error);
		}

		if (!cts.token.isCancellationRequested) {
			this.doClearPendingBackupOperation(workingCopyIdentifier);
		}
	}

	private cancelBackupOperation(workingCopy: IWorkingCopy): void {


		let workingCopyIdentifier: IWorkingCopyIdentifier | undefined = undefined;
		for (const [identifier] of this.pendingBackupOperations) {
			if (identifier.resource.toString() === workingCopy.resource.toString() && identifier.typeId === workingCopy.typeId) {
				workingCopyIdentifier = identifier;
				break;
			}
		}

		if (workingCopyIdentifier) {
			this.doClearPendingBackupOperation(workingCopyIdentifier, { cancel: true });
		}
	}

	private doClearPendingBackupOperation(workingCopyIdentifier: IWorkingCopyIdentifier, options?: { cancel: boolean }): void {
		const pendingBackupOperation = this.pendingBackupOperations.get(workingCopyIdentifier);
		if (!pendingBackupOperation) {
			return;
		}

		if (options?.cancel) {
			pendingBackupOperation.cancel();
		}

		pendingBackupOperation.disposable.dispose();

		this.pendingBackupOperations.delete(workingCopyIdentifier);
	}

	protected cancelBackupOperations(): void {
		for (const [, operation] of this.pendingBackupOperations) {
			operation.cancel();
			operation.disposable.dispose();
		}

		this.pendingBackupOperations.clear();
	}

	protected suspendBackupOperations(): { resume: () => void } {
		this.suspended = true;

		return { resume: () => this.suspended = false };
	}




	protected readonly unrestoredBackups = new Set<IWorkingCopyIdentifier>();
	protected readonly whenReady: Promise<void>;

	private _isReady = false;
	protected get isReady(): boolean { return this._isReady; }

	private async resolveBackupsToRestore(): Promise<void> {

		await this.lifecycleService.when(LifecyclePhase.Restored);

		for (const backup of await this.workingCopyBackupService.getBackups()) {
			this.unrestoredBackups.add(backup);
		}

		this._isReady = true;
	}

	protected async restoreBackups(handler: IWorkingCopyEditorHandler): Promise<void> {

		await this.whenReady;

		const openedEditorsForBackups = new Set<EditorInput>();
		const nonOpenedEditorsForBackups = new Set<EditorInput>();

		const restoredBackups = new Set<IWorkingCopyIdentifier>();
		for (const unrestoredBackup of this.unrestoredBackups) {
			const canHandleUnrestoredBackup = await handler.handles(unrestoredBackup);
			if (!canHandleUnrestoredBackup) {
				continue;
			}

			let hasOpenedEditorForBackup = false;
			for (const { editor } of this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
				const isUnrestoredBackupOpened = handler.isOpen(unrestoredBackup, editor);
				if (isUnrestoredBackupOpened) {
					openedEditorsForBackups.add(editor);
					hasOpenedEditorForBackup = true;
				}
			}

			if (!hasOpenedEditorForBackup) {
				nonOpenedEditorsForBackups.add(await handler.createEditor(unrestoredBackup));
			}

			restoredBackups.add(unrestoredBackup);
		}

		if (nonOpenedEditorsForBackups.size > 0) {
			await this.editorService.openEditors([...nonOpenedEditorsForBackups].map(nonOpenedEditorForBackup => ({
				editor: nonOpenedEditorForBackup,
				options: {
					pinned: true,
					preserveFocus: true,
					inactive: true
				}
			})));

			for (const nonOpenedEditorForBackup of nonOpenedEditorsForBackups) {
				openedEditorsForBackups.add(nonOpenedEditorForBackup);
			}
		}

		await Promises.settled([...openedEditorsForBackups].map(async openedEditorForBackup => {
			if (this.editorService.isVisible(openedEditorForBackup)) {
				return;
			}

			return openedEditorForBackup.resolve();
		}));

		for (const restoredBackup of restoredBackups) {
			this.unrestoredBackups.delete(restoredBackup);
		}
	}

}
