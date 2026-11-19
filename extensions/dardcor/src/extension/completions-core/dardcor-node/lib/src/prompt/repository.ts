/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AdoRepoId, getAdoRepoIdFromFetchUrl, getGithubRepoIdFromFetchUrl, GithubRepoId, parseRemoteUrl } from '../../../../../../platform/git/common/gitService';
import { ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { FileIdentifier, ICompletionsFileSystemService } from '../fileSystem';
import { LRUCacheMap } from '../helpers/cache';
import { dirname, getFsUri, joinPath } from '../util/uri';

interface RepoInfo {
	baseFolder: { readonly uri: string };
	url: string;
	hostname: string;
	pathname: string;
	repoId: GithubRepoId | AdoRepoId | undefined;
}

export type MaybeRepoInfo = RepoInfo | undefined | ComputationStatus;

export function tryGetGitHubNWO(repoInfo: MaybeRepoInfo): string | undefined {
	if (repoInfo === undefined) {
		return undefined;
	}
	if (repoInfo === ComputationStatus.PENDING) {
		return undefined;
	}
	if (repoInfo.repoId?.type === 'github') {
		return (repoInfo.repoId.org + '/' + repoInfo.repoId.repo).toLowerCase();
	}
	return undefined;
}

export function extractRepoInfoInBackground(accessor: ServicesAccessor, uri: FileIdentifier): MaybeRepoInfo {
	const baseFolder = dirname(uri);
	return backgroundRepoInfo(accessor, baseFolder);
}

const backgroundRepoInfo = computeInBackgroundAndMemoize<RepoInfo | undefined, [FileIdentifier]>(
	extractRepoInfo,
	10000
);

export async function extractRepoInfo(accessor: ServicesAccessor, uri: FileIdentifier): Promise<RepoInfo | undefined> {
	const fs = accessor.get(ICompletionsFileSystemService);

	const fsUri = getFsUri(uri);
	if (!fsUri) { return undefined; }

	const baseUri = await getRepoBaseUri(fs, fsUri);
	if (!baseUri) {
		return undefined;
	}
	const configUri = joinPath(baseUri, '.git', 'config');
	let gitConfig;
	try {
		gitConfig = await fs.readFileString(configUri);
	} catch (_) {
		return undefined;
	}
	const url = getRepoUrlFromConfigText(gitConfig) ?? '';
	const parsedResult = parseRepoUrl(url);
	const baseFolder = { uri: baseUri };
	if (parsedResult === undefined) {
		return { baseFolder, url, hostname: '', pathname: '', repoId: undefined };
	} else {
		return { baseFolder, url, hostname: parsedResult.host, pathname: parsedResult.path, repoId: parsedResult.repoId };
	}
}

function parseRepoUrl(
	url: string
): { host: string; path: string; repoId: GithubRepoId | AdoRepoId | undefined } | undefined {
	const res = parseRemoteUrl(url);
	if (!res) {
		return undefined;
	}
	const repoId = getGithubRepoIdFromFetchUrl(url) ?? getAdoRepoIdFromFetchUrl(url);
	return { ...res, repoId };
}

async function getRepoBaseUri(fileSystemService: ICompletionsFileSystemService, uri: string): Promise<string | undefined> {
	let previousUri = uri + '_add_to_make_longer';
	while (uri !== 'file:///' && uri.length < previousUri.length) {
		const configUri = joinPath(uri, '.git', 'config');
		let result = false;

		try {
			await fileSystemService.stat(configUri);
			result = true;
		} catch (reason) {
			result = false;
		}

		if (result) {
			return uri;
		} else {
			previousUri = uri;
			uri = dirname(uri);
		}
	}
	return undefined;
}

function getRepoUrlFromConfigText(gitConfig: string): string | undefined {

	const remoteSectionRegex = /^\s*\[\s*remote\s+"((\\\\|\\"|[^\\"])+)"/;
	const deprecatedRemoteSectionRegex = /^\s*\[remote.([^"\s]+)/;
	const setUrlRegex = /^\s*url\s*=\s*([^\s#;]+)/;
	const newSectionRegex = /^\s*\[/;

	let remoteUrl: string | undefined = undefined;
	let remoteSection = undefined;
	let isWithinMultilineUrl = false;
	for (const line of gitConfig.split('\n')) {
		if (isWithinMultilineUrl && remoteUrl !== undefined) {
			remoteUrl += line;
			if (line.endsWith('\\')) {
				remoteUrl = remoteUrl.substring(0, remoteUrl.length - 1);
			} else {
				isWithinMultilineUrl = false;
				if (remoteSection === 'origin') {
					return remoteUrl;
				}
			}
		} else {
			const remoteSectionMatch = line.match(remoteSectionRegex) ?? line.match(deprecatedRemoteSectionRegex);
			if (remoteSectionMatch) {
				remoteSection = remoteSectionMatch[1];
			} else if (line.match(newSectionRegex)) {
				remoteSection = undefined;
			} else if (remoteUrl && remoteSection !== 'origin') {
				continue;
			} else {
				const urlMatch = line.match(setUrlRegex);
				if (urlMatch) {
					remoteUrl = urlMatch[1];
					if (remoteUrl.endsWith('\\')) {
						remoteUrl = remoteUrl.substring(0, remoteUrl.length - 1);
						isWithinMultilineUrl = true;
					} else if (remoteSection === 'origin') {
						return remoteUrl;
					}
				}
			}
		}
	}
	return remoteUrl;
}


export enum ComputationStatus {
	PENDING,
}

class CompletedComputation<T> {
	readonly result: T;
	constructor(result: T) {
		this.result = result;
	}
}

function computeInBackgroundAndMemoize<S, P extends unknown[]>(
	fct: (accessor: ServicesAccessor, ...args: P) => Promise<S>,
	cacheSize: number
): (accessor: ServicesAccessor, ...args: P) => S | ComputationStatus {
	const resultsCache = new LRUCacheMap<string, CompletedComputation<S>>(cacheSize);
	const inComputation: Set<string> = new Set();
	return (accessor: ServicesAccessor, ...args: P) => {
		const key = JSON.stringify(args);
		const memorizedComputation = resultsCache.get(key);
		if (memorizedComputation) {
			return memorizedComputation.result;
		}
		if (inComputation.has(key)) {
			return ComputationStatus.PENDING;
		}
		const computation = fct(accessor, ...args);
		inComputation.add(key);
		void computation.then(computedResult => {
			resultsCache.set(key, new CompletedComputation(computedResult));
			inComputation.delete(key);
		});
		return ComputationStatus.PENDING;
	};
}
