/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { equals } from '../../../base/common/objects.js';
import { ILogService } from '../../log/common/log.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { TelemetryLevel } from '../../telemetry/common/telemetry.js';
import { ActionType, ActionEnvelope, ActionOrigin, INotification, IRootConfigChangedAction, SessionAction, ChatAction, RootAction, StateAction, TerminalAction, ChangesetAction, ClientChangesetAction, AnnotationsAction, ClientAnnotationsAction, isRootAction, isSessionAction, isChatAction, isChangesetAction, isAnnotationsAction, isAutomationAction, isAutomationRunAction, isPassiveSessionMetadataAction, type AuthRequiredParams, type ClientAutomationAction, type ClientAutomationRunAction, type ProgressParams, type SessionSummaryChangedParams, type SessionSummaryChanges } from '../common/state/sessionActions.js';
import type { IStateSnapshot } from '../common/state/sessionProtocol.js';
import { rootReducer, sessionReducer, chatReducer, changesetReducer, annotationsReducer, automationReducer, automationRunReducer } from '../common/state/sessionReducers.js';
import { createRootState, createSessionState, createChatState, createDefaultChatSummary, chatSummaryFromState, buildDefaultChatUri, parseDefaultChatUri, parseRequiredSessionUriFromChatUri, parseSubagentSessionUri, isAhpChatChannel, isAhpAutomationCatalogChannel, isAhpAutomationRunChannel, isDefaultChatUri, mergeSessionWithDefaultChat, isAhpRootChannel, readSessionExternal, SessionLifecycle, withHostBuildInfo, withSessionStatusFlag, type AutomationState, type AutomationRunState, type Changeset, type ChangesetState, type AnnotationsState, type ChatState, type ChatSummary, type Customization, type ISessionWithDefaultChat, type Message, type RootState, type SessionConfigState, type SessionMeta, type SessionState, type SessionSummary, type Turn, type URI, ROOT_STATE_URI, ChangesetStatus, IHostBuildInfo, SessionStatus } from '../common/state/sessionState.js';
import { AgentHostTelemetryLevelConfigKey, IPermissionsValue, platformRootSchema, telemetryLevelToAgentHostConfigValue } from '../common/agentHostSchema.js';
import { SessionConfigKey } from '../common/sessionConfigKeys.js';
import { parseChangesetUri } from '../common/changesetUri.js';
import { buildAnnotationsUri, isAnnotationsUri, parseAnnotationsUri } from '../common/annotationsUri.js';
import { AgentHostChangesetStateCache, type IAgentHostChangesetStateRetentionOptions } from './agentHostChangesetStateCache.js';
import { ChangesSummary, ChatInteractivity, type ChatOrigin } from '../common/state/protocol/state.js';
import { arrayEquals, structuralEquals } from '../../../base/common/equals.js';
import { preserveProviderBackedRootConfigValues } from '../common/agentCustomizationSettings.js';
import type { IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { readEphemeralSessionMeta } from '../common/meta/agentEphemeralSessionMeta.js';
import { type IChatSurfaceMeta, readChatSurfaceMeta } from '../common/meta/agentChatSurfaceMeta.js';

export interface IAgentHostStateManagerOptions {
	readonly changesetStateRetention?: IAgentHostChangesetStateRetentionOptions;
	readonly hostBuildInfo?: IHostBuildInfo;
}

const enum SessionUse {
	UnusedDraft,
	Used,
}

interface ISessionEntry {
	state: SessionState;
	readonly createdAt: string;
	modifiedAt: string;
	project?: SessionSummary['project'];
	changes?: ChangesSummary;
	use: SessionUse;
}

interface IRestoredChatState {
	readonly turns: Turn[];
	readonly draft?: Message;
}

type RestoredChatResolver = (providerData: string | undefined) => Promise<IRestoredChatState>;

interface IChatEntry {
	readonly session: string;
	summary: ChatSummary;
	state?: ChatState;
	providerData?: string;
	inheritedTurnId?: string;
	draft?: Message;
	resolver?: RestoredChatResolver;
	inFlight?: Promise<ChatState | undefined>;
	valid: boolean;
}

class SessionSummaryNotifier extends Disposable {

	private readonly _lastNotified = new Map<string, SessionSummary>();

	private readonly _dirty = new Set<string>();

	private readonly _scheduler = this._register(new RunOnceScheduler(() => this._flushAll(), 100));

	constructor(
		private readonly _getSummary: (session: string) => SessionSummary | undefined,
		private readonly _emit: (session: string, changes: SessionSummaryChanges) => void,
	) {
		super();
	}

	announce(session: string, summary: SessionSummary): void {
		this._lastNotified.set(session, summary);
	}

	applyAnnouncedChanges(session: string, changes: Partial<SessionSummary>): boolean {
		const lastNotified = this._lastNotified.get(session);
		if (!lastNotified) {
			return false;
		}
		this._lastNotified.set(session, { ...lastNotified, ...changes });
		this._emit(session, changes);
		return true;
	}

	isAnnounced(session: string): boolean {
		return this._lastNotified.has(session);
	}

	getAnnounced(session: string): SessionSummary | undefined {
		return this._lastNotified.get(session);
	}

	markDirty(session: string): void {
		this._dirty.add(session);
		this._scheduler.schedule();
	}

	isDirty(session: string): boolean {
		return this._dirty.has(session);
	}

	clearDirty(session: string): void {
		this._dirty.delete(session);
	}

	remove(session: string): void {
		this._lastNotified.delete(session);
		this._dirty.delete(session);
	}

	private _flushAll(): void {
		for (const session of this._dirty) {
			this.flush(session);
		}
		this._dirty.clear();
	}

	flush(session: string): void {
		const current = this._getSummary(session);
		const lastNotified = this._lastNotified.get(session);
		if (!current || !lastNotified) {
			return;
		}

		const changes: SessionSummaryChanges = {};
		if (current.title !== lastNotified.title) { changes.title = current.title; }
		if (current.status !== lastNotified.status) { changes.status = current.status; }
		if (current.activity !== lastNotified.activity) { changes.activity = current.activity ?? null; }
		if (current.modifiedAt !== lastNotified.modifiedAt) { changes.modifiedAt = current.modifiedAt; }
		if (current.project !== lastNotified.project) { changes.project = current.project; }
		if (current.changes !== lastNotified.changes) { changes.changes = current.changes; }
		if (current.workingDirectories !== lastNotified.workingDirectories) { changes.workingDirectories = current.workingDirectories; }
		if (current._meta !== lastNotified._meta) { changes._meta = current._meta; }

		this._lastNotified.set(session, current);

		if (Object.keys(changes).length > 0) {
			this._emit(session, changes);
		}
	}
}

export const IAgentHostStateManager = createDecorator<AgentHostStateManager>('agentHostStateManager');

export class AgentHostStateManager extends Disposable {
	declare readonly _serviceBrand: undefined;

	private _serverSeq = 0;

	private _rootState: RootState;

	private readonly _sessionStates = new Map<string, ISessionEntry>();

	private readonly _chatEntries = new Map<string, IChatEntry>();

	private readonly _changesets: AgentHostChangesetStateCache;

	private readonly _annotations = new Map<string, AnnotationsState>();
	private _automationCatalog: AutomationState | undefined;
	private readonly _automationRuns = new Map<string, AutomationRunState>();

	private readonly _sessionsWithActiveTurn = new Map<string, Set<string>>();

	private readonly _summaryNotifier: SessionSummaryNotifier;
	private readonly _publishedSessionSummaries = new Set<string>();
	private readonly _addedSessionSummaries = new Set<string>();

	private readonly _onDidEmitEnvelope = this._register(new Emitter<ActionEnvelope>());
	readonly onDidEmitEnvelope: Event<ActionEnvelope> = this._onDidEmitEnvelope.event;

	private readonly _onDidEmitNotification = this._register(new Emitter<INotification>());
	readonly onDidEmitNotification: Event<INotification> = this._onDidEmitNotification.event;
	private readonly _onDidChangeSessionActiveTurn = this._register(new Emitter<{ session: string; active: boolean }>());
	readonly onDidChangeSessionActiveTurn: Event<{ session: string; active: boolean }> = this._onDidChangeSessionActiveTurn.event;
	private readonly _onDidChangeSessionStatus = this._register(new Emitter<{ session: string; status: SessionStatus }>());
	readonly onDidChangeSessionStatus: Event<{ session: string; status: SessionStatus }> = this._onDidChangeSessionStatus.event;
	private readonly _onDidRemoveSession = this._register(new Emitter<string>());
	readonly onDidRemoveSession: Event<string> = this._onDidRemoveSession.event;

	private readonly _onDidChangeSessionTitle = this._register(new Emitter<{ session: string; title: string }>());
	readonly onDidChangeSessionTitle: Event<{ session: string; title: string }> = this._onDidChangeSessionTitle.event;
	private readonly _onDidSnapshotDefaultChatTitle = this._register(new Emitter<{ session: string; chat: string; title: string }>());
	readonly onDidSnapshotDefaultChatTitle: Event<{ session: string; chat: string; title: string }> = this._onDidSnapshotDefaultChatTitle.event;

	private readonly _onDidChangeSessionConfig = this._register(new Emitter<{ session: URI; previous: SessionConfigState | undefined; current: SessionConfigState | undefined; clientContext?: IAgentHostClientTelemetryContext }>());
	readonly onDidChangeSessionConfig: Event<{ session: URI; previous: SessionConfigState | undefined; current: SessionConfigState | undefined; clientContext?: IAgentHostClientTelemetryContext }> = this._onDidChangeSessionConfig.event;

	private readonly _onDidChangeSessionWorkingDirectories = this._register(new Emitter<{ session: string }>());
	readonly onDidChangeSessionWorkingDirectories: Event<{ session: string }> = this._onDidChangeSessionWorkingDirectories.event;
	private readonly _onDidChangeSessionSummary = this._register(new Emitter<{ session: string; changes: SessionSummaryChangedParams['changes'] }>());
	readonly onDidChangeSessionSummary: Event<{ session: string; changes: SessionSummaryChangedParams['changes'] }> = this._onDidChangeSessionSummary.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
		options: IAgentHostStateManagerOptions = {},
	) {
		super();
		this._changesets = new AgentHostChangesetStateCache(options.changesetStateRetention);
		this._rootState = createRootState();
		this._rootState = {
			...this._rootState,
			config: {
				schema: platformRootSchema.toProtocol(),
				values: platformRootSchema.validateOrDefault({}, {
					[SessionConfigKey.Permissions]: { allow: [], deny: [] } satisfies IPermissionsValue,
					[AgentHostTelemetryLevelConfigKey]: telemetryLevelToAgentHostConfigValue(TelemetryLevel.USAGE),
				}),
			},
			_meta: withHostBuildInfo(this._rootState._meta, options.hostBuildInfo),
		};
		this._summaryNotifier = this._register(new SessionSummaryNotifier(
			session => {
				const entry = this._sessionStates.get(session);
				return entry ? this._toSummary(session, entry) : undefined;
			},
			(session, changes) => this._emitSessionSummaryChanged(session, changes),
		));
	}

	private _emitSessionSummaryChanged(session: string, changes: SessionSummaryChangedParams['changes']): void {
		this._onDidChangeSessionSummary.fire({ session, changes });
		if (this._publishedSessionSummaries.has(session)) {
			this._onDidEmitNotification.fire({
				type: 'root/sessionSummaryChanged',
				channel: ROOT_STATE_URI,
				session,
				changes,
			});
		}
	}

	private _emitSessionAdded(summary: SessionSummary): void {
		if (readEphemeralSessionMeta(summary).isEphemeral) {
			return;
		}
		this._summaryNotifier.announce(summary.resource, summary);
		this._publishedSessionSummaries.add(summary.resource);
		this._addedSessionSummaries.add(summary.resource);
		this._onDidEmitNotification.fire({
			type: 'root/sessionAdded',
			channel: ROOT_STATE_URI,
			summary,
		});
	}

	private readonly _log = (msg: string) => this._logService.warn(`[AgentHostStateManager] ${msg}`);

	get hasActiveSessions(): boolean {
		return this._sessionsWithActiveTurn.size > 0;
	}

	hasActiveTurn(sessionKey: string): boolean {
		return this._sessionsWithActiveTurn.has(sessionKey);
	}


	get rootState(): RootState {
		return this._rootState;
	}

	getSessionState(sessionOrChat: URI): ISessionWithDefaultChat | undefined {
		const isChat = isAhpChatChannel(sessionOrChat);
		const session = this._resolveOwningSession(sessionOrChat);
		if (session === undefined) {
			return undefined;
		}
		const entry = this._sessionStates.get(session);
		if (!entry) {
			return undefined;
		}
		const chatUri = isChat ? sessionOrChat : buildDefaultChatUri(session);
		return mergeSessionWithDefaultChat(entry.state, this._chatEntries.get(chatUri)?.state);
	}

	isUnusedDraft(sessionOrChat: URI): boolean | undefined {
		const session = this._resolveOwningSession(sessionOrChat);
		if (session === undefined) {
			return undefined;
		}
		const entry = this._sessionStates.get(session);
		return entry && entry.use === SessionUse.UnusedDraft;
	}

	private _markSessionUsed(session: URI): void {
		const entry = this._sessionStates.get(session);
		if (entry) {
			entry.use = SessionUse.Used;
		}
	}

	private _resolveOwningSession(sessionOrChat: URI): URI | undefined {
		return isAhpChatChannel(sessionOrChat) ? parseDefaultChatUri(sessionOrChat) : sessionOrChat;
	}

	getSessionSummary(session: URI): SessionSummary | undefined {
		const entry = this._sessionStates.get(session);
		return entry ? this._toSummary(session, entry) : undefined;
	}

	getSurfacedSessionSummary(session: string): SessionSummary | undefined {
		return this._sessionStates.has(session) ? undefined : this._summaryNotifier.getAnnounced(session);
	}

	private _toSummary(session: string, entry: ISessionEntry): SessionSummary {
		const { state } = entry;
		const summary: SessionSummary = {
			resource: session,
			provider: state.provider,
			title: state.title,
			status: state.status,
			createdAt: entry.createdAt,
			modifiedAt: entry.modifiedAt,
		};
		if (state.activity !== undefined) { summary.activity = state.activity; }
		if (entry.project !== undefined) { summary.project = entry.project; }
		if (state.workingDirectories !== undefined) { summary.workingDirectories = state.workingDirectories; }
		if (state.annotations !== undefined) { summary.annotations = state.annotations; }
		if (entry.changes !== undefined) { summary.changes = entry.changes; }
		if (state._meta !== undefined) { summary._meta = state._meta; }
		return summary;
	}

	private _summaryFieldsEqual(a: SessionState, b: SessionState): boolean {
		return a.title === b.title
			&& a.status === b.status
			&& a.activity === b.activity
			&& a.project === b.project
			&& a.workingDirectories === b.workingDirectories
			&& a.annotations === b.annotations
			&& a._meta === b._meta;
	}

	getDefaultChatState(session: URI): ChatState | undefined {
		return this._chatEntries.get(buildDefaultChatUri(session))?.state;
	}

	getChatState(chat: URI): ChatState | undefined {
		return this._chatEntries.get(chat)?.state;
	}

	getChatOrigin(chat: URI): ChatOrigin | undefined {
		return this._chatEntries.get(chat)?.summary.origin;
	}

	getChatInheritedTurnId(chat: URI): string | undefined {
		return this._chatEntries.get(chat)?.inheritedTurnId;
	}

	resolveChatState(chat: URI): Promise<ChatState | undefined> {
		const entry = this._chatEntries.get(chat);
		if (!entry || !entry.valid) {
			return Promise.resolve(undefined);
		}
		if (entry.state) {
			return Promise.resolve(entry.state);
		}
		if (!entry.resolver) {
			return Promise.resolve(undefined);
		}
		if (entry.inFlight) {
			return entry.inFlight;
		}

		const inFlight = (async () => {
			const restored = await entry.resolver!(entry.providerData);
			if (!entry.valid || this._chatEntries.get(chat) !== entry) {
				throw new Error(`Restored chat was invalidated while resolving: ${chat}`);
			}
			if (!entry.state) {
				entry.state = { ...createChatState(entry.summary), turns: restored.turns, draft: restored.draft ?? entry.draft };
				entry.resolver = undefined;
				if (restored.turns.length > 0) {
					this._markSessionUsed(entry.session);
				}
			}
			return entry.state;
		})();
		entry.inFlight = inFlight;
		void inFlight.then(
			() => {
				if (entry.inFlight === inFlight) {
					entry.inFlight = undefined;
				}
			},
			() => {
				if (entry.inFlight === inFlight) {
					entry.inFlight = undefined;
				}
			},
		);
		return inFlight;
	}

	updateChatProviderData(chat: URI, providerData: string | undefined): void {
		const entry = this._chatEntries.get(chat);
		if (entry) {
			entry.providerData = providerData;
		}
	}

	seedDefaultChatTurns(session: URI, turns: Turn[]): void {
		const chatState = this._chatEntries.get(buildDefaultChatUri(session))?.state;
		if (chatState) {
			chatState.turns = turns;
		}
		if (turns.length > 0) {
			this._markSessionUsed(session);
		}
	}

	get serverSeq(): number {
		return this._serverSeq;
	}

	getSessionUris(): string[] {
		return [...this._sessionStates.keys()];
	}

	getOverlaySessionSummaries(): SessionSummary[] {
		const summaries: SessionSummary[] = [];
		for (const [key, entry] of this._sessionStates) {
			if (this._isIdleProvisional(key, entry.state.lifecycle) || this.isEphemeralSession(key)) {
				continue;
			}
			summaries.push(this._toSummary(key, entry));
		}
		return summaries;
	}

	isIdleProvisionalSession(session: string): boolean {
		const entry = this._sessionStates.get(session);
		return entry ? this._isIdleProvisional(session, entry.state.lifecycle) : false;
	}

	isEphemeralSession(session: string): boolean {
		const entry = this._sessionStates.get(session);
		return entry ? readEphemeralSessionMeta(entry.state).isEphemeral === true : false;
	}

	getSessionSurfaceMeta(session: string): IChatSurfaceMeta | undefined {
		const entry = this._sessionStates.get(session);
		return entry ? readChatSurfaceMeta(entry.state) : undefined;
	}

	private _isIdleProvisional(session: string, lifecycle: SessionLifecycle): boolean {
		const chat = this._chatEntries.get(buildDefaultChatUri(session))?.state;
		return lifecycle === SessionLifecycle.Creating && !chat?.activeTurn && (chat?.turns.length ?? 0) === 0;
	}

	getSessionUrisWithPrefix(prefix: string): string[] {
		const result: string[] = [];
		for (const key of this._sessionStates.keys()) {
			if (key.startsWith(prefix)) {
				result.push(key);
			}
		}
		return result;
	}


	getSnapshot(resource: URI): IStateSnapshot | undefined {
		if (isAhpRootChannel(resource)) {
			return {
				resource: ROOT_STATE_URI,
				state: this._rootState,
				fromSeq: this._serverSeq,
			};
		}

		if (isAhpAutomationCatalogChannel(resource)) {
			if (!this._automationCatalog) {
				return undefined;
			}
			return {
				resource,
				state: this._automationCatalog,
				fromSeq: this._serverSeq,
			};
		}

		if (isAhpAutomationRunChannel(resource)) {
			const state = this._automationRuns.get(resource);
			if (!state) {
				return undefined;
			}
			return {
				resource,
				state,
				fromSeq: this._serverSeq,
			};
		}

		const changesetState = this._changesets.get(resource);
		if (changesetState) {
			return {
				resource,
				state: changesetState,
				fromSeq: this._serverSeq,
			};
		}

		if (isAhpChatChannel(resource)) {
			const chatState = this._chatEntries.get(resource)?.state;
			if (!chatState) {
				return undefined;
			}
			return {
				resource,
				state: chatState,
				fromSeq: this._serverSeq,
			};
		}

		if (isAnnotationsUri(resource)) {
			return {
				resource,
				state: this._annotations.get(resource) ?? { annotations: [] },
				fromSeq: this._serverSeq,
			};
		}

		const entry = this._sessionStates.get(resource);
		if (!entry) {
			return undefined;
		}

		return {
			resource,
			state: entry.state,
			fromSeq: this._serverSeq,
		};
	}

	setAutomationCatalogState(state: AutomationState): void {
		this._automationCatalog = state;
	}

	getAutomationCatalogState(): AutomationState | undefined {
		return this._automationCatalog;
	}

	setAutomationRunState(state: AutomationRunState): void {
		this._automationRuns.set(state.resource, state);
	}

	getAutomationRunState(resource: string): AutomationRunState | undefined {
		return this._automationRuns.get(resource);
	}

	getChangesetState(changeset: URI): ChangesetState | undefined {
		return this._changesets.get(changeset);
	}

	onChangesetLivenessChanged(): void {
		this._changesets.trimEvictableEntries();
	}


	createSession(summary: SessionSummary, options?: { readonly emitNotification?: boolean }): SessionState {
		const key = summary.resource;
		const existing = this._sessionStates.get(key);
		if (existing) {
			this._logService.warn(`[AgentHostStateManager] Session already exists: ${key}`);
			return existing.state;
		}

		const state = createSessionState(summary);
		this._sessionStates.set(key, this._newEntry(state, summary, SessionUse.UnusedDraft));
		this._ensureDefaultChat(key, summary);

		this._logService.trace(`[AgentHostStateManager] Created session: ${key}`);

		if (options?.emitNotification !== false) {
			this._emitSessionAdded(summary);
		}

		return state;
	}

	private _newEntry(state: SessionState, summary: SessionSummary, use: SessionUse): ISessionEntry {
		return { state, createdAt: summary.createdAt, modifiedAt: summary.modifiedAt, project: summary.project, changes: summary.changes, use };
	}

	markSessionPersisted(session: URI, summary: SessionSummary, force = false): void {
		const key = session.toString();
		const entry = this._sessionStates.get(key);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] markSessionPersisted: unknown session ${key}`);
			return;
		}
		if (!force && this._addedSessionSummaries.has(key)) {
			return;
		}
		entry.state = { ...entry.state, workingDirectories: summary.workingDirectories };
		entry.project = summary.project;
		entry.modifiedAt = summary.modifiedAt;
		entry.changes = summary.changes;
		const full = this._toSummary(key, entry);
		this._emitSessionAdded(full);
	}

	announceSurfacedSession(summary: SessionSummary): void {
		const key = summary.resource;
		if (this._sessionStates.has(key)) {
			this._logService.trace(`[AgentHostStateManager] announceSurfacedSession: already in state ${key}`);
			return;
		}
		if (this._addedSessionSummaries.has(key)) {
			this._logService.trace(`[AgentHostStateManager] announceSurfacedSession: already added ${key}`);
			return;
		}
		this._emitSessionAdded(summary);
	}

	updateSurfacedSessionTitle(session: string, title: string): void {
		const announced = this._summaryNotifier.getAnnounced(session);
		if (this._sessionStates.has(session) || !announced || announced.title === title) {
			return;
		}
		this._summaryNotifier.announce(session, { ...announced, title });
		this._emitSessionSummaryChanged(session, { title });
	}

	retractSurfacedSession(session: string): void {
		if (this._sessionStates.has(session)) {
			return;
		}
		const wasPublished = this._publishedSessionSummaries.delete(session);
		const wasAdded = this._addedSessionSummaries.delete(session);
		if (!wasPublished && !wasAdded) {
			return;
		}
		this._summaryNotifier.remove(session);
		this._onDidEmitNotification.fire({
			type: 'root/sessionRemoved',
			channel: ROOT_STATE_URI,
			session,
		});
	}

	setSurfacedSessionStatusFlag(session: string, flag: SessionStatus, set: boolean): void {
		if (this._sessionStates.has(session)) {
			return;
		}
		const announced = this._summaryNotifier.getAnnounced(session);
		if (!announced) {
			return;
		}
		const status = withSessionStatusFlag(announced.status, flag, set);
		if (status === announced.status) {
			return;
		}
		this._summaryNotifier.applyAnnouncedChanges(session, { status });
	}

	setSessionSummaryPublished(session: string, published: boolean): void {
		if (published) {
			if (this._addedSessionSummaries.has(session)) {
				return;
			}
			const entry = this._sessionStates.get(session);
			if (!entry) {
				return;
			}
			const summary = this._toSummary(session, entry);
			this._emitSessionAdded(summary);
		} else {
			const wasPublished = this._publishedSessionSummaries.delete(session);
			const wasAdded = this._addedSessionSummaries.delete(session);
			if (!wasPublished && !wasAdded) {
				return;
			}
			this._summaryNotifier.remove(session);
			this._onDidEmitNotification.fire({
				type: 'root/sessionRemoved',
				channel: ROOT_STATE_URI,
				session,
			});
		}
	}

	prepareSessionSummariesForListing(summaries: readonly SessionSummary[]): SessionSummary[] {
		const result: SessionSummary[] = [];
		for (const summary of summaries) {
			const wasPublished = this._publishedSessionSummaries.has(summary.resource);
			if (wasPublished) {
				if (this._summaryNotifier.isDirty(summary.resource)) {
					this._summaryNotifier.flush(summary.resource);
				}
			}

			const entry = this._sessionStates.get(summary.resource);
			const current = entry ? this._toSummary(summary.resource, entry) : summary;
			if (!wasPublished) {
				this._summaryNotifier.announce(summary.resource, current);
				this._publishedSessionSummaries.add(summary.resource);
			}
			result.push(entry ? this._mergeLiveSummaryForListing(summary, current) : summary);
		}
		return result;
	}

	private _mergeLiveSummaryForListing(listed: SessionSummary, current: SessionSummary): SessionSummary {
		const meta = listed._meta !== undefined || current._meta !== undefined
			? { ...listed._meta, ...current._meta }
			: undefined;
		return {
			...listed,
			title: current.title || listed.title,
			status: current.status,
			activity: current.activity,
			modifiedAt: current.modifiedAt,
			project: current.project ?? listed.project,
			workingDirectories: current.workingDirectories ?? listed.workingDirectories,
			changes: current.changes ?? listed.changes,
			...(meta !== undefined ? { _meta: meta } : {}),
		};
	}

	/** Returns external sessions exposed through either listing or global add notification. */
	getExposedExternalSessionKeys(): string[] {
		const result: string[] = [];
		for (const session of this._publishedSessionSummaries) {
			const entry = this._sessionStates.get(session);
			const summary = entry ? this._toSummary(session, entry) : this._summaryNotifier.getAnnounced(session);
			if (readSessionExternal(summary?._meta)) {
				result.push(session);
			}
		}
		return result;
	}

	restoreSession(summary: SessionSummary, turns: Turn[], options?: { readonly draft?: Message; readonly defaultChatTitle?: string }): SessionState {
		const key = summary.resource;
		const existing = this._sessionStates.get(key);
		if (existing) {
			this._logService.warn(`[AgentHostStateManager] Session already exists (restore): ${key}`);
			return existing.state;
		}

		const state: SessionState = {
			...createSessionState(summary),
			lifecycle: SessionLifecycle.Ready,
		};
		this._sessionStates.set(key, this._newEntry(state, summary, SessionUse.Used));
		this._ensureDefaultChat(key, summary, turns, options?.draft, options?.defaultChatTitle);
		if (this._summaryNotifier.isAnnounced(key)) {
			this._summaryNotifier.flush(key);
		} else {
			this._summaryNotifier.announce(key, summary);
		}

		this._logService.trace(`[AgentHostStateManager] Restored session: ${key} (${turns.length} turns)`);

		return state;
	}

	private _ensureDefaultChat(sessionKey: string, summary: SessionSummary, turns?: Turn[], draft?: Message, defaultChatTitle?: string): void {
		const chatUri = buildDefaultChatUri(sessionKey);
		const chatSummary: ChatSummary = { ...createDefaultChatSummary(summary, chatUri), title: defaultChatTitle ?? '' };
		this._chatEntries.set(chatUri, {
			session: sessionKey,
			summary: chatSummary,
			state: { ...createChatState(chatSummary), turns: turns ?? [], draft },
			valid: true,
		});
		const entry = this._sessionStates.get(sessionKey);
		if (entry) {
			entry.state.chats = [chatSummary];
			entry.state.defaultChat = chatUri;
		}
	}

	addChat(session: URI, chatUri: URI, options?: { readonly title?: string; readonly turns?: Turn[]; readonly origin?: ChatOrigin; readonly providerData?: string; readonly inheritedTurnId?: string; readonly interactivity?: ChatInteractivity }): ChatSummary | undefined {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] addChat for unknown session: ${session}`);
			return undefined;
		}
		const sessionState = entry.state;
		const existing = sessionState.chats.find(c => c.resource === chatUri);
		if (existing) {
			return existing;
		}

		this._snapshotDefaultChatTitle(session, sessionState);

		const chatSummary: ChatSummary = {
			...createDefaultChatSummary(this._toSummary(session, entry), chatUri),
			title: options?.title ?? '',
			status: SessionStatus.Idle,
			...(options?.origin ? { origin: options.origin } : {}),
			interactivity: options?.interactivity,
		};
		this._chatEntries.set(chatUri, {
			session,
			summary: chatSummary,
			state: { ...createChatState(chatSummary), turns: options?.turns ?? [] },
			providerData: options?.providerData,
			inheritedTurnId: options?.inheritedTurnId,
			valid: true,
		});
		this.dispatchServerAction(session, { type: ActionType.SessionChatAdded, summary: chatSummary });
		return chatSummary;
	}

	registerRestoredChatSummary(session: URI, chatUri: URI, options: { readonly title?: string; readonly origin?: ChatOrigin; readonly interactivity?: ChatInteractivity; readonly draft?: Message; readonly providerData?: string; readonly inheritedTurnId?: string; readonly resolver?: RestoredChatResolver }): ChatSummary | undefined {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] registerRestoredChatSummary for unknown session: ${session}`);
			return undefined;
		}
		const sessionState = entry.state;
		const existing = sessionState.chats.find(c => c.resource === chatUri);
		if (existing) {
			const existingEntry = this._chatEntries.get(chatUri);
			if (existingEntry && !existingEntry.state && options.resolver) {
				existingEntry.providerData = options.providerData;
				existingEntry.inheritedTurnId = options.inheritedTurnId;
				existingEntry.draft = options.draft;
				existingEntry.resolver = options.resolver;
			}
			return existing;
		}
		this._snapshotDefaultChatTitle(session, sessionState);
		const chatSummary: ChatSummary = {
			...createDefaultChatSummary(this._toSummary(session, entry), chatUri),
			title: options.title ?? '',
			status: SessionStatus.Idle,
			...(options.origin ? { origin: options.origin } : {}),
			interactivity: options.interactivity,
		};
		entry.state.chats = [...entry.state.chats, chatSummary];
		this._chatEntries.set(chatUri, {
			session,
			summary: chatSummary,
			providerData: options.providerData,
			inheritedTurnId: options.inheritedTurnId,
			draft: options.draft,
			resolver: options.resolver,
			valid: true,
		});
		return chatSummary;
	}

	private _snapshotDefaultChatTitle(session: URI, state: SessionState): void {
		const defaultChat = buildDefaultChatUri(session);
		const summary = state.chats.find(chat => chat.resource === defaultChat);
		if (summary && !summary.title && state.title) {
			this.updateChatTitle(session, defaultChat, state.title);
			this._onDidSnapshotDefaultChatTitle.fire({ session, chat: defaultChat, title: state.title });
		}
	}

	removeChat(session: URI, chatUri: URI): void {
		const entry = this._sessionStates.get(session);
		if (!entry || !entry.state.chats.some(c => c.resource === chatUri)) {
			return;
		}
		const sessionState = entry.state;
		if (chatUri === sessionState.defaultChat || isDefaultChatUri(chatUri)) {
			this._logService.warn(`[AgentHostStateManager] refusing to remove default chat: ${chatUri}`);
			return;
		}
		this._removeChatActiveTurn(session, chatUri);
		this._invalidateChatEntry(chatUri);
		this.dispatchServerAction(session, { type: ActionType.SessionChatRemoved, chat: chatUri });
	}

	invalidateSessionChatResolutions(session: URI): void {
		for (const entry of this._chatEntries.values()) {
			if (entry.session === session) {
				entry.valid = false;
			}
		}
	}

	updateChatTitle(session: URI, chatUri: URI, title: string): void {
		const chatState = this._chatEntries.get(chatUri)?.state;
		if (chatState) {
			const entry = this._chatEntries.get(chatUri)!;
			entry.state = { ...chatState, title };
		}
		this.dispatchServerAction(session, { type: ActionType.SessionChatUpdated, chat: chatUri, changes: { title } });
	}

	removeSession(session: URI): void {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			return;
		}
		this.invalidateSessionChatResolutions(session);

		if (this._summaryNotifier.isDirty(session)) {
			this._summaryNotifier.flush(session);
		}

		if (this._sessionsWithActiveTurn.delete(session)) {
			this._onDidChangeSessionActiveTurn.fire({ session, active: false });
			this.dispatchServerAction(ROOT_STATE_URI, { type: ActionType.RootActiveSessionsChanged, activeSessions: this._sessionsWithActiveTurn.size });
		}

		for (const chat of entry.state.chats) {
			this._invalidateChatEntry(chat.resource);
		}
		this._invalidateChatEntry(buildDefaultChatUri(session));
		this._sessionStates.delete(session);
		this._onDidRemoveSession.fire(session);
		this._summaryNotifier.clearDirty(session);
		this._logService.trace(`[AgentHostStateManager] Removed session: ${session}`);
	}

	deleteSession(session: URI): void {
		const wasPublished = this._publishedSessionSummaries.has(session.toString());
		this._summaryNotifier.clearDirty(session);
		this.disposeSessionChangesets(session);
		this.disposeSessionAnnotations(session);
		this.removeSession(session);
		this._summaryNotifier.remove(session.toString());
		if (wasPublished) {
			this._publishedSessionSummaries.delete(session.toString());
			this._addedSessionSummaries.delete(session.toString());
			this._onDidEmitNotification.fire({
				type: 'root/sessionRemoved',
				channel: ROOT_STATE_URI,
				session,
			});
		}
	}


	setSessionMeta(session: URI, meta: SessionMeta | undefined): void {
		this.dispatchServerAction(session, { type: ActionType.SessionMetaChanged, _meta: meta });
	}

	setSessionProject(session: URI, project: SessionSummary['project']): void {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] setSessionProject: unknown session ${session}`);
			return;
		}
		if (equals(entry.project, project)) {
			return;
		}
		entry.project = project;
		this._summaryNotifier.markDirty(session);
	}

	setSessionConfig(session: URI, config: SessionConfigState | undefined): void {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] setSessionConfig: unknown session ${session}`);
			return;
		}
		entry.state.config = config;
	}

	setSessionCustomizations(session: URI, customizations: readonly Customization[] | undefined): void {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] setSessionCustomizations: unknown session ${session}`);
			return;
		}
		entry.state.customizations = customizations ? [...customizations] : undefined;
	}


	registerChangeset(changesetUri: URI, initialStatus: ChangesetStatus = ChangesetStatus.Computing): URI {
		this._changesets.register(changesetUri, initialStatus);
		return changesetUri;
	}

	setSessionSummaryChanges(session: URI, changes: ChangesSummary | undefined): void {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] setSessionSummaryChanges: unknown session ${session}`);
			return;
		}
		if (structuralEquals(entry.changes, changes)) {
			return;
		}

		entry.changes = changes;

		this._summaryNotifier.markDirty(session);
	}

	setSessionChangesets(session: URI, changesets: readonly Changeset[] | undefined): void {
		const entry = this._sessionStates.get(session);
		if (!entry) {
			this._logService.warn(`[AgentHostStateManager] setSessionChangesets: unknown session ${session}`);
			return;
		}
		const state = entry.state;

		if (arrayEquals(state.changesets ?? [], changesets ?? [], structuralEquals)) {
			return;
		}
		const next = changesets ? changesets.slice() : undefined;
		this.dispatchServerAction(session, {
			type: ActionType.SessionChangesetsChanged,
			changesets: next,
		});
	}

	disposeChangeset(changeset: URI): void {
		if (!this._changesets.has(changeset)) {
			return;
		}
		this.dispatchServerAction(changeset, {
			type: ActionType.ChangesetCleared,
		});
		this._changesets.delete(changeset);
	}

	disposeSessionChangesets(session: URI): void {
		const toDispose: URI[] = [];
		for (const uri of this._changesets.keys()) {
			const parsed = parseChangesetUri(uri);
			if (parsed && parsed.sessionUri === session) {
				toDispose.push(uri);
			}
		}
		for (const uri of toDispose) {
			this.disposeChangeset(uri);
		}
	}

	disposeSessionAnnotations(session: URI): void {
		for (const resource of this._annotations.keys()) {
			const annotations = parseAnnotationsUri(resource);
			const subagent = annotations ? parseSubagentSessionUri(annotations.sessionUri) : undefined;
			if (annotations?.sessionUri === session || subagent?.parentSession.toString() === session) {
				this._annotations.delete(resource);
			}
		}
	}

	restoreAnnotations(session: URI, state: AnnotationsState): void {
		this._annotations.set(buildAnnotationsUri(session), state);
	}

	getAnnotationsState(resource: URI): AnnotationsState | undefined {
		return this._annotations.get(resource);
	}


	getActiveTurnId(sessionOrChat: URI): string | undefined {
		const chatUri = isAhpChatChannel(sessionOrChat) ? sessionOrChat : buildDefaultChatUri(sessionOrChat);
		return this._chatEntries.get(chatUri)?.state?.activeTurn?.id;
	}


	dispatchServerAction(channel: URI, action: StateAction): void {
		this._applyAndEmit(channel, action, undefined);
	}

	dispatchClientAction(channel: URI, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction, origin: ActionOrigin, clientContext?: IAgentHostClientTelemetryContext): unknown {
		return this._applyAndEmit(channel, action, origin, clientContext);
	}

	rejectClientAction(channel: URI, action: StateAction, origin: ActionOrigin, reason: string): void {
		const envelope: ActionEnvelope = {
			channel,
			action,
			serverSeq: ++this._serverSeq,
			origin,
			rejectionReason: reason,
		};
		this._logService.trace(`[AgentHostStateManager] Emitting rejection envelope: seq=${envelope.serverSeq}, channel=${envelope.channel}, type=${action.type}, origin=${origin.clientId}:${origin.clientSeq}, reason=${reason}`);
		this._onDidEmitEnvelope.fire(envelope);
	}


	private _invalidateChatEntry(chat: URI): void {
		const entry = this._chatEntries.get(chat);
		if (entry) {
			entry.valid = false;
			this._chatEntries.delete(chat);
		}
	}

	private _synchronizeChatEntries(session: URI, summaries: readonly ChatSummary[]): void {
		const expected = new Set(summaries.map(summary => summary.resource));
		for (const summary of summaries) {
			const existing = this._chatEntries.get(summary.resource);
			if (existing) {
				existing.summary = summary;
				if (existing.state) {
					existing.state = { ...existing.state, ...summary };
				}
			} else {
				this._chatEntries.set(summary.resource, {
					session,
					summary,
					valid: true,
				});
			}
		}
		for (const [chat, entry] of this._chatEntries) {
			if (entry.session === session && !expected.has(chat)) {
				this._invalidateChatEntry(chat);
			}
		}
	}

	private _applyAndEmit(channel: URI, action: StateAction, origin: ActionOrigin | undefined, clientContext?: IAgentHostClientTelemetryContext): unknown {
		let resultingState: unknown = undefined;
		if (action.type === ActionType.RootConfigChanged && action.replace) {
			action = {
				...action,
				config: preserveProviderBackedRootConfigValues(this._rootState, action.config),
			};
		}
		if (isRootAction(action)) {
			if (action.type === ActionType.RootConfigChanged && this._rootState.config) {
				const current = this._rootState.config.values;
				const patch = action.config;
				const isNoOp = action.replace
					? equals(current, patch)
					: equals({ ...current, ...patch }, current);
				if (isNoOp) {
					return this._rootState;
				}
			}
			this._rootState = rootReducer(this._rootState, action as RootAction, this._log);
			resultingState = this._rootState;
		}

		if (isSessionAction(action)) {
			const sessionAction = action as SessionAction;
			const key = channel;
			const entry = this._sessionStates.get(key);
			if (entry) {
				const previousState = entry.state;
				const newState = sessionReducer(previousState, sessionAction, this._log);
				const summaryChanged = !this._summaryFieldsEqual(previousState, newState);
				entry.state = newState;
				this._synchronizeChatEntries(key, newState.chats);

				if (previousState.title !== newState.title) {
					this._onDidChangeSessionTitle.fire({ session: key, title: newState.title });
				}
				if (sessionAction.type === ActionType.SessionConfigChanged) {
					this._onDidChangeSessionConfig.fire({ session: key, previous: previousState.config, current: newState.config, clientContext });
				}
				if (previousState.workingDirectories !== newState.workingDirectories) {
					this._onDidChangeSessionWorkingDirectories.fire({ session: key });
				}

				if (summaryChanged) {
					this._summaryNotifier.markDirty(key);
				}

				resultingState = newState;
			} else if (!isAhpChatChannel(key) && !isPassiveSessionMetadataAction(sessionAction)) {
				this._logService.warn(`[AgentHostStateManager] Action for unknown session: ${key}, type=${action.type}`);
			}
		}

		if (isChatAction(action)) {
			if (!isAhpChatChannel(channel)) {
				throw new Error(`[AgentHostStateManager] Chat action dispatched to non-chat channel: ${channel}, type=${action.type}`);
			}

			const chatAction = action as ChatAction;
			const sessionKey = parseRequiredSessionUriFromChatUri(channel);
			const chatEntry = this._chatEntries.get(channel);
			const chat = chatEntry?.state;
			if (chat && chatEntry && sessionKey !== undefined) {
				const newChat = chatReducer(chat, chatAction, this._log);
				chatEntry.state = newChat;
				this._onChatStateChanged(sessionKey, channel, chat, newChat);
				resultingState = newChat;
			} else {
				this._logService.warn(`[AgentHostStateManager] Action for unknown chat: ${channel}, type=${action.type}`);
			}
		}

		if (isChangesetAction(action)) {
			const changesetAction = action as ChangesetAction;
			const key = channel;
			const state = this._changesets.get(key);
			if (!state) {
				this._logService.warn(`[AgentHostStateManager] Action for unknown changeset: ${key}, type=${action.type}`);
				return undefined;
			}
			const newState = changesetReducer(state, changesetAction, this._log);
			if (newState !== state) {
				this._changesets.set(key, newState);
			}
			resultingState = newState;
		}

		if (isAnnotationsAction(action)) {
			const annotationsAction = action as AnnotationsAction;
			const key = channel;
			const state = this._annotations.get(key) ?? { annotations: [] };
			const newState = annotationsReducer(state, annotationsAction, this._log);
			if (newState !== state) {
				this._annotations.set(key, newState);
			}
			resultingState = newState;
		}

		if (isAhpAutomationCatalogChannel(channel) && isAutomationAction(action)) {
			const state = this._automationCatalog;
			if (!state) {
				this._logService.warn(`[AgentHostStateManager] Action for unavailable automation catalogue: ${channel}, type=${action.type}`);
				return undefined;
			}
			const newState = automationReducer(state, action, this._log);
			if (newState !== state) {
				this._automationCatalog = newState;
			}
			resultingState = newState;
		}

		if (isAhpAutomationRunChannel(channel) && isAutomationRunAction(action)) {
			const state = this._automationRuns.get(channel);
			if (!state) {
				this._logService.warn(`[AgentHostStateManager] Action for unknown automation run: ${channel}, type=${action.type}`);
				return undefined;
			}
			const newState = automationRunReducer(state, action, this._log);
			if (newState !== state) {
				this._automationRuns.set(channel, newState);
			}
			resultingState = newState;
		}

		const envelope: ActionEnvelope = {
			channel,
			action,
			serverSeq: ++this._serverSeq,
			origin,
		};

		this._logService.trace(`[AgentHostStateManager] Emitting envelope: seq=${envelope.serverSeq}, channel=${envelope.channel}, type=${action.type}${origin ? `, origin=${origin.clientId}:${origin.clientSeq}` : ''}`);
		this._onDidEmitEnvelope.fire(envelope);

		return resultingState;
	}

	private _removeChatActiveTurn(sessionKey: string, chatUri: string): void {
		const activeChats = this._sessionsWithActiveTurn.get(sessionKey);
		if (!activeChats || !activeChats.delete(chatUri)) {
			return;
		}

		if (activeChats.size === 0) {
			this._sessionsWithActiveTurn.delete(sessionKey);
			this._onDidChangeSessionActiveTurn.fire({ session: sessionKey, active: false });
			this.dispatchServerAction(ROOT_STATE_URI, { type: ActionType.RootActiveSessionsChanged, activeSessions: this._sessionsWithActiveTurn.size });
		}
	}

	private _onChatStateChanged(sessionKey: string, chatUri: string, prev: ChatState, next: ChatState): void {
		if (next.turns.length > 0 || next.activeTurn) {
			this._markSessionUsed(sessionKey);
		}
		const hadActive = !!prev.activeTurn;
		const hasActive = !!next.activeTurn;
		if (hadActive !== hasActive) {
			if (hasActive) {
				let activeChats = this._sessionsWithActiveTurn.get(sessionKey);
				const wasSessionActive = !!activeChats?.size;
				if (!activeChats) {
					activeChats = new Set<string>();
					this._sessionsWithActiveTurn.set(sessionKey, activeChats);
				}
				activeChats.add(chatUri);
				if (!wasSessionActive) {
					this._onDidChangeSessionActiveTurn.fire({ session: sessionKey, active: true });
					this.dispatchServerAction(ROOT_STATE_URI, { type: ActionType.RootActiveSessionsChanged, activeSessions: this._sessionsWithActiveTurn.size });
				}
			} else {
				this._removeChatActiveTurn(sessionKey, chatUri);
			}
		}

		const entry = this._sessionStates.get(sessionKey);
		if (!entry) {
			return;
		}
		const sessionState = entry.state;

		const nextEntry = chatSummaryFromState(next);
		const prevEntry = sessionState.chats.find(c => c.resource === chatUri);
		const chats = sessionState.chats.map(c => c.resource === chatUri ? nextEntry : c);

		if (prevEntry?.status !== nextEntry.status) {
			this.dispatchServerAction(sessionKey, {
				type: ActionType.SessionChatUpdated,
				chat: chatUri,
				changes: { status: nextEntry.status, activity: nextEntry.activity },
			});
		}

		const aggregate = this._aggregateChatSummaries(chats, sessionState.defaultChat);
		const newStatus = aggregate.status !== undefined ? this._mergeSessionStatus(sessionState.status, aggregate.status) : sessionState.status;
		const statusChanged = newStatus !== sessionState.status;
		const activityChanged = aggregate.activity !== sessionState.activity;
		entry.state = {
			...sessionState,
			chats,
			...(statusChanged ? { status: newStatus } : undefined),
			...(activityChanged ? { activity: aggregate.activity } : undefined),
		};
		if (statusChanged) {
			this._onDidChangeSessionStatus.fire({ session: sessionKey, status: newStatus });
		}

		const newModifiedAt = aggregate.modifiedAt !== undefined ? new Date(aggregate.modifiedAt).toISOString() : undefined;
		const modifiedAtChanged = newModifiedAt !== undefined && newModifiedAt !== entry.modifiedAt;
		if (modifiedAtChanged) {
			entry.modifiedAt = newModifiedAt;
		}

		if (statusChanged || activityChanged || modifiedAtChanged) {
			this._summaryNotifier.markDirty(sessionKey);
		}
	}

	private _aggregateChatSummaries(chats: readonly ChatSummary[], defaultChat: URI | undefined): { status?: SessionStatus; activity?: string; modifiedAt?: number } {
		if (chats.length === 0) {
			return {};
		}
		const activityMask = ~(SessionStatus.IsRead | SessionStatus.IsArchived);
		const base = (defaultChat !== undefined ? chats.find(c => c.resource === defaultChat) : undefined)
			?? chats.reduce((a, b) => Date.parse(b.modifiedAt) > Date.parse(a.modifiedAt) ? b : a);
		let status = base.status & activityMask;
		let driver = base;
		const errorChat = chats.find(c => (c.status & SessionStatus.Error) === SessionStatus.Error);
		const inputChat = chats.find(c => (c.status & SessionStatus.InputNeeded) === SessionStatus.InputNeeded);
		const inProgressChat = chats.find(c => (c.status & SessionStatus.InputNeeded) === SessionStatus.InProgress);
		if (inputChat) {
			status = SessionStatus.InputNeeded;
			driver = inputChat;
		} else if (errorChat) {
			status = SessionStatus.Error;
			driver = errorChat;
		} else if (inProgressChat) {
			status = SessionStatus.InProgress;
			driver = inProgressChat;
		}
		const modifiedAt = chats.reduce((max, c) => Math.max(max, Date.parse(c.modifiedAt)), 0);
		return { status, activity: driver.activity, modifiedAt };
	}

	private _mergeSessionStatus(sessionStatus: SessionStatus, chatStatus: SessionStatus): SessionStatus {
		const metaFlags = sessionStatus & (SessionStatus.IsRead | SessionStatus.IsArchived);
		const activityBits = chatStatus & ~(SessionStatus.IsRead | SessionStatus.IsArchived);
		return activityBits | metaFlags;
	}

	emitProgress(progress: Omit<ProgressParams, 'channel'>): void {
		this._onDidEmitNotification.fire({
			type: 'root/progress',
			channel: ROOT_STATE_URI,
			...progress,
		});
	}

	emitAuthRequired(params: Omit<AuthRequiredParams, 'channel'>): void {
		this._onDidEmitNotification.fire({
			type: 'auth/required',
			channel: ROOT_STATE_URI,
			...params,
		});
	}

	override dispose(): void {
		for (const entry of this._chatEntries.values()) {
			entry.valid = false;
		}
		this._chatEntries.clear();
		super.dispose();
	}
}

export function resolveChatStateForUri(stateManager: AgentHostStateManager, chatUri: string): ChatState | undefined {
	const peerState = stateManager.getChatState(chatUri);
	if (peerState) {
		return peerState;
	}
	if (!isAhpChatChannel(chatUri)) {
		return stateManager.getDefaultChatState(chatUri);
	}
	if (isDefaultChatUri(chatUri)) {
		return stateManager.getDefaultChatState(parseRequiredSessionUriFromChatUri(chatUri));
	}
	return undefined;
}
