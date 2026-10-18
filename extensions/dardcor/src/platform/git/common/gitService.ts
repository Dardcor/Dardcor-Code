/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'monaco-editor';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { Event } from '../../../util/dardcor/base/common/event';
import { IObservable } from '../../../util/dardcor/base/common/observableInternal';
import { equalsIgnoreCase } from '../../../util/dardcor/base/common/strings';
import { URI } from '../../../util/dardcor/base/common/uri';
import { Branch, Change, CommitOptions, CommitShortStat, DiffChange, Ref, RefQuery, Repository, RepositoryAccessDetails, RepositoryKind, Worktree } from '../dardcor/git';

export interface RepoContext {
	readonly rootUri: URI;
	readonly kind: RepositoryKind;
	readonly isUsingVirtualFileSystem: boolean;
	readonly headIncomingChanges: number | undefined;
	readonly headOutgoingChanges: number | undefined;
	readonly headBranchName: string | undefined;
	readonly headCommitHash: string | undefined;
	readonly upstreamBranchName: string | undefined;
	readonly upstreamRemote: string | undefined;
	readonly isRebasing: boolean;
	readonly remoteFetchUrls?: Array<string | undefined>;
	readonly remotes: string[];
	readonly worktrees: Worktree[];
	readonly changes: { mergeChanges: Change[]; indexChanges: Change[]; workingTree: Change[]; untrackedChanges: Change[] } | undefined;

	readonly headBranchNameObs: IObservable<string | undefined>;
	readonly headCommitHashObs: IObservable<string | undefined>;
	readonly upstreamBranchNameObs: IObservable<string | undefined>;
	readonly upstreamRemoteObs: IObservable<string | undefined>;
	readonly isRebasingObs: IObservable<boolean>;

	isIgnored(uri: URI): Promise<boolean>;
}

export const IGitService = createServiceIdentifier<IGitService>('IGitService');

export interface IGitService extends IDisposable {

	readonly _serviceBrand: undefined;

	readonly onDidOpenRepository: Event<RepoContext>;
	readonly onDidCloseRepository: Event<RepoContext>;
	readonly onDidFinishInitialization: Event<void>;

	readonly activeRepository: IObservable<RepoContext | undefined>;

	readonly repositories: Array<RepoContext>;
	readonly isInitialized: boolean;

	initRepository(uri: URI): Promise<Repository | undefined>;
	getRecentRepositories(): Iterable<RepositoryAccessDetails>;
	getRepository(uri: URI, forceOpen?: boolean): Promise<RepoContext | undefined>;
	getRepository2(uri: URI): Promise<Repository | undefined>;
	openRepository(uri: URI): Promise<Repository | undefined>;
	getRepositoryFetchUrls(uri: URI): Promise<Pick<RepoContext, 'rootUri' | 'remoteFetchUrls'> | undefined>;
	initialize(): Promise<void>;
	add(uri: URI, paths: string[]): Promise<void>;
	diffBetweenPatch(uri: URI, ref1: string, ref2: string, path?: string): Promise<string | undefined>;
	diffBetweenWithStats(uri: URI, ref1: string, ref2: string, path?: string): Promise<DiffChange[] | undefined>;
	diffWith(uri: URI, ref: string): Promise<Change[] | undefined>;
	diffIndexWithHEADShortStats(uri: URI): Promise<CommitShortStat | undefined>;
	getMergeBase(uri: URI, ref1: string, ref2: string): Promise<string | undefined>;
	restore(uri: URI, paths: string[], options?: { staged?: boolean; ref?: string }): Promise<void>;

	createWorktree(uri: URI, options?: { path?: string; commitish?: string; branch?: string; noTrack?: boolean }): Promise<string | undefined>;
	deleteWorktree(uri: URI, path: string, options?: { force?: boolean; label?: string }): Promise<void>;

	migrateChanges(uri: URI, sourceRepositoryUri: URI, options?: { confirmation?: boolean; deleteFromSource?: boolean; untracked?: boolean }): Promise<void>;

	applyPatch(uri: URI, patch: string): Promise<void>;
	commit(uri: URI, message: string | undefined, opts?: CommitOptions): Promise<void>;

