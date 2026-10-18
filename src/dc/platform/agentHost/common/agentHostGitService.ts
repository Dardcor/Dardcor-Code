/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { LRUCache } from '../../../base/common/map.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ISessionFileDiff, ISessionGitState } from './state/sessionState.js';

export const META_DIFF_BASE_BRANCH = 'agentHost.diffBaseBranch';

export function resolveDiffBaseBranchName(persistedBaseBranch: string | undefined, sessionGitStateBaseBranch: string | undefined): string | undefined {
	const branchName = persistedBaseBranch ?? sessionGitStateBaseBranch;
	if (!branchName) {
		return undefined;
	}
	return branchName
		.replace(/^refs\/remotes\/origin\//, '')
		.replace(/^origin\//, '');
}

export const EMPTY_TREE_OBJECT = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface IComputeSessionFileDiffsOptions {
	readonly sessionUri: string;
	readonly baseBranch?: string;
}

export interface IBranchDiffSafetyInfo {
	readonly hasVirtualFileSystem: boolean;
	readonly baselineCommitTimestamp: number | undefined;
	readonly commitCount: number | undefined;
	readonly workspaceFileCount: number;
}

export interface IDiffPatchResult {
	readonly patch: string | undefined;
	readonly tooLarge: boolean;
}

export interface IPushOptions {
	readonly ref?: string;
	readonly remote?: string;
	readonly setUpstream?: boolean;
}

export interface IPullOptions {
	readonly ref?: string;
	readonly remote?: string;
	readonly rebase?: boolean;
}

export const IAgentHostGitService = createDecorator<IAgentHostGitService>('agentHostGitService');

export class CheckoutBlockedByLocalChangesError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'CheckoutBlockedByLocalChangesError';
	}
}

class PrimaryWorktreeRootResolver {
	private readonly _roots = new LRUCache<string, URI>(100);
	private readonly _sequencer = new Sequencer();

	constructor(private readonly _gitService: IAgentHostGitService) { }

	async resolve(checkoutRoot: URI): Promise<URI | undefined> {
		const key = checkoutRoot.toString();
		const cached = this._roots.get(key);
		if (cached) {
			return cached;
		}
		return this._sequencer.queue(async () => {
			const cached = this._roots.get(key);
			if (cached) {
				return cached;
			}
			const roots = await this._gitService.getWorktreeRoots(checkoutRoot);
			const primaryRoot = roots[0];
			if (!primaryRoot) {
				return undefined;
			}
			this._roots.set(key, primaryRoot);
			for (const root of roots) {
				this._roots.set(root.toString(), primaryRoot);
			}
			return primaryRoot;
		});
	}
}

const primaryWorktreeRootResolvers = new WeakMap<IAgentHostGitService, PrimaryWorktreeRootResolver>();

export function tryResolvePrimaryWorktreeRoot(gitService: IAgentHostGitService, checkoutRoot: URI): Promise<URI | undefined> {
	let resolver = primaryWorktreeRootResolvers.get(gitService);
	if (!resolver) {
		resolver = new PrimaryWorktreeRootResolver(gitService);
		primaryWorktreeRootResolvers.set(gitService, resolver);
	}
	return resolver.resolve(checkoutRoot);
}

export interface IRefQuery {
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
}

export type Branch = IBranch | IRemoteBranch;
export type GitRef = IBranch | IRemoteBranch | ITag;

export const enum GitRefType {
	Head,
	RemoteHead,
	DetachedHead,
	Tag
}

export interface IBranch {
	readonly ref: string;
	readonly name: string;
	readonly upstream?: {
		readonly ref: string;
		readonly name: string;
		readonly remote: string;
	};
	readonly kind: GitRefType.Head;
}

export interface IRemoteBranch {
	readonly ref: string;
	readonly name: string;
	readonly remote: string;
	readonly kind: GitRefType.RemoteHead;
}

export interface ITag {
	readonly ref: string;
	readonly name: string;
	readonly kind: GitRefType.Tag;
}

export interface IDetachedHead {
	readonly name: string;
	readonly kind: GitRefType.DetachedHead;
}

export interface IDefaultBranch {
	readonly name: string;
	readonly startPoint: string;
}

export interface IWorktreeFileProgress {
	readonly filesDone: number;
	readonly filesTotal: number;
}

export interface IAddWorktreeOptions {
	readonly path: URI;
	readonly commitish: string;
	readonly newBranchName?: string;
	readonly track: boolean;
	readonly preferRemoteBranch?: boolean;
	readonly onProgress?: (progress: IWorktreeFileProgress) => void;
}

