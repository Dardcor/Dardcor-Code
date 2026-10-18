/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { mark } from '../../../../base/common/performance.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { EncodingMode, ITextFileService, TextFileEditorModelState, ITextFileEditorModel, ITextFileStreamContent, ITextFileResolveOptions, IResolvedTextFileEditorModel, TextFileResolveReason, ITextFileEditorModelSaveEvent, ITextFileSaveAsOptions } from './textfiles.js';
import { IRevertOptions, SaveReason, SaveSourceRegistry } from '../../../common/editor.js';
import { BaseTextEditorModel } from '../../../common/editor/textEditorModel.js';
import { IWorkingCopyBackupService, IResolvedWorkingCopyBackup } from '../../workingCopy/common/workingCopyBackup.js';
import { IFileService, FileOperationError, FileOperationResult, FileChangesEvent, FileChangeType, IFileStatWithMetadata, ETAG_DISABLED, NotModifiedSinceFileOperationError } from '../../../../platform/files/common/files.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { timeout, TaskSequentializer } from '../../../../base/common/async.js';
import { ITextBufferFactory, ITextModel } from '../../../../editor/common/model.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { basename } from '../../../../base/common/path.js';
import { IWorkingCopyService } from '../../workingCopy/common/workingCopyService.js';
import { IWorkingCopyBackup, WorkingCopyCapabilities, NO_TYPE_ID, IWorkingCopyBackupMeta } from '../../workingCopy/common/workingCopy.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { UTF16be, UTF16le, UTF8, UTF8_with_bom } from './encoding.js';
import { createTextBufferFactoryFromStream } from '../../../../editor/common/model/textModel.js';
import { ILanguageDetectionService } from '../../languageDetection/common/languageDetectionWorkerService.js';
import { IPathService } from '../../path/common/pathService.js';
import { extUri } from '../../../../base/common/resources.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../editor/common/languages/modesRegistry.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { IProgress, IProgressService, IProgressStep, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { TextModelEditSource, EditSources } from '../../../../editor/common/textModelEditSource.js';

interface IBackupMetaData extends IWorkingCopyBackupMeta {
	mtime: number;
	ctime: number;
	size: number;
	etag: string;
	orphaned: boolean;
}

export class TextFileEditorModel extends BaseTextEditorModel implements ITextFileEditorModel {

	private static readonly TEXTFILE_SAVE_ENCODING_SOURCE = SaveSourceRegistry.registerSource('textFileEncoding.source', localize('textFileCreate.source', "File Encoding Changed"));


	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidResolve = this._register(new Emitter<TextFileResolveReason>());
	readonly onDidResolve = this._onDidResolve.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidSaveError = this._register(new Emitter<void>());
	readonly onDidSaveError = this._onDidSaveError.event;

