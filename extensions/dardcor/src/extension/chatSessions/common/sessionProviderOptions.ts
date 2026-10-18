/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { FolderRepositoryMRUEntry } from './folderRepositoryManager';

export function getSelectedOption(
	groups: readonly vscode.ChatSessionProviderOptionGroup[],
	groupId: string,
): vscode.ChatSessionProviderOptionItem | undefined {
	return groups.find(group => group.id === groupId)?.selected;
}

export function toWorkspaceFolderOptionItem(folder: vscode.Uri, name: string): vscode.ChatSessionProviderOptionItem {
	return {
		id: folder.fsPath,
		name,
		icon: new vscode.ThemeIcon('folder'),
	};
}

export function folderMRUToChatProviderOptions(items: readonly FolderRepositoryMRUEntry[]): vscode.ChatSessionProviderOptionItem[] {
	return items.map(item => item.repository
		? {
			id: item.folder.fsPath,
			name: item.folder.path.split('/').pop() ?? item.folder.toString(),
			icon: new vscode.ThemeIcon('repo'),
		}
		: toWorkspaceFolderOptionItem(item.folder, item.folder.path.split('/').pop() ?? item.folder.toString()));
}
