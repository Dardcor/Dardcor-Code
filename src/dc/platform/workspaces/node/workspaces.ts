/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { Stats } from 'fs';
import { Schemas } from '../../../base/common/network.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { originalFSPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IEmptyWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export const NON_EMPTY_WORKSPACE_ID_LENGTH = 128 / 4;


export function getWorkspaceIdentifier(configPath: URI): IWorkspaceIdentifier {

	function getWorkspaceId(): string {
		let configPathStr = configPath.scheme === Schemas.file ? originalFSPath(configPath) : configPath.toString();
		if (!isLinux) {
			configPathStr = configPathStr.toLowerCase();
		}

		return createHash('md5').update(configPathStr).digest('hex');
	}

	return {
		id: getWorkspaceId(),
		configPath
	};
}


export function getSingleFolderWorkspaceIdentifier(folderUri: URI): ISingleFolderWorkspaceIdentifier | undefined;
export function getSingleFolderWorkspaceIdentifier(folderUri: URI, folderStat: Stats): ISingleFolderWorkspaceIdentifier;
export function getSingleFolderWorkspaceIdentifier(folderUri: URI, folderStat?: Stats): ISingleFolderWorkspaceIdentifier | undefined {

	function getFolderId(): string | undefined {

		if (folderUri.scheme !== Schemas.file) {
			return createHash('md5').update(folderUri.toString()).digest('hex');
		}


		if (!folderStat) {
			return undefined;
		}

		let ctime: number | undefined;
		if (isLinux) {
			ctime = folderStat.ino;
		} else if (isMacintosh) {
			ctime = folderStat.birthtime.getTime();
		} else if (isWindows) {
			if (typeof folderStat.birthtimeMs === 'number') {
				ctime = Math.floor(folderStat.birthtimeMs);
			} else {
				ctime = folderStat.birthtime.getTime();
			}
		}

		return createHash('md5').update(folderUri.fsPath).update(ctime ? String(ctime) : '').digest('hex');
	}

	const folderId = getFolderId();
	if (typeof folderId === 'string') {
		return {
			id: folderId,
			uri: folderUri
		};
	}

	return undefined;
}


export function createEmptyWorkspaceIdentifier(): IEmptyWorkspaceIdentifier {
	return {
		id: (Date.now() + Math.round(Math.random() * 1000)).toString()
	};
}
