/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { FileChangesEvent, FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { ISaveOptions, IRevertOptions } from '../../../common/editor.js';
import { IWorkingCopy, IWorkingCopyBackup, IWorkingCopySaveEvent, WorkingCopyCapabilities } from './workingCopy.js';

export interface IResourceWorkingCopy extends IWorkingCopy, IDisposable {

	readonly onDidChangeOrphaned: Event<void>;

	isOrphaned(): boolean;

	readonly onWillDispose: Event<void>;

	isDisposed(): boolean;
}

export abstract class ResourceWorkingCopy extends Disposable implements IResourceWorkingCopy {

	constructor(
		readonly resource: URI,
		@IFileService protected readonly fileService: IFileService
	) {
		super();

		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));
	}


	private readonly _onDidChangeOrphaned = this._register(new Emitter<void>());
	readonly onDidChangeOrphaned = this._onDidChangeOrphaned.event;

	private orphaned = false;

	isOrphaned(): boolean {
		return this.orphaned;
	}

	private async onDidFilesChange(e: FileChangesEvent): Promise<void> {
		let fileEventImpactsUs = false;
		let newInOrphanModeGuess: boolean | undefined;

		if (this.orphaned) {
			const fileWorkingCopyResourceAdded = e.contains(this.resource, FileChangeType.ADDED);
			if (fileWorkingCopyResourceAdded) {
				newInOrphanModeGuess = false;
				fileEventImpactsUs = true;
			}
		}

		else {
			const fileWorkingCopyResourceDeleted = e.contains(this.resource, FileChangeType.DELETED);
			if (fileWorkingCopyResourceDeleted) {
				newInOrphanModeGuess = true;
				fileEventImpactsUs = true;
			}
		}

		if (fileEventImpactsUs && this.orphaned !== newInOrphanModeGuess) {
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

			if (this.orphaned !== newInOrphanModeValidated && !this.isDisposed()) {
				this.setOrphaned(newInOrphanModeValidated);
			}
		}
	}

	protected setOrphaned(orphaned: boolean): void {
		if (this.orphaned !== orphaned) {
			this.orphaned = orphaned;

			this._onDidChangeOrphaned.fire();
		}
	}




	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;

	isDisposed(): boolean {
		return this._store.isDisposed;
	}

	override dispose(): void {

		this.orphaned = false;

		this._onWillDispose.fire();

		super.dispose();
	}



	isModified(): boolean {
		return this.isDirty();
	}



	abstract typeId: string;
	abstract name: string;
	abstract capabilities: WorkingCopyCapabilities;

	abstract onDidChangeDirty: Event<void>;
	abstract onDidChangeContent: Event<void>;
	abstract onDidSave: Event<IWorkingCopySaveEvent>;

	abstract isDirty(): boolean;

	abstract backup(token: CancellationToken): Promise<IWorkingCopyBackup>;
	abstract save(options?: ISaveOptions): Promise<boolean>;
	abstract revert(options?: IRevertOptions): Promise<void>;

}
