/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { ETAG_DISABLED, FileOperationError, FileOperationResult, IFileReadLimits, IFileService, IFileStatWithMetadata, IFileStreamContent, IWriteFileOptions, NotModifiedSinceFileOperationError } from '../../../../platform/files/common/files.js';
import { ISaveOptions, IRevertOptions, SaveReason } from '../../../common/editor.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { IWorkingCopyBackup, IWorkingCopyBackupMeta, IWorkingCopySaveEvent, WorkingCopyCapabilities } from './workingCopy.js';
import { raceCancellation, TaskSequentializer, timeout } from '../../../../base/common/async.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { IWorkingCopyFileService } from './workingCopyFileService.js';
import { VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyBackupService, IResolvedWorkingCopyBackup } from './workingCopyBackup.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { hash } from '../../../../base/common/hash.js';
import { isErrorWithActions, toErrorMessage } from '../../../../base/common/errorMessage.js';
import { IAction, toAction } from '../../../../base/common/actions.js';
import { isWindows } from '../../../../base/common/platform.js';
import { IWorkingCopyEditorService } from './workingCopyEditorService.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IElevatedFileService } from '../../files/common/elevatedFileService.js';
import { IResourceWorkingCopy, ResourceWorkingCopy } from './resourceWorkingCopy.js';
import { IFileWorkingCopy, IFileWorkingCopyModel, IFileWorkingCopyModelFactory, SnapshotContext } from './fileWorkingCopy.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { IProgress, IProgressService, IProgressStep, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { isCancellationError } from '../../../../base/common/errors.js';

export interface IStoredFileWorkingCopyModelFactory<M extends IStoredFileWorkingCopyModel> extends IFileWorkingCopyModelFactory<M> { }

export interface IStoredFileWorkingCopyModel extends IFileWorkingCopyModel {

	readonly onDidChangeContent: Event<IStoredFileWorkingCopyModelContentChangedEvent>;

	readonly versionId: unknown;

	pushStackElement(): void;

	save?(options: IWriteFileOptions, token: CancellationToken): Promise<IFileStatWithMetadata>;
}

export interface IStoredFileWorkingCopyModelContentChangedEvent {

	readonly isUndoing: boolean;

	readonly isRedoing: boolean;
}

export interface IStoredFileWorkingCopy<M extends IStoredFileWorkingCopyModel> extends IResourceWorkingCopy, IFileWorkingCopy<M> {

	readonly onDidResolve: Event<void>;

	readonly onDidSave: Event<IStoredFileWorkingCopySaveEvent>;

	readonly onDidSaveError: Event<void>;

	readonly onDidChangeReadonly: Event<void>;

	resolve(options?: IStoredFileWorkingCopyResolveOptions): Promise<void>;

	markModified(): void;

	hasState(state: StoredFileWorkingCopyState): boolean;

	joinState(state: StoredFileWorkingCopyState.PENDING_SAVE): Promise<void>;

	isResolved(): this is IResolvedStoredFileWorkingCopy<M>;

	isReadonly(): boolean | IMarkdownString;

	save(options?: IStoredFileWorkingCopySaveAsOptions): Promise<boolean>;
}

export interface IResolvedStoredFileWorkingCopy<M extends IStoredFileWorkingCopyModel> extends IStoredFileWorkingCopy<M> {

	readonly model: M;
}

export const enum StoredFileWorkingCopyState {

	SAVED,

	DIRTY,

	PENDING_SAVE,

	CONFLICT,

	ORPHAN,

	ERROR
}

export interface IStoredFileWorkingCopySaveOptions extends ISaveOptions {

	readonly writeUnlock?: boolean;

	readonly writeElevated?: boolean;

	readonly ignoreModifiedSince?: boolean;

	readonly ignoreErrorHandler?: boolean;
}

export interface IStoredFileWorkingCopySaveAsOptions extends IStoredFileWorkingCopySaveOptions {

