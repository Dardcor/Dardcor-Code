/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEmptyWindowBackupInfo } from '../node/backup.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IFolderBackupInfo, IWorkspaceBackupInfo } from '../common/backup.js';

export const IBackupMainService = createDecorator<IBackupMainService>('backupMainService');

export interface IBackupMainService {

	readonly _serviceBrand: undefined;

	isHotExitEnabled(): boolean;

	getEmptyWindowBackups(): IEmptyWindowBackupInfo[];

	registerWorkspaceBackup(workspaceInfo: IWorkspaceBackupInfo): string;
	registerWorkspaceBackup(workspaceInfo: IWorkspaceBackupInfo, migrateFrom: string): Promise<string>;
	registerFolderBackup(folderInfo: IFolderBackupInfo): string;
	registerEmptyWindowBackup(emptyWindowInfo: IEmptyWindowBackupInfo): string;

	getDirtyWorkspaces(): Promise<Array<IWorkspaceBackupInfo | IFolderBackupInfo>>;
}
