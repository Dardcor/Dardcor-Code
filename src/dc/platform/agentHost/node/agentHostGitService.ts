/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fsPromises from 'fs/promises';
import { cp as copyFile } from '@vscode/fs-copyfile';
import * as path from '../../../base/common/path.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { parse } from '../../../base/common/glob.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { FileEditKind, type ISessionFileDiff, type ISessionGitState } from '../common/state/sessionState.js';
import { buildGitBlobUri } from './gitDiffContent.js';
import { CheckoutBlockedByLocalChangesError, EMPTY_TREE_OBJECT, IAddWorktreeOptions, IAgentHostGitService, IBranch, IBranchDiffSafetyInfo, IRefQuery, IComputeSessionFileDiffsOptions, IDefaultBranch, IPullOptions, IPushOptions, GitRefType, IRemoteBranch, GitRef, ITag, Branch, IWorktreeFileProgress } from '../common/agentHostGitService.js';
import { LRUCache } from '../../../base/common/map.js';
import { firstParallel, Limiter, SequencerByKey, timeout } from '../../../base/common/async.js';

const WORKTREE_REMOVAL_MAX_ATTEMPTS = 5;
const WORKTREE_REMOVAL_RETRY_BASE_DELAY_MS = 100;
const WORKTREE_REMOVAL_RETRY_MAX_DELAY_MS = 500;

const SHOW_BLOB_TIMEOUT_MS = 15_000;

export class AgentHostGitService implements IAgentHostGitService {
	declare readonly _serviceBrand: undefined;

	private readonly _repositoryRoots = new LRUCache<string, URI>(100);
	private readonly _repositoryRootSequencer = new SequencerByKey<string>();

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@INativeEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async getCurrentBranch(workingDirectory: URI): Promise<string | undefined> {
		return (await this._runGit(workingDirectory, ['branch', '--show-current']))?.trim()
			|| (await this._runGit(workingDirectory, ['rev-parse', '--short', 'HEAD']))?.trim()
			|| undefined;
	}

	async getCurrentBranchName(workingDirectory: URI): Promise<string | undefined> {
		return (await this._runGit(workingDirectory, ['branch', '--show-current']))?.trim() || undefined;
	}

