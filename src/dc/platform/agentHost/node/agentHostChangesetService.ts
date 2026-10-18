/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout, Limiter, SequencerByKey } from '../../../base/common/async.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../log/common/log.js';
import {
	buildBranchChangesetUri,
	buildCompareTurnsChangesetUri,
	buildSessionChangesetUri,
	buildTurnChangesetUri,
	buildUncommittedChangesetUri,
	parseChangesetUri,
	ChangesetKind,
	buildDefaultChangesetCatalog,
} from '../common/changesetUri.js';
import { IDiffComputeService } from '../common/diffComputeService.js';
import { ISessionDatabase, ISessionDataService } from '../common/sessionDataService.js';
import type { ChangesetState, ChangesSummary } from '../common/state/protocol/state.js';
import { addMillisecondsToTimestamp } from '../common/state/protocol/common/timestamps.js';
import { ActionType } from '../common/state/sessionActions.js';
import {
	ChangesetStatus,
	type ChangesetFile,
	type ISessionFileDiff,
	type URI as ProtocolURI,
	readSessionGitState,
	isDefaultChatUri,
	isHostNoticeTurn,
	lastAttributableTurnId,
	SessionLifecycle,
} from '../common/state/sessionState.js';
import { AgentHostStateManager, IAgentHostStateManager } from './agentHostStateManager.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';
import { IAgentHostGitService, META_DIFF_BASE_BRANCH, resolveDiffBaseBranchName } from '../common/agentHostGitService.js';
import { IAgentHostCheckpointService } from '../common/agentHostCheckpointService.js';
import { NodeWorkerDiffComputeService } from './diffComputeService.js';
import { computeSessionDiffs, computeTurnDiffs, computeUnionedDiffs, type IIncrementalDiffOptions, type ISessionDiffSource } from './sessionDiffAggregator.js';
import { IAgentHostChangesetService, IPersistedChangesetMetadata, IRestoredChangesetDiffs, CHANGESET_DB_METADATA_KEYS, CHANGES_SUMMARY_METADATA_KEYS, META_CHANGES_SUMMARY, META_CHANGESET_BRANCH, META_CHANGESET_SESSION, META_LEGACY_DIFFS, StaticChangesetKind } from '../common/agentHostChangesetService.js';
import { IAgentHostChangesetSubscriptionService } from '../common/agentHostChangesetSubscriptionService.js';
import { IAgentHostChangesetOperationService } from '../common/agentHostChangesetOperationService.js';
import { IAgentHostReviewService } from '../common/agentHostReviewService.js';
import { extUriBiasedIgnorePathCase, relativePath } from '../../../base/common/resources.js';
import { isMultiRootSession } from '../common/agentHostWorkingDirectories.js';
import { resolveSessionRepositories } from './agentHostSessionRepositories.js';
import { dedupeSessionFileDiffs, evaluateMultiRootDiffSources } from './agentHostMultiRootDiff.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { reportAgentHostStaticChangesetComputed, reportAgentHostTurnChangesetComputed, type IMultiRootTurnDiffMetrics, type StaticChangesetOutcome, type TurnChangesetOutcome } from './agentHostChangesetTelemetry.js';
import type { IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { AgentSession } from '../common/agent.js';
import { IAgentHostWorktreeIsolation, type IAgentHostWorktreePendingState } from './shared/worktreeIsolation.js';

const MAX_TURN_DIFF_REPOSITORY_CONCURRENCY = 5;

function staticChangesetUri(session: ProtocolURI, kind: StaticChangesetKind): ProtocolURI {
	return kind === 'branch'
		? buildBranchChangesetUri(session)
		: buildSessionChangesetUri(session);
}

function persistKeyFor(kind: StaticChangesetKind): string {
	return kind === 'branch'
		? META_CHANGESET_BRANCH
		: META_CHANGESET_SESSION;
}

interface ITurnDiffResult {
	readonly diffs: readonly ISessionFileDiff[];
	readonly outcome: 'computed' | 'resolveFailed';
	readonly multiRoot?: IMultiRootTurnDiffMetrics;
}

function summariseDiffs(diffs: readonly ISessionFileDiff[] | undefined): ChangesSummary | undefined {
	if (!diffs) {
		return undefined;
	}
	let additions = 0;
	let deletions = 0;
	for (const d of diffs) {
		additions += d.diff?.added ?? 0;
		deletions += d.diff?.removed ?? 0;
	}
	return { additions, deletions, files: diffs.length };
}

function computeChangesSummaryFromLiveState(
	session: ChangesetState | undefined,
): ChangesSummary | undefined {
	const sessionDiffs = session?.status === ChangesetStatus.Ready ? session.files.map(f => f.edit) : undefined;
	return summariseDiffs(sessionDiffs);
}

function computeChangesSummaryFromPersistedDiffs(
	sessionDiffs: readonly ISessionFileDiff[] | undefined,
): ChangesSummary | undefined {
	return summariseDiffs(sessionDiffs);
}

function tryParsePersistedDiffs(raw: string | undefined, sessionUri: string, kind: string, log: ILogService): ISessionFileDiff[] | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		return JSON.parse(raw) as ISessionFileDiff[];
	} catch (err) {
		log.warn(`[AgentHostChangesetService] Failed to parse persisted ${kind} diffs for ${sessionUri}: ${toErrorMessage(err)}`);
		return undefined;
	}
}

export class AgentHostChangesetService extends Disposable implements IAgentHostChangesetService {
	declare readonly _serviceBrand: undefined;

	private readonly _diffComputeService: IDiffComputeService;
	private readonly _diffComputationSequencer = new SequencerByKey<string>();
	private readonly _debouncedDiffTimers = this._register(new DisposableMap<string>());
	private readonly _perTurnDebouncedDiffTimers = this._register(new DisposableMap<string>());
	private readonly _activeStaticComputes = new Set<ProtocolURI>();
	private static readonly _DIFF_DEBOUNCE_MS = 5000;

	private readonly _worktree: IAgentHostWorktreePendingState;

	constructor(
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@ILogService private readonly _logService: ILogService,
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@IAgentHostGitService private readonly _gitService: IAgentHostGitService,
		@IAgentHostCheckpointService private readonly _checkpointService: IAgentHostCheckpointService,
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
		@IAgentHostChangesetOperationService private readonly _changesetOperationService: IAgentHostChangesetOperationService,
		@IAgentHostChangesetSubscriptionService private readonly _changesetSubscriptions: IAgentHostChangesetSubscriptionService,
		@IAgentHostReviewService private readonly _reviewService: IAgentHostReviewService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IAgentHostWorktreeIsolation worktree: IAgentHostWorktreeIsolation,
	) {
		super();
		this._worktree = worktree;
		this._diffComputeService = this._createDiffComputeService();
	}