	readonly from?: URI;
}

export interface IStoredFileWorkingCopyResolver {

	(options?: IStoredFileWorkingCopyResolveOptions): Promise<void>;
}

export interface IStoredFileWorkingCopyResolveOptions {

	readonly contents?: VSBufferReadableStream;

	readonly forceReadFromFile?: boolean;

	readonly limits?: IFileReadLimits;
}

interface IStoredFileWorkingCopyBackupMetaData extends IWorkingCopyBackupMeta {
	readonly mtime: number;
	readonly ctime: number;
	readonly size: number;
	readonly etag: string;
	readonly orphaned: boolean;
}

export interface IStoredFileWorkingCopySaveEvent extends IWorkingCopySaveEvent {

	readonly stat: IFileStatWithMetadata;
}

export function isStoredFileWorkingCopySaveEvent(e: IWorkingCopySaveEvent): e is IStoredFileWorkingCopySaveEvent {
	const candidate = e as IStoredFileWorkingCopySaveEvent;

	return !!candidate.stat;
}

export class StoredFileWorkingCopy<M extends IStoredFileWorkingCopyModel> extends ResourceWorkingCopy implements IStoredFileWorkingCopy<M> {

	readonly capabilities: WorkingCopyCapabilities = WorkingCopyCapabilities.None;

	private _model: M | undefined = undefined;
	get model(): M | undefined { return this._model; }


	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidResolve = this._register(new Emitter<void>());
	readonly onDidResolve = this._onDidResolve.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidSaveError = this._register(new Emitter<void>());
	readonly onDidSaveError = this._onDidSaveError.event;

	private readonly _onDidSave = this._register(new Emitter<IStoredFileWorkingCopySaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<void>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onDidChangeReadonly = this._register(new Emitter<void>());
	readonly onDidChangeReadonly = this._onDidChangeReadonly.event;


	constructor(
		readonly typeId: string,
		resource: URI,
		readonly name: string,
		private readonly modelFactory: IStoredFileWorkingCopyModelFactory<M>,
		private readonly externalResolver: IStoredFileWorkingCopyResolver,
		@IFileService fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkingCopyEditorService private readonly workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService private readonly editorService: IEditorService,
		@IElevatedFileService private readonly elevatedFileService: IElevatedFileService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super(resource, fileService);

		this._register(workingCopyService.registerWorkingCopy(this));

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.filesConfigurationService.onDidChangeReadonly(() => this._onDidChangeReadonly.fire()));
	}


	private dirty = false;
	private savedVersionId: unknown;

	isDirty(): this is IResolvedStoredFileWorkingCopy<M> {
		return this.dirty;
	}

	markModified(): void {
		this.setDirty(true);
	}

	private setDirty(dirty: boolean): void {
		if (!this.isResolved()) {
			return;
		}

		const wasDirty = this.dirty;
		this.doSetDirty(dirty);

		if (dirty !== wasDirty) {
			this._onDidChangeDirty.fire();
		}
	}

	private doSetDirty(dirty: boolean): () => void {
		const wasDirty = this.dirty;
		const wasInConflictMode = this.inConflictMode;
		const wasInErrorMode = this.inErrorMode;
		const oldSavedVersionId = this.savedVersionId;

		if (!dirty) {
			this.dirty = false;
			this.inConflictMode = false;
			this.inErrorMode = false;

			if (this.isResolved()) {
				this.savedVersionId = this.model.versionId;
			}
		} else {
			this.dirty = true;
		}

		return () => {
			this.dirty = wasDirty;
			this.inConflictMode = wasInConflictMode;
			this.inErrorMode = wasInErrorMode;
			this.savedVersionId = oldSavedVersionId;
		};
	}



	lastResolvedFileStat: IFileStatWithMetadata | undefined;

	isResolved(): this is IResolvedStoredFileWorkingCopy<M> {
		return !!this.model;
	}

