/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { CodeOrDocsSearchRepoError } from './codeOrDocsSearchErrors';

export interface ICodeOrDocsSearchBaseScopingQuery {
	repo: string | string[];

	lang?: string[];

	notLang?: string[];

	path?: string[];

	notPath?: string[];
}

export interface ICodeOrDocsSearchSingleRepoScopingQuery extends ICodeOrDocsSearchBaseScopingQuery {
	repo: string;
}

export interface ICodeOrDocsSearchMultiRepoScopingQuery extends ICodeOrDocsSearchBaseScopingQuery {
	repo: string[];
}

export interface ICodeOrDocsSearchItem {
	path: string;
	contents: string;
	title?: string;
	score: number;
	repoName: string;
	repoOwner: string;
	range: { start: number; end: number };
	languageId: string;
	languageName: string;
	type: 'snippet' | string;
	url: string;
	ref: string;
	commitOID?: string;
	algorithm?: 'semantic' | 'bm25';
}

export interface ICodeOrDocsSearchResult {
	results: ICodeOrDocsSearchItem[];
	errors: CodeOrDocsSearchRepoError[];
}

export interface ICodeOrDocsSearchOptions {
	limit?: number;

	similarity?: number;
}

export interface IDocsSearchClient {
	readonly _serviceBrand: undefined;

	search(
		query: string,
		scopingQuery: ICodeOrDocsSearchSingleRepoScopingQuery,
		options?: ICodeOrDocsSearchOptions,
		cancellationToken?: CancellationToken
	): Promise<ICodeOrDocsSearchItem[]>;

	search(
		query: string,
		scopingQuery: ICodeOrDocsSearchMultiRepoScopingQuery,
		options?: ICodeOrDocsSearchOptions,
		cancellationToken?: CancellationToken
	): Promise<ICodeOrDocsSearchResult>;
}


export const IDocsSearchClient = createServiceIdentifier<IDocsSearchClient>('docsSearchClient');
