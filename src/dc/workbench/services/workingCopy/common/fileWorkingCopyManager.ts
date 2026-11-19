/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Promises } from '../../../../base/common/async.js';
import { VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { toLocalResource, joinPath, isEqual, basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDialogService, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ISaveOptions, SaveSourceRegistry } from '../../../common/editor.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IPathService } from '../../path/common/pathService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IStoredFileWorkingCopy, IStoredFileWorkingCopyModel, IStoredFileWorkingCopyModelFactory, IStoredFileWorkingCopyResolveOptions, StoredFileWorkingCopyState } from './storedFileWorkingCopy.js';
import { StoredFileWorkingCopyManager, IStoredFileWorkingCopyManager, IStoredFileWorkingCopyManagerResolveOptions } from './storedFileWorkingCopyManager.js';
import { IUntitledFileWorkingCopy, IUntitledFileWorkingCopyModel, IUntitledFileWorkingCopyModelFactory, UntitledFileWorkingCopy } from './untitledFileWorkingCopy.js';
import { INewOrExistingUntitledFileWorkingCopyOptions, INewUntitledFileWorkingCopyOptions, INewUntitledFileWorkingCopyWithAssociatedResourceOptions, IUntitledFileWorkingCopyManager, UntitledFileWorkingCopyManager } from './untitledFileWorkingCopyManager.js';
import { IWorkingCopyFileService } from './workingCopyFileService.js';
import { IBaseFileWorkingCopyManager } from './abstractFileWorkingCopyManager.js';
import { IFileWorkingCopy, SnapshotContext } from './fileWorkingCopy.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IElevatedFileService } from '../../files/common/elevatedFileService.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { ILifecycleService } from '../../lifecycle/common/lifecycle.js';
import { IWorkingCopyBackupService } from './workingCopyBackup.js';
import { IWorkingCopyEditorService } from './workingCopyEditorService.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { Schemas } from '../../../../base/common/network.js';
import { IDecorationData, IDecorationsProvider, IDecorationsService } from '../../decorations/common/decorations.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { listErrorForeground } from '../../../../platform/theme/common/colorRegistry.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';

export interface IFileWorkingCopyManager<S extends IStoredFileWorkingCopyModel, U extends IUntitledFileWorkingCopyModel> extends IBaseFileWorkingCopyManager<S | U, IFileWorkingCopy<S | U>> {

	readonly stored: IStoredFileWorkingCopyManager<S>;

	readonly untitled: IUntitledFileWorkingCopyManager<U>;

	resolve(resource: URI, options?: IStoredFileWorkingCopyManagerResolveOptions): Promise<IStoredFileWorkingCopy<S>>;

