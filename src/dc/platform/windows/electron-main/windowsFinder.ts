/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { ICodeWindow } from '../../window/electron-main/window.js';
import { IResolvedWorkspace, ISingleFolderWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export async function findWindowOnFile(windows: ICodeWindow[], fileUri: URI, localWorkspaceResolver: (workspace: IWorkspaceIdentifier) => Promise<IResolvedWorkspace | undefined>): Promise<ICodeWindow | undefined> {

	for (const window of windows) {
		const workspace = window.openedWorkspace;
		if (isWorkspaceIdentifier(workspace)) {
			const resolvedWorkspace = await localWorkspaceResolver(workspace);

			if (resolvedWorkspace) {
				if (resolvedWorkspace.folders.some(folder => extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, folder.uri))) {
					return window;
				}
			}

			else {
				if (extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, workspace.configPath)) {
					return window;
				}
			}
		}
	}

	const singleFolderWindowsOnFilePath = windows.filter(window => isSingleFolderWorkspaceIdentifier(window.openedWorkspace) && extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, window.openedWorkspace.uri));
	if (singleFolderWindowsOnFilePath.length) {
		return singleFolderWindowsOnFilePath.sort((windowA, windowB) => -((windowA.openedWorkspace as ISingleFolderWorkspaceIdentifier).uri.path.length - (windowB.openedWorkspace as ISingleFolderWorkspaceIdentifier).uri.path.length))[0];
	}

	return undefined;
}

export function findWindowOnWorkspaceOrFolder(windows: ICodeWindow[], folderOrWorkspaceConfigUri: URI): ICodeWindow | undefined {

	for (const window of windows) {

		if (isWorkspaceIdentifier(window.openedWorkspace) && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.configPath, folderOrWorkspaceConfigUri)) {
			return window;
		}

		if (isSingleFolderWorkspaceIdentifier(window.openedWorkspace) && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.uri, folderOrWorkspaceConfigUri)) {
			return window;
		}
	}

	return undefined;
}


export function findWindowOnExtensionDevelopmentPath(windows: ICodeWindow[], extensionDevelopmentPaths: string[]): ICodeWindow | undefined {

	const matches = (uriString: string): boolean => {
		return extensionDevelopmentPaths.some(path => extUriBiasedIgnorePathCase.isEqual(URI.file(path), URI.file(uriString)));
	};

	for (const window of windows) {

		if (window.config?.extensionDevelopmentPath?.some(path => matches(path))) {
			return window;
		}
	}

	return undefined;
}