export interface IAgentHostGitService {
	readonly _serviceBrand: undefined;
	getCurrentBranch(workingDirectory: URI): Promise<string | undefined>;
	getCurrentBranchName?(workingDirectory: URI): Promise<string | undefined>;
	getDefaultBranch(workingDirectory: URI): Promise<IDefaultBranch | undefined>;
	getRefs(workingDirectory: URI, query?: IRefQuery): Promise<GitRef[]>;
	getBranches(workingDirectory: URI, query?: IRefQuery): Promise<Branch[]>;
	getBranch(workingDirectory: URI, name: string): Promise<Branch | undefined>;
	getRepositoryRoot(workingDirectory: URI): Promise<URI | undefined>;
	getWorktreeRoots(workingDirectory: URI): Promise<URI[]>;
	addWorktree(repositoryRoot: URI, options: IAddWorktreeOptions): Promise<void>;
	copyWorktreeIncludeFiles(repositoryRoot: URI, worktree: URI, globs: readonly string[], onProgress?: (progress: IWorktreeFileProgress) => void): Promise<void>;
	addExistingWorktree(repositoryRoot: URI, worktree: URI, branchName: string): Promise<void>;
	removeWorktree(repositoryRoot: URI, worktree: URI, options?: { readonly force?: boolean }): Promise<void>;
	branchExists(repositoryRoot: URI, branchName: string): Promise<boolean>;
	createBranch(workingDirectory: URI, branchName: string, options?: { readonly checkout?: boolean }): Promise<void>;
	checkout(workingDirectory: URI, treeish: string): Promise<void>;
	hasUncommittedChanges(workingDirectory: URI): Promise<boolean>;

	createStash(workingDirectory: URI, options?: { readonly message?: string; readonly includeUntracked?: boolean; readonly staged?: boolean }): Promise<void>;

	commitAll(workingDirectory: URI, message: string): Promise<void>;

	mergeBranch(workingDirectory: URI, branchName: string): Promise<string>;

	restore(workingDirectory: URI, paths: readonly string[], options?: { readonly staged?: boolean; readonly ref?: string }): Promise<void>;

	hasUpstream(workingDirectory: URI, branchName: string): Promise<boolean>;

	pull(workingDirectory: URI, options?: IPullOptions): Promise<void>;

	push(workingDirectory: URI, options?: IPushOptions): Promise<void>;

	getSessionGitState(workingDirectory: URI, baseBranchName?: string): Promise<ISessionGitState | undefined>;
	getFetchRemoteUrls(workingDirectory: URI, preferredRemote?: string): Promise<readonly string[] | undefined>;
	getUntrackedPaths(workingDirectory: URI): Promise<readonly string[] | undefined>;

	computeSessionFileDiffs(workingDirectory: URI, options: IComputeSessionFileDiffsOptions): Promise<readonly ISessionFileDiff[] | undefined>;

	resolveBranchBaselineCommit(workingDirectory: URI, baseBranch?: string): Promise<string | undefined>;

	showBlob(workingDirectory: URI, ref: string, repoRelativePath: string): Promise<VSBuffer | undefined>;


	captureWorkingTreeAsTree(workingDirectory: URI): Promise<string | undefined>;

	commitTree(repositoryRoot: URI, treeOid: string, parentOid: string | undefined, message: string): Promise<string | undefined>;

	updateRef(repositoryRoot: URI, ref: string, newOid: string): Promise<void>;

	deleteRefs(repositoryRoot: URI, refs: readonly string[]): Promise<void>;

	revParse(repositoryRoot: URI, expression: string): Promise<string | undefined>;

	listRefNamesWithOids?(repositoryRoot: URI, pattern: string): Promise<Array<{ readonly ref: string; readonly oid: string }>>;

	overlayPathIntoTree(repositoryRoot: URI, baseTreeOid: string, path: string, sourceTreeOid: string): Promise<string | undefined>;

	diffTreePaths(repositoryRoot: URI, fromTreeish: string, toTreeish: string): Promise<string[] | undefined>;

	computeFileDiffsBetweenRefs(workingDirectory: URI, options: { readonly sessionUri: string; readonly fromRef: string; readonly toRef: string }): Promise<readonly ISessionFileDiff[] | undefined>;
	getBranchDiffSafetyInfo(workingDirectory: URI, baselineCommit: string): Promise<IBranchDiffSafetyInfo | undefined>;
	getDiffPatchBetweenRefs(workingDirectory: URI, options: { readonly fromRef: string; readonly toRef: string; readonly paths: readonly string[]; readonly maxBuffer: number }): Promise<IDiffPatchResult | undefined>;
}

function getBranchPriority(branch: string, currentBranch: string | undefined, defaultBranch: string | undefined): number {
	if (branch === currentBranch) {
		return 0;
	}
	if (branch === defaultBranch) {
		return 1;
	}
	return 2;
}

export function parseUpstreamBranchName(upstreamBranchName: string | undefined): { remote: string; branch: string } | undefined {
	const separatorIndex = upstreamBranchName?.indexOf('/') ?? -1;
	if (!upstreamBranchName || separatorIndex <= 0 || separatorIndex === upstreamBranchName.length - 1) {
		return undefined;
	}
	return {
		remote: upstreamBranchName.substring(0, separatorIndex),
		branch: upstreamBranchName.substring(separatorIndex + 1),
	};
}

export function getBranchCompletions(branches: readonly string[], options?: { readonly currentBranch?: string; readonly defaultBranch?: string; readonly query?: string; readonly limit?: number }): string[] {
	const normalizedQuery = options?.query?.toLowerCase();
	const filtered = normalizedQuery
		? branches.filter(branch => branch.toLowerCase().includes(normalizedQuery))
		: [...branches];

	filtered.sort((a, b) => getBranchPriority(a, options?.currentBranch, options?.defaultBranch) - getBranchPriority(b, options?.currentBranch, options?.defaultBranch));
	return options?.limit ? filtered.slice(0, options.limit) : filtered;
}
