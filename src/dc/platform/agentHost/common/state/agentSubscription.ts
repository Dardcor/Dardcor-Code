/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../../../base/common/assert.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IReference } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { IObservable, observableFromEvent } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { ActionEnvelope, ActionType, type AutomationAction, type AutomationRunAction, ChangesetAction, ChatAction, AnnotationsAction, ClientAnnotationsAction, type ClientAutomationAction, type ClientAutomationRunAction, ClientChangesetAction, IRootConfigChangedAction, SessionAction, StateAction, isChangesetAction, isChatAction, isAnnotationsAction, isSessionAction } from './sessionActions.js';
import { automationReducer, automationRunReducer, changesetReducer, chatReducer, annotationsReducer, rootReducer, sessionReducer } from './sessionReducers.js';
import { terminalReducer } from './protocol/reducers.js';
import type { RootAction, SessionAction as IProtocolSessionAction, ChatAction as IProtocolChatAction, TerminalAction } from './protocol/action-origin.generated.js';
import type { AnnotationsState, AutomationRunState, AutomationState, ChangesetState, ChatState, RootState, SessionState, TerminalState } from './protocol/state.js';
import type { IStateSnapshot } from './sessionProtocol.js';
import { isAhpAutomationCatalogChannel, isAhpAutomationRunChannel, isAhpRootChannel, StateComponents } from './sessionState.js';
import { normalizeLegacyChatStateErrors } from './legacyProtocolCompatibility.js';


export interface IAgentSubscription<T> {
	readonly value: T | Error | undefined;

	readonly verifiedValue: T | undefined;

	readonly onDidChange: Event<T>;

	readonly onDidError?: Event<Error>;

	readonly onWillApplyAction: Event<ActionEnvelope>;

	readonly onDidApplyAction: Event<ActionEnvelope>;
}

export interface IActiveSubscriptionInfo {
	readonly resource: URI;
	readonly kind: StateComponents;
	readonly refCount: number;
	readonly holders: readonly IActiveSubscriptionHolder[];
	readonly status: 'pending' | 'snapshot' | 'error';
}

export interface IActiveSubscriptionHolder {
	readonly owner: string;
	readonly count: number;
}


abstract class BaseAgentSubscription<T> extends Disposable implements IAgentSubscription<T> {

	protected _confirmedState: T | undefined;
	private _error: Error | undefined;
	private _bufferedEnvelopes: ActionEnvelope[] | undefined;
	private _awaitingSnapshotRefresh = false;

	protected readonly _onDidChange = this._register(new Emitter<T>());
	readonly onDidChange: Event<T> = this._onDidChange.event;

	protected readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	protected readonly _onWillApplyAction = this._register(new Emitter<ActionEnvelope>());
	readonly onWillApplyAction: Event<ActionEnvelope> = this._onWillApplyAction.event;

	protected readonly _onDidApplyAction = this._register(new Emitter<ActionEnvelope>());
	readonly onDidApplyAction: Event<ActionEnvelope> = this._onDidApplyAction.event;

	protected readonly _clientId: string;
	protected readonly _log: (msg: string) => void;

	constructor(clientId: string, log: (msg: string) => void) {
		super();
		this._clientId = clientId;
		this._log = log;
	}

	get value(): T | Error | undefined {
		if (this._error) {
			return this._error;
		}
		return this._getOptimisticState() ?? this._confirmedState;
	}

	get verifiedValue(): T | undefined {
		return this._confirmedState;
	}

	handleSnapshot(state: T, fromSeq: number): void {
		this._awaitingSnapshotRefresh = false;
		this._confirmedState = state;
		this._error = undefined;
		this._onSnapshotApplied(fromSeq);
		this._onDidChange.fire(this.value as T);
	}

	beginSnapshotRefresh(): void {
		this._awaitingSnapshotRefresh = true;
	}

	cancelSnapshotRefresh(): void {
		if (!this._awaitingSnapshotRefresh) {
			return;
		}
		this._awaitingSnapshotRefresh = false;
		const buffered = this._bufferedEnvelopes;
		if (!buffered || this._confirmedState === undefined) {
			return;
		}
		this._bufferedEnvelopes = undefined;
		for (const envelope of buffered) {
			this._reconcile(envelope, envelope.origin?.clientId === this._clientId);
		}
		this._onDidChange.fire(this.value as T);
	}

