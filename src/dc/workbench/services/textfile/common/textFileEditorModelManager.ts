/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { TextFileEditorModel } from './textFileEditorModel.js';
import { dispose, IDisposable, Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ITextFileEditorModel, ITextFileEditorModelManager, ITextFileEditorModelResolveOrCreateOptions, ITextFileResolveEvent, ITextFileSaveEvent, ITextFileSaveParticipant } from './textfiles.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IFileService, FileChangesEvent, FileOperation, FileChangeType, IFileSystemProviderRegistrationEvent, IFileSystemProviderCapabilitiesChangeEvent } from '../../../../platform/files/common/files.js';
import { Promises, ResourceQueue } from '../../../../base/common/async.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { TextFileSaveParticipant } from './textFileSaveParticipant.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStoredFileWorkingCopySaveParticipantContext, IWorkingCopyFileService, WorkingCopyFileEvent } from '../../workingCopy/common/workingCopyFileService.js';
import { ITextSnapshot } from '../../../../editor/common/model.js';
import { extname, joinPath } from '../../../../base/common/resources.js';
import { createTextBufferFactoryFromSnapshot } from '../../../../editor/common/model/textModel.js';
import { PLAINTEXT_EXTENSION, PLAINTEXT_LANGUAGE_ID } from '../../../../editor/common/languages/modesRegistry.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IProgress, IProgressStep } from '../../../../platform/progress/common/progress.js';

interface ITextFileEditorModelToRestore {
	readonly source: URI;
	readonly target: URI;
	readonly snapshot?: ITextSnapshot;
	readonly language?: {
		readonly id: string;
		readonly explicit: boolean;
	};
	readonly encoding?: string;
}

export class TextFileEditorModelManager extends Disposable implements ITextFileEditorModelManager {

	private readonly _onDidCreate = this._register(new Emitter<TextFileEditorModel>({ leakWarningThreshold: 500, leakWarningName: 'TextFileEditorModelManager._onDidCreate' }));
	readonly onDidCreate = this._onDidCreate.event;

	private readonly _onDidResolve = this._register(new Emitter<ITextFileResolveEvent>());
	readonly onDidResolve = this._onDidResolve.event;

	private readonly _onDidRemove = this._register(new Emitter<URI>());
	readonly onDidRemove = this._onDidRemove.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeReadonly = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidChangeReadonly = this._onDidChangeReadonly.event;

	private readonly _onDidChangeOrphaned = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidChangeOrphaned = this._onDidChangeOrphaned.event;

	private readonly _onDidSaveError = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidSaveError = this._onDidSaveError.event;

