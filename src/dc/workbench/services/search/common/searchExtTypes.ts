/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IProgress } from '../../../../platform/progress/common/progress.js';

export class Position {
	constructor(readonly line: number, readonly character: number) { }

	isBefore(other: Position): boolean { return false; }
	isBeforeOrEqual(other: Position): boolean { return false; }
	isAfter(other: Position): boolean { return false; }
	isAfterOrEqual(other: Position): boolean { return false; }
	isEqual(other: Position): boolean { return false; }
	compareTo(other: Position): number { return 0; }
	translate(lineDelta?: number, characterDelta?: number): Position;
	translate(change: { lineDelta?: number; characterDelta?: number }): Position;
	translate(_?: any, _2?: any): Position { return new Position(0, 0); }
	with(line?: number, character?: number): Position;
	with(change: { line?: number; character?: number }): Position;
	with(_: any): Position { return new Position(0, 0); }
}

export class Range {
	readonly start: Position;
	readonly end: Position;

	constructor(startLine: number, startCol: number, endLine: number, endCol: number) {
		this.start = new Position(startLine, startCol);
		this.end = new Position(endLine, endCol);
	}

	isEmpty = false;
	isSingleLine = false;
	contains(positionOrRange: Position | Range): boolean { return false; }
	isEqual(other: Range): boolean { return false; }
	intersection(range: Range): Range | undefined { return undefined; }
	union(other: Range): Range { return new Range(0, 0, 0, 0); }

	with(start?: Position, end?: Position): Range;
	with(change: { start?: Position; end?: Position }): Range;
	with(_: any): Range { return new Range(0, 0, 0, 0); }
}

export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

export interface RelativePattern {

	baseUri: URI;

	pattern: string;
}

export type GlobPattern = string | RelativePattern;

export interface TextSearchQuery2 {
	pattern: string;

	isMultiline?: boolean;

	isRegExp?: boolean;

	isCaseSensitive?: boolean;

	isWordMatch?: boolean;
}


export interface TextSearchProviderFolderOptions {
	folder: URI;

	includes: string[];

	excludes: GlobPattern[];

	ignoreGlobCase?: boolean;

	followSymlinks: boolean;

	useIgnoreFiles: {
		local: boolean;
		parent: boolean;



		global: boolean;
	};

	encoding: string;
}

export interface TextSearchProviderOptions {

	folderOptions: TextSearchProviderFolderOptions[];

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

export interface FileSearchProviderFolderOptions {
	folder: URI;

	includes: string[];

	excludes: GlobPattern[];

	followSymlinks: boolean;

	useIgnoreFiles: {
		local: boolean;
		parent: boolean;



		global: boolean;
	};
}

export interface FileSearchProviderOptions {
	folderOptions: FileSearchProviderFolderOptions[];

	session: unknown;

	maxResults: number;
}

export class TextSearchMatch2 {
	constructor(
		public uri: URI,
		public ranges: { sourceRange: Range; previewRange: Range }[],
		public previewText: string) { }

}

export class TextSearchContext2 {
	constructor(
		public uri: URI,
		public text: string,
		public lineNumber: number) { }
}

export class AISearchKeyword {
	constructor(public keyword: string) { }
}

export type TextSearchResult2 = TextSearchMatch2 | TextSearchContext2;

export type AISearchResult = TextSearchResult2 | AISearchKeyword;

export interface FileSearchProvider2 {
	provideFileSearchResults(pattern: string, options: FileSearchProviderOptions, token: CancellationToken): ProviderResult<URI[]>;
}

export interface TextSearchProvider2 {
	provideTextSearchResults(query: TextSearchQuery2, options: TextSearchProviderOptions, progress: IProgress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2>;
}

export interface TextSearchComplete2 {
	limitHit?: boolean;

	message?: TextSearchCompleteMessage2[];
}

export interface TextSearchCompleteMessage2 {
	text: string;
	trusted?: boolean;
	type: TextSearchCompleteMessageType;
}


export interface FileSearchProvider2 {
	provideFileSearchResults(pattern: string, options: FileSearchProviderOptions, token: CancellationToken): ProviderResult<URI[]>;
}

export interface TextSearchProvider2 {
	provideTextSearchResults(query: TextSearchQuery2, options: TextSearchProviderOptions, progress: IProgress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2>;
}

export interface TextSearchComplete2 {
	limitHit?: boolean;

	message?: TextSearchCompleteMessage2[];
}

export interface TextSearchCompleteMessage2 {
	text: string;
	trusted?: boolean;
	type: TextSearchCompleteMessageType;
}

export enum ExcludeSettingOptions {
	None = 1,
	FilesExclude = 2,
	SearchAndFilesExclude = 3
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


export interface AITextSearchProvider {

	readonly name?: string;

	provideAITextSearchResults(query: string, options: TextSearchProviderOptions, progress: IProgress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2>;
}
