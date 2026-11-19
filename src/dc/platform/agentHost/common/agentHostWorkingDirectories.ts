/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

export function isMultiRootSession(workingDirectories: readonly string[] | undefined): boolean {
	return (workingDirectories?.length ?? 0) > 1;
}

export function findDeepestContainingWorkingDirectory(resource: URI, workingDirectories: readonly URI[]): URI | undefined {
	let deepestMatch: URI | undefined;
	for (const workingDirectory of workingDirectories) {
		if (extUriBiasedIgnorePathCase.isEqualOrParent(resource, workingDirectory) && (!deepestMatch || workingDirectory.path.length > deepestMatch.path.length)) {
			deepestMatch = workingDirectory;
		}
	}
	return deepestMatch;
}
