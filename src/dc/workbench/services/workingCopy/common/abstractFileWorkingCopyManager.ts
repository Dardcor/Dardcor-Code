/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { Promises } from '../../../../base/common/async.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkingCopyBackupService } from './workingCopyBackup.js';
import { IFileWorkingCopy, IFileWorkingCopyModel } from './fileWorkingCopy.js';

export interface IBaseFileWorkingCopyManager<M extends IFileWorkingCopyModel, W extends IFileWorkingCopy<M>> extends IDisposable {

	readonly onDidCreate: Event<W>;

	readonly workingCopies: readonly W[];

	get(resource: URI): W | undefined;

	destroy(): Promise<void>;
}

export abstract class BaseFileWorkingCopyManager<M extends IFileWorkingCopyModel, W extends IFileWorkingCopy<M>> extends Disposable implements IBaseFileWorkingCopyManager<M, W> {

	private readonly _onDidCreate = this._register(new Emitter<W>());
	readonly onDidCreate = this._onDidCreate.event;

	private readonly mapResourceToWorkingCopy = new ResourceMap<W>();
	private readonly mapResourceToDisposeListener = new ResourceMap<IDisposable>();

	constructor(
		@IFileService protected readonly fileService: IFileService,
		@ILogService protected readonly logService: ILogService,
		@IWorkingCopyBackupService protected readonly workingCopyBackupService: IWorkingCopyBackupService
	) {
		super();
	}

	protected has(resource: URI): boolean {
		return this.mapResourceToWorkingCopy.has(resource);
	}

	protected add(resource: URI, workingCopy: W): void {
		const knownWorkingCopy = this.get(resource);
		if (knownWorkingCopy === workingCopy) {
			return;
		}

		this.mapResourceToWorkingCopy.set(resource, workingCopy);

		this.mapResourceToDisposeListener.get(resource)?.dispose();
		this.mapResourceToDisposeListener.set(resource, workingCopy.onWillDispose(() => this.remove(resource)));

		this._onDidCreate.fire(workingCopy);
	}

	protected remove(resource: URI): boolean {

		const disposeListener = this.mapResourceToDisposeListener.get(resource);
		if (disposeListener) {
			dispose(disposeListener);
			this.mapResourceToDisposeListener.delete(resource);
		}

		return this.mapResourceToWorkingCopy.delete(resource);
	}


	get workingCopies(): W[] {
		return [...this.mapResourceToWorkingCopy.values()];
	}

	get(resource: URI): W | undefined {
		return this.mapResourceToWorkingCopy.get(resource);
	}



	override dispose(): void {
		super.dispose();

		this.mapResourceToWorkingCopy.clear();

		dispose(this.mapResourceToDisposeListener.values());
		this.mapResourceToDisposeListener.clear();
	}

	async destroy(): Promise<void> {

		try {
			await Promises.settled(this.workingCopies.map(async workingCopy => {
				if (workingCopy.isDirty()) {
					await this.saveWithFallback(workingCopy);
				}
			}));
		} catch (error) {
			this.logService.error(error);
		}

		dispose(this.mapResourceToWorkingCopy.values());

		this.dispose();
	}

	private async saveWithFallback(workingCopy: W): Promise<void> {

		let saveSuccess = false;
		try {
			saveSuccess = await workingCopy.save();
		} catch (error) {
		}

		if (!saveSuccess || workingCopy.isDirty()) {
			const backup = await this.workingCopyBackupService.resolve(workingCopy);
			if (backup) {
				await this.fileService.writeFile(workingCopy.resource, backup.value, { unlock: true });
			}
		}
	}

}
