/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IWorkspaceService } from './workspaceService';

export class WorkingDirectory {

	constructor(
		private readonly _uri: URI | undefined,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
	) { }

	get uri(): URI | undefined {
		return this._uri;
	}

	get hasExplicitWorkingDirectory(): boolean {
		return !!this._uri;
	}

	getFolder(resource: URI): URI | undefined {
		if (this._uri) {
			return extUriBiasedIgnorePathCase.isEqualOrParent(resource, this._uri)
				? this._uri
				: undefined;
		}
		return this._workspaceService.getWorkspaceFolder(resource);
	}

	getFolders(): URI[] {
		if (this._uri) {
			return [this._uri];
		}
		return this._workspaceService.getWorkspaceFolders();
	}

	getFolderName(folder: URI): string {
		if (this._uri) {
			return basename(folder);
		}
		return this._workspaceService.getWorkspaceFolderName(folder);
	}
}
