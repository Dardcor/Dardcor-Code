/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export namespace workspace {

		export function getTextDiff(originalDocument: TextDocument, modifiedDocument: TextDocument, options?: TextDiffOptions, token?: CancellationToken): TextDiffResponse;
	}

	export interface TextDiffOptions {
		readonly ignoreTrimWhitespace?: boolean;

		readonly maxComputationTimeMs?: number;

		readonly computeMoves?: boolean;
	}

	export interface TextDiffResponse {
		readonly changes: AsyncIterable<TextDiffChange>;

		readonly complete: Thenable<TextDiffComplete>;
	}

	export interface TextDiffComplete {
		readonly identical: boolean;

		readonly mayBeIncomplete: boolean;

		readonly moves: readonly TextDiffMove[];
	}

	export interface TextDiffChange {
		readonly originalRange: Range;

		readonly modifiedRange: Range;

		readonly innerChanges: readonly TextDiffInnerChange[] | undefined;
	}

	export interface TextDiffInnerChange {
		readonly originalRange: Range;

		readonly modifiedRange: Range;
	}

	export interface TextDiffMove {
		readonly originalRange: Range;

		readonly modifiedRange: Range;

		readonly changes: readonly TextDiffChange[];
	}
}
