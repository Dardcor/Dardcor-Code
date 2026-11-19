/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { RepositoryProperties } from './chatSessionMetadataStore';
import { ChatSessionWorktreeProperties } from './chatSessionWorktreeService';

export interface IWorkspaceInfo {
	readonly folder: vscode.Uri | undefined;

	readonly repository: vscode.Uri | undefined;

	readonly repositoryProperties?: RepositoryProperties;

	readonly worktree: vscode.Uri | undefined;

	readonly worktreeProperties: ChatSessionWorktreeProperties | undefined;
}

export function getWorkingDirectory(workspaceInfo: IWorkspaceInfo): vscode.Uri | undefined {
	return workspaceInfo.worktree ?? workspaceInfo.folder ?? workspaceInfo.repository;
}

export function isIsolationEnabled(workspaceInfo: IWorkspaceInfo): boolean {
	return !!workspaceInfo.worktreeProperties;
}

export function emptyWorkspaceInfo(): IWorkspaceInfo {
	return {
		folder: undefined,
		repository: undefined,
		repositoryProperties: undefined,
		worktree: undefined,
		worktreeProperties: undefined,
	};
}

export function findOwningWorkspace(
	file: vscode.Uri,
	primaryWorkspace: IWorkspaceInfo,
	additionalWorkspaces: IWorkspaceInfo[]
): IWorkspaceInfo | undefined {
	for (const ws of [primaryWorkspace, ...additionalWorkspaces]) {
		const wd = getWorkingDirectory(ws);
		if (wd && extUriBiasedIgnorePathCase.isEqualOrParent(file, wd)) {
			return ws;
		}
		if (ws.folder && extUriBiasedIgnorePathCase.isEqualOrParent(file, ws.folder)) {
			return ws;
		}
		if (ws.worktree && ws.repository && extUriBiasedIgnorePathCase.isEqualOrParent(file, ws.repository)) {
			return ws;
		}
	}
	return undefined;
}
