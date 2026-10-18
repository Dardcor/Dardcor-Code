/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SequencerByKey } from '../../../base/common/async.js';
import { Disposable, DisposableMap, IReference, ReferenceCollection } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { buildBranchChangesetUri, buildSessionChangesetUri, buildUncommittedChangesetUri } from '../common/changesetUri.js';
import { parseSubagentSessionUri } from '../common/state/sessionState.js';
import { DEFAULT_AGENT_HOST_WATCH_EXCLUDES, IAgentHostFileMonitorService } from './agentHostFileMonitorService.js';
import { IAgentHostGitService } from '../common/agentHostGitService.js';
import { resolveSessionRepositories } from './agentHostSessionRepositories.js';
import { AgentHostStateManager, IAgentHostStateManager } from './agentHostStateManager.js';
import { getEffectiveWorkingDirectories, getEffectiveWorkingDirectory } from './agentConfigurationService.js';
import { ILogService } from '../../log/common/log.js';
import { IAgentHostGitStateService } from '../common/agentHostGitStateService.js';

class WatchInterestReferenceCollection extends ReferenceCollection<string> {
	constructor(
		private readonly _create: (sessionStr: string) => void,
		private readonly _destroy: (sessionStr: string) => void,
	) {
		super();
	}

	protected createReferencedObject(sessionStr: string): string {
		this._create(sessionStr);
		return sessionStr;
	}

	protected destroyReferencedObject(sessionStr: string): void {
		this._destroy(sessionStr);
	}
}

export class ChangesetFileMonitorCoordinator extends Disposable {

	private readonly _watchInterestReferences = this._register(new DisposableMap<string, IReference<string>>());
	private readonly _watchInterestCollection = new WatchInterestReferenceCollection(
		sessionStr => this._attachWatcherIfPossible(sessionStr),
		sessionStr => this._destroyWatchInterest(sessionStr),
	);
	private readonly _pendingWatchInterest = new Set<string>();
	private readonly _sessionWorkingDirectories = new Map<string, string>();
	private readonly _sessionRoots = new Map<string, Set<string>>();
	private readonly _rootSessions = new Map<string, Set<string>>();
	private readonly _rootWatchAcquisitions = this._register(new DisposableMap<string>());
	private readonly _rootUris = new Map<string, URI>();
	private readonly _activeSessionRoots = new Map<string, string>();
	private readonly _rootActiveSessions = new Map<string, Set<string>>();
	private readonly _unresolvedActiveSessions = new Set<string>();
	private readonly _watchAttachmentSequencer = new SequencerByKey<string>();
	private readonly _activeTurnSequencer = new SequencerByKey<string>();

