/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Event, AsyncEmitter, IWaitUntil } from '../../../../base/common/event.js';
import { Promises } from '../../../../base/common/async.js';
import { insert } from '../../../../base/common/arrays.js';
import { URI } from '../../../../base/common/uri.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IFileService, FileOperation, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { IWorkingCopy } from './workingCopy.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { WorkingCopyFileOperationParticipant } from './workingCopyFileOperationParticipant.js';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { SaveReason } from '../../../common/editor.js';
import { IProgress, IProgressStep } from '../../../../platform/progress/common/progress.js';
import { StoredFileWorkingCopySaveParticipant } from './storedFileWorkingCopySaveParticipant.js';
import { IStoredFileWorkingCopy, IStoredFileWorkingCopyModel } from './storedFileWorkingCopy.js';

export const IWorkingCopyFileService = createDecorator<IWorkingCopyFileService>('workingCopyFileService');

export interface SourceTargetPair {

	readonly source?: URI;

	readonly target: URI;
}

export interface IFileOperationUndoRedoInfo {

	undoRedoGroupId?: number;

	isUndoing?: boolean;
}

export interface WorkingCopyFileEvent extends IWaitUntil {

	readonly correlationId: number;

	readonly operation: FileOperation;

	readonly files: readonly SourceTargetPair[];
}

export interface IWorkingCopyFileOperationParticipant {

	participate(
		files: SourceTargetPair[],
		operation: FileOperation,
		undoInfo: IFileOperationUndoRedoInfo | undefined,
		timeout: number,
		token: CancellationToken
	): Promise<void>;
}

export interface IStoredFileWorkingCopySaveParticipantContext {
	readonly reason: SaveReason;

	readonly savedFrom?: URI;
}

export interface IStoredFileWorkingCopySaveParticipant {

	readonly ordinal?: number;

	participate(
		workingCopy: IStoredFileWorkingCopy<IStoredFileWorkingCopyModel>,
		context: IStoredFileWorkingCopySaveParticipantContext,
		progress: IProgress<IProgressStep>,
		token: CancellationToken
	): Promise<void>;
}

export interface ICreateOperation {
	resource: URI;
	overwrite?: boolean;
}

export interface ICreateFileOperation extends ICreateOperation {
	contents?: VSBuffer | VSBufferReadable | VSBufferReadableStream;
}

export interface IDeleteOperation {
	resource: URI;
	useTrash?: boolean;
	recursive?: boolean;
}

export interface IMoveOperation {
	file: Required<SourceTargetPair>;
	overwrite?: boolean;
}

export interface ICopyOperation extends IMoveOperation { }

type WorkingCopyProvider = (resourceOrFolder: URI) => IWorkingCopy[];

export interface IWorkingCopyFileService {

	readonly _serviceBrand: undefined;


	readonly onWillRunWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	readonly onDidFailWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	readonly onDidRunWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;




	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable;




	get hasSaveParticipants(): boolean;

	addSaveParticipant(participant: IStoredFileWorkingCopySaveParticipant): IDisposable;

	runSaveParticipants(workingCopy: IStoredFileWorkingCopy<IStoredFileWorkingCopyModel>, context: IStoredFileWorkingCopySaveParticipantContext, progress: IProgress<IProgressStep>, token: CancellationToken): Promise<void>;