	async resolve(options?: IStoredFileWorkingCopyResolveOptions): Promise<void> {
		this.trace('resolve() - enter');

		if (this.isDisposed()) {
			this.trace('resolve() - exit - without resolving because file working copy is disposed');

			return;
		}

		if (!options?.contents && (this.dirty || this.saveSequentializer.isRunning())) {
			this.trace('resolve() - exit - without resolving because file working copy is dirty or being saved');

			return;
		}

		return this.doResolve(options);
	}

	private async doResolve(options?: IStoredFileWorkingCopyResolveOptions): Promise<void> {

		if (options?.contents) {
			return this.resolveFromBuffer(options.contents);
		}

		const isNew = !this.isResolved();
		if (isNew) {
			const resolvedFromBackup = await this.resolveFromBackup();
			if (resolvedFromBackup) {
				return;
			}
		}

		return this.resolveFromFile(options);
	}

	private async resolveFromBuffer(buffer: VSBufferReadableStream): Promise<void> {
		this.trace('resolveFromBuffer()');

		let mtime: number;
		let ctime: number;
		let size: number;
		let etag: string;
		try {
			const metadata = await this.fileService.stat(this.resource);
			mtime = metadata.mtime;
			ctime = metadata.ctime;
			size = metadata.size;
			etag = metadata.etag;

			this.setOrphaned(false);
		} catch (error) {

			mtime = Date.now();
			ctime = Date.now();
			size = 0;
			etag = ETAG_DISABLED;

			this.setOrphaned(error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND);
		}

		return this.resolveFromContent({
			resource: this.resource,
			name: this.name,
			mtime,
			ctime,
			size,
			etag,
			value: buffer,
			readonly: false,
			locked: false,
			executable: false
		}, true );
	}

	private async resolveFromBackup(): Promise<boolean> {

		const backup = await this.workingCopyBackupService.resolve<IStoredFileWorkingCopyBackupMetaData>(this);

		const isNew = !this.isResolved();
		if (!isNew) {
			this.trace('resolveFromBackup() - exit - withoutresolving because previously new file working copy got created meanwhile');

			return true;
		}

		if (backup) {
			await this.doResolveFromBackup(backup);

			return true;
		}

		return false;
	}

	private async doResolveFromBackup(backup: IResolvedWorkingCopyBackup<IStoredFileWorkingCopyBackupMetaData>): Promise<void> {
		this.trace('doResolveFromBackup()');

		await this.resolveFromContent({
			resource: this.resource,
			name: this.name,
			mtime: backup.meta ? backup.meta.mtime : Date.now(),
			ctime: backup.meta ? backup.meta.ctime : Date.now(),
			size: backup.meta ? backup.meta.size : 0,
			etag: backup.meta ? backup.meta.etag : ETAG_DISABLED,
			value: backup.value,
			readonly: false,
			locked: false,
			executable: false
		}, true );

		if (backup.meta?.orphaned) {
			this.setOrphaned(true);
		}
	}

	private async resolveFromFile(options?: IStoredFileWorkingCopyResolveOptions): Promise<void> {
		this.trace('resolveFromFile()');

		const forceReadFromFile = options?.forceReadFromFile;

		let etag: string | undefined;
		if (forceReadFromFile) {
			etag = ETAG_DISABLED;
		} else if (this.lastResolvedFileStat) {
			etag = this.lastResolvedFileStat.etag;
		}

		const currentVersionId = this.versionId;

		try {
			const content = await this.fileService.readFileStream(this.resource, {
				etag,
				limits: options?.limits
			});

			this.setOrphaned(false);

			if (currentVersionId !== this.versionId) {
				this.trace('resolveFromFile() - exit - without resolving because file working copy content changed');

				return;
			}

			await this.resolveFromContent(content, false );
		} catch (error) {
			const result = error.fileOperationResult;

			this.setOrphaned(result === FileOperationResult.FILE_NOT_FOUND);

			if (this.isResolved() && result === FileOperationResult.FILE_NOT_MODIFIED_SINCE) {
				if (error instanceof NotModifiedSinceFileOperationError) {
					this.updateLastResolvedFileStat(error.stat);
				}

				return;
			}

			if (this.isResolved() && result === FileOperationResult.FILE_NOT_FOUND && !forceReadFromFile) {
				return;
			}

			throw error;
		}
	}

