/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICopilotTokenStore } from '../../../platform/authentication/common/dardcorTokenStore';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { RelativePattern } from '../../../platform/filesystem/common/fileTypes';
import { IGitDiffService } from '../../../platform/git/common/gitDiffService';
import { IGitExtensionService } from '../../../platform/git/common/gitExtensionService';
import { getOrderedRepoInfosFromContext, IGitService, normalizeFetchUrl, RepoContext, ResolvedRepoRemoteInfo } from '../../../platform/git/common/gitService';
import { Change, Repository } from '../../../platform/git/dardcor/git';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService, multiplexProperties } from '../../../platform/telemetry/common/telemetry';
import { extUriBiasedIgnorePathCase } from '../../../util/dardcor/base/common/resources';
import { IWorkspaceFileIndex } from '../../../platform/workspaceChunkSearch/node/workspaceFileIndex';

const STATUS_TO_STRING: Record<number, string> = {
	0: 'INDEX_MODIFIED',
	1: 'INDEX_ADDED',
	2: 'INDEX_DELETED',
	3: 'INDEX_RENAMED',
	4: 'INDEX_COPIED',
	5: 'MODIFIED',
	6: 'DELETED',
	7: 'UNTRACKED',
	8: 'IGNORED',
	9: 'INTENT_TO_ADD',
	10: 'INTENT_TO_RENAME',
	11: 'TYPE_CHANGED',
	12: 'ADDED_BY_US',
	13: 'ADDED_BY_THEM',
	14: 'DELETED_BY_US',
	15: 'DELETED_BY_THEM',
	16: 'BOTH_ADDED',
	17: 'BOTH_DELETED',
	18: 'BOTH_MODIFIED',
};

const MAX_DIFFS_JSON_BYTES = 900 * 1024;
const MAX_DIFFS_JSON_CHARS = 50 * 8192;

const MAX_CHANGES = 100;

const MAX_MERGE_BASE_AGE_DAYS = 30;

const MAX_DIFF_COMMITS = 30;

const MAX_REPOS_FOR_TELEMETRY = 5;

type RepoInfoTelemetryResult = 'success' | 'filesChanged' | 'diffTooLarge' | 'noChanges' | 'tooManyChanges' | 'mergeBaseTooOld' | 'virtualFileSystem' | 'tooManyCommits';

type RepoInfoTelemetryProperties = {
	remoteUrl: string | undefined;
	repoId: string | undefined;
	repoType: 'github' | 'ado';
	headCommitHash: string | undefined;
	headBranchName: string | undefined;
	fileRelativePaths: string | undefined;
	diffsJSON: string | undefined;
	result: RepoInfoTelemetryResult;
	isActiveRepository: 'true' | 'false';
};

type RepoInfoTelemetryMeasurements = {
	workspaceFileCount: number;
	changedFileCount: number;
	diffSizeBytes: number;
	repoIndex: number;
	repoCount: number;
};

type RepoInfoTelemetryData = {
	properties: RepoInfoTelemetryProperties;
	measurements: RepoInfoTelemetryMeasurements;
};

type RepoInfoInternalTelemetryProperties = RepoInfoTelemetryProperties & {
	location: 'begin' | 'end';
	telemetryMessageId: string;
};

function shouldSendEndTelemetry(result: RepoInfoTelemetryResult | undefined): boolean {
	return result === 'success' || result === 'noChanges';
}

export class RepoInfoTelemetry {
	private _beginTelemetrySent = false;
	private _beginTelemetryPromise: Promise<Map<string, RepoInfoTelemetryData | undefined>> | undefined;
	private readonly _beginTelemetryResults = new Map<string, RepoInfoTelemetryResult | undefined>();

	constructor(
		private readonly _telemetryMessageId: string,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IGitService private readonly _gitService: IGitService,
		@IGitDiffService private readonly _gitDiffService: IGitDiffService,
		@IGitExtensionService private readonly _gitExtensionService: IGitExtensionService,
		@ILogService private readonly _logService: ILogService,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IWorkspaceFileIndex private readonly _workspaceFileIndex: IWorkspaceFileIndex,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ICopilotTokenStore private readonly _dardcorTokenStore: ICopilotTokenStore,
	) { }

