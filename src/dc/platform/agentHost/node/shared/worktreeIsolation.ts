/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import { RunOnceScheduler, SequencerByKey } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { appendEscapedMarkdownInlineCode } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename } from '../../../../base/common/path.js';
import { getComparisonKey, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { AgentSession, IAgentSessionProjectInfo } from '../../common/agent.js';
import { getBranchCompletions, IAgentHostGitService, IDefaultBranch, IWorktreeFileProgress, META_DIFF_BASE_BRANCH, tryResolvePrimaryWorktreeRoot } from '../../common/agentHostGitService.js';
import { AgentSystemNotificationKind, AgentSystemNotificationSeverity, toAgentSystemNotificationMeta } from '../../common/meta/agentSystemNotificationMeta.js';
import { ISchemaProperty, schemaProperty } from '../../common/agentHostSchema.js';
import { ISessionDataService } from '../../common/sessionDataService.js';
import { SessionConfigKey } from '../../common/sessionConfigKeys.js';
import { DEV_CONTAINER_WORKTREE_DATA_ID_PREFIX, isAgentDevContainerWorktreeHandle } from '../../common/meta/agentDevContainerWorktreeMeta.js';
import { getWorktreesRoot } from '../../common/worktreePaths.js';
import { AH_META_IS_ARCHIVED_DB_KEY, AH_META_IS_DONE_DB_KEY, ResponsePart, ResponsePartKind, Turn } from '../../common/state/sessionState.js';
import { AGENT_BRANCH_PREFIX, IAgentBranchNameGenerator } from './agentBranchNameGenerator.js';

export const IAgentHostWorktreeIsolation = createDecorator<IAgentHostWorktreeIsolation>('agentHostWorktreeIsolation');

export interface IAgentHostWorktreePendingState {
	readonly onDidChangeWorkingDirectoryPending: Event<string>;
	isWorkingDirectoryPending(sessionId: string): boolean;
	applyRestoreAnnouncement(sessionUri: URI, turns: readonly Turn[]): Promise<readonly Turn[]>;
}

export interface IAgentHostWorktreeResumeService {
	resolveWorkingDirectoryForResume(sessionUri: URI, sessionId: string, workingDirectory: URI): Promise<URI>;
}

export interface IAgentHostWorktreeIsolation extends IAgentHostWorktreePendingState, IAgentHostWorktreeResumeService {
	readonly _serviceBrand: undefined;
	readonly supported: boolean;
	notePending(sessionId: string): void;
	clearPending(sessionId: string): void;
	getResolvedWorktree(sessionId: string): URI | undefined;
	resolveOnFirstSend(request: IResolveWorkingDirectoryRequest): Promise<URI | undefined>;
	createDetachedWorktree(request: Omit<IResolveWorkingDirectoryRequest, 'sessionUri' | 'sessionId'>): Promise<{ handle: string; worktree: URI }>;
	claimDetachedWorktree(handle: string): Promise<void>;
	setDetachedWorktreeArchived(handle: string, archived: boolean): Promise<void>;
	deleteDetachedWorktree(handle: string): Promise<void>;
	reconcileDetachedWorktrees(scope: string, activeHandles: readonly string[]): Promise<void>;
	resolveIsolationConfig(request: IResolveIsolationConfigRequest): Promise<IIsolationConfigContribution | undefined>;
	branchCompletions(workingDirectory: URI | undefined, query?: string): Promise<{ items: { value: string; label: string }[] }>;
	takePendingAnnouncement(sessionId: string): string | undefined;
	persistCreationFailure(sessionUri: URI, sessionId: string, diagnostic: string | undefined): Promise<void>;
	applyRestoreAnnouncement(sessionUri: URI, turns: readonly Turn[]): Promise<readonly Turn[]>;
	prepareSessionDeletion(sessionUri: URI, sessionId: string): Promise<ISessionWorktree | undefined>;
	removeSessionWorktree(sessionId: string, worktree: ISessionWorktree | undefined): Promise<void>;
	discardSessionWorktree(sessionUri: URI, sessionId: string, worktree: ISessionWorktree | undefined): Promise<void>;
	cleanupWorktreeOnArchive(sessionUri: URI, sessionId: string): Promise<void>;
	recreateWorktreeOnUnarchive(sessionUri: URI, sessionId: string): Promise<void>;
	readWorktreeMetadata(sessionUri: URI): Promise<IWorktreeMetadata | undefined>;
	adoptExistingWorktreeMetadata(sessionUri: URI, workingDirectory: URI): Promise<boolean>;
	recordAdoptedWorktreeMetadata(sessionUri: URI, metadata: { readonly branchName: string; readonly baseBranch: string | undefined; readonly worktreePath: URI; readonly repositoryRoot: URI }): Promise<void>;
	recordExternalWorktreeProject(sessionUri: URI, workingDirectory: URI): Promise<IAgentSessionProjectInfo | undefined>;
	resolveWorktreeProject(sessionUri: URI): Promise<IAgentSessionProjectInfo | undefined>;
	sessionWorktreeProject(sessionId: string): IAgentSessionProjectInfo | undefined;
}

const WORKTREE_META_BRANCH = 'copilot.worktree.branchName';
const WORKTREE_META_PATH = 'copilot.worktree.path';
export const WORKTREE_META_REPOSITORY_ROOT = 'copilot.worktree.repositoryRoot';
const WORKTREE_META_CREATION_FAILURE = 'copilot.worktree.creationFailure';
const DETACHED_WORKTREE_OWNER_SCHEME = 'vscode-agent-host-worktree';
const DETACHED_WORKTREE_SCOPE = 'vscode.devContainerWorktree.scope';
const DETACHED_WORKTREE_CREATED_AT = 'vscode.devContainerWorktree.createdAt';
const DETACHED_WORKTREE_CLAIMED = 'vscode.devContainerWorktree.claimed';
const DETACHED_WORKTREE_LAST_SEEN_AT = 'vscode.devContainerWorktree.lastSeenAt';
const DETACHED_WORKTREE_DELETION_PENDING = 'vscode.devContainerWorktree.deletionPending';
const DETACHED_WORKTREE_RECONCILE_GRACE_MS = 24 * 60 * 60 * 1000;
const LEGACY_WORKTREE_META_WORKING_DIRECTORY = 'copilot.workingDirectory';
const MAX_WORKTREE_FAILURE_DIAGNOSTIC_LENGTH = 200;

function detachedWorktreeRecordUri(handle: string): URI {
	return URI.from({ scheme: DETACHED_WORKTREE_OWNER_SCHEME, path: `/${DEV_CONTAINER_WORKTREE_DATA_ID_PREFIX}${handle}` });
}

export class SessionWorkingDirectoryMissingError extends Error {
	constructor(readonly workingDirectory: URI, readonly reason?: string) {
		super(reason
			? localize('sessionWorkingDirectoryMissingWithReason', "This session couldn't be loaded because its worktree is missing and could not be recreated: {0}", reason)
			: localize('sessionWorkingDirectoryMissing', "This session couldn't be loaded because its working directory no longer exists: {0}", workingDirectory.fsPath));
		this.name = 'SessionWorkingDirectoryMissingError';
	}
}

const BRANCH_COMPLETION_LIMIT = 25;
const WORKTREE_PROGRESS_DEBOUNCE_MS = 40;

export interface ISessionWorktree {
	readonly repositoryRoot: URI;
	readonly worktree: URI;
}

export interface IWorktreeMetadata {
	readonly branchName: string;
	readonly worktreePath?: URI;
	readonly repositoryRoot?: URI;
}







export { getWorktreesRoot };

export function getWorktreeName(branchName: string, branchPrefix: string = ''): string {
	let name = branchName;
	if (branchPrefix && name.startsWith(branchPrefix)) {
		name = name.substring(branchPrefix.length);
	}
	if (name.startsWith(AGENT_BRANCH_PREFIX)) {
		name = name.substring(AGENT_BRANCH_PREFIX.length);
	}
	return name.replace(/\//g, '-');
}

export function buildWorktreeAnnouncementText(branchName: string): string {
	return localize(
		'agentHost.worktreeCreated',
		"Created isolated worktree for branch {0}",
		appendEscapedMarkdownInlineCode(branchName)
	) + '\n\n';
}

export function buildWorktreeFailureNotification(diagnostic?: string): Extract<ResponsePart, { kind: ResponsePartKind.SystemNotification }> {
	const normalizedDiagnostic = normalizeWorktreeFailureDiagnostic(diagnostic);
	const content = normalizedDiagnostic
		? localize(
			'agentHost.worktreeCreationFailedWithDiagnostic',
			"Couldn't create the isolated worktree. This session is continuing in the original folder.\n\n{0}",
			appendEscapedMarkdownInlineCode(normalizedDiagnostic)
		)
		: localize(
			'agentHost.worktreeCreationFailed',
			"Couldn't create the isolated worktree. This session is continuing in the original folder."
		);
	return {
		kind: ResponsePartKind.SystemNotification,
		content,
		_meta: toAgentSystemNotificationMeta({
			kind: AgentSystemNotificationKind.WorktreeCreationFailure,
			severity: AgentSystemNotificationSeverity.Warning,
		}),
	};
}

export function normalizeWorktreeFailureDiagnostic(diagnostic: string | undefined): string | undefined {
	const normalized = diagnostic?.replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return undefined;
	}
	return normalized.length > MAX_WORKTREE_FAILURE_DIAGNOSTIC_LENGTH
		? `${normalized.slice(0, MAX_WORKTREE_FAILURE_DIAGNOSTIC_LENGTH - 3)}...`
		: normalized;
}

export const enum WorktreeCreationPhase {
	Starting,
	NamingBranch,
	CheckingOut,
	CopyingIncludeFiles,
}

export function buildWorktreeProgressText(phase: WorktreeCreationPhase, percent?: number): string {
	switch (phase) {
		case WorktreeCreationPhase.NamingBranch:
			return localize('agentHost.worktreeNamingBranch', "Creating isolated worktree (naming branch)");
		case WorktreeCreationPhase.CheckingOut:
			return percent === undefined
				? localize('agentHost.worktreeCheckingOut', "Creating isolated worktree (checking out files)")
				: localize('agentHost.worktreeCheckingOutPercent', "Creating isolated worktree (checking out files, {0}%)", percent);
		case WorktreeCreationPhase.CopyingIncludeFiles:
			return percent === undefined
				? localize('agentHost.worktreeCopyingIncludeFiles', "Creating isolated worktree (copying additional files)")
				: localize('agentHost.worktreeCopyingIncludeFilesPercent', "Creating isolated worktree (copying additional files, {0}%)", percent);
		default:
			return localize('agentHost.worktreeCreating', "Creating isolated worktree");
	}
}

async function withPercentProgress<T>(
	phase: WorktreeCreationPhase,
	onProgress: ((activity: string) => void) | undefined,
	operation: (onProgress: ((progress: IWorktreeFileProgress) => void) | undefined) => Promise<T>,
): Promise<T> {
	if (!onProgress) {
		return operation(undefined);
	}

	let lastPercent = -1;
	const scheduler = new RunOnceScheduler(() => onProgress(buildWorktreeProgressText(phase, lastPercent)), WORKTREE_PROGRESS_DEBOUNCE_MS);
	try {
		return await operation(({ filesDone, filesTotal }) => {
			const percent = Math.min(100, Math.floor(filesDone * 100 / filesTotal));
			if (percent <= lastPercent) {
				return;
			}
			lastPercent = percent;
			scheduler.schedule();
		});
	} finally {
		const shouldFlush = scheduler.isScheduled();
		scheduler.dispose();
		if (shouldFlush) {
			onProgress(buildWorktreeProgressText(phase, lastPercent));
		}
	}
}

export function prependAnnouncementToFirstTurn(turns: readonly Turn[], announcement: string): readonly Turn[] {
	if (turns.length === 0) {
		return turns;
	}
	const result = turns.slice();
	const first = result[0];
	const part = first.responseParts[0];
	if (part?.kind === ResponsePartKind.Markdown) {
		const responseParts = first.responseParts.slice();
		responseParts[0] = { ...part, content: announcement + part.content };
		result[0] = { ...first, responseParts };
	} else {
		const responseParts: ResponsePart[] = [
			{ kind: ResponsePartKind.Markdown, id: generateUuid(), content: announcement },
			...first.responseParts,
		];
		result[0] = { ...first, responseParts };
	}
	return result;
}

function prependWorktreeFailureToFirstTurn(turns: readonly Turn[], diagnostic: string | undefined): readonly Turn[] {
	if (turns.length === 0) {
		return turns;
	}
	const result = turns.slice();
	const first = result[0];
	result[0] = {
		...first,
		responseParts: [buildWorktreeFailureNotification(diagnostic), ...first.responseParts],
	};
	return result;
}

export interface IResolveIsolationConfigRequest {
	readonly workingDirectory: URI | undefined;
	readonly config: Record<string, unknown> | undefined;
}

export interface IIsolationConfigContribution {
	readonly isolationProperty: ISchemaProperty<'folder' | 'worktree'>;
	readonly branchProperty: ISchemaProperty<string> | undefined;
	readonly worktreeBranchPrefixProperty: ISchemaProperty<string> | undefined;
	readonly worktreeIncludeFilesProperty: ISchemaProperty<readonly string[]> | undefined;
	readonly worktreeBranchTrackProperty: ISchemaProperty<boolean> | undefined;
	readonly worktreeCreateNewBranchProperty: ISchemaProperty<boolean> | undefined;
	readonly isolationValue: 'folder' | 'worktree';
	readonly branchDefault: string | undefined;
	readonly branchValue: string | undefined;
}

export interface IResolveWorkingDirectoryRequest {
	readonly sessionUri: URI;
	readonly sessionId: string;
	readonly workingDirectory: URI | undefined;
	readonly config: Record<string, unknown> | undefined;
	readonly prompt?: string;
	readonly githubToken?: string;
	readonly onProgress?: (activity: string) => void;
	readonly onWillCreate?: (metadata: { readonly repositoryRoot: URI; readonly worktreePath: URI; readonly baseBranch: string | undefined; readonly branchName: string }) => Promise<void>;
}

export class WorktreeIsolation extends Disposable implements IAgentHostWorktreeIsolation {
	declare readonly _serviceBrand: undefined;
	readonly supported: boolean = true;

	private readonly _materializedWorktrees = new Map<string, ISessionWorktree>();
	private readonly _worktreeDeletionRetries = new Map<string, ISessionWorktree>();

	private readonly _pendingFirstTurnAnnouncements = new Map<string, string>();

	private readonly _pending = new Set<string>();
	private readonly _onDidChangeWorkingDirectoryPending = this._register(new Emitter<string>());
	readonly onDidChangeWorkingDirectoryPending: Event<string> = this._onDidChangeWorkingDirectoryPending.event;

	private readonly _logLabel = 'AgentHost';

	private readonly _sequencer = new SequencerByKey<string>();
	private readonly _worktreeCreationSequencer = new SequencerByKey<string>();

	constructor(
		@IAgentBranchNameGenerator private readonly _branchNameGenerator: IAgentBranchNameGenerator,
		@IAgentHostGitService private readonly _gitService: IAgentHostGitService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		void this._cleanupUnclaimedDetachedWorktrees().catch(error =>
			this._logService.warn(`[${this._logLabel}] Failed to clean up unclaimed detached worktrees: ${errorMessage(error)}`));
	}

	notePending(sessionId: string): void {
		if (!this._pending.has(sessionId)) {
			this._pending.add(sessionId);
			this._onDidChangeWorkingDirectoryPending.fire(sessionId);
		}
	}

	clearPending(sessionId: string): void {
		if (this._pending.delete(sessionId)) {
			this._onDidChangeWorkingDirectoryPending.fire(sessionId);
		}
	}

	isWorkingDirectoryPending(sessionId: string): boolean {
		return this._pending.has(sessionId);
	}

	getResolvedWorktree(sessionId: string): URI | undefined {
		return this._materializedWorktrees.get(sessionId)?.worktree;
	}

	async resolveOnFirstSend(request: IResolveWorkingDirectoryRequest): Promise<URI | undefined> {
		return this._sequencer.queue(request.sessionId, async () => {
			try {
				return await this.resolveWorkingDirectory(request);
			} finally {
				this.clearPending(request.sessionId);
			}
		});
	}

	async createDetachedWorktree(request: Omit<IResolveWorkingDirectoryRequest, 'sessionUri' | 'sessionId'>): Promise<{ handle: string; worktree: URI }> {
		const handle = generateUuid();
		const record = detachedWorktreeRecordUri(handle);
		const createdAtRef = this._sessionDataService.openDatabase(record);
		try {
			await createdAtRef.object.setMetadataValues({
				[DETACHED_WORKTREE_CREATED_AT]: String(Date.now()),
				[DETACHED_WORKTREE_CLAIMED]: 'false',
			});
		} finally {
			createdAtRef.dispose();
		}
		let worktree: URI | undefined;
		try {
			worktree = await this.resolveWorkingDirectory({
				...request,
				sessionUri: record,
				sessionId: handle,
				onWillCreate: async metadata => {
					await this._writeWorktreeMetadata(record, metadata);
					const ref = this._sessionDataService.openDatabase(record);
					try {
						await ref.object.setMetadata(DETACHED_WORKTREE_SCOPE, getComparisonKey(metadata.worktreePath));
					} finally {
						ref.dispose();
					}
				},
			});
		} catch (error) {
			const metadata = await this.readWorktreeMetadata(record).catch(() => undefined);
			if (metadata?.repositoryRoot && metadata.worktreePath) {
				try {
					await this.removeSessionWorktree(handle, { repositoryRoot: metadata.repositoryRoot, worktree: metadata.worktreePath });
					await this._sessionDataService.deleteSessionData(record);
				} catch {
				}
			} else {
				await this._sessionDataService.deleteSessionData(record);
			}
			throw error;
		}
		if (!worktree || (request.workingDirectory && isEqual(worktree, request.workingDirectory))) {
			await this._sessionDataService.deleteSessionData(record);
			throw new Error('Failed to create detached worktree.');
		}
		const metadata = await this.readWorktreeMetadata(record);
		if (!metadata?.repositoryRoot || !metadata.worktreePath) {
			const materialized = this._materializedWorktrees.get(handle);
			await this.removeSessionWorktree(handle, materialized);
			await this._sessionDataService.deleteSessionData(record);
			throw new Error('Failed to persist detached worktree metadata.');
		}
		this.takePendingAnnouncement(handle);
		return { handle, worktree };
	}

	async claimDetachedWorktree(handle: string): Promise<void> {
		const record = detachedWorktreeRecordUri(handle);
		const ref = await this._sessionDataService.tryOpenDatabase(record);
		if (!ref) {
			throw new Error(`Unknown detached worktree handle: ${handle}`);
		}
		try {
			await ref.object.setMetadataValues({
				[DETACHED_WORKTREE_CLAIMED]: 'true',
				[DETACHED_WORKTREE_LAST_SEEN_AT]: String(Date.now()),
			});
		} finally {
			ref.dispose();
		}
	}

	async setDetachedWorktreeArchived(handle: string, archived: boolean): Promise<void> {
		const record = detachedWorktreeRecordUri(handle);
		const ref = await this._sessionDataService.tryOpenDatabase(record);
		if (!ref) {
			this._logService.info(`[${this._logLabel}:${handle}] Detached worktree record is unavailable; skipping ${archived ? 'archive' : 'unarchive'} cleanup`);
			return;
		}
		try {
			await ref.object.setMetadata(AH_META_IS_ARCHIVED_DB_KEY, archived ? 'true' : '');
		} finally {
			ref.dispose();
		}
		if (archived) {
			await this.cleanupWorktreeOnArchive(record, handle);
		} else {
			await this.recreateWorktreeOnUnarchive(record, handle);
		}
	}

	async deleteDetachedWorktree(handle: string): Promise<void> {
		const record = detachedWorktreeRecordUri(handle);
		return this._sequencer.queue(handle, async () => {
			const ref = await this._sessionDataService.tryOpenDatabase(record);
			if (!ref) {
				return;
			}
			ref.dispose();
			const deletionRef = this._sessionDataService.openDatabase(record);
			try {
				await deletionRef.object.setMetadata(DETACHED_WORKTREE_DELETION_PENDING, 'true');
			} finally {
				deletionRef.dispose();
			}
			const retry = this._worktreeDeletionRetries.get(handle);
			const materialized = this._materializedWorktrees.get(handle);
			const metadata = retry || materialized ? undefined : await this._readWorktreeMetadata(record);
			const worktree = retry ?? materialized ?? (metadata?.worktreePath && metadata.repositoryRoot
				? { repositoryRoot: metadata.repositoryRoot, worktree: metadata.worktreePath }
				: undefined);
			await this._removeSessionWorktree(handle, worktree);
			await this._sessionDataService.deleteSessionData(record);
		});
	}

	async reconcileDetachedWorktrees(scope: string, activeHandles: readonly string[]): Promise<void> {
		await this._reconcileDetachedWorktrees(scope, new Set(activeHandles), false);
	}

	private async _cleanupUnclaimedDetachedWorktrees(): Promise<void> {
		await this._reconcileDetachedWorktrees(undefined, new Set(), true);
	}

	private async _reconcileDetachedWorktrees(scope: string | undefined, activeHandles: ReadonlySet<string>, unclaimedOnly: boolean): Promise<void> {
		const dataIds = await this._sessionDataService.listSessionDataIds?.(DEV_CONTAINER_WORKTREE_DATA_ID_PREFIX) ?? [];
		for (const dataId of dataIds) {
			const handle = dataId.substring(DEV_CONTAINER_WORKTREE_DATA_ID_PREFIX.length);
			if (!isAgentDevContainerWorktreeHandle(handle)) {
				continue;
			}
			const record = detachedWorktreeRecordUri(handle);
			await this._sequencer.queue(handle, async () => {
				const ref = await this._sessionDataService.tryOpenDatabase(record);
				if (!ref) {
					return;
				}
				let recordScope: string | undefined;
				let createdAt = Number.NaN;
				let lastSeenAt = Number.NaN;
				let claimed = false;
				let deletionPending = false;
				try {
					const metadata = await ref.object.getMetadataObject({
						[DETACHED_WORKTREE_SCOPE]: true,
						[DETACHED_WORKTREE_CREATED_AT]: true,
						[DETACHED_WORKTREE_CLAIMED]: true,
						[DETACHED_WORKTREE_LAST_SEEN_AT]: true,
						[DETACHED_WORKTREE_DELETION_PENDING]: true,
					});
					recordScope = metadata[DETACHED_WORKTREE_SCOPE];
					createdAt = Number(metadata[DETACHED_WORKTREE_CREATED_AT]);
					claimed = metadata[DETACHED_WORKTREE_CLAIMED] === 'true';
					lastSeenAt = Number(metadata[DETACHED_WORKTREE_LAST_SEEN_AT]);
					deletionPending = metadata[DETACHED_WORKTREE_DELETION_PENDING] === 'true';
				} finally {
					ref.dispose();
				}
				if (!unclaimedOnly && recordScope === scope && activeHandles.has(handle)) {
					const activeRef = this._sessionDataService.openDatabase(record);
					try {
						await activeRef.object.setMetadata(DETACHED_WORKTREE_LAST_SEEN_AT, String(Date.now()));
					} finally {
						activeRef.dispose();
					}
					return;
				}
				const referenceTime = claimed ? lastSeenAt : createdAt;
				const withinGracePeriod = Number.isFinite(referenceTime) && Date.now() - referenceTime < DETACHED_WORKTREE_RECONCILE_GRACE_MS;
				if ((unclaimedOnly ? claimed && !deletionPending : recordScope !== scope) || (!deletionPending && withinGracePeriod)) {
					return;
				}
				const metadata = await this._readWorktreeMetadata(record);
				if (!metadata?.repositoryRoot || !metadata.worktreePath) {
					await this._sessionDataService.deleteSessionData(record);
					return;
				}
				if (deletionPending) {
					try {
						await this._removeSessionWorktree(handle, { repositoryRoot: metadata.repositoryRoot, worktree: metadata.worktreePath });
						await this._sessionDataService.deleteSessionData(record);
					} catch (error) {
						this._logService.warn(`[${this._logLabel}:${handle}] Failed to retry detached worktree deletion for '${metadata.worktreePath.fsPath}': ${errorMessage(error)}`);
					}
					return;
				}
				try {
					await fs.access(metadata.worktreePath.fsPath);
				} catch {
					this._materializedWorktrees.delete(handle);
					this._worktreeDeletionRetries.delete(handle);
					await this._sessionDataService.deleteSessionData(record);
					return;
				}
				const dirty = await this._gitService.hasUncommittedChanges(metadata.worktreePath).catch(() => true);
				if (dirty) {
					return;
				}
				try {
					await this._gitService.removeWorktree(metadata.repositoryRoot, metadata.worktreePath);
					this._materializedWorktrees.delete(handle);
					this._worktreeDeletionRetries.delete(handle);
					await this._sessionDataService.deleteSessionData(record);
				} catch (error) {
					this._logService.warn(`[${this._logLabel}:${handle}] Failed to clean up detached worktree '${metadata.worktreePath.fsPath}': ${errorMessage(error)}`);
				}
			});
		}
	}

	async resolveIsolationConfig(request: IResolveIsolationConfigRequest): Promise<IIsolationConfigContribution> {
		const gitInfo = request.workingDirectory ? await this._getGitInfo(request.workingDirectory) : undefined;

		const isolationProperty = schemaProperty<'folder' | 'worktree'>({
			type: 'string',
			title: localize('agentHost.sessionConfig.isolation', "Isolation"),
			description: localize('agentHost.sessionConfig.isolationDescription', "Where the agent should make changes"),
			enum: gitInfo ? ['folder', 'worktree'] : ['folder'],
			enumLabels: gitInfo ? [localize('agentHost.sessionConfig.isolation.folder', "Folder"), localize('agentHost.sessionConfig.isolation.worktree', "Worktree")] : [localize('agentHost.sessionConfig.isolation.folder', "Folder")],
			enumDescriptions: gitInfo ? [localize('agentHost.sessionConfig.isolation.folderDescription', "Work directly in the folder"), localize('agentHost.sessionConfig.isolation.worktreeDescription', "Create a Git worktree for isolation")] : [localize('agentHost.sessionConfig.isolation.folderDescription', "Work directly in the folder")],
			default: gitInfo ? 'worktree' : 'folder',
			readOnly: !gitInfo,
			sessionMutable: false,
		});

		const isolationDefault: 'folder' | 'worktree' = gitInfo ? 'worktree' : 'folder';
		const isolationValue = isolationProperty.validate(request.config?.[SessionConfigKey.Isolation])
			? request.config![SessionConfigKey.Isolation] as 'folder' | 'worktree'
			: isolationDefault;

		let branchProperty: ISchemaProperty<string> | undefined;
		let branchDefault: string | undefined;
		let branchValue: string | undefined;
		let worktreeBranchPrefixProperty: ISchemaProperty<string> | undefined;
		let worktreeIncludeFilesProperty: ISchemaProperty<readonly string[]> | undefined;
		let worktreeBranchTrackProperty: ISchemaProperty<boolean> | undefined;
		let worktreeCreateNewBranchProperty: ISchemaProperty<boolean> | undefined;
		if (gitInfo) {
			branchDefault = isolationValue === 'worktree' ? gitInfo.defaultBranch.name : gitInfo.currentBranch;
			branchValue = typeof request.config?.[SessionConfigKey.Branch] === 'string'
				? request.config[SessionConfigKey.Branch] as string
				: branchDefault;
			branchProperty = schemaProperty<string>({
				type: 'string',
				title: localize('agentHost.sessionConfig.branch', "Branch"),
				description: localize('agentHost.sessionConfig.branchDescription', "Base branch to work from"),
				enum: [branchDefault],
				enumLabels: [branchDefault],
				default: branchDefault,
				enumDynamic: true,
				readOnly: false,
				sessionMutable: false,
			});

			worktreeBranchPrefixProperty = schemaProperty<string>({
				type: 'string',
				title: localize('agentHost.sessionConfig.worktreeBranchPrefix', "Worktree Branch Prefix"),
				description: localize('agentHost.sessionConfig.worktreeBranchPrefixDescription', "Prefix applied to the branch created for an isolated worktree."),
				readOnly: true,
				sessionMutable: false,
			});

			worktreeBranchTrackProperty = schemaProperty<boolean>({
				type: 'boolean',
				title: localize('agentHost.sessionConfig.worktreeBranchTrack', "Worktree Branch Tracking"),
				description: localize('agentHost.sessionConfig.worktreeBranchTrackDescription', "Whether the branch created for an isolated worktree tracks its upstream."),
				default: false,
				readOnly: true,
				sessionMutable: false,
			});

			worktreeCreateNewBranchProperty = schemaProperty<boolean>({
				type: 'boolean',
				title: localize('agentHost.sessionConfig.worktreeCreateNewBranch', "Create New Worktree Branch"),
				description: localize('agentHost.sessionConfig.worktreeCreateNewBranchDescription', "Whether to create a new branch for the isolated worktree."),
				default: true,
				readOnly: true,
				sessionMutable: false,
			});

			worktreeIncludeFilesProperty = schemaProperty<readonly string[]>({
				type: 'array',
				title: localize('agentHost.sessionConfig.worktreeIncludeFiles', "Worktree Include Files"),
				description: localize('agentHost.sessionConfig.worktreeIncludeFilesDescription', "Glob patterns for git-ignored files to copy into the isolated worktree."),
				items: {
					type: 'string',
					title: localize('agentHost.sessionConfig.worktreeIncludeFilesItem', "Pattern"),
				},
				readOnly: true,
				sessionMutable: false,
			});
		}

		return { isolationProperty, branchProperty, worktreeBranchPrefixProperty, worktreeBranchTrackProperty, worktreeCreateNewBranchProperty, worktreeIncludeFilesProperty, isolationValue, branchDefault, branchValue };
	}

	async branchCompletions(workingDirectory: URI | undefined, query?: string): Promise<{ items: { value: string; label: string }[] }> {
		if (!workingDirectory) {
			return { items: [] };
		}
		const [branches, currentBranch, defaultBranch] = await Promise.all([
			this._gitService.getBranches(workingDirectory, { pattern: ['refs/heads'], sort: 'committerdate' }),
			this._gitService.getCurrentBranch(workingDirectory),
			this._gitService.getDefaultBranch(workingDirectory),
		]);
		const branchCompletions = getBranchCompletions(branches.map(branch => branch.name), {
			currentBranch,
			defaultBranch: defaultBranch?.name,
			query,
			limit: BRANCH_COMPLETION_LIMIT,
		});

		return { items: branchCompletions.map(branch => ({ value: branch, label: branch })) };
	}

	async resolveWorkingDirectory(request: IResolveWorkingDirectoryRequest): Promise<URI | undefined> {
		const { config, workingDirectory, sessionId, sessionUri, prompt, onProgress } = request;
		if (config?.[SessionConfigKey.Isolation] !== 'worktree' || !workingDirectory || typeof config[SessionConfigKey.Branch] !== 'string') {
			return workingDirectory;
		}

		const already = this._materializedWorktrees.get(sessionId);
		if (already) {
			return already.worktree;
		}

		onProgress?.(buildWorktreeProgressText(WorktreeCreationPhase.Starting));

		const checkoutRoot = await this._gitService.getRepositoryRoot(workingDirectory);
		if (!checkoutRoot) {
			return workingDirectory;
		}

		const repositoryRoot = await this._resolvePrimaryWorktreeRoot(checkoutRoot, checkoutRoot);

		const selectedBranch = config[SessionConfigKey.Branch] as string;
		const worktreeBranchTrack = config[SessionConfigKey.WorktreeBranchTrack] === true;
		const worktreeCreateNewBranch = config[SessionConfigKey.WorktreeCreateNewBranch] !== false;

		const worktreeBranchPrefix = worktreeCreateNewBranch && typeof config[SessionConfigKey.WorktreeBranchPrefix] === 'string'
			? config[SessionConfigKey.WorktreeBranchPrefix] as string
			: undefined;

		const { worktreePath, branchName, baseBranch } = await this._worktreeCreationSequencer.queue(repositoryRoot.toString(), async () => {
			const worktreesRoot = getWorktreesRoot(repositoryRoot);

			if (worktreeCreateNewBranch) {
				onProgress?.(buildWorktreeProgressText(WorktreeCreationPhase.NamingBranch));
			}
			const newBranchName = worktreeCreateNewBranch
				? await this._branchNameGenerator.generateBranchName({
					sessionId,
					message: prompt,
					branchPrefix: worktreeBranchPrefix,
					branchNameCollides: async candidate => {
						if (await this._gitService.branchExists(repositoryRoot, candidate).catch(() => true)) {
							return true;
						}
						const candidateWorktree = URI.joinPath(worktreesRoot, getWorktreeName(candidate, worktreeBranchPrefix));
						return fileExists(candidateWorktree.fsPath);
					},
				})
				: undefined;

			const branchStartPoint = await this._resolveBranchStartPoint(repositoryRoot, selectedBranch);

			const baseBranch = worktreeCreateNewBranch
				? branchStartPoint
				: (await this._gitService.getDefaultBranch(repositoryRoot))?.startPoint;

			onProgress?.(buildWorktreeProgressText(WorktreeCreationPhase.CheckingOut));

			const worktreePath = URI.joinPath(worktreesRoot, getWorktreeName(newBranchName ?? selectedBranch, worktreeBranchPrefix));
			await request.onWillCreate?.({ repositoryRoot, worktreePath, baseBranch, branchName: newBranchName ?? selectedBranch });
			await fs.mkdir(worktreesRoot.fsPath, { recursive: true });

			await withPercentProgress(WorktreeCreationPhase.CheckingOut, onProgress, progress =>
				this._gitService.addWorktree(repositoryRoot, {
					path: worktreePath,
					commitish: worktreeCreateNewBranch
						? branchStartPoint
						: selectedBranch,
					newBranchName,
					preferRemoteBranch: worktreeCreateNewBranch,
					track: worktreeBranchTrack,
					onProgress: progress,
				}));

			return { branchName: newBranchName ?? selectedBranch, worktreePath, baseBranch };
		});

		const worktreeIncludeFiles = Array.isArray(config[SessionConfigKey.WorktreeIncludeFiles])
			&& config[SessionConfigKey.WorktreeIncludeFiles].every(pattern => typeof pattern === 'string')
			? config[SessionConfigKey.WorktreeIncludeFiles] as readonly string[]
			: undefined;
		if (worktreeIncludeFiles?.length) {
			try {
				onProgress?.(buildWorktreeProgressText(WorktreeCreationPhase.CopyingIncludeFiles));
				await withPercentProgress(WorktreeCreationPhase.CopyingIncludeFiles, onProgress, progress =>
					this._gitService.copyWorktreeIncludeFiles(checkoutRoot, worktreePath, worktreeIncludeFiles, progress));
			} catch (error) {
				this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to copy worktree include files: ${errorMessage(error)}`);
			}
		}

		this._materializedWorktrees.set(sessionId, { repositoryRoot, worktree: worktreePath });

		this._pendingFirstTurnAnnouncements.set(sessionId, buildWorktreeAnnouncementText(branchName));

		try {
			await this._writeWorktreeMetadata(sessionUri, { repositoryRoot, worktreePath, baseBranch, branchName });
		} catch (error) {
			this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to persist worktree branch metadata: ${errorMessage(error)}`);
		}

		return worktreePath;
	}

	async resolveWorkingDirectoryForResume(sessionUri: URI, sessionId: string, workingDirectory: URI): Promise<URI> {
		return this._sequencer.queue(sessionId, () => this._resolveWorkingDirectoryForResume(sessionUri, sessionId, workingDirectory));
	}

	private async _resolveWorkingDirectoryForResume(sessionUri: URI, sessionId: string, workingDirectory: URI): Promise<URI> {
		if (workingDirectory.scheme !== Schemas.file) {
			return workingDirectory;
		}
		try {
			await fs.access(workingDirectory.fsPath);
			return workingDirectory;
		} catch {
		}

		const meta = await this._readWorktreeMetadata(sessionUri).catch(() => undefined);
		const archived = await this._isSessionArchived(sessionUri);
		if (archived) {
			if (meta?.repositoryRoot) {
				try {
					await fs.access(meta.repositoryRoot.fsPath);
					this._logService.info(`[${this._logLabel}:${sessionId}] Archived session working directory '${workingDirectory.fsPath}' is missing; resuming against repository root '${meta.repositoryRoot.fsPath}' for history`);
					return meta.repositoryRoot;
				} catch {
				}
			}
			this._logService.warn(`[${this._logLabel}:${sessionId}] Cannot resume archived session: working directory '${workingDirectory.fsPath}' is missing and no usable repository-root fallback was found`);
			throw new SessionWorkingDirectoryMissingError(workingDirectory);
		}

		let recreateFailureReason: string | undefined;
		if (meta?.worktreePath && meta.repositoryRoot) {
			const { branchName, worktreePath, repositoryRoot } = meta;
			const recreated = await this._recreateWorktree(sessionId, { branchName, worktreePath, repositoryRoot });
			if (recreated.ok) {
				this._logService.info(`[${this._logLabel}:${sessionId}] Recreated missing worktree '${worktreePath.fsPath}' for a live session on resume`);
				return worktreePath;
			}
			recreateFailureReason = recreated.reason;
		}

		this._logService.warn(`[${this._logLabel}:${sessionId}] Cannot resume: working directory '${workingDirectory.fsPath}' is missing and its worktree could not be recreated${recreateFailureReason ? `: ${recreateFailureReason}` : ''}`);
		throw new SessionWorkingDirectoryMissingError(workingDirectory, recreateFailureReason);
	}

	takePendingAnnouncement(sessionId: string): string | undefined {
		const announcement = this._pendingFirstTurnAnnouncements.get(sessionId);
		if (announcement !== undefined) {
			this._pendingFirstTurnAnnouncements.delete(sessionId);
		}
		return announcement;
	}

	async persistCreationFailure(sessionUri: URI, sessionId: string, diagnostic: string | undefined): Promise<void> {
		const dbRef = this._sessionDataService.openDatabase(sessionUri);
		try {
			await dbRef.object.setMetadata(WORKTREE_META_CREATION_FAILURE, JSON.stringify({
				sessionId,
				diagnostic: normalizeWorktreeFailureDiagnostic(diagnostic),
			}));
		} finally {
			dbRef.dispose();
		}
	}

	async applyRestoreAnnouncement(sessionUri: URI, turns: readonly Turn[]): Promise<readonly Turn[]> {
		const notice = await this._readWorktreeNotice(sessionUri).catch(() => undefined);
		if (notice?.kind === 'failure') {
			return prependWorktreeFailureToFirstTurn(turns, notice.diagnostic);
		}
		if (notice?.kind !== 'success') {
			return turns;
		}
		return prependAnnouncementToFirstTurn(turns, buildWorktreeAnnouncementText(notice.branchName));
	}

	async prepareSessionDeletion(sessionUri: URI, sessionId: string): Promise<ISessionWorktree | undefined> {
		return this._sequencer.queue(sessionId, async () => {
			const deletionRetry = this._worktreeDeletionRetries.get(sessionId);
			if (deletionRetry) {
				return deletionRetry;
			}
			const materializedWorktree = this._materializedWorktrees.get(sessionId);
			if (materializedWorktree) {
				return materializedWorktree;
			}
			try {
				const meta = await this._readWorktreeMetadata(sessionUri);
				return meta?.worktreePath && meta.repositoryRoot
					? { repositoryRoot: meta.repositoryRoot, worktree: meta.worktreePath }
					: undefined;
			} catch (error) {
				this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to read worktree metadata before session deletion: ${errorMessage(error)}`);
				throw error;
			}
		});
	}

	async removeSessionWorktree(sessionId: string, worktree: ISessionWorktree | undefined): Promise<void> {
		return this._sequencer.queue(sessionId, () => this._removeSessionWorktree(sessionId, worktree));
	}

	async discardSessionWorktree(sessionUri: URI, sessionId: string, worktree: ISessionWorktree | undefined): Promise<void> {
		await this.removeSessionWorktree(sessionId, worktree);
		const dbRef = this._sessionDataService.openDatabase(sessionUri);
		try {
			await dbRef.object.deleteMetadata([
				WORKTREE_META_BRANCH,
				WORKTREE_META_PATH,
				WORKTREE_META_REPOSITORY_ROOT,
				WORKTREE_META_CREATION_FAILURE,
				LEGACY_WORKTREE_META_WORKING_DIRECTORY,
				META_DIFF_BASE_BRANCH,
			]);
		} finally {
			dbRef.dispose();
		}
	}

	private async _removeSessionWorktree(sessionId: string, worktree: ISessionWorktree | undefined): Promise<void> {
		this.clearPending(sessionId);
		if (!worktree) {
			return;
		}
		try {
			await this._gitService.removeWorktree(worktree.repositoryRoot, worktree.worktree, { force: true });
			this._materializedWorktrees.delete(sessionId);
			this._worktreeDeletionRetries.delete(sessionId);
		} catch (error) {
			this._worktreeDeletionRetries.set(sessionId, worktree);
			this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to remove worktree '${worktree.worktree.fsPath}': ${errorMessage(error)}`);
			throw error;
		}
	}

	async cleanupWorktreeOnArchive(sessionUri: URI, sessionId: string): Promise<void> {
		return this._sequencer.queue(sessionId, () => this._cleanupWorktreeOnArchive(sessionUri, sessionId));
	}

	private async _cleanupWorktreeOnArchive(sessionUri: URI, sessionId: string): Promise<void> {
		const meta = await this._readWorktreeMetadata(sessionUri).catch(() => undefined);
		if (!meta?.worktreePath || !meta.repositoryRoot) {
			return;
		}
		const { branchName, worktreePath, repositoryRoot } = meta;

		try {
			await fs.access(worktreePath.fsPath);
		} catch {
			this._materializedWorktrees.delete(sessionId);
			return;
		}

		const branchPresent = await this._gitService.branchExists(repositoryRoot, branchName).catch(() => false);
		if (!branchPresent) {
			this._logService.info(`[${this._logLabel}:${sessionId}] Skipping worktree cleanup: branch '${branchName}' is missing`);
			return;
		}

		const hasUncommittedChanges = await this._gitService.hasUncommittedChanges(worktreePath).catch(() => true);
		if (hasUncommittedChanges) {
			try {
				await this._gitService.commitAll(worktreePath, localize('worktreeIsolation.commitMessage', 'Saving uncommitted changes before archiving session'));
			} catch (error) {
				this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to commit uncommitted changes in '${worktreePath.fsPath}': ${errorMessage(error)}`);
				return;
			}
		}

		try {
			await this._gitService.removeWorktree(repositoryRoot, worktreePath, { force: true });
			this._logService.info(`[${this._logLabel}:${sessionId}] Removed worktree '${worktreePath.fsPath}' on archive`);
			this._materializedWorktrees.delete(sessionId);
		} catch (error) {
			this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to remove worktree '${worktreePath.fsPath}' on archive: ${errorMessage(error)}`);
		}
	}

	async recreateWorktreeOnUnarchive(sessionUri: URI, sessionId: string): Promise<void> {
		return this._sequencer.queue(sessionId, () => this._recreateWorktreeOnUnarchive(sessionUri, sessionId));
	}

	private async _recreateWorktreeOnUnarchive(sessionUri: URI, sessionId: string): Promise<void> {
		const meta = await this._readWorktreeMetadata(sessionUri).catch(() => undefined);
		if (!meta?.worktreePath || !meta.repositoryRoot) {
			return;
		}
		try {
			await fs.access(meta.worktreePath.fsPath);
			return;
		} catch {
		}

		const { branchName, worktreePath, repositoryRoot } = meta;
		await this._recreateWorktree(sessionId, { branchName, worktreePath, repositoryRoot });
	}

	private async _recreateWorktree(sessionId: string, meta: { readonly branchName: string; readonly worktreePath: URI; readonly repositoryRoot: URI }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
		const { branchName, worktreePath, repositoryRoot } = meta;
		const branchPresent = await this._gitService.branchExists(repositoryRoot, branchName).catch(() => false);
		if (!branchPresent) {
			const reason = localize('worktreeRecreateBranchMissing', "the branch '{0}' no longer exists", branchName);
			this._logService.info(`[${this._logLabel}:${sessionId}] Cannot recreate worktree: branch '${branchName}' is missing`);
			return { ok: false, reason };
		}
		try {
			await fs.mkdir(URI.joinPath(worktreePath, '..').fsPath, { recursive: true });
			await this._gitService.addExistingWorktree(repositoryRoot, worktreePath, branchName);
			this._materializedWorktrees.set(sessionId, { repositoryRoot, worktree: worktreePath });
			this._logService.info(`[${this._logLabel}:${sessionId}] Recreated worktree '${worktreePath.fsPath}'`);
			return { ok: true };
		} catch (error) {
			const reason = errorMessage(error);
			this._logService.warn(`[${this._logLabel}:${sessionId}] Failed to recreate worktree '${worktreePath.fsPath}': ${reason}`);
			return { ok: false, reason };
		}
	}

	async readWorktreeMetadata(sessionUri: URI): Promise<IWorktreeMetadata | undefined> {
		return this._readWorktreeMetadata(sessionUri);
	}

	async adoptExistingWorktreeMetadata(sessionUri: URI, workingDirectory: URI): Promise<boolean> {
		const linkedWorktree = await this._resolveLinkedWorktree(workingDirectory);
		if (!linkedWorktree) {
			return false;
		}
		const { worktreeRoot, primaryRoot, baseBranch } = linkedWorktree;
		const branchName = await this._gitService.getCurrentBranch(worktreeRoot).catch(() => undefined) ?? 'HEAD';
		await this._writeWorktreeMetadata(sessionUri, { branchName, baseBranch, worktreePath: worktreeRoot, repositoryRoot: primaryRoot });
		return true;
	}

	async recordAdoptedWorktreeMetadata(sessionUri: URI, metadata: { readonly branchName: string; readonly baseBranch: string | undefined; readonly worktreePath: URI; readonly repositoryRoot: URI }): Promise<void> {
		this._logService.info(`[${this._logLabel}:${AgentSession.id(sessionUri)}] Recorded adopted worktree metadata: worktree='${metadata.worktreePath.fsPath}' branch='${metadata.branchName}' base='${metadata.baseBranch ?? '(none)'}' repo='${metadata.repositoryRoot.fsPath}'`);
		await this._writeWorktreeMetadata(sessionUri, metadata);
	}

	async recordExternalWorktreeProject(sessionUri: URI, workingDirectory: URI): Promise<IAgentSessionProjectInfo | undefined> {
		const linkedWorktree = await this._resolveLinkedWorktree(workingDirectory);
		if (!linkedWorktree) {
			return undefined;
		}
		const { primaryRoot, baseBranch } = linkedWorktree;
		const dbRef = this._sessionDataService.openDatabase(sessionUri);
		try {
			const work: Promise<void>[] = [
				dbRef.object.setMetadata(WORKTREE_META_REPOSITORY_ROOT, primaryRoot.toString()),
			];
			if (baseBranch) {
				work.push(dbRef.object.setMetadata(META_DIFF_BASE_BRANCH, baseBranch));
			}
			await Promise.all(work);
		} finally {
			dbRef.dispose();
		}
		return projectFromRepositoryRoot(primaryRoot);
	}

	private async _resolveLinkedWorktree(workingDirectory: URI): Promise<{ worktreeRoot: URI; primaryRoot: URI; baseBranch: string | undefined } | undefined> {
		const worktreeRoot = await this._gitService.getRepositoryRoot(workingDirectory).catch(() => undefined);
		if (!worktreeRoot) {
			return undefined;
		}
		const primaryRoot = await tryResolvePrimaryWorktreeRoot(this._gitService, worktreeRoot).catch(() => undefined);
		if (!primaryRoot || isEqual(primaryRoot, worktreeRoot)) {
			return undefined;
		}
		const baseBranch = (await this._gitService.getDefaultBranch(primaryRoot).catch(() => undefined))?.name;
		return { worktreeRoot, primaryRoot, baseBranch };
	}

	async resolveWorktreeProject(sessionUri: URI): Promise<IAgentSessionProjectInfo | undefined> {
		const meta = await this._readWorktreeMetadata(sessionUri).catch(() => undefined);
		return meta?.repositoryRoot ? projectFromRepositoryRoot(meta.repositoryRoot) : undefined;
	}

	private async _resolvePrimaryWorktreeRoot(checkoutRoot: URI, fallbackRoot: URI): Promise<URI> {
		try {
			return await tryResolvePrimaryWorktreeRoot(this._gitService, checkoutRoot) ?? fallbackRoot;
		} catch (error) {
			this._logService.warn(`[${this._logLabel}] Failed to resolve primary worktree for '${checkoutRoot.fsPath}': ${errorMessage(error)}`);
			return fallbackRoot;
		}
	}

	sessionWorktreeProject(sessionId: string): IAgentSessionProjectInfo | undefined {
		const worktree = this._materializedWorktrees.get(sessionId);
		return worktree ? projectFromRepositoryRoot(worktree.repositoryRoot) : undefined;
	}

	private async _getGitInfo(workingDirectory: URI): Promise<{ currentBranch: string; defaultBranch: IDefaultBranch } | undefined> {
		const repositoryRoot = await this._gitService.getRepositoryRoot(workingDirectory);
		if (!repositoryRoot) {
			return undefined;
		}

		const headCommit = await this._gitService.revParse(repositoryRoot, 'HEAD').catch(() => undefined);
		if (!headCommit) {
			return undefined;
		}

		const currentBranch = await this._gitService.getCurrentBranch(repositoryRoot) ?? 'HEAD';
		const defaultBranch = await this._gitService.getDefaultBranch(repositoryRoot) ?? { name: currentBranch, startPoint: currentBranch };
		return { currentBranch, defaultBranch };
	}

	private async _resolveBranchStartPoint(repositoryRoot: URI, selectedBranch: string): Promise<string> {
		const defaultBranch = await this._gitService.getDefaultBranch(repositoryRoot);
		return defaultBranch?.name === selectedBranch
			? defaultBranch.startPoint
			: selectedBranch;
	}

	private async _writeWorktreeMetadata(sessionUri: URI, metadata: { branchName: string; baseBranch: string | undefined; worktreePath: URI; repositoryRoot: URI }): Promise<void> {
		const dbRef = this._sessionDataService.openDatabase(sessionUri);
		try {
			const work: Promise<void>[] = [
				dbRef.object.setMetadata(WORKTREE_META_BRANCH, metadata.branchName),
				dbRef.object.setMetadata(WORKTREE_META_PATH, metadata.worktreePath.toString()),
				dbRef.object.setMetadata(WORKTREE_META_REPOSITORY_ROOT, metadata.repositoryRoot.toString()),
			];
			if (metadata.baseBranch) {
				work.push(dbRef.object.setMetadata(META_DIFF_BASE_BRANCH, metadata.baseBranch));
			}
			await Promise.all(work);
		} finally {
			dbRef.dispose();
		}
	}

	private async _readWorktreeMetadata(sessionUri: URI): Promise<IWorktreeMetadata | undefined> {
		const ref = await this._sessionDataService.tryOpenDatabase(sessionUri);
		if (!ref) {
			return undefined;
		}

		try {
			const [branchName, worktreePathRaw, repositoryRootRaw, legacyWorkingDirectoryRaw] = await Promise.all([
				ref.object.getMetadata(WORKTREE_META_BRANCH),
				ref.object.getMetadata(WORKTREE_META_PATH),
				ref.object.getMetadata(WORKTREE_META_REPOSITORY_ROOT),
				ref.object.getMetadata(LEGACY_WORKTREE_META_WORKING_DIRECTORY),
			]);
			if (!branchName) {
				return undefined;
			}
			const worktreePath = worktreePathRaw
				? URI.parse(worktreePathRaw)
				: legacyWorkingDirectoryRaw
					? URI.parse(legacyWorkingDirectoryRaw)
					: undefined;
			let repositoryRoot = repositoryRootRaw
				? URI.parse(repositoryRootRaw)
				: worktreePath
					? deriveRepositoryRootFromWorktree(worktreePath)
					: undefined;
			if (repositoryRoot) {
				const checkoutRoot = worktreePath && await fileExists(worktreePath.fsPath) ? worktreePath : repositoryRoot;
				const primaryRoot = await this._resolvePrimaryWorktreeRoot(checkoutRoot, repositoryRoot);
				if (primaryRoot.toString() !== repositoryRoot.toString()) {
					repositoryRoot = primaryRoot;
					try {
						await ref.object.setMetadata(WORKTREE_META_REPOSITORY_ROOT, primaryRoot.toString());
					} catch (error) {
						this._logService.warn(`[${this._logLabel}] Failed to normalize worktree repository metadata for '${sessionUri.toString()}': ${errorMessage(error)}`);
					}
				}
			}
			return { branchName, worktreePath, repositoryRoot };
		} finally {
			ref.dispose();
		}
	}

	private async _readWorktreeNotice(sessionUri: URI): Promise<{ kind: 'success'; branchName: string } | { kind: 'failure'; diagnostic?: string } | undefined> {
		const ref = await this._sessionDataService.tryOpenDatabase(sessionUri);
		if (!ref) {
			return undefined;
		}
		try {
			const [branchName, failureRaw] = await Promise.all([
				ref.object.getMetadata(WORKTREE_META_BRANCH),
				ref.object.getMetadata(WORKTREE_META_CREATION_FAILURE),
			]);
			if (branchName) {
				return { kind: 'success', branchName };
			}
			if (!failureRaw) {
				return undefined;
			}
			const failure = JSON.parse(failureRaw);
			if (!failure || typeof failure !== 'object' || Array.isArray(failure)) {
				return undefined;
			}
			const raw = failure as Record<string, unknown>;
			if (raw['sessionId'] !== AgentSession.id(sessionUri)) {
				return undefined;
			}
			return {
				kind: 'failure',
				diagnostic: typeof raw['diagnostic'] === 'string' ? normalizeWorktreeFailureDiagnostic(raw['diagnostic']) : undefined,
			};
		} finally {
			ref.dispose();
		}
	}

	private async _isSessionArchived(sessionUri: URI): Promise<boolean> {
		const ref = await this._sessionDataService.tryOpenDatabase(sessionUri);
		if (!ref) {
			return false;
		}
		try {
			const [isArchived, isDone] = await Promise.all([
				ref.object.getMetadata(AH_META_IS_ARCHIVED_DB_KEY),
				ref.object.getMetadata(AH_META_IS_DONE_DB_KEY),
			]);
			return isArchived !== undefined ? isArchived === 'true' : isDone === 'true';
		} finally {
			ref.dispose();
		}
	}
}

export class NullAgentHostWorktreeIsolation implements IAgentHostWorktreeIsolation {
	declare readonly _serviceBrand: undefined;
	readonly supported: boolean = false;
	readonly onDidChangeWorkingDirectoryPending = Event.None;

	isWorkingDirectoryPending(_sessionId: string): boolean { return false; }
	notePending(_sessionId: string): void { }
	clearPending(_sessionId: string): void { }
	getResolvedWorktree(_sessionId: string): URI | undefined { return undefined; }
	async resolveOnFirstSend(_request: IResolveWorkingDirectoryRequest): Promise<URI | undefined> { return undefined; }
	async createDetachedWorktree(_request: Omit<IResolveWorkingDirectoryRequest, 'sessionUri' | 'sessionId'>): Promise<{ handle: string; worktree: URI }> { throw new Error('Worktree isolation is not supported.'); }
	async claimDetachedWorktree(_handle: string): Promise<void> { }
	async setDetachedWorktreeArchived(_handle: string, _archived: boolean): Promise<void> { }
	async deleteDetachedWorktree(_handle: string): Promise<void> { }
	async reconcileDetachedWorktrees(_scope: string, _activeHandles: readonly string[]): Promise<void> { }
	async resolveIsolationConfig(_request: IResolveIsolationConfigRequest): Promise<IIsolationConfigContribution | undefined> { return undefined; }
	async branchCompletions(_workingDirectory: URI | undefined, _query?: string): Promise<{ items: { value: string; label: string }[] }> { return { items: [] }; }
	async resolveWorkingDirectoryForResume(_sessionUri: URI, _sessionId: string, workingDirectory: URI): Promise<URI> { return workingDirectory; }
	takePendingAnnouncement(_sessionId: string): string | undefined { return undefined; }
	async persistCreationFailure(_sessionUri: URI, _sessionId: string, _diagnostic: string | undefined): Promise<void> { }
	async applyRestoreAnnouncement(_sessionUri: URI, turns: readonly Turn[]): Promise<readonly Turn[]> { return turns; }
	async prepareSessionDeletion(_sessionUri: URI, _sessionId: string): Promise<ISessionWorktree | undefined> { return undefined; }
	async removeSessionWorktree(_sessionId: string, _worktree: ISessionWorktree | undefined): Promise<void> { }
	async discardSessionWorktree(_sessionUri: URI, _sessionId: string, _worktree: ISessionWorktree | undefined): Promise<void> { }
	async cleanupWorktreeOnArchive(_sessionUri: URI, _sessionId: string): Promise<void> { }
	async recreateWorktreeOnUnarchive(_sessionUri: URI, _sessionId: string): Promise<void> { }
	async readWorktreeMetadata(_sessionUri: URI): Promise<IWorktreeMetadata | undefined> { return undefined; }
	async adoptExistingWorktreeMetadata(_sessionUri: URI, _workingDirectory: URI): Promise<boolean> { return false; }
	async recordAdoptedWorktreeMetadata(_sessionUri: URI, _metadata: { readonly branchName: string; readonly baseBranch: string | undefined; readonly worktreePath: URI; readonly repositoryRoot: URI }): Promise<void> { }
	async recordExternalWorktreeProject(_sessionUri: URI, _workingDirectory: URI): Promise<IAgentSessionProjectInfo | undefined> { return undefined; }
	async resolveWorktreeProject(_sessionUri: URI): Promise<IAgentSessionProjectInfo | undefined> { return undefined; }
	sessionWorktreeProject(_sessionId: string): IAgentSessionProjectInfo | undefined { return undefined; }
}

function projectFromRepositoryRoot(repositoryRoot: URI): IAgentSessionProjectInfo {
	return { uri: repositoryRoot, displayName: basename(repositoryRoot.fsPath) || repositoryRoot.toString() };
}

function deriveRepositoryRootFromWorktree(worktree: URI): URI | undefined {
	if (worktree.scheme !== Schemas.file) {
		return undefined;
	}
	const worktreesRoot = URI.joinPath(worktree, '..');
	const worktreesRootName = basename(worktreesRoot.fsPath);
	const suffix = '.worktrees';
	if (!worktreesRootName.endsWith(suffix)) {
		return undefined;
	}
	const repositoryName = worktreesRootName.slice(0, -suffix.length);
	return repositoryName ? URI.joinPath(worktreesRoot, '..', repositoryName) : undefined;
}

export function worktreeProjectFromRepositoryRoot(repositoryRootRaw: string | undefined): IAgentSessionProjectInfo | undefined {
	return repositoryRootRaw ? projectFromRepositoryRoot(URI.parse(repositoryRootRaw)) : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}
