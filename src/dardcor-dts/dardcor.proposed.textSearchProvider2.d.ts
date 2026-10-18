/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TextSearchQuery2 {
		pattern: string;

		isMultiline?: boolean;

		isRegExp?: boolean;

		isCaseSensitive?: boolean;

		isWordMatch?: boolean;
	}

	export interface TextSearchProviderOptions {

		folderOptions: {
			folder: Uri;

			includes: string[];

			excludes: GlobPattern[];

			followSymlinks: boolean;

			useIgnoreFiles: {
				local: boolean;
				parent: boolean;
				/**
				 * Use global ignore files. If set, `local` in {@link TextSearchProviderFolderOptions.useIgnoreFiles} should also be `true`.
				 */
				global: boolean;
			};

			encoding: string;
		}[];

		maxResults: number;

		previewOptions: {
			matchLines: number;

			charsPerLine: number;
		};

		maxFileSize: number | undefined;

		surroundingContext: number;
	}

	export interface TextSearchComplete2 {
		limitHit?: boolean;
	}

	export class TextSearchMatch2 {
		constructor(uri: Uri, ranges: { sourceRange: Range; previewRange: Range }[], previewText: string);

		uri: Uri;

		ranges: {
			sourceRange: Range;
			previewRange: Range;
		}[];

		previewText: string;
	}

	export class TextSearchContext2 {
		constructor(uri: Uri, text: string, lineNumber: number);

		uri: Uri;

		text: string;

		lineNumber: number;
	}

	export class AISearchKeyword {
		constructor(keyword: string);

		keyword: string;
	}

	export type TextSearchResult2 = TextSearchMatch2 | TextSearchContext2;

	export type AISearchResult = TextSearchResult2 | AISearchKeyword;

	export interface TextSearchProvider2 {
		provideTextSearchResults(query: TextSearchQuery2, options: TextSearchProviderOptions, progress: Progress<AISearchResult>, token: CancellationToken): ProviderResult<TextSearchComplete2>;
	}

	export namespace workspace {
		export function registerTextSearchProvider2(scheme: string, provider: TextSearchProvider2): Disposable;
	}
}