	constructor(
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@IAgentHostFileMonitorService private readonly _fileMonitorService: IAgentHostFileMonitorService,
		@IAgentHostGitService private readonly _gitService: IAgentHostGitService,
		@IAgentHostGitStateService private readonly _gitStateService: IAgentHostGitStateService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	trackSessionChanges(subscriptionKey: string, sessionStr: string): void {
		if (!this._watchInterestReferences.has(subscriptionKey)) {
			this._watchInterestReferences.set(subscriptionKey, this._watchInterestCollection.acquire(sessionStr));
		}
	}

	untrackSessionChanges(subscriptionKey: string): void {
		this._watchInterestReferences.deleteAndDispose(subscriptionKey);
	}

	onSessionRestored(sessionStr: string): void {
		this._retryWatchAttachment(sessionStr);
	}

	onSessionMaterialized(sessionStr: string): void {
		this._retryWatchAttachment(sessionStr);
	}

	onSessionWorkingDirectoriesChanged(sessionStr: string): void {
		this._retryWatchAttachment(sessionStr);
	}

	onSessionDisposed(sessionStr: string): void {
		this.untrackSessionChanges(buildUncommittedChangesetUri(sessionStr));
		this.untrackSessionChanges(buildSessionChangesetUri(sessionStr));
		this.untrackSessionChanges(buildBranchChangesetUri(sessionStr));
		this.untrackSessionChanges(sessionStr);
		this._removeActiveSession(sessionStr);
		this._destroyWatchInterest(sessionStr);
	}

	onSessionTurnActiveChanged(sessionStr: string, active: boolean): void {
		this._activeTurnSequencer.queue(sessionStr, async () => {
			if (active) {
				await this._markSessionActive(sessionStr);
			} else {
				this._markSessionInactive(sessionStr);
			}
		});
	}

	private _destroyWatchInterest(sessionStr: string): void {
		this._pendingWatchInterest.delete(sessionStr);
		this._releaseSessionRoots(sessionStr);
	}

	private _retryWatchAttachment(sessionStr: string): void {
		if (this._shouldAttachSession(sessionStr) || this._pendingWatchInterest.has(sessionStr)) {
			this._attachWatcherIfPossible(sessionStr);
		}
	}

	private _hasWatchInterest(sessionStr: string): boolean {
		return this._watchInterestReferences.has(sessionStr)
			|| this._watchInterestReferences.has(buildBranchChangesetUri(sessionStr))
			|| this._watchInterestReferences.has(buildUncommittedChangesetUri(sessionStr))
			|| this._watchInterestReferences.has(buildSessionChangesetUri(sessionStr));
	}

	private _attachWatcherIfPossible(sessionStr: string): void {
		this._watchAttachmentSequencer.queue(sessionStr, async () => {
			if (!this._shouldAttachSession(sessionStr)) {
				return;
			}
			const workingDirectories = getEffectiveWorkingDirectories(this._stateManager, sessionStr);
			if (!workingDirectories || workingDirectories.length === 0) {
				this._pendingWatchInterest.add(sessionStr);
				this._releaseSessionRoots(sessionStr);
				return;
			}
			const workingDirectoryUris: URI[] = [];
			for (const workingDirectory of workingDirectories) {
				try {
					workingDirectoryUris.push(URI.parse(workingDirectory));
				} catch (err) {
					this._logService.warn(`[ChangesetFileMonitorCoordinator] Failed to parse working directory URI for ${sessionStr}: ${workingDirectory}`, err);
				}
			}
			if (workingDirectoryUris.length === 0) {
				this._pendingWatchInterest.add(sessionStr);
				this._releaseSessionRoots(sessionStr);
				return;
			}
			const signature = this._workingDirectoriesSignature(workingDirectories);
			if (this._sessionRoots.has(sessionStr) && this._sessionWorkingDirectories.get(sessionStr) === signature) {
				this._pendingWatchInterest.delete(sessionStr);
				return;
			}
			const { gitRepositories } = await resolveSessionRepositories(workingDirectoryUris, this._gitService);
			if (!this._shouldAttachSession(sessionStr)) {
				return;
			}
			if (gitRepositories.length === 0) {
				this._pendingWatchInterest.delete(sessionStr);
				this._releaseSessionRoots(sessionStr);
				return;
			}
			this._pendingWatchInterest.delete(sessionStr);
			this._attachSessionToRoots(sessionStr, gitRepositories, signature);
		});
	}

	private _attachSessionToRoots(sessionStr: string, repositoryRoots: readonly URI[], signature: string): void {
		const desiredRoots = new Map<string, URI>();
		for (const repositoryRoot of repositoryRoots) {
			desiredRoots.set(repositoryRoot.toString(), repositoryRoot);
		}

		const current = this._sessionRoots.get(sessionStr);
		if (current) {
			for (const rootStr of [...current]) {
				if (!desiredRoots.has(rootStr)) {
					current.delete(rootStr);
					this._detachRootSession(sessionStr, rootStr);
				}
			}
		}

		let sessionRoots = this._sessionRoots.get(sessionStr);
		if (!sessionRoots) {
			sessionRoots = new Set<string>();
			this._sessionRoots.set(sessionStr, sessionRoots);
		}
		let allRootsWatched = true;
		for (const [rootStr, repositoryRoot] of desiredRoots) {
			let sessions = this._rootSessions.get(rootStr);
			if (!sessions) {
				sessions = new Set<string>();
				this._rootSessions.set(rootStr, sessions);
				this._rootUris.set(rootStr, repositoryRoot);
			}
			sessions.add(sessionStr);
			sessionRoots.add(rootStr);
			if (!this._ensureRootWatcher(rootStr, repositoryRoot)) {
				allRootsWatched = false;
			}
		}
		if (allRootsWatched) {
			this._sessionWorkingDirectories.set(sessionStr, signature);
		} else {
			this._sessionWorkingDirectories.delete(sessionStr);
		}
	}

	private _releaseSessionRoots(sessionStr: string): void {
		this._sessionWorkingDirectories.delete(sessionStr);
		const rootStrs = this._sessionRoots.get(sessionStr);
		if (!rootStrs) {
			return;
		}
		this._sessionRoots.delete(sessionStr);
		for (const rootStr of rootStrs) {
			this._detachRootSession(sessionStr, rootStr);
		}
	}

	private _detachRootSession(sessionStr: string, rootStr: string): void {
		const sessions = this._rootSessions.get(rootStr);
		if (!sessions) {
			return;
		}
		sessions.delete(sessionStr);
		if (sessions.size === 0) {
			this._rootSessions.delete(rootStr);
			this._rootUris.delete(rootStr);
			this._rootWatchAcquisitions.deleteAndDispose(rootStr);
		}
	}

	private _workingDirectoriesSignature(workingDirectories: readonly string[]): string {
		return workingDirectories.join('\u0000');
	}

	private _onRootChanged(rootStr: string): void {
		if (this._isRootActive(rootStr)) {
			return;
		}
		const sessions = this._rootSessions.get(rootStr);
		if (!sessions || sessions.size === 0) {
			return;
		}
		const sessionsToRefresh = [...sessions].filter(session => {
			return this._hasWatchInterest(session)
				&& !!this._sessionRoots.get(session)?.has(rootStr)
				&& !this._activeSessionRoots.has(session)
				&& !this._unresolvedActiveSessions.has(session)
				&& !!this._stateManager.getSessionState(session);
		});
		if (sessionsToRefresh.length === 0) {
			return;
		}

		for (const session of sessionsToRefresh) {
			const primaryWorkingDirectory = getEffectiveWorkingDirectory(this._stateManager, session);
			if (!primaryWorkingDirectory) {
				continue;
			}
			let primaryWorkingDirectoryUri: URI;
			try {
				primaryWorkingDirectoryUri = URI.parse(primaryWorkingDirectory);
			} catch (err) {
				this._logService.warn(`[ChangesetFileMonitorCoordinator] Failed to parse primary working directory URI for ${session}: ${primaryWorkingDirectory}`, err);
				continue;
			}
			void this._gitStateService.refreshSessionGitState(session, primaryWorkingDirectoryUri);
		}
	}

	private _shouldAttachSession(sessionStr: string): boolean {
		return this._hasWatchInterest(sessionStr)
			&& !this._activeSessionRoots.has(sessionStr)
			&& !this._unresolvedActiveSessions.has(sessionStr);
	}

	private _isRootActive(rootStr: string): boolean {
		return (this._rootActiveSessions.get(rootStr)?.size ?? 0) > 0;
	}

	private _ensureRootWatcher(rootStr: string, repositoryRoot: URI): boolean {
		if (this._isRootActive(rootStr) || this._rootWatchAcquisitions.has(rootStr)) {
			return true;
		}
		const sessions = this._rootSessions.get(rootStr);
		if (!sessions || sessions.size === 0) {
			return true;
		}
		const rootWatchAcquisition = this._fileMonitorService.acquire(repositoryRoot, () => this._onRootChanged(rootStr), {
			excludes: DEFAULT_AGENT_HOST_WATCH_EXCLUDES,
			debounceMs: 750,
		});
		if (!rootWatchAcquisition) {
			for (const session of sessions) {
				this._pendingWatchInterest.add(session);
			}
			return false;
		}
		this._rootWatchAcquisitions.set(rootStr, rootWatchAcquisition);
		return true;
	}

	private _suspendRootWatcher(rootStr: string): void {
		this._rootWatchAcquisitions.deleteAndDispose(rootStr);
	}

	private async _markSessionActive(sessionStr: string): Promise<void> {
		this._removeActiveSession(sessionStr);
		this._pendingWatchInterest.delete(sessionStr);
		const repositoryRoot = await this._resolveActivityRepositoryRoot(sessionStr);
		if (!repositoryRoot) {
			this._unresolvedActiveSessions.add(sessionStr);
			this._releaseSessionRoots(sessionStr);
			return;
		}
		const rootStr = repositoryRoot.toString();
		let activeSessions = this._rootActiveSessions.get(rootStr);
		if (!activeSessions) {
			activeSessions = new Set<string>();
			this._rootActiveSessions.set(rootStr, activeSessions);
		}
		activeSessions.add(sessionStr);
		this._activeSessionRoots.set(sessionStr, rootStr);
		this._rootUris.set(rootStr, repositoryRoot);
		this._suspendRootWatcher(rootStr);
		this._releaseSessionRoots(sessionStr);
	}

	private _markSessionInactive(sessionStr: string): void {
		const rootStr = this._removeActiveSession(sessionStr);
		if (rootStr) {
			const repositoryRoot = this._rootUris.get(rootStr);
			if (repositoryRoot) {
				this._ensureRootWatcher(rootStr, repositoryRoot);
			}
		}
		if (this._hasWatchInterest(sessionStr) || this._pendingWatchInterest.has(sessionStr)) {
			this._attachWatcherIfPossible(sessionStr);
		}
	}

	private _removeActiveSession(sessionStr: string): string | undefined {
		this._unresolvedActiveSessions.delete(sessionStr);
		const rootStr = this._activeSessionRoots.get(sessionStr);
		if (!rootStr) {
			return undefined;
		}
		this._activeSessionRoots.delete(sessionStr);
		const activeSessions = this._rootActiveSessions.get(rootStr);
		if (activeSessions) {
			activeSessions.delete(sessionStr);
			if (activeSessions.size === 0) {
				this._rootActiveSessions.delete(rootStr);
			}
		}
		return rootStr;
	}

	private async _resolveActivityRepositoryRoot(sessionStr: string): Promise<URI | undefined> {
		const workingDirectory = this._getActivityWorkingDirectory(sessionStr);
		if (!workingDirectory) {
			return undefined;
		}
		let workingDirectoryUri: URI;
		try {
			workingDirectoryUri = URI.parse(workingDirectory);
		} catch (err) {
			this._logService.warn(`[ChangesetFileMonitorCoordinator] Failed to parse active working directory URI for ${sessionStr}: ${workingDirectory}`, err);
			return undefined;
		}
		return this._gitService.getRepositoryRoot(workingDirectoryUri);
	}

	private _getActivityWorkingDirectory(sessionStr: string): string | undefined {
		const workingDirectory = getEffectiveWorkingDirectory(this._stateManager, sessionStr);
		if (workingDirectory) {
			return workingDirectory;
		}
		const parsedSubagent = parseSubagentSessionUri(sessionStr);
		if (!parsedSubagent) {
			return undefined;
		}
		return getEffectiveWorkingDirectory(this._stateManager, parsedSubagent.parentSession.toString());
	}
}
