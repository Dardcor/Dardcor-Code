/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IAgentSessionMetadata } from '../common/agent.js';
import { buildBranchChangesetUri, ChangesetKind, parseChangesetUri } from '../common/changesetUri.js';
import { ChangesetFileMonitorCoordinator } from './agentHostChangesetFileMonitorCoordinator.js';
import { AgentHostStateManager, IAgentHostStateManager } from './agentHostStateManager.js';
import { IAgentHostChangesetService, META_CHANGESET_BRANCH, META_CHANGESET_SESSION, META_LEGACY_DIFFS } from '../common/agentHostChangesetService.js';
import { IAgentHostChangesetSubscriptionService } from '../common/agentHostChangesetSubscriptionService.js';
import { IAgentHostChangesetOperationService } from '../common/agentHostChangesetOperationService.js';
import { IAgentHostGitStateService } from '../common/agentHostGitStateService.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { readAgentMergeSessionState } from '../common/agentMerge.js';
import { isAhpChatChannel, parseSubagentSessionUri, type SessionConfigState } from '../common/state/sessionState.js';

export type IChangesetSessionMetadata = Record<string, string | undefined>;

export class AgentHostChangesetCoordinator extends Disposable {
	private readonly _changesetFileMonitor: ChangesetFileMonitorCoordinator;

	constructor(
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@IAgentHostChangesetOperationService private readonly _changesetOperationService: IAgentHostChangesetOperationService,
		@IAgentHostChangesetService private readonly _changesets: IAgentHostChangesetService,
		@IAgentHostChangesetSubscriptionService private readonly _changesetSubscriptions: IAgentHostChangesetSubscriptionService,
		@IAgentHostGitStateService gitStateService: IAgentHostGitStateService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._changesetFileMonitor = this._register(instantiationService.createInstance(ChangesetFileMonitorCoordinator));
		this._register(gitStateService.onDidRefreshSessionGitState(sessionStr => this.onDidRunSessionGitStateRefresh(sessionStr)));
		this._register(gitStateService.onDidChangeSessionGitHubState(sessionStr => this._changesetOperationService.updateOperations(sessionStr)));
		this._register(this._stateManager.onDidChangeSessionWorkingDirectories(({ session }) => this.onDidChangeSessionWorkingDirectories(session)));
		this._register(this._stateManager.onDidChangeSessionConfig(event => this.onDidChangeSessionConfig(event.session, event.previous, event.current)));
	}


	onSessionCreated(sessionStr: string): void {
		this._changesets.refreshChangesetCatalog(sessionStr);
		this._changesets.registerStaticChangesets(sessionStr);
	}

	onSessionRestored(sessionStr: string, metadata: IChangesetSessionMetadata): void {
		this._changesets.refreshChangesetCatalog(sessionStr);
		this._changesets.registerStaticChangesets(sessionStr);
		this._changesets.restorePersistedStaticChangesets(sessionStr, {
			branchRaw: metadata[META_CHANGESET_BRANCH],
			sessionRaw: metadata[META_CHANGESET_SESSION],
			legacyRaw: metadata[META_LEGACY_DIFFS],
		});
		this._changesets.onWorkingDirectoryAvailable(sessionStr);
		this._changesetFileMonitor.onSessionRestored(sessionStr);
	}

	onSessionConfigRestored(sessionStr: string): void {
		this._changesets.refreshChangesetCatalog(sessionStr);
	}

	onSessionMaterialized(sessionStr: string): void {
		this._changesets.refreshChangesetCatalog(sessionStr);
		this._changesets.onWorkingDirectoryAvailable(sessionStr);

		this._changesetFileMonitor.onSessionMaterialized(sessionStr);
	}

	onSessionDisposed(sessionStr: string): void {
		this._changesetFileMonitor.onSessionDisposed(sessionStr);

		this._changesetSubscriptions.clearSessionSubscriptions(sessionStr);
	}

	onSessionTurnActiveChanged(sessionStr: string, active: boolean): void {
		this._changesetFileMonitor.onSessionTurnActiveChanged(sessionStr, active);

		this._changesetOperationService.updateOperations(sessionStr);
	}

	private onDidChangeSessionConfig(session: string, previous: SessionConfigState | undefined, current: SessionConfigState | undefined): void {
		const wasEnabled = readAgentMergeSessionState(previous?.values)?.enabled === true;
		const isEnabled = readAgentMergeSessionState(current?.values)?.enabled === true;
		if (wasEnabled !== isEnabled) {
			this._changesets.refreshChangesetCatalog(session);
		}
	}


