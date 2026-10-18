/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-languageserver-protocol';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IGitCommitMessageService } from '../../../platform/git/common/gitCommitMessageService';
import { getGitHubRepoInfoFromContext, IGitService, RepoContext } from '../../../platform/git/common/gitService';
import { toGitUri } from '../../../platform/git/common/utils';
import { buildTempIndexEnv, getUncommittedFilePaths, parseGitChangesRaw } from '../../../platform/git/dardcor-node/utils';
import { DiffChange } from '../../../platform/git/dardcor/git';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import * as path from '../../../util/dardcor/base/common/path';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { IAgentSessionsWorkspace } from '../common/agentSessionsWorkspace';
import { IChatSessionMetadataStore } from '../common/chatSessionMetadataStore';
import { ChatSessionWorktreeFile, ChatSessionWorktreeProperties, ChatSessionWorktreePropertiesV2, IChatSessionWorktreeService } from '../common/chatSessionWorktreeService';
import { SequencerByKey } from '../../../util/dardcor/base/common/async';


export class ChatSessionWorktreeService extends Disposable implements IChatSessionWorktreeService {
	declare _serviceBrand: undefined;

	private _sessionWorktrees: Map<string, string | ChatSessionWorktreeProperties> = new Map();

	private readonly _onDidChangeWorktreeChanges = this._register(new vscode.EventEmitter<{ sessionId: string }>());
	readonly onDidChangeWorktreeChanges = this._onDidChangeWorktreeChanges.event;

	private readonly _updatePropertiesSequencer = new SequencerByKey<string>();

	constructor(
		@IAgentSessionsWorkspace private readonly agentSessionsWorkspace: IAgentSessionsWorkspace,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IGitCommitMessageService private readonly gitCommitMessageService: IGitCommitMessageService,
		@IGitService private readonly gitService: IGitService,
		@ILogService private readonly logService: ILogService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IChatSessionMetadataStore private readonly metadataStore: IChatSessionMetadataStore,
	) {
		super();
	}

	async createWorktree(repositoryPath: vscode.Uri, stream?: vscode.ChatResponseStream, baseBranch?: string, branchName?: string): Promise<ChatSessionWorktreeProperties | undefined> {
		if (!stream) {
			return this._createWorktree(repositoryPath, undefined, baseBranch, branchName);
		}

		return new Promise<ChatSessionWorktreeProperties | undefined>((resolve) => {
			stream.progress(l10n.t('Creating isolated worktree for Dardcor AI CLI session...'), async progress => {
				const result = await this._createWorktree(repositoryPath, progress, baseBranch, branchName);
				resolve(result);
				if (result) {
					return l10n.t('Created isolated worktree for branch {0}', result.branchName);
				}
				return undefined;
			});
		});
	}

