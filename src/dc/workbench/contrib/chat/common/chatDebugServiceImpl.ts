/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { CHAT_DEBUG_ACTIVE_SESSION_IS_AGENT_HOST, CHAT_DEBUG_HAS_ACTIVE_SESSION, ChatDebugLogLevel, IChatDebugEvent, IChatDebugLogProvider, IChatDebugResolvedEventContent, IChatDebugService } from './chatDebugService.js';
import { isAgentHostTarget, localChatSessionType } from './chatSessionsService.js';
import { getChatSessionType } from './model/chatUri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { AgentHostAgentDebugLogMaxEventsSettingId } from './promptSyntax/promptTypes.js';

class SessionEventBuffer {
	private readonly _buffer: (IChatDebugEvent | undefined)[];
	private _head = 0;
	private _size = 0;

	constructor(readonly capacity: number) {
		this._buffer = new Array(capacity);
	}

	get size(): number {
		return this._size;
	}

	push(event: IChatDebugEvent): void {
		const idx = (this._head + this._size) % this.capacity;
		this._buffer[idx] = event;
		if (this._size < this.capacity) {
			this._size++;
		} else {
			this._head = (this._head + 1) % this.capacity;
		}
	}

	toArray(): IChatDebugEvent[] {
		const result: IChatDebugEvent[] = [];
		for (let i = 0; i < this._size; i++) {
			const event = this._buffer[(this._head + i) % this.capacity];
			if (event) {
				result.push(event);
			}
		}
		return result;
	}

	removeWhere(predicate: (event: IChatDebugEvent) => boolean): void {
		let write = 0;
		for (let i = 0; i < this._size; i++) {
			const idx = (this._head + i) % this.capacity;
			const event = this._buffer[idx];
			if (event && predicate(event)) {
				continue;
			}
			if (write !== i) {
				const writeIdx = (this._head + write) % this.capacity;
				this._buffer[writeIdx] = event;
			}
			write++;
		}
		for (let i = write; i < this._size; i++) {
			this._buffer[(this._head + i) % this.capacity] = undefined;
		}
		this._size = write;
	}

	clear(): void {
		this._buffer.fill(undefined);
		this._head = 0;
		this._size = 0;
	}
}

export class ChatDebugServiceImpl extends Disposable implements IChatDebugService {
	declare readonly _serviceBrand: undefined;

	static readonly MAX_EVENTS_PER_SESSION = 10_000;
	static readonly MAX_SESSIONS = 5;

	private readonly _sessionBuffers = new ResourceMap<SessionEventBuffer>();
	private readonly _sessionOrder: URI[] = [];
	private readonly _seenEventIds = new ResourceMap<Map<string, IChatDebugEvent['kind']>>();

	private readonly _onDidAddEvent = this._register(new Emitter<IChatDebugEvent>());
	readonly onDidAddEvent: Event<IChatDebugEvent> = this._onDidAddEvent.event;

	private readonly _onDidClearProviderEvents = this._register(new Emitter<URI>());
	readonly onDidClearProviderEvents: Event<URI> = this._onDidClearProviderEvents.event;

	private readonly _onDidEndSession = this._register(new Emitter<URI>());
	readonly onDidEndSession: Event<URI> = this._onDidEndSession.event;

	private readonly _onDidChangeAvailableSessionResources = this._register(new Emitter<void>());
	readonly onDidChangeAvailableSessionResources: Event<void> = this._onDidChangeAvailableSessionResources.event;

	private readonly _providers = new Set<IChatDebugLogProvider>();
	private readonly _invocationCts = new ResourceMap<CancellationTokenSource>();

	private readonly _pendingProviderClear = new ResourceMap<boolean>();

	private readonly _providerEvents = new WeakSet<IChatDebugEvent>();

	private readonly _importedSessions = new ResourceMap<boolean>();

	private readonly _availableSessionResources: URI[] = [];
	private readonly _availableSessionResourceSet = new Set<string>();

	private readonly _historicalSessionTitles = new ResourceMap<string>();

	private readonly _importedSessionTitles = new ResourceMap<string>();

	private readonly _hasActiveSessionContextKey: IContextKey<boolean>;
	private readonly _activeSessionIsAgentHostContextKey: IContextKey<boolean>;
	private _activeSessionResource: URI | undefined;

	get activeSessionResource(): URI | undefined {
		return this._activeSessionResource;
	}

