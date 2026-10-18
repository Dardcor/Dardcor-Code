/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/path.js';
import { isEqual, isEqualOrParent, normalizePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

export function getWorktreesRoot(repositoryRoot: URI): URI {
	return URI.joinPath(repositoryRoot, '..', `${basename(repositoryRoot.fsPath)}.worktrees`);
}

export function isWorktreeUnderRepository(candidate: URI, repositoryRoot: URI): boolean {
	const worktreesRoot = normalizePath(getWorktreesRoot(repositoryRoot));
	const normalizedCandidate = normalizePath(candidate);
	return isEqualOrParent(normalizedCandidate, worktreesRoot) && !isEqual(normalizedCandidate, worktreesRoot);
}