	setError(error: Error): void {
		this._error = error;
		this._onDidError.fire(error);
	}

	receiveEnvelope(envelope: ActionEnvelope): void {
		if (!this._isRelevantEnvelope(envelope)) {
			return;
		}

		if (this._confirmedState === undefined || this._awaitingSnapshotRefresh) {
			if (!this._bufferedEnvelopes) {
				this._bufferedEnvelopes = [];
			}
			this._bufferedEnvelopes.push(envelope);
			return;
		}

		const isOwnAction = envelope.origin?.clientId === this._clientId;
		this._onWillApplyAction.fire(envelope);

		this._reconcile(envelope, isOwnAction);

		this._onDidApplyAction.fire(envelope);
	}

	protected abstract _applyReducer(state: T, action: StateAction): T;

	protected abstract _isRelevantEnvelope(envelope: ActionEnvelope): boolean;

	protected _getOptimisticState(): T | undefined {
		return undefined;
	}

	protected _onSnapshotApplied(_fromSeq: number): void {
		const buffered = this._bufferedEnvelopes;
		if (buffered) {
			this._bufferedEnvelopes = undefined;
			for (const envelope of buffered) {
				if (envelope.serverSeq > _fromSeq) {
					const isOwnAction = envelope.origin?.clientId === this._clientId;
					this._reconcile(envelope, isOwnAction);
				}
			}
		}
	}

	protected _reconcile(envelope: ActionEnvelope, _isOwnAction: boolean): void {
		if (envelope.rejectionReason) {
			return;
		}
		this._confirmedState = this._applyReducer(this._confirmedState!, envelope.action);
		this._onDidChange.fire(this.value as T);
	}
}


export class RootStateSubscription extends BaseAgentSubscription<RootState> {

	protected override _applyReducer(state: RootState, action: StateAction): RootState {
		return rootReducer(state, action as RootAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isAhpRootChannel(envelope.channel) && envelope.action.type.startsWith('root/');
	}
}


interface IPendingAction {
	readonly clientSeq: number;
	readonly action: SessionAction;
}

export interface IPendingDispatchAction {
	readonly clientSeq: number;
	readonly action: SessionAction | ChatAction | AnnotationsAction;
	readonly channel: string;
}

export class SessionStateSubscription extends BaseAgentSubscription<SessionState> {

	private readonly _pendingActions: IPendingAction[] = [];
	private _optimisticState: SessionState | undefined;
	private readonly _sessionUri: string;
	private readonly _seqAllocator: () => number;

	constructor(
		sessionUri: string,
		clientId: string,
		seqAllocator: () => number,
		log: (msg: string) => void,
	) {
		super(clientId, log);
		this._sessionUri = sessionUri;
		this._seqAllocator = seqAllocator;
	}

	applyOptimistic(action: SessionAction): number {
		const clientSeq = this._seqAllocator();
		this._pendingActions.push({ clientSeq, action });
		const base = this._optimisticState ?? this.verifiedValue;
		if (base) {
			this._optimisticState = sessionReducer(base, action as IProtocolSessionAction, this._log);
			this._onDidChange.fire(this._optimisticState);
		}
		return clientSeq;
	}

	protected override _getOptimisticState(): SessionState | undefined {
		return this._optimisticState;
	}