	private async resolveFromContent(content: IFileStreamContent, dirty: boolean): Promise<void> {
		this.trace('resolveFromContent() - enter');

		if (this.isDisposed()) {
			this.trace('resolveFromContent() - exit - because working copy is disposed');

			return;
		}

		this.updateLastResolvedFileStat({
			resource: this.resource,
			name: content.name,
			mtime: content.mtime,
			ctime: content.ctime,
			size: content.size,
			etag: content.etag,
			readonly: content.readonly,
			locked: content.locked,
			executable: false,
			isFile: true,
			isDirectory: false,
			isSymbolicLink: false,
			children: undefined
		});

		if (this.isResolved()) {
			await this.doUpdateModel(content.value);
		}

		else {
			await this.doCreateModel(content.value);
		}

		this.setDirty(!!dirty);

		this._onDidResolve.fire();
	}

	private async doCreateModel(contents: VSBufferReadableStream): Promise<void> {
		this.trace('doCreateModel()');

		this._model = this._register(await this.modelFactory.createModel(this.resource, contents, CancellationToken.None));

		this.installModelListeners(this._model);
	}

	private ignoreDirtyOnModelContentChange = false;

	private async doUpdateModel(contents: VSBufferReadableStream): Promise<void> {
		this.trace('doUpdateModel()');

		this.ignoreDirtyOnModelContentChange = true;
		try {
			await this.model?.update(contents, CancellationToken.None);
		} finally {
			this.ignoreDirtyOnModelContentChange = false;
		}
	}

	private installModelListeners(model: M): void {


		this._register(model.onDidChangeContent(e => this.onModelContentChanged(model, e.isUndoing || e.isRedoing)));

		this._register(model.onWillDispose(() => this.dispose()));
	}

	private onModelContentChanged(model: M, isUndoingOrRedoing: boolean): void {
		this.trace(`onModelContentChanged() - enter`);

		this.versionId++;
		this.trace(`onModelContentChanged() - new versionId ${this.versionId}`);

		if (isUndoingOrRedoing) {
			this.lastContentChangeFromUndoRedo = Date.now();
		}

		if (!this.ignoreDirtyOnModelContentChange && !this.isReadonly()) {

			if (model.versionId === this.savedVersionId) {
				this.trace('onModelContentChanged() - model content changed back to last saved version');

				const wasDirty = this.dirty;
				this.setDirty(false);

				if (wasDirty) {
					this._onDidRevert.fire();
				}
			}

			else {
				this.trace('onModelContentChanged() - model content changed and marked as dirty');

				this.setDirty(true);
			}
		}

		this._onDidChangeContent.fire();
	}

	private async forceResolveFromFile(): Promise<void> {
		if (this.isDisposed()) {
			return;
		}


		await this.externalResolver({
			forceReadFromFile: true
		});
	}



	get backupDelay(): number | undefined {
		return this.model?.configuration?.backupDelay;
	}

	async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {

		let meta: IStoredFileWorkingCopyBackupMetaData | undefined = undefined;
		if (this.lastResolvedFileStat) {
			meta = {
				mtime: this.lastResolvedFileStat.mtime,
				ctime: this.lastResolvedFileStat.ctime,
				size: this.lastResolvedFileStat.size,
				etag: this.lastResolvedFileStat.etag,
				orphaned: this.isOrphaned()
			};
		}

		let content: VSBufferReadableStream | undefined = undefined;
		if (this.isResolved()) {
			content = await raceCancellation(this.model.snapshot(SnapshotContext.Backup, token), token);
		}

		return { meta, content };
	}



