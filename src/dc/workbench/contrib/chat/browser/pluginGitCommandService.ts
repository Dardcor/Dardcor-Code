/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { getComparisonKey } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { IPluginGitService } from '../common/plugins/pluginGitService.js';
import {
	GitHubAuthRequiredError,
	GitHubRateLimitError,
	IGitHubRepoRef,
	fetchAndExtractGitHubRepo,
	parseGitHubCloneUrl,
	resolveGitHubRefToSha,
} from './githubRepoFetcher.js';

const BROWSER_CACHE_STORAGE_KEY = 'chat.plugins.browserCache.v1';

interface IBrowserPluginCacheEntry {
	readonly owner: string;
	readonly repo: string;
	readonly ref?: string;
	readonly sha: string;
	readonly fetchedAt: number;
}

type IStoredBrowserPluginCache = Record<string, IBrowserPluginCacheEntry>;

export class BrowserPluginGitCommandService implements IPluginGitService {
	declare readonly _serviceBrand: undefined;

	private _cache: Map<string, IBrowserPluginCacheEntry> | undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@IRequestService private readonly _requestService: IRequestService,
		@IStorageService private readonly _storageService: IStorageService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
	) { }

	async cloneRepository(cloneUrl: string, targetDir: URI, ref?: string, token?: CancellationToken): Promise<void> {
		const repo = this._parseOrThrow(cloneUrl);
		const cancel = token ?? CancellationToken.None;
		const cloneWithToken = async (authToken: string | undefined): Promise<void> => {
			const sha = await resolveGitHubRefToSha(this._requestService, repo, ref, authToken, cancel);
			await fetchAndExtractGitHubRepo(this._requestService, this._fileService, this._logService, repo, sha, targetDir, authToken, cancel);
			this._setCacheEntry(targetDir, { owner: repo.owner, repo: repo.repo, ref, sha, fetchedAt: Date.now() });
		};

		const initialAuthToken = await this._lookupGitHubToken();
		const attempts: Array<() => Promise<string | undefined>> = [
			async () => initialAuthToken,
		];
		if (initialAuthToken) {
			attempts.push(async () => undefined);
		}
		attempts.push(() => this._requestGitHubToken(repo));

		let lastErr: unknown;
		for (const getToken of attempts) {
			if (cancel.isCancellationRequested) {
				throw new CancellationError();
			}
			try {
				await cloneWithToken(await getToken());
				return;
			} catch (err) {
				lastErr = err;
				this._maybeLogTransientError(err, repo);
				if (!(err instanceof GitHubAuthRequiredError)) {
					throw err;
				}
			}
		}

		if (lastErr instanceof GitHubAuthRequiredError) {
			throw new Error(localize(
				'pluginsBrowserGitHubAccessRequired',
				"GitHub authentication is required to install '{0}'. Sign in with an account that has access to this repository, then try again.",
				`${repo.owner}/${repo.repo}`,
			));
		}
		throw lastErr;
	}

	async pull(repoDir: URI, token?: CancellationToken): Promise<boolean> {
		const entry = this._getCacheEntry(repoDir);
		if (!entry) {
			throw new Error(`Cannot pull plugin: no cached metadata for ${repoDir.toString()}`);
		}
		const cancel = token ?? CancellationToken.None;
		const authToken = await this._lookupGitHubToken();
		const repo: IGitHubRepoRef = { owner: entry.owner, repo: entry.repo };
		try {
			const newSha = await resolveGitHubRefToSha(this._requestService, repo, entry.ref, authToken, cancel);
			if (newSha === entry.sha) {
				return false;
			}
			await fetchAndExtractGitHubRepo(this._requestService, this._fileService, this._logService, repo, newSha, repoDir, authToken, cancel);
			this._setCacheEntry(repoDir, { ...entry, sha: newSha, fetchedAt: Date.now() });
			return true;
		} catch (err) {
			this._maybeLogTransientError(err, repo);
			throw err;
		}
	}

	async checkout(repoDir: URI, treeish: string, _detached?: boolean, token?: CancellationToken): Promise<void> {
		const entry = this._getCacheEntry(repoDir);
		if (!entry) {
			throw new Error(`Cannot checkout plugin: no cached metadata for ${repoDir.toString()}`);
		}

		const cancel = token ?? CancellationToken.None;
		const authToken = await this._lookupGitHubToken();
		const repo: IGitHubRepoRef = { owner: entry.owner, repo: entry.repo };
		const requestedRef = treeish.trim();

		const isFullSha = /^[0-9a-f]{40}$/i.test(requestedRef);
		const requestedSha = isFullSha
			? requestedRef.toLowerCase()
			: await resolveGitHubRefToSha(this._requestService, repo, requestedRef, authToken, cancel);

		await this._materializeCommit(repoDir, entry, requestedSha, isFullSha ? entry.ref : requestedRef, authToken, cancel);
	}

	async checkoutCommit(repoDir: URI, commit: string, token?: CancellationToken): Promise<void> {
		const expectedCommit = commit.trim().toLowerCase();
		if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
			throw new Error(localize('pluginsInvalidPinnedCommit', "Pinned plugin commit '{0}' is not a full SHA-1 hash.", commit));
		}

		const entry = this._getCacheEntry(repoDir);
		if (!entry) {
			throw new Error(`Cannot checkout plugin: no cached metadata for ${repoDir.toString()}`);
		}
		if (entry.sha.toLowerCase() === expectedCommit) {
			return;
		}

		const cancel = token ?? CancellationToken.None;
		const authToken = await this._lookupGitHubToken();
		const repo: IGitHubRepoRef = { owner: entry.owner, repo: entry.repo };
		const resolvedCommit = (await resolveGitHubRefToSha(this._requestService, repo, expectedCommit, authToken, cancel)).toLowerCase();
		if (resolvedCommit !== expectedCommit) {
			throw new Error(localize('pluginsPinnedCommitResolutionMismatch', "Pinned plugin commit '{0}' resolved to a different commit '{1}'.", commit, resolvedCommit));
		}

		await this._materializeCommit(repoDir, entry, resolvedCommit, entry.ref, authToken, cancel);
		const checkedOutCommit = (await this.revParse(repoDir, 'HEAD')).toLowerCase();
		if (checkedOutCommit !== expectedCommit) {
			throw new Error(localize('pluginsPinnedCommitCheckoutMismatch', "Pinned plugin commit '{0}' was not checked out. The repository is at commit '{1}'.", commit, checkedOutCommit));
		}
	}

	async revParse(repoDir: URI, ref: string): Promise<string> {
		const entry = this._getCacheEntry(repoDir);
		if (!entry) {
			throw new Error(`Cannot resolve ref: no cached metadata for ${repoDir.toString()}`);
		}
		const trimmed = ref.trim();
		const isFullSha = /^[0-9a-f]{40}$/i.test(trimmed);
		if (isFullSha && trimmed.toLowerCase() !== entry.sha.toLowerCase()) {
			throw new Error(`Cannot resolve ref '${ref}' in tree-cached plugin: only HEAD/${entry.sha} is materialised`);
		}
		return entry.sha;
	}

	async fetch(_repoDir: URI, _token?: CancellationToken): Promise<void> {
	}

	async fetchRepository(_repoDir: URI, _token?: CancellationToken): Promise<void> {
	}

	async revListCount(_repoDir: URI, _fromRef: string, _toRef: string): Promise<number> {
		return 0;
	}


	private async _materializeCommit(repoDir: URI, entry: IBrowserPluginCacheEntry, commit: string, ref: string | undefined, authToken: string | undefined, token: CancellationToken): Promise<void> {
		if (commit === entry.sha.toLowerCase()) {
			return;
		}

		const repo: IGitHubRepoRef = { owner: entry.owner, repo: entry.repo };
		try {
			await fetchAndExtractGitHubRepo(this._requestService, this._fileService, this._logService, repo, commit, repoDir, authToken, token);
			this._setCacheEntry(repoDir, {
				...entry,
				ref,
				sha: commit,
				fetchedAt: Date.now(),
			});
		} catch (err) {
			this._maybeLogTransientError(err, repo);
			throw err;
		}
	}

	private _parseOrThrow(cloneUrl: string): IGitHubRepoRef {
		const parsed = parseGitHubCloneUrl(cloneUrl);
		if (!parsed) {
			throw new Error(localize(
				'pluginsBrowserUnsupportedHost',
				"Agent plugins in the browser can only be installed from GitHub HTTPS URLs. To install '{0}', use the desktop application or connect to a remote agent host.",
				cloneUrl,
			));
		}
		return parsed;
	}

	private _maybeLogTransientError(err: unknown, repo: IGitHubRepoRef): void {
		if (err instanceof GitHubAuthRequiredError) {
			this._logService.warn(`[BrowserPluginGitCommandService] GitHub auth required for ${repo.owner}/${repo.repo}: ${err.message}`);
		} else if (err instanceof GitHubRateLimitError) {
			const wait = err.retryAfterSeconds !== undefined ? ` (retry after ${err.retryAfterSeconds}s)` : '';
			this._logService.warn(`[BrowserPluginGitCommandService] GitHub rate limit hit for ${repo.owner}/${repo.repo}${wait}: ${err.message}`);
		} else if (err instanceof Error) {
			const cause = err.cause instanceof Error ? ` (cause: ${err.cause.name}: ${err.cause.message})` : '';
			this._logService.error(`[BrowserPluginGitCommandService] Clone failed for ${repo.owner}/${repo.repo}: ${err.message}${cause}`);
		}
	}

	private async _lookupGitHubToken(): Promise<string | undefined> {
		try {
			const sessions = await this._authenticationService.getSessions('github', [], { silent: true });
			if (sessions.length === 0) {
				return undefined;
			}
			const repoScopeSession = sessions.find(session => session.scopes.includes('repo'));
			return repoScopeSession?.accessToken ?? sessions[0].accessToken;
		} catch (err) {
			this._logService.trace('[BrowserPluginGitCommandService] Silent GitHub session lookup failed:', err);
			return undefined;
		}
	}

	private async _requestGitHubToken(repo: IGitHubRepoRef): Promise<string> {
		try {
			const session = await this._authenticationService.createSession('github', ['repo'], { activateImmediate: true });
			return session.accessToken;
		} catch (err) {
			this._logService.trace('[BrowserPluginGitCommandService] GitHub session request failed:', err);
			throw new Error(localize(
				'pluginsBrowserGitHubSignInRequired',
				"Sign in to GitHub with an account that has access to '{0}' to install this plugin.",
				`${repo.owner}/${repo.repo}`,
			));
		}
	}


	private _cacheKey(targetDir: URI): string {
		return getComparisonKey(targetDir, true);
	}

	private async _pruneStaleEntries(cache: Map<string, IBrowserPluginCacheEntry>, knownDirs: ReadonlyMap<string, URI>): Promise<void> {
		const removed: string[] = [];
		await Promise.all(Array.from(knownDirs, async ([key, uri]) => {
			try {
				if (!(await this._fileService.exists(uri))) {
					removed.push(key);
				}
			} catch {
			}
		}));
		if (removed.length === 0) {
			return;
		}
		for (const key of removed) {
			cache.delete(key);
		}
		this._logService.trace(`[BrowserPluginGitCommandService] Pruned ${removed.length} stale cache entries`);
		this._persistCache();
	}

	private _ensureCacheLoaded(): Map<string, IBrowserPluginCacheEntry> {
		if (this._cache) {
			return this._cache;
		}
		const cache = new Map<string, IBrowserPluginCacheEntry>();
		const stored = this._storageService.getObject<IStoredBrowserPluginCache>(BROWSER_CACHE_STORAGE_KEY, StorageScope.APPLICATION);
		const knownDirs = new Map<string, URI>();
		if (stored) {
			for (const [key, entry] of Object.entries(stored)) {
				if (entry && typeof entry.sha === 'string' && typeof entry.owner === 'string' && typeof entry.repo === 'string') {
					cache.set(key, {
						owner: entry.owner,
						repo: entry.repo,
						ref: typeof entry.ref === 'string' ? entry.ref : undefined,
						sha: entry.sha,
						fetchedAt: typeof entry.fetchedAt === 'number' ? entry.fetchedAt : 0,
					});
					try {
						knownDirs.set(key, URI.parse(key));
					} catch {
						cache.delete(key);
					}
				}
			}
		}
		this._cache = cache;
		if (knownDirs.size > 0) {
			this._pruneStaleEntries(cache, knownDirs).catch(err => {
				this._logService.trace('[BrowserPluginGitCommandService] Cache prune failed:', err);
			});
		}
		return cache;
	}

	private _getCacheEntry(targetDir: URI): IBrowserPluginCacheEntry | undefined {
		return this._ensureCacheLoaded().get(this._cacheKey(targetDir));
	}

	private _setCacheEntry(targetDir: URI, entry: IBrowserPluginCacheEntry): void {
		const cache = this._ensureCacheLoaded();
		cache.set(this._cacheKey(targetDir), entry);
		this._persistCache();
	}

	private _persistCache(): void {
		if (!this._cache) {
			return;
		}
		const serialized: IStoredBrowserPluginCache = {};
		for (const [key, entry] of this._cache) {
			serialized[key] = entry;
		}
		if (Object.keys(serialized).length === 0) {
			this._storageService.remove(BROWSER_CACHE_STORAGE_KEY, StorageScope.APPLICATION);
			return;
		}
		this._storageService.store(BROWSER_CACHE_STORAGE_KEY, JSON.stringify(serialized), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}
