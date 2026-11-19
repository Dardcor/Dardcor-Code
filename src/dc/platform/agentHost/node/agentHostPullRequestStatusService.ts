/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { structuralEquals } from '../../../base/common/equals.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, type IDisposable } from '../../../base/common/lifecycle.js';
import { autorun } from '../../../base/common/observable.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import type { PullRequestRef, PullRequestSnapshot, PullRequestSubscription, PullRequestSubscriptionOptions } from '../../github/common/githubPullRequestService.js';
import type { GitHubCredentialInvalidation } from '../../github/common/githubCredentialService.js';
import type { GitHubAccountHandle } from '../../github/common/githubTypes.js';
import { IGitHubService } from '../../github/common/githubService.js';
import { IAgentHostChangesetSubscriptionService } from '../common/agentHostChangesetSubscriptionService.js';
import { IAgentHostGitStateService } from '../common/agentHostGitStateService.js';
import { getSessionRelatedPullRequestUrls, hasSessionPullRequestForBranch, isSessionStatusArchived, readSessionGitHubState, readSessionGitState } from '../common/state/sessionState.js';
import { ActionType } from '../common/state/sessionActions.js';
import { AgentHostStateManager, IAgentHostStateManager } from './agentHostStateManager.js';
import { parsePullRequestUrl } from './agentMergeController.js';
import { isAgentMergePullRequestReadyForReview, readAgentMergeSessionState } from '../common/agentMerge.js';

const MERGEABLE_STATES = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

export interface IAgentHostPullRequestStatus {
	readonly pullRequestId?: string;
	readonly number: number;
	readonly url: string;
	readonly headSha?: string;
	readonly state: 'open' | 'closed' | 'merged';
	readonly draft: boolean;
	readonly mergeReady: boolean;
	readonly agentMergeReadyForReview?: boolean;
	readonly viewerCanEnableAutoMerge: boolean;
	readonly autoMergeEnabled: boolean;
	readonly allowedMergeMethods: readonly ('MERGE' | 'SQUASH' | 'REBASE')[];
}

export const IAgentHostPullRequestStatusService = createDecorator<IAgentHostPullRequestStatusService>('agentHostPullRequestStatusService');

export interface IAgentHostPullRequestStatusService extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onDidChangePullRequestStatus: Event<string>;

	getPullRequestStatus(sessionKey: string): IAgentHostPullRequestStatus | undefined;

	markPullRequestMerged(sessionKey: string, pullRequestUrl: string): void;

	refresh(sessionKey: string): Promise<void>;
}

interface IWatch extends IDisposable {
	readonly ref: PullRequestRef;
	readonly subscription: PullRequestSubscription;
	awaitingAuthoritativeRefresh: boolean;
	status?: IAgentHostPullRequestStatus;
}

type IWatchTarget =
	| { readonly kind: 'watch'; readonly pullRequestUrl: string }
	| { readonly kind: 'skip'; readonly reason: string };

export class AgentHostPullRequestStatusService extends Disposable implements IAgentHostPullRequestStatusService {

	declare readonly _serviceBrand: undefined;

	private readonly _watches = new Map<string, IWatch>();
	private readonly _pendingSyncs = new Map<string, Promise<void>>();
	private readonly _staleSyncs = new Set<string>();
	private readonly _abortController = new AbortController();

	private readonly _onDidChangePullRequestStatus = this._register(new Emitter<string>());
	readonly onDidChangePullRequestStatus = this._onDidChangePullRequestStatus.event;

	constructor(
		@IAgentHostStateManager private readonly _stateManager: AgentHostStateManager,
		@IAgentHostChangesetSubscriptionService private readonly _changesetSubscriptions: IAgentHostChangesetSubscriptionService,
		@IAgentHostGitStateService private readonly _gitStateService: IAgentHostGitStateService,
		@IGitHubService private readonly _gitHubService: IGitHubService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(this._changesetSubscriptions.onDidChangeSessionSubscriptions(session => this._sync(session)));
		this._register(this._gitStateService.onDidRefreshSessionGitState(session => this._sync(session)));
		this._register(this._gitStateService.onDidChangeSessionGitHubState(session => this._sync(session)));
		this._register(this._stateManager.onDidRemoveSession(session => this._stopWatch(session)));
		this._register(this._stateManager.onDidEmitEnvelope(envelope => {
			if (envelope.action.type === ActionType.SessionIsArchivedChanged || envelope.action.type === ActionType.SessionConfigChanged) {
				this._sync(envelope.channel);
			}
		}));
		this._register(this._gitHubService.credentials.onDidInvalidate(event => this._handleCredentialInvalidation(event)));
	}