	private versionId = 0;

	private static readonly UNDO_REDO_SAVE_PARTICIPANTS_AUTO_SAVE_THROTTLE_THRESHOLD = 500;
	private lastContentChangeFromUndoRedo: number | undefined = undefined;

	private readonly saveSequentializer = new TaskSequentializer();

	private ignoreSaveFromSaveParticipants = false;

	async save(options: IStoredFileWorkingCopySaveAsOptions = Object.create(null)): Promise<boolean> {
		if (!this.isResolved()) {
			return false;
		}

		if (this.isReadonly()) {
			this.trace('save() - ignoring request for readonly resource');

			return false;
		}

		if (
			(this.hasState(StoredFileWorkingCopyState.CONFLICT) || this.hasState(StoredFileWorkingCopyState.ERROR)) &&
			(options.reason === SaveReason.AUTO || options.reason === SaveReason.FOCUS_CHANGE || options.reason === SaveReason.WINDOW_CHANGE)
		) {
			this.trace('save() - ignoring auto save request for file working copy that is in conflict or error');

			return false;
		}

		this.trace('save() - enter');
		await this.doSave(options);
		this.trace('save() - exit');

		return this.hasState(StoredFileWorkingCopyState.SAVED);
	}

	private async doSave(options: IStoredFileWorkingCopySaveAsOptions): Promise<void> {
		if (typeof options.reason !== 'number') {
			options.reason = SaveReason.EXPLICIT;
		}

		const versionId = this.versionId;
		this.trace(`doSave(${versionId}) - enter with versionId ${versionId}`);

		if (this.ignoreSaveFromSaveParticipants) {
			this.trace(`doSave(${versionId}) - exit - refusing to save() recursively from save participant`);

			return;
		}

		if (this.saveSequentializer.isRunning(versionId)) {
			this.trace(`doSave(${versionId}) - exit - found a running save for versionId ${versionId}`);

			return this.saveSequentializer.running;
		}

		if (!options.force && !this.dirty) {
			this.trace(`doSave(${versionId}) - exit - because not dirty and/or versionId is different (this.isDirty: ${this.dirty}, this.versionId: ${this.versionId})`);

			return;
		}

		if (this.saveSequentializer.isRunning()) {
			this.trace(`doSave(${versionId}) - exit - because busy saving`);

			this.saveSequentializer.cancelRunning();

			return this.saveSequentializer.queue(() => this.doSave(options));
		}

		if (this.isResolved()) {
			this.model.pushStackElement();
		}

		const saveCancellation = new CancellationTokenSource();

		return this.progressService.withProgress({
			title: localize('saveParticipants', "Saving '{0}'", this.name),
			location: ProgressLocation.Window,
			cancellable: true,
			delay: this.isDirty() ? 3000 : 5000
		}, progress => {
			return this.doSaveSequential(versionId, options, progress, saveCancellation);
		}, () => {
			saveCancellation.cancel();
		}).finally(() => {
			saveCancellation.dispose();
		});
	}

