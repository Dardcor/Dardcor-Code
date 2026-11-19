/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { IWorkspaceInfo } from './workspaceInfo';







export enum IsolationMode {
	Workspace = 'workspace',
	Worktree = 'worktree',
}


export interface InitializeFolderRepositoryOptions {
	readonly branch?: string;
	readonly folder: vscode.Uri | undefined;
	readonly isolation?: IsolationMode;
	readonly stream: vscode.ChatResponseStream;
	readonly toolInvocationToken: vscode.ChatParticipantToolToken;
	readonly newBranch?: Promise<string | undefined>;
}

export interface FolderRepositoryInfo extends IWorkspaceInfo {
	readonly trusted: boolean | undefined;

	readonly cancelled?: boolean;
}

export interface GetFolderRepositoryOptions {
	readonly promptForTrust: true;

	readonly stream: vscode.ChatResponseStream;
}

export interface FolderRepositoryMRUEntry {
	readonly folder: vscode.Uri;

	readonly repository: vscode.Uri | undefined;

	readonly lastAccessed: number;
}

export const IFolderRepositoryManager = createServiceIdentifier<IFolderRepositoryManager>('IFolderRepositoryManager');

export interface IFolderRepositoryManager {
	readonly _serviceBrand: undefined;

	setNewSessionFolder(sessionId: string, folderUri: vscode.Uri): void;

	deleteNewSessionFolder(sessionId: string): void;

	getFolderRepository(
		sessionId: string,
		options: GetFolderRepositoryOptions | undefined,
		token: vscode.CancellationToken
	): Promise<FolderRepositoryInfo>;

	initializeFolderRepository(
		sessionId: string | undefined,
		options: InitializeFolderRepositoryOptions,
		token: vscode.CancellationToken
	): Promise<FolderRepositoryInfo>;

	initializeMultiRootFolderRepositories(
		sessionId: string,
		primaryFolder: vscode.Uri,
		additionalFolders: vscode.Uri[],
		options: InitializeFolderRepositoryOptions,
		token: vscode.CancellationToken
	): Promise<{ primary: FolderRepositoryInfo; additional: FolderRepositoryInfo[] }>;

	getRepositoryInfo(
		folder: vscode.Uri,
		token: vscode.CancellationToken
	): Promise<{ repository: vscode.Uri | undefined; headBranchName: string | undefined }>;

	getFolderMRU(): Promise<FolderRepositoryMRUEntry[]>;
}

export interface IChatFolderMruService {
	readonly _serviceBrand: undefined;
	getRecentlyUsedFolders(token: vscode.CancellationToken): Promise<FolderRepositoryMRUEntry[]>;
	deleteRecentlyUsedFolder(folder: vscode.Uri): Promise<void>;
}
export const IChatFolderMruService = createServiceIdentifier<IChatFolderMruService>('IChatFolderMruService');
