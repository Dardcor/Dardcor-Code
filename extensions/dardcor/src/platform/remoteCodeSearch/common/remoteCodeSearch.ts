/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { GlobIncludeOptions } from '../../../util/common/glob';
import { FileChunk, FileChunkAndScore } from '../../chunking/common/chunk';

export enum RemoteCodeSearchIndexStatus {
	Ready = 'ready',

	BuildingIndex = 'building-index',

	NotYetIndexed = 'not-yet-indexed',

	NotIndexable = 'not-indexable',
}

export type RemoteCodeSearchIndexState =
	| { readonly status: RemoteCodeSearchIndexStatus.Ready; readonly indexedCommit: string | undefined }
	| { readonly status: RemoteCodeSearchIndexStatus.BuildingIndex | RemoteCodeSearchIndexStatus.NotYetIndexed | RemoteCodeSearchIndexStatus.NotIndexable }
	;

export type RemoteCodeSearchError =
	| { readonly type: 'not-authorized' }
	| { readonly type: 'generic-error'; readonly error: Error }
	;

interface BaseCodeSearchResult {
	readonly outOfSync: boolean;

	readonly remoteUrl?: string;

	readonly refName?: string;
}

export interface SemanticCodeSearchResult extends BaseCodeSearchResult {
	readonly chunks: readonly FileChunkAndScore[];
}

export interface LexicalCodeSearchResult extends BaseCodeSearchResult {
	readonly chunks: readonly FileChunk[];
}

export interface CodeSearchOptions {
	readonly globPatterns?: GlobIncludeOptions;
}
