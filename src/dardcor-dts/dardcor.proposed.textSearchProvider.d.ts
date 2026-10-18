/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TextSearchQuery {
		pattern: string;

		isMultiline?: boolean;

		isRegExp?: boolean;

		isCaseSensitive?: boolean;

		isWordMatch?: boolean;
	}

	export type GlobString = string;

	export interface SearchOptions {
		folder: Uri;

		includes: GlobString[];

		excludes: GlobString[];

		useIgnoreFiles: boolean;

		followSymlinks: boolean;





		useGlobalIgnoreFiles: boolean;

		useParentIgnoreFiles: boolean;
	}

	export interface TextSearchPreviewOptions {
		matchLines: number;

		charsPerLine: number;
	}

	export interface TextSearchOptions extends SearchOptions {
		maxResults: number;

		previewOptions?: TextSearchPreviewOptions;

		maxFileSize?: number;

		encoding?: string;

		beforeContext?: number;

		afterContext?: number;
	}

	export enum TextSearchCompleteMessageType {
		Information = 1,
		Warning = 2,
	}

	export interface TextSearchCompleteMessage {
		text: string;
		trusted?: boolean;
		type: TextSearchCompleteMessageType;
	}

	export interface TextSearchComplete {
		limitHit?: boolean;

		message?: TextSearchCompleteMessage | TextSearchCompleteMessage[];
	}

	export interface TextSearchMatchPreview {
		text: string;

		matches: Range | Range[];
	}

	export interface TextSearchMatch {
		uri: Uri;

		ranges: Range | Range[];

		preview: TextSearchMatchPreview;
	}

	export interface TextSearchContext {
		uri: Uri;

		text: string;

		lineNumber: number;
	}

	export type TextSearchResult = TextSearchMatch | TextSearchContext;

	export interface TextSearchProvider {
		provideTextSearchResults(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, token: CancellationToken): ProviderResult<TextSearchComplete>;
	}

	export namespace workspace {
		export function registerTextSearchProvider(scheme: string, provider: TextSearchProvider): Disposable;
	}
}
