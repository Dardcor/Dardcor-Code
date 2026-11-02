/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SearchError, SearchErrorCode } from '../common/search.js';

export const DARDCOR_MAX_SYMLINK_LOOPS = 1000;
const SYMLINK_LOOP_REGEX = /Too many levels of symbolic links|circular symlink|ELOOP/g;

export class DardcorSymlinkLoopGuard {
	private _loopCount = 0;

	public inspectStderrChunk(chunk: string): boolean {
		const matches = chunk.match(SYMLINK_LOOP_REGEX);
		if (matches) {
			this._loopCount += matches.length;
		}
		return this._loopCount >= DARDCOR_MAX_SYMLINK_LOOPS;
	}

	public get loopLimitExceeded(): boolean {
		return this._loopCount >= DARDCOR_MAX_SYMLINK_LOOPS;
	}

	public static isSymlinkLoopError(error: SearchError | undefined, stderr: string): boolean {
		return SYMLINK_LOOP_REGEX.test(stderr);
	}
}