	async getDefaultBranch(workingDirectory: URI): Promise<IDefaultBranch | undefined> {
		const remoteRef = (await this._runGit(workingDirectory, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']))?.trim();
		if (remoteRef) {
			if (!remoteRef.startsWith('refs/remotes/origin/')) {
				return { name: remoteRef, startPoint: remoteRef };
			}

			const branch = remoteRef.substring('refs/remotes/origin/'.length);
			const hasRemoteRef = (await this._runGit(workingDirectory, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`])) !== undefined;
			if (hasRemoteRef) {
				return { name: branch, startPoint: `origin/${branch}` };
			}
			const hasLocalBranch = (await this._runGit(workingDirectory, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])) !== undefined;
			return hasLocalBranch ? { name: branch, startPoint: branch } : undefined;
		}
		return undefined;
	}

	async getRefs(workingDirectory: URI, query?: IRefQuery): Promise<GitRef[]> {
		const args = ['for-each-ref', '--format=%(refname)%00%(upstream)'];

		if (query?.sort && query.sort !== 'alphabetically') {
			args.push('--sort', `-${query.sort}`);
		}

		if (query?.count) {
			args.push(`--count=${query.count}`);
		}

		if (query?.pattern) {
			const patterns = Array.isArray(query.pattern) ? query.pattern : [query.pattern];
			for (const pattern of patterns) {
				args.push(pattern.startsWith('refs/') ? pattern : `refs/${pattern}`);
			}
		}

		const output = await this._runGit(workingDirectory, args);
		return parseGitRefs(output);
	}

	async getBranches(workingDirectory: URI, query?: IRefQuery): Promise<Branch[]> {
		const refs = await this.getRefs(workingDirectory, query);
		return refs.filter(r => r.kind === GitRefType.Head || r.kind === GitRefType.RemoteHead);
	}

	async getBranch(workingDirectory: URI, name: string): Promise<Branch | undefined> {
		const refs = await this.getBranches(workingDirectory, { pattern: name });
		return refs.length > 0 ? refs[0] : undefined;
	}

	async getRepositoryRoot(workingDirectory: URI): Promise<URI | undefined> {
		const workingDirectoryKey = workingDirectory.toString();

		return this._repositoryRootSequencer.queue(workingDirectoryKey, async () => {
			let repositoryRoot = this._repositoryRoots.get(workingDirectoryKey);
			if (repositoryRoot) {
				return repositoryRoot;
			}

			try {
				const repositoryRootPath = (await this._runGit(workingDirectory, ['rev-parse', '--show-toplevel']))?.trim();
				if (repositoryRootPath) {
					repositoryRoot = URI.file(repositoryRootPath);
					this._repositoryRoots.set(workingDirectoryKey, repositoryRoot);
				}

				return repositoryRoot;
			} catch (error) { }

			return undefined;
		});
	}

	async getWorktreeRoots(workingDirectory: URI): Promise<URI[]> {
		return this._parseWorktreeRoots(await this._runGit(workingDirectory, ['worktree', 'list', '--porcelain']));
	}

	private _parseWorktreeRoots(porcelainOutput: string | undefined): URI[] {
		if (!porcelainOutput) {
			return [];
		}
		return porcelainOutput.split(/\r?\n/g)
			.filter(line => line.startsWith('worktree '))
			.map(line => URI.file(line.substring('worktree '.length)));
	}

	async addWorktree(repositoryRoot: URI, options: IAddWorktreeOptions): Promise<void> {
		const resolvedCommitish = options.preferRemoteBranch
			? await this._resolveRemoteTrackingBranch(repositoryRoot, options.commitish, options.track) ?? options.commitish
			: options.commitish;

		const args = ['-c', 'checkout.workers=0', 'worktree', 'add'];

		if (options.newBranchName) {
			if (!options.track) {
				args.push('--no-track');
			}

			args.push('-b', options.newBranchName);
		}

		args.push(options.path.fsPath, resolvedCommitish);

		const progressParser = options.onProgress ? new GitCheckoutProgressParser(options.onProgress) : undefined;

		await this._runGit(repositoryRoot, args, {
			timeout: 180_000,
			throwOnError: true,
			...(progressParser ? { env: { GIT_PROGRESS_DELAY: '0' }, onStderr: chunk => progressParser.push(chunk) } : {}),
		});
	}

	async copyWorktreeIncludeFiles(repositoryRoot: URI, worktree: URI, globs: readonly string[], onProgress?: (progress: IWorktreeFileProgress) => void): Promise<void> {
		try {
			const worktreeIncludePaths = await this._getWorktreeIncludePaths(repositoryRoot, worktree, globs);
			if (worktreeIncludePaths.length === 0) {
				return;
			}

			const startTime = performance.now();
			const limiter = new Limiter<void>(15);
			const filesTotal = worktreeIncludePaths.reduce((total, entry) => total + entry.fileCount, 0);
			let filesDone = 0;
			const results = await Promise.allSettled(worktreeIncludePaths.map(entry => limiter.queue(async () => {
				const targetPath = path.join(worktree.fsPath, path.relative(repositoryRoot.fsPath, entry.sourcePath));
				await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
				await copyFile(entry.sourcePath, targetPath, { force: true, recursive: true, verbatimSymlinks: true });
				filesDone += entry.fileCount;
				onProgress?.({ filesDone, filesTotal });
			})));

			const failedOperations = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
			this._logService.info(`[AgentHostGitService][copyWorktreeIncludeFiles] Copied ${worktreeIncludePaths.length - failedOperations.length}/${worktreeIncludePaths.length} folder(s)/file(s) to worktree ${worktree.fsPath}. [${(performance.now() - startTime).toFixed(2)}ms]`);

			if (failedOperations.length > 0) {
				this._logService.warn(`[AgentHostGitService][copyWorktreeIncludeFiles] Failed to copy ${failedOperations.length} folder(s)/file(s) to worktree ${worktree.fsPath}.`);
				for (const error of failedOperations) {
					this._logService.warn(`[AgentHostGitService][copyWorktreeIncludeFiles] ${error.reason}`);
				}
			}
		} catch (error) {
			this._logService.warn(`[AgentHostGitService][copyWorktreeIncludeFiles] Failed to copy folder(s)/file(s) to worktree ${worktree.fsPath}: ${error}`);
		}
	}

	async addExistingWorktree(repositoryRoot: URI, worktree: URI, branchName: string): Promise<void> {
		await this._runGit(repositoryRoot, ['-c', 'checkout.workers=0', 'worktree', 'add', '-f', worktree.fsPath, branchName], { timeout: 180_000, throwOnError: true });
	}

	async removeWorktree(repositoryRoot: URI, worktree: URI, options?: { readonly force?: boolean }): Promise<void> {
		const removeArgs = ['worktree', 'remove'];
		if (options?.force) {
			removeArgs.push('--force');
		}
		removeArgs.push(worktree.fsPath);

		let lastError: unknown;
		for (let attempt = 0; attempt < WORKTREE_REMOVAL_MAX_ATTEMPTS; attempt++) {
			if (attempt > 0) {
				await timeout(Math.min(WORKTREE_REMOVAL_RETRY_MAX_DELAY_MS, WORKTREE_REMOVAL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
			}
			try {
				if (await this._pathExists(worktree.fsPath)) {
					await this._runGit(repositoryRoot, removeArgs, { timeout: 60_000, throwOnError: true });
				} else {
					await this._runGit(repositoryRoot, ['worktree', 'prune'], { timeout: 60_000, throwOnError: true });
				}
				if (!await this._isWorktreeRegistered(repositoryRoot, worktree)) {
					return;
				}
				lastError = new Error(`git worktree removal left '${worktree.fsPath}' registered (admin directory not deleted)`);
			} catch (error) {
				lastError = error;
				if (!isRetryableWorktreeRemovalError(error)) {
					if (!await this._isWorktreeRegistered(repositoryRoot, worktree)) {
						this._logService.trace(`[agentHostGitService] worktree '${worktree.fsPath}' already de-registered; treating removal as complete`);
						return;
					}
					throw error;
				}
			}
			if (attempt < WORKTREE_REMOVAL_MAX_ATTEMPTS - 1) {
				this._logService.warn(`[agentHostGitService] worktree removal attempt ${attempt + 1}/${WORKTREE_REMOVAL_MAX_ATTEMPTS} did not complete for '${worktree.fsPath}', retrying: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
			}
		}
		throw lastError;
	}

	private async _pathExists(fsPath: string): Promise<boolean> {
		try {
			await fsPromises.access(fsPath);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException)?.code !== 'ENOENT';
		}
	}

	private async _isWorktreeRegistered(repositoryRoot: URI, worktree: URI): Promise<boolean> {
		let registered: URI[];
		try {
			registered = this._parseWorktreeRoots(await this._runGit(repositoryRoot, ['worktree', 'list', '--porcelain'], { throwOnError: true }));
		} catch {
			return true;
		}
		if (registered.length === 0) {
			return false;
		}
		const target = await this._canonicalizeWorktreePath(worktree);
		const matched = await firstParallel(
			registered.map(async entry =>
				extUriBiasedIgnorePathCase.isEqual(entry, worktree)
				|| extUriBiasedIgnorePathCase.isEqual(await this._canonicalizeWorktreePath(entry), target)),
			isMatch => isMatch,
			false,
		);
		return matched ?? false;
	}

	private async _canonicalizeWorktreePath(worktree: URI): Promise<URI> {
		try {
			const parentReal = await fsPromises.realpath(path.dirname(worktree.fsPath));
			return URI.file(path.join(parentReal, path.basename(worktree.fsPath)));
		} catch {
			return worktree;
		}
	}

	async branchExists(repositoryRoot: URI, branchName: string): Promise<boolean> {
		const output = await this._runGit(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
		return output !== undefined;
	}

	async createBranch(workingDirectory: URI, branchName: string, options?: { readonly checkout?: boolean }): Promise<void> {
		const args = options?.checkout
			? ['checkout', '-q', '-b', branchName, '--no-track']
			: ['branch', '-q', branchName];

		await this._runGit(workingDirectory, args, { throwOnError: true });
	}

	async checkout(workingDirectory: URI, treeish: string): Promise<void> {
		try {
			await this._runGit(workingDirectory, ['checkout', '-q', treeish], {
				throwOnError: true,
				env: { LANG: 'C', LC_ALL: 'C' },
			});
		} catch (error) {
			if (error instanceof GitCommandError && isCheckoutBlockedByLocalChanges(error.stderr)) {
				throw new CheckoutBlockedByLocalChangesError(error.message, { cause: error });
			}
			throw error;
		}
	}

	async hasUncommittedChanges(workingDirectory: URI): Promise<boolean> {
		const output = await this._runGitStatus(workingDirectory, ['--porcelain']);
		return !!output && output.trim().length > 0;
	}

	async createStash(workingDirectory: URI, options?: { readonly message?: string; readonly includeUntracked?: boolean; readonly staged?: boolean }): Promise<void> {
		const args = ['stash', 'push'];

		if (options?.includeUntracked) {
			args.push('-u');
		}

		if (options?.staged) {
			args.push('-S');
		}

		if (options?.message) {
			args.push('-m', options.message);
		}

		await this._runGit(workingDirectory, args, { timeout: 60_000, throwOnError: true });
	}

	async commitAll(workingDirectory: URI, message: string): Promise<void> {
		await this._runGit(workingDirectory, ['add', '-A', '--', ':/'], { throwOnError: true });
		await this._runGit(workingDirectory, ['commit', '--no-verify', '-m', message], { timeout: 60_000, throwOnError: true });
	}

	async mergeBranch(workingDirectory: URI, branchName: string): Promise<string> {
		const existingMergeHead = await this._runGit(workingDirectory, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
		if (existingMergeHead) {
			throw new Error(`Cannot merge '${branchName}' because another merge is already in progress.`);
		}
		try {
			return (await this._runGit(workingDirectory, ['merge', '--no-edit', '--', branchName], { timeout: 60_000, throwOnError: true }))?.trim() ?? '';
		} catch (error) {
			const mergeHead = await this._runGit(workingDirectory, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
			if (mergeHead) {
				try {
					await this._runGit(workingDirectory, ['merge', '--abort'], { timeout: 60_000, throwOnError: true });
				} catch (abortError) {
					const mergeMessage = error instanceof Error ? error.message : String(error);
					const abortMessage = abortError instanceof Error ? abortError.message : String(abortError);
					throw new Error(`Merge failed and could not be aborted: ${mergeMessage}; ${abortMessage}`, { cause: error });
				}
			}
			throw error;
		}
	}

	async restore(workingDirectory: URI, paths: readonly string[], options?: { readonly staged?: boolean; readonly ref?: string }): Promise<void> {
		const args = ['restore'];

		if (options?.staged) {
			args.push('--staged');
		}

		if (options?.ref) {
			args.push('--source', options.ref);
		}

		if (paths.length === 0) {
			paths = ['.'];
		}

		await this._runGit(workingDirectory, [...args, '--', ...paths], { throwOnError: true });
	}

	async hasUpstream(workingDirectory: URI, branchName: string): Promise<boolean> {
		const output = await this._runGit(workingDirectory, ['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`]);
		return output !== undefined && output.trim().length > 0;
	}

	async pull(workingDirectory: URI, options?: IPullOptions): Promise<void> {
		const args = ['pull'];

		if (options?.rebase) {
			args.push('-r');
		}

		if (options?.remote || options?.ref) {
			args.push(options.remote ?? 'origin');

			if (options.ref) {
				args.push(options.ref);
			}
		}

		await this._runGit(workingDirectory, args, { timeout: 180_000, throwOnError: true });
	}

	async push(workingDirectory: URI, options?: IPushOptions): Promise<void> {
		const args = ['push'];

		if (options?.setUpstream) {
			args.push('--set-upstream');
		}

		if (options?.remote || options?.ref) {
			args.push(options.remote ?? 'origin');

			if (options.ref) {
				args.push(options.ref);
			}
		}

		await this._runGit(workingDirectory, args, { timeout: 180_000, throwOnError: true });
	}

	async computeSessionFileDiffs(workingDirectory: URI, options: IComputeSessionFileDiffsOptions): Promise<readonly ISessionFileDiff[] | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		const mergeBaseCommit = await this._resolveBranchMergeBaseCommit(repositoryRoot, options.baseBranch);

		const statusOut = await this._runGitStatus(repositoryRoot, ['--porcelain=v1', '-z', '--untracked-files=all']);
		if (statusOut === undefined) {
			return undefined;
		}
		const hasUntracked = parseUntrackedPaths(statusOut).length > 0;

		let rawDiffOutput: string | undefined;
		if (!hasUntracked) {
			rawDiffOutput = await this._runGit(repositoryRoot, ['diff', '--raw', '--numstat', '--diff-filter=ADMR', '-z', mergeBaseCommit, '--']);
		} else {
			const changedPaths = parseChangedPaths(statusOut);
			rawDiffOutput = await this._runWithTempIndex(repositoryRoot, mergeBaseCommit, changedPaths);
		}

		if (rawDiffOutput === undefined) {
			return undefined;
		}

		return parseGitDiffRawNumstat(rawDiffOutput, repositoryRoot, options.sessionUri, mergeBaseCommit);
	}

	async resolveBranchBaselineCommit(workingDirectory: URI, baseBranch?: string): Promise<string | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		return this._resolveBranchMergeBaseCommit(repositoryRoot, baseBranch);
	}

	private async _resolveBranchMergeBaseCommit(repositoryRoot: URI, baseBranch?: string): Promise<string> {
		let mergeBaseCommit: string | undefined;
		if (baseBranch) {
			const resolvedBase = await this._resolveRemoteTrackingBranch(repositoryRoot, baseBranch) ?? baseBranch;
			mergeBaseCommit = (await this._runGit(repositoryRoot, ['merge-base', 'HEAD', resolvedBase]))?.trim();
		}
		if (!mergeBaseCommit) {
			mergeBaseCommit = (await this._runGit(repositoryRoot, ['rev-parse', 'HEAD']))?.trim();
		}

		return mergeBaseCommit ?? EMPTY_TREE_OBJECT;
	}

	private async _runWithTempIndex(repositoryRoot: URI, mergeBaseCommit: string, changedPaths: readonly string[]): Promise<string | undefined> {
		const tempDir = URI.joinPath(this._environmentService.tmpDir, `agent-host-git-diff-${generateUuid()}`);
		await this._fileService.createFolder(tempDir);
		const indexFile = URI.joinPath(tempDir, 'index').fsPath;
		const env: Record<string, string> = { GIT_INDEX_FILE: indexFile };
		env.COMMAND_HOOK_LOCK = '1';
		try {
			const seeded = await this._runGit(repositoryRoot, ['read-tree', 'HEAD'], { env });
			if (seeded === undefined) {
				await this._runGit(repositoryRoot, ['read-tree', EMPTY_TREE_OBJECT], { env });
			}
			if (!(await this._stageChangedPaths(repositoryRoot, tempDir, changedPaths, env))) {
				return undefined;
			}
			return await this._runGit(repositoryRoot, ['diff', '--cached', '--raw', '--numstat', '--diff-filter=ADMR', '-z', mergeBaseCommit, '--'], { env });
		} finally {
			try { await this._fileService.del(tempDir, { recursive: true, useTrash: false }); } catch { }
		}
	}

	private async _stageChangedPaths(repositoryRoot: URI, tempDir: URI, changedPaths: readonly string[], env: Record<string, string>): Promise<boolean> {
		if (changedPaths.length === 0) {
			return true;
		}
		const pathspecFile = URI.joinPath(tempDir, 'pathspec');
		await this._fileService.writeFile(pathspecFile, VSBuffer.fromString(changedPaths.join('\x00') + '\x00'));
		this._logService.debug(`[agentHostGitService] Staging ${changedPaths.length} changed path(s) into temp index`);
		return await this._runGit(repositoryRoot, ['add', '-A', `--pathspec-from-file=${pathspecFile.fsPath}`, '--pathspec-file-nul'], {
			env: { ...env, GIT_LITERAL_PATHSPECS: '1' },
		}) !== undefined;
	}

	private async _resolveRemoteTrackingBranch(repositoryRoot: URI, branch: string, fetchIfMissing = false): Promise<string | undefined> {
		const trackingRef = getRemoteTrackingRef(branch);
		if (!trackingRef) {
			return undefined;
		}
		const { branchName, remoteBranch, remoteRef, sourceRef } = trackingRef;
		const output = await this._runGit(repositoryRoot, ['show-ref', '--verify', '--quiet', remoteRef]);
		if (output !== undefined) {
			return remoteBranch;
		}
		if (!fetchIfMissing || branchName === 'HEAD' || /^[0-9a-f]{40}$/i.test(branchName)) {
			return undefined;
		}

		this._logService.info(`[AgentHostGitService] Fetching tracked branch '${branchName}' from origin.`);
		await this._runGit(repositoryRoot, ['fetch', '--no-tags', 'origin', `${sourceRef}:${remoteRef}`], {
			timeout: 60_000,
			throwOnError: true,
		});
		return remoteBranch;
	}

	private async _getWorktreeIncludePaths(repositoryRoot: URI, worktreeRoot: URI, globs: readonly string[]): Promise<IWorktreeIncludeEntry[]> {
		if (globs.length === 0) {
			return [];
		}

		const baseArgs = ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'];
		const [filesOutput, directoryOutput, worktreeOutput] = await Promise.all([
			this._runGit(repositoryRoot, baseArgs, { timeout: 60_000 }),
			this._runGit(repositoryRoot, [...baseArgs, '--directory', '--no-empty-directory'], { timeout: 60_000 }),
			this._runGit(worktreeRoot, ['ls-files', '-z'], { timeout: 60_000 }),
		]);
		if (!filesOutput) {
			return [];
		}

		const ignoredFiles = filesOutput.split('\x00').filter(entry => entry.length > 0);
		if (ignoredFiles.length === 0) {
			return [];
		}

		const matchers = globs.map(pattern => parse(pattern));
		const wholeDirectories = new Set((directoryOutput ?? '')
			.split('\x00').filter(entry => entry.endsWith('/')));
		const worktreeFiles = new Set((worktreeOutput ?? '')
			.split('\x00').filter(entry => entry.length > 0));

		const worktreeDirectories = new Set<string>();
		for (const file of worktreeFiles) {
			let index = file.indexOf('/');
			while (index !== -1) {
				worktreeDirectories.add(file.slice(0, index + 1));
				index = file.indexOf('/', index + 1);
			}
		}

		const matchedFiles: string[] = [];
		const nonCollapsibleDirectories = new Set<string>();
		for (const file of ignoredFiles) {
			if (
				matchers.some(matcher => matcher(file)) &&
				!hasWorktreePathCollision(file, worktreeFiles, worktreeDirectories)
			) {
				matchedFiles.push(file);
			} else if (wholeDirectories.size > 0) {
				const containingDirectory = findContainingDirectory(file, wholeDirectories);
				if (containingDirectory !== undefined) {
					nonCollapsibleDirectories.add(containingDirectory);
				}
			}
		}

		if (matchedFiles.length === 0) {
			return [];
		}

		const collapsedDirectories = new Set<string>();
		for (const dir of wholeDirectories) {
			if (!nonCollapsibleDirectories.has(dir)) {
				collapsedDirectories.add(dir);
			}
		}

		return toWorktreeIncludeEntries(repositoryRoot, matchedFiles, collapsedDirectories);
	}

	async showBlob(workingDirectory: URI, ref: string, repoRelativePath: string): Promise<VSBuffer | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		const args = ['show', `${ref}:${repoRelativePath}`];
		this._logService.trace(`[agentHostGitService] > git ${args.join(' ')}`);

		return new Promise((resolve) => {
			cp.execFile('git', args, { cwd: workingDirectory.fsPath, timeout: SHOW_BLOB_TIMEOUT_MS, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
				if (error) {
					this._logService.warn(`[agentHostGitService] > git ${args.join(' ')} failed: ${formatGitError(args, SHOW_BLOB_TIMEOUT_MS, error.killed === true, error, (stderr as Buffer).toString())}`);
					resolve(undefined);
					return;
				}
				resolve(VSBuffer.wrap(stdout as Buffer));
			});
		});
	}

	async getSessionGitState(workingDirectory: URI, baseBranchName?: string): Promise<ISessionGitState | undefined> {
		return this._computeSessionGitState(workingDirectory, baseBranchName);
	}

	async getFetchRemoteUrls(workingDirectory: URI, preferredRemote?: string): Promise<readonly string[] | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}
		return parseFetchRemoteUrls(await this._runGit(repositoryRoot, ['remote', '-v']), preferredRemote);
	}

	async getUntrackedPaths(workingDirectory: URI): Promise<readonly string[] | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}
		const status = await this._runGitStatus(repositoryRoot, ['--porcelain=v1', '-z', '--untracked-files=all']);
		return status === undefined ? undefined : parseUntrackedPaths(status);
	}

