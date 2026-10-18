/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { DisposableStore, dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { StoredFileWorkingCopy, StoredFileWorkingCopyState, IStoredFileWorkingCopy, IStoredFileWorkingCopyModel, IStoredFileWorkingCopyModelFactory, IStoredFileWorkingCopyResolveOptions, IStoredFileWorkingCopySaveEvent as IBaseStoredFileWorkingCopySaveEvent } from './storedFileWorkingCopy.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { Promises, ResourceQueue } from '../../../../base/common/async.js';
import { FileChangesEvent, FileChangeType, FileOperation, IFileService, IFileSystemProviderCapabilitiesChangeEvent, IFileSystemProviderRegistrationEvent } from '../../../../platform/files/common/files.js';
import { ILifecycleService } from '../../lifecycle/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IWorkingCopyFileService, WorkingCopyFileEvent } from './workingCopyFileService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IWorkingCopyBackupService } from './workingCopyBackup.js';
import { BaseFileWorkingCopyManager, IBaseFileWorkingCopyManager } from './abstractFileWorkingCopyManager.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IElevatedFileService } from '../../files/common/elevatedFileService.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyEditorService } from './workingCopyEditorService.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { isWeb } from '../../../../base/common/platform.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { SnapshotContext } from './fileWorkingCopy.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';

export interface IStoredFileWorkingCopyManager<M extends IStoredFileWorkingCopyModel> extends IBaseFileWorkingCopyManager<M, IStoredFileWorkingCopy<M>> {

	readonly onDidResolve: Event<IStoredFileWorkingCopy<M>>;

	readonly onDidChangeDirty: Event<IStoredFileWorkingCopy<M>>;

	readonly onDidChangeReadonly: Event<IStoredFileWorkingCopy<M>>;

	readonly onDidChangeOrphaned: Event<IStoredFileWorkingCopy<M>>;

	readonly onDidSaveError: Event<IStoredFileWorkingCopy<M>>;

	readonly onDidSave: Event<IStoredFileWorkingCopySaveEvent<M>>;

	readonly onDidRevert: Event<IStoredFileWorkingCopy<M>>;

	readonly onDidRemove: Event<URI>;

	resolve(resource: URI, options?: IStoredFileWorkingCopyManagerResolveOptions): Promise<IStoredFileWorkingCopy<M>>;

	canDispose(workingCopy: IStoredFileWorkingCopy<M>): true | Promise<true>;
}

export interface IStoredFileWorkingCopySaveEvent<M extends IStoredFileWorkingCopyModel> extends IBaseStoredFileWorkingCopySaveEvent {

	readonly workingCopy: IStoredFileWorkingCopy<M>;
}

export interface IStoredFileWorkingCopyManagerResolveOptions extends IStoredFileWorkingCopyResolveOptions {

	readonly reload?: {

		readonly async: boolean;

		readonly force?: boolean;
	};
}

export class StoredFileWorkingCopyManager<M extends IStoredFileWorkingCopyModel> extends BaseFileWorkingCopyManager<M, IStoredFileWorkingCopy<M>> implements IStoredFileWorkingCopyManager<M> {


	private readonly _onDidResolve = this._register(new Emitter<IStoredFileWorkingCopy<M>>());
	readonly onDidResolve = this._onDidResolve.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<IStoredFileWorkingCopy<M>>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeReadonly = this._register(new Emitter<IStoredFileWorkingCopy<M>>());
	readonly onDidChangeReadonly = this._onDidChangeReadonly.event;

	private readonly _onDidChangeOrphaned = this._register(new Emitter<IStoredFileWorkingCopy<M>>());
	readonly onDidChangeOrphaned = this._onDidChangeOrphaned.event;

	private readonly _onDidSaveError = this._register(new Emitter<IStoredFileWorkingCopy<M>>());
	readonly onDidSaveError = this._onDidSaveError.event;

