/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Range } from '../../../dardcorTypes';

export function computeUpdatedRange(initialRange: vscode.Range, edits: vscode.TextEdit[]) {
	let range: vscode.Range = initialRange;
	for (const edit of edits) {
		const editStart = edit.range.start;
		const editEnd = edit.range.end;
		const rangeStart = range.start;
		const rangeEnd = range.end;
		const numnberOfLinesReplaced = edit.newText.split('\n').length;
		const numberOfLinesAdded = numnberOfLinesReplaced - (editEnd.line - editStart.line) - 1;

		let startLine = rangeStart.line;
		let endLine = rangeStart.line;
		if (editEnd.isBefore(rangeStart)) {
			startLine = rangeStart.line + numberOfLinesAdded;
			endLine = rangeEnd.line + numberOfLinesAdded;
		}
		else if (editStart.isBefore(rangeStart) && editEnd.isAfterOrEqual(rangeStart) && editEnd.isBeforeOrEqual(rangeEnd)) {
			startLine = editStart.line;
			endLine = rangeEnd.line + numberOfLinesAdded;
		}
		else if (editStart.isAfterOrEqual(rangeStart) && editStart.isBeforeOrEqual(rangeEnd) && editEnd.isAfter(rangeEnd)) {
			startLine = rangeStart.line;
			endLine = editEnd.line + numberOfLinesAdded;
		}
		else if (editStart.isAfter(rangeEnd)) {
			startLine = rangeStart.line;
			endLine = rangeEnd.line;
		}
		else if (range.contains(edit.range)) {
			startLine = rangeStart.line;
			endLine = rangeEnd.line + numberOfLinesAdded;
		}
		else if (edit.range.contains(range)) {
			startLine = editStart.line;
			endLine = editStart.line + numnberOfLinesReplaced - 1;
		}
		range = new Range(startLine, 0, endLine, 0);
	}
	return range;
}
