/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IUntitledFileWorkingCopy, IUntitledFileWorkingCopyInitialContents, IUntitledFileWorkingCopyModel, IUntitledFileWorkingCopyModelFactory, IUntitledFileWorkingCopySaveDelegate, UntitledFileWorkingCopy } from './untitledFileWorkingCopy.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Schemas } from '../../../../base/common/network.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkingCopyBackupService } from './workingCopyBackup.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { BaseFileWorkingCopyManager, IBaseFileWorkingCopyManager } from './abstractFileWorkingCopyManager.js';
import { ResourceMap } from '../../../../base/common/map.js';

export interface IUntitledFileWorkingCopySaveEvent {

	readonly source: URI;

	readonly target: URI;
}

export interface IUntitledFileWorkingCopyManager<M extends IUntitledFileWorkingCopyModel> extends IBaseFileWorkingCopyManager<M, IUntitledFileWorkingCopy<M>> {

	readonly onDidSave: Event<IUntitledFileWorkingCopySaveEvent>;

	readonly onDidChangeDirty: Event<IUntitledFileWorkingCopy<M>>;

	readonly onWillDispose: Event<IUntitledFileWorkingCopy<M>>;

	resolve(options?: INewUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<M>>;

	resolve(options?: INewUntitledFileWorkingCopyWithAssociatedResourceOptions): Promise<IUntitledFileWorkingCopy<M>>;

	resolve(options?: INewOrExistingUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<M>>;

	notifyDidSave(source: URI, target: URI): void;
}

export interface INewUntitledFileWorkingCopyOptions {

	contents?: IUntitledFileWorkingCopyInitialContents;
}

export interface INewUntitledFileWorkingCopyWithAssociatedResourceOptions extends INewUntitledFileWorkingCopyOptions {

	associatedResource: { authority?: string; path?: string; query?: string; fragment?: string };
}

export interface INewOrExistingUntitledFileWorkingCopyOptions extends INewUntitledFileWorkingCopyOptions {

	untitledResource: URI;

	isScratchpad?: boolean;
}

type IInternalUntitledFileWorkingCopyOptions = INewUntitledFileWorkingCopyOptions & INewUntitledFileWorkingCopyWithAssociatedResourceOptions & INewOrExistingUntitledFileWorkingCopyOptions;

export class UntitledFileWorkingCopyManager<M extends IUntitledFileWorkingCopyModel> extends BaseFileWorkingCopyManager<M, IUntitledFileWorkingCopy<M>> implements IUntitledFileWorkingCopyManager<M> {


	private readonly _onDidSave = this._register(new Emitter<IUntitledFileWorkingCopySaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<IUntitledFileWorkingCopy<M>>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onWillDispose = this._register(new Emitter<IUntitledFileWorkingCopy<M>>());
	readonly onWillDispose = this._onWillDispose.event;


	private readonly mapResourceToWorkingCopyListeners = new ResourceMap<IDisposable>();

	constructor(
		private readonly workingCopyTypeId: string,
		private readonly modelFactory: IUntitledFileWorkingCopyModelFactory<M>,
		private readonly saveDelegate: IUntitledFileWorkingCopySaveDelegate<M>,
		@IFileService fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService logService: ILogService,
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super(fileService, logService, workingCopyBackupService);
	}


	resolve(options?: INewUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<M>>;
	resolve(options?: INewUntitledFileWorkingCopyWithAssociatedResourceOptions): Promise<IUntitledFileWorkingCopy<M>>;
	resolve(options?: INewOrExistingUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<M>>;
	async resolve(options?: IInternalUntitledFileWorkingCopyOptions): Promise<IUntitledFileWorkingCopy<M>> {
		const workingCopy = this.doCreateOrGet(options);
		await workingCopy.resolve();

		return workingCopy;
	}

	private doCreateOrGet(options: IInternalUntitledFileWorkingCopyOptions = Object.create(null)): IUntitledFileWorkingCopy<M> {
		const massagedOptions = this.massageOptions(options);

		if (massagedOptions.untitledResource) {
			const existingWorkingCopy = this.get(massagedOptions.untitledResource);
			if (existingWorkingCopy) {
				return existingWorkingCopy;
			}
		}

		return this.doCreate(massagedOptions);
	}

	private massageOptions(options: IInternalUntitledFileWorkingCopyOptions): IInternalUntitledFileWorkingCopyOptions {
		const massagedOptions: IInternalUntitledFileWorkingCopyOptions = Object.create(null);

		if (options.associatedResource) {
			massagedOptions.untitledResource = URI.from({
				scheme: Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		}

		else {
			if (options.untitledResource?.scheme === Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
			massagedOptions.isScratchpad = options.isScratchpad;
		}

		massagedOptions.contents = options.contents;

		return massagedOptions;
	}

	private doCreate(options: IInternalUntitledFileWorkingCopyOptions): IUntitledFileWorkingCopy<M> {

		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = URI.from({
					scheme: Schemas.untitled,
					path: options.isScratchpad ? `Scratchpad-${counter}` : `Untitled-${counter}`,
					query: this.workingCopyTypeId ?
						`typeId=${this.workingCopyTypeId}` :
						undefined
				});
				counter++;
			} while (this.has(untitledResource));
		}

		const workingCopy = new UntitledFileWorkingCopy(
			this.workingCopyTypeId,
			untitledResource,
			this.labelService.getUriBasenameLabel(untitledResource),
			!!options.associatedResource,
			!!options.isScratchpad,
			options.contents,
			this.modelFactory,
			this.saveDelegate,
			this.workingCopyService,
			this.workingCopyBackupService,
			this.logService
		);

		this.registerWorkingCopy(workingCopy);

		return workingCopy;
	}

	private registerWorkingCopy(workingCopy: IUntitledFileWorkingCopy<M>): void {

		const workingCopyListeners = new DisposableStore();
		workingCopyListeners.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(workingCopy)));
		workingCopyListeners.add(workingCopy.onWillDispose(() => this._onWillDispose.fire(workingCopy)));

		this.mapResourceToWorkingCopyListeners.set(workingCopy.resource, workingCopyListeners);

		this.add(workingCopy.resource, workingCopy);

		if (workingCopy.isDirty()) {
			this._onDidChangeDirty.fire(workingCopy);
		}
	}

	protected override remove(resource: URI): boolean {
		const removed = super.remove(resource);

		const workingCopyListener = this.mapResourceToWorkingCopyListeners.get(resource);
		if (workingCopyListener) {
			dispose(workingCopyListener);
			this.mapResourceToWorkingCopyListeners.delete(resource);
		}

		return removed;
	}



	override dispose(): void {
		super.dispose();

		dispose(this.mapResourceToWorkingCopyListeners.values());
		this.mapResourceToWorkingCopyListeners.clear();
	}


	notifyDidSave(source: URI, target: URI): void {
		this._onDidSave.fire({ source, target });
	}
}
