/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum SearchRepoErrorType {
	missingInaccessibleRepoOrg = 'ERROR_TYPE_MISSING_INACCESSIBLE_REPO_ORG',
	docsEmbeddingsUnavailable = 'ERROR_TYPE_DOCS_EMBEDDINGS_UNAVAILABLE',
	notIndexed = 'ERROR_TYPE_NOT_INDEXED',
}

export const enum SearchErrorType {
	maxRetriesExceeded = 'ERROR_TYPE_MAX_RETRIES_EXCEEDED',
	noAccessToEndpoint = 'ERROR_TYPE_NO_ACCESS_TO_ENDPOINT',
}

export class CodeOrDocsSearchRepoError extends Error {
	constructor(readonly repo: string, message?: string) {
		super(message);
	}
}

export class InaccessibleRepoOrgError extends CodeOrDocsSearchRepoError {
	override name = SearchRepoErrorType.missingInaccessibleRepoOrg;
}

export class EmbeddingsUnavailableError extends CodeOrDocsSearchRepoError {
	override name = SearchRepoErrorType.docsEmbeddingsUnavailable;
}

export class NotIndexedError extends CodeOrDocsSearchRepoError {
	override name = SearchRepoErrorType.notIndexed;
}

export class MaxRetriesExceededError extends Error {
	override name = SearchErrorType.maxRetriesExceeded;
}

export class NoAccessToEndpointError extends Error {
	override name = SearchErrorType.noAccessToEndpoint;
}

export function constructSearchRepoError({ error, message, repo }: { error: string; message: string; repo: string }): CodeOrDocsSearchRepoError {
	switch (error) {
		case SearchRepoErrorType.missingInaccessibleRepoOrg:
			return new InaccessibleRepoOrgError(repo, message);
		case SearchRepoErrorType.docsEmbeddingsUnavailable:
			return new EmbeddingsUnavailableError(repo, message);
		case SearchRepoErrorType.notIndexed:
			return new NotIndexedError(repo, message);
		default:
			return new CodeOrDocsSearchRepoError(repo, message);
	}
}

export function constructSearchError({ error, message }: { error: string; message: string }): Error {
	switch (error) {
		case SearchErrorType.maxRetriesExceeded:
			return new MaxRetriesExceededError(message);
		case SearchErrorType.noAccessToEndpoint:
			return new NoAccessToEndpointError(message);
		default:
			return new Error(message);
	}
}