	private readonly _onDidSave = this._register(new Emitter<ITextFileEditorModelSaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<void>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<void>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidChangeOrphaned = this._register(new Emitter<void>());
	readonly onDidChangeOrphaned = this._onDidChangeOrphaned.event;

	private readonly _onDidChangeReadonly = this._register(new Emitter<void>());
	readonly onDidChangeReadonly = this._onDidChangeReadonly.event;


	readonly typeId = NO_TYPE_ID;

	readonly capabilities = WorkingCopyCapabilities.None;

	readonly name: string;
	private resourceHasExtension: boolean;

	private contentEncoding: string | undefined;

	private versionId = 0;
	private bufferSavedVersionId: number | undefined;

	private ignoreDirtyOnModelContentChange = false;
	private ignoreSaveFromSaveParticipants = false;

	private static readonly UNDO_REDO_SAVE_PARTICIPANTS_AUTO_SAVE_THROTTLE_THRESHOLD = 500;
	private lastModelContentChangeFromUndoRedo: number | undefined = undefined;

	lastResolvedFileStat: IFileStatWithMetadata | undefined;

	private readonly saveSequentializer = new TaskSequentializer();

	private dirty = false;
	private inConflictMode = false;
	private inOrphanMode = false;
	private inErrorMode = false;

	constructor(
		readonly resource: URI,
		private preferredEncoding: string | undefined,
		private preferredLanguageId: string | undefined,
		@ILanguageService languageService: ILanguageService,
		@IModelService modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@ILogService private readonly logService: ILogService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@ILabelService private readonly labelService: ILabelService,
		@ILanguageDetectionService languageDetectionService: ILanguageDetectionService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IPathService private readonly pathService: IPathService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super(modelService, languageService, languageDetectionService, accessibilityService);

		this.name = basename(this.labelService.getUriLabel(this.resource));
		this.resourceHasExtension = !!extUri.extname(this.resource);

		this._register(this.workingCopyService.registerWorkingCopy(this));

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));
		this._register(this.filesConfigurationService.onDidChangeFilesAssociation(() => this.onDidChangeFilesAssociation()));
		this._register(this.filesConfigurationService.onDidChangeReadonly(() => this._onDidChangeReadonly.fire()));
	}

	private async onDidFilesChange(e: FileChangesEvent): Promise<void> {
		let fileEventImpactsModel = false;
		let newInOrphanModeGuess: boolean | undefined;

		if (this.inOrphanMode) {
			const modelFileAdded = e.contains(this.resource, FileChangeType.ADDED);
			if (modelFileAdded) {
				newInOrphanModeGuess = false;
				fileEventImpactsModel = true;
			}
		}

		else {
			const modelFileDeleted = e.contains(this.resource, FileChangeType.DELETED);
			if (modelFileDeleted) {
				newInOrphanModeGuess = true;
				fileEventImpactsModel = true;
			}
		}

		if (fileEventImpactsModel && this.inOrphanMode !== newInOrphanModeGuess) {
			let newInOrphanModeValidated = false;
			if (newInOrphanModeGuess) {
				await timeout(100, CancellationToken.None);

				if (this.isDisposed()) {
					newInOrphanModeValidated = true;
				} else {
					const exists = await this.fileService.exists(this.resource);
					newInOrphanModeValidated = !exists;
				}
			}

			if (this.inOrphanMode !== newInOrphanModeValidated && !this.isDisposed()) {
				this.setOrphaned(newInOrphanModeValidated);
			}
		}
	}

	private setOrphaned(orphaned: boolean): void {
		if (this.inOrphanMode !== orphaned) {
			this.inOrphanMode = orphaned;
			this._onDidChangeOrphaned.fire();
		}
	}

	private onDidChangeFilesAssociation(): void {
		if (!this.isResolved()) {
			return;
		}

		const firstLineText = this.getFirstLineText(this.textEditorModel);
		const languageSelection = this.getOrCreateLanguage(this.resource, this.languageService, this.preferredLanguageId, firstLineText);

		this.textEditorModel.setLanguage(languageSelection);
	}

	override setLanguageId(languageId: string, source?: string): void {
		super.setLanguageId(languageId, source);

		this.preferredLanguageId = languageId;
	}


	async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {

		let meta: IBackupMetaData | undefined = undefined;
		if (this.lastResolvedFileStat) {
			meta = {
				mtime: this.lastResolvedFileStat.mtime,
				ctime: this.lastResolvedFileStat.ctime,
				size: this.lastResolvedFileStat.size,
				etag: this.lastResolvedFileStat.etag,
				orphaned: this.inOrphanMode
			};
		}

		const content = await this.textFileService.getEncodedReadable(this.resource, this.createSnapshot() ?? undefined, { encoding: UTF8 });

		return { meta, content };
	}



	async revert(options?: IRevertOptions): Promise<void> {
		if (!this.isResolved()) {
			return;
		}

		const wasDirty = this.dirty;
		const undo = this.doSetDirty(false);

		const softUndo = options?.soft;
		if (!softUndo) {
			try {
				await this.forceResolveFromFile();
			} catch (error) {

				if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {

					undo();

					throw error;
				}
			}
		}

		this._onDidRevert.fire();

		if (wasDirty) {
			this._onDidChangeDirty.fire();
		}
	}



	override async resolve(options?: ITextFileResolveOptions): Promise<void> {
		this.trace('resolve() - enter');
		mark('code/willResolveTextFileEditorModel');

		if (this.isDisposed()) {
			this.trace('resolve() - exit - without resolving because model is disposed');

			return;
		}

		if (!options?.contents && (this.dirty || this.saveSequentializer.isRunning())) {
			this.trace('resolve() - exit - without resolving because model is dirty or being saved');

			return;
		}

		await this.doResolve(options);

		mark('code/didResolveTextFileEditorModel');
	}

	private async doResolve(options?: ITextFileResolveOptions): Promise<void> {

		if (options?.contents) {
			return this.resolveFromBuffer(options.contents, options);
		}

		const isNewModel = !this.isResolved();
		if (isNewModel) {
			const resolvedFromBackup = await this.resolveFromBackup(options);
			if (resolvedFromBackup) {
				return;
			}
		}

		return this.resolveFromFile(options);
	}

	private async resolveFromBuffer(buffer: ITextBufferFactory, options?: ITextFileResolveOptions): Promise<void> {
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

		const preferredEncoding = await this.textFileService.encoding.getPreferredWriteEncoding(this.resource, this.preferredEncoding);

		this.resolveFromContent({
			resource: this.resource,
			name: this.name,
			mtime,
			ctime,
			size,
			etag,
			value: buffer,
			encoding: preferredEncoding.encoding,
			readonly: false,
			locked: false,
			executable: false
		}, true , options);
	}

	private async resolveFromBackup(options?: ITextFileResolveOptions): Promise<boolean> {

		const backup = await this.workingCopyBackupService.resolve<IBackupMetaData>(this);

		let encoding = UTF8;
		if (backup) {
			encoding = (await this.textFileService.encoding.getPreferredWriteEncoding(this.resource, this.preferredEncoding)).encoding;
		}

		const isNewModel = !this.isResolved();
		if (!isNewModel) {
			this.trace('resolveFromBackup() - exit - without resolving because previously new model got created meanwhile');

			return true;
		}

		if (backup) {
			await this.doResolveFromBackup(backup, encoding, options);

			return true;
		}

		return false;
	}

	private async doResolveFromBackup(backup: IResolvedWorkingCopyBackup<IBackupMetaData>, encoding: string, options?: ITextFileResolveOptions): Promise<void> {
		this.trace('doResolveFromBackup()');

		this.resolveFromContent({
			resource: this.resource,
			name: this.name,
			mtime: backup.meta ? backup.meta.mtime : Date.now(),
			ctime: backup.meta ? backup.meta.ctime : Date.now(),
			size: backup.meta ? backup.meta.size : 0,
			etag: backup.meta ? backup.meta.etag : ETAG_DISABLED,
			value: await createTextBufferFactoryFromStream(await this.textFileService.getDecodedStream(this.resource, backup.value, { encoding: UTF8 })),
			encoding,
			readonly: false,
			locked: false,
			executable: false
		}, true , options);

		if (backup.meta?.orphaned) {
			this.setOrphaned(true);
		}
	}

	private async resolveFromFile(options?: ITextFileResolveOptions): Promise<void> {
		this.trace('resolveFromFile()');

		const forceReadFromFile = options?.forceReadFromFile;
		const allowBinary = this.isResolved() || options?.allowBinary;

		let etag: string | undefined;
		if (forceReadFromFile) {
			etag = ETAG_DISABLED;
		} else if (this.lastResolvedFileStat) {
			etag = this.lastResolvedFileStat.etag;
		}

		const currentVersionId = this.versionId;

		try {
			const content = await this.textFileService.readStream(this.resource, {
				acceptTextOnly: !allowBinary,
				etag,
				encoding: this.preferredEncoding,
				limits: options?.limits
			});

			this.setOrphaned(false);

			if (currentVersionId !== this.versionId) {
				this.trace('resolveFromFile() - exit - without resolving because model content changed');

				return;
			}

			return this.resolveFromContent(content, false , options);
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

	private resolveFromContent(content: ITextFileStreamContent, dirty: boolean, options?: ITextFileResolveOptions): void {
		this.trace('resolveFromContent() - enter');

		if (this.isDisposed()) {
			this.trace('resolveFromContent() - exit - because model is disposed');

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

		const oldEncoding = this.contentEncoding;
		this.contentEncoding = content.encoding;

		if (this.preferredEncoding) {
			this.updatePreferredEncoding(this.contentEncoding);
		} else if (oldEncoding !== this.contentEncoding) {
			this._onDidChangeEncoding.fire();
		}

		if (this.textEditorModel) {
			this.doUpdateTextModel(content.value, EditSources.reloadFromDisk());
		}

		else {
			this.doCreateTextModel(content.resource, content.value);
		}

		this.setDirty(!!dirty);

		this._onDidResolve.fire(options?.reason ?? TextFileResolveReason.OTHER);
	}

	private doCreateTextModel(resource: URI, value: ITextBufferFactory): void {
		this.trace('doCreateTextModel()');

		const textModel = this.createTextEditorModel(value, resource, this.preferredLanguageId);

		this.installModelListeners(textModel);

		this.autoDetectLanguage();
	}

	private doUpdateTextModel(value: ITextBufferFactory, reason: TextModelEditSource): void {
		this.trace('doUpdateTextModel()');

		this.ignoreDirtyOnModelContentChange = true;
		try {
			this.updateTextEditorModel(value, this.preferredLanguageId, reason);
		} finally {
			this.ignoreDirtyOnModelContentChange = false;
		}
	}

	protected override installModelListeners(model: ITextModel): void {


		this._register(model.onDidChangeContent(e => this.onModelContentChanged(model, e.isUndoing || e.isRedoing)));
		this._register(model.onDidChangeLanguage(() => this.onMaybeShouldChangeEncoding()));

		super.installModelListeners(model);
	}

	private onModelContentChanged(model: ITextModel, isUndoingOrRedoing: boolean): void {
		this.trace(`onModelContentChanged() - enter`);

		this.versionId++;
		this.trace(`onModelContentChanged() - new versionId ${this.versionId}`);

		if (isUndoingOrRedoing) {
			this.lastModelContentChangeFromUndoRedo = Date.now();
		}

		if (!this.ignoreDirtyOnModelContentChange && !this.isReadonly()) {

			if (model.getAlternativeVersionId() === this.bufferSavedVersionId) {
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

		this.autoDetectLanguage();
	}

	protected override async autoDetectLanguage(): Promise<void> {

		await this.extensionService?.whenInstalledExtensionsRegistered();

		const languageId = this.getLanguageId();
		if (
			this.resource.scheme === this.pathService.defaultUriScheme &&
			(!languageId || languageId === PLAINTEXT_LANGUAGE_ID) &&
			!this.resourceHasExtension
		) {
			return super.autoDetectLanguage();
		}
	}

	private async forceResolveFromFile(): Promise<void> {
		if (this.isDisposed()) {
			return;
		}


		await this.textFileService.files.resolve(this.resource, {
			reload: { async: false },
			forceReadFromFile: true
		});
	}



	isDirty(): this is IResolvedTextFileEditorModel {
		return this.dirty;
	}

	isModified(): boolean {
		return this.isDirty();
	}

	setDirty(dirty: boolean): void {
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
		const oldBufferSavedVersionId = this.bufferSavedVersionId;

		if (!dirty) {
			this.dirty = false;
			this.inConflictMode = false;
			this.inErrorMode = false;
			this.updateSavedVersionId();
		} else {
			this.dirty = true;
		}

		return () => {
			this.dirty = wasDirty;
			this.inConflictMode = wasInConflictMode;
			this.inErrorMode = wasInErrorMode;
			this.bufferSavedVersionId = oldBufferSavedVersionId;
		};
	}



	async save(options: ITextFileSaveAsOptions = Object.create(null)): Promise<boolean> {
		if (!this.isResolved()) {
			return false;
		}

		if (this.isReadonly()) {
			this.trace('save() - ignoring request for readonly resource');

			return false;
		}

		if (
			(this.hasState(TextFileEditorModelState.CONFLICT) || this.hasState(TextFileEditorModelState.ERROR)) &&
			(options.reason === SaveReason.AUTO || options.reason === SaveReason.FOCUS_CHANGE || options.reason === SaveReason.WINDOW_CHANGE)
		) {
			this.trace('save() - ignoring auto save request for model that is in conflict or error');

			return false;
		}

		this.trace('save() - enter');
		await this.doSave(options);
		this.trace('save() - exit');

		return this.hasState(TextFileEditorModelState.SAVED);
	}

	private async doSave(options: ITextFileSaveAsOptions): Promise<void> {
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
			this.textEditorModel.pushStackElement();
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

	private doSaveSequential(versionId: number, options: ITextFileSaveAsOptions, progress: IProgress<IProgressStep>, saveCancellation: CancellationTokenSource): Promise<void> {
		return this.saveSequentializer.run(versionId, (async () => {

			if (this.isResolved() && !options.skipSaveParticipants) {
				try {

					if (options.reason === SaveReason.AUTO && typeof this.lastModelContentChangeFromUndoRedo === 'number') {
						const timeFromUndoRedoToSave = Date.now() - this.lastModelContentChangeFromUndoRedo;
						if (timeFromUndoRedoToSave < TextFileEditorModel.UNDO_REDO_SAVE_PARTICIPANTS_AUTO_SAVE_THROTTLE_THRESHOLD) {
							await timeout(TextFileEditorModel.UNDO_REDO_SAVE_PARTICIPANTS_AUTO_SAVE_THROTTLE_THRESHOLD - timeFromUndoRedoToSave);
						}
					}

					if (!saveCancellation.token.isCancellationRequested) {
						this.ignoreSaveFromSaveParticipants = true;
						try {
							await this.textFileService.files.runSaveParticipants(this, { reason: options.reason ?? SaveReason.EXPLICIT, savedFrom: options.from }, progress, saveCancellation.token);
						} catch (err) {
							if (isCancellationError(err) && !saveCancellation.token.isCancellationRequested) {
								saveCancellation.cancel();
							}
						} finally {
							this.ignoreSaveFromSaveParticipants = false;
						}
					}
				} catch (error) {
					this.logService.error(`[text file model] runSaveParticipants(${versionId}) - resulted in an error: ${error.toString()}`, this.resource.toString());
				}
			}

			if (saveCancellation.token.isCancellationRequested) {
				return;
			} else {
				saveCancellation.dispose();
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
			const resolvedTextFileEditorModel = this;
			return this.saveSequentializer.run(versionId, (async () => {
				try {
					const stat = await this.textFileService.write(lastResolvedFileStat.resource, resolvedTextFileEditorModel.createSnapshot(), {
						mtime: lastResolvedFileStat.mtime,
						encoding: this.getEncoding(),
						etag: (options.ignoreModifiedSince || !this.filesConfigurationService.preventSaveConflicts(lastResolvedFileStat.resource, resolvedTextFileEditorModel.getLanguageId())) ? ETAG_DISABLED : lastResolvedFileStat.etag,
						unlock: options.writeUnlock,
						writeElevated: options.writeElevated
					});

					this.handleSaveSuccess(stat, versionId, options);
				} catch (error) {
					this.handleSaveError(error, versionId, options);
				}
			})());
		})(), () => saveCancellation.cancel());
	}

	private handleSaveSuccess(stat: IFileStatWithMetadata, versionId: number, options: ITextFileSaveAsOptions): void {

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

	private handleSaveError(error: Error, versionId: number, options: ITextFileSaveAsOptions): void {
		(options.ignoreErrorHandler ? this.logService.trace : this.logService.error).apply(this.logService, [`[text file model] handleSaveError(${versionId}) - exit - resulted in a save error: ${error.toString()}`, this.resource.toString()]);

		if (options.ignoreErrorHandler) {
			throw error;
		}

		this.setDirty(true);

		this.inErrorMode = true;

		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
			this.inConflictMode = true;
		}

		this.textFileService.files.saveErrorHandler.onSaveError(error, this, options);

		this._onDidSaveError.fire();
	}

	private updateSavedVersionId(): void {
		if (this.isResolved()) {
			this.bufferSavedVersionId = this.textEditorModel.getAlternativeVersionId();
		}
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


	hasState(state: TextFileEditorModelState): boolean {
		switch (state) {
			case TextFileEditorModelState.CONFLICT:
				return this.inConflictMode;
			case TextFileEditorModelState.DIRTY:
				return this.dirty;
			case TextFileEditorModelState.ERROR:
				return this.inErrorMode;
			case TextFileEditorModelState.ORPHAN:
				return this.inOrphanMode;
			case TextFileEditorModelState.PENDING_SAVE:
				return this.saveSequentializer.isRunning();
			case TextFileEditorModelState.SAVED:
				return !this.dirty;
		}
	}

	async joinState(state: TextFileEditorModelState.PENDING_SAVE): Promise<void> {
		return this.saveSequentializer.running;
	}

	override getLanguageId(this: IResolvedTextFileEditorModel): string;
	override getLanguageId(): string | undefined;
	override getLanguageId(): string | undefined {
		if (this.textEditorModel) {
			return this.textEditorModel.getLanguageId();
		}

		return this.preferredLanguageId;
	}


	private async onMaybeShouldChangeEncoding(): Promise<void> {


		if (this.hasEncodingSetExplicitly) {
			this.trace('onMaybeShouldChangeEncoding() - ignoring because encoding was set explicitly');

			return;
		}

		if (this.contentEncoding === UTF8_with_bom || this.contentEncoding === UTF16be || this.contentEncoding === UTF16le) {
			this.trace('onMaybeShouldChangeEncoding() - ignoring because content encoding has a BOM');

			return;
		}

		const { encoding } = await this.textFileService.encoding.getPreferredReadEncoding(this.resource);
		if (typeof encoding !== 'string' || !this.isNewEncoding(encoding)) {
			this.trace(`onMaybeShouldChangeEncoding() - ignoring because preferred encoding ${encoding} is not new`);

			return;
		}

		if (this.isDirty()) {
			this.trace('onMaybeShouldChangeEncoding() - ignoring because model is dirty');

			return;
		}

		this.logService.info(`Adjusting encoding based on configured language override to '${encoding}' for ${this.resource.toString(true)}.`);

		return this.forceResolveFromFile();
	}

	private hasEncodingSetExplicitly = false;

	setEncoding(encoding: string, mode: EncodingMode): Promise<void> {

		this.hasEncodingSetExplicitly = true;

		return this.setEncodingInternal(encoding, mode);
	}

	private async setEncodingInternal(encoding: string, mode: EncodingMode): Promise<void> {

		if (mode === EncodingMode.Encode) {
			this.updatePreferredEncoding(encoding);

			if (!this.isDirty()) {
				this.versionId++;
				this.setDirty(true);
			}

			if (!this.inConflictMode) {
				await this.save({ source: TextFileEditorModel.TEXTFILE_SAVE_ENCODING_SOURCE });
			}
		}

		else {
			if (!this.isNewEncoding(encoding)) {
				return;
			}

			if (this.isDirty()) {
				throw new Error('Cannot re-open a dirty text document with different encoding. Save it first.');
			}

			this.updatePreferredEncoding(encoding);

			await this.forceResolveFromFile();
		}
	}

	updatePreferredEncoding(encoding: string | undefined): void {
		if (!this.isNewEncoding(encoding)) {
			return;
		}

		this.preferredEncoding = encoding;

		this._onDidChangeEncoding.fire();
	}

	private isNewEncoding(encoding: string | undefined): boolean {
		if (this.preferredEncoding === encoding) {
			return false;
		}

		if (!this.preferredEncoding && this.contentEncoding === encoding) {
			return false;
		}

		return true;
	}

	getEncoding(): string | undefined {
		return this.preferredEncoding || this.contentEncoding;
	}


	private trace(msg: string): void {
		this.logService.trace(`[text file model] ${msg}`, this.resource.toString());
	}

	override isResolved(): this is IResolvedTextFileEditorModel {
		return !!this.textEditorModel;
	}

	override isReadonly(): boolean | IMarkdownString {
		return this.filesConfigurationService.isReadonly(this.resource, this.lastResolvedFileStat);
	}

	override dispose(): void {
		this.trace('dispose()');

		this.inConflictMode = false;
		this.inOrphanMode = false;
		this.inErrorMode = false;

		super.dispose();
	}
}