	getBranch(uri: URI, name: string): Promise<Branch | undefined>;
	getBranchBase(uri: URI, name: string): Promise<Branch | undefined>;
	getRefs(uri: URI, query: RefQuery, cancellationToken?: CancellationToken): Promise<Ref[]>;
	isBranchProtected(uri: URI, branch?: string | Branch): Promise<boolean | undefined>;

	generateRandomBranchName(uri: URI): Promise<string | undefined>;

	exec(uri: URI, args: string[], env?: Record<string, string>): Promise<string>;
}

export function getGitHubRepoInfoFromContext(repoContext: RepoContext): { id: GithubRepoId; remoteUrl: string } | undefined {
	for (const remoteUrl of getOrderedRemoteUrlsFromContext(repoContext)) {
		if (remoteUrl) {
			const id = getGithubRepoIdFromFetchUrl(remoteUrl);
			if (id) {
				return { id, remoteUrl };
			}
		}
	}
	return undefined;
}

export interface ResolvedRepoRemoteInfo {
	readonly fetchUrl: string | undefined;
	readonly repoId: ResolvedRepoId;
}

export type ResolvedRepoId = GithubRepoId | AdoRepoId;

export function* getOrderedRepoInfosFromContext(repoContext: RepoContext): Iterable<ResolvedRepoRemoteInfo> {
	for (const remoteUrl of getOrderedRemoteUrlsFromContext(repoContext)) {
		const repoId = getGithubRepoIdFromFetchUrl(remoteUrl) ?? getAdoRepoIdFromFetchUrl(remoteUrl);
		if (repoId) {
			yield { repoId, fetchUrl: remoteUrl };
		}
	}
}

export function getOrderedRemoteUrlsFromContext(repoContext: RepoContext): Iterable<string> {
	const out = new Set<string>();

	if (repoContext.remoteFetchUrls?.length === 1) {
		out.add(repoContext.remoteFetchUrls[0]!);
		return out;
	}


	const remoteIndex = repoContext.remotes.findIndex(r => r === repoContext.upstreamRemote);
	if (remoteIndex !== -1) {
		const fetchUrl = repoContext.remoteFetchUrls?.[remoteIndex];
		if (fetchUrl) {
			out.add(fetchUrl);
		}
	}

	const originIndex = repoContext.remotes.findIndex(r => r === 'origin');
	if (originIndex !== -1) {
		const fetchUrl = repoContext.remoteFetchUrls?.[originIndex];
		if (fetchUrl) {
			out.add(fetchUrl);
		}
	}

	for (const remote of repoContext.remoteFetchUrls ?? []) {
		if (remote) {
			out.add(remote);
		}
	}

	return out;
}

export function parseRemoteUrl(fetchUrl: string): { host: string; rawHost: string; path: string } | undefined {
	fetchUrl = fetchUrl.trim();
	try {
		if (/^[\w\d\-]+@/i.test(fetchUrl)) {
			const parts = fetchUrl.split(':');
			if (parts.length !== 2) {
				return undefined;
			}
			fetchUrl = 'ssh://' + parts[0] + '/' + parts[1];
		}

		const repoUrl = URI.parse(fetchUrl);
		const authority = repoUrl.authority;
		const path = repoUrl.path;
		if (!(equalsIgnoreCase(repoUrl.scheme, 'ssh') || equalsIgnoreCase(repoUrl.scheme, 'https') || equalsIgnoreCase(repoUrl.scheme, 'http'))) {
			return;
		}

		const splitAuthority = authority.split('@');
		if (splitAuthority.length > 2) {
			return undefined;
		}

		const extractedHost = splitAuthority.at(-1);
		if (!extractedHost) {
			return;
		}

		const rawHost = extractedHost
			.toLowerCase()
			.replace(/:\d+$/, '');

		const normalizedHost = rawHost
			.replace(/^[\w\-]+-/, '')
			.replace(/-[\w\-]+$/, '');

		return { host: normalizedHost, rawHost, path: path };
	} catch (err) {
		return undefined;
	}
}

export class GithubRepoId {
	readonly type = 'github';

	static parse(nwo: string): GithubRepoId | undefined {
		const parts = nwo.split('/');
		if (parts.length !== 2) {
			return undefined;
		}
		return new GithubRepoId(parts[0], parts[1]);
	}

	constructor(
		public readonly org: string,
		public readonly repo: string,
		public readonly host: string = 'github.com',
	) { }

	toString(): string {
		return toGithubNwo(this);
	}
}