	private readonly _onDidSave = this._register(new Emitter<ITextFileSaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly mapResourceToModel = new ResourceMap<TextFileEditorModel>();
	private readonly mapResourceToModelListeners = new ResourceMap<IDisposable>();
	private readonly mapResourceToDisposeListener = new ResourceMap<IDisposable>();
	private readonly mapResourceToPendingModelResolvers = new ResourceMap<Promise<void>>();

	private readonly modelResolveQueue = this._register(new ResourceQueue());

	saveErrorHandler = (() => {
		const notificationService = this.notificationService;

		return {
			onSaveError(error: Error, model: ITextFileEditorModel): void {
				notificationService.error(localize({ key: 'genericSaveError', comment: ['{0} is the resource that failed to save and {1} the error message'] }, "Failed to save '{0}': {1}", model.name, toErrorMessage(error, false)));
			}
		};
	})();

	get models(): TextFileEditorModel[] {
		return [...this.mapResourceToModel.values()];
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		this.saveParticipants = this._register(this.instantiationService.createInstance(TextFileSaveParticipant));

		this.registerListeners();
	}

	private registerListeners(): void {

		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));

		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onDidChangeFileSystemProviderCapabilities(e)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onDidChangeFileSystemProviderRegistrations(e)));

		this._register(this.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => this.onWillRunWorkingCopyFileOperation(e)));
		this._register(this.workingCopyFileService.onDidFailWorkingCopyFileOperation(e => this.onDidFailWorkingCopyFileOperation(e)));
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => this.onDidRunWorkingCopyFileOperation(e)));
	}

	private onDidFilesChange(e: FileChangesEvent): void {
		for (const model of this.models) {
			if (model.isDirty()) {
				continue;
			}

			if (e.contains(model.resource, FileChangeType.UPDATED, FileChangeType.ADDED)) {
				this.queueModelReload(model);
			}
		}
	}

	private onDidChangeFileSystemProviderCapabilities(e: IFileSystemProviderCapabilitiesChangeEvent): void {

		this.queueModelReloads(e.scheme);
	}

	private onDidChangeFileSystemProviderRegistrations(e: IFileSystemProviderRegistrationEvent): void {
		if (!e.added) {
			return;
		}

		this.queueModelReloads(e.scheme);
	}

	private queueModelReloads(scheme: string): void {
		for (const model of this.models) {
			if (model.isDirty()) {
				continue;
			}

			if (scheme === model.resource.scheme) {
				this.queueModelReload(model);
			}
		}
	}

	private queueModelReload(model: TextFileEditorModel): void {

		const queueSize = this.modelResolveQueue.queueSize(model.resource);
		if (queueSize <= 1) {
			this.modelResolveQueue.queueFor(model.resource, async () => {
				try {
					await this.reload(model);
				} catch (error) {
					onUnexpectedError(error);
				}
			});
		}
	}

	private readonly mapCorrelationIdToModelsToRestore = new Map<number, ITextFileEditorModelToRestore[]>();

	private onWillRunWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {

		if (e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY) {
			const modelsToRestore: ITextFileEditorModelToRestore[] = [];

			for (const { source, target } of e.files) {
				if (source) {
					if (this.uriIdentityService.extUri.isEqual(source, target)) {
						continue;
					}

					const sourceModels: TextFileEditorModel[] = [];
					for (const model of this.models) {
						if (this.uriIdentityService.extUri.isEqualOrParent(model.resource, source)) {
							sourceModels.push(model);
						}
					}

					for (const sourceModel of sourceModels) {
						const sourceModelResource = sourceModel.resource;

						let targetModelResource: URI;
						if (this.uriIdentityService.extUri.isEqual(sourceModelResource, source)) {
							targetModelResource = target;
						}

						else {
							targetModelResource = joinPath(target, sourceModelResource.path.substr(source.path.length + 1));
						}

						const languageId = sourceModel.getLanguageId();
						modelsToRestore.push({
							source: sourceModelResource,
							target: targetModelResource,
							language: languageId ? {
								id: languageId,
								explicit: sourceModel.languageChangeSource === 'user'
							} : undefined,
							encoding: sourceModel.getEncoding(),
							snapshot: sourceModel.isDirty() ? sourceModel.createSnapshot() : undefined
						});
					}
				}
			}

			this.mapCorrelationIdToModelsToRestore.set(e.correlationId, modelsToRestore);
		}
	}

	private onDidFailWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {

		if ((e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY)) {
			const modelsToRestore = this.mapCorrelationIdToModelsToRestore.get(e.correlationId);
			if (modelsToRestore) {
				this.mapCorrelationIdToModelsToRestore.delete(e.correlationId);

				modelsToRestore.forEach(model => {
					if (model.snapshot) {
						this.get(model.source)?.setDirty(true);
					}
				});
			}
		}
	}

	private onDidRunWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {
		switch (e.operation) {

			case FileOperation.CREATE:
				e.waitUntil((async () => {
					for (const { target } of e.files) {
						const model = this.get(target);
						if (model && !model.isDisposed()) {
							await model.revert();
						}
					}
				})());
				break;

			case FileOperation.MOVE:
			case FileOperation.COPY:
				e.waitUntil((async () => {
					const modelsToRestore = this.mapCorrelationIdToModelsToRestore.get(e.correlationId);
					if (modelsToRestore) {
						this.mapCorrelationIdToModelsToRestore.delete(e.correlationId);

						await Promises.settled(modelsToRestore.map(async modelToRestore => {

							const target = this.uriIdentityService.asCanonicalUri(modelToRestore.target);

							const restoredModel = await this.resolve(target, {
								reload: { async: false },
								contents: modelToRestore.snapshot ? createTextBufferFactoryFromSnapshot(modelToRestore.snapshot) : undefined,
								encoding: modelToRestore.encoding
							});

							if (modelToRestore.language?.id && modelToRestore.language.id !== PLAINTEXT_LANGUAGE_ID) {

								if (modelToRestore.language.explicit) {
									restoredModel.setLanguageId(modelToRestore.language.id);
								}

								else if (restoredModel.getLanguageId() === PLAINTEXT_LANGUAGE_ID && extname(target) !== PLAINTEXT_EXTENSION) {
									restoredModel.updateTextEditorModel(undefined, modelToRestore.language.id);
								}
							}
						}));
					}
				})());
				break;
		}
	}

	get(resource: URI): TextFileEditorModel | undefined {
		return this.mapResourceToModel.get(resource);
	}

	private has(resource: URI): boolean {
		return this.mapResourceToModel.has(resource);
	}

	private async reload(model: TextFileEditorModel): Promise<void> {

		await this.joinPendingResolves(model.resource);

		if (model.isDirty() || model.isDisposed() || !this.has(model.resource)) {
			return;
		}

		await this.doResolve(model, { reload: { async: false } });
	}

	async resolve(resource: URI, options?: ITextFileEditorModelResolveOrCreateOptions): Promise<TextFileEditorModel> {

		const pendingResolve = this.joinPendingResolves(resource);
		if (pendingResolve) {
			await pendingResolve;
		}

		return this.doResolve(resource, options);
	}

	private async doResolve(resourceOrModel: URI | TextFileEditorModel, options?: ITextFileEditorModelResolveOrCreateOptions): Promise<TextFileEditorModel> {
		let model: TextFileEditorModel | undefined;
		let resource: URI;
		if (URI.isUri(resourceOrModel)) {
			resource = resourceOrModel;
			model = this.get(resource);
		} else {
			resource = resourceOrModel.resource;
			model = resourceOrModel;
		}

		let modelResolve: Promise<void>;
		let didCreateModel = false;

		if (model) {

			if (options?.contents) {
				modelResolve = model.resolve(options);
			}

			else if (options?.reload) {

				if (options.reload.async) {
					modelResolve = Promise.resolve();
					(async () => {
						try {
							await model.resolve(options);
						} catch (error) {
							if (!model.isDisposed()) {
								onUnexpectedError(error);
							}
						}
					})();
				}

				else {
					modelResolve = model.resolve(options);
				}
			}

			else {
				modelResolve = Promise.resolve();
			}
		}

		else {
			didCreateModel = true;

			const newModel = model = this.instantiationService.createInstance(TextFileEditorModel, resource, options ? options.encoding : undefined, options ? options.languageId : undefined);
			modelResolve = model.resolve(options);

			this.registerModel(newModel);
		}

		this.mapResourceToPendingModelResolvers.set(resource, modelResolve);

		this.add(resource, model);

		if (didCreateModel) {
			this._onDidCreate.fire(model);

			if (model.isDirty()) {
				this._onDidChangeDirty.fire(model);
			}
		}

		try {
			await modelResolve;
		} catch (error) {

			if (didCreateModel) {
				model.dispose();
			}

			throw error;
		} finally {

			this.mapResourceToPendingModelResolvers.delete(resource);
		}

		if (options?.languageId) {
			model.setLanguageId(options.languageId);
		}

		if (didCreateModel && model.isDirty()) {
			this._onDidChangeDirty.fire(model);
		}

		return model;
	}

	private joinPendingResolves(resource: URI): Promise<void> | undefined {
		const pendingModelResolve = this.mapResourceToPendingModelResolvers.get(resource);
		if (!pendingModelResolve) {
			return;
		}

		return this.doJoinPendingResolves(resource);
	}

	private async doJoinPendingResolves(resource: URI): Promise<void> {

		let currentModelCopyResolve: Promise<void> | undefined;
		while (this.mapResourceToPendingModelResolvers.has(resource)) {
			const nextPendingModelResolve = this.mapResourceToPendingModelResolvers.get(resource);
			if (nextPendingModelResolve === currentModelCopyResolve) {
				return;
			}

			currentModelCopyResolve = nextPendingModelResolve;
			try {
				await nextPendingModelResolve;
			} catch (error) {
			}
		}
	}

	private registerModel(model: TextFileEditorModel): void {

		const modelListeners = new DisposableStore();
		modelListeners.add(model.onDidResolve(reason => this._onDidResolve.fire({ model, reason })));
		modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire(model)));
		modelListeners.add(model.onDidChangeReadonly(() => this._onDidChangeReadonly.fire(model)));
		modelListeners.add(model.onDidChangeOrphaned(() => this._onDidChangeOrphaned.fire(model)));
		modelListeners.add(model.onDidSaveError(() => this._onDidSaveError.fire(model)));
		modelListeners.add(model.onDidSave(e => this._onDidSave.fire({ model, ...e })));
		modelListeners.add(model.onDidRevert(() => this._onDidRevert.fire(model)));
		modelListeners.add(model.onDidChangeEncoding(() => this._onDidChangeEncoding.fire(model)));

		this.mapResourceToModelListeners.set(model.resource, modelListeners);
	}

	add(resource: URI, model: TextFileEditorModel): void {
		const knownModel = this.mapResourceToModel.get(resource);
		if (knownModel === model) {
			return;
		}

		const disposeListener = this.mapResourceToDisposeListener.get(resource);
		disposeListener?.dispose();

		this.mapResourceToModel.set(resource, model);
		this.mapResourceToDisposeListener.set(resource, model.onWillDispose(() => this.remove(resource)));
	}

	remove(resource: URI): void {
		const removed = this.mapResourceToModel.delete(resource);

		const disposeListener = this.mapResourceToDisposeListener.get(resource);
		if (disposeListener) {
			dispose(disposeListener);
			this.mapResourceToDisposeListener.delete(resource);
		}

		const modelListener = this.mapResourceToModelListeners.get(resource);
		if (modelListener) {
			dispose(modelListener);
			this.mapResourceToModelListeners.delete(resource);
		}

		if (removed) {
			this._onDidRemove.fire(resource);
		}
	}


	private readonly saveParticipants: TextFileSaveParticipant;

	addSaveParticipant(participant: ITextFileSaveParticipant): IDisposable {
		return this.saveParticipants.addSaveParticipant(participant);
	}

	runSaveParticipants(model: ITextFileEditorModel, context: IStoredFileWorkingCopySaveParticipantContext, progress: IProgress<IProgressStep>, token: CancellationToken): Promise<void> {
		return this.saveParticipants.participate(model, context, progress, token);
	}


	canDispose(model: TextFileEditorModel): true | Promise<true> {

		if (
			model.isDisposed() ||
			(!this.mapResourceToPendingModelResolvers.has(model.resource) && !model.isDirty())
		) {
			return true;
		}

		return this.doCanDispose(model);
	}

	private async doCanDispose(model: TextFileEditorModel): Promise<true> {

		const pendingResolve = this.joinPendingResolves(model.resource);
		if (pendingResolve) {
			await pendingResolve;

			return this.canDispose(model);
		}

		if (model.isDirty()) {
			await Event.toPromise(model.onDidChangeDirty);

			return this.canDispose(model);
		}

		return true;
	}

	override dispose(): void {
		super.dispose();

		this.mapResourceToModel.clear();
		this.mapResourceToPendingModelResolvers.clear();

		dispose(this.mapResourceToDisposeListener.values());
		this.mapResourceToDisposeListener.clear();

		dispose(this.mapResourceToModelListeners.values());
		this.mapResourceToModelListeners.clear();
	}
}
