/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface FindTextInFilesOptions2 {
		include?: GlobPattern[];

		exclude?: GlobPattern[];

		useExcludeSettings?: ExcludeSettingOptions;

		maxResults?: number;

		useIgnoreFiles?: {
			local?: boolean;
			parent?: boolean;
			/**
			 * Use global ignore files. When set to `true`, `local` in {@link FindTextInFilesOptions2.useIgnoreFiles} must also be `true`.
			 * May default to `search.useGlobalIgnoreFiles` setting if not set.
			 */
			global?: boolean;
		};

		followSymlinks?: boolean;

		caseInsensitive?: boolean;

		encoding?: string;

		previewOptions?: {
			numMatchLines?: number;

			charsPerLine?: number;
		};

		surroundingContext?: number;
	}

	export interface FindTextInFilesResponse {
		results: AsyncIterable<TextSearchResult2>;
		complete: Thenable<TextSearchComplete2>;
	}

	export namespace workspace {
		export function findTextInFiles2(query: TextSearchQuery2, options?: FindTextInFilesOptions2, token?: CancellationToken): FindTextInFilesResponse;
	}
}