	protected override _applyReducer(state: SessionState, action: StateAction): SessionState {
		return sessionReducer(state, action as IProtocolSessionAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isSessionAction(envelope.action) && envelope.channel === this._sessionUri;
	}

	protected override _onSnapshotApplied(fromSeq: number): void {
		super._onSnapshotApplied(fromSeq);
		this._recomputeOptimistic();
	}

	protected override _reconcile(envelope: ActionEnvelope, isOwnAction: boolean): void {
		if (isOwnAction && envelope.origin) {
			const idx = this._pendingActions.findIndex(p => p.clientSeq === envelope.origin!.clientSeq);
			if (idx !== -1) {
				if (!envelope.rejectionReason) {
					this._confirmedApply(envelope.action);
				}
				this._pendingActions.splice(idx, 1);
			} else if (!envelope.rejectionReason) {
				this._confirmedApply(envelope.action);
			}
		} else if (!envelope.rejectionReason) {
			this._confirmedApply(envelope.action);
		}
		this._recomputeOptimistic();
	}

	private _confirmedApply(action: StateAction): void {
		if (this._confirmedState) {
			this._confirmedState = this._applyReducer(this._confirmedState, action);
		}
	}

	private _recomputeOptimistic(): void {
		const confirmed = this._confirmedState;
		if (!confirmed) {
			this._optimisticState = undefined;
			return;
		}

		if (this._pendingActions.length === 0) {
			this._optimisticState = undefined;
			this._onDidChange.fire(confirmed);
			return;
		}

		let state = confirmed;
		for (const pending of this._pendingActions) {
			state = sessionReducer(state, pending.action as IProtocolSessionAction, this._log);
		}
		this._optimisticState = state;
		this._onDidChange.fire(state);
	}

	clearPending(): void {
		this._pendingActions.length = 0;
		this._optimisticState = undefined;
	}

	getPendingActions(): IPendingDispatchAction[] {
		return this._pendingActions.map(p => ({ clientSeq: p.clientSeq, action: p.action, channel: this._sessionUri }));
	}

	dropPendingByClientSeq(clientSeq: number): boolean {
		const idx = this._pendingActions.findIndex(p => p.clientSeq === clientSeq);
		if (idx === -1) {
			return false;
		}
		this._pendingActions.splice(idx, 1);
		return true;
	}
}


interface IPendingChatAction {
	readonly clientSeq: number;
	readonly action: ChatAction;
}

export class ChatStateSubscription extends BaseAgentSubscription<ChatState> {

	private readonly _pendingActions: IPendingChatAction[] = [];
	private _optimisticState: ChatState | undefined;
	private readonly _chatUri: string;
	private readonly _seqAllocator: () => number;

	constructor(
		chatUri: string,
		clientId: string,
		seqAllocator: () => number,
		log: (msg: string) => void,
	) {
		super(clientId, log);
		this._chatUri = chatUri;
		this._seqAllocator = seqAllocator;
	}

	override handleSnapshot(state: ChatState, fromSeq: number): void {
		super.handleSnapshot(normalizeLegacyChatStateErrors(state), fromSeq);
	}

	applyOptimistic(action: ChatAction): number {
		const clientSeq = this._seqAllocator();
		this._pendingActions.push({ clientSeq, action });
		const base = this._optimisticState ?? this.verifiedValue;
		if (base) {
			this._optimisticState = chatReducer(base, action as IProtocolChatAction, this._log);
			this._onDidChange.fire(this._optimisticState);
		}
		return clientSeq;
	}

	protected override _getOptimisticState(): ChatState | undefined {
		return this._optimisticState;
	}

	protected override _applyReducer(state: ChatState, action: StateAction): ChatState {
		return chatReducer(state, action as IProtocolChatAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isChatAction(envelope.action) && envelope.channel === this._chatUri;
	}

	protected override _onSnapshotApplied(fromSeq: number): void {
		super._onSnapshotApplied(fromSeq);
		this._recomputeOptimistic();
	}

	protected override _reconcile(envelope: ActionEnvelope, isOwnAction: boolean): void {
		if (isOwnAction && envelope.origin) {
			const idx = this._pendingActions.findIndex(p => p.clientSeq === envelope.origin!.clientSeq);
			if (idx !== -1) {
				if (!envelope.rejectionReason) {
					this._confirmedApply(envelope.action);
				}
				this._pendingActions.splice(idx, 1);
			} else if (!envelope.rejectionReason) {
				this._confirmedApply(envelope.action);
			}
		} else if (!envelope.rejectionReason) {
			this._promotePendingTurnStartIfTerminal(envelope.action);
			this._confirmedApply(envelope.action);
		}
		this._recomputeOptimistic();
	}

	private _promotePendingTurnStartIfTerminal(action: StateAction): void {
		if (!isChatAction(action)) {
			return;
		}
		if (action.type !== ActionType.ChatTurnComplete && action.type !== ActionType.ChatTurnCancelled && action.type !== ActionType.ChatError) {
			return;
		}
		const index = this._pendingActions.findIndex(p => p.action.type === ActionType.ChatTurnStarted && p.action.turnId === action.turnId);
		if (index === -1) {
			return;
		}
		const [{ action: pendingAction }] = this._pendingActions.splice(index, 1);
		if (this._confirmedState && (!this._confirmedState.activeTurn || this._confirmedState.activeTurn.id !== action.turnId)) {
			this._confirmedState = this._applyReducer(this._confirmedState, pendingAction);
		}
	}

	private _confirmedApply(action: StateAction): void {
		if (this._confirmedState) {
			this._confirmedState = this._applyReducer(this._confirmedState, action);
		}
	}

	private _recomputeOptimistic(): void {
		const confirmed = this._confirmedState;
		if (!confirmed) {
			this._optimisticState = undefined;
			return;
		}
		if (this._pendingActions.length === 0) {
			this._optimisticState = undefined;
			this._onDidChange.fire(confirmed);
			return;
		}
		let state = confirmed;
		for (const pending of this._pendingActions) {
			state = chatReducer(state, pending.action as IProtocolChatAction, this._log);
		}
		this._optimisticState = state;
		this._onDidChange.fire(state);
	}

	clearPending(): void {
		this._pendingActions.length = 0;
		this._optimisticState = undefined;
	}

	getPendingActions(): IPendingDispatchAction[] {
		return this._pendingActions.map(p => ({ clientSeq: p.clientSeq, action: p.action, channel: this._chatUri }));
	}

	dropPendingByClientSeq(clientSeq: number): boolean {
		const idx = this._pendingActions.findIndex(p => p.clientSeq === clientSeq);
		if (idx === -1) {
			return false;
		}
		this._pendingActions.splice(idx, 1);
		return true;
	}
}


export class TerminalStateSubscription extends BaseAgentSubscription<TerminalState> {