	onFirstSubscriber(resource: URI): void {
		const resourceStr = resource.toString();
		const parsed = parseChangesetUri(resourceStr);

		if (!parsed && !isAhpChatChannel(resourceStr) && this._stateManager.getSessionState(resourceStr)) {
			this._addSubscription(resourceStr, buildBranchChangesetUri(resourceStr));
			this._changesets.refreshBranchChangeset(resourceStr);
			this._changesetFileMonitor.trackSessionChanges(resourceStr, resourceStr);

			return;
		}

		if (parsed?.kind === ChangesetKind.Branch) {
			this._addSubscription(parsed.sessionUri, resourceStr);
			this._changesets.refreshBranchChangeset(parsed.sessionUri);
			this._changesetFileMonitor.trackSessionChanges(resourceStr, parsed.sessionUri);
			return;
		}

		if (parsed?.kind === ChangesetKind.Uncommitted) {
			this._addSubscription(parsed.sessionUri, resourceStr);
			void this._changesets.computeUncommittedChangeset(parsed.sessionUri);
			this._changesetFileMonitor.trackSessionChanges(resourceStr, parsed.sessionUri);
			return;
		}

		if (parsed?.kind === ChangesetKind.Session) {
			this._addSubscription(parsed.sessionUri, resourceStr);
			this._changesets.refreshSessionChangeset(parsed.sessionUri);
			this._changesetFileMonitor.trackSessionChanges(resourceStr, parsed.sessionUri);
			return;
		}

		if (parsed?.kind === ChangesetKind.Turn && parsed.turnId !== undefined) {
			this._addSubscription(parsed.sessionUri, resourceStr);
			return;
		}
	}

	onLastSubscriber(resource: URI): void {
		const resourceStr = resource.toString();
		const parsed = parseChangesetUri(resourceStr);
		if (parsed?.kind === ChangesetKind.Branch) {
			this._removeSubscription(parsed.sessionUri, resourceStr);
			this._changesetFileMonitor.untrackSessionChanges(resourceStr);
			return;
		}
		if (parsed?.kind === ChangesetKind.Uncommitted) {
			this._removeSubscription(parsed.sessionUri, resourceStr);
			this._changesetFileMonitor.untrackSessionChanges(resourceStr);
			return;
		}
		if (parsed?.kind === ChangesetKind.Session) {
			this._removeSubscription(parsed.sessionUri, resourceStr);
			this._changesetFileMonitor.untrackSessionChanges(resourceStr);
			return;
		}
		if (parsed?.kind === ChangesetKind.Turn && parsed.turnId !== undefined) {
			this._removeSubscription(parsed.sessionUri, resourceStr);
			return;
		}
		if (!parsed) {
			this._removeSubscription(resourceStr, resourceStr);
			this._changesetFileMonitor.untrackSessionChanges(resourceStr);
		}
	}

	async restoreSessionIfChangesetSubscription(resource: URI, restoreSession: (session: URI) => Promise<void>): Promise<void> {
		const resourceStr = resource.toString();
		const parsed = parseChangesetUri(resourceStr);
		if (!parsed) {
			return;
		}
		if (parsed.kind === ChangesetKind.Unknown) {
			throw new Error(`Cannot subscribe to unknown changeset resource: ${resourceStr}`);
		}
		if (!this._stateManager.getSessionState(parsed.sessionUri)) {
			await restoreSession(URI.parse(parsed.sessionUri));
		}
	}

	async tryHandleSubscribe(resource: URI, restoreSession: (session: URI) => Promise<void>): Promise<boolean> {
		const resourceStr = resource.toString();
		const parsed = parseChangesetUri(resourceStr);
		if (!parsed) {
			return false;
		}
		if (parsed.kind === ChangesetKind.Unknown) {
			throw new Error(`Cannot subscribe to unknown changeset resource: ${resourceStr}`);
		}
		await this.restoreSessionIfChangesetSubscription(resource, restoreSession);
		if (parsed.kind === ChangesetKind.Turn && parsed.turnId) {
			await this._changesets.computeTurnChangeset(parsed.sessionUri, parsed.turnId);
		} else if (parsed.kind === ChangesetKind.Compare && parsed.originalTurnId && parsed.modifiedTurnId) {
			await this._changesets.computeCompareTurnsChangeset(parsed.sessionUri, parsed.originalTurnId, parsed.modifiedTurnId);
		} else {
			this._changesets.registerStaticChangesets(parsed.sessionUri);
		}
		return true;
	}

	private _addSubscription(sessionStr: string, changesetStr: string) {
		this._changesetSubscriptions.addSubscription(sessionStr, changesetStr);
	}

	private _removeSubscription(sessionStr: string, changesetStr: string) {
		this._changesetSubscriptions.removeSubscription(sessionStr, changesetStr);
	}


	getListMetadataKeys(sessionStr: string): Record<string, true> | undefined {
		return this._changesets.getListMetadataKeys(sessionStr);
	}

	decorateListEntry(entry: IAgentSessionMetadata, metadata: IChangesetSessionMetadata): IAgentSessionMetadata {
		const changes = this._changesets.computeListEntryChanges(entry.session.toString(), metadata);
		return changes ? { ...entry, changes } : entry;
	}


	private onDidRunSessionGitStateRefresh(sessionStr: string): void {
		this._changesets.refreshChangesetCatalog(sessionStr);

		this._changesets.recomputeSubscribedChangesets(sessionStr);
	}

	private onDidChangeSessionWorkingDirectories(sessionStr: string): void {
		this._changesetOperationService.updateOperations(sessionStr);
		this._changesetFileMonitor.onSessionWorkingDirectoriesChanged(sessionStr);
		for (const candidate of this._stateManager.getSessionUris()) {
			if (parseSubagentSessionUri(candidate)?.parentSession.toString() === sessionStr) {
				this._changesetOperationService.updateOperations(candidate);
				this._changesetFileMonitor.onSessionWorkingDirectoriesChanged(candidate);
			}
		}
	}
}
