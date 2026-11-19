/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';

const GIT_BLOB_SCHEME = 'git-blob';

interface IGitBlobUriQuery {
	readonly sessionUri: string;
	readonly sha: string;
	readonly repoRelativePath: string;
}

export function buildGitBlobUri(sessionUri: string, sha: string, repoRelativePath: string, absolutePath: string): string {
	return URI.from({
		scheme: GIT_BLOB_SCHEME,
		path: absolutePath,
		query: JSON.stringify({ sessionUri, sha, repoRelativePath } satisfies IGitBlobUriQuery),
	}).toString();
}

export interface IGitBlobUriFields {
	readonly sessionUri: string;
	readonly sha: string;
	readonly repoRelativePath: string;
	readonly absolutePath: string;
}

export function parseGitBlobUri(raw: string): IGitBlobUriFields | undefined {
	let parsed: URI;
	try {
		parsed = URI.parse(raw);
	} catch {
		return undefined;
	}
	if (parsed.scheme !== GIT_BLOB_SCHEME || !parsed.query) {
		return undefined;
	}
	try {
		const query = JSON.parse(parsed.query) as Partial<IGitBlobUriQuery>;
		if (typeof query.sessionUri === 'string' && typeof query.sha === 'string' && typeof query.repoRelativePath === 'string') {
			return {
				sessionUri: query.sessionUri,
				sha: query.sha,
				repoRelativePath: query.repoRelativePath,
				absolutePath: parsed.path,
			};
		}
	} catch {
		return undefined;
	}
	return undefined;
}
