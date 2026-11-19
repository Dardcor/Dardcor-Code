/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export class WorkingDirectory {

	constructor(
		private readonly _workspaceContextService: IWorkspaceContextService,
		private readonly _uri?: URI,
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
		return this._workspaceContextService.getWorkspaceFolder(resource)?.uri;
	}

	resolveRelativePath(filePath: string): URI | undefined {
		const base = this._uri ?? this._workspaceContextService.getWorkspace().folders.at(0)?.uri;
		if (!base) {
			return undefined;
		}
		const resolved = joinPath(base, filePath);
		if (!extUriBiasedIgnorePathCase.isEqualOrParent(resolved, base)) {
			return undefined;
		}
		return resolved;
	}
}
