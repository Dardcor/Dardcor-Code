/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../util/dardcor/base/common/uri';
import { isEqualOrParent, relativePath } from '../../../util/dardcor/base/common/resources';
import { getOrderedRepoInfosFromContext, type IGitService, normalizeFetchUrl, type RepoContext } from '../../git/common/gitService';
import { DardcorChatAttr, DardcorAttr } from './genAiAttributes';

export interface WorkspaceOTelMetadata {
	readonly headBranchName?: string;
	readonly headCommitHash?: string;
	readonly remoteUrl?: string;
	readonly fileRelativePath?: string;
}

export function resolveWorkspaceOTelMetadata(
	gitService: IGitService,
	fileUri?: URI,
): WorkspaceOTelMetadata {
	const repoContext = gitService.activeRepository?.get();
	if (!repoContext) {
		return {};
	}
	return buildWorkspaceMetadata(repoContext, fileUri);
}

function buildWorkspaceMetadata(repoContext: RepoContext, fileUri?: URI): WorkspaceOTelMetadata {
	let remoteUrl: string | undefined;
	const repoInfo = Array.from(getOrderedRepoInfosFromContext(repoContext))[0];
	if (repoInfo?.fetchUrl) {
		remoteUrl = normalizeFetchUrl(repoInfo.fetchUrl);
	}

	let fileRelativePath: string | undefined;
	if (fileUri && isEqualOrParent(fileUri, repoContext.rootUri)) {
		fileRelativePath = relativePath(repoContext.rootUri, fileUri);
	}

	return {
		headBranchName: repoContext.headBranchName,
		headCommitHash: repoContext.headCommitHash,
		remoteUrl,
		fileRelativePath,
	};
}

export function workspaceMetadataToOTelAttributes(
	metadata?: WorkspaceOTelMetadata,
): Record<string, string> {
	if (!metadata) {
		return {};
	}
	const attrs: Record<string, string> = {};
	if (metadata.headBranchName) {
		attrs[DardcorChatAttr.REPO_HEAD_BRANCH_NAME] = metadata.headBranchName;
		attrs[DardcorAttr.GIT_BRANCH] = metadata.headBranchName;
	}
	if (metadata.headCommitHash) {
		attrs[DardcorChatAttr.REPO_HEAD_COMMIT_HASH] = metadata.headCommitHash;
		attrs[DardcorAttr.GIT_COMMIT_SHA] = metadata.headCommitHash;
	}
	if (metadata.remoteUrl) {
		attrs[DardcorChatAttr.REPO_REMOTE_URL] = metadata.remoteUrl;
		attrs[DardcorAttr.GIT_REPOSITORY] = metadata.remoteUrl;
		const org = extractGitHubOrg(metadata.remoteUrl);
		if (org) {
			attrs[DardcorAttr.GITHUB_ORG] = org;
		}
	}
	if (metadata.fileRelativePath) {
		attrs[DardcorChatAttr.FILE_RELATIVE_PATH] = metadata.fileRelativePath;
	}
	return attrs;
}

function extractGitHubOrg(remoteUrl: string): string | undefined {
	const m = remoteUrl.match(/github\.com[/:]([^/]+)\/[^/]+\/?$/i);
	return m?.[1];
}