export function toGithubNwo(id: GithubRepoId): string {
	return `${id.org}/${id.repo}`.toLowerCase();
}

export function toGithubWebUrl(id: GithubRepoId): string {
	return `https://${id.host}/${id.org}/${id.repo}`;
}

export function getGithubRepoIdFromFetchUrl(fetchUrl: string): GithubRepoId | undefined {
	const parsed = parseRemoteUrl(fetchUrl);
	if (!parsed) {
		return undefined;
	}

	const topLevelUrls = ['github.com', 'ghe.com'];
	const matchedHost = topLevelUrls.find(topLevelUrl => parsed.host === topLevelUrl || parsed.host.endsWith('.' + topLevelUrl));
	if (!matchedHost) {
		return;
	}

	const webHost = matchedHost === 'ghe.com'
		? parsed.rawHost
		: 'github.com';

	const pathMatch = parsed.path.match(/^\/?([^/]+)\/([^/]+?)(\/|\.git\/?)?$/i);
	return pathMatch ? new GithubRepoId(pathMatch[1], pathMatch[2], webHost) : undefined;
}

export class AdoRepoId {

	readonly type = 'ado';

	constructor(
		public readonly org: string,
		public readonly project: string,
		public readonly repo: string,
	) { }

	toString(): string {
		return `${this.org}/${this.project}/${this.repo}`.toLowerCase();
	}
}

export function getAdoRepoIdFromFetchUrl(fetchUrl: string): AdoRepoId | undefined {
	const parsed = parseRemoteUrl(fetchUrl);
	if (!parsed) {
		return undefined;
	}

	if (parsed.host === 'dev.azure.com') {
		const partsMatch = parsed.path.match(/^\/?(?<org>[^/]+)\/(?<project>[^/]+?)\/_git\/(?:_(?:optimized|full)\/)?(?<repo>[^/]+?)(\.git|\/)?$/i);
		if (partsMatch?.groups) {
			return new AdoRepoId(partsMatch.groups.org, partsMatch.groups.project, partsMatch.groups.repo);
		}
		return undefined;
	}

	if (parsed.host === 'ssh.dev.azure.com') {
		const partsMatch = parsed.path.match(/^\/?v3\/(?<org>[^/]+)\/(?<project>[^/]+?)\/(?:_(?:optimized|full)\/)?(?<repo>[^/]+?)(\.git|\/)?$/i);
		if (partsMatch?.groups) {
			return new AdoRepoId(partsMatch.groups.org, partsMatch.groups.project, partsMatch.groups.repo);
		}
		return undefined;
	}

	if (parsed.host.endsWith('.visualstudio.com')) {
		const hostMatch = parsed.host.match(/^(?<org>[^\.]+)\.visualstudio\.com$/i);
		if (!hostMatch?.groups) {
			return undefined;
		}

		const partsMatch =
			parsed.path.match(/^\/(v3\/)(?<org>[^/]+?)\/(?<project>[^/]+?)\/(?:_(?:optimized|full)\/)?(?<repo>[^/]+?)(\.git|\/)?$/i)

			?? parsed.path.match(/^\/?((?<collection>[^/]+?)\/)?(?<project>[^/]+?)\/_git\/(?:_(?:optimized|full)\/)?(?<repo>[^/]+?)(\.git|\/)?$/i);
		if (partsMatch?.groups) {
			return new AdoRepoId(hostMatch.groups.org, partsMatch.groups.project, partsMatch.groups.repo);
		}

		return undefined;
	}

	return undefined;
}

export function normalizeFetchUrl(fetchUrl: string): string {
	if (/^[\w\d\-]+@[\w\d\.\-]+:/.test(fetchUrl)) {
		fetchUrl = fetchUrl.replace(/([\w\d\-]+)@([\w\d\.\-]+):(.+)/, 'https://$2/$3');
		return fetchUrl;
	}

	let url: URL;
	try {
		url = new URL(fetchUrl);
	} catch {
		return fetchUrl;
	}

	const scmScmMatch = url.pathname.match(/^\/scm\/scm\.git/);

	const newUrl = new URL('https://' + url.hostname + url.pathname);

	if (!scmScmMatch && /^\/scm\/[^/]/.test(newUrl.pathname)) {
		newUrl.pathname = newUrl.pathname.replace(/^\/scm\//, '/');
	}

	return newUrl.toString();
}