	private doSaveSequential(versionId: number, options: IStoredFileWorkingCopySaveAsOptions, progress: IProgress<IProgressStep>, saveCancellation: CancellationTokenSource): Promise<void> {
		return this.saveSequentializer.run(versionId, (async () => {

			if (this.isResolved() && !options.skipSaveParticipants && this.workingCopyFileService.hasSaveParticipants) {
				try {

					if (options.reason === SaveReason.AUTO && typeof this.lastContentChangeFromUndoRedo === 'number') {
						const timeFromUndoRedoToSave = Date.now() - this.lastContentChangeFromUndoRedo;
						if (timeFromUndoRedoToSave < StoredFileWorkingCopy.UNDO_REDO_SAVE_PARTICIPANTS_AUTO_SAVE_THROTTLE_THRESHOLD) {
							await timeout(StoredFileWorkingCopy.UNDO_REDO_SAVE_PARTICIPANTS_AUTO_SAVE_THROTTLE_THRESHOLD - timeFromUndoRedoToSave);
						}
					}

					if (!saveCancellation.token.isCancellationRequested) {
						this.ignoreSaveFromSaveParticipants = true;
						try {
							await this.workingCopyFileService.runSaveParticipants(this, { reason: options.reason ?? SaveReason.EXPLICIT, savedFrom: options.from }, progress, saveCancellation.token);
						} catch (err) {
							if (isCancellationError(err) && !saveCancellation.token.isCancellationRequested) {
								saveCancellation.cancel();
							}
						} finally {
							this.ignoreSaveFromSaveParticipants = false;
						}
					}
				} catch (error) {
					this.logService.error(`[stored file working copy] runSaveParticipants(${versionId}) - resulted in an error: ${error.toString()}`, this.resource.toString(), this.typeId);
				}
			}

			if (saveCancellation.token.isCancellationRequested) {
				return;
			}

			if (this.isDisposed()) {
				return;
			}

			if (!this.isResolved()) {
				return;
			}

			versionId = this.versionId;

			this.inErrorMode = false;

			progress.report({ message: localize('saveTextFile', "Writing into file...") });
			this.trace(`doSave(${versionId}) - before write()`);
			const lastResolvedFileStat = assertReturnsDefined(this.lastResolvedFileStat);
			const resolvedFileWorkingCopy = this;
			return this.saveSequentializer.run(versionId, (async () => {
				try {
					const writeFileOptions: IWriteFileOptions = {
						mtime: lastResolvedFileStat.mtime,
						etag: (options.ignoreModifiedSince || !this.filesConfigurationService.preventSaveConflicts(lastResolvedFileStat.resource)) ? ETAG_DISABLED : lastResolvedFileStat.etag,
						unlock: options.writeUnlock
					};

					let stat: IFileStatWithMetadata;

					if (typeof resolvedFileWorkingCopy.model.save === 'function') {
						try {
							stat = await resolvedFileWorkingCopy.model.save(writeFileOptions, saveCancellation.token);
						} catch (error) {
							if (saveCancellation.token.isCancellationRequested) {
								return undefined;
							}

							throw error;
						}
					}

					else {

						const snapshot = await raceCancellation(resolvedFileWorkingCopy.model.snapshot(SnapshotContext.Save, saveCancellation.token), saveCancellation.token);

						if (saveCancellation.token.isCancellationRequested) {
							return;
						} else {
							saveCancellation.dispose();
						}

						if (options?.writeElevated && this.elevatedFileService.isSupported(lastResolvedFileStat.resource)) {
							stat = await this.elevatedFileService.writeFileElevated(lastResolvedFileStat.resource, assertReturnsDefined(snapshot), writeFileOptions);
						} else {
							stat = await this.fileService.writeFile(lastResolvedFileStat.resource, assertReturnsDefined(snapshot), writeFileOptions);
						}
					}

					this.handleSaveSuccess(stat, versionId, options);
				} catch (error) {
					this.handleSaveError(error, versionId, options);
				}
			})(), () => saveCancellation.cancel());
		})(), () => saveCancellation.cancel());
	}

	private handleSaveSuccess(stat: IFileStatWithMetadata, versionId: number, options: IStoredFileWorkingCopySaveAsOptions): void {

		this.updateLastResolvedFileStat(stat);

		if (versionId === this.versionId) {
			this.trace(`handleSaveSuccess(${versionId}) - setting dirty to false because versionId did not change`);
			this.setDirty(false);
		} else {
			this.trace(`handleSaveSuccess(${versionId}) - not setting dirty to false because versionId did change meanwhile`);
		}

		this.setOrphaned(false);

		this._onDidSave.fire({ reason: options.reason, stat, source: options.source });
	}

