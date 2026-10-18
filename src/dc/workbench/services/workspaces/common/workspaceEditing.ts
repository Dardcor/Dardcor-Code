/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceFolderCreationData } from '../../../../platform/workspaces/common/workspaces.js';
import { URI } from '../../../../base/common/uri.js';
import { IAnyWorkspaceIdentifier, IWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';

export const IWorkspaceEditingService = createDecorator<IWorkspaceEditingService>('workspaceEditingService');

export interface IDidEnterWorkspaceEvent {
	readonly oldWorkspace: IAnyWorkspaceIdentifier;
	readonly newWorkspace: IAnyWorkspaceIdentifier;

	join(promise: Promise<void>): void;
}

export interface IWorkspaceEditingService {

	readonly _serviceBrand: undefined;

	readonly onDidEnterWorkspace: Event<IDidEnterWorkspaceEvent>;

	addFolders(folders: IWorkspaceFolderCreationData[], donotNotifyError?: boolean): Promise<void>;

	removeFolders(folders: URI[], donotNotifyError?: boolean): Promise<void>;

	updateFolders(index: number, deleteCount?: number, foldersToAdd?: IWorkspaceFolderCreationData[], donotNotifyError?: boolean): Promise<void>;

	enterWorkspace(path: URI): Promise<void>;

	createAndEnterWorkspace(folders: IWorkspaceFolderCreationData[], path?: URI): Promise<void>;

	saveAndEnterWorkspace(path: URI): Promise<void>;

	copyWorkspaceSettings(toWorkspace: IWorkspaceIdentifier): Promise<void>;

	pickNewWorkspacePath(): Promise<URI | undefined>;
}