	set activeSessionResource(value: URI | undefined) {
		this._activeSessionResource = value;
		this._hasActiveSessionContextKey.set(value !== undefined);
		this._activeSessionIsAgentHostContextKey.set(value ? isAgentHostTarget(getChatSessionType(value)) : false);
	}

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._hasActiveSessionContextKey = CHAT_DEBUG_HAS_ACTIVE_SESSION.bindTo(contextKeyService);
		this._activeSessionIsAgentHostContextKey = CHAT_DEBUG_ACTIVE_SESSION_IS_AGENT_HOST.bindTo(contextKeyService);
		this._register(toDisposable(() => {
			this._hasActiveSessionContextKey.reset();
			this._activeSessionIsAgentHostContextKey.reset();
		}));
	}

	private static readonly _eventKindPriority: Record<string, number> = {
		subagentInvocation: 0,
		modelTurn: 1,
		toolCall: 2,
		agentResponse: 3,
		userMessage: 4,
		generic: 5,
	};

	private static readonly _debugEligibleSessionTypes = new Set([
		localChatSessionType,
		'copilotcli',
		'agent-host-copilotcli',
	]);

	private _isDebugEligibleSession(sessionResource: URI): boolean {
		const sessionType = getChatSessionType(sessionResource);
		return ChatDebugServiceImpl._debugEligibleSessionTypes.has(sessionType)
			|| (sessionType.startsWith('remote-') && sessionType.endsWith('-copilotcli'))
			|| this._importedSessions.has(sessionResource);
	}

	private _capacityForSession(sessionResource: URI): number {
		if (!isAgentHostTarget(getChatSessionType(sessionResource))) {
			return ChatDebugServiceImpl.MAX_EVENTS_PER_SESSION;
		}
		const configured = this._configurationService.getValue<number>(AgentHostAgentDebugLogMaxEventsSettingId);
		if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 1) {
			return Math.floor(configured);
		}
		return ChatDebugServiceImpl.MAX_EVENTS_PER_SESSION;
	}

	log(sessionResource: URI, name: string, details?: string, level: ChatDebugLogLevel = ChatDebugLogLevel.Info, options?: { id?: string; category?: string; parentEventId?: string }): void {
		if (!this._isDebugEligibleSession(sessionResource)) {
			return;
		}
		this.addEvent({
			kind: 'generic',
			id: options?.id,
			sessionResource,
			created: new Date(),
			name,
			details,
			level,
			category: options?.category,
			parentEventId: options?.parentEventId,
		});
	}

	addEvent(event: IChatDebugEvent): void {
		let buffer = this._sessionBuffers.get(event.sessionResource);
		const capacity = buffer?.capacity ?? this._capacityForSession(event.sessionResource);

		if (event.id) {
			let seen = this._seenEventIds.get(event.sessionResource);
			if (!seen) {
				seen = new Map();
				this._seenEventIds.set(event.sessionResource, seen);
			}
			const existingKind = seen.get(event.id);
			if (existingKind !== undefined) {
				const priority = ChatDebugServiceImpl._eventKindPriority;
				if ((priority[event.kind] ?? 5) >= (priority[existingKind] ?? 5)) {
					return;
				}
			}
			seen.set(event.id, event.kind);
			if (seen.size > capacity) {
				const firstKey = seen.keys().next().value;
				if (firstKey !== undefined) {
					seen.delete(firstKey);
				}
			}
		}

		if (!buffer) {
			if (this._sessionOrder.length >= ChatDebugServiceImpl.MAX_SESSIONS) {
				const evicted = this._sessionOrder.shift()!;
				this._evictSession(evicted);
			}
			buffer = new SessionEventBuffer(capacity);
			this._sessionBuffers.set(event.sessionResource, buffer);
			this._sessionOrder.push(event.sessionResource);
		} else {
			const last = this._sessionOrder.length - 1;
			if (last < 0 || !extUri.isEqual(this._sessionOrder[last], event.sessionResource)) {
				const idx = this._sessionOrder.findIndex(u => extUri.isEqual(u, event.sessionResource));
				if (idx !== -1 && idx !== last) {
					this._sessionOrder.splice(idx, 1);
					this._sessionOrder.push(event.sessionResource);
				}
			}
		}
		buffer.push(event);
		this._onDidAddEvent.fire(event);
	}

	addProviderEvent(event: IChatDebugEvent): void {
		if (this._pendingProviderClear.has(event.sessionResource)) {
			this._pendingProviderClear.delete(event.sessionResource);
			this._clearProviderEvents(event.sessionResource);
		}
		this._providerEvents.add(event);
		this.addEvent(event);
	}

	getEvents(sessionResource?: URI): readonly IChatDebugEvent[] {
		if (sessionResource) {
			const buffer = this._sessionBuffers.get(sessionResource);
			if (!buffer) {
				return [];
			}
			let result = buffer.toArray();
			if (!this._isSorted(result)) {
				result.sort((a, b) => a.created.getTime() - b.created.getTime());
			}
			result = this._deduplicateEvents(result);
			return result;
		}

		const result: IChatDebugEvent[] = [];
		for (const buffer of this._sessionBuffers.values()) {
			result.push(...buffer.toArray());
		}
		result.sort((a, b) => a.created.getTime() - b.created.getTime());
		return result;
	}

	private _isSorted(events: IChatDebugEvent[]): boolean {
		for (let i = 1; i < events.length; i++) {
			if (events[i].created.getTime() < events[i - 1].created.getTime()) {
				return false;
			}
		}
		return true;
	}

	private _deduplicateEvents(events: IChatDebugEvent[]): IChatDebugEvent[] {
		const seen = new Map<string, number>();
		const priority = ChatDebugServiceImpl._eventKindPriority;
		const result: IChatDebugEvent[] = [];
		for (const event of events) {
			if (!event.id) {
				result.push(event);
				continue;
			}
			const existingIdx = seen.get(event.id);
			if (existingIdx === undefined) {
				seen.set(event.id, result.length);
				result.push(event);
			} else {
				const existing = result[existingIdx];
				if ((priority[event.kind] ?? 5) < (priority[existing.kind] ?? 5)) {
					result[existingIdx] = event;
				}
			}
		}
		return result;
	}

	getSessionResources(): readonly URI[] {
		return [...this._sessionOrder];
	}

	clear(): void {
		this._sessionBuffers.clear();
		this._sessionOrder.length = 0;
		this._seenEventIds.clear();
		this._importedSessions.clear();
		this._importedSessionTitles.clear();
		this._availableSessionResources.length = 0;
		this._availableSessionResourceSet.clear();
		this._historicalSessionTitles.clear();
	}

	private _evictSession(sessionResource: URI): void {
		this._sessionBuffers.delete(sessionResource);
		this._seenEventIds.delete(sessionResource);
		this._importedSessions.delete(sessionResource);
		this._importedSessionTitles.delete(sessionResource);
		const cts = this._invocationCts.get(sessionResource);
		if (cts) {
			cts.cancel();
			cts.dispose();
			this._invocationCts.delete(sessionResource);
		}
	}

	registerProvider(provider: IChatDebugLogProvider): IDisposable {
		this._providers.add(provider);

		for (const [sessionResource, cts] of this._invocationCts) {
			if (!cts.token.isCancellationRequested) {
				this._invokeProvider(provider, sessionResource, cts.token).catch(onUnexpectedError);
			}
		}

		return toDisposable(() => {
			this._providers.delete(provider);
		});
	}

	hasInvokedProviders(sessionResource: URI): boolean {
		return this._invocationCts.has(sessionResource);
	}

	async invokeProviders(sessionResource: URI): Promise<void> {

		if (!this._isDebugEligibleSession(sessionResource)) {
			return;
		}
		const existingCts = this._invocationCts.get(sessionResource);
		if (existingCts) {
			existingCts.cancel();
			existingCts.dispose();
		}

		this._pendingProviderClear.set(sessionResource, true);

		const cts = new CancellationTokenSource();
		this._invocationCts.set(sessionResource, cts);

		try {
			const promises = [...this._providers].map(provider =>
				this._invokeProvider(provider, sessionResource, cts.token)
			);
			await Promise.allSettled(promises);
		} catch (err) {
			onUnexpectedError(err);
		}
	}

	private async _invokeProvider(provider: IChatDebugLogProvider, sessionResource: URI, token: CancellationToken): Promise<void> {
		try {
			const events = await provider.provideChatDebugLog(sessionResource, token);
			if (events) {
				const BATCH_SIZE = 500;
				for (let i = 0; i < events.length; i++) {
					if (token.isCancellationRequested) {
						break;
					}
					this.addProviderEvent({
						...events[i],
						sessionResource: events[i].sessionResource ?? sessionResource,
					});
					if (i > 0 && i % BATCH_SIZE === 0) {
						await timeout(0);
					}
				}
			}
		} catch (err) {
			onUnexpectedError(err);
		}
	}

	endSession(sessionResource: URI): void {
		const cts = this._invocationCts.get(sessionResource);
		if (cts) {
			cts.cancel();
			cts.dispose();
			this._invocationCts.delete(sessionResource);
		}
		this._onDidEndSession.fire(sessionResource);
	}

	private _clearProviderEvents(sessionResource: URI): void {
		const buffer = this._sessionBuffers.get(sessionResource);
		if (buffer) {
			const coreEvents = buffer.toArray().filter(e => !this._providerEvents.has(e));
			buffer.clear();
			for (const e of coreEvents) {
				buffer.push(e);
			}
		}
		this._seenEventIds.delete(sessionResource);
		this._onDidClearProviderEvents.fire(sessionResource);
	}

	async resolveEvent(eventId: string): Promise<IChatDebugResolvedEventContent | undefined> {
		for (const provider of this._providers) {
			if (provider.resolveChatDebugLogEvent) {
				try {
					const resolved = await provider.resolveChatDebugLogEvent(eventId, CancellationToken.None);
					if (resolved !== undefined) {
						return resolved;
					}
				} catch (err) {
					onUnexpectedError(err);
				}
			}
		}
		return undefined;
	}

	isCoreEvent(event: IChatDebugEvent): boolean {
		return !this._providerEvents.has(event);
	}

	setImportedSessionTitle(sessionResource: URI, title: string): void {
		this._importedSessionTitles.set(sessionResource, title);
	}

	getImportedSessionTitle(sessionResource: URI): string | undefined {
		return this._importedSessionTitles.get(sessionResource);
	}

	addAvailableSessionResources(resources: readonly { uri: URI; title?: string }[]): void {
		let added = false;
		for (const { uri, title } of resources) {
			const key = uri.toString();
			if (!this._availableSessionResourceSet.has(key)) {
				this._availableSessionResourceSet.add(key);
				this._availableSessionResources.push(uri);
				added = true;
			}
			if (title) {
				this._historicalSessionTitles.set(uri, title);
			}
		}
		if (added) {
			this._onDidChangeAvailableSessionResources.fire();
		}
	}

	private readonly _availableSessionsFetchers = new Set<{ readonly fetcher: (token: CancellationToken) => Promise<{ uri: URI; title?: string }[]>; started: boolean }>();
	private _availableSessionsRequested = false;

	getAvailableSessionResources(): readonly URI[] {
		this._availableSessionsRequested = true;
		this._tryFetchAvailableSessions();

		const known = new Set(this._sessionOrder.map(u => u.toString()));
		const result = [...this._sessionOrder];
		for (const uri of this._availableSessionResources) {
			if (!known.has(uri.toString())) {
				known.add(uri.toString());
				result.push(uri);
			}
		}
		return result;
	}

	registerAvailableSessionsFetcher(fetcher: (token: CancellationToken) => Promise<{ uri: URI; title?: string }[]>): IDisposable {
		const entry = { fetcher, started: false };
		this._availableSessionsFetchers.add(entry);
		this._tryFetchAvailableSessions();
		return toDisposable(() => this._availableSessionsFetchers.delete(entry));
	}

	private _tryFetchAvailableSessions(): void {
		if (!this._availableSessionsRequested) {
			return;
		}
		for (const entry of this._availableSessionsFetchers) {
			if (entry.started) {
				continue;
			}
			entry.started = true;
			entry.fetcher(CancellationToken.None).then(entries => {
				if (entries.length > 0) {
					this.addAvailableSessionResources(entries);
				}
			}).catch(onUnexpectedError);
		}
	}

	getHistoricalSessionTitle(sessionResource: URI): string | undefined {
		return this._historicalSessionTitles.get(sessionResource);
	}

	async exportLog(sessionResource: URI): Promise<Uint8Array | undefined> {
		for (const provider of this._providers) {
			if (provider.provideChatDebugLogExport) {
				try {
					const data = await provider.provideChatDebugLogExport(sessionResource, CancellationToken.None);
					if (data !== undefined) {
						return data;
					}
				} catch (err) {
					onUnexpectedError(err);
				}
			}
		}
		return undefined;
	}

	async importLog(data: Uint8Array): Promise<URI | undefined> {
		for (const provider of this._providers) {
			if (provider.resolveChatDebugLogImport) {
				try {
					const sessionUri = await provider.resolveChatDebugLogImport(data, CancellationToken.None);
					if (sessionUri !== undefined) {
						this._importedSessions.set(sessionUri, true);
						return sessionUri;
					}
				} catch (err) {
					onUnexpectedError(err);
				}
			}
		}
		return undefined;
	}

	override dispose(): void {
		for (const cts of this._invocationCts.values()) {
			cts.cancel();
			cts.dispose();
		}
		this._invocationCts.clear();
		this.clear();
		this._providers.clear();
		super.dispose();
	}
}