	private _handleCredentialInvalidation(event: GitHubCredentialInvalidation): void {
		if (event.reason === 'replacement' || event.reason === 'authentication') {
			return;
		}
		for (const [sessionKey, watch] of [...this._watches]) {
			if (event.credential && !sameAccount(event.credential.account, watch.ref)) {
				continue;
			}
			this._stopWatch(sessionKey, `the GitHub credential was invalidated (${event.reason})`);
			if (event.reason !== 'shutdown') {
				this._sync(sessionKey);
			}
		}
	}

	getPullRequestStatus(sessionKey: string): IAgentHostPullRequestStatus | undefined {
		return this._watches.get(sessionKey)?.status;
	}

	markPullRequestMerged(sessionKey: string, pullRequestUrl: string): void {
		const gitHubState = readSessionGitHubState(this._stateManager.getSessionState(sessionKey)?._meta);
		const currentPullRequestUrl = getSessionRelatedPullRequestUrls(gitHubState)[0] ?? gitHubState?.pullRequestUrls?.[0];
		const mergedPullRequest = parsePullRequestUrl(pullRequestUrl);
		const currentPullRequest = currentPullRequestUrl ? parsePullRequestUrl(currentPullRequestUrl) : undefined;
		if (!mergedPullRequest || !currentPullRequest || !sameParsedRef(mergedPullRequest, currentPullRequest)) {
			return;
		}

		const watch = this._watches.get(sessionKey);
		const status = watch?.status;
		if (!watch || !status || !sameRefAndHost(watch.ref, mergedPullRequest)) {
			this._publishPullRequestState(sessionKey, pullRequestUrl, 'merged');
			this._onDidChangePullRequestStatus.fire(sessionKey);
			return;
		}
		this._setStatus(sessionKey, watch, {
			...status,
			state: 'merged',
			draft: false,
			mergeReady: false,
			viewerCanEnableAutoMerge: false,
			autoMergeEnabled: false,
		});
	}

	async refresh(sessionKey: string): Promise<void> {
		const watch = this._watches.get(sessionKey);
		if (!watch) {
			this._logService.trace(`[AgentHostPullRequestStatusService] Refresh skipped because no pull request is being watched: session=${sessionKey}`);
			return;
		}
		try {
			this._logService.trace(`[AgentHostPullRequestStatusService] Refreshing pull request: session=${sessionKey}, pr=${describeRef(watch.ref)}`);
			await watch.subscription.refresh(undefined, undefined, { authoritative: true });
		} catch (error) {
			this._logService.warn(`[AgentHostPullRequestStatusService] Refresh failed: session=${sessionKey}, pr=${describeRef(watch.ref)}, error=${error}`);
		}
	}

	override dispose(): void {
		this._abortController.abort();
		this._staleSyncs.clear();
		for (const watch of this._watches.values()) {
			watch.dispose();
		}
		this._watches.clear();
		super.dispose();
	}

	private _sync(sessionKey: string): void {
		if (this._pendingSyncs.has(sessionKey)) {
			this._staleSyncs.add(sessionKey);
			return;
		}
		this._runSync(sessionKey);
	}

	private _runSync(sessionKey: string): void {
		this._staleSyncs.delete(sessionKey);
		const run = this._doSync(sessionKey).catch(error => {
			this._logService.debug(`[AgentHostPullRequestStatusService] Sync failed: session=${sessionKey}, error=${error}`);
		}).finally(() => {
			if (this._pendingSyncs.get(sessionKey) !== run) {
				return;
			}
			this._pendingSyncs.delete(sessionKey);
			if (this._staleSyncs.delete(sessionKey) && !this._abortController.signal.aborted) {
				this._runSync(sessionKey);
			}
		});
		this._pendingSyncs.set(sessionKey, run);
	}