	create(operations: ICreateFileOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	createFolder(operations: ICreateOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	move(operations: IMoveOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	copy(operations: ICopyOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	delete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void>;




	registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable;

	getDirty(resource: URI): readonly IWorkingCopy[];

}

export class WorkingCopyFileService extends Disposable implements IWorkingCopyFileService {

	declare readonly _serviceBrand: undefined;


	private readonly _onWillRunWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onWillRunWorkingCopyFileOperation = this._onWillRunWorkingCopyFileOperation.event;

	private readonly _onDidFailWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onDidFailWorkingCopyFileOperation = this._onDidFailWorkingCopyFileOperation.event;

	private readonly _onDidRunWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onDidRunWorkingCopyFileOperation = this._onDidRunWorkingCopyFileOperation.event;


	private correlationIds = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		this.fileOperationParticipants = this._register(instantiationService.createInstance(WorkingCopyFileOperationParticipant));
		this.saveParticipants = this._register(instantiationService.createInstance(StoredFileWorkingCopySaveParticipant));

		this._register(this.registerWorkingCopyProvider(resource => {
			return this.workingCopyService.workingCopies.filter(workingCopy => {
				if (this.fileService.hasProvider(resource)) {
					return this.uriIdentityService.extUri.isEqualOrParent(workingCopy.resource, resource);
				}

				return this.uriIdentityService.extUri.isEqual(workingCopy.resource, resource);
			});
		}));
	}



	create(operations: ICreateFileOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doCreateFileOrFolder(operations, true, token, undoInfo);
	}

	createFolder(operations: ICreateOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doCreateFileOrFolder(operations, false, token, undoInfo);
	}

	async doCreateFileOrFolder(operations: (ICreateFileOperation | ICreateOperation)[], isFile: boolean, token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		if (operations.length === 0) {
			return [];
		}

		if (isFile) {
			const validateCreates = await Promises.settled(operations.map(operation => this.fileService.canCreateFile(operation.resource, { overwrite: operation.overwrite })));
			const error = validateCreates.find(validateCreate => validateCreate instanceof Error);
			if (error instanceof Error) {
				throw error;
			}
		}

		const files = operations.map(operation => ({ target: operation.resource }));
		await this.runFileOperationParticipants(files, FileOperation.CREATE, undoInfo, token);

		const event = { correlationId: this.correlationIds++, operation: FileOperation.CREATE, files };
		await this._onWillRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

		let stats: IFileStatWithMetadata[];
		try {
			if (isFile) {
				stats = await Promises.settled(operations.map(operation => this.fileService.createFile(operation.resource, (operation as ICreateFileOperation).contents, { overwrite: operation.overwrite })));
			} else {
				stats = await Promises.settled(operations.map(operation => this.fileService.createFolder(operation.resource)));
			}
		} catch (error) {

			await this._onDidFailWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

			throw error;
		}

		await this._onDidRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

		return stats;
	}

	async move(operations: IMoveOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doMoveOrCopy(operations, true, token, undoInfo);
	}

	async copy(operations: ICopyOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doMoveOrCopy(operations, false, token, undoInfo);
	}

	private async doMoveOrCopy(operations: IMoveOperation[] | ICopyOperation[], move: boolean, token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		const stats: IFileStatWithMetadata[] = [];

		for (const { file: { source, target }, overwrite } of operations) {
			const validateMoveOrCopy = await (move ? this.fileService.canMove(source, target, overwrite) : this.fileService.canCopy(source, target, overwrite));
			if (validateMoveOrCopy instanceof Error) {
				throw validateMoveOrCopy;
			}
		}

		const files = operations.map(o => o.file);
		await this.runFileOperationParticipants(files, move ? FileOperation.MOVE : FileOperation.COPY, undoInfo, token);

		const event = { correlationId: this.correlationIds++, operation: move ? FileOperation.MOVE : FileOperation.COPY, files };
		await this._onWillRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

		try {
			for (const { file: { source, target }, overwrite } of operations) {
				if (!this.uriIdentityService.extUri.isEqual(source, target)) {
					const dirtyWorkingCopies = (move ? [...this.getDirty(source), ...this.getDirty(target)] : this.getDirty(target));
					await Promises.settled(dirtyWorkingCopies.map(dirtyWorkingCopy => dirtyWorkingCopy.revert({ soft: true })));
				}

				if (move) {
					stats.push(await this.fileService.move(source, target, overwrite));
				} else {
					stats.push(await this.fileService.copy(source, target, overwrite));
				}
			}
		} catch (error) {

			await this._onDidFailWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

			throw error;
		}

		await this._onDidRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

		return stats;
	}

	async delete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void> {

		for (const operation of operations) {
			const validateDelete = await this.fileService.canDelete(operation.resource, { recursive: operation.recursive, useTrash: operation.useTrash });
			if (validateDelete instanceof Error) {
				throw validateDelete;
			}
		}

		const files = operations.map(operation => ({ target: operation.resource }));
		await this.runFileOperationParticipants(files, FileOperation.DELETE, undoInfo, token);

		const event = { correlationId: this.correlationIds++, operation: FileOperation.DELETE, files };
		await this._onWillRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

		for (const operation of operations) {
			const dirtyWorkingCopies = this.getDirty(operation.resource);
			await Promises.settled(dirtyWorkingCopies.map(dirtyWorkingCopy => dirtyWorkingCopy.revert({ soft: true })));
		}

		try {
			for (const operation of operations) {
				await this.fileService.del(operation.resource, { recursive: operation.recursive, useTrash: operation.useTrash });
			}
		} catch (error) {

			await this._onDidFailWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );

			throw error;
		}

		await this._onDidRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None );
	}




	private readonly fileOperationParticipants: WorkingCopyFileOperationParticipant;

	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable {
		return this.fileOperationParticipants.addFileOperationParticipant(participant);
	}

	private runFileOperationParticipants(files: SourceTargetPair[], operation: FileOperation, undoInfo: IFileOperationUndoRedoInfo | undefined, token: CancellationToken): Promise<void> {
		return this.fileOperationParticipants.participate(files, operation, undoInfo, token);
	}



	private readonly saveParticipants: StoredFileWorkingCopySaveParticipant;

	get hasSaveParticipants(): boolean { return this.saveParticipants.length > 0; }

	addSaveParticipant(participant: IStoredFileWorkingCopySaveParticipant): IDisposable {
		return this.saveParticipants.addSaveParticipant(participant);
	}

	runSaveParticipants(workingCopy: IStoredFileWorkingCopy<IStoredFileWorkingCopyModel>, context: IStoredFileWorkingCopySaveParticipantContext, progress: IProgress<IProgressStep>, token: CancellationToken): Promise<void> {
		return this.saveParticipants.participate(workingCopy, context, progress, token);
	}




	private readonly workingCopyProviders: WorkingCopyProvider[] = [];

	registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable {
		const remove = insert(this.workingCopyProviders, provider);

		return toDisposable(remove);
	}

	getDirty(resource: URI): IWorkingCopy[] {
		const dirtyWorkingCopies = new Set<IWorkingCopy>();
		for (const provider of this.workingCopyProviders) {
			for (const workingCopy of provider(resource)) {
				if (workingCopy.isDirty()) {
					dirtyWorkingCopies.add(workingCopy);
				}
			}
		}

		return Array.from(dirtyWorkingCopies);
	}

}

registerSingleton(IWorkingCopyFileService, WorkingCopyFileService, InstantiationType.Delayed);