	private handleSaveError(error: Error, versionId: number, options: IStoredFileWorkingCopySaveAsOptions): void {
		(options.ignoreErrorHandler ? this.logService.trace : this.logService.error).apply(this.logService, [`[stored file working copy] handleSaveError(${versionId}) - exit - resulted in a save error: ${error.toString()}`, this.resource.toString(), this.typeId]);

		if (options.ignoreErrorHandler) {
			throw error;
		}

		this.setDirty(true);

		this.inErrorMode = true;

		if ((error as FileOperationError).fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
			this.inConflictMode = true;
		}

		this.doHandleSaveError(error, options);

		this._onDidSaveError.fire();
	}

	private doHandleSaveError(error: Error, options: IStoredFileWorkingCopySaveAsOptions): void {
		const fileOperationError = error as FileOperationError;
		const primaryActions: IAction[] = [];

		let message: string;

		if (fileOperationError.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
			message = localize('staleSaveError', "Failed to save '{0}': The content of the file is newer. Do you want to overwrite the file with your changes?", this.name);

			primaryActions.push(toAction({ id: 'fileWorkingCopy.overwrite', label: localize('overwrite', "Overwrite"), run: () => this.save({ ...options, ignoreModifiedSince: true, reason: SaveReason.EXPLICIT }) }));
			primaryActions.push(toAction({ id: 'fileWorkingCopy.revert', label: localize('revert', "Revert"), run: () => this.revert() }));
		}

		else {
			const isWriteLocked = fileOperationError.fileOperationResult === FileOperationResult.FILE_WRITE_LOCKED;
			const triedToUnlock = isWriteLocked && (fileOperationError.options as IWriteFileOptions | undefined)?.unlock;
			const isPermissionDenied = fileOperationError.fileOperationResult === FileOperationResult.FILE_PERMISSION_DENIED;
			const canSaveElevated = this.elevatedFileService.isSupported(this.resource);

			if (isErrorWithActions(error)) {
				primaryActions.push(...error.actions);
			}

			if (canSaveElevated && (isPermissionDenied || triedToUnlock)) {
				primaryActions.push(toAction({
					id: 'fileWorkingCopy.saveElevated',
					label: triedToUnlock ?
						isWindows ? localize('overwriteElevated', "Overwrite as Admin...") : localize('overwriteElevatedSudo', "Overwrite as Sudo...") :
						isWindows ? localize('saveElevated', "Retry as Admin...") : localize('saveElevatedSudo', "Retry as Sudo..."),
					run: () => {
						this.save({ ...options, writeElevated: true, writeUnlock: triedToUnlock, reason: SaveReason.EXPLICIT });
					}
				}));
			}

			else if (isWriteLocked) {
				primaryActions.push(toAction({ id: 'fileWorkingCopy.unlock', label: localize('overwrite', "Overwrite"), run: () => this.save({ ...options, writeUnlock: true, reason: SaveReason.EXPLICIT }) }));
			}

			else {
				primaryActions.push(toAction({ id: 'fileWorkingCopy.retry', label: localize('retry', "Retry"), run: () => this.save({ ...options, reason: SaveReason.EXPLICIT }) }));
			}

			primaryActions.push(toAction({
				id: 'fileWorkingCopy.saveAs',
				label: localize('saveAs', "Save As..."),
				run: async () => {
					const editor = this.workingCopyEditorService.findEditor(this);
					if (editor) {
						const result = await this.editorService.save(editor, { saveAs: true, reason: SaveReason.EXPLICIT });
						if (!result.success) {
							this.doHandleSaveError(error, options);
						}
					}
				}
			}));

			primaryActions.push(toAction({ id: 'fileWorkingCopy.revert', label: localize('revert', "Revert"), run: () => this.revert() }));

			if (isWriteLocked) {
				if (triedToUnlock && canSaveElevated) {
					message = isWindows ?
						localize('readonlySaveErrorAdmin', "Failed to save '{0}': File is read-only. Select 'Overwrite as Admin' to retry as administrator.", this.name) :
						localize('readonlySaveErrorSudo', "Failed to save '{0}': File is read-only. Select 'Overwrite as Sudo' to retry as superuser.", this.name);
				} else {
					message = localize('readonlySaveError', "Failed to save '{0}': File is read-only. Select 'Overwrite' to attempt to make it writeable.", this.name);
				}
			} else if (canSaveElevated && isPermissionDenied) {
				message = isWindows ?
					localize('permissionDeniedSaveError', "Failed to save '{0}': Insufficient permissions. Select 'Retry as Admin' to retry as administrator.", this.name) :
					localize('permissionDeniedSaveErrorSudo', "Failed to save '{0}': Insufficient permissions. Select 'Retry as Sudo' to retry as superuser.", this.name);
			} else {
				message = localize({ key: 'genericSaveError', comment: ['{0} is the resource that failed to save and {1} the error message'] }, "Failed to save '{0}': {1}", this.name, toErrorMessage(error, false));
			}
		}

		const handle = this.notificationService.notify({ id: `${hash(this.resource.toString())}`, severity: Severity.Error, message, actions: { primary: primaryActions } });

		const listener = this._register(Event.once(Event.any(this.onDidSave, this.onDidRevert))(() => handle.close()));
		this._register(Event.once(handle.onDidClose)(() => listener.dispose()));
	}