	private readonly _terminalUri: string;

	constructor(terminalUri: string, clientId: string, log: (msg: string) => void) {
		super(clientId, log);
		this._terminalUri = terminalUri;
	}

	protected override _applyReducer(state: TerminalState, action: StateAction): TerminalState {
		return terminalReducer(state, action as TerminalAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return envelope.action.type.startsWith('terminal/') && envelope.channel === this._terminalUri;
	}
}

export class AutomationCatalogSubscription extends BaseAgentSubscription<AutomationState> {

	constructor(clientId: string, log: (msg: string) => void) {
		super(clientId, log);
	}

	protected override _applyReducer(state: AutomationState, action: StateAction): AutomationState {
		return automationReducer(state, action as AutomationAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isAhpAutomationCatalogChannel(envelope.channel);
	}

	protected override _reconcile(envelope: ActionEnvelope, isOwnAction: boolean): void {
		if (!envelope.rejectionReason) {
			super._reconcile(envelope, isOwnAction);
		}
	}
}

export class AutomationRunSubscription extends BaseAgentSubscription<AutomationRunState> {

	private readonly _resource: string;

	constructor(resource: string, clientId: string, log: (msg: string) => void) {
		super(clientId, log);
		this._resource = resource;
	}

	protected override _applyReducer(state: AutomationRunState, action: StateAction): AutomationRunState {
		return automationRunReducer(state, action as AutomationRunAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isAhpAutomationRunChannel(envelope.channel) && envelope.channel === this._resource;
	}

	protected override _reconcile(envelope: ActionEnvelope, isOwnAction: boolean): void {
		if (!envelope.rejectionReason) {
			super._reconcile(envelope, isOwnAction);
		}
	}
}


export class ChangesetStateSubscription extends BaseAgentSubscription<ChangesetState> {

	private readonly _pendingActions: { readonly clientSeq: number; readonly action: ClientChangesetAction }[] = [];
	private _optimisticState: ChangesetState | undefined;
	private readonly _changesetUri: string;
	private readonly _seqAllocator: () => number;

	constructor(changesetUri: string, clientId: string, seqAllocator: () => number, log: (msg: string) => void) {
		super(clientId, log);
		this._changesetUri = changesetUri;
		this._seqAllocator = seqAllocator;
	}

	applyOptimistic(action: ClientChangesetAction): number {
		const clientSeq = this._seqAllocator();
		this._pendingActions.push({ clientSeq, action });
		const base = this._optimisticState ?? this.verifiedValue;
		if (base) {
			this._optimisticState = changesetReducer(base, action, this._log);
			this._onDidChange.fire(this._optimisticState);
		}
		return clientSeq;
	}

