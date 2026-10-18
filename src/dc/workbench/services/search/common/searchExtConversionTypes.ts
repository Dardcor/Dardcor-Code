/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asArray, coalesce } from '../../../../base/common/arrays.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IProgress } from '../../../../platform/progress/common/progress.js';
import { DEFAULT_TEXT_SEARCH_PREVIEW_OPTIONS } from './search.js';
import { Range, FileSearchProvider2, FileSearchProviderOptions, ProviderResult, TextSearchComplete2, TextSearchContext2, TextSearchMatch2, TextSearchProvider2, TextSearchProviderOptions, TextSearchQuery2, TextSearchResult2, TextSearchCompleteMessage } from './searchExtTypes.js';


export interface RelativePattern {

	base: string;

	pattern: string;
}

export type GlobPattern = string | RelativePattern;

export interface TextSearchQuery {
	pattern: string;

	isMultiline?: boolean;

	isRegExp?: boolean;

	isCaseSensitive?: boolean;

	isWordMatch?: boolean;
}

export type GlobString = string;

export interface SearchOptions {
	folder: URI;

	includes: GlobString[];

	excludes: GlobString[];

	useIgnoreFiles: boolean;

	followSymlinks: boolean;

	/**
	 * Whether global files that exclude files, like .gitignore, should be respected.
	 * See the vscode setting `"search.useGlobalIgnoreFiles"`.
	 */
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
export interface AITextSearchOptions extends SearchOptions {
	maxResults: number;

	previewOptions?: TextSearchPreviewOptions;

	maxFileSize?: number;

	beforeContext?: number;

	afterContext?: number;
}

export interface TextSearchComplete {
	limitHit?: boolean;

	message?: TextSearchCompleteMessage | TextSearchCompleteMessage[];
}

export interface FileSearchQuery {
	pattern: string;
}

export interface FileSearchOptions extends SearchOptions {
	maxResults?: number;

	session?: CancellationToken;
}

export interface TextSearchMatchPreview {
	text: string;

	matches: Range | Range[];
}

export interface TextSearchMatch {
	uri: URI;

	ranges: Range | Range[];

	preview: TextSearchMatchPreview;
}

function isTextSearchMatch(object: any): object is TextSearchMatch {
	return 'uri' in object && 'ranges' in object && 'preview' in object;
}

export interface TextSearchContext {
	uri: URI;

	text: string;

	lineNumber: number;
}

export type TextSearchResult = TextSearchMatch | TextSearchContext;

export interface FileSearchProvider {
	provideFileSearchResults(query: FileSearchQuery, options: FileSearchOptions, token: CancellationToken): ProviderResult<URI[]>;
}

export interface TextSearchProvider {
	provideTextSearchResults(query: TextSearchQuery, options: TextSearchOptions, progress: IProgress<TextSearchResult>, token: CancellationToken): ProviderResult<TextSearchComplete>;
}
export interface FindTextInFilesOptions {
	include?: GlobPattern;

	exclude?: GlobPattern | null;

	maxResults?: number;

	useIgnoreFiles?: boolean;

	/**
	 * Whether global files that exclude files, like .gitignore, should be respected.
	 * See the vscode setting `"search.useGlobalIgnoreFiles"`.
	 */
	useGlobalIgnoreFiles?: boolean;

	useParentIgnoreFiles: boolean;

	followSymlinks?: boolean;

	encoding?: string;

	previewOptions?: TextSearchPreviewOptions;

	beforeContext?: number;

	afterContext?: number;
}

function newToOldFileProviderOptions(options: FileSearchProviderOptions): FileSearchOptions[] {
	return options.folderOptions.map(folderOption => ({
		folder: folderOption.folder,
		excludes: folderOption.excludes.map(e => typeof (e) === 'string' ? e : e.pattern),
		includes: folderOption.includes,
		useGlobalIgnoreFiles: folderOption.useIgnoreFiles.global,
		useIgnoreFiles: folderOption.useIgnoreFiles.local,
		useParentIgnoreFiles: folderOption.useIgnoreFiles.parent,
		followSymlinks: folderOption.followSymlinks,
		maxResults: options.maxResults,
		session: <CancellationToken | undefined>options.session
	} satisfies FileSearchOptions));
}

export class OldFileSearchProviderConverter implements FileSearchProvider2 {
	constructor(private provider: FileSearchProvider) { }