	private async _doSync(sessionKey: string): Promise<void> {
		if (this._abortController.signal.aborted) {
			return;
		}

		const target = this._getWatchTarget(sessionKey);
		if (target.kind === 'skip') {
			this._stopWatch(sessionKey, target.reason);
			return;
		}

		const parsed = parsePullRequestUrl(target.pullRequestUrl);
		if (!parsed) {
			this._stopWatch(sessionKey, `pull request URL could not be parsed: ${target.pullRequestUrl}`);
			return;
		}

		const existing = this._watches.get(sessionKey);
		if (existing && sameRefAndHost(existing.ref, parsed)) {
			existing.subscription.update(this._getSubscriptionOptions(sessionKey));
			this._updateStatus(sessionKey, existing, existing.subscription.resource.snapshot.get());
			return;
		}

		const credential = await this._gitHubService.credentials.getCredential(this._abortController.signal);
		if (this._abortController.signal.aborted) {
			return;
		}
		if (credential.account.host.toLowerCase() !== parsed.apiHost.toLowerCase()) {
			const reason = `the signed in account (${credential.account.host}) does not host ${parsed.owner}/${parsed.repo}#${parsed.number} (${parsed.apiHost})`;
			this._stopWatch(sessionKey, reason);
			this._logService.debug(`[AgentHostPullRequestStatusService] Not watching pull request: session=${sessionKey}, reason=${reason}`);
			return;
		}
		const ref: PullRequestRef = { ...credential.account, owner: parsed.owner, repo: parsed.repo, number: parsed.number };

		const current = this._getWatchTarget(sessionKey);
		if (current.kind === 'skip' || current.pullRequestUrl !== target.pullRequestUrl) {
			this._logService.trace(`[AgentHostPullRequestStatusService] Retrying sync because the session changed while resolving credentials: session=${sessionKey}`);
			this._staleSyncs.add(sessionKey);
			return;
		}

		this._stopWatch(sessionKey, `replaced by ${describeRef(ref)}`);
		const store = new DisposableStore();
		const subscription = store.add(this._gitHubService.pullRequests.subscribePullRequest(ref, this._getSubscriptionOptions(sessionKey)));
		const watch: IWatch = {
			ref,
			subscription,
			awaitingAuthoritativeRefresh: this._hasPersistedMergedState(sessionKey, ref),
			dispose: () => store.dispose(),
		};
		this._watches.set(sessionKey, watch);
		store.add(autorun(reader => {
			const snapshot = subscription.resource.snapshot.read(reader);
			if (watch.awaitingAuthoritativeRefresh) {
				return;
			}
			this._updateStatus(sessionKey, watch, snapshot);
		}));
		if (watch.awaitingAuthoritativeRefresh) {
			void this._refreshRecreatedMergedWatch(sessionKey, watch);
		}
		this._logService.debug(`[AgentHostPullRequestStatusService] Watching pull request: session=${sessionKey}, pr=${describeRef(ref)}`);
	}

	private _getSubscriptionOptions(sessionKey: string): PullRequestSubscriptionOptions {
		const agentMergeEnabled = readAgentMergeSessionState(this._stateManager.getSessionState(sessionKey)?.config?.values)?.enabled === true;
		return {
			priority: 'visible',
			core: true,
			mergeability: true,
			...(agentMergeEnabled ? {
				conversation: {
					topLevelComments: true,
					submittedReviews: true,
					reviewThreads: true,
					includeBodies: true,
				},
				checks: { required: true },
			} : {}),
		};
	}

	private _hasPersistedMergedState(sessionKey: string, ref: PullRequestRef): boolean {
		const gitHubState = readSessionGitHubState(this._stateManager.getSessionState(sessionKey)?._meta);
		const persistedPullRequest = gitHubState?.pullRequestStateUrl ? parsePullRequestUrl(gitHubState.pullRequestStateUrl) : undefined;
		return gitHubState?.pullRequestState === 'merged'
			&& persistedPullRequest !== undefined
			&& sameRefAndHost(ref, persistedPullRequest);
	}