	protected _createDiffComputeService(): IDiffComputeService {
		return this._register(new NodeWorkerDiffComputeService(this._logService));
	}

	private _hasSubscription(session: ProtocolURI, changeset: ProtocolURI): boolean {
		return this._changesetSubscriptions.getSessionSubscriptions(session).has(changeset);
	}

	private _hasWorkingDirectory(session: ProtocolURI): boolean {
		return !this._worktree.isWorkingDirectoryPending(AgentSession.id(session))
			&& !!this._configurationService.getEffectiveWorkingDirectories(session)?.[0];
	}

	registerStaticChangesets(session: ProtocolURI): void {
		this._stateManager.registerChangeset(buildBranchChangesetUri(session));
		this._stateManager.registerChangeset(buildUncommittedChangesetUri(session));
		this._stateManager.registerChangeset(buildSessionChangesetUri(session));
	}

	restoreStaticChangeset(session: ProtocolURI, kind: StaticChangesetKind, diffs: readonly ISessionFileDiff[]): void {
		const changesetUri = this._stateManager.registerChangeset(staticChangesetUri(session, kind));
		this._publishChangesetDiffs(session, changesetUri, diffs);
	}

	parsePersistedStaticChangesets(sessionUri: ProtocolURI, metadata: IPersistedChangesetMetadata): IRestoredChangesetDiffs {
		const persistedBranch = tryParsePersistedDiffs(metadata.branchRaw, sessionUri, 'branch', this._logService);

		const persistedSession = tryParsePersistedDiffs(metadata.sessionRaw, sessionUri, 'session', this._logService)
			?? tryParsePersistedDiffs(metadata.legacyRaw, sessionUri, 'session (legacy)', this._logService);

		return { branch: persistedBranch, session: persistedSession };
	}

	applyPersistedStaticChangesets(sessionUri: ProtocolURI, diffs: IRestoredChangesetDiffs): void {
		this._seedIfEmpty(sessionUri, 'branch', diffs.branch);
		this._seedIfEmpty(sessionUri, 'session', diffs.session);
	}

	restorePersistedStaticChangesets(sessionUri: ProtocolURI, metadata: IPersistedChangesetMetadata): IRestoredChangesetDiffs {
		const parsed = this.parsePersistedStaticChangesets(sessionUri, metadata);
		this.applyPersistedStaticChangesets(sessionUri, parsed);
		return parsed;
	}

	persistChangesSummary(sessionUri: ProtocolURI, summary: ChangesSummary): void {
		this._persistSessionFlag(sessionUri, META_CHANGES_SUMMARY, JSON.stringify(summary));
	}

	getListMetadataKeys(sessionUri: ProtocolURI): Record<string, true> | undefined {
		const liveSummaryChanges = this._stateManager.getSessionSummary(sessionUri)?.changes;
		if (liveSummaryChanges) {
			return undefined;
		}
		const liveSession = this._stateManager.getChangesetState(buildSessionChangesetUri(sessionUri));
		if (liveSession?.status === ChangesetStatus.Ready) {
			return CHANGES_SUMMARY_METADATA_KEYS;
		}
		return CHANGESET_DB_METADATA_KEYS;
	}

	computeListEntryChanges(sessionUri: ProtocolURI, metadata: Record<string, string | undefined>): ChangesSummary | undefined {
		if (this._stateManager.getSessionState(sessionUri)) {
			return undefined;
		}

		const changesSummary = metadata[META_CHANGES_SUMMARY];
		if (changesSummary !== undefined) {
			try {
				return JSON.parse(changesSummary) as ChangesSummary;
			} catch (error) {
				return undefined;
			}
		}

		const liveSession = this._stateManager.getChangesetState(buildBranchChangesetUri(sessionUri));
		const liveChanges = computeChangesSummaryFromLiveState(liveSession);
		if (liveChanges) {
			this.persistChangesSummary(sessionUri, liveChanges);
			return liveChanges;
		}

		const branchRaw = metadata[META_CHANGESET_BRANCH];
		const legacyRaw = metadata[META_LEGACY_DIFFS];
		if (branchRaw === undefined && legacyRaw === undefined) {
			return undefined;
		}
		const restored = this.parsePersistedStaticChangesets(sessionUri, { branchRaw, legacyRaw });

		const persistedChanges = computeChangesSummaryFromPersistedDiffs(restored.branch);
		if (persistedChanges) {
			this.persistChangesSummary(sessionUri, persistedChanges);
			return persistedChanges;
		}

		return undefined;
	}

	isStaticChangesetComputeActive(changesetUri: ProtocolURI): boolean {
		return this._activeStaticComputes.has(changesetUri);
	}

	private _seedIfEmpty(session: ProtocolURI, kind: StaticChangesetKind, diffs: readonly ISessionFileDiff[] | undefined): void {
		if (!diffs) {
			return;
		}
		const existing = this._stateManager.getChangesetState(staticChangesetUri(session, kind));
		if (existing && existing.files.length > 0) {
			return;
		}
		this.restoreStaticChangeset(session, kind, diffs);
	}

	refreshChangesetCatalog(session: ProtocolURI): void {
		const state = this._stateManager.getSessionState(session);
		if (!state || state?.lifecycle === SessionLifecycle.Failed) {
			return;
		}

		const changesets = buildDefaultChangesetCatalog(session, state);
		this._stateManager.setSessionChangesets(session, changesets);
	}

	refreshBranchChangeset(session: ProtocolURI): void {
		if (!this._hasWorkingDirectory(session)) {
			return;
		}
		this._scheduleStaticRecompute(session, 'branch', undefined, this._markStaticChangesetComputing(session, 'branch'));
	}

	refreshSessionChangeset(session: ProtocolURI): void {
		if (!this._hasWorkingDirectory(session)) {
			return;
		}
		this._scheduleStaticRecompute(session, 'session', undefined, this._markStaticChangesetComputing(session, 'session'));
	}

	onWorkingDirectoryAvailable(session: ProtocolURI): void {
		this.recomputeSubscribedChangesets(session);
	}

	recomputeSubscribedChangesets(session: ProtocolURI): void {
		const subscriptions = this._changesetSubscriptions.getSessionSubscriptions(session);
		if (subscriptions.size === 0) {
			return;
		}
		for (const changeset of subscriptions) {
			const parsed = parseChangesetUri(changeset);
			switch (parsed?.kind) {
				case ChangesetKind.Branch:
					this.refreshBranchChangeset(session);
					break;
				case ChangesetKind.Session:
					this.refreshSessionChangeset(session);
					break;
				case ChangesetKind.Uncommitted:
					void this.computeUncommittedChangeset(session);
					break;
				case ChangesetKind.Turn:
					if (parsed.turnId !== undefined) {
						void this.computeTurnChangeset(session, parsed.turnId);
					}
					break;
				default:
					if (changeset === session) {
						this.refreshBranchChangeset(session);
						this.refreshSessionChangeset(session);
					}
					break;
			}
		}
	}