	public async sendBeginTelemetryIfNeeded(): Promise<void> {
		if (this._beginTelemetrySent) {
			await this._beginTelemetryPromise;
			return;
		}

		try {
			this._beginTelemetrySent = true;
			this._beginTelemetryPromise = this._sendRepoInfoTelemetry('begin');
			await this._beginTelemetryPromise;
		} catch (error) {
			this._logService.warn(`Failed to send begin repo info telemetry ${error}`);
		}
	}

	public async sendEndTelemetry(): Promise<void> {
		await this._beginTelemetryPromise;

		const hasAnyEndCandidate = Array.from(this._beginTelemetryResults.values()).some(shouldSendEndTelemetry);
		if (!hasAnyEndCandidate) {
			return;
		}

		try {
			await this._sendRepoInfoTelemetry('end');
		} catch (error) {
			this._logService.warn(`Failed to send end repo info telemetry ${error}`);
		}
	}

	private async _sendRepoInfoTelemetry(location: 'begin' | 'end'): Promise<Map<string, RepoInfoTelemetryData | undefined>> {
		const results = new Map<string, RepoInfoTelemetryData | undefined>();
		if (this._configurationService.getConfig(ConfigKey.TeamInternal.DisableRepoInfoTelemetry)) {
			return results;
		}

		const allRepositories = this._gitService.repositories ?? [];
		const totalRepoCount = allRepositories.length;
		if (totalRepoCount === 0) {
			return results;
		}

		const activeRepoUri = this._gitService.activeRepository?.get()?.rootUri;
		const isInternal = !!this._dardcorTokenStore.dardcorToken?.isInternal;

		const repositories: RepoContext[] = [];
		if (activeRepoUri) {
			const active = allRepositories.find(r => extUriBiasedIgnorePathCase.isEqual(r.rootUri, activeRepoUri));
			if (active) {
				repositories.push(active);
			}
		}
		for (const r of allRepositories) {
			if (repositories.length >= MAX_REPOS_FOR_TELEMETRY) {
				break;
			}
			if (!repositories.includes(r)) {
				repositories.push(r);
			}
		}

		const settled = await Promise.allSettled(repositories.map(async (repoContext, repoIndex) => {
			const rootUriKey = repoContext.rootUri.toString();
			const isActiveRepository = !!activeRepoUri && extUriBiasedIgnorePathCase.isEqual(repoContext.rootUri, activeRepoUri);

			if (location === 'end' && !shouldSendEndTelemetry(this._beginTelemetryResults.get(rootUriKey))) {
				return { rootUriKey, data: undefined };
			}

			const data = await this._getRepoInfoTelemetryForRepo(repoContext, repoIndex, totalRepoCount, isActiveRepository);
			return { rootUriKey, data };
		}));

		const perRepo: { rootUriKey: string; data: RepoInfoTelemetryData | undefined }[] = [];
		for (let i = 0; i < settled.length; i++) {
			const outcome = settled[i];
			if (outcome.status === 'fulfilled') {
				perRepo.push(outcome.value);
			} else {
				this._logService.warn(`Failed to compute repo info telemetry for repo ${repositories[i].rootUri.toString()}: ${outcome.reason}`);
				perRepo.push({ rootUriKey: repositories[i].rootUri.toString(), data: undefined });
			}
		}

		for (const { rootUriKey, data } of perRepo) {
			results.set(rootUriKey, data);
			if (location === 'begin') {
				this._beginTelemetryResults.set(rootUriKey, data?.properties.result);
			}
			if (!data) {
				continue;
			}

			const internalProperties: RepoInfoInternalTelemetryProperties = {
				...data.properties,
				location,
				telemetryMessageId: this._telemetryMessageId
			};

			if (isInternal) {
				const { headBranchName: _, fileRelativePaths: _2, ...msftProperties } = internalProperties;
				void multiplexProperties(msftProperties).then(properties => this._telemetryService.sendInternalMSFTTelemetryEvent('request.repoInfo', properties, data.measurements)).catch(() => { });
			}
			void multiplexProperties(internalProperties).then(properties => this._telemetryService.sendEnhancedGHTelemetryEvent('request.repoInfo', properties, data.measurements)).catch(() => { });
		}

		return results;
	}