	protected override _getOptimisticState(): ChangesetState | undefined {
		return this._optimisticState;
	}

	protected override _applyReducer(state: ChangesetState, action: StateAction): ChangesetState {
		return changesetReducer(state, action as ChangesetAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isChangesetAction(envelope.action) && envelope.channel === this._changesetUri;
	}

	protected override _onSnapshotApplied(fromSeq: number): void {
		super._onSnapshotApplied(fromSeq);
		this._recomputeOptimistic();
	}

	protected override _reconcile(envelope: ActionEnvelope, isOwnAction: boolean): void {
		if (isOwnAction && envelope.origin) {
			const index = this._pendingActions.findIndex(pending => pending.clientSeq === envelope.origin!.clientSeq);
			if (index !== -1) {
				if (!envelope.rejectionReason) {
					this._confirmedApply(envelope.action);
				}
				this._pendingActions.splice(index, 1);
			} else {
				this._confirmedApply(envelope.action);
			}
		} else {
			this._confirmedApply(envelope.action);
		}
		this._recomputeOptimistic();
	}

	private _confirmedApply(action: StateAction): void {
		if (this._confirmedState) {
			this._confirmedState = this._applyReducer(this._confirmedState, action);
		}
	}

	private _recomputeOptimistic(): void {
		const confirmed = this._confirmedState;
		if (!confirmed) {
			this._optimisticState = undefined;
			return;
		}

		if (this._pendingActions.length === 0) {
			this._optimisticState = undefined;
			this._onDidChange.fire(confirmed);
			return;
		}

		let state = confirmed;
		for (const pending of this._pendingActions) {
			state = changesetReducer(state, pending.action, this._log);
		}
		this._optimisticState = state;
		this._onDidChange.fire(state);
	}
}

type ManagedSubscription = SessionStateSubscription | ChatStateSubscription | TerminalStateSubscription | ChangesetStateSubscription | AnnotationsStateSubscription | AutomationCatalogSubscription | AutomationRunSubscription;


interface IPendingAnnotationsAction {
	readonly clientSeq: number;
	readonly action: AnnotationsAction;
}

export class AnnotationsStateSubscription extends BaseAgentSubscription<AnnotationsState> {

	private readonly _pendingActions: IPendingAnnotationsAction[] = [];
	private _optimisticState: AnnotationsState | undefined;
	private readonly _annotationsUri: string;
	private readonly _seqAllocator: () => number;

	constructor(annotationsUri: string, clientId: string, seqAllocator: () => number, log: (msg: string) => void) {
		super(clientId, log);
		this._annotationsUri = annotationsUri;
		this._seqAllocator = seqAllocator;
	}

	applyOptimistic(action: AnnotationsAction): number {
		const clientSeq = this._seqAllocator();
		this._pendingActions.push({ clientSeq, action });
		const base = this._optimisticState ?? this.verifiedValue;
		if (base) {
			this._optimisticState = annotationsReducer(base, action, this._log);
			this._onDidChange.fire(this._optimisticState);
		}
		return clientSeq;
	}

	protected override _getOptimisticState(): AnnotationsState | undefined {
		return this._optimisticState;
	}

	protected override _applyReducer(state: AnnotationsState, action: StateAction): AnnotationsState {
		return annotationsReducer(state, action as AnnotationsAction, this._log);
	}

	protected override _isRelevantEnvelope(envelope: ActionEnvelope): boolean {
		return isAnnotationsAction(envelope.action) && envelope.channel === this._annotationsUri;
	}

	protected override _onSnapshotApplied(fromSeq: number): void {
		super._onSnapshotApplied(fromSeq);
		this._recomputeOptimistic();
	}

	protected override _reconcile(envelope: ActionEnvelope, isOwnAction: boolean): void {
		if (isOwnAction && envelope.origin) {
			const idx = this._pendingActions.findIndex(p => p.clientSeq === envelope.origin!.clientSeq);
			if (idx !== -1) {
				if (!envelope.rejectionReason) {
					this._confirmedApply(envelope.action);
				}
				this._pendingActions.splice(idx, 1);
			} else {
				this._confirmedApply(envelope.action);
			}
		} else {
			this._confirmedApply(envelope.action);
		}
		this._recomputeOptimistic();
	}

	private _confirmedApply(action: StateAction): void {
		if (this._confirmedState) {
			this._confirmedState = this._applyReducer(this._confirmedState, action);
		}
	}