	computeTurnChangeset(session: ProtocolURI, turnId: string): Promise<ProtocolURI> {
		return this._computeTurnChangeset(session, turnId, false);
	}

	private async _computeTurnChangeset(session: ProtocolURI, turnId: string, reportTelemetry: boolean, clientContext?: IAgentHostClientTelemetryContext): Promise<ProtocolURI> {
		const turnUri = this._stateManager.registerChangeset(buildTurnChangesetUri(session, turnId));
		if (this._stateManager.getChangesetState(turnUri)?.status !== ChangesetStatus.Computing) {
			this._stateManager.dispatchServerAction(turnUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Computing,
			});
		}
		const stopWatch = StopWatch.create();
		let outcome: TurnChangesetOutcome = 'error';
		let result: ITurnDiffResult | undefined;
		let fileCount: number | undefined;
		try {
			let ref: ReturnType<ISessionDataService['openDatabase']>;
			try {
				ref = this._sessionDataService.openDatabase(URI.parse(session));
			} catch (err) {
				this._logService.warn(`[AgentHostChangesetService] Failed to open session database for turn diff: ${session}`, err);
				this._stateManager.dispatchServerAction(turnUri, {
					type: ActionType.ChangesetStatusChanged,
					status: ChangesetStatus.Error,
					error: { errorType: 'computeFailed', message: err instanceof Error ? err.message : String(err) },
				});
				outcome = 'dbOpenFailed';
				return turnUri;
			}
			try {
				result = await this._computeTurnDiffsPreferCheckpoint(session, ref.object, turnId);
				outcome = result.outcome;
				fileCount = result.diffs.length;
				this._publishChangesetDiffs(session, turnUri, result.diffs);
			} catch (err) {
				this._logService.warn(`[AgentHostChangesetService] Failed to compute turn diffs for ${session}/${turnId}`, err);
				this._stateManager.dispatchServerAction(turnUri, {
					type: ActionType.ChangesetStatusChanged,
					status: ChangesetStatus.Error,
					error: { errorType: 'computeFailed', message: err instanceof Error ? err.message : String(err) },
				});
				outcome = 'error';
			} finally {
				ref.dispose();
			}
			return turnUri;
		} finally {
			if (reportTelemetry) {
				const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
				reportAgentHostTurnChangesetComputed(this._telemetryService, session, turnId, {
					outcome,
					durationMs: stopWatch.elapsed(),
					isMultiRoot: isMultiRootSession(workingDirectories),
					folderCount: workingDirectories?.length ?? 0,
					...(outcome === 'computed' && fileCount !== undefined ? { fileCount } : {}),
					multiRoot: result?.multiRoot,
				}, clientContext);
			}
		}
	}

	async computeCompareTurnsChangeset(session: ProtocolURI, originalTurnId: string, modifiedTurnId: string): Promise<ProtocolURI> {
		const compareUri = this._stateManager.registerChangeset(buildCompareTurnsChangesetUri(session, originalTurnId, modifiedTurnId));
		let ref: ReturnType<ISessionDataService['openDatabase']>;
		try {
			ref = this._sessionDataService.openDatabase(URI.parse(session));
		} catch (err) {
			this._logService.warn(`[AgentHostChangesetService] Failed to open session database for compare-turns diff: ${session}`, err);
			this._stateManager.dispatchServerAction(compareUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Error,
				error: { errorType: 'computeFailed', message: err instanceof Error ? err.message : String(err) },
			});
			return compareUri;
		}
		try {
			const sessionUri = URI.parse(session);
			const [originalCurrentRef, modifiedPair] = await Promise.all([
				this._checkpointService.getTurnCheckpointPair(sessionUri, originalTurnId).then(p => p?.current),
				this._checkpointService.getTurnCheckpointPair(sessionUri, modifiedTurnId),
			]);
			if (!originalCurrentRef || !modifiedPair) {
				const missing = !originalCurrentRef && !modifiedPair
					? 'both turns'
					: !originalCurrentRef
						? 'original turn'
						: 'modified turn';
				this._stateManager.dispatchServerAction(compareUri, {
					type: ActionType.ChangesetStatusChanged,
					status: ChangesetStatus.Error,
					error: { errorType: 'computeFailed', message: `No checkpoint available for ${missing}; compare requires git-backed sessions.` },
				});
				return compareUri;
			}
			if (originalCurrentRef === modifiedPair.current) {
				this._publishChangesetDiffs(session, compareUri, []);
				return compareUri;
			}
			const workingDir = await this._resolveWorkingDirectory(session);
			if (!workingDir) {
				this._stateManager.dispatchServerAction(compareUri, {
					type: ActionType.ChangesetStatusChanged,
					status: ChangesetStatus.Error,
					error: { errorType: 'computeFailed', message: 'No working directory recorded for session; compare requires git-backed sessions.' },
				});
				return compareUri;
			}
			const diffs = await this._gitService.computeFileDiffsBetweenRefs(workingDir, {
				sessionUri: session,
				fromRef: originalCurrentRef,
				toRef: modifiedPair.current,
			});
			if (diffs === undefined) {
				this._stateManager.dispatchServerAction(compareUri, {
					type: ActionType.ChangesetStatusChanged,
					status: ChangesetStatus.Error,
					error: { errorType: 'computeFailed', message: `Failed to compute compare-turns diff from git (${originalCurrentRef}..${modifiedPair.current}).` },
				});
				return compareUri;
			}
			this._publishChangesetDiffs(session, compareUri, diffs);
		} catch (err) {
			this._logService.warn(`[AgentHostChangesetService] Failed to compute compare-turns diffs for ${session}/${originalTurnId}/${modifiedTurnId}`, err);
			this._stateManager.dispatchServerAction(compareUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Error,
				error: { errorType: 'computeFailed', message: err instanceof Error ? err.message : String(err) },
			});
		} finally {
			ref.dispose();
		}
		return compareUri;
	}

	computeUncommittedChangeset(session: ProtocolURI): Promise<ProtocolURI> {
		return this._queueUncommittedChangeset(session, undefined, false);
	}

	private async _computeUncommittedChangeset(session: ProtocolURI, turnId: string | undefined, reportTelemetry: boolean, clientContext?: IAgentHostClientTelemetryContext): Promise<ProtocolURI> {
		const uncommittedUri = this._stateManager.registerChangeset(buildUncommittedChangesetUri(session));
		if (!this._hasSubscription(session, uncommittedUri)) {
			return uncommittedUri;
		}

		const workingDirectory = this._stateManager.getSessionState(session)?.workingDirectories?.[0];
		if (!workingDirectory) {
			return uncommittedUri;
		}

		const statusBeforeCompute = this._stateManager.getChangesetState(uncommittedUri)?.status;
		if (statusBeforeCompute !== ChangesetStatus.Computing) {
			this._stateManager.dispatchServerAction(uncommittedUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Computing,
			});
		}

		const stopWatch = StopWatch.create();
		const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
		let outcome: StaticChangesetOutcome = 'error';
		let fileCount: number | undefined;
		try {
			const diffs = await this._computeUncommittedDiffs(session);
			if (diffs === undefined) {
				this._stateManager.dispatchServerAction(uncommittedUri, {
					type: ActionType.ChangesetStatusChanged,
					status: ChangesetStatus.Error,
					error: { errorType: 'computeFailed', message: 'Failed to compute uncommitted diff from git.' },
				});
				outcome = 'gitUnavailable';
				return uncommittedUri;
			}

			this._publishChangesetDiffs(session, uncommittedUri, diffs);
			fileCount = diffs.length;
			outcome = 'computed';
		} catch (err) {
			this._logService.warn(`[AgentHostChangesetService] Failed to compute uncommitted diffs for ${session}`, err);
			this._stateManager.dispatchServerAction(uncommittedUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Error,
				error: { errorType: 'computeFailed', message: err instanceof Error ? err.message : String(err) },
			});
			outcome = 'error';
		} finally {
			if (reportTelemetry) {
				reportAgentHostStaticChangesetComputed(this._telemetryService, session, turnId, {
					kind: 'uncommitted',
					outcome,
					durationMs: stopWatch.elapsed(),
					isMultiRoot: isMultiRootSession(workingDirectories),
					folderCount: workingDirectories?.length ?? 0,
					...(outcome === 'computed' && fileCount !== undefined ? { fileCount } : {}),
				}, clientContext);
			}
		}

		return uncommittedUri;
	}

	private async _computeUncommittedDiffs(session: ProtocolURI): Promise<readonly ISessionFileDiff[] | undefined> {
		const workingDirectory = this._stateManager.getSessionState(session)?.workingDirectories?.[0];
		if (!workingDirectory) {
			return undefined;
		}

		let workingDirectoryUri: URI;
		try {
			workingDirectoryUri = URI.parse(workingDirectory);
		} catch {
			return undefined;
		}

		return this._gitService.computeSessionFileDiffs(workingDirectoryUri, {
			sessionUri: session,
		});
	}

	private async _computeTurnDiffsPreferCheckpoint(session: ProtocolURI, db: ISessionDatabase, turnId: string): Promise<ITurnDiffResult> {
		const trackedSource = this._openTrackedTurnSource(session, db, turnId);
		try {
			if (!trackedSource.sessionUri) {
				return { diffs: [], outcome: 'computed' };
			}
			const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
			if (isMultiRootSession(workingDirectories)) {
				return await this._computeMultiFolderTurnDiffs(session, trackedSource.sessionUri, trackedSource.db, turnId, workingDirectories!);
			}
			const diffs = await this._computeSingleFolderTurnDiffs(session, trackedSource.sessionUri, trackedSource.db, turnId);
			return { diffs, outcome: 'computed' };
		} finally {
			trackedSource.dispose();
		}
	}

	private async _computeSingleFolderTurnDiffs(session: ProtocolURI, trackedSession: ProtocolURI, db: ISessionDatabase, turnId: string): Promise<readonly ISessionFileDiff[]> {
		const pair = await this._checkpointService.getTurnCheckpointPair(URI.parse(session), turnId);
		if (pair && pair.parent !== pair.current) {
			const workingDir = await this._resolveWorkingDirectory(session);
			if (workingDir) {
				const fromRefDiffs = await this._gitService.computeFileDiffsBetweenRefs(workingDir, {
					sessionUri: session,
					fromRef: pair.parent,
					toRef: pair.current,
				});
				if (fromRefDiffs) {
					return fromRefDiffs;
				}
				this._logService.warn(`[AgentHostChangesetService] Turn ${session}/${turnId}: git diff ${pair.parent}..${pair.current} produced no result; falling back to tracked file edits, which cannot see terminal-tool edits`);
			} else {
				this._logService.warn(`[AgentHostChangesetService] Turn ${session}/${turnId}: no working directory resolved; falling back to tracked file edits, which cannot see terminal-tool edits`);
			}
		} else if (pair) {
			this._logService.debug(`[AgentHostChangesetService] Turn ${session}/${turnId}: end-of-turn tree matches the turn-start tree (${pair.current}); reporting no changes`);
			return [];
		} else {
			this._logService.debug(`[AgentHostChangesetService] Turn ${session}/${turnId}: no checkpoint pair; falling back to tracked file edits, which cannot see terminal-tool edits`);
		}
		return computeTurnDiffs(trackedSession, db, this._diffComputeService, turnId);
	}

	private _openTrackedTurnSource(session: ProtocolURI, defaultDatabase: ISessionDatabase, turnId: string): { readonly sessionUri: ProtocolURI | undefined; readonly db: ISessionDatabase; dispose(): void } {
		const sessionState = this._stateManager.getSessionState(session);
		if (!sessionState) {
			return { sessionUri: session, db: defaultDatabase, dispose: () => { } };
		}

		const owningResources: ProtocolURI[] = [];
		if (sessionState.activeTurn?.id === turnId || (sessionState.turns ?? []).some(turn => turn.id === turnId)) {
			owningResources.push(session);
		}
		for (const chat of sessionState.chats ?? []) {
			if (isDefaultChatUri(chat.resource)) {
				continue;
			}
			const chatState = this._stateManager.getChatState(chat.resource);
			if (chatState?.activeTurn?.id === turnId || chatState?.turns.some(turn => turn.id === turnId)) {
				owningResources.push(chat.resource);
			}
		}

		if (owningResources.length > 1) {
			this._logService.warn(`[AgentHostChangesetService] Turn id ${turnId} is shared by multiple chats in ${session}; skipping ambiguous tracked-file fallback`);
			return { sessionUri: undefined, db: defaultDatabase, dispose: () => { } };
		}
		if (owningResources.length === 0 || owningResources[0] === session) {
			return { sessionUri: session, db: defaultDatabase, dispose: () => { } };
		}

		const chat = owningResources[0];
		const chatDatabase = this._sessionDataService.openDatabase(URI.parse(chat));
		return { sessionUri: chat, db: chatDatabase.object, dispose: () => chatDatabase.dispose() };
	}

	private async _computeMultiFolderTurnDiffs(session: ProtocolURI, trackedSession: ProtocolURI, db: ISessionDatabase, turnId: string, workingDirectories: readonly string[]): Promise<ITurnDiffResult> {
		const sessionUri = URI.parse(session);
		const workingDirectoryUris = this._parseWorkingDirectoryUris(session, workingDirectories);

		let gitRepositories: readonly URI[];
		let nonGitDirectories: readonly URI[];
		try {
			({ gitRepositories, nonGitDirectories } = await resolveSessionRepositories(workingDirectoryUris, this._gitService, (directory, err) => {
				this._logService.error(`[AgentHostChangesetService] Failed to resolve repository root for ${directory.toString()} in multi-folder turn ${session}/${turnId}; treating it as a non-git folder.`, err);
			}));
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Failed to resolve repositories for multi-folder turn ${session}/${turnId}`, err);
			return { diffs: [], outcome: 'resolveFailed' };
		}

		const limiter = new Limiter<{ readonly diffs: readonly ISessionFileDiff[]; readonly usedFallback: boolean }>(MAX_TURN_DIFF_REPOSITORY_CONCURRENCY);
		const [perRepoDiffs, nonGitDiffs] = await Promise.all([
			Promise.all(gitRepositories.map(repoRoot => limiter.queue(() => this._computeRepoTurnDiffs(session, trackedSession, sessionUri, db, turnId, repoRoot)))),
			this._computeNonGitTurnDiffsFromTrackedEdits(session, trackedSession, db, turnId, nonGitDirectories),
		]).finally(() => limiter.dispose());

		const diffs = dedupeSessionFileDiffs([...perRepoDiffs.map(r => r.diffs), nonGitDiffs]);
		return {
			diffs,
			outcome: 'computed',
			multiRoot: {
				uniqueGitFolderCount: gitRepositories.length,
				nonGitFolderCount: nonGitDirectories.length,
				trackedEditFallbackFolderCount: perRepoDiffs.filter(r => r.usedFallback).length,
			},
		};
	}

	private async _computeRepoTurnDiffs(session: ProtocolURI, trackedSession: ProtocolURI, sessionUri: URI, db: ISessionDatabase, turnId: string, repoRoot: URI): Promise<{ readonly diffs: readonly ISessionFileDiff[]; readonly usedFallback: boolean }> {
		try {
			const pair = await this._checkpointService.getTurnCheckpointPair(sessionUri, turnId, repoRoot);
			if (!pair) {
				this._logService.trace(`[AgentHostChangesetService] No checkpoint pair for multi-folder turn ${session}/${turnId} in repository ${repoRoot.toString()}; falling back to tracked edits for that repository.`);
				return { diffs: await this._computeRepoTurnDiffsFromTrackedEdits(session, trackedSession, db, turnId, repoRoot), usedFallback: true };
			}
			if (pair.parent === pair.current) {
				return { diffs: [], usedFallback: false };
			}
			const diffs = await this._gitService.computeFileDiffsBetweenRefs(repoRoot, {
				sessionUri: session,
				fromRef: pair.parent,
				toRef: pair.current,
			});
			if (!diffs) {
				this._logService.error(`[AgentHostChangesetService] Git turn diff unavailable for multi-folder turn ${session}/${turnId} in repository ${repoRoot.toString()}; falling back to tracked edits for that repository.`);
				return { diffs: await this._computeRepoTurnDiffsFromTrackedEdits(session, trackedSession, db, turnId, repoRoot), usedFallback: true };
			}
			return { diffs, usedFallback: false };
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Failed to compute git turn diff for multi-folder turn ${session}/${turnId} in repository ${repoRoot.toString()}; falling back to tracked edits for that repository.`, err);
			return { diffs: await this._computeRepoTurnDiffsFromTrackedEdits(session, trackedSession, db, turnId, repoRoot), usedFallback: true };
		}
	}

	private async _computeRepoTurnDiffsFromTrackedEdits(session: ProtocolURI, trackedSession: ProtocolURI, db: ISessionDatabase, turnId: string, repoRoot: URI): Promise<readonly ISessionFileDiff[]> {
		try {
			return await computeTurnDiffs(trackedSession, db, this._diffComputeService, turnId, [repoRoot]);
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Tracked-edit fallback turn diff failed for multi-folder turn ${session}/${turnId} in repository ${repoRoot.toString()}`, err);
			return [];
		}
	}

	private async _computeNonGitTurnDiffsFromTrackedEdits(session: ProtocolURI, trackedSession: ProtocolURI, db: ISessionDatabase, turnId: string, nonGitDirectories: readonly URI[]): Promise<readonly ISessionFileDiff[]> {
		if (nonGitDirectories.length === 0) {
			return [];
		}
		try {
			return await computeTurnDiffs(trackedSession, db, this._diffComputeService, turnId, nonGitDirectories);
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Failed to compute non-git tracked-edit turn diff for multi-folder turn ${session}/${turnId}`, err);
			return [];
		}
	}

	private _parseWorkingDirectoryUris(session: ProtocolURI, workingDirectories: readonly string[]): URI[] {
		const uris: URI[] = [];
		for (const workingDirectory of workingDirectories) {
			try {
				uris.push(URI.parse(workingDirectory));
			} catch (err) {
				this._logService.warn(`[AgentHostChangesetService] Skipping unparseable working directory '${workingDirectory}' for session ${session}`, err);
			}
		}
		return uris;
	}

	private async _updateMultiFolderChangesSummary(session: ProtocolURI, db: ISessionDatabase, workingDirectories: readonly string[], primaryBranchDiffs?: readonly ISessionFileDiff[]): Promise<void> {
		const workingDirectoryUris = this._parseWorkingDirectoryUris(session, workingDirectories);

		let gitRepositories: readonly URI[];
		let nonGitDirectories: readonly URI[];
		try {
			({ gitRepositories, nonGitDirectories } = await resolveSessionRepositories(workingDirectoryUris, this._gitService));
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Failed to resolve repositories for multi-folder branch summary ${session}`, err);
			return;
		}

		const primaryRepositoryRoot = workingDirectoryUris.length > 0
			? await this._gitService.getRepositoryRoot(workingDirectoryUris[0])
			: undefined;
		const primaryRepositoryKey = primaryRepositoryRoot
			? extUriBiasedIgnorePathCase.getComparisonKey(primaryRepositoryRoot)
			: undefined;
		const sessionBaseBranch = await this._resolveBranchBaseBranch(session, db);

		const limiter = new Limiter<readonly ISessionFileDiff[] | undefined>(MAX_TURN_DIFF_REPOSITORY_CONCURRENCY);
		const [perRepoDiffs, nonGitDiffs] = await Promise.all([
			Promise.all(gitRepositories.map(repoRoot => limiter.queue(async () => {
				try {
					const isPrimary = primaryRepositoryKey !== undefined
						&& extUriBiasedIgnorePathCase.getComparisonKey(repoRoot) === primaryRepositoryKey;
					if (isPrimary && primaryBranchDiffs) {
						return primaryBranchDiffs;
					}
					const baseBranch = isPrimary
						? sessionBaseBranch
						: (await this._gitService.getDefaultBranch(repoRoot))?.name;
					return await this._computeRepoBranchDiffs(session, repoRoot, baseBranch);
				} catch (err) {
					this._logService.error(`[AgentHostChangesetService] Failed to compute branch diff for multi-folder branch summary ${session} in repository ${repoRoot.toString()}`, err);
					return undefined;
				}
			}))),
			this._computeNonGitBranchDiffs(session, db, nonGitDirectories),
		]).finally(() => limiter.dispose());

		const orderedSources: (readonly ISessionFileDiff[] | undefined)[] = [...perRepoDiffs];
		if (nonGitDirectories.length > 0) {
			orderedSources.push(nonGitDiffs);
		}
		const evaluation = evaluateMultiRootDiffSources(orderedSources);
		if (evaluation.outcome !== 'complete') {
			this._logService.warn(`[AgentHostChangesetService] No diff source available for multi-folder branch summary ${session}; preserving the cached summary.`);
			return;
		}

		let additions = 0;
		let deletions = 0;
		let files = 0;
		for (const diffs of evaluation.availableSources) {
			const summary = summariseDiffs(diffs);
			if (summary) {
				additions += summary.additions ?? 0;
				deletions += summary.deletions ?? 0;
				files += summary.files ?? 0;
			}
		}

		const changesSummary: ChangesSummary = { additions, deletions, files };
		this.persistChangesSummary(session, changesSummary);
		this._stateManager.setSessionSummaryChanges(session, changesSummary);
	}

	private async _computeRepoBranchDiffs(session: ProtocolURI, repoRoot: URI, baseBranch: string | undefined): Promise<readonly ISessionFileDiff[] | undefined> {
		try {
			const diffs = await this._gitService.computeSessionFileDiffs(repoRoot, { sessionUri: session, baseBranch });
			if (!diffs) {
				this._logService.error(`[AgentHostChangesetService] Git branch diff unavailable for multi-folder branch summary ${session} in repository ${repoRoot.toString()}; skipping that repository.`);
				return undefined;
			}
			return diffs;
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Failed to compute git branch diff for multi-folder branch summary ${session} in repository ${repoRoot.toString()}`, err);
			return undefined;
		}
	}

	private async _computeNonGitBranchDiffs(session: ProtocolURI, db: ISessionDatabase, nonGitDirectories: readonly URI[]): Promise<readonly ISessionFileDiff[] | undefined> {
		if (nonGitDirectories.length === 0) {
			return [];
		}
		try {
			return await computeSessionDiffs(session, db, this._diffComputeService, undefined, nonGitDirectories);
		} catch (err) {
			this._logService.error(`[AgentHostChangesetService] Failed to compute non-git DB branch summary for multi-folder session ${session}`, err);
			return undefined;
		}
	}

	private async _resolveWorkingDirectory(session: ProtocolURI): Promise<URI | undefined> {
		const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
		return workingDirectories && workingDirectories.length > 0
			? URI.parse(workingDirectories[0])
			: undefined;
	}


	onToolCallEditsApplied(session: ProtocolURI, turnId: string, clientContext?: IAgentHostClientTelemetryContext): void {
		this._scheduleDebouncedDiffComputation(session, turnId, clientContext);
		if (this._hasSubscription(session, buildTurnChangesetUri(session, turnId))) {
			this._scheduleDebouncedTurnDiffComputation(session, turnId, clientContext);
		}
	}

	onTurnComplete(session: ProtocolURI, turnId: string | undefined, clientContext?: IAgentHostClientTelemetryContext): void {
		this._cancelDebouncedDiffComputation(session);
		if (turnId !== undefined) {
			this._cancelDebouncedTurnDiffComputation(session, turnId);
			if (this._hasSubscription(session, buildTurnChangesetUri(session, turnId))) {
				this._scheduleTurnRecompute(session, turnId, true, clientContext);
			}
		}

		if (this._hasSubscription(session, buildUncommittedChangesetUri(session))) {
			this._scheduleUncommittedRecompute(session, turnId, true, clientContext);
		}

		this._scheduleStaticRecompute(session, 'branch', turnId, undefined, true, clientContext);
		this._scheduleStaticRecompute(session, 'session', turnId, undefined, true, clientContext);
	}

	onSessionTruncated(session: ProtocolURI): void {
		this._scheduleStaticRecompute(session, 'branch', undefined, undefined, true);
		this._scheduleStaticRecompute(session, 'session', undefined, undefined, true);
	}


	private _scheduleDebouncedDiffComputation(session: ProtocolURI, turnId: string, clientContext?: IAgentHostClientTelemetryContext): void {
		this._debouncedDiffTimers.set(session, disposableTimeout(() => {
			this._debouncedDiffTimers.deleteAndDispose(session);
			this._scheduleStaticRecompute(session, 'branch', turnId, undefined, false, clientContext);
			this._scheduleStaticRecompute(session, 'session', turnId, undefined, false, clientContext);
		}, AgentHostChangesetService._DIFF_DEBOUNCE_MS));
	}

	private _cancelDebouncedDiffComputation(session: ProtocolURI): void {
		this._debouncedDiffTimers.deleteAndDispose(session);
	}

	private _scheduleDebouncedTurnDiffComputation(session: ProtocolURI, turnId: string, clientContext?: IAgentHostClientTelemetryContext): void {
		const key = `${session}\u0000${turnId}`;
		this._perTurnDebouncedDiffTimers.set(key, disposableTimeout(() => {
			this._perTurnDebouncedDiffTimers.deleteAndDispose(key);
			this._scheduleTurnRecompute(session, turnId, false, clientContext);
		}, AgentHostChangesetService._DIFF_DEBOUNCE_MS));
	}

	private _cancelDebouncedTurnDiffComputation(session: ProtocolURI, turnId: string): void {
		this._perTurnDebouncedDiffTimers.deleteAndDispose(`${session}\u0000${turnId}`);
	}

	private _scheduleTurnRecompute(session: ProtocolURI, turnId: string, reportTelemetry: boolean = false, clientContext?: IAgentHostClientTelemetryContext): void {
		this._diffComputationSequencer.queue(`${session}\u0000turn\u0000${turnId}`, () => this._computeTurnChangeset(session, turnId, reportTelemetry, clientContext).then(() => undefined));
	}

	private _scheduleUncommittedRecompute(session: ProtocolURI, turnId: string | undefined, reportTelemetry: boolean = false, clientContext?: IAgentHostClientTelemetryContext): void {
		void this._queueUncommittedChangeset(session, turnId, reportTelemetry, clientContext);
	}

	private _queueUncommittedChangeset(session: ProtocolURI, turnId: string | undefined, reportTelemetry: boolean, clientContext?: IAgentHostClientTelemetryContext): Promise<ProtocolURI> {
		return this._diffComputationSequencer.queue(`${session}\u0000uncommitted`, () => this._computeUncommittedChangeset(session, turnId, reportTelemetry, clientContext));
	}

	private _scheduleStaticRecompute(session: ProtocolURI, kind: StaticChangesetKind, changedTurnId?: string, statusBeforeRefresh?: ChangesetStatus, reportTelemetry: boolean = false, clientContext?: IAgentHostClientTelemetryContext): void {
		this._diffComputationSequencer.queue(`${session}\u0000${kind}`, () => this._doComputeStaticChangeset(session, kind, changedTurnId, statusBeforeRefresh, reportTelemetry, clientContext));
	}

	private _markStaticChangesetComputing(session: ProtocolURI, kind: StaticChangesetKind): ChangesetStatus | undefined {
		const changesetUri = staticChangesetUri(session, kind);
		this._stateManager.registerChangeset(changesetUri);
		const status = this._stateManager.getChangesetState(changesetUri)?.status;
		if (status !== ChangesetStatus.Computing) {
			this._stateManager.dispatchServerAction(changesetUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Computing,
			});
		}
		return status;
	}

	private async _doComputeStaticChangeset(session: ProtocolURI, kind: StaticChangesetKind, changedTurnId?: string, statusBeforeRefresh?: ChangesetStatus, reportTelemetry: boolean = false, clientContext?: IAgentHostClientTelemetryContext): Promise<void> {
		const changesetUri = staticChangesetUri(session, kind);
		const stopWatch = StopWatch.create();
		const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
		let outcome: StaticChangesetOutcome = 'error';
		let fileCount = 0;
		let incrementalUsed = false;
		let usedEditTrackerFallback = false;
		const emitStaticTelemetry = () => {
			if (reportTelemetry) {
				reportAgentHostStaticChangesetComputed(this._telemetryService, session, changedTurnId, {
					kind,
					outcome,
					durationMs: stopWatch.elapsed(),
					isMultiRoot: isMultiRootSession(workingDirectories),
					folderCount: workingDirectories?.length ?? 0,
					...(outcome === 'computed' ? { fileCount } : {}),
					...(kind === 'session' ? { incrementalUsed, usedEditTrackerFallback } : {}),
				}, clientContext);
			}
		};
		this._activeStaticComputes.add(changesetUri);
		const statusBeforeCompute = statusBeforeRefresh ?? this._stateManager.getChangesetState(changesetUri)?.status;
		let ref: ReturnType<ISessionDataService['openDatabase']>;
		try {
			ref = this._sessionDataService.openDatabase(URI.parse(session));
		} catch (err) {
			this._logService.warn(`[AgentHostChangesetService] Failed to open session database for ${kind} diff computation: ${session}`, err);
			this._restoreStaticChangesetStatus(changesetUri, statusBeforeCompute);
			this._activeStaticComputes.delete(changesetUri);
			this._stateManager.onChangesetLivenessChanged();
			outcome = 'dbOpenFailed';
			emitStaticTelemetry();
			return;
		}
		this._stateManager.registerChangeset(changesetUri);
		try {
			let diffs = await this._tryComputeGitDiffs(session, ref.object, kind);
			if (!diffs) {
				if (kind === 'branch') {
					const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
					if (isMultiRootSession(workingDirectories)) {
						await this._updateMultiFolderChangesSummary(session, ref.object, workingDirectories!);
					}
					this._logService.debug(`[AgentHostChangesetService] Branch git diff unavailable for ${session}; preserving cached changeset. previousStatus=${statusBeforeCompute ?? 'unknown'} cachedFiles=${this._stateManager.getChangesetState(changesetUri)?.files.length ?? 0}`);
					this._restoreStaticChangesetStatus(changesetUri, statusBeforeCompute);
					outcome = 'preserved';
					return;
				}
				usedEditTrackerFallback = true;
				const peerSources = this._openPeerChatSources(session);
				try {
					if (peerSources.length > 0) {
						const sources: ISessionDiffSource[] = [
							{ sessionUri: session, db: ref.object },
							...peerSources.map(p => ({ sessionUri: p.sessionUri, db: p.ref.object })),
						];
						diffs = await computeUnionedDiffs(sources, this._diffComputeService);
					} else {
						let incremental: IIncrementalDiffOptions | undefined;
						if (changedTurnId) {
							const previousDiffs = this._readPreviousChangesetDiffs(changesetUri);
							if (previousDiffs) {
								incremental = { changedTurnId, previousDiffs: [...previousDiffs] };
								incrementalUsed = true;
							}
						}
						diffs = await computeSessionDiffs(session, ref.object, this._diffComputeService, incremental);
					}
				} finally {
					for (const peer of peerSources) {
						peer.ref.dispose();
					}
				}
			}

			const reviewed = kind === ChangesetKind.Branch
				? await this._computeReviewedInfo(session, ref.object)
				: undefined;
			this._publishChangesetDiffs(session, changesetUri, diffs, reviewed);
			fileCount = diffs.length;
			outcome = 'computed';

			this._persistSessionFlag(session, persistKeyFor(kind), JSON.stringify(diffs));

			if (kind === ChangesetKind.Branch) {
				this._persistSessionFlag(session, META_LEGACY_DIFFS, JSON.stringify(diffs));

				const workingDirectories = this._configurationService.getEffectiveWorkingDirectories(session);
				if (isMultiRootSession(workingDirectories)) {
					await this._updateMultiFolderChangesSummary(session, ref.object, workingDirectories!, diffs);
				} else {
					const changesSummary = summariseDiffs(diffs) ?? { additions: 0, deletions: 0, files: 0 };
					this.persistChangesSummary(session, changesSummary);
					this._stateManager.setSessionSummaryChanges(session, changesSummary);
				}
			}
		} catch (err) {
			this._logService.warn(`[AgentHostChangesetService] Failed to compute ${kind} diffs`, err);
			this._stateManager.dispatchServerAction(changesetUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Error,
				error: { errorType: 'computeFailed', message: err instanceof Error ? err.message : String(err) },
			});
			outcome = 'error';
		} finally {
			this._activeStaticComputes.delete(changesetUri);
			this._stateManager.onChangesetLivenessChanged();
			ref.dispose();
			emitStaticTelemetry();
		}
	}

	private _restoreStaticChangesetStatus(changesetUri: ProtocolURI, status: ChangesetStatus | undefined): void {
		if (!status || status === ChangesetStatus.Computing) {
			return;
		}
		this._stateManager.dispatchServerAction(changesetUri, {
			type: ActionType.ChangesetStatusChanged,
			status,
		});
	}

	private _readPreviousChangesetDiffs(changesetUri: ProtocolURI): readonly ISessionFileDiff[] | undefined {
		const state = this._stateManager.getChangesetState(changesetUri);
		if (!state || state.files.length === 0) {
			return undefined;
		}
		return state.files.map(f => f.edit);
	}

	private _publishChangesetDiffs(session: ProtocolURI, changesetUri: ProtocolURI, diffs: readonly ISessionFileDiff[], reviewed?: { readonly repoRoot: URI; readonly paths: ReadonlySet<string> }): void {
		const operations = this._changesetOperationService.getOperations(session, changesetUri);

		const files: ChangesetFile[] = [];
		for (const edit of diffs) {
			const id = edit.after?.uri ?? edit.before?.uri;
			if (!id) {
				continue;
			}
			if (reviewed) {
				const relPath = relativePath(reviewed.repoRoot, URI.parse(id));
				files.push({
					id, edit,
					reviewed: relPath
						? reviewed.paths.has(relPath)
						: false
				});
			} else {
				files.push({ id, edit });
			}
		}

		this._stateManager.dispatchServerAction(changesetUri, {
			type: ActionType.ChangesetContentChanged,
			files,
			operations: operations
				? [...operations]
				: undefined,
		});

		const status = this._stateManager.getChangesetState(changesetUri)?.status;
		if (status !== ChangesetStatus.Ready) {
			this._stateManager.dispatchServerAction(changesetUri, {
				type: ActionType.ChangesetStatusChanged,
				status: ChangesetStatus.Ready,
			});
		}
	}

	private _openPeerChatSources(session: ProtocolURI): { sessionUri: ProtocolURI; ref: ReturnType<ISessionDataService['openDatabase']> }[] {
		const chats = this._stateManager.getSessionState(session)?.chats ?? [];
		const sources: { sessionUri: ProtocolURI; ref: ReturnType<ISessionDataService['openDatabase']> }[] = [];
		for (const chat of chats) {
			if (isDefaultChatUri(chat.resource)) {
				continue;
			}
			try {
				const ref = this._sessionDataService.openDatabase(URI.parse(chat.resource));
				sources.push({ sessionUri: chat.resource, ref });
			} catch (err) {
				this._logService.warn(`[AgentHostChangesetService] Failed to open peer chat database for session changes: ${chat.resource}`, err);
			}
		}
		return sources;
	}

	private _latestTurnIdAcrossChats(session: ProtocolURI): string | undefined {
		const sessionState = this._stateManager.getSessionState(session);
		if (!sessionState) {
			return undefined;
		}

		const chats = sessionState.chats ?? [];
		if (chats.length <= 1) {
			return lastAttributableTurnId(sessionState.turns);
		}

		let bestTurnId: string | undefined;
		let bestCompletedAt = '';
		for (const chat of chats) {
			const turns = isDefaultChatUri(chat.resource)
				? sessionState.turns
				: this._stateManager.getChatState(chat.resource)?.turns;
			const lastTurn = turns?.findLast(turn => !isHostNoticeTurn(turn));
			if (!lastTurn) {
				continue;
			}
			const completedAt = lastTurn.startedAt
				? addMillisecondsToTimestamp(lastTurn.startedAt, lastTurn.duration ?? 0)
				: chat.modifiedAt;
			if (completedAt >= bestCompletedAt) {
				bestCompletedAt = completedAt;
				bestTurnId = lastTurn.id;
			}
		}
		return bestTurnId;
	}

	private async _tryComputeGitDiffs(session: ProtocolURI, db: ISessionDatabase, kind: StaticChangesetKind): Promise<readonly ISessionFileDiff[] | undefined> {
		const workingDirectory = this._stateManager.getSessionState(session)?.workingDirectories?.[0];
		if (!workingDirectory) {
			return undefined;
		}

		let workingDirectoryUri: URI;
		try {
			workingDirectoryUri = URI.parse(workingDirectory);
		} catch {
			return undefined;
		}

		if (kind === 'session') {
			const latestTurnId = this._latestTurnIdAcrossChats(session);
			if (!latestTurnId) {
				return undefined;
			}

			const sessionUri = URI.parse(session);
			const [baseline, pair] = await Promise.all([
				this._checkpointService.getBaselineCheckpoint(sessionUri),
				this._checkpointService.getTurnCheckpointPair(sessionUri, latestTurnId),
			]);
			if (!baseline || !pair) {
				return undefined;
			}

			try {
				return await this._gitService.computeFileDiffsBetweenRefs(workingDirectoryUri, {
					sessionUri: session,
					fromRef: baseline,
					toRef: pair.current
				});
			} catch (err) {
				this._logService.warn(`[AgentHostChangesetService] git-driven ${kind} diff computation failed; falling back to edit-tracker`, err);
				return undefined;
			}
		}

		const baseBranch = await this._resolveBranchBaseBranch(session, db);

		try {
			return await this._gitService.computeSessionFileDiffs(workingDirectoryUri, {
				sessionUri: session,
				baseBranch
			});
		} catch (err) {
			this._logService.warn(`[AgentHostChangesetService] git-driven ${kind} diff computation failed; falling back to edit-tracker`, err);
			return undefined;
		}
	}

	private async _resolveBranchBaseBranch(session: ProtocolURI, db: ISessionDatabase): Promise<string | undefined> {
		const persistedBaseBranch = await db.getMetadata(META_DIFF_BASE_BRANCH);
		const gitStateBaseBranch = readSessionGitState(this._stateManager.getSessionState(session)?._meta)?.baseBranchName;
		if (!persistedBaseBranch && gitStateBaseBranch) {
			this._logService.debug(`[AgentHostChangesetService] Using _meta.git base branch fallback for Branch Changes in ${session}: ${gitStateBaseBranch}`);
		}
		return resolveDiffBaseBranchName(persistedBaseBranch, gitStateBaseBranch);
	}

	private async _computeReviewedInfo(session: ProtocolURI, db: ISessionDatabase): Promise<{ readonly repoRoot: URI; readonly paths: ReadonlySet<string> } | undefined> {
		const workingDirectory = this._stateManager.getSessionState(session)?.workingDirectories?.[0];
		if (!workingDirectory) {
			return undefined;
		}

		let workingDirectoryUri: URI;
		try {
			workingDirectoryUri = URI.parse(workingDirectory);
		} catch {
			return undefined;
		}

		const repoRoot = await this._gitService.getRepositoryRoot(workingDirectoryUri);
		if (!repoRoot) {
			return undefined;
		}

		const baseBranch = await this._resolveBranchBaseBranch(session, db);
		const paths = await this._reviewService.getReviewedPaths(session, workingDirectoryUri, baseBranch);

		return { repoRoot, paths };
	}

	private _persistSessionFlag(session: ProtocolURI, key: string, value: string): void {
		const ref = this._sessionDataService.openDatabase(URI.parse(session));
		ref.object.setMetadata(key, value).catch(err => {
			this._logService.warn(`[AgentHostChangesetService] Failed to persist ${key}`, err);
		}).finally(() => {
			ref.dispose();
		});
	}
}
