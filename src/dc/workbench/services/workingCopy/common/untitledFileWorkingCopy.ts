/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { IWorkingCopyBackup, IWorkingCopySaveEvent, WorkingCopyCapabilities } from './workingCopy.js';
import { IFileWorkingCopy, IFileWorkingCopyModel, IFileWorkingCopyModelFactory, SnapshotContext } from './fileWorkingCopy.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ISaveOptions } from '../../../common/editor.js';
import { raceCancellation } from '../../../../base/common/async.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkingCopyBackupService } from './workingCopyBackup.js';
import { emptyStream } from '../../../../base/common/stream.js';

export interface IUntitledFileWorkingCopyModelFactory<M extends IUntitledFileWorkingCopyModel> extends IFileWorkingCopyModelFactory<M> { }

export interface IUntitledFileWorkingCopyModel extends IFileWorkingCopyModel {

	readonly onDidChangeContent: Event<IUntitledFileWorkingCopyModelContentChangedEvent>;
}

export interface IUntitledFileWorkingCopyModelContentChangedEvent {

	readonly isInitial: boolean;
}

export interface IUntitledFileWorkingCopy<M extends IUntitledFileWorkingCopyModel> extends IFileWorkingCopy<M> {

	readonly hasAssociatedFilePath: boolean;

	isResolved(): this is IResolvedUntitledFileWorkingCopy<M>;
}

export interface IResolvedUntitledFileWorkingCopy<M extends IUntitledFileWorkingCopyModel> extends IUntitledFileWorkingCopy<M> {

	readonly model: M;
}

export interface IUntitledFileWorkingCopySaveDelegate<M extends IUntitledFileWorkingCopyModel> {

	(workingCopy: IUntitledFileWorkingCopy<M>, options?: ISaveOptions): Promise<boolean>;
}

export interface IUntitledFileWorkingCopyInitialContents {

	readonly value: VSBufferReadableStream;

	readonly markModified?: boolean;
}

export class UntitledFileWorkingCopy<M extends IUntitledFileWorkingCopyModel> extends Disposable implements IUntitledFileWorkingCopy<M> {

	readonly capabilities: WorkingCopyCapabilities;

	private _model: M | undefined = undefined;
	get model(): M | undefined { return this._model; }


	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidSave = this._register(new Emitter<IWorkingCopySaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<void>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;


	constructor(
		readonly typeId: string,
		readonly resource: URI,
		readonly name: string,
		readonly hasAssociatedFilePath: boolean,
		private readonly isScratchpad: boolean,
		private readonly initialContents: IUntitledFileWorkingCopyInitialContents | undefined,
		private readonly modelFactory: IUntitledFileWorkingCopyModelFactory<M>,
		private readonly saveDelegate: IUntitledFileWorkingCopySaveDelegate<M>,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.capabilities = this.isScratchpad ? WorkingCopyCapabilities.Untitled | WorkingCopyCapabilities.Scratchpad : WorkingCopyCapabilities.Untitled;
		this.modified = this.hasAssociatedFilePath || Boolean(this.initialContents && this.initialContents.markModified !== false);

		this._register(workingCopyService.registerWorkingCopy(this));
	}


	private modified: boolean;

	isDirty(): boolean {
		return this.modified && !this.isScratchpad;
	}

	isModified(): boolean {
		return this.modified;
	}

	private setModified(modified: boolean): void {
		if (this.modified === modified) {
			return;
		}

		this.modified = modified;
		if (!this.isScratchpad) {
			this._onDidChangeDirty.fire();
		}
	}




	async resolve(): Promise<void> {
		this.trace('resolve()');

		if (this.isResolved()) {
			this.trace('resolve() - exit (already resolved)');

			return;
		}

		let untitledContents: VSBufferReadableStream;

		const backup = await this.workingCopyBackupService.resolve(this);
		if (backup) {
			this.trace('resolve() - with backup');

			untitledContents = backup.value;
		} else if (this.initialContents?.value) {
			this.trace('resolve() - with initial contents');

			untitledContents = this.initialContents.value;
		} else {
			this.trace('resolve() - empty');

			untitledContents = emptyStream();
		}

		await this.doCreateModel(untitledContents);

		this.setModified(this.hasAssociatedFilePath || !!backup || Boolean(this.initialContents && this.initialContents.markModified !== false));

		if (!!backup || this.initialContents) {
			this._onDidChangeContent.fire();
		}
	}

	private async doCreateModel(contents: VSBufferReadableStream): Promise<void> {
		this.trace('doCreateModel()');

		this._model = this._register(await this.modelFactory.createModel(this.resource, contents, CancellationToken.None));

		this.installModelListeners(this._model);
	}

	private installModelListeners(model: M): void {

		this._register(model.onDidChangeContent(e => this.onModelContentChanged(e)));

		this._register(model.onWillDispose(() => this.dispose()));
	}

	private onModelContentChanged(e: IUntitledFileWorkingCopyModelContentChangedEvent): void {

		if (!this.hasAssociatedFilePath && e.isInitial) {
			this.setModified(false);
		}

		else {
			this.setModified(true);
		}

		this._onDidChangeContent.fire();
	}

	isResolved(): this is IResolvedUntitledFileWorkingCopy<M> {
		return !!this.model;
	}




	get backupDelay(): number | undefined {
		return this.model?.configuration?.backupDelay;
	}

	async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {
		let content: VSBufferReadableStream | undefined = undefined;

		if (this.isResolved()) {
			content = await raceCancellation(this.model.snapshot(SnapshotContext.Backup, token), token);
		} else if (this.initialContents) {
			content = this.initialContents.value;
		}

		return { content };
	}




	async save(options?: ISaveOptions): Promise<boolean> {
		this.trace('save()');

		const result = await this.saveDelegate(this, options);

		if (result) {
			this._onDidSave.fire({ reason: options?.reason, source: options?.source });
		}

		return result;
	}




	async revert(): Promise<void> {
		this.trace('revert()');

		this.setModified(false);

		this._onDidRevert.fire();

		this.dispose();
	}


	override dispose(): void {
		this.trace('dispose()');

		this._onWillDispose.fire();

		super.dispose();
	}

	private trace(msg: string): void {
		this.logService.trace(`[untitled file working copy] ${msg}`, this.resource.toString(), this.typeId);
	}
}