	private _recomputeOptimistic(): void {
		const confirmed = this._confirmedState;
		if (!confirmed) {
			this._optimisticState = undefined;
			return;
		}

		if (this._pendingActions.length === 0) {
			this._optimisticState = undefined;
			this._onDidChange.fire(confirmed);
			return;
		}

		let state = confirmed;
		for (const pending of this._pendingActions) {
			state = annotationsReducer(state, pending.action, this._log);
		}
		this._optimisticState = state;
		this._onDidChange.fire(state);
	}

	clearPending(): void {
		this._pendingActions.length = 0;
		this._optimisticState = undefined;
	}

	getPendingActions(): IPendingDispatchAction[] {
		return this._pendingActions.map(p => ({ clientSeq: p.clientSeq, action: p.action, channel: this._annotationsUri }));
	}

	dropPendingByClientSeq(clientSeq: number): boolean {
		const index = this._pendingActions.findIndex(p => p.clientSeq === clientSeq);
		if (index === -1) {
			return false;
		}
		this._pendingActions.splice(index, 1);
		return true;
	}
}

type ManagedSubscriptionEntry = { sub: ManagedSubscription; kind: StateComponents; refCount: number; holders: Map<number, string> };



export class AgentSubscriptionManager extends Disposable {

	private readonly _subscriptions = new ResourceMap<ManagedSubscriptionEntry>();
	private readonly _inflightCreates = new ResourceMap<Promise<unknown>>();
	private _referenceOwnerIds = 0;
	private readonly _rootState: RootStateSubscription;
	private readonly _clientId: string;
	private readonly _seqAllocator: () => number;
	private readonly _log: (msg: string) => void;
	private readonly _subscribe: (resource: URI) => Promise<IStateSnapshot>;
	private readonly _unsubscribe: (resource: URI) => void;

	constructor(
		clientId: string,
		seqAllocator: () => number,
		log: (msg: string) => void,
		subscribe: (resource: URI) => Promise<IStateSnapshot>,
		unsubscribe: (resource: URI) => void,
	) {
		super();
		this._clientId = clientId;
		this._seqAllocator = seqAllocator;
		this._log = log;
		this._subscribe = subscribe;
		this._unsubscribe = unsubscribe;
		this._rootState = this._register(new RootStateSubscription(clientId, log));
	}

	get rootState(): IAgentSubscription<RootState> {
		return this._rootState;
	}

	handleRootSnapshot(state: RootState, fromSeq: number): void {
		this._rootState.handleSnapshot(state, fromSeq);
	}

	getSubscriptionUnmanaged<T>(resource: URI): IAgentSubscription<T> | undefined {
		const entry = this._subscriptions.get(resource);
		return entry?.sub as IAgentSubscription<T> | undefined;
	}

	getInflightSessionCreate(resource: URI): Promise<unknown> | undefined {
		return this._inflightCreates.get(resource);
	}

	trackSessionCreate(resource: URI, promise: Promise<unknown>): void {
		this._inflightCreates.set(resource, promise);
		void promise.finally(() => {
			if (this._inflightCreates.get(resource) === promise) {
				this._inflightCreates.delete(resource);
			}
		}).catch(() => { });
	}

	getSubscription<T>(kind: StateComponents, resource: URI, owner: string): IReference<IAgentSubscription<T>> {
		const existing = this._subscriptions.get(resource);
		if (existing) {
			if (existing.sub.value instanceof Error) {
				this._subscriptions.delete(resource);
				this._disposeSubscriptionEntry(resource, existing);
			} else {
				existing.refCount++;
				return this._acquireReference<T>(resource, existing, owner);
			}
		}

		const key = resource.toString();
		const sub = this._createSubscription(kind, key);
		const entry: ManagedSubscriptionEntry = { sub, kind, refCount: 1, holders: new Map() };
		this._subscriptions.set(resource, entry);

		void (async () => {
			const inflight = this._inflightCreates.get(resource);
			if (inflight) {
				try {
					await inflight;
				} catch {
				}
			}
			try {
				const snapshot = await this._subscribe(resource);
				if (this._subscriptions.get(resource) === entry) {
					sub.handleSnapshot(snapshot.state as never, snapshot.fromSeq);
				}
			} catch (err) {
				if (this._subscriptions.get(resource) === entry) {
					sub.setError(err instanceof Error ? err : new Error(String(err)));
				}
			}
		})();

		return this._acquireReference<T>(resource, entry, owner);
	}

