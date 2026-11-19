/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { ChatSessionWorktreeProperties } from './chatSessionWorktreeService';
import type { IWorkspaceInfo } from './workspaceInfo';

export interface WorkspaceFolderEntry {
	readonly folderPath: string;
	readonly timestamp: number;
}

export interface RepositoryProperties {
	readonly repositoryPath: string;
	readonly branchName?: string;
	readonly baseBranchName?: string;
	readonly baseCommit?: string;
	readonly upstreamBranchName?: string;
	readonly mergeBaseCommit?: string;
	readonly hasGitHubRemote?: boolean;
	readonly incomingChanges?: number;
	readonly outgoingChanges?: number;
	readonly uncommittedChanges?: number;
	readonly hasGitOperationInProgress?: boolean;
}

export interface StoredModeInstructions {
	readonly uri?: string;
	readonly name: string;
	readonly content: string;
	readonly metadata?: Record<string, boolean | string | number>;
	readonly isBuiltin?: boolean;
}

export interface RequestDetails {
	readonly vscodeRequestId: string;
	dardcorRequestId?: string;
	toolIdEditMap: { [dardcorToolId: string]: string };

	agentId?: string;

	modeInstructions?: StoredModeInstructions;

	responseModelId?: string;
	isUsingAutoModel?: boolean;
	creditsUsed?: number;

	checkpointRef?: string;

	additionalCheckpointRefs?: { [folderPath: string]: string };
}

export interface ChatSessionMetadataFile {
	repositoryProperties?: RepositoryProperties;
	worktreeProperties?: ChatSessionWorktreeProperties;
	workspaceFolder?: WorkspaceFolderEntry;
	additionalWorkspaces?: {
		worktreeProperties?: ChatSessionWorktreeProperties;
		workspaceFolder?: WorkspaceFolderEntry;
	}[];
	writtenToDisc?: boolean;
	firstUserMessage?: string;
	customTitle?: string;
	origin?: 'vscode' | 'other';
	kind?: 'forked' | 'sub-session';
	parentSessionId?: string;
	archived?: boolean;
	created?: number;
	modified?: number;
}

export interface WorktreeSessionEntry {
	readonly id: string;
	readonly path: string;
	readonly created: number;
}

export const IChatSessionMetadataStore = createServiceIdentifier<IChatSessionMetadataStore>('IChatSessionMetadataStore');

export interface IChatSessionMetadataStore {
	readonly _serviceBrand: undefined;
	getMetadataFileUri(sessionId: string): vscode.Uri;
	deleteSessionMetadata(sessionId: string): Promise<void>;
	storeWorktreeInfo(sessionId: string, properties: ChatSessionWorktreeProperties): Promise<void>;
	storeWorkspaceFolderInfo(sessionId: string, entry: WorkspaceFolderEntry): Promise<void>;
	storeRepositoryProperties(sessionId: string, properties: RepositoryProperties): Promise<void>;
	getRepositoryProperties(sessionId: string): Promise<RepositoryProperties | undefined>;
	getWorktreeProperties(sessionId: string): Promise<ChatSessionWorktreeProperties | undefined>;
	getSessionWorkspaceFolder(sessionId: string): Promise<vscode.Uri | undefined>;
	getSessionWorkspaceFolderEntry(sessionId: string): Promise<WorkspaceFolderEntry | undefined>;
	getAdditionalWorkspaces(sessionId: string): Promise<IWorkspaceInfo[]>;
	setAdditionalWorkspaces(sessionId: string, workspaces: IWorkspaceInfo[]): Promise<void>;
	getSessionFirstUserMessage(sessionId: string): Promise<string | undefined>;
	setSessionFirstUserMessage(sessionId: string, message: string): Promise<void>;
	getCustomTitle(sessionId: string): Promise<string | undefined>;
	setCustomTitle(sessionId: string, title: string): Promise<void>;
	getRequestDetails(sessionId: string): Promise<RequestDetails[]>;
	updateRequestDetails(sessionId: string, details: (Partial<RequestDetails> & { vscodeRequestId: string })[]): Promise<void>;
	getSessionAgent(sessionId: string): Promise<string | undefined>;
	storeForkedSessionMetadata(sourceSessionId: string, targetSessionId: string, customTitle: string): Promise<void>;
	setSessionOrigin(sessionId: string): Promise<void>;
	getSessionOrigin(sessionId: string): Promise<'vscode' | 'other'>;
	setSessionParentId(sessionId: string, parentSessionId: string): Promise<void>;
	getSessionParentId(sessionId: string): Promise<{ parentSessionId: string; kind: 'forked' | 'sub-session' } | undefined>;
	setSessionArchived(sessionId: string, archived: boolean): Promise<void>;
	getSessionArchived(sessionId: string): Promise<boolean>;
	refresh(): Promise<void>;
	getSessionIdsForFolder(folder: vscode.Uri): string[];
	getWorktreeSessions(folder: vscode.Uri): string[];
}
