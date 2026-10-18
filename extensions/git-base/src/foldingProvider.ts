/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class GitCommitFoldingProvider implements vscode.FoldingRangeProvider {

	provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.FoldingRange[]> {
		const ranges: vscode.FoldingRange[] = [];

		let commentBlockStart: number | undefined;
		let currentDiffStart: number | undefined;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);
			const lineText = line.text;

			if (lineText.startsWith('#')) {
				if (currentDiffStart !== undefined) {
					if (i - currentDiffStart > 1) {
						ranges.push(new vscode.FoldingRange(currentDiffStart, i - 1));
					}
					currentDiffStart = undefined;
				}

				if (commentBlockStart === undefined) {
					commentBlockStart = i;
				}
			} else {
				if (commentBlockStart !== undefined) {
					if (i - commentBlockStart > 1) {
						ranges.push(new vscode.FoldingRange(
							commentBlockStart,
							i - 1,
							vscode.FoldingRangeKind.Comment
						));
					}
					commentBlockStart = undefined;
				}
			}

			if (lineText.startsWith('diff --git ')) {
				if (currentDiffStart !== undefined) {
					if (i - currentDiffStart > 1) {
						ranges.push(new vscode.FoldingRange(currentDiffStart, i - 1));
					}
				}
				currentDiffStart = i;
			}
		}


		if (commentBlockStart !== undefined) {
			if (document.lineCount - commentBlockStart > 1) {
				ranges.push(new vscode.FoldingRange(
					commentBlockStart,
					document.lineCount - 1,
					vscode.FoldingRangeKind.Comment
				));
			}
		}

		if (currentDiffStart !== undefined) {
			if (document.lineCount - currentDiffStart > 1) {
				ranges.push(new vscode.FoldingRange(
					currentDiffStart,
					document.lineCount - 1
				));
			}
		}

		return ranges;
	}
}
