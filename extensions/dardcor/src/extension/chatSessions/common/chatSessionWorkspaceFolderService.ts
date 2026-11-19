/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { RepositoryProperties, WorkspaceFolderEntry } from './chatSessionMetadataStore';
import { ChatSessionWorktreeFile } from './chatSessionWorktreeService';

export const IChatSessionWorkspaceFolderService = createServiceIdentifier<IChatSessionWorkspaceFolderService>('IChatSessionWorkspaceFolderService');

export interface IChatSessionWorkspaceFolderService {
	readonly _serviceBrand: undefined;
	onDidChangeWorkspaceFolderChanges: vscode.Event<{ sessionId: string }>;
	deleteTrackedWorkspaceFolder(sessionId: string): Promise<void>;
	trackSessionWorkspaceFolder(sessionId: string, workspaceFolderUri: string, repositoryProperties?: RepositoryProperties): Promise<void>;

	getSessionWorkspaceFolder(sessionId: string): Promise<vscode.Uri | undefined>;

	getSessionWorkspaceFolderEntry(sessionId: string): Promise<WorkspaceFolderEntry | undefined>;

	getRepositoryProperties(sessionId: string): Promise<RepositoryProperties | undefined>;

	setRepositoryProperties(sessionId: string, repositoryProperties: RepositoryProperties): Promise<void>;

	handleRequestCompleted(sessionId: string): Promise<void>;

	refreshWorkspaceChanges(sessionId: string): Promise<void>;

	getWorkspaceChanges(sessionId: string): Promise<readonly ChatSessionWorktreeFile[] | undefined>;

	clearWorkspaceChanges(sessionId: string): string[];

	clearWorkspaceChanges(folderUri: vscode.Uri): string[];

	hasCachedChanges(sessionId: string): Promise<boolean>;

	getAssociatedSessions(folderUri: vscode.Uri): string[];
}