	resolve(options?: INewUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<U>>;

	resolve(options?: INewUntitledFileWorkingCopyWithAssociatedResourceOptions): Promise<IUntitledFileWorkingCopy<U>>;

	resolve(options?: INewOrExistingUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<U>>;

	saveAs(source: URI, target: URI, options?: ISaveOptions): Promise<IStoredFileWorkingCopy<S> | undefined>;
	saveAs(source: URI, target: undefined, options?: IFileWorkingCopySaveAsOptions): Promise<IStoredFileWorkingCopy<S> | undefined>;
}

export interface IFileWorkingCopySaveAsOptions extends ISaveOptions {

	suggestedTarget?: URI;
}

export class FileWorkingCopyManager<S extends IStoredFileWorkingCopyModel, U extends IUntitledFileWorkingCopyModel> extends Disposable implements IFileWorkingCopyManager<S, U> {

	readonly onDidCreate: Event<IFileWorkingCopy<S | U>>;

	private static readonly FILE_WORKING_COPY_SAVE_CREATE_SOURCE = SaveSourceRegistry.registerSource('fileWorkingCopyCreate.source', localize('fileWorkingCopyCreate.source', "File Created"));
	private static readonly FILE_WORKING_COPY_SAVE_REPLACE_SOURCE = SaveSourceRegistry.registerSource('fileWorkingCopyReplace.source', localize('fileWorkingCopyReplace.source', "File Replaced"));

	readonly stored: IStoredFileWorkingCopyManager<S>;
	readonly untitled: IUntitledFileWorkingCopyManager<U>;

	constructor(
		private readonly workingCopyTypeId: string,
		private readonly storedWorkingCopyModelFactory: IStoredFileWorkingCopyModelFactory<S>,
		private readonly untitledWorkingCopyModelFactory: IUntitledFileWorkingCopyModelFactory<U>,
		@IFileService private readonly fileService: IFileService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILabelService labelService: ILabelService,
		@ILogService private readonly logService: ILogService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@INotificationService notificationService: INotificationService,
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService editorService: IEditorService,
		@IElevatedFileService elevatedFileService: IElevatedFileService,
		@IPathService private readonly pathService: IPathService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IDecorationsService private readonly decorationsService: IDecorationsService,
		@IProgressService progressService: IProgressService
	) {
		super();

		this.stored = this._register(new StoredFileWorkingCopyManager(
			this.workingCopyTypeId,
			this.storedWorkingCopyModelFactory,
			fileService, lifecycleService, labelService, logService, workingCopyFileService,
			workingCopyBackupService, uriIdentityService, filesConfigurationService, workingCopyService,
			notificationService, workingCopyEditorService, editorService, elevatedFileService, progressService
		));

		this.untitled = this._register(new UntitledFileWorkingCopyManager(
			this.workingCopyTypeId,
			this.untitledWorkingCopyModelFactory,
			async (workingCopy, options) => {
				const result = await this.saveAs(workingCopy.resource, undefined, options);

				return !!result;
			},
			fileService, labelService, logService, workingCopyBackupService, workingCopyService
		));

		this.onDidCreate = Event.any<IFileWorkingCopy<S | U>>(this.stored.onDidCreate, this.untitled.onDidCreate);

		this.provideDecorations();
	}


	private provideDecorations(): void {

		const provider = this._register(new class extends Disposable implements IDecorationsProvider {

			readonly label = localize('fileWorkingCopyDecorations', "File Working Copy Decorations");

			private readonly _onDidChange = this._register(new Emitter<URI[]>());
			readonly onDidChange = this._onDidChange.event;

			constructor(private readonly stored: IStoredFileWorkingCopyManager<S>) {
				super();

				this.registerListeners();
			}

			private registerListeners(): void {

				this._register(this.stored.onDidResolve(workingCopy => {
					if (workingCopy.isReadonly() || workingCopy.hasState(StoredFileWorkingCopyState.ORPHAN)) {
						this._onDidChange.fire([workingCopy.resource]);
					}
				}));

				this._register(this.stored.onDidRemove(workingCopyUri => this._onDidChange.fire([workingCopyUri])));

				this._register(this.stored.onDidChangeReadonly(workingCopy => this._onDidChange.fire([workingCopy.resource])));
				this._register(this.stored.onDidChangeOrphaned(workingCopy => this._onDidChange.fire([workingCopy.resource])));
			}

			provideDecorations(uri: URI): IDecorationData | undefined {
				const workingCopy = this.stored.get(uri);
				if (!workingCopy || workingCopy.isDisposed()) {
					return undefined;
				}

				const isReadonly = workingCopy.isReadonly();
				const isOrphaned = workingCopy.hasState(StoredFileWorkingCopyState.ORPHAN);

				if (isReadonly && isOrphaned) {
					return {
						color: listErrorForeground,
						letter: Codicon.lockSmall,
						strikethrough: true,
						tooltip: localize('readonlyAndDeleted', "Deleted, Read-only"),
					};
				}

				else if (isReadonly) {
					return {
						letter: Codicon.lockSmall,
						tooltip: localize('readonly', "Read-only"),
					};
				}

				else if (isOrphaned) {
					return {
						color: listErrorForeground,
						strikethrough: true,
						tooltip: localize('deleted', "Deleted"),
					};
				}

				return undefined;
			}
		}(this.stored));

		this._register(this.decorationsService.registerDecorationsProvider(provider));
	}



	get workingCopies(): (IUntitledFileWorkingCopy<U> | IStoredFileWorkingCopy<S>)[] {
		return [...this.stored.workingCopies, ...this.untitled.workingCopies];
	}

	get(resource: URI): IUntitledFileWorkingCopy<U> | IStoredFileWorkingCopy<S> | undefined {
		return this.stored.get(resource) ?? this.untitled.get(resource);
	}



	resolve(options?: INewUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<U>>;
	resolve(options?: INewUntitledFileWorkingCopyWithAssociatedResourceOptions): Promise<IUntitledFileWorkingCopy<U>>;
	resolve(options?: INewOrExistingUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<U>>;
	resolve(resource: URI, options?: IStoredFileWorkingCopyResolveOptions): Promise<IStoredFileWorkingCopy<S>>;
	resolve(arg1?: URI | INewUntitledFileWorkingCopyOptions | INewUntitledFileWorkingCopyWithAssociatedResourceOptions | INewOrExistingUntitledFileWorkingCopyOptions, arg2?: IStoredFileWorkingCopyResolveOptions): Promise<IUntitledFileWorkingCopy<U> | IStoredFileWorkingCopy<S>> {
		if (URI.isUri(arg1)) {

			if (arg1.scheme === Schemas.untitled) {
				return this.untitled.resolve({ untitledResource: arg1 });
			}

			else {
				return this.stored.resolve(arg1, arg2);
			}
		}

		return this.untitled.resolve(arg1);
	}



	async saveAs(source: URI, target?: URI, options?: IFileWorkingCopySaveAsOptions): Promise<IStoredFileWorkingCopy<S> | undefined> {

		if (!target) {
			const workingCopy = this.get(source);
			if (workingCopy instanceof UntitledFileWorkingCopy && workingCopy.hasAssociatedFilePath) {
				target = await this.suggestSavePath(source);
			} else {
				target = await this.fileDialogService.pickFileToSave(await this.suggestSavePath(options?.suggestedTarget ?? source), options?.availableFileSystems);
			}
		}

		if (!target) {
			return;
		}

		if (this.filesConfigurationService.isReadonly(target)) {
			const confirmed = await this.confirmMakeWriteable(target);
			if (!confirmed) {
				return;
			} else {
				this.filesConfigurationService.updateReadonly(target, false);
			}
		}

		if (this.fileService.hasProvider(source) && isEqual(source, target)) {
			return this.doSave(source, { ...options, force: true });
		}

		if (this.fileService.hasProvider(source) && this.uriIdentityService.extUri.isEqual(source, target) && (await this.fileService.exists(source))) {

			await this.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None);

			return (await this.doSave(source, options)) ?? (await this.doSave(target, options));
		}

		return this.doSaveAs(source, target, options);
	}

	private async doSave(resource: URI, options?: ISaveOptions): Promise<IStoredFileWorkingCopy<S> | undefined> {

		const storedFileWorkingCopy = this.stored.get(resource);
		if (storedFileWorkingCopy) {
			const success = await storedFileWorkingCopy.save(options);
			if (success) {
				return storedFileWorkingCopy;
			}
		}

		return undefined;
	}

	private async doSaveAs(source: URI, target: URI, options?: IFileWorkingCopySaveAsOptions): Promise<IStoredFileWorkingCopy<S> | undefined> {
		let sourceContents: VSBufferReadableStream;

		const sourceWorkingCopy = this.get(source);
		if (sourceWorkingCopy?.isResolved()) {
			sourceContents = await sourceWorkingCopy.model.snapshot(SnapshotContext.Save, CancellationToken.None);
		}

		else {
			sourceContents = (await this.fileService.readFileStream(source)).value;
		}

		const { targetFileExists, targetStoredFileWorkingCopy } = await this.doResolveSaveTarget(source, target);

		if (
			sourceWorkingCopy instanceof UntitledFileWorkingCopy &&
			sourceWorkingCopy.hasAssociatedFilePath &&
			targetFileExists &&
			this.uriIdentityService.extUri.isEqual(target, toLocalResource(sourceWorkingCopy.resource, this.environmentService.remoteAuthority, this.pathService.defaultUriScheme))
		) {
			const overwrite = await this.confirmOverwrite(target);
			if (!overwrite) {
				return undefined;
			}
		}

		await targetStoredFileWorkingCopy.model?.update(sourceContents, CancellationToken.None);

		if (!options?.source) {
			options = {
				...options,
				source: targetFileExists ? FileWorkingCopyManager.FILE_WORKING_COPY_SAVE_REPLACE_SOURCE : FileWorkingCopyManager.FILE_WORKING_COPY_SAVE_CREATE_SOURCE
			};
		}

		const success = await targetStoredFileWorkingCopy.save({
			...options,
			from: source,
			force: true
		});
		if (!success) {
			return undefined;
		}

		try {
			await sourceWorkingCopy?.revert();
		} catch (error) {


			this.logService.error(error);
		}

		if (source.scheme === Schemas.untitled) {
			this.untitled.notifyDidSave(source, target);
		}

		return targetStoredFileWorkingCopy;
	}

	private async doResolveSaveTarget(source: URI, target: URI): Promise<{ targetFileExists: boolean; targetStoredFileWorkingCopy: IStoredFileWorkingCopy<S> }> {

		let targetFileExists = false;
		let targetStoredFileWorkingCopy = this.stored.get(target);
		if (targetStoredFileWorkingCopy?.isResolved()) {
			targetFileExists = true;
		}

		else {
			targetFileExists = await this.fileService.exists(target);

			if (!targetFileExists) {
				await this.workingCopyFileService.create([{ resource: target }], CancellationToken.None);
			}

			if (this.uriIdentityService.extUri.isEqual(source, target) && this.get(source)) {
				targetStoredFileWorkingCopy = await this.stored.resolve(source);
			} else {
				targetStoredFileWorkingCopy = await this.stored.resolve(target);
			}
		}

		return { targetFileExists, targetStoredFileWorkingCopy };
	}

	private async confirmOverwrite(resource: URI): Promise<boolean> {
		const { confirmed } = await this.dialogService.confirm({
			type: 'warning',
			message: localize('confirmOverwrite', "'{0}' already exists. Do you want to replace it?", basename(resource)),
			detail: localize('overwriteIrreversible', "A file or folder with the name '{0}' already exists in the folder '{1}'. Replacing it will overwrite its current contents.", basename(resource), basename(dirname(resource))),
			primaryButton: localize({ key: 'replaceButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Replace")
		});

		return confirmed;
	}

	private async confirmMakeWriteable(resource: URI): Promise<boolean> {
		const { confirmed } = await this.dialogService.confirm({
			type: 'warning',
			message: localize('confirmMakeWriteable', "'{0}' is marked as read-only. Do you want to save anyway?", basename(resource)),
			detail: localize('confirmMakeWriteableDetail', "Paths can be configured as read-only via settings."),
			primaryButton: localize({ key: 'makeWriteableButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Save Anyway")
		});

		return confirmed;
	}

	private async suggestSavePath(resource: URI): Promise<URI> {

		if (this.fileService.hasProvider(resource)) {
			return resource;
		}

		const workingCopy = this.get(resource);
		if (workingCopy instanceof UntitledFileWorkingCopy && workingCopy.hasAssociatedFilePath) {
			return toLocalResource(resource, this.environmentService.remoteAuthority, this.pathService.defaultUriScheme);
		}

		const defaultFilePath = await this.fileDialogService.defaultFilePath();

		if (workingCopy) {
			const candidatePath = joinPath(defaultFilePath, workingCopy.name);
			if (await this.pathService.hasValidBasename(candidatePath, workingCopy.name)) {
				return candidatePath;
			}
		}

		return joinPath(defaultFilePath, basename(resource));
	}



	async destroy(): Promise<void> {
		await Promises.settled([
			this.stored.destroy(),
			this.untitled.destroy()
		]);
	}

}
