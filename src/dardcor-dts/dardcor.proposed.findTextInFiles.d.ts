/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface FindTextInFilesOptions {
		include?: GlobPattern;

		exclude?: GlobPattern;

		useDefaultExcludes?: boolean;

		maxResults?: number;

		useIgnoreFiles?: boolean;

		/**
		 * Whether global files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useGlobalIgnoreFiles"`.
		 */
		useGlobalIgnoreFiles?: boolean;

		useParentIgnoreFiles?: boolean;

		followSymlinks?: boolean;

		encoding?: string;

		previewOptions?: TextSearchPreviewOptions;

		beforeContext?: number;

		afterContext?: number;
	}

	export namespace workspace {
		export function findTextInFiles(query: TextSearchQuery, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<TextSearchComplete>;

		export function findTextInFiles(query: TextSearchQuery, options: FindTextInFilesOptions, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<TextSearchComplete>;
	}
}
