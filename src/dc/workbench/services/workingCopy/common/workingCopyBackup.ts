/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { VSBufferReadable, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IWorkingCopyBackupMeta, IWorkingCopyIdentifier } from './workingCopy.js';

export const IWorkingCopyBackupService = createDecorator<IWorkingCopyBackupService>('workingCopyBackupService');

export interface IResolvedWorkingCopyBackup<T extends IWorkingCopyBackupMeta> {

	readonly value: VSBufferReadableStream;

	readonly meta?: T;
}

export interface IWorkingCopyBackupService {

	readonly _serviceBrand: undefined;

	hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean;

	getBackups(): Promise<readonly IWorkingCopyIdentifier[]>;

	resolve<T extends IWorkingCopyBackupMeta>(identifier: IWorkingCopyIdentifier): Promise<IResolvedWorkingCopyBackup<T> | undefined>;

	backup(identifier: IWorkingCopyIdentifier, content?: VSBufferReadable | VSBufferReadableStream, versionId?: number, meta?: IWorkingCopyBackupMeta, token?: CancellationToken): Promise<void>;

	discardBackup(identifier: IWorkingCopyIdentifier, token?: CancellationToken): Promise<void>;

	discardBackups(filter?: { except: IWorkingCopyIdentifier[] }): Promise<void>;
}
