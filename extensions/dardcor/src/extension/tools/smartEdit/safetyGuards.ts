/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isDisproportionateMatch(matchedSpan: string, oldString: string): boolean {
	const oldLines = oldString.split('\n').length;
	const matchLines = matchedSpan.split('\n').length;

	if (matchLines >= Math.max(oldLines + 4, oldLines * 2)) {
		return true;
	}

	if (oldLines === 1) {
		return false;
	}

	const oldTrimmedLen = oldString.trim().length;
	const matchTrimmedLen = matchedSpan.trim().length;

	return matchTrimmedLen > Math.max(oldTrimmedLen + 500, oldTrimmedLen * 4);
}