	private _acquireReference<T>(resource: URI, entry: ManagedSubscriptionEntry, owner: string): IReference<IAgentSubscription<T>> {
		const ownerId = ++this._referenceOwnerIds;
		entry.holders.set(ownerId, owner);

		let isDisposed = false;
		return {
			object: entry.sub as unknown as IAgentSubscription<T>,
			dispose: () => {
				if (isDisposed) {
					return;
				}
				isDisposed = true;
				entry.holders.delete(ownerId);
				this._releaseSubscription(resource, entry);
			},
		};
	}

	private _disposeSubscriptionEntry(resource: URI, entry: ManagedSubscriptionEntry): void {
		this._tryUnsubscribe(resource);
		if (entry.sub instanceof SessionStateSubscription || entry.sub instanceof ChatStateSubscription || entry.sub instanceof AnnotationsStateSubscription) {
			entry.sub.clearPending();
		}
		entry.sub.dispose();
	}

	private _tryUnsubscribe(resource: URI): void {
		try {
			this._unsubscribe(resource);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._log(`Failed to unsubscribe ${resource.toString()}: ${message}`);
		}
	}

	receiveEnvelope(envelope: ActionEnvelope): void {
		this._rootState.receiveEnvelope(envelope);
		for (const { sub } of this._subscriptions.values()) {
			sub.receiveEnvelope(envelope);
		}
	}

	dispatchOptimistic(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientChangesetAction | ClientAnnotationsAction | ClientAutomationAction | ClientAutomationRunAction | IRootConfigChangedAction): number {
		if (isSessionAction(action)) {
			const entry = this._subscriptions.get(URI.parse(channel));
			if (entry?.sub instanceof SessionStateSubscription) {
				return entry.sub.applyOptimistic(action);
			}
		} else if (isChatAction(action)) {
			const entry = this._subscriptions.get(URI.parse(channel));
			if (entry?.sub instanceof ChatStateSubscription) {
				return entry.sub.applyOptimistic(action);
			}
		} else if (isChangesetAction(action)) {
			const entry = this._subscriptions.get(URI.parse(channel));
			if (entry?.sub instanceof ChangesetStateSubscription) {
				return entry.sub.applyOptimistic(action);
			}
		} else if (isAnnotationsAction(action)) {
			const entry = this._subscriptions.get(URI.parse(channel));
			if (entry?.sub instanceof AnnotationsStateSubscription) {
				return entry.sub.applyOptimistic(action);
			}
		}
		return this._seqAllocator();
	}

	currentSubscriptionUris(): URI[] {
		return [...this._subscriptions.keys()];
	}

	getActiveSubscriptions(): readonly IActiveSubscriptionInfo[] {
		const out: IActiveSubscriptionInfo[] = [];
		for (const [resource, entry] of this._subscriptions) {
			const value = entry.sub.value;
			const status = value === undefined ? 'pending' : value instanceof Error ? 'error' : 'snapshot';
			out.push({ resource, kind: entry.kind, refCount: entry.refCount, holders: this._summarizeHolders(entry), status });
		}
		return out;
	}