	async captureWorkingTreeAsTree(workingDirectory: URI): Promise<string | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		const statusOut = await this._runGitStatus(repositoryRoot, ['--porcelain=v1', '-z', '--untracked-files=all']);
		if (statusOut === undefined) {
			return undefined;
		}
		const changedPaths = parseChangedPaths(statusOut);
		const tempDir = URI.joinPath(this._environmentService.tmpDir, `agent-host-checkpoint-${generateUuid()}`);
		await this._fileService.createFolder(tempDir);
		const indexFile = URI.joinPath(tempDir, 'index').fsPath;
		const env: Record<string, string> = { GIT_INDEX_FILE: indexFile, COMMAND_HOOK_LOCK: '1' };
		try {
			const seeded = await this._runGit(repositoryRoot, ['read-tree', 'HEAD'], { env });
			if (seeded === undefined) {
				await this._runGit(repositoryRoot, ['read-tree', EMPTY_TREE_OBJECT], { env });
			}
			if (!(await this._stageChangedPaths(repositoryRoot, tempDir, changedPaths, env))) {
				return undefined;
			}
			const tree = (await this._runGit(repositoryRoot, ['write-tree'], { env }))?.trim();
			return tree || undefined;
		} finally {
			try { await this._fileService.del(tempDir, { recursive: true, useTrash: false }); } catch { }
		}
	}

	async commitTree(repositoryRoot: URI, treeOid: string, parentOid: string | undefined, message: string): Promise<string | undefined> {
		const args = ['commit-tree', treeOid];
		if (parentOid) {
			args.push('-p', parentOid);
		}
		args.push('-m', message);
		const out = await this._runGit(repositoryRoot, args, { throwOnError: true });
		return out?.trim() || undefined;
	}

	async updateRef(repositoryRoot: URI, ref: string, newOid: string): Promise<void> {
		await this._runGit(repositoryRoot, ['update-ref', ref, newOid], { throwOnError: true });
	}

	async deleteRefs(repositoryRoot: URI, refs: readonly string[]): Promise<void> {
		if (refs.length === 0) {
			return;
		}
		const stdin = refs.map(ref => `delete ${ref}\x00\x00`).join('');
		await new Promise<void>((resolve) => {
			const proc = cp.execFile('git', ['update-ref', '--stdin', '-z'], { cwd: repositoryRoot.fsPath, timeout: 10_000 }, () => {
				resolve();
			});
			proc.stdin?.end(stdin);
		});
	}

	async revParse(repositoryRoot: URI, expression: string): Promise<string | undefined> {
		const out = await this._runGit(repositoryRoot, ['rev-parse', '--verify', '--quiet', expression]);
		return out?.trim() || undefined;
	}

	async listRefNamesWithOids(repositoryRoot: URI, pattern: string): Promise<Array<{ readonly ref: string; readonly oid: string }>> {
		const out = await this._runGit(repositoryRoot, ['for-each-ref', '--format=%(refname)%00%(objectname)', pattern]);
		if (!out) {
			return [];
		}
		const result: Array<{ ref: string; oid: string }> = [];
		for (const line of out.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const [ref, oid] = trimmed.split('\x00');
			if (ref && oid) {
				result.push({ ref, oid });
			}
		}
		return result;
	}

	async overlayPathIntoTree(repositoryRoot: URI, baseTreeOid: string, path: string, sourceTreeOid: string): Promise<string | undefined> {
		const tempDir = URI.joinPath(this._environmentService.tmpDir, `agent-host-review-overlay-${generateUuid()}`);
		await this._fileService.createFolder(tempDir);
		const indexFile = URI.joinPath(tempDir, 'index').fsPath;
		const env: Record<string, string> = { GIT_INDEX_FILE: indexFile, COMMAND_HOOK_LOCK: '1' };

		try {
			const readTreeOut = await this._runGit(repositoryRoot, ['read-tree', baseTreeOid], { env, throwOnError: false });
			if (readTreeOut === undefined) {
				return undefined;
			}

			const lsTreeOut = await this._runGit(repositoryRoot, ['ls-tree', '-z', sourceTreeOid, '--', path], { env });
			const entry = parseSingleLsTreeEntry(lsTreeOut);
			if (entry) {
				const updateIndexOut = await this._runGit(repositoryRoot, ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.oid},${path}`], { env, throwOnError: false });
				if (updateIndexOut === undefined) {
					return undefined;
				}
			} else {
				const updateIndexOut = await this._runGit(repositoryRoot, ['update-index', '--force-remove', '--', path], { env, throwOnError: false });
				if (updateIndexOut === undefined) {
					return undefined;
				}
			}

			const writeTreeOut = await this._runGit(repositoryRoot, ['write-tree'], { env });
			return writeTreeOut?.trim();
		} finally {
			try {
				await this._fileService.del(tempDir, { recursive: true, useTrash: false });
			} catch { }
		}
	}

	async diffTreePaths(repositoryRoot: URI, fromTreeish: string, toTreeish: string): Promise<string[] | undefined> {
		const out = await this._runGit(repositoryRoot, ['diff', '--name-only', '--no-renames', '-z', fromTreeish, toTreeish, '--']);
		if (out === undefined) {
			return undefined;
		}
		return out.split('\x00').filter(Boolean);
	}

	async computeFileDiffsBetweenRefs(workingDirectory: URI, options: { readonly sessionUri: string; readonly fromRef: string; readonly toRef: string }): Promise<readonly ISessionFileDiff[] | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		try {
			const raw = await this._runGit(repositoryRoot, ['diff', '--raw', '--numstat', '--diff-filter=ADMR', '-z', options.fromRef, options.toRef, '--']);
			if (raw === undefined) {
				return undefined;
			}

			return parseGitDiffRawNumstat(raw, repositoryRoot, options.sessionUri, options.fromRef, options.toRef);
		} catch (err) {
			this._logService.warn(`[AgentHostGitService][computeFileDiffsBetweenRefs] Failed to compute file diffs ${repositoryRoot.toString()}, ${options.fromRef}, ${options.toRef}: ${err}`);
			return undefined;
		}
	}

	async getBranchDiffSafetyInfo(workingDirectory: URI, baselineCommit: string): Promise<IBranchDiffSafetyInfo | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		const [virtualFileSystem, sparseCheckout, timestamp, commitCount, workspaceFiles] = await Promise.all([
			this._runGit(repositoryRoot, ['config', '--get', 'core.virtualfilesystem']),
			this._runGit(repositoryRoot, ['config', '--get', 'core.sparsecheckout']),
			this._runGit(repositoryRoot, ['show', '-s', '--format=%ct', baselineCommit]),
			this._runGit(repositoryRoot, ['rev-list', '--count', `${baselineCommit}..HEAD`]),
			this._runGit(repositoryRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
		]);
		const sparseCheckoutEnabled = new Set(['true', 'yes', 'on', '1']).has(sparseCheckout?.trim().toLowerCase() ?? '');
		const timestampSeconds = Number(timestamp?.trim());
		const parsedCommitCount = Number(commitCount?.trim());
		return {
			hasVirtualFileSystem: Boolean(virtualFileSystem?.trim()) || sparseCheckoutEnabled,
			baselineCommitTimestamp: Number.isFinite(timestampSeconds) ? timestampSeconds * 1000 : undefined,
			commitCount: Number.isFinite(parsedCommitCount) ? parsedCommitCount : undefined,
			workspaceFileCount: workspaceFiles?.split('\x00').filter(Boolean).length ?? 0,
		};
	}

	async getDiffPatchBetweenRefs(workingDirectory: URI, options: { readonly fromRef: string; readonly toRef: string; readonly paths: readonly string[]; readonly maxBuffer: number }): Promise<{ readonly patch: string | undefined; readonly tooLarge: boolean } | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}
		const paths = [...new Set(options.paths)];
		if (paths.length === 0) {
			return { patch: '', tooLarge: false };
		}
		try {
			const patch = await this._runGit(repositoryRoot, ['diff', '--patch', '--no-ext-diff', '--find-renames', '--diff-filter=ADMR', options.fromRef, options.toRef, '--', ...paths], { maxBuffer: options.maxBuffer, throwOnError: true });
			return patch === undefined ? undefined : { patch, tooLarge: false };
		} catch (error) {
			if (isMaxBufferError(error)) {
				return { patch: undefined, tooLarge: true };
			}
			throw error;
		}
	}

	private async _computeSessionGitState(workingDirectory: URI, configuredBaseBranch?: string): Promise<ISessionGitState | undefined> {
		const repositoryRoot = await this.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		const [
			statusOutput,
			remotesOutput,
			defaultBranchRef,
		] = await Promise.all([
			this._runGitStatus(repositoryRoot, ['-b', '--porcelain=v2']),
			this._runGit(repositoryRoot, ['remote', '-v']),
			configuredBaseBranch ? undefined : this._runGit(repositoryRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']),
		]);

		if (statusOutput === undefined) {
			this._logService.warn(`[agentHostGitService] Not reporting session git state because git status failed: ${repositoryRoot.fsPath}`);
			return undefined;
		}

		const status = parseGitStatusV2(statusOutput);
		const hasGitHubRemote = parseHasGitHubRemote(remotesOutput);
		const baseBranchName = configuredBaseBranch ?? parseDefaultBranchRef(defaultBranchRef);
		const githubRepo = parseGitHubRepoFromRemote(remotesOutput);
		const upstreamRemote = status.upstreamBranchName?.split('/')[0];
		const [pushRemote, baseBranchDivergence] = await Promise.all([
			!upstreamRemote && status.branchName
				? this._getPushRemote(repositoryRoot, status.branchName)
				: undefined,
			baseBranchName && status.branchName && status.branchName !== baseBranchName
				? this._computeBaseBranchDivergence(repositoryRoot, baseBranchName, status.outgoingChanges === undefined)
				: undefined,
		]);
		const githubHeadRepo = upstreamRemote
			? parseGitHubRepoFromRemote(remotesOutput, upstreamRemote)
			: parseGitHubHeadRepoFromRemoteSelection(remotesOutput, pushRemote);

		let outgoingChanges = status.outgoingChanges;
		if (outgoingChanges === undefined) {
			outgoingChanges = baseBranchDivergence?.count;
		}

		const result: ISessionGitState = {
			hasGitHubRemote,
			branchName: status.branchName,
			isDetachedHead: status.isDetachedHead,
			baseBranchName,
			upstreamBranchName: status.upstreamBranchName,
			incomingChanges: status.incomingChanges,
			outgoingChanges,
			uncommittedChanges: status.uncommittedChanges,
			hasBaseBranchChanges: baseBranchDivergence?.hasChanges,
			githubOwner: githubRepo?.owner,
			githubHeadOwner: githubHeadRepo?.owner,
			githubRepo: githubRepo?.repo,
		};
		return stripUndefined(result);
	}

	private async _getPushRemote(repositoryRoot: URI, branchName: string): Promise<string | undefined> {
		return (await this._runGit(repositoryRoot, ['for-each-ref', '--format=%(push:remotename)', `refs/heads/${branchName}`]))?.trim() || undefined;
	}

	private async _computeBaseBranchDivergence(repositoryRoot: URI, baseBranchName: string, countCommits: boolean): Promise<{ readonly hasChanges: boolean; readonly count?: number } | undefined> {
		const localRef = `refs/heads/${baseBranchName}`;
		const remoteRef = `refs/remotes/origin/${baseBranchName}`;
		const refs = await this._runGit(repositoryRoot, ['for-each-ref', '--format=%(refname)', localRef, remoteRef]);
		if (refs === undefined) {
			return undefined;
		}
		const refNames = new Set(refs.split(/\r?\n/g).filter(Boolean));
		const baseBranchRef = refNames.has(localRef) ? localRef : refNames.has(remoteRef) ? remoteRef : baseBranchName;
		const output = await this._runGit(repositoryRoot, ['rev-list', countCommits ? '--count' : '--max-count=1', `${baseBranchRef}..HEAD`]);
		if (output === undefined) {
			return undefined;
		}
		if (!countCommits) {
			return { hasChanges: output.trim().length > 0 };
		}
		const count = Number(output.trim());
		return Number.isFinite(count) ? { hasChanges: count > 0, count } : undefined;
	}

	private _runGitStatus(workingDirectory: URI, args: readonly string[]): Promise<string | undefined> {
		return this._runGit(workingDirectory, ['status', ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } });
	}

	private _runGit(workingDirectory: URI, args: readonly string[], options?: { readonly timeout?: number; readonly throwOnError?: boolean; readonly env?: Record<string, string>; readonly maxBuffer?: number; readonly onStderr?: (chunk: string) => void }): Promise<string | undefined> {
		this._logService.trace(`[agentHostGitService] > git ${args.join(' ')}`);

		return new Promise((resolve, reject) => {
			const env = options?.env ? { ...process.env, ...options.env } : undefined;
			const timeoutMs = options?.timeout ?? 5000;
			let didTimeOut = false;
			const child = cp.execFile('git', [...args], { cwd: workingDirectory.fsPath, env, maxBuffer: options?.maxBuffer ?? 32 * 1024 * 1024 }, (error, stdout, stderr) => {
				if (error) {
					if (stderr) {
						this._logService.warn(`[agentHostGitService] > git ${args.join(' ')} failed; full stderr:\n${stderr}`);
					} else if (didTimeOut || error.killed) {
						this._logService.warn(`[agentHostGitService] > git ${args.join(' ')} failed: ${formatGitError(args, timeoutMs, didTimeOut, error, stderr)}`);
					} else {
						this._logService.trace(`[agentHostGitService] > git ${args.join(' ')} failed: ${formatGitError(args, timeoutMs, didTimeOut, error, stderr)}`);
					}
					if (options?.throwOnError) {
						reject(new GitCommandError(formatGitError(args, timeoutMs, didTimeOut, error, stderr), stderr, error));
						return;
					}
					resolve(undefined);
					return;
				}
				resolve(stdout);
			});
			const onStderr = options?.onStderr;
			if (onStderr) {
				child.stderr?.on('data', (chunk: Buffer | string) => onStderr(chunk.toString()));
			}
			const timer = setTimeout(() => {
				didTimeOut = true;
				child.kill();
			}, timeoutMs);
			child.on('exit', () => clearTimeout(timer));
		});
	}
}

class GitCommandError extends Error {
	constructor(message: string, readonly stderr: string, cause: cp.ExecFileException) {
		super(message, { cause });
	}
}

function isCheckoutBlockedByLocalChanges(stderr: string): boolean {
	return /(?:local changes to the following files|untracked working tree files) would be overwritten by checkout:/i.test(stderr);
}

export function getRemoteTrackingRef(branch: string): { branchName: string; remoteBranch: string; remoteRef: string; sourceRef: string } | undefined {
	const pullRequestRef = /^refs\/pull\/(?<number>\d+)\/head$/.exec(branch);
	const branchName = pullRequestRef?.groups
		? `pull/${pullRequestRef.groups.number}/head`
		: branch
			.replace(/^refs\/remotes\/origin\//, '')
			.replace(/^origin\//, '')
			.replace(/^refs\/heads\//, '');
	if (branchName.startsWith('refs/')) {
		return undefined;
	}
	const remoteBranch = `origin/${branchName}`;
	return {
		branchName,
		remoteBranch,
		remoteRef: `refs/remotes/${remoteBranch}`,
		sourceRef: pullRequestRef ? branch : `refs/heads/${branchName}`,
	};
}

export class GitCheckoutProgressParser {

	private static readonly _pattern = /Updating files:\s+\d+% \((?<done>\d+)\/(?<total>\d+)\)/g;

	private _pending = '';

	constructor(private readonly _onProgress: (progress: IWorktreeFileProgress) => void) { }

	push(chunk: string): void {
		const buffer = this._pending + chunk;
		const lastBreak = Math.max(buffer.lastIndexOf('\r'), buffer.lastIndexOf('\n'));
		if (lastBreak === -1) {
			this._pending = buffer;
			return;
		}
		this._pending = buffer.substring(lastBreak + 1);

		const complete = buffer.substring(0, lastBreak);
		GitCheckoutProgressParser._pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = GitCheckoutProgressParser._pattern.exec(complete))) {
			const filesTotal = Number(match.groups!.total);
			if (filesTotal > 0) {
				this._onProgress({ filesDone: Number(match.groups!.done), filesTotal });
			}
		}
	}
}

interface IWorktreeIncludeEntry {
	readonly sourcePath: string;
	readonly fileCount: number;
}

function toWorktreeIncludeEntries(repositoryRoot: URI, matchedFiles: readonly string[], collapsedDirectories: ReadonlySet<string>): IWorktreeIncludeEntry[] {
	const toEntry = (relativePath: string, fileCount: number): IWorktreeIncludeEntry => ({
		sourcePath: path.join(repositoryRoot.fsPath, relativePath),
		fileCount,
	});

	const directoryFileCounts = new Map<string, number>();
	for (const dir of collapsedDirectories) {
		directoryFileCounts.set(dir, 0);
	}

	const fileEntries: IWorktreeIncludeEntry[] = [];
	for (const file of matchedFiles) {
		const containingDirectory = collapsedDirectories.size > 0
			? findContainingDirectory(file, collapsedDirectories)
			: undefined;
		if (containingDirectory === undefined) {
			fileEntries.push(toEntry(file, 1));
		} else {
			directoryFileCounts.set(containingDirectory, directoryFileCounts.get(containingDirectory)! + 1);
		}
	}

	return [
		...[...directoryFileCounts].map(([dir, fileCount]) => toEntry(dir, fileCount)),
		...fileEntries,
	];
}

function findContainingDirectory(file: string, directories: ReadonlySet<string>): string | undefined {
	let index = file.indexOf('/');
	while (index !== -1) {
		const prefix = file.slice(0, index + 1);
		if (directories.has(prefix)) {
			return prefix;
		}
		index = file.indexOf('/', index + 1);
	}
	return undefined;
}

function hasWorktreePathCollision(file: string, worktreeFiles: ReadonlySet<string>, worktreeDirectories: ReadonlySet<string>): boolean {
	if (worktreeFiles.has(file) || worktreeDirectories.has(`${file}/`)) {
		return true;
	}

	let index = file.indexOf('/');
	while (index !== -1) {
		if (worktreeFiles.has(file.slice(0, index))) {
			return true;
		}
		index = file.indexOf('/', index + 1);
	}
	return false;
}

export function isRetryableWorktreeRemovalError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /directory not empty/i.test(message)
		|| /\bindex\.lock\b/i.test(message)
		|| /unable to (?:create|write|append)[^\n]*\.lock/i.test(message)
		|| /could not lock/i.test(message);
}

export function formatGitError(args: readonly string[], timeoutMs: number, didTimeOut: boolean, error: cp.ExecFileException, stderr: string): string {
	const subcommand = args[0] ?? '(unknown)';
	let reason: string;
	if (didTimeOut) {
		reason = `git ${subcommand} timed out after ${timeoutMs}ms`;
	} else if (error.killed && error.signal) {
		reason = `git ${subcommand} killed by ${error.signal}`;
	} else if (typeof error.code === 'number') {
		reason = `git ${subcommand} exited with code ${error.code}`;
	} else {
		reason = error.message;
	}
	const detail = summarizeStderrForError(stderr);
	return detail ? `${reason}: ${detail}` : reason;
}

export function summarizeStderrForError(stderr: string): string {
	if (!stderr) {
		return '';
	}
	const lines = stderr.split(/[\r\n]+/g).map(line => line.trim()).filter(line => line.length > 0);
	if (lines.length === 0) {
		return '';
	}
	const MAX = 200;
	const gitLfsMissing = lines.find(line =>
		/\bgit-lfs\b/i.test(line) &&
		/(command not found|not recognized|no such file)/i.test(line)
	);
	const summary = gitLfsMissing ?? lines[lines.length - 1];
	return summary.length > MAX ? `${summary.slice(0, MAX - 1)}…` : summary;
}

export function parseUntrackedPaths(output: string | undefined): string[] {
	return parseChangedPaths(output, status => status === '??');
}

export function parseChangedPaths(output: string | undefined, includeStatus: (status: string) => boolean = () => true): string[] {
	if (!output) {
		return [];
	}
	const result: string[] = [];
	const seen = new Set<string>();
	const addPath = (path: string) => {
		if (path && !seen.has(path)) {
			seen.add(path);
			result.push(path);
		}
	};
	const segments = output.split('\x00');
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (!seg) { continue; }
		const status = seg.substring(0, 2);
		const path = seg.substring(3);
		const isRenameOrCopy = status[0] === 'R' || status[1] === 'R' || status[0] === 'C' || status[1] === 'C';
		if (includeStatus(status)) {
			const isDeletedIndexAddition = status[1] === 'D' && (status[0] === 'A' || status[0] === 'R' || status[0] === 'C');
			if (!isDeletedIndexAddition) {
				addPath(path);
			}
			if (isRenameOrCopy) {
				const sourcePath = segments[++i];
				if (sourcePath) {
					addPath(sourcePath);
				}
			}
		} else if (isRenameOrCopy) {
			i++;
		}
	}
	return result;
}

export function parseSingleLsTreeEntry(output: string | undefined): { mode: string; oid: string } | undefined {
	if (!output) {
		return undefined;
	}
	const entry = output.split('\x00')[0];
	if (!entry) {
		return undefined;
	}
	const tabIndex = entry.indexOf('\t');
	const meta = (tabIndex === -1 ? entry : entry.substring(0, tabIndex)).split(' ');
	if (meta.length < 3) {
		return undefined;
	}
	return { mode: meta[0], oid: meta[2] };
}

export function parseGitDiffRawNumstat(output: string, repositoryRoot: URI, sessionUri: string, beforeRef: string, afterRef?: string): ISessionFileDiff[] {
	const segments = output.split('\x00');
	const changes: { kind: FileEditKind; oldPath?: string; newPath?: string }[] = [];
	const numStats = new Map<string, { added: number; removed: number }>();

	let i = 0;
	while (i < segments.length) {
		const segment = segments[i++];
		if (!segment) { continue; }

		if (segment.startsWith(':')) {
			const fields = segment.split(' ');
			const status = fields[4] ?? '';
			const path1 = segments[i++];
			if (!path1) { continue; }

			switch (status[0]) {
				case 'A':
					changes.push({ kind: FileEditKind.Create, newPath: path1 });
					break;
				case 'M':
					changes.push({ kind: FileEditKind.Edit, oldPath: path1, newPath: path1 });
					break;
				case 'D':
					changes.push({ kind: FileEditKind.Delete, oldPath: path1 });
					break;
				case 'R': {
					const path2 = segments[i++];
					if (!path2) { continue; }
					changes.push({ kind: FileEditKind.Rename, oldPath: path1, newPath: path2 });
					break;
				}
				default:
					break;
			}
		} else {
			const [addedStr, removedStr, filePath] = segment.split('\t');
			let key: string;
			if (filePath === '' || filePath === undefined) {
				const oldPath = segments[i++];
				const newPath = segments[i++];
				key = newPath ?? oldPath ?? '';
			} else {
				key = filePath;
			}
			if (!key) { continue; }
			numStats.set(key, {
				added: addedStr === '-' ? 0 : Number(addedStr) || 0,
				removed: removedStr === '-' ? 0 : Number(removedStr) || 0,
			});
		}
	}

	return changes.map(change => {
		const stats = numStats.get(change.newPath ?? change.oldPath ?? '');

		const beforeFileUri = change.oldPath ? URI.joinPath(repositoryRoot, change.oldPath) : undefined;
		const afterFileUri = change.newPath ? URI.joinPath(repositoryRoot, change.newPath) : undefined;

		const before = change.kind !== FileEditKind.Create && change.oldPath && beforeFileUri
			? {
				uri: beforeFileUri.toString(),
				content: { uri: buildGitBlobUri(sessionUri, beforeRef, change.oldPath, beforeFileUri.path) },
			}
			: undefined;

		const after = change.kind !== FileEditKind.Delete && change.newPath && afterFileUri
			? {
				uri: afterFileUri.toString(),
				content: afterRef !== undefined
					? { uri: buildGitBlobUri(sessionUri, afterRef, change.newPath, afterFileUri.path) }
					: { uri: afterFileUri.toString() }
			}
			: undefined;

		const diff = {
			added: stats?.added ?? 0,
			removed: stats?.removed ?? 0
		};

		return {
			...(before ? { before } : {}),
			...(after ? { after } : {}),
			diff
		};
	});
}

export function parseGitStatusV2(output: string | undefined): {
	branchName?: string;
	isDetachedHead?: boolean;
	upstreamBranchName?: string;
	outgoingChanges?: number;
	incomingChanges?: number;
	uncommittedChanges?: number;
} {
	if (!output) {
		return {};
	}
	let branchName: string | undefined;
	let isDetachedHead: boolean | undefined;
	let upstreamBranchName: string | undefined;
	let outgoingChanges: number | undefined;
	let incomingChanges: number | undefined;
	let uncommittedChanges = 0;
	for (const rawLine of output.split(/\r?\n/g)) {
		const line = rawLine.trimEnd();
		if (!line) { continue; }
		if (line.startsWith('# branch.head ')) {
			const head = line.substring('# branch.head '.length).trim();
			isDetachedHead = head === '(detached)' ? true : undefined;
			branchName = isDetachedHead ? undefined : head;
		} else if (line.startsWith('# branch.upstream ')) {
			upstreamBranchName = line.substring('# branch.upstream '.length).trim();
		} else if (line.startsWith('# branch.ab ')) {
			const m = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
			if (m) {
				outgoingChanges = Number(m[1]);
				incomingChanges = Number(m[2]);
			}
		} else if (!line.startsWith('#')) {
			uncommittedChanges++;
		}
	}
	return { branchName, isDetachedHead, upstreamBranchName, outgoingChanges, incomingChanges, uncommittedChanges };
}

export function parseHasGitHubRemote(remotesOutput: string | undefined): boolean | undefined {
	if (remotesOutput === undefined) {
		return undefined;
	}
	if (!remotesOutput.trim()) {
		return false;
	}
	return /github\.com[:\/]/i.test(remotesOutput);
}

export function parseFetchRemoteUrls(remotesOutput: string | undefined, preferredRemote?: string): string[] | undefined {
	const candidates = parseFetchRemotes(remotesOutput);
	if (!candidates) {
		return undefined;
	}
	const preferredNames = new Set([preferredRemote, 'origin'].filter((name): name is string => Boolean(name)));
	const ordered = [
		...candidates.filter(candidate => candidate.name === preferredRemote),
		...candidates.filter(candidate => candidate.name === 'origin' && candidate.name !== preferredRemote),
		...candidates.filter(candidate => !preferredNames.has(candidate.name)),
	];
	return [...new Set(ordered.map(candidate => candidate.url))];
}

function parseFetchRemotes(remotesOutput: string | undefined): { name: string; url: string }[] | undefined {
	if (remotesOutput === undefined) {
		return undefined;
	}
	const candidates: { name: string; url: string }[] = [];
	for (const rawLine of remotesOutput.split(/\r?\n/)) {
		const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(rawLine.trim());
		if (match) {
			candidates.push({ name: match[1], url: match[2] });
		}
	}
	return candidates;
}

export function parseGitHubRepoFromRemote(remotesOutput: string | undefined, remoteName?: string): { owner: string; repo: string } | undefined {
	const candidates = remoteName === undefined
		? parseFetchRemoteUrls(remotesOutput)
		: parseFetchRemotes(remotesOutput)?.filter(candidate => candidate.name === remoteName).map(candidate => candidate.url);
	if (!candidates) {
		return undefined;
	}
	for (const url of candidates) {
		const parsed = parseGitHubOwnerRepoFromUrl(url);
		if (parsed) {
			return parsed;
		}
	}
	return undefined;
}

function parseGitHubHeadRepoFromRemoteSelection(remotesOutput: string | undefined, remoteSelection: string | undefined): { owner: string; repo: string } | undefined {
	if (!remoteSelection) {
		return undefined;
	}
	return parseGitHubRepoFromRemote(remotesOutput, remoteSelection) ?? parseGitHubOwnerRepoFromUrl(remoteSelection);
}

function parseGitHubOwnerRepoFromUrl(url: string): { owner: string; repo: string } | undefined {
	let m = /^[^@\s]+@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(url);
	if (m) {
		return { owner: m[1], repo: m[2] };
	}
	m = /^[a-z+]+:\/\/(?:[^@\/\s]+@)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(url);
	if (m) {
		return { owner: m[1], repo: m[2] };
	}
	return undefined;
}

export function parseDefaultBranchRef(symbolicRefOutput: string | undefined): string | undefined {
	const ref = symbolicRefOutput?.trim();
	if (!ref) { return undefined; }
	const prefix = 'refs/remotes/origin/';
	return ref.startsWith(prefix) ? ref.substring(prefix.length) : ref;
}

export function parseRemoteBranchRef(ref: string): { ref: string; name: string; remote: string } | undefined {
	if (!ref.startsWith('refs/remotes/')) {
		return undefined;
	}

	const name = ref.substring(13);
	const remote = name.split('/')[0];
	return { ref, name, remote };
}

export function parseGitRefs(output: string | undefined): GitRef[] {
	if (!output) {
		return [];
	}

	const refs: GitRef[] = [];
	for (const line of output.split(/\r?\n/g)) {
		const [ref, upstream] = line.trim().split('\0');

		if (ref.startsWith('refs/heads/')) {
			refs.push({
				ref,
				name: ref.substring(11),
				upstream: upstream
					? parseRemoteBranchRef(upstream)
					: undefined,
				kind: GitRefType.Head
			} satisfies IBranch);
		} else if (ref.startsWith('refs/remotes/') && !/^refs\/remotes\/[^/]+\/HEAD$/.test(ref)) {
			const parsedRemoteBranch = parseRemoteBranchRef(ref);
			if (parsedRemoteBranch) {
				refs.push({
					...parsedRemoteBranch,
					kind: GitRefType.RemoteHead
				} satisfies IRemoteBranch);
			}
		} else if (ref.startsWith('refs/tags/')) {
			refs.push({
				ref,
				name: ref.substring(10),
				kind: GitRefType.Tag
			} satisfies ITag);
		}
	}

	return refs;
}

function stripUndefined<T extends object>(obj: T): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) { out[k] = v; }
	}
	return out as T;
}

function isMaxBufferError(error: unknown): boolean {
	const cause = error instanceof Error ? error.cause : undefined;
	return cause instanceof Error && (cause as cp.ExecFileException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}