	private async _createWorktree(repositoryPath: vscode.Uri, progress?: vscode.Progress<vscode.ChatResponsePart>, baseBranch?: string, branchName?: string): Promise<ChatSessionWorktreeProperties | undefined> {
		try {
			const activeRepository = await this.gitService.getRepository(repositoryPath);
			if (!activeRepository) {
				progress?.report(new vscode.ChatResponseWarningPart(vscode.l10n.t('Failed to create worktree for isolation, using default workspace directory')));
				this.logService.error('[ChatSessionWorktreeService][_createWorktree] No active repository found to create worktree for isolation.');
				return undefined;
			}

			const autoCommit = this.configurationService.getConfig<boolean>(ConfigKey.Advanced.CLIAutoCommitEnabled);

			let baseCommit: string | undefined = undefined;
			const branch = await this.generateBranchName(branchName, activeRepository);

			if (this.agentSessionsWorkspace.isAgentSessionsWorkspace && baseBranch) {
				try {
					const branchDetails = await this.gitService.getBranch(activeRepository.rootUri, baseBranch);
					if (branchDetails?.upstream?.remote && branchDetails.upstream?.name) {
						const upstreamBranchName = `${branchDetails.upstream.remote}/${branchDetails.upstream.name}`;

						try {
							const upstreamBranch = await this.gitService.getBranch(activeRepository.rootUri, upstreamBranchName);
							if (upstreamBranch) {
								baseBranch = upstreamBranchName;
								baseCommit = upstreamBranch.commit;
							}
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							this.logService.warn(`[ChatSessionWorktreeService][_createWorktree] Failed to resolve upstream branch ${upstreamBranchName}. Error: ${errorMessage}`);
						}
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					this.logService.warn(`[ChatSessionWorktreeService][_createWorktree] Failed to resolve base branch ${baseBranch}. Error: ${errorMessage}`);
				}
			}

			const worktreePath = await this.gitService.createWorktree(activeRepository.rootUri, { branch, commitish: baseBranch, noTrack: true });

			if (worktreePath && activeRepository.headCommitHash && activeRepository.headBranchName) {
				const baseBranchName = baseBranch ?? activeRepository.headBranchName;
				const baseBranchProtected = await this.gitService.isBranchProtected(activeRepository.rootUri, baseBranchName);

				this.logService.trace(`[ChatSessionWorktreeService][_createWorktree] Base branch for worktree: ${baseBranchName}, protected: ${baseBranchProtected}`);

				if (baseBranch && !baseCommit) {
					const refs = await this.gitService.getRefs(activeRepository.rootUri, { pattern: `refs/heads/${baseBranch}` });
					baseCommit = refs.length === 1 && refs[0].commit ? refs[0].commit : undefined;
				}

				const gitHubRemote = getGitHubRepoInfoFromContext(activeRepository);
				const incomingChanges = activeRepository.headIncomingChanges ?? 0;
				const outgoingChanges = activeRepository.headOutgoingChanges ?? 0;
				const uncommittedChanges = (activeRepository.changes?.mergeChanges.length ?? 0) +
					(activeRepository.changes?.indexChanges.length ?? 0) +
					(activeRepository.changes?.workingTree.length ?? 0) +
					(activeRepository.changes?.untrackedChanges.length ?? 0);

				return {
					autoCommit,
					branchName: branch,
					baseCommit: baseCommit ?? activeRepository.headCommitHash,
					baseBranchName,
					baseBranchProtected,
					upstreamBranchName: activeRepository.upstreamRemote && activeRepository.upstreamBranchName
						? `${activeRepository.upstreamRemote}/${activeRepository.upstreamBranchName}`
						: undefined,
					mergeBaseCommit: baseCommit ?? activeRepository.headCommitHash,
					hasGitHubRemote: gitHubRemote !== undefined,
					incomingChanges,
					outgoingChanges,
					uncommittedChanges,
					repositoryPath: activeRepository.rootUri.fsPath,
					worktreePath,
					version: 2
				} satisfies ChatSessionWorktreeProperties;
			}
			progress?.report(new vscode.ChatResponseWarningPart(vscode.l10n.t('Failed to create worktree for isolation, using default workspace directory')));
			this.logService.error('[ChatSessionWorktreeService][_createWorktree] Failed to create worktree for isolation.');
			return undefined;
		} catch (error) {
			progress?.report(new vscode.ChatResponseWarningPart(vscode.l10n.t('Error creating worktree for isolation: {0}', error instanceof Error ? error.message : String(error))));
			this.logService.error('[ChatSessionWorktreeService][_createWorktree] Error creating worktree for isolation: ', error);
			return undefined;
		}
	}

	private async generateBranchName(preferredName: string | undefined, repository: RepoContext) {
		const branchPrefixConfig = vscode.workspace.getConfiguration('git').get<string>('branchPrefix') ?? '';
		const branchPrefix = this.agentSessionsWorkspace.isAgentSessionsWorkspace ? 'agents' : 'dardcor';

		if (preferredName) {
			let branchName = `${branchPrefixConfig}${branchPrefix}/${preferredName}`;
			const refs = await this.gitService.getRefs(repository.rootUri, { pattern: `refs/heads/${branchName}` });
			if (refs.some(ref => ref.name === branchName)) {
				branchName = `${branchName}-${generateUuid().replaceAll('-', '').substring(0, 8).toLowerCase()}`;
			}

			return branchName;
		}

		const randomBranchName = await this.gitService.generateRandomBranchName(repository.rootUri);

		const branch = randomBranchName ? `${branchPrefixConfig}${branchPrefix}/${randomBranchName.substring(branchPrefixConfig.length)}`
			: `${branchPrefixConfig}${branchPrefix}/worktree-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

		return branch;
	}

	async getWorktreeProperties(sessionId: string): Promise<ChatSessionWorktreeProperties | undefined> {
		const properties = this._sessionWorktrees.get(sessionId);
		if (properties !== undefined) {
			return typeof properties === 'string' ? undefined : properties;
		}
		return this.metadataStore.getWorktreeProperties(sessionId);
	}

	async setWorktreeProperties(sessionId: string, properties: ChatSessionWorktreeProperties): Promise<void> {
		this._sessionWorktrees.set(sessionId, properties);
		await this.metadataStore.storeWorktreeInfo(sessionId, properties);
		if ('changes' in properties && !properties.changes) {
			this._onDidChangeWorktreeChanges.fire({ sessionId });
		}
	}

	async updateWorktreeProperties(sessionId: string, properties: Partial<ChatSessionWorktreeProperties>): Promise<void> {
		await this._updatePropertiesSequencer.queue(sessionId, async () => {
			const currentProperties = await this.getWorktreeProperties(sessionId);
			if (!currentProperties || typeof currentProperties === 'string') {
				return;
			}

			await this.setWorktreeProperties(sessionId, { ...currentProperties, ...properties } as ChatSessionWorktreeProperties);
		});
	}

	async getWorktreeRepository(sessionId: string): Promise<RepoContext | undefined> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (typeof worktreeProperties === 'string' || !worktreeProperties?.repositoryPath) {
			return undefined;
		}

		return this.gitService.getRepository(vscode.Uri.file(worktreeProperties.repositoryPath));
	}

	async getWorktreePath(sessionId: string): Promise<vscode.Uri | undefined> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties) {
			return undefined;
		} else if (typeof worktreeProperties === 'string') {
			return vscode.Uri.file(worktreeProperties);
		} else {
			return vscode.Uri.file(worktreeProperties.worktreePath);
		}
	}

	async applyWorktreeChanges(sessionId: string): Promise<void> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);

		if (worktreeProperties === undefined || (worktreeProperties.version === 1 && worktreeProperties.autoCommit === false)) {
			const worktreePath = await this.getWorktreePath(sessionId);
			if (!worktreePath) {
				return;
			}

			const activeRepository = worktreeProperties?.repositoryPath
				? await this.gitService.getRepository(vscode.Uri.file(worktreeProperties.repositoryPath))
				: this.workspaceService.getWorkspaceFolders().length === 1 ? this.gitService.activeRepository.get() : undefined;

			if (!activeRepository) {
				return;
			}

			await this.gitService.migrateChanges(activeRepository.rootUri, worktreePath, {
				confirmation: false,
				deleteFromSource: false,
				untracked: true
			});

			if (worktreeProperties) {
				await this.setWorktreeProperties(sessionId, {
					...worktreeProperties,
					changes: undefined
				});
			}

			return;
		}

		const patch = await this.gitService.diffBetweenPatch(
			vscode.Uri.file(worktreeProperties.worktreePath),
			worktreeProperties.baseCommit,
			worktreeProperties.branchName);

		if (!patch) {
			return;
		}

		const encoder = new TextEncoder();
		const patchFilePath = path.join(worktreeProperties.repositoryPath, '.git', `${worktreeProperties.branchName}.patch`);
		const patchFileUri = vscode.Uri.file(patchFilePath);
		await vscode.workspace.fs.writeFile(patchFileUri, encoder.encode(patch));

		try {
			await this.gitService.applyPatch(vscode.Uri.file(worktreeProperties.repositoryPath), patchFilePath);
		} catch (error) {
			this.logService.error(`[ChatSessionWorktreeService][applyWorktreeChanges] Error applying patch file ${patchFilePath} to repository ${worktreeProperties.repositoryPath}: `, error);
			throw error;
		} finally {
			await vscode.workspace.fs.delete(patchFileUri);
		}

		const ref = await this.gitService.getRefs(vscode.Uri.file(worktreeProperties.repositoryPath), {
			pattern: `refs/heads/${worktreeProperties.branchName}`
		});

		if (ref.length === 1 && ref[0].commit && ref[0].commit !== worktreeProperties.baseCommit) {
			await this.setWorktreeProperties(sessionId, {
				...worktreeProperties,
				baseCommit: ref[0].commit,
				changes: undefined
			});
		} else {
			await this.setWorktreeProperties(sessionId, {
				...worktreeProperties,
				changes: undefined
			});
		}
	}

	async hasCachedChanges(sessionId: string): Promise<boolean> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties || typeof worktreeProperties === 'string') {
			return false;
		}
		return !!worktreeProperties.changes;
	}

	async refreshWorktreeChanges(sessionId: string): Promise<void> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties || typeof worktreeProperties === 'string') {
			return;
		}

		await this.updateWorktreeProperties(sessionId, { changes: undefined });

		await this.getWorktreeChanges(sessionId);
	}

	async getWorktreeChanges(sessionId: string): Promise<readonly vscode.ChatSessionChangedFile[] | undefined> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties || typeof worktreeProperties === 'string') {
			return undefined;
		}

		if (worktreeProperties.changes) {
			return worktreeProperties.changes
				.map(change => this._toChatSessionChangedFile2(sessionId, change, worktreeProperties));
		}

		try {
			await this.gitService.initialize();

			if (worktreeProperties.version === 1 && worktreeProperties.autoCommit === false) {
				const changes = await this._getWorktreeChangesFromIndex(worktreeProperties) ?? [];
				await this.setWorktreeProperties(sessionId, {
					...worktreeProperties, changes
				});

				return changes.map(change => this._toChatSessionChangedFile2(sessionId, change, worktreeProperties));
			}

			if (worktreeProperties.version === 2 && worktreeProperties.autoCommit === true) {
				const properties = vscode.workspace.isAgentSessionsWorkspace
					? await this._getWorktreeChanges(sessionId, worktreeProperties)
					: await this._getWorktreeChangesFromCommits(worktreeProperties);

				if (properties) {
					await this.setWorktreeProperties(sessionId, {
						...worktreeProperties, ...properties
					});
				}

				return properties?.changes.map(change => this._toChatSessionChangedFile2(sessionId, change, worktreeProperties)) ?? [];
			}

			const properties = await this._getWorktreeChanges(sessionId, worktreeProperties);
			if (properties) {
				await this.setWorktreeProperties(sessionId, {
					...worktreeProperties, ...properties
				});
			}

			return properties?.changes.map(change => this._toChatSessionChangedFile2(sessionId, change, worktreeProperties)) ?? [];
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[ChatSessionWorktreeCheckpointService][getWorktreeChanges] Session ${sessionId}: error computing diff for committed changes, returning empty. Error: ${errorMessage}`);
			await this.setWorktreeProperties(sessionId, {
				...worktreeProperties, changes: []
			});

			return [];
		}
	}

	async handleRequestCompleted(sessionId: string): Promise<void> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties) {
			return;
		}

		if (worktreeProperties.autoCommit === false) {
			this.logService.trace(`[ChatSessionWorktreeService][handleRequestCompleted] Auto-commit is disabled, skipping commit of worktree changes for session ${sessionId}`);

			await this.setWorktreeProperties(sessionId, {
				...worktreeProperties,
				changes: undefined
			});

			return;
		}

		const worktreePath = worktreeProperties.worktreePath;

		const repository = await this.gitCommitMessageService.getRepository(vscode.Uri.file(worktreePath));
		if (!repository) {
			this.logService.error(`[ChatSessionWorktreeService][handleRequestCompleted] Unable to find repository for working directory ${worktreePath}`);
			throw new Error(`Unable to find repository for working directory ${worktreePath}`);
		}

		if (repository.state.workingTreeChanges.length === 0 && repository.state.indexChanges.length === 0 && repository.state.untrackedChanges.length === 0) {
			this.logService.trace(`[ChatSessionWorktreeService][handleRequestCompleted] No changes to commit in working directory ${worktreePath}`);

			await this.setWorktreeProperties(sessionId, {
				...worktreeProperties,
				changes: undefined
			});

			return;
		}

		let message: string | undefined;
		try {
			this.logService.trace(`[ChatSessionWorktreeService][handleRequestCompleted] Generating commit message for working directory ${worktreePath}. Repository state: ${JSON.stringify(repository.state)}`);
			message = await this.gitCommitMessageService.generateCommitMessage(repository, CancellationToken.None);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error(`[ChatSessionWorktreeService][handleRequestCompleted] Error generating commit message for working directory ${worktreePath}. Repository state: ${JSON.stringify(repository.state)}. Error: ${errorMessage}`);
		}

		if (!message) {
			this.logService.warn(`[ChatSessionWorktreeService][handleRequestCompleted] Unable to generate commit message for working directory ${worktreePath}. Repository state: ${JSON.stringify(repository.state)}`);
			message = `Copilot CLI session ${sessionId} changes`;
		}

		await this.gitService.commit(vscode.Uri.file(worktreePath), message, { all: true, noVerify: true, signCommit: false });
		this.logService.trace(`[ChatSessionWorktreeService] Committed all changes in working directory ${worktreePath}`);

		await this.setWorktreeProperties(sessionId, {
			...worktreeProperties,
			changes: undefined
		});
	}

	async cleanupWorktreeOnArchive(sessionId: string): Promise<{ cleaned: boolean; reason?: string }> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties) {
			return { cleaned: false, reason: 'no-worktree' };
		}

		const worktreePath = worktreeProperties.worktreePath;

		try {
			await fs.access(worktreePath);
		} catch {
			this.logService.trace(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Worktree path does not exist: ${worktreePath}`);
			return { cleaned: false, reason: 'worktree-not-found' };
		}

		const repository = await this.gitCommitMessageService.getRepository(vscode.Uri.file(worktreePath));
		if (!repository) {
			this.logService.warn(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Unable to find repository for worktree ${worktreePath}`);
			return { cleaned: false, reason: 'no-repository' };
		}

		const hasUncommittedChanges = repository.state.workingTreeChanges.length > 0
			|| repository.state.indexChanges.length > 0
			|| repository.state.untrackedChanges.length > 0;

		if (hasUncommittedChanges) {
			if (worktreeProperties.autoCommit !== false) {
				this.logService.trace(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Auto-committing changes before cleanup for session ${sessionId}`);
				try {
					await this.handleRequestCompleted(sessionId);
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					this.logService.error(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Failed to auto-commit: ${errorMessage}`);
					return { cleaned: false, reason: 'auto-commit-failed' };
				}
			} else {
				this.logService.trace(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Skipping cleanup for session ${sessionId}: has uncommitted changes and auto-commit is disabled`);
				return { cleaned: false, reason: 'uncommitted-changes' };
			}
		}

		try {
			const refs = await this.gitService.getRefs(
				vscode.Uri.file(worktreeProperties.repositoryPath),
				{ pattern: `refs/heads/${worktreeProperties.branchName}` }
			);
			if (!refs || refs.length === 0) {
				this.logService.warn(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Branch ${worktreeProperties.branchName} not found, skipping cleanup`);
				return { cleaned: false, reason: 'branch-not-found' };
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Failed to verify branch: ${errorMessage}`);
			return { cleaned: false, reason: 'branch-check-failed' };
		}

		try {
			const parentRepository = await this.gitService.getRepository(vscode.Uri.file(worktreeProperties.repositoryPath), true);
			if (!parentRepository) {
				this.logService.warn(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] No parent repository found for ${worktreeProperties.repositoryPath}`);
				return { cleaned: false, reason: 'no-parent-repository' };
			}
			await this.gitService.deleteWorktree(parentRepository.rootUri, worktreePath);
			this.logService.trace(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Deleted worktree ${worktreePath} for session ${sessionId}`);
			return { cleaned: true };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error(`[ChatSessionWorktreeService][cleanupWorktreeOnArchive] Failed to delete worktree: ${errorMessage}`);
			return { cleaned: false, reason: 'delete-failed' };
		}
	}

	async recreateWorktreeOnUnarchive(sessionId: string): Promise<{ recreated: boolean; reason?: string }> {
		const worktreeProperties = await this.getWorktreeProperties(sessionId);
		if (!worktreeProperties) {
			return { recreated: false, reason: 'no-worktree-properties' };
		}

		const worktreePath = worktreeProperties.worktreePath;

		try {
			await fs.access(worktreePath);
			this.logService.trace(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] Worktree already exists at ${worktreePath}`);
			return { recreated: false, reason: 'already-exists' };
		} catch {
		}

		try {
			const refs = await this.gitService.getRefs(
				vscode.Uri.file(worktreeProperties.repositoryPath),
				{ pattern: `refs/heads/${worktreeProperties.branchName}` }
			);
			if (!refs || refs.length === 0) {
				this.logService.warn(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] Branch ${worktreeProperties.branchName} no longer exists`);
				return { recreated: false, reason: 'branch-not-found' };
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.warn(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] Failed to verify branch: ${errorMessage}`);
			return { recreated: false, reason: 'branch-check-failed' };
		}

		try {
			const parentRepository = await this.gitService.getRepository(vscode.Uri.file(worktreeProperties.repositoryPath), true);
			if (!parentRepository) {
				this.logService.warn(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] No parent repository found for ${worktreeProperties.repositoryPath}`);
				return { recreated: false, reason: 'no-parent-repository' };
			}

			const createdPath = await this.gitService.createWorktree(parentRepository.rootUri, {
				path: worktreePath,
				commitish: worktreeProperties.branchName,
			});

			if (!createdPath) {
				this.logService.error(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] createWorktree returned no path`);
				return { recreated: false, reason: 'create-failed' };
			}

			this.logService.trace(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] Recreated worktree at ${createdPath} for session ${sessionId}`);
			return { recreated: true };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error(`[ChatSessionWorktreeService][recreateWorktreeOnUnarchive] Failed to recreate worktree: ${errorMessage}`);
			return { recreated: false, reason: 'create-failed' };
		}
	}

	private async _getWorktreeChangesFromIndex(worktreeProperties: ChatSessionWorktreeProperties): Promise<readonly ChatSessionWorktreeFile[] | undefined> {
		const worktreePath = vscode.Uri.file(worktreeProperties.worktreePath);
		const worktreeRepository = await this.gitService.getRepository(worktreePath);

		if (!worktreeRepository?.changes) {
			return [];
		}

		const changes: ChatSessionWorktreeFile[] = [];
		for (const change of [...worktreeRepository.changes.indexChanges, ...worktreeRepository.changes.workingTree]) {
			try {
				const fileStats = await this.gitService.diffIndexWithHEADShortStats(change.uri);
				changes.push({
					filePath: change.uri.fsPath,
					originalFilePath: change.status !== 1
						? change.originalUri?.fsPath
						: undefined,
					modifiedFilePath: change.status !== 2
						? change.uri.fsPath
						: undefined,
					statistics: {
						additions: fileStats?.insertions ?? 0,
						deletions: fileStats?.deletions ?? 0
					}
				} satisfies ChatSessionWorktreeFile);
			} catch (error) { }
		}

		return changes;
	}

	private async _getWorktreeChangesFromCommits(worktreeProperties: ChatSessionWorktreePropertiesV2): Promise<{ changes: readonly ChatSessionWorktreeFile[] } | undefined> {
		const repository = await this.gitService.getRepository(vscode.Uri.file(worktreeProperties.repositoryPath));

		if (!repository) {
			return undefined;
		}

		const diff = await this.gitService.diffBetweenWithStats(
			repository.rootUri,
			worktreeProperties.baseCommit,
			worktreeProperties.branchName);

		if (!diff) {
			return { changes: [] };
		}

		const changes = diff.map(change => {
			const worktreeFilePath = path.join(worktreeProperties.worktreePath, path.relative(worktreeProperties.repositoryPath, change.uri.fsPath));
			const worktreeOriginalFilePath = change.originalUri
				? path.join(worktreeProperties.worktreePath, path.relative(worktreeProperties.repositoryPath, change.originalUri.fsPath))
				: undefined;

			return {
				filePath: worktreeFilePath,
				originalFilePath: change.status !== 1
					? worktreeOriginalFilePath
					: undefined,
				modifiedFilePath: change.status !== 6
					? worktreeFilePath
					: undefined,
				statistics: {
					additions: change.insertions,
					deletions: change.deletions
				}
			} satisfies ChatSessionWorktreeFile;
		});

		return { changes };
	}

	private async _getWorktreeChanges(sessionId: string, worktreeProperties: ChatSessionWorktreeProperties): Promise<{
		readonly changes: readonly ChatSessionWorktreeFile[];
		readonly mergeBaseCommit?: string;
		readonly hasGitHubRemote?: boolean;
		readonly upstreamBranchName?: string;
		readonly incomingChanges?: number;
		readonly outgoingChanges?: number;
		readonly uncommittedChanges?: number;
	} | undefined> {
		if (worktreeProperties.version !== 2) {
			this.logService.warn(`[ChatSessionWorktreeService][_getWorktreeChanges] Worktree properties for session ${sessionId} is not version 2.`);
			return undefined;
		}

		const worktreeRepository = await this.gitService.getRepository(vscode.Uri.file(worktreeProperties.worktreePath));

		if (!worktreeRepository) {
			this.logService.warn(`[ChatSessionWorktreeService][_getWorktreeChanges] Unable to open worktree repository for session ${sessionId} at path ${worktreeProperties.worktreePath}`);
			return undefined;
		}

		const hasUntrackedChanges = [
			...worktreeRepository.changes?.workingTree ?? [],
			...worktreeRepository.changes?.untrackedChanges ?? [],
		].some(change => change.status === 7 );


		const noRenamesArg = worktreeRepository.isUsingVirtualFileSystem
			? ['--no-renames']
			: [];

		const diffChanges: DiffChange[] = [];
		const worktreePath = vscode.Uri.file(worktreeProperties.worktreePath);

		if (hasUntrackedChanges) {
			const tmpDirName = `vscode-sessions-${sessionId}-${generateUuid()}`;
			const diffIndexFile = path.join(this.extensionContext.globalStorageUri.fsPath, tmpDirName, 'diff.index');
			const pathspecFile = path.join(this.extensionContext.globalStorageUri.fsPath, tmpDirName, `pathspec.txt`);

			const env = buildTempIndexEnv(worktreeRepository, diffIndexFile);

			try {
				await fs.mkdir(path.dirname(diffIndexFile), { recursive: true });

				await this.gitService.exec(worktreePath, ['read-tree', 'HEAD'], env);

				const uncommittedFilePaths = getUncommittedFilePaths(worktreeRepository);
				await fs.writeFile(pathspecFile, uncommittedFilePaths.join('\n'), 'utf8');
				await this.gitService.exec(worktreePath, ['add', '-A', `--pathspec-from-file=${pathspecFile}`], env);

				const result = await this.gitService.exec(worktreePath, ['diff', '--cached', '--raw', '--numstat', '--diff-filter=ADMR', ...noRenamesArg, '-z', '--merge-base', worktreeProperties.baseBranchName, '--'], env);
				diffChanges.push(...parseGitChangesRaw(worktreeProperties.worktreePath, result));
			} catch (error) {
				this.logService.error(`[ChatSessionWorktreeService][_getWorktreeChanges] Error while processing worktree changes for session ${sessionId}: ${error}`);
				return undefined;
			} finally {
				try {
					await fs.rm(path.dirname(diffIndexFile), { recursive: true, force: true });
				} catch (error) {
					this.logService.error(`[ChatSessionWorktreeService][_getWorktreeChanges] Error while cleaning up temp index file for session ${sessionId}: ${error}`);
				}
			}
		} else {
			try {
				const result = await this.gitService.exec(worktreePath, ['diff', '--raw', '--numstat', '--diff-filter=ADMR', ...noRenamesArg, '-z', '--merge-base', worktreeProperties.baseBranchName, '--']);
				diffChanges.push(...parseGitChangesRaw(worktreeProperties.worktreePath, result));
			} catch (error) {
				this.logService.error(`[ChatSessionWorktreeService][_getWorktreeChanges] Error while processing worktree changes for session ${sessionId}: ${error}`);
				return undefined;
			}
		}

		let mergeBaseCommit: string | undefined;
		try {
			mergeBaseCommit = await this.gitService.getMergeBase(worktreePath, worktreeProperties.branchName, worktreeProperties.baseBranchName);
		} catch (error) {
			this.logService.error(`[ChatSessionWorktreeService][_getWorktreeChanges] Error while getting merge base (${worktreeProperties.branchName}, ${worktreeProperties.baseBranchName}) for session ${sessionId}: ${error}`);
		}

		const changes = diffChanges.map(change => ({
			filePath: change.uri.fsPath,
			originalFilePath: change.status !== 1
				? change.originalUri?.fsPath
				: undefined,
			modifiedFilePath: change.status !== 6
				? change.uri.fsPath
				: undefined,
			statistics: {
				additions: change.insertions,
				deletions: change.deletions
			}
		} satisfies ChatSessionWorktreeFile));

		const repositoryState = {
			mergeBaseCommit,
			hasGitHubRemote: getGitHubRepoInfoFromContext(worktreeRepository) !== undefined,
			upstreamBranchName: worktreeRepository.upstreamRemote && worktreeRepository.upstreamBranchName
				? `${worktreeRepository.upstreamRemote}/${worktreeRepository.upstreamBranchName}`
				: undefined,
			incomingChanges: worktreeRepository.headIncomingChanges ?? 0,
			outgoingChanges: worktreeRepository.headOutgoingChanges ?? 0,
			uncommittedChanges:
				(worktreeRepository.changes?.mergeChanges.length ?? 0) +
				(worktreeRepository.changes?.indexChanges.length ?? 0) +
				(worktreeRepository.changes?.workingTree.length ?? 0) +
				(worktreeRepository.changes?.untrackedChanges.length ?? 0)
		};

		return { changes, ...repositoryState };
	}

	private _toChatSessionChangedFile2(sessionId: string, change: ChatSessionWorktreeFile, worktreeProperties: ChatSessionWorktreeProperties): vscode.ChatSessionChangedFile {
		let originalFileRef: string, modifiedFileRef: string | undefined;
		if (worktreeProperties.version === 2) {
			originalFileRef = vscode.workspace.isAgentSessionsWorkspace
				? worktreeProperties.mergeBaseCommit ?? worktreeProperties.baseCommit
				: worktreeProperties.baseCommit;
			modifiedFileRef = vscode.workspace.isAgentSessionsWorkspace
				? undefined
				: worktreeProperties.branchName;
		} else {
			originalFileRef = worktreeProperties.baseCommit;
			modifiedFileRef = worktreeProperties.branchName;
		}

		return new vscode.ChatSessionChangedFile(
			vscode.Uri.file(change.filePath),
			change.originalFilePath
				? toGitUri(vscode.Uri.file(change.originalFilePath), originalFileRef)
				: undefined,
			change.modifiedFilePath
				? modifiedFileRef
					? toGitUri(vscode.Uri.file(change.modifiedFilePath), modifiedFileRef)
					: vscode.Uri.file(change.modifiedFilePath)
				: undefined,
			change.statistics.additions,
			change.statistics.deletions);
	}

	async getAdditionalWorktreeProperties(sessionId: string): Promise<ChatSessionWorktreeProperties[]> {
		const additionalWorkspaces = await this.metadataStore.getAdditionalWorkspaces(sessionId);
		return additionalWorkspaces
			.map(ws => ws.worktreeProperties)
			.filter((props): props is ChatSessionWorktreeProperties => !!props);
	}

	async setAdditionalWorktreeProperties(sessionId: string, properties: ChatSessionWorktreeProperties[]): Promise<void> {
		const workspaces = properties.map(props => ({
			folder: undefined,
			repository: vscode.Uri.file(props.repositoryPath),
			worktree: vscode.Uri.file(props.worktreePath),
			worktreeProperties: props,
		}));
		await this.metadataStore.setAdditionalWorkspaces(sessionId, workspaces);
	}

	async handleRequestCompletedForWorktree(worktreeProperties: ChatSessionWorktreeProperties): Promise<void> {
		if (worktreeProperties.autoCommit === false) {
			this.logService.trace(`[ChatSessionWorktreeService][handleRequestCompletedForWorktree] Auto-commit is disabled, skipping commit for worktree ${worktreeProperties.worktreePath}`);
			return;
		}

		const worktreePath = worktreeProperties.worktreePath;
		const repository = await this.gitCommitMessageService.getRepository(vscode.Uri.file(worktreePath));
		if (!repository) {
			this.logService.error(`[ChatSessionWorktreeService][handleRequestCompletedForWorktree] Unable to find repository for working directory ${worktreePath}`);
			throw new Error(`Unable to find repository for working directory ${worktreePath}`);
		}

		if (repository.state.workingTreeChanges.length === 0 && repository.state.indexChanges.length === 0 && repository.state.untrackedChanges.length === 0) {
			this.logService.trace(`[ChatSessionWorktreeService][handleRequestCompletedForWorktree] No changes to commit in working directory ${worktreePath}`);
			return;
		}

		let message: string | undefined;
		try {
			message = await this.gitCommitMessageService.generateCommitMessage(repository, CancellationToken.None);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.logService.error(`[ChatSessionWorktreeService][handleRequestCompletedForWorktree] Error generating commit message for ${worktreePath}: ${errorMessage}`);
		}

		if (!message) {
			message = `Copilot CLI session changes`;
		}

		await this.gitService.commit(vscode.Uri.file(worktreePath), message, { all: true, noVerify: true, signCommit: false });
		this.logService.trace(`[ChatSessionWorktreeService][handleRequestCompletedForWorktree] Committed all changes in working directory ${worktreePath}`);
	}
}