	private readonly _onDidSave = this._register(new Emitter<IStoredFileWorkingCopySaveEvent<M>>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<IStoredFileWorkingCopy<M>>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onDidRemove = this._register(new Emitter<URI>());
	readonly onDidRemove = this._onDidRemove.event;


	private readonly mapResourceToWorkingCopyListeners = new ResourceMap<IDisposable>();
	private readonly mapResourceToPendingWorkingCopyResolve = new ResourceMap<Promise<void>>();

	private readonly workingCopyResolveQueue = this._register(new ResourceQueue());

	constructor(
		private readonly workingCopyTypeId: string,
		private readonly modelFactory: IStoredFileWorkingCopyModelFactory<M>,
		@IFileService fileService: IFileService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService logService: ILogService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkingCopyEditorService private readonly workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService private readonly editorService: IEditorService,
		@IElevatedFileService private readonly elevatedFileService: IElevatedFileService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super(fileService, logService, workingCopyBackupService);

		this.registerListeners();
	}

	private registerListeners(): void {

		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));

		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onDidChangeFileSystemProviderCapabilities(e)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onDidChangeFileSystemProviderRegistrations(e)));

		this._register(this.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => this.onWillRunWorkingCopyFileOperation(e)));
		this._register(this.workingCopyFileService.onDidFailWorkingCopyFileOperation(e => this.onDidFailWorkingCopyFileOperation(e)));
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => this.onDidRunWorkingCopyFileOperation(e)));

		if (isWeb) {
			this._register(this.lifecycleService.onBeforeShutdown(event => event.veto(this.onBeforeShutdownWeb(), 'veto.fileWorkingCopyManager')));
		} else {
			this._register(this.lifecycleService.onWillShutdown(event => event.join(this.onWillShutdownDesktop(), { id: 'join.fileWorkingCopyManager', label: localize('join.fileWorkingCopyManager', "Saving working copies") })));
		}
	}

	private onBeforeShutdownWeb(): boolean {
		if (this.workingCopies.some(workingCopy => workingCopy.hasState(StoredFileWorkingCopyState.PENDING_SAVE))) {
			return true;
		}

		return false;
	}

	private async onWillShutdownDesktop(): Promise<void> {
		let pendingSavedWorkingCopies: IStoredFileWorkingCopy<M>[];

		while ((pendingSavedWorkingCopies = this.workingCopies.filter(workingCopy => workingCopy.hasState(StoredFileWorkingCopyState.PENDING_SAVE))).length > 0) {
			await Promises.settled(pendingSavedWorkingCopies.map(workingCopy => workingCopy.joinState(StoredFileWorkingCopyState.PENDING_SAVE)));
		}
	}


	private onDidChangeFileSystemProviderCapabilities(e: IFileSystemProviderCapabilitiesChangeEvent): void {

		this.queueWorkingCopyReloads(e.scheme);
	}

	private onDidChangeFileSystemProviderRegistrations(e: IFileSystemProviderRegistrationEvent): void {
		if (!e.added) {
			return;
		}

		this.queueWorkingCopyReloads(e.scheme);
	}

	private onDidFilesChange(e: FileChangesEvent): void {

		this.queueWorkingCopyReloads(e);
	}

	private queueWorkingCopyReloads(scheme: string): void;
	private queueWorkingCopyReloads(e: FileChangesEvent): void;
	private queueWorkingCopyReloads(schemeOrEvent: string | FileChangesEvent): void {
		for (const workingCopy of this.workingCopies) {
			if (workingCopy.isDirty()) {
				continue;
			}

			let resolveWorkingCopy = false;
			if (typeof schemeOrEvent === 'string') {
				resolveWorkingCopy = schemeOrEvent === workingCopy.resource.scheme;
			} else {
				resolveWorkingCopy = schemeOrEvent.contains(workingCopy.resource, FileChangeType.UPDATED, FileChangeType.ADDED);
			}

			if (resolveWorkingCopy) {
				this.queueWorkingCopyReload(workingCopy);
			}
		}
	}

	private queueWorkingCopyReload(workingCopy: IStoredFileWorkingCopy<M>): void {

		const queueSize = this.workingCopyResolveQueue.queueSize(workingCopy.resource);
		if (queueSize <= 1) {
			this.workingCopyResolveQueue.queueFor(workingCopy.resource, async () => {
				try {
					await this.reload(workingCopy);
				} catch (error) {
					this.logService.error(error);
				}
			});
		}
	}



	private readonly mapCorrelationIdToWorkingCopiesToRestore = new Map<number, { source: URI; target: URI; snapshot?: VSBufferReadableStream }[]>();

	private onWillRunWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {

		if (e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY) {
			e.waitUntil((async () => {
				const workingCopiesToRestore: { source: URI; target: URI; snapshot?: VSBufferReadableStream }[] = [];

				for (const { source, target } of e.files) {
					if (source) {
						if (this.uriIdentityService.extUri.isEqual(source, target)) {
							continue;
						}

						const sourceWorkingCopies: IStoredFileWorkingCopy<M>[] = [];
						for (const workingCopy of this.workingCopies) {
							if (this.uriIdentityService.extUri.isEqualOrParent(workingCopy.resource, source)) {
								sourceWorkingCopies.push(workingCopy);
							}
						}

						for (const sourceWorkingCopy of sourceWorkingCopies) {
							const sourceResource = sourceWorkingCopy.resource;

							let targetResource: URI;
							if (this.uriIdentityService.extUri.isEqual(sourceResource, source)) {
								targetResource = target;
							}

							else {
								targetResource = joinPath(target, sourceResource.path.substr(source.path.length + 1));
							}

							workingCopiesToRestore.push({
								source: sourceResource,
								target: targetResource,
								snapshot: sourceWorkingCopy.isDirty() ? await sourceWorkingCopy.model?.snapshot(SnapshotContext.Save, CancellationToken.None) : undefined
							});
						}
					}
				}

				this.mapCorrelationIdToWorkingCopiesToRestore.set(e.correlationId, workingCopiesToRestore);
			})());
		}
	}

	private onDidFailWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {

		if ((e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY)) {
			const workingCopiesToRestore = this.mapCorrelationIdToWorkingCopiesToRestore.get(e.correlationId);
			if (workingCopiesToRestore) {
				this.mapCorrelationIdToWorkingCopiesToRestore.delete(e.correlationId);

				for (const workingCopy of workingCopiesToRestore) {


					if (workingCopy.snapshot) {
						this.get(workingCopy.source)?.markModified();
					}
				}
			}
		}
	}

	private onDidRunWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {
		switch (e.operation) {

			case FileOperation.CREATE:
				e.waitUntil((async () => {
					for (const { target } of e.files) {
						const workingCopy = this.get(target);
						if (workingCopy && !workingCopy.isDisposed()) {
							await workingCopy.revert();
						}
					}
				})());
				break;

			case FileOperation.MOVE:
			case FileOperation.COPY:
				e.waitUntil((async () => {
					const workingCopiesToRestore = this.mapCorrelationIdToWorkingCopiesToRestore.get(e.correlationId);
					if (workingCopiesToRestore) {
						this.mapCorrelationIdToWorkingCopiesToRestore.delete(e.correlationId);

						await Promises.settled(workingCopiesToRestore.map(async workingCopyToRestore => {

							const target = this.uriIdentityService.asCanonicalUri(workingCopyToRestore.target);

							await this.resolve(target, {
								reload: { async: false },
								contents: workingCopyToRestore.snapshot
							});
						}));
					}
				})());
				break;
		}
	}



	private async reload(workingCopy: IStoredFileWorkingCopy<M>): Promise<void> {

		await this.joinPendingResolves(workingCopy.resource);

		if (workingCopy.isDirty() || workingCopy.isDisposed() || !this.has(workingCopy.resource)) {
			return;
		}

		await this.doResolve(workingCopy, { reload: { async: false } });
	}

	async resolve(resource: URI, options?: IStoredFileWorkingCopyManagerResolveOptions): Promise<IStoredFileWorkingCopy<M>> {

		const pendingResolve = this.joinPendingResolves(resource);
		if (pendingResolve) {
			await pendingResolve;
		}

		return this.doResolve(resource, options);
	}

	private async doResolve(resourceOrWorkingCopy: URI | IStoredFileWorkingCopy<M>, options?: IStoredFileWorkingCopyManagerResolveOptions): Promise<IStoredFileWorkingCopy<M>> {
		let workingCopy: IStoredFileWorkingCopy<M> | undefined;
		let resource: URI;
		if (URI.isUri(resourceOrWorkingCopy)) {
			resource = resourceOrWorkingCopy;
			workingCopy = this.get(resource);
		} else {
			resource = resourceOrWorkingCopy.resource;
			workingCopy = resourceOrWorkingCopy;
		}

		let workingCopyResolve: Promise<void>;
		let didCreateWorkingCopy = false;

		const resolveOptions: IStoredFileWorkingCopyResolveOptions = {
			contents: options?.contents,
			forceReadFromFile: options?.reload?.force,
			limits: options?.limits
		};

		if (workingCopy) {

			if (options?.contents) {
				workingCopyResolve = workingCopy.resolve(resolveOptions);
			}

			else if (options?.reload) {

				if (options.reload.async) {
					workingCopyResolve = Promise.resolve();
					(async () => {
						try {
							await workingCopy.resolve(resolveOptions);
						} catch (error) {
							if (!workingCopy.isDisposed()) {
								onUnexpectedError(error);
							}
						}
					})();
				}

				else {
					workingCopyResolve = workingCopy.resolve(resolveOptions);
				}
			}

			else {
				workingCopyResolve = Promise.resolve();
			}
		}

		else {
			didCreateWorkingCopy = true;

			workingCopy = new StoredFileWorkingCopy(
				this.workingCopyTypeId,
				resource,
				this.labelService.getUriBasenameLabel(resource),
				this.modelFactory,
				async options => { await this.resolve(resource, { ...options, reload: { async: false } }); },
				this.fileService, this.logService, this.workingCopyFileService, this.filesConfigurationService,
				this.workingCopyBackupService, this.workingCopyService, this.notificationService, this.workingCopyEditorService,
				this.editorService, this.elevatedFileService, this.progressService
			);

			workingCopyResolve = workingCopy.resolve(resolveOptions);

			this.registerWorkingCopy(workingCopy);
		}

		this.mapResourceToPendingWorkingCopyResolve.set(resource, workingCopyResolve);

		this.add(resource, workingCopy);

		if (didCreateWorkingCopy) {

			if (workingCopy.isDirty()) {
				this._onDidChangeDirty.fire(workingCopy);
			}
		}

		try {
			await workingCopyResolve;
		} catch (error) {

			if (didCreateWorkingCopy) {
				workingCopy.dispose();
			}

			throw error;
		} finally {

			this.mapResourceToPendingWorkingCopyResolve.delete(resource);
		}

		if (didCreateWorkingCopy && workingCopy.isDirty()) {
			this._onDidChangeDirty.fire(workingCopy);
		}

		return workingCopy;
	}

	private joinPendingResolves(resource: URI): Promise<void> | undefined {
		const pendingWorkingCopyResolve = this.mapResourceToPendingWorkingCopyResolve.get(resource);
		if (!pendingWorkingCopyResolve) {
			return;
		}

		return this.doJoinPendingResolves(resource);
	}

	private async doJoinPendingResolves(resource: URI): Promise<void> {

		let currentWorkingCopyResolve: Promise<void> | undefined;
		while (this.mapResourceToPendingWorkingCopyResolve.has(resource)) {
			const nextPendingWorkingCopyResolve = this.mapResourceToPendingWorkingCopyResolve.get(resource);
			if (nextPendingWorkingCopyResolve === currentWorkingCopyResolve) {
				return;
			}

			currentWorkingCopyResolve = nextPendingWorkingCopyResolve;
			try {
				await nextPendingWorkingCopyResolve;
			} catch (error) {
			}
		}
	}

	private registerWorkingCopy(workingCopy: IStoredFileWorkingCopy<M>): void {

		const workingCopyListeners = new DisposableStore();
		workingCopyListeners.add(workingCopy.onDidResolve(() => this._onDidResolve.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onDidChangeReadonly(() => this._onDidChangeReadonly.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onDidChangeOrphaned(() => this._onDidChangeOrphaned.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onDidSaveError(() => this._onDidSaveError.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onDidSave(e => this._onDidSave.fire({ workingCopy, ...e })));
		workingCopyListeners.add(workingCopy.onDidRevert(() => this._onDidRevert.fire(workingCopy)));

		this.mapResourceToWorkingCopyListeners.set(workingCopy.resource, workingCopyListeners);
	}

	protected override remove(resource: URI): boolean {
		const removed = super.remove(resource);

		const workingCopyListener = this.mapResourceToWorkingCopyListeners.get(resource);
		if (workingCopyListener) {
			dispose(workingCopyListener);
			this.mapResourceToWorkingCopyListeners.delete(resource);
		}

		if (removed) {
			this._onDidRemove.fire(resource);
		}

		return removed;
	}



	canDispose(workingCopy: IStoredFileWorkingCopy<M>): true | Promise<true> {

		if (
			workingCopy.isDisposed() ||
			(!this.mapResourceToPendingWorkingCopyResolve.has(workingCopy.resource) && !workingCopy.isDirty())
		) {
			return true;
		}

		return this.doCanDispose(workingCopy);
	}

	private async doCanDispose(workingCopy: IStoredFileWorkingCopy<M>): Promise<true> {

		const pendingResolve = this.joinPendingResolves(workingCopy.resource);
		if (pendingResolve) {
			await pendingResolve;

			return this.canDispose(workingCopy);
		}

		if (workingCopy.isDirty()) {
			await Event.toPromise(workingCopy.onDidChangeDirty);

			return this.canDispose(workingCopy);
		}

		return true;
	}

	override dispose(): void {
		super.dispose();

		this.mapResourceToPendingWorkingCopyResolve.clear();

		dispose(this.mapResourceToWorkingCopyListeners.values());
		this.mapResourceToWorkingCopyListeners.clear();
	}

}