	private updateLastResolvedFileStat(newFileStat: IFileStatWithMetadata): void {
		const oldReadonly = this.isReadonly();

		if (!this.lastResolvedFileStat) {
			this.lastResolvedFileStat = newFileStat;
		}

		else if (this.lastResolvedFileStat.mtime <= newFileStat.mtime) {
			this.lastResolvedFileStat = newFileStat;
		}

		else {
			this.lastResolvedFileStat = { ...this.lastResolvedFileStat, readonly: newFileStat.readonly, locked: newFileStat.locked };
		}

		if (this.isReadonly() !== oldReadonly) {
			this._onDidChangeReadonly.fire();
		}
	}



	async revert(options?: IRevertOptions): Promise<void> {
		if (!this.isResolved() || (!this.dirty && !options?.force)) {
			return;
		}

		this.trace('revert()');

		const wasDirty = this.dirty;
		const undoSetDirty = this.doSetDirty(false);

		const softUndo = options?.soft;
		if (!softUndo) {
			try {
				await this.forceResolveFromFile();
			} catch (error) {

				if ((error as FileOperationError).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {

					undoSetDirty();

					throw error;
				}
			}
		}

		this._onDidRevert.fire();

		if (wasDirty) {
			this._onDidChangeDirty.fire();
		}
	}



	private inConflictMode = false;
	private inErrorMode = false;

	hasState(state: StoredFileWorkingCopyState): boolean {
		switch (state) {
			case StoredFileWorkingCopyState.CONFLICT:
				return this.inConflictMode;
			case StoredFileWorkingCopyState.DIRTY:
				return this.dirty;
			case StoredFileWorkingCopyState.ERROR:
				return this.inErrorMode;
			case StoredFileWorkingCopyState.ORPHAN:
				return this.isOrphaned();
			case StoredFileWorkingCopyState.PENDING_SAVE:
				return this.saveSequentializer.isRunning();
			case StoredFileWorkingCopyState.SAVED:
				return !this.dirty;
		}
	}

	async joinState(state: StoredFileWorkingCopyState.PENDING_SAVE): Promise<void> {
		return this.saveSequentializer.running;
	}



	isReadonly(): boolean | IMarkdownString {
		return this.filesConfigurationService.isReadonly(this.resource, this.lastResolvedFileStat);
	}

	private trace(msg: string): void {
		this.logService.trace(`[stored file working copy] ${msg}`, this.resource.toString(), this.typeId);
	}



	override dispose(): void {
		this.trace('dispose()');

		this.inConflictMode = false;
		this.inErrorMode = false;

		this._model = undefined;

		super.dispose();
	}

}