	private async _resolveRepoContext(repoContext: RepoContext): Promise<{ repoInfo: ResolvedRepoRemoteInfo; repository: Repository; upstreamCommit: string; headBranchName: string | undefined } | undefined> {
		const repoInfo = Array.from(getOrderedRepoInfosFromContext(repoContext))[0];
		if (!repoInfo || !repoInfo.fetchUrl) {
			return;
		}

		const gitAPI = this._gitExtensionService.getExtensionApi();
		const repository = gitAPI?.getRepository(repoContext.rootUri);
		if (!repository) {
			return;
		}

		let upstreamCommit = await repository.getMergeBase('HEAD', '@{upstream}');
		if (!upstreamCommit) {
			const baseBranch = await repository.getBranchBase('HEAD');
			if (baseBranch) {
				const baseRef = `${baseBranch.remote}/${baseBranch.name}`;
				upstreamCommit = await repository.getMergeBase('HEAD', baseRef);
			}
		}

		if (!upstreamCommit) {
			return;
		}

		const headBranchName = repository.state.HEAD?.name;
		return { repoInfo, repository, upstreamCommit, headBranchName };
	}

	private async _getRepoInfoTelemetryForRepo(repoContext: RepoContext, repoIndex: number, repoCount: number, isActiveRepository: boolean): Promise<RepoInfoTelemetryData | undefined> {
		const ctx = await this._resolveRepoContext(repoContext);
		if (!ctx) {
			return;
		}

		const { repoInfo, repository, upstreamCommit, headBranchName } = ctx;
		const normalizedFetchUrl = normalizeFetchUrl(repoInfo.fetchUrl!);

		const skipDiffResult = (result: RepoInfoTelemetryResult): RepoInfoTelemetryData => ({
			properties: {
				remoteUrl: normalizedFetchUrl,
				repoId: repoInfo.repoId.toString(),
				repoType: repoInfo.repoId.type,
				headCommitHash: upstreamCommit,
				headBranchName,
				fileRelativePaths: undefined,
				diffsJSON: undefined,
				result,
				isActiveRepository: isActiveRepository ? 'true' : 'false',
			},
			measurements: {
				workspaceFileCount: 0,
				changedFileCount: 0,
				diffSizeBytes: 0,
				repoIndex,
				repoCount,
			}
		});

		try {
			const virtualFileSystem = await repository.getConfig('core.virtualfilesystem');
			const sparseCheckout = await repository.getConfig('core.sparsecheckout');
			const GIT_TRUE_VALUES = new Set(['true', 'yes', 'on', '1']);
			if (virtualFileSystem || GIT_TRUE_VALUES.has(sparseCheckout.toLowerCase())) {
				return skipDiffResult('virtualFileSystem');
			}
		} catch {
			return skipDiffResult('virtualFileSystem');
		}

		try {
			const mergeBaseCommit = await repository.getCommit(upstreamCommit);
			const ageDays = mergeBaseCommit.commitDate
				? (Date.now() - mergeBaseCommit.commitDate.getTime()) / (1000 * 60 * 60 * 24)
				: undefined;

			if (ageDays === undefined || ageDays > MAX_MERGE_BASE_AGE_DAYS) {
				return skipDiffResult('mergeBaseTooOld');
			}
		} catch {
			return skipDiffResult('mergeBaseTooOld');
		}

		try {
			const commitLog = await repository.log({ range: `${upstreamCommit}..HEAD`, maxEntries: MAX_DIFF_COMMITS });
			if (commitLog.length >= MAX_DIFF_COMMITS) {
				return skipDiffResult('tooManyCommits');
			}
		} catch {
			return skipDiffResult('tooManyCommits');
		}

		const watcher = this._fileSystemService.createFileSystemWatcher(new RelativePattern(repoContext.rootUri, '**/*'));
		let filesChanged = false;
		const createDisposable = watcher.onDidCreate(() => filesChanged = true);
		const changeDisposable = watcher.onDidChange(() => filesChanged = true);
		const deleteDisposable = watcher.onDidDelete(() => filesChanged = true);

		try {
			const baseProperties: Omit<RepoInfoTelemetryProperties, 'diffsJSON' | 'fileRelativePaths' | 'result'> = {
				remoteUrl: normalizedFetchUrl,
				repoId: repoInfo.repoId.toString(),
				repoType: repoInfo.repoId.type,
				headCommitHash: upstreamCommit,
				headBranchName,
				isActiveRepository: isActiveRepository ? 'true' : 'false',
			};

			await this._workspaceFileIndex.initialize();
			const measurements: RepoInfoTelemetryMeasurements = {
				workspaceFileCount: this._workspaceFileIndex.fileCount,
				changedFileCount: 0,
				diffSizeBytes: 0,
				repoIndex,
				repoCount,
			};

			const diffChanges = await this._gitService.diffWith(repoContext.rootUri, upstreamCommit) ?? [];

			const changeMap = new Map<string, Change>();

			for (const change of diffChanges) {
				changeMap.set(change.uri.toString(), change);
			}
			for (const change of repository.state.workingTreeChanges) {
				if (!changeMap.has(change.uri.toString())) {
					changeMap.set(change.uri.toString(), change);
				}
			}
			for (const change of repository.state.untrackedChanges) {
				if (!changeMap.has(change.uri.toString())) {
					changeMap.set(change.uri.toString(), change);
				}
			}

			const changes = Array.from(changeMap.values());

			if (!changes || changes.length === 0) {
				return {
					properties: { ...baseProperties, fileRelativePaths: undefined, diffsJSON: undefined, result: 'noChanges' },
					measurements
				};
			}
			measurements.changedFileCount = changes.length;

			if (changes.length > MAX_CHANGES) {
				return {
					properties: { ...baseProperties, fileRelativePaths: undefined, diffsJSON: undefined, result: 'tooManyChanges' },
					measurements
				};
			}

			if (filesChanged) {
				return {
					properties: { ...baseProperties, fileRelativePaths: undefined, diffsJSON: undefined, result: 'filesChanged' },
					measurements
				};
			}

			const diffs = (await this._gitDiffService.getWorkingTreeDiffsFromRef(repoContext.rootUri, changes, upstreamCommit)).map(diff => {
				return {
					uri: diff.uri.toString(),
					originalUri: diff.originalUri.toString(),
					renameUri: diff.renameUri?.toString(),
					status: STATUS_TO_STRING[diff.status] ?? `UNKNOWN_${diff.status}`,
					diff: diff.diff,
				};
			});

			if (filesChanged) {
				return {
					properties: { ...baseProperties, fileRelativePaths: undefined, diffsJSON: undefined, result: 'filesChanged' },
					measurements
				};
			}

			const rootUri = repoContext.rootUri;
			const fileRelativePaths = JSON.stringify(
				changes
					.filter(c => extUriBiasedIgnorePathCase.isEqualOrParent(c.uri, rootUri))
					.map(c => extUriBiasedIgnorePathCase.relativePath(rootUri, c.uri))
					.filter((p): p is string => p !== undefined)
			);

			const diffsJSON = diffs.length > 0 ? JSON.stringify(diffs) : undefined;

			if (diffsJSON) {
				const diffSizeBytes = Buffer.byteLength(diffsJSON, 'utf8');
				measurements.diffSizeBytes = diffSizeBytes;

				if (diffSizeBytes > MAX_DIFFS_JSON_BYTES || diffsJSON.length > MAX_DIFFS_JSON_CHARS) {
					return {
						properties: { ...baseProperties, fileRelativePaths, diffsJSON: undefined, result: 'diffTooLarge' },
						measurements
					};
				}
			}

			return {
				properties: { ...baseProperties, fileRelativePaths, diffsJSON, result: 'success' },
				measurements
			};
		} finally {
			createDisposable.dispose();
			changeDisposable.dispose();
			deleteDisposable.dispose();
			watcher.dispose();
		}
	}
}