	private async _refreshRecreatedMergedWatch(sessionKey: string, watch: IWatch): Promise<void> {
		try {
			await watch.subscription.refresh(undefined, undefined, { authoritative: true });
		} catch (error) {
			this._logService.warn(`[AgentHostPullRequestStatusService] Failed to refresh recreated merged pull request watch: session=${sessionKey}, pr=${describeRef(watch.ref)}, error=${error}`);
			return;
		}
		if (this._watches.get(sessionKey) !== watch) {
			return;
		}
		watch.awaitingAuthoritativeRefresh = false;
		this._updateStatus(sessionKey, watch, watch.subscription.resource.snapshot.get());
	}

	private _getWatchTarget(sessionKey: string): IWatchTarget {
		const state = this._stateManager.getSessionState(sessionKey);
		if (!state) {
			return { kind: 'skip', reason: 'session is unknown' };
		}
		if (isSessionStatusArchived(state.status)) {
			return { kind: 'skip', reason: 'session is archived' };
		}
		if (this._changesetSubscriptions.getSessionSubscriptions(sessionKey).size === 0) {
			return { kind: 'skip', reason: 'no client is subscribed to the session changes' };
		}
		const gitHubState = readSessionGitHubState(state._meta);
		const gitState = readSessionGitState(state._meta);
		if (!hasSessionPullRequestForBranch(gitHubState, gitState?.branchName)) {
			return { kind: 'skip', reason: `no pull request is known for branch '${gitState?.branchName ?? 'unknown'}'` };
		}
		const pullRequestUrl = getSessionRelatedPullRequestUrls(gitHubState)[0] ?? gitHubState?.pullRequestUrls?.[0];
		return pullRequestUrl
			? { kind: 'watch', pullRequestUrl }
			: { kind: 'skip', reason: 'the session has no pull request URL' };
	}

	private _updateStatus(sessionKey: string, watch: IWatch, snapshot: PullRequestSnapshot): void {
		const gitHubState = readSessionGitHubState(this._stateManager.getSessionState(sessionKey)?._meta);
		const persistedPullRequest = gitHubState?.pullRequestStateUrl ? parsePullRequestUrl(gitHubState.pullRequestStateUrl) : undefined;
		const persistedMergedStateApplies = gitHubState?.pullRequestState === 'merged'
			&& persistedPullRequest !== undefined
			&& sameRefAndHost(watch.ref, persistedPullRequest);
		if (snapshot.core.status !== 'ready' && (watch.status?.state === 'merged' || persistedMergedStateApplies)) {
			return;
		}
		const agentMerge = readAgentMergeSessionState(this._stateManager.getSessionState(sessionKey)?.config?.values);
		this._setStatus(sessionKey, watch, toPullRequestStatus(snapshot, agentMerge?.enabled ? agentMerge.target?.commentWatermark : undefined));
	}

	private _setStatus(sessionKey: string, watch: IWatch, status: IAgentHostPullRequestStatus | undefined): void {
		if (structuralEquals(watch.status, status)) {
			return;
		}
		const previous = watch.status;
		watch.status = status;
		if (this._watches.get(sessionKey) !== watch) {
			return;
		}
		this._logService.debug(`[AgentHostPullRequestStatusService] Status changed: session=${sessionKey}, pr=${describeRef(watch.ref)}, from=[${describeStatus(previous)}], to=[${describeStatus(status)}]`);
		if (status) {
			this._publishPullRequestState(sessionKey, status.url, status.state);
		}
		this._onDidChangePullRequestStatus.fire(sessionKey);
	}

	private _publishPullRequestState(sessionKey: string, pullRequestUrl: string, state: IAgentHostPullRequestStatus['state']): void {
		const gitHubState = readSessionGitHubState(this._stateManager.getSessionState(sessionKey)?._meta);
		if (gitHubState?.pullRequestState === state && gitHubState.pullRequestStateUrl === pullRequestUrl) {
			return;
		}
		void this._gitStateService.setSessionGitHubState(sessionKey, {
			pullRequestState: state,
			pullRequestStateUrl: pullRequestUrl,
		}).catch(error => this._logService.warn(`[AgentHostPullRequestStatusService] Failed to publish pull request state: session=${sessionKey}, pr=${pullRequestUrl}, state=${state}, error=${error}`));
	}