	provideFileSearchResults(pattern: string, options: FileSearchProviderOptions, token: CancellationToken): ProviderResult<URI[]> {
		const getResult = async () => {
			const newOpts = newToOldFileProviderOptions(options);
			return Promise.all(newOpts.map(
				o => this.provider.provideFileSearchResults({ pattern }, o, token)));
		};
		return getResult().then(e => coalesce(e).flat());
	}
}

function newToOldTextProviderOptions(options: TextSearchProviderOptions): TextSearchOptions[] {
	return options.folderOptions.map(folderOption => ({
		folder: folderOption.folder,
		excludes: folderOption.excludes.map(e => typeof (e) === 'string' ? e : e.pattern),
		includes: folderOption.includes,
		useGlobalIgnoreFiles: folderOption.useIgnoreFiles.global,
		useIgnoreFiles: folderOption.useIgnoreFiles.local,
		useParentIgnoreFiles: folderOption.useIgnoreFiles.parent,
		followSymlinks: folderOption.followSymlinks,
		maxResults: options.maxResults,
		previewOptions: newToOldPreviewOptions(options.previewOptions),
		maxFileSize: options.maxFileSize,
		encoding: folderOption.encoding,
		afterContext: options.surroundingContext,
		beforeContext: options.surroundingContext
	} satisfies TextSearchOptions));
}

export function newToOldPreviewOptions(options: {
	matchLines?: number;
	charsPerLine?: number;
} | undefined
): {
	matchLines: number;
	charsPerLine: number;
} {
	return {
		matchLines: options?.matchLines ?? DEFAULT_TEXT_SEARCH_PREVIEW_OPTIONS.matchLines,
		charsPerLine: options?.charsPerLine ?? DEFAULT_TEXT_SEARCH_PREVIEW_OPTIONS.charsPerLine
	};
}

export function oldToNewTextSearchResult(result: TextSearchResult): TextSearchResult2 {
	if (isTextSearchMatch(result)) {
		const ranges = asArray(result.ranges).map((r, i) => {
			const previewArr = asArray(result.preview.matches);
			const matchingPreviewRange = previewArr[i];
			return { sourceRange: r, previewRange: matchingPreviewRange };
		});
		return new TextSearchMatch2(result.uri, ranges, result.preview.text);
	} else {
		return new TextSearchContext2(result.uri, result.text, result.lineNumber);
	}
}

export class OldTextSearchProviderConverter implements TextSearchProvider2 {
	constructor(private provider: TextSearchProvider) { }

	provideTextSearchResults(query: TextSearchQuery2, options: TextSearchProviderOptions, progress: IProgress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2> {

		const progressShim = (oldResult: TextSearchResult) => {
			if (!validateProviderResult(oldResult)) {
				return;
			}
			progress.report(oldToNewTextSearchResult(oldResult));
		};

		const getResult = async () => {
			return coalesce(await Promise.all(
				newToOldTextProviderOptions(options).map(
					o => this.provider.provideTextSearchResults(query, o, { report: (e) => progressShim(e) }, token))))
				.reduce(
					(prev, cur) => ({ limitHit: prev.limitHit || cur.limitHit }),
					{ limitHit: false }
				);
		};
		const oldResult = getResult();
		return oldResult.then((e) => {
			return {
				limitHit: e.limitHit,
				message: coalesce(asArray(e.message))
			} satisfies TextSearchComplete2;
		});
	}
}

function validateProviderResult(result: TextSearchResult): boolean {
	if (extensionResultIsMatch(result)) {
		if (Array.isArray(result.ranges)) {
			if (!Array.isArray(result.preview.matches)) {
				console.warn('INVALID - A text search provider match\'s`ranges` and`matches` properties must have the same type.');
				return false;
			}

			if ((<Range[]>result.preview.matches).length !== result.ranges.length) {
				console.warn('INVALID - A text search provider match\'s`ranges` and`matches` properties must have the same length.');
				return false;
			}
		} else {
			if (Array.isArray(result.preview.matches)) {
				console.warn('INVALID - A text search provider match\'s`ranges` and`matches` properties must have the same length.');
				return false;
			}
		}
	}

	return true;
}

export function extensionResultIsMatch(data: TextSearchResult): data is TextSearchMatch {
	return !!(<TextSearchMatch>data).preview;
}
