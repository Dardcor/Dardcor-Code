/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Limiter } from '../../../base/common/async.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IAgentHostGitService } from '../common/agentHostGitService.js';

const REPOSITORY_ROOT_RESOLUTION_CONCURRENCY = 5;

export interface ISessionRepositories {
	readonly gitRepositories: URI[];
	readonly nonGitDirectories: URI[];
}

export async function resolveSessionRepositories(workingDirectories: readonly URI[], gitService: IAgentHostGitService, onRootError?: (directory: URI, error: unknown) => void): Promise<ISessionRepositories> {
	const limiter = new Limiter<{ workingDirectory: URI; repositoryRoot: URI | undefined }>(REPOSITORY_ROOT_RESOLUTION_CONCURRENCY);
	let resolvedRoots: { workingDirectory: URI; repositoryRoot: URI | undefined }[];
	try {
		resolvedRoots = await Promise.all(workingDirectories.map(workingDirectory => limiter.queue(async () => {
			try {
				return { workingDirectory, repositoryRoot: await gitService.getRepositoryRoot(workingDirectory) };
			} catch (err) {
				if (!onRootError) {
					throw err;
				}
				onRootError(workingDirectory, err);
				return { workingDirectory, repositoryRoot: undefined };
			}
		})));
	} finally {
		limiter.dispose();
	}

	const gitRepositories: URI[] = [];
	const nonGitDirectories: URI[] = [];
	const seenRepositoryKeys = new Set<string>();
	for (const { workingDirectory, repositoryRoot } of resolvedRoots) {
		if (!repositoryRoot) {
			nonGitDirectories.push(workingDirectory);
			continue;
		}
		const repositoryKey = extUriBiasedIgnorePathCase.getComparisonKey(repositoryRoot);
		if (seenRepositoryKeys.has(repositoryKey)) {
			continue;
		}
		seenRepositoryKeys.add(repositoryKey);
		gitRepositories.push(repositoryRoot);
	}
	return { gitRepositories, nonGitDirectories };
}