	private _summarizeHolders(entry: ManagedSubscriptionEntry): IActiveSubscriptionHolder[] {
		const counts = new Map<string, number>();
		for (const owner of entry.holders.values()) {
			counts.set(owner, (counts.get(owner) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([owner, count]) => ({ owner, count }))
			.sort((a, b) => b.count - a.count);
	}

	getPendingActions(): IPendingDispatchAction[] {
		const out: IPendingDispatchAction[] = [];
		for (const { sub } of this._subscriptions.values()) {
			if (sub instanceof SessionStateSubscription || sub instanceof ChatStateSubscription || sub instanceof AnnotationsStateSubscription) {
				out.push(...sub.getPendingActions());
			}
		}
		return out;
	}

	dropPendingAction(resource: string, clientSeq: number): void {
		const entry = this._subscriptions.get(URI.parse(resource));
		if (entry?.sub instanceof SessionStateSubscription || entry?.sub instanceof ChatStateSubscription || entry?.sub instanceof AnnotationsStateSubscription) {
			entry.sub.dropPendingByClientSeq(clientSeq);
		}
	}

	applyReconnectSnapshot(resource: string, state: unknown, fromSeq: number, preservePending = false): void {
		if (isAhpRootChannel(resource)) {
			this._rootState.handleSnapshot(state as RootState, fromSeq);
			return;
		}
		const entry = this._subscriptions.get(URI.parse(resource));
		if (!entry) {
			return;
		}
		if (!preservePending && (entry.sub instanceof SessionStateSubscription || entry.sub instanceof ChatStateSubscription || entry.sub instanceof AnnotationsStateSubscription)) {
			entry.sub.clearPending();
		}
		entry.sub.handleSnapshot(state as never, fromSeq);
	}

	beginSnapshotRefresh(resource: URI): void {
		this._subscriptions.get(resource)?.sub.beginSnapshotRefresh();
	}

	cancelSnapshotRefresh(resource: URI): void {
		this._subscriptions.get(resource)?.sub.cancelSnapshotRefresh();
	}

	markSubscriptionsMissing(missing: readonly URI[]): void {
		for (const resource of missing) {
			const entry = this._subscriptions.get(resource);
			if (entry) {
				if (entry.sub instanceof SessionStateSubscription || entry.sub instanceof ChatStateSubscription || entry.sub instanceof AnnotationsStateSubscription) {
					entry.sub.clearPending();
				}
				entry.sub.setError(new Error(`Subscription no longer available after reconnect: ${resource.toString()}`));
			}
		}
	}

	private _createSubscription(kind: StateComponents, key: string): ManagedSubscription {
		switch (kind) {
			case StateComponents.Session:
				return new SessionStateSubscription(key, this._clientId, this._seqAllocator, this._log);
			case StateComponents.Chat:
				return new ChatStateSubscription(key, this._clientId, this._seqAllocator, this._log);
			case StateComponents.Terminal:
				return new TerminalStateSubscription(key, this._clientId, this._log);
			case StateComponents.Changeset:
				return new ChangesetStateSubscription(key, this._clientId, this._seqAllocator, this._log);
			case StateComponents.Annotations:
				return new AnnotationsStateSubscription(key, this._clientId, this._seqAllocator, this._log);
			case StateComponents.AutomationCatalog:
				return new AutomationCatalogSubscription(this._clientId, this._log);
			case StateComponents.AutomationRun:
				return new AutomationRunSubscription(key, this._clientId, this._log);
			case StateComponents.Root:
				throw new Error('_createSubscription: root subscription is managed separately');
			default:
				assertNever(kind, `_createSubscription: unsupported StateComponents kind: ${kind}`);
		}
	}

	private _releaseSubscription(resource: URI, expected?: ManagedSubscriptionEntry): void {
		const entry = this._subscriptions.get(resource);
		if (!entry || (expected && entry !== expected)) {
			return;
		}
		entry.refCount--;
		if (entry.refCount <= 0) {
			this._subscriptions.delete(resource);
			this._disposeSubscriptionEntry(resource, entry);
		}
	}

	override dispose(): void {
		for (const [resource, entry] of this._subscriptions) {
			this._tryUnsubscribe(resource);
			entry.sub.dispose();
		}
		this._subscriptions.clear();
		super.dispose();
	}
}

export function isActionEnvelopeRelevantToSubscriptionUris(envelope: ActionEnvelope, subscribedUris: Iterable<string>): boolean {
	if (isAhpRootChannel(envelope.channel)) {
		for (const uri of subscribedUris) {
			if (isAhpRootChannel(uri)) {
				return true;
			}
		}
		return false;
	}
	if (isAhpAutomationCatalogChannel(envelope.channel)) {
		for (const uri of subscribedUris) {
			if (isAhpAutomationCatalogChannel(uri)) {
				return true;
			}
		}
		return false;
	}
	for (const uri of subscribedUris) {
		if (uri === envelope.channel) {
			return true;
		}
	}
	return false;
}


export function observableFromSubscription<T>(owner: object | undefined, sub: IAgentSubscription<T>): IObservable<T | undefined> {
	return observableFromEvent(owner, sub.onDidChange, () => {
		const v = sub.value;
		return v instanceof Error ? undefined : v;
	});
}