	private _stopWatch(sessionKey: string, reason?: string): void {
		const watch = this._watches.get(sessionKey);
		if (!watch) {
			return;
		}
		this._watches.delete(sessionKey);
		watch.dispose();
		this._logService.debug(`[AgentHostPullRequestStatusService] Stopped watching pull request: session=${sessionKey}, pr=${describeRef(watch.ref)}, reason=${reason ?? 'session removed'}`);
		this._onDidChangePullRequestStatus.fire(sessionKey);
	}
}

function describeRef(ref: PullRequestRef): string {
	return `${ref.owner}/${ref.repo}#${ref.number}`;
}

function describeStatus(status: IAgentHostPullRequestStatus | undefined): string {
	if (!status) {
		return 'unresolved';
	}
	return [
		`state=${status.state}`,
		`draft=${status.draft}`,
		`mergeReady=${status.mergeReady}`,
		`agentMergeReadyForReview=${status.agentMergeReadyForReview ?? 'unknown'}`,
		`autoMergeEnabled=${status.autoMergeEnabled}`,
		`canEnableAutoMerge=${status.viewerCanEnableAutoMerge}`,
		`allowedMergeMethods=${status.allowedMergeMethods.join('|') || 'none'}`,
	].join(', ');
}

function toPullRequestStatus(snapshot: PullRequestSnapshot, agentMergeCommentWatermark?: string): IAgentHostPullRequestStatus | undefined {
	const core = snapshot.core.value;
	if (!core) {
		return undefined;
	}

	if (core.state !== 'open') {
		return {
			...(core.id ? { pullRequestId: core.id } : {}),
			number: core.number,
			url: core.url,
			headSha: core.headSha,
			state: core.state,
			draft: core.draft,
			mergeReady: false,
			viewerCanEnableAutoMerge: false,
			autoMergeEnabled: false,
			allowedMergeMethods: [],
		};
	}

	const mergeability = snapshot.mergeability.value;
	if (!mergeability || snapshot.mergeability.headSha !== core.headSha) {
		return undefined;
	}
	const agentMergeReadyForReview = agentMergeCommentWatermark !== undefined
		? isAgentMergePullRequestReadyForReview(snapshot, agentMergeCommentWatermark)
		: undefined;

	return {
		...(core.id ? { pullRequestId: core.id } : {}),
		number: core.number,
		url: core.url,
		headSha: core.headSha,
		state: core.state,
		draft: core.draft,
		mergeReady: !core.draft
			&& mergeability.mergeable === 'MERGEABLE'
			&& mergeability.viewerCanMerge
			&& MERGEABLE_STATES.has(mergeability.mergeStateStatus?.toUpperCase() ?? 'CLEAN'),
		...(agentMergeReadyForReview !== undefined ? { agentMergeReadyForReview } : {}),
		viewerCanEnableAutoMerge: mergeability.viewerCanEnableAutoMerge,
		autoMergeEnabled: mergeability.autoMergeEnabled,
		allowedMergeMethods: mergeability.allowedMergeMethods,
	};
}

function sameRef(left: { readonly owner: string; readonly repo: string; readonly number: number }, right: { readonly owner: string; readonly repo: string; readonly number: number }): boolean {
	return left.owner.toLowerCase() === right.owner.toLowerCase()
		&& left.repo.toLowerCase() === right.repo.toLowerCase()
		&& left.number === right.number;
}

type ParsedPullRequestUrl = NonNullable<ReturnType<typeof parsePullRequestUrl>>;

function sameParsedRef(left: ParsedPullRequestUrl, right: ParsedPullRequestUrl): boolean {
	return left.apiHost.toLowerCase() === right.apiHost.toLowerCase() && sameRef(left, right);
}

function sameRefAndHost(left: PullRequestRef, right: ParsedPullRequestUrl): boolean {
	return left.host.toLowerCase() === right.apiHost.toLowerCase() && sameRef(left, right);
}

function sameAccount(left: GitHubAccountHandle, right: GitHubAccountHandle): boolean {
	return left.host.toLowerCase() === right.host.toLowerCase() && left.accountId === right.accountId;
}
