/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CancellationToken, Uri, workspace } from 'vscode';
import { Diff, IGitDiffService } from '../../../platform/git/common/gitDiffService';
import { IGitExtensionService } from '../../../platform/git/common/gitExtensionService';
import { Change, Repository } from '../../../platform/git/dardcor/git';
import { IIgnoreService } from '../../../platform/ignore/common/ignoreService';
import { ILogService } from '../../../platform/log/common/logService';
import { isUri } from '../../../util/common/types';
import { CancellationError } from '../../../util/dardcor/base/common/errors';
import * as path from '../../../util/dardcor/base/common/path';
import { isEqual } from '../../../util/dardcor/base/common/resources';

const MAX_UNTRACKED_FILE_SIZE = 1 * 1024 * 1024;

const MAX_DIFF_SIZE = 100_000;

export class GitDiffService implements IGitDiffService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IGitExtensionService private readonly _gitExtensionService: IGitExtensionService,
		@IIgnoreService private readonly _ignoreService: IIgnoreService,
		@ILogService private readonly _logService: ILogService
	) { }

	private async _resolveRepository(repositoryOrUri: Repository | Uri): Promise<Repository | null | undefined> {
		if (isUri(repositoryOrUri)) {
			const extensionApi = this._gitExtensionService.getExtensionApi();
			return extensionApi?.getRepository(repositoryOrUri) ?? await extensionApi?.openRepository(repositoryOrUri) ?? extensionApi?.repositories.find((repo) => isEqual(repo.rootUri, repositoryOrUri));
		}
		return repositoryOrUri;
	}

	async getWorkingTreeDiffsFromRef(repositoryOrUri: Repository | Uri, changes: Change[], ref: string, token?: CancellationToken): Promise<Diff[]> {
		this._logService.debug(`[GitDiffService] Getting working tree diffs from ref ${ref} for ${changes.length} file(s)`);

		const repository = await this._resolveRepository(repositoryOrUri);
		if (!repository) {
			this._logService.debug(`[GitDiffService] Repository not found for uri: ${repositoryOrUri.toString()}`);
			return [];
		}

		const diffs: Diff[] = [];
		for (const change of changes) {
			if (token?.isCancellationRequested) {
				throw new CancellationError();
			}

			if (await this._ignoreService.isIgnored(change.uri)) {
				this._logService.debug(`[GitDiffService] Ignoring change due to content exclusion rule based on uri: ${change.uri.toString()}`);
				continue;
			}

			let diff: string;
			if (change.status === 7 ) {
				diff = await this._getUntrackedChangePatch(repository, change.uri);
			} else {
				diff = await repository.diffWith(ref, change.uri.fsPath);
			}

			diffs.push({
				originalUri: change.originalUri,
				renameUri: change.renameUri,
				status: change.status,
				uri: change.uri,
				diff: this._truncateDiff(diff, change.uri)
			});
		}

		this._logService.debug(`[GitDiffService] Working tree diffs from ref (after context exclusion): ${diffs.length} file(s)`);

		return diffs;
	}

	async getChangeDiffs(repositoryOrUri: Repository | Uri, changes: Change[], token?: CancellationToken): Promise<Diff[]> {
		this._logService.debug(`[GitDiffService] Changes (before context exclusion): ${changes.length} file(s)`);

		const repository = await this._resolveRepository(repositoryOrUri);
		if (!repository) {
			this._logService.debug(`[GitDiffService] Repository not found for uri: ${repositoryOrUri.toString()}`);
			return [];
		}

		const diffs: Diff[] = [];
		for (const change of changes) {
			if (token?.isCancellationRequested) {
				throw new CancellationError();
			}

			if (await this._ignoreService.isIgnored(change.uri)) {
				this._logService.debug(`[GitDiffService] Ignoring change due to content exclusion rule based on uri: ${change.uri.toString()}`);
				continue;
			}

			let diff: string;
			switch (change.status) {
				case 0 :
				case 1 :
				case 2 :
				case 3 :
				case 4 :
					diff = await repository.diffIndexWithHEAD(change.uri.fsPath);
					break;
				case 7 :
					diff = await this._getUntrackedChangePatch(repository, change.uri);
					break;
				default:
					diff = await repository.diffWithHEAD(change.uri.fsPath);
					break;
			}

			diffs.push({
				originalUri: change.originalUri,
				renameUri: change.renameUri,
				status: change.status,
				uri: change.uri,
				diff: this._truncateDiff(diff, change.uri)
			});
		}

		this._logService.debug(`[GitDiffService] Changes (after context exclusion): ${diffs.length} file(s)`);

		return diffs;
	}

	private async _getUntrackedChangePatch(repository: Repository, resource: Uri): Promise<string> {
		const patch: string[] = [];
		const relativePath = path.relative(repository.rootUri.fsPath, resource.fsPath);

		try {
			const stat = await workspace.fs.stat(resource);
			if (stat.size > MAX_UNTRACKED_FILE_SIZE) {
				this._logService.debug(`[GitDiffService] Skipping untracked file (too large: ${stat.size} bytes): ${resource.toString()}`);
				patch.push(`diff --git a/${relativePath} b/${relativePath}`);
				patch.push('new file mode 100644');
				patch.push('--- /dev/null', `+++ b/${relativePath}`);
				patch.push(`\\ File too large to diff (${Math.round(stat.size / 1024)} KB)`);
				return patch.join('\n') + '\n';
			}
		} catch {
		}

		try {
			const buffer = await workspace.fs.readFile(resource);
			const content = buffer.toString();

			patch.push(`diff --git a/${relativePath} b/${relativePath}`);
			patch.push('new file mode 100644');
			patch.push('--- /dev/null', `+++ b/${relativePath}`);

			if (content.length > 0) {
				const lines = content.split('\n');
				if (content.endsWith('\n')) {
					lines.pop();
				}

				patch.push(`@@ -0,0 +1,${lines.length} @@`);
				patch.push(...lines.map(line => `+${line}`));

				if (!content.endsWith('\n')) {
					patch.push('\\ No newline at end of file');
				}
			}
		} catch (err) {
			this._logService.warn(`[GitDiffService] Failed to generate patch file for untracked file: ${resource.toString()}: ${err}`);
		}

		return patch.join('\n') + '\n';
	}

	private _truncateDiff(diff: string, uri: Uri): string {
		if (diff.length > MAX_DIFF_SIZE) {
			this._logService.debug(`[GitDiffService] Truncating diff for ${uri.toString()} (${diff.length} chars -> ${MAX_DIFF_SIZE} chars)`);
			return diff.substring(0, MAX_DIFF_SIZE) + '\n... [diff truncated]\n';
		}
		return diff;
	}
}
