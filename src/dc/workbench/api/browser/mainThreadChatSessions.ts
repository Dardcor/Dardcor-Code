/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellationError } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter } from '../../../base/common/event.js';
import { IMarkdownString, MarkdownString, markdownStringEqual } from '../../../base/common/htmlContent.js';
import { Disposable, DisposableMap, DisposableResourceMap, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../base/common/map.js';
import { revive } from '../../../base/common/marshalling.js';
import { equals } from '../../../base/common/objects.js';
import { autorun, IObservable, observableSignalFromEvent, observableValue } from '../../../base/common/observable.js';
import { isEqual } from '../../../base/common/resources.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IChatWidgetService, isIChatViewViewContext } from '../../contrib/chat/browser/chat.js';
import { getInProgressSessionDescription } from '../../contrib/chat/browser/chatSessions/chatSessionDescription.js';
import { getSessionStatusForModel } from '../../contrib/chat/browser/chatSessions/chatSessions.contribution.js';
import { IChatEditorOptions } from '../../contrib/chat/browser/widgetHosts/editor/chatEditor.js';
import { ChatEditorInput } from '../../contrib/chat/browser/widgetHosts/editor/chatEditorInput.js';
import { IChatRequestVariableEntry } from '../../contrib/chat/common/attachments/chatVariableEntries.js';
import { IChatDebugService } from '../../contrib/chat/common/chatDebugService.js';
import { IChatContentInlineReference, IChatDetail, IChatProgress, IChatService, IChatSessionTiming } from '../../contrib/chat/common/chatService/chatService.js';
import { ChatSessionOptionsMap, ChatSessionStatus, IChatNewSessionRequest, IChatSession, IChatSessionContentProvider, IChatSessionHistoryItem, IChatSessionItem, IChatSessionItemController, IChatSessionItemsDelta, IChatSessionProviderOptionGroup, IChatSessionProviderOptionItem, IChatSessionRequestHistoryItem, IChatSessionsService, ReadonlyChatSessionOptionsMap } from '../../contrib/chat/common/chatSessionsService.js';
import { ChatAgentLocation } from '../../contrib/chat/common/constants.js';
import { IChatModel } from '../../contrib/chat/common/model/chatModel.js';
import { getChatSessionType } from '../../contrib/chat/common/model/chatUri.js';
import { IChatAgentRequest } from '../../contrib/chat/common/participants/chatAgents.js';
import { IChatArtifactsService } from '../../contrib/chat/common/tools/chatArtifactsService.js';
import { IChatTodoListService } from '../../contrib/chat/common/tools/chatTodoListService.js';
import { IEditorGroupsService } from '../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { Dto } from '../../services/extensions/common/proxyIdentifier.js';
import { ChatSessionContentContextDto, ExtHostChatSessionsShape, ExtHostContext, IChatProgressDto, IChatSessionHistoryItemDto, IChatSessionItemsChange, IChatSessionRequestHistoryItemDto, MainContext, MainThreadChatSessionsShape } from '../common/extHost.protocol.js';

function stringOrMarkdownEqual(a: string | IMarkdownString | undefined, b: string | IMarkdownString | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	if (typeof a === 'string' || typeof b === 'string') {
		return false;
	}
	return markdownStringEqual(a, b);
}

export class ObservableChatSession extends Disposable implements IChatSession {

	readonly sessionResource: URI;
	readonly providerHandle: number;
	readonly history: Array<IChatSessionHistoryItem>;
	title?: string;
	private _options?: ChatSessionOptionsMap;
	public get options(): ReadonlyChatSessionOptionsMap | undefined {
		return this._options ? new Map(this._options) : undefined;
	}
	private readonly _progressObservable = observableValue<IChatProgress[]>(this, []);
	private readonly _isCompleteObservable = observableValue<boolean>(this, false);

	private readonly _onWillDispose = new Emitter<void>();
	readonly onWillDispose = this._onWillDispose.event;

	private readonly _pendingProgressChunks = new Map<string, IChatProgress[]>();
	private _isInitialized = false;
	private _interruptionWasCanceled = false;
	private _disposalPending = false;

	private _inFlightRequestCount = 0;

	private _initializationPromise?: Promise<void>;

	interruptActiveResponseCallback?: () => Promise<boolean>;
	requestHandler?: (
		request: IChatAgentRequest,
		progress: (progress: IChatProgress[]) => void,
		history: any[],
		token: CancellationToken
	) => Promise<void>;
	forkSession?: (request: IChatSessionRequestHistoryItem | undefined, token: CancellationToken) => Promise<IChatSessionItem>;

	private readonly _proxy: ExtHostChatSessionsShape;
	private readonly _providerHandle: number;
	private readonly _logService: ILogService;
	private readonly _dialogService: IDialogService;

	get progressObs(): IObservable<IChatProgress[]> {
		return this._progressObservable;
	}

	get isCompleteObs(): IObservable<boolean> {
		return this._isCompleteObservable;
	}

	constructor(
		resource: URI,
		providerHandle: number,
		proxy: ExtHostChatSessionsShape,
		logService: ILogService,
		dialogService: IDialogService
	) {
		super();

		this.sessionResource = resource;
		this.providerHandle = providerHandle;
		this.history = [];
		this._proxy = proxy;
		this._providerHandle = providerHandle;
		this._logService = logService;
		this._dialogService = dialogService;
	}

	initialize(token: CancellationToken, context: ChatSessionContentContextDto): Promise<void> {
		if (!this._initializationPromise) {
			this._initializationPromise = this._doInitializeContent(token, context);
		}
		return this._initializationPromise;
	}

	private async _doInitializeContent(token: CancellationToken, context: ChatSessionContentContextDto): Promise<void> {
		try {
			const sessionContent = await raceCancellationError(
				this._proxy.$provideChatSessionContent(this._providerHandle, this.sessionResource, context, token),
				token
			);

			this._options = sessionContent.options ? ChatSessionOptionsMap.fromRecord(sessionContent.options) : undefined;
			this.title = sessionContent.title;
			this.history.length = 0;
			this.history.push(...sessionContent.history.map((turn: IChatSessionHistoryItemDto) => {
				if (turn.type === 'request') {
					const variables = turn.variableData?.variables.map(v => {
						const entry = {
							...v,
							value: revive(v.value)
						};
						return entry as IChatRequestVariableEntry;
					});

					return {
						type: 'request' as const,
						prompt: turn.prompt,
						participant: turn.participant,
						command: turn.command,
						variableData: variables ? { variables } : undefined,
						id: turn.id,
						modelId: turn.modelId,
						modeInstructions: turn.modeInstructions ? revive(turn.modeInstructions) : undefined,
					} satisfies IChatSessionRequestHistoryItem;
				}

				return {
					type: 'response' as const,
					parts: turn.parts.map((part: IChatProgressDto) => revive(part) as IChatProgress),
					participant: turn.participant,
					details: turn.details,
				};
			}));

			if (sessionContent.hasActiveResponseCallback && !this.interruptActiveResponseCallback) {
				this.interruptActiveResponseCallback = async () => {
					const confirmInterrupt = () => {
						if (this._disposalPending) {
							this._proxy.$disposeChatSessionContent(this._providerHandle, this.sessionResource);
							this._disposalPending = false;
						}
						this._proxy.$interruptChatSessionActiveResponse(this._providerHandle, this.sessionResource, 'ongoing');
						return true;
					};

					if (sessionContent.supportsInterruption) {
						return confirmInterrupt();
					}

					return this._dialogService.confirm({
						message: localize('interruptActiveResponse', 'Are you sure you want to interrupt the active session?')
					}).then(confirmed => {
						if (confirmed.confirmed) {
							return confirmInterrupt();
						} else {
							this._addProgress([{
								kind: 'progressMessage',
								content: { value: '', isTrusted: false }
							}]);
							this._interruptionWasCanceled = true;
							if (this._disposalPending) {
								this._logService.info(`Canceling deferred disposal for session ${this.sessionResource} (user canceled interruption)`);
								this._disposalPending = false;
							}
							return false;
						}
					});
				};
			}

			if (sessionContent.hasRequestHandler && !this.requestHandler) {
				this.requestHandler = async (
					request: IChatAgentRequest,
					progress: (progress: IChatProgress[]) => void,
					history: any[],
					token: CancellationToken
				) => {
					this._inFlightRequestCount++;
					this._progressObservable.set([], undefined);
					this._isCompleteObservable.set(false, undefined);

					let lastProgressLength = 0;
					const progressDisposable = autorun(reader => {
						const progressArray = this._progressObservable.read(reader);
						const isComplete = this._isCompleteObservable.read(reader);

						if (progressArray.length > lastProgressLength) {
							const newProgress = progressArray.slice(lastProgressLength);
							progress(newProgress);
							lastProgressLength = progressArray.length;
						}

						if (isComplete) {
							progressDisposable.dispose();
						}
					});

					try {
						await this._proxy.$invokeChatSessionRequestHandler(this._providerHandle, this.sessionResource, request, history, token);

						if (!this._isCompleteObservable.get() && !this.interruptActiveResponseCallback) {
							this._markComplete();
						}
					} catch (error) {
						const errorProgress: IChatProgress = {
							kind: 'progressMessage',
							content: { value: `Error: ${error instanceof Error ? error.message : String(error)}`, isTrusted: false }
						};

						this._addProgress([errorProgress]);
						this._markComplete();
						throw error;
					} finally {
						progressDisposable.dispose();
						this._inFlightRequestCount--;
						if (this._disposalPending && this._inFlightRequestCount === 0 && !this.interruptActiveResponseCallback) {
							this._disposalPending = false;
							this._proxy.$disposeChatSessionContent(this._providerHandle, this.sessionResource);
						}
					}
				};
			}

			if (sessionContent.hasForkHandler && !this.forkSession) {
				this.forkSession = async (request: IChatSessionRequestHistoryItem | undefined, token: CancellationToken) => {
					const result = await this._proxy.$forkChatSession(this._providerHandle, this.sessionResource, request ? this.toRequestDto(request) : undefined, token);
					return revive(result) as IChatSessionItem;
				};
			}

			this._isInitialized = true;

			const hasActiveResponse = sessionContent.hasActiveResponseCallback;
			const hasRequestHandler = sessionContent.hasRequestHandler;
			const hasAnyCapability = hasActiveResponse || hasRequestHandler;

			for (const [requestId, chunks] of this._pendingProgressChunks) {
				this._logService.debug(`Processing ${chunks.length} pending progress chunks for session ${this.sessionResource}, requestId ${requestId}`);
				this._addProgress(chunks);
			}
			this._pendingProgressChunks.clear();

			if (!hasAnyCapability) {
				this._isCompleteObservable.set(true, undefined);
			}

		} catch (error) {
			this._logService.error(`Failed to initialize chat session ${this.sessionResource}:`, error);
			throw error;
		}
	}

	handleProgressChunk(requestId: string, progress: IChatProgress[]): void {
		if (!this._isInitialized) {
			const existing = this._pendingProgressChunks.get(requestId) || [];
			this._pendingProgressChunks.set(requestId, [...existing, ...progress]);
			this._logService.debug(`Queuing ${progress.length} progress chunks for session ${this.sessionResource}, requestId ${requestId} (session not initialized)`);
			return;
		}

		this._addProgress(progress);
	}

	handleProgressComplete(requestId: string): void {
		this._pendingProgressChunks.delete(requestId);

		if (this._isInitialized) {
			if (!this._interruptionWasCanceled) {
				this._markComplete();
			} else {
				this._interruptionWasCanceled = false;
			}
		}
	}

	private _addProgress(progress: IChatProgress[]): void {
		const currentProgress = this._progressObservable.get();
		this._progressObservable.set([...currentProgress, ...progress], undefined);
	}

	private _markComplete(): void {
		if (!this._isCompleteObservable.get()) {
			this._isCompleteObservable.set(true, undefined);
		}
	}

	private toRequestDto(request: IChatSessionRequestHistoryItem): IChatSessionRequestHistoryItemDto {
		return {
			type: 'request',
			id: request.id,
			prompt: request.prompt,
			participant: request.participant,
			command: request.command,
			variableData: undefined,
			modelId: request.modelId,
			modeInstructions: request.modeInstructions,
		};
	}

	override dispose(): void {
		this._onWillDispose.fire();
		this._onWillDispose.dispose();
		this._pendingProgressChunks.clear();

		if (this.interruptActiveResponseCallback && !this._interruptionWasCanceled) {
			this._disposalPending = true;
		} else if (this._inFlightRequestCount > 0) {
			this._disposalPending = true;
		} else {
			this._proxy.$disposeChatSessionContent(this._providerHandle, this.sessionResource);
		}
		super.dispose();
	}
}

class MainThreadChatSessionItemController extends Disposable implements IChatSessionItemController {

	private readonly _proxy: ExtHostChatSessionsShape;
	private readonly _handle: number;
	private _supportsResolve: boolean;

	private readonly _onDidChangeChatSessionItems = this._register(new Emitter<IChatSessionItemsDelta>());
	public readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;

	private readonly _modelListeners = this._register(new DisposableResourceMap());
	private readonly _resolveCache = new ResourceMap<Promise<IChatSessionItem | undefined>>();
	private readonly _resolving = new ResourceMap<true>();

	private _isDisposed = false;

	constructor(
		proxy: ExtHostChatSessionsShape,
		chatSessionType: string,
		handle: number,
		supportsResolve: boolean,
		@IChatService private readonly _chatService: IChatService,
	) {
		super();

		this._proxy = proxy;
		this._handle = handle;
		this._supportsResolve = supportsResolve;
		const addModelListeners = async (model: IChatModel) => {
			if (getChatSessionType(model.sessionResource) !== chatSessionType) {
				return;
			}

			await this.refresh(CancellationToken.None);
			if (this._isDisposed) {
				return;
			}

			this.tryUpdateItemForModel(model);

			const requestChangeListener = model.lastRequestObs.map(last => last?.response && observableSignalFromEvent('chatSessions.modelRequestChangeListener', last.response.onDidChange));
			const modelChangeListener = observableSignalFromEvent('chatSessions.modelChangeListener', model.onDidChange);
			this._modelListeners.set(model.sessionResource, autorun(reader => {
				requestChangeListener.read(reader)?.read(reader);
				modelChangeListener.read(reader);

				this.tryUpdateItemForModel(model);
			}));
		};

		this._register(_chatService.onDidCreateModel(model => addModelListeners(model)));
		for (const model of _chatService.chatModels.get()) {
			addModelListeners(model);
		}

		this._register(_chatService.onDidDisposeSession(e => {
			for (const sessionResource of e.sessionResources) {
				this._modelListeners.deleteAndDispose(sessionResource);
			}
		}));
	}

	override dispose(): void {
		this._isDisposed = true;
		this._resolveCache.clear();
		super.dispose();
	}

	private readonly _items = new ResourceMap<MainThreadChatSessionItem>();
	get items(): IChatSessionItem[] {
		return Array.from(this._items.values());
	}

	refresh(token: CancellationToken): Promise<void> {
		return this._proxy.$refreshChatSessionItems(this._handle, token);
	}

	async newChatSessionItem(request: IChatNewSessionRequest, token: CancellationToken): Promise<IChatSessionItem | undefined> {
		const dto = await raceCancellationError(this._proxy.$newChatSessionItem(this._handle, {
			prompt: request.prompt,
			command: request.command,
			initialSessionOptions: request.initialSessionOptions ? ChatSessionOptionsMap.toStrValueArray(request.initialSessionOptions) : undefined,
		}, token), token);
		if (!dto) {
			return undefined;
		}
		const item = this.addOrUpdateItem(dto);
		return item;
	}

	async acceptChange(change: { readonly addedOrUpdated: readonly Dto<IChatSessionItem>[]; readonly removed: readonly URI[] }): Promise<void> {
		const addedOrUpdatedItems: MainThreadChatSessionItem[] = [];
		for (const item of change.addedOrUpdated) {
			const resource = URI.revive(item.resource);
			if (!this._resolving.has(resource)) {
				this._resolveCache.delete(resource);
			}
			addedOrUpdatedItems.push(await this.addOrUpdateItem(item));
		}
		for (const uri of change.removed) {
			this._resolveCache.delete(uri);
			this._items.delete(uri);
		}
		this._onDidChangeChatSessionItems.fire({
			addedOrUpdated: addedOrUpdatedItems,
			removed: change.removed,
		});
	}

	private async addOrUpdateItem(dto: Dto<IChatSessionItem>): Promise<MainThreadChatSessionItem> {
		const resource = URI.revive(dto.resource);
		const existing = this._items.get(resource);
		const updated = new MainThreadChatSessionItem(dto, this._chatService.getSession(resource), await this._chatService.getMetadataForSession(resource));
		if (existing?.isEqual(updated)) {
			return existing;
		}

		if (existing && existing.label !== updated.label && this._chatService.getSession(resource)) {
			this._chatService.setSessionTitle(resource, updated.label);
		}

		this._items.set(resource, updated);
		this._onDidChangeChatSessionItems.fire({
			addedOrUpdated: [updated],
		});
		return updated;
	}

	private async tryUpdateItemForModel(model: IChatModel): Promise<void> {
		const resource = model.sessionResource;
		const existing = this._items.get(resource);
		if (existing) {
			this.addOrUpdateItem(existing);
		}
	}

	async getNewChatSessionInputState(sessionResource: URI, token: CancellationToken): Promise<readonly IChatSessionProviderOptionGroup[] | undefined> {
		const optionGroups = await this._proxy.$provideChatSessionInputState(this._handle, sessionResource, token);
		if (!optionGroups?.length) {
			return undefined;
		}
		return optionGroups;
	}

	async resolveChatSessionItem(resource: URI, token: CancellationToken): Promise<IChatSessionItem | undefined> {
		if (!this._supportsResolve) {
			return undefined;
		}

		const cached = this._resolveCache.get(resource);
		if (cached) {
			return cached;
		}

		const promise = this._doResolveItem(resource, token).catch(
			err => {
				this._resolveCache.delete(resource);
				throw err;
			}
		);
		this._resolveCache.set(resource, promise);
		return promise;
	}

	private async _doResolveItem(resource: URI, token: CancellationToken): Promise<IChatSessionItem | undefined> {
		const expectedItem = this._items.get(resource);

		this._resolving.set(resource, true);
		let dto: Dto<IChatSessionItem> | undefined;
		try {
			dto = await raceCancellationError(this._proxy.$resolveChatSessionItem(this._handle, resource, token), token);
		} finally {
			this._resolving.delete(resource);
		}
		if (!dto) {
			return undefined;
		}

		if (this._items.get(resource) !== expectedItem) {
			return this._items.get(resource);
		}

		const updated = new MainThreadChatSessionItem(
			dto,
			this._chatService.getSession(resource),
			await this._chatService.getMetadataForSession(resource)
		);

		if (this._items.get(resource) !== expectedItem) {
			return this._items.get(resource);
		}


		if (expectedItem?.isEqual(updated)) {
			return expectedItem;
		}

		this._items.set(resource, updated);
		this._onDidChangeChatSessionItems.fire({
			addedOrUpdated: [updated],
		});
		return updated;
	}

	setSupportsResolve(supportsResolve: boolean): void {
		if (this._supportsResolve === supportsResolve) {
			return;
		}
		this._supportsResolve = supportsResolve;
		if (supportsResolve) {
			this._resolveCache.clear();
		}
	}
}

class MainThreadChatSessionItem implements IChatSessionItem {
	readonly resource: URI;

	readonly label: string;
	readonly iconPath?: ThemeIcon;
	readonly badge?: string | IMarkdownString;
	readonly description?: string | IMarkdownString;
	readonly status?: ChatSessionStatus;
	readonly tooltip?: string | IMarkdownString;
	readonly timing: IChatSessionTiming;
	readonly changes?: IChatSessionItem['changes'];
	readonly archived?: boolean;
	readonly metadata?: { readonly [key: string]: unknown };
	readonly legacyResource?: URI;

	constructor(dto: Dto<IChatSessionItem>, model: IChatModel | undefined, detailOverrides: IChatDetail | undefined) {
		this.resource = URI.revive(dto.resource);
		this.label = dto.label;
		this.timing = dto.timing;
		this.iconPath = dto.iconPath;
		this.badge = reviveMarkdownString(dto.badge);
		this.tooltip = reviveMarkdownString(dto.tooltip);
		this.archived = dto.archived;
		this.metadata = dto.metadata;
		this.legacyResource = dto.legacyResource ? URI.revive(dto.legacyResource) : undefined;

		this.description = (model && getInProgressSessionDescription(model)) ?? reviveMarkdownString(dto.description);
		this.status = (model && getSessionStatusForModel(model)) ?? dto.status;

		this.changes = revive(dto.changes);

		if (detailOverrides && !this.changes) {
			const diffs = {
				files: detailOverrides.stats?.fileCount || 0,
				insertions: detailOverrides.stats?.added || 0,
				deletions: detailOverrides.stats?.removed || 0
			};
			if (diffs.files > 0 || diffs.insertions > 0 || diffs.deletions > 0) {
				this.changes = diffs;
			}
		}
	}

	isEqual(other: MainThreadChatSessionItem): boolean {
		return isEqual(this.resource, other.resource)
			&& this.label === other.label
			&& this.description === other.description
			&& this.status === other.status
			&& this.timing.created === other.timing.created
			&& this.timing.lastRequestStarted === other.timing.lastRequestStarted
			&& this.timing.lastRequestEnded === other.timing.lastRequestEnded
			&& equals(this.changes, other.changes)
			&& equals(this.iconPath, other.iconPath)
			&& stringOrMarkdownEqual(this.badge, other.badge)
			&& stringOrMarkdownEqual(this.tooltip, other.tooltip)
			&& this.archived === other.archived
			&& equals(this.metadata, other.metadata)
			&& isEqual(this.legacyResource, other.legacyResource);
	}
}


@extHostNamedCustomer(MainContext.MainThreadChatSessions)
export class MainThreadChatSessions extends Disposable implements MainThreadChatSessionsShape {
	private readonly _itemControllerRegistrations = this._register(new DisposableMap<number, IDisposable & {
		readonly chatSessionType: string;
		readonly controller: MainThreadChatSessionItemController;
	}>());
	private readonly _contentProvidersRegistrations = this._register(new DisposableMap<number>());
	private readonly _sessionTypeToHandle = new Map<string, number>();

	private readonly _activeSessions = new ResourceMap<ObservableChatSession>();
	private readonly _sessionDisposables = new ResourceMap<IDisposable>();

	private readonly _proxy: ExtHostChatSessionsShape;

	constructor(
		private readonly _extHostContext: IExtHostContext,
		@IChatSessionsService private readonly _chatSessionsService: IChatSessionsService,
		@IChatService private readonly _chatService: IChatService,
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@IChatTodoListService private readonly _chatTodoListService: IChatTodoListService,
		@IChatArtifactsService private readonly _chatArtifactsService: IChatArtifactsService,
		@IChatDebugService private readonly _chatDebugService: IChatDebugService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._proxy = this._extHostContext.getProxy(ExtHostContext.ExtHostChatSessions);

		this._register(this._chatSessionsService.onDidChangeSessionOptions(({ sessionResource, updates }) => {
			const sessionType = getChatSessionType(sessionResource);
			const handle = this._getHandleForSessionType(sessionType);
			this._logService.trace(`[MainThreadChatSessions] onRequestNotifyExtension received: sessionType '${sessionType}', handle ${handle}, ${updates.size} update(s)`);
			if (handle !== undefined) {
				this.notifyOptionsChange(handle, sessionResource, updates);
			} else {
				this._logService.warn(`[MainThreadChatSessions] Cannot notify option change for sessionType '${sessionType}': no provider registered. Registered types: [${Array.from(this._sessionTypeToHandle.keys()).join(', ')}]`);
			}
		}));
	}

	private _getHandleForSessionType(chatSessionType: string): number | undefined {
		return this._sessionTypeToHandle.get(chatSessionType);
	}

	$registerChatSessionItemController(handle: number, chatSessionType: string, supportsResolve: boolean): void {
		const disposables = new DisposableStore();

		const controller = disposables.add(this._instantiationService.createInstance(MainThreadChatSessionItemController, this._proxy, chatSessionType, handle, supportsResolve));
		disposables.add(this._chatSessionsService.registerChatSessionItemController(chatSessionType, controller));

		this._itemControllerRegistrations.set(handle, {
			chatSessionType,
			controller,
			dispose: () => disposables.dispose(),
		});

		this._refreshControllerInputState(handle, chatSessionType);
	}

	$updateChatSessionItemControllerCapabilities(handle: number, supportsResolve: boolean): void {
		const registration = this._itemControllerRegistrations.get(handle);
		if (!registration) {
			this._logService.warn(`No chat session item controller found for handle ${handle}`);
			return;
		}
		registration.controller.setSupportsResolve(supportsResolve);
	}

	private _refreshControllerInputState(handle: number, chatSessionType: string): void {
		this._proxy.$provideChatSessionInputState(handle, undefined, CancellationToken.None).then(optionGroups => {
			if (optionGroups?.length) {
				this._applyOptionGroups(handle, chatSessionType, undefined, optionGroups);
			}
		}).catch(err => this._logService.error('Error fetching chat session input state', err));
	}

	private _applyOptionGroups(handle: number, chatSessionType: string, sessionResourceComponents: UriComponents | undefined, optionGroups: readonly IChatSessionProviderOptionGroup[]): void {
		this._chatSessionsService.setOptionGroupsForSessionType(chatSessionType, handle, optionGroups);
		if (sessionResourceComponents) {
			const sessionResource = URI.revive(sessionResourceComponents);
			optionGroups.forEach(group => {
				if (group.selected) {
					this._chatSessionsService.setSessionOption(sessionResource, group.id, group.selected);
				}
			});
		}
	}

	private getController(handle: number): MainThreadChatSessionItemController {
		const registration = this._itemControllerRegistrations.get(handle);
		if (!registration) {
			throw new Error(`No chat session controller registered for handle ${handle}`);
		}
		return registration.controller;
	}

	async $updateChatSessionItems(controllerHandle: number, change: IChatSessionItemsChange): Promise<void> {
		const controller = this.getController(controllerHandle);
		controller.acceptChange({
			addedOrUpdated: change.addedOrUpdated,
			removed: change.removed.map(uri => URI.revive(uri))
		});
	}

	async $addOrUpdateChatSessionItem(controllerHandle: number, item: Dto<IChatSessionItem>): Promise<void> {
		const controller = this.getController(controllerHandle);
		controller.acceptChange({
			addedOrUpdated: [item],
			removed: []
		});
	}

	$onDidChangeChatSessionOptions(handle: number, sessionResourceComponents: UriComponents, updates: Record<string, string | IChatSessionProviderOptionItem>): void {
		const sessionResource = URI.revive(sessionResourceComponents);
		this._chatSessionsService.updateSessionOptions(sessionResource, ChatSessionOptionsMap.fromRecord(updates));
	}

	async $onDidCommitChatSessionItem(handle: number, originalComponents: UriComponents, modifiedCompoennts: UriComponents): Promise<void> {
		const originalResource = URI.revive(originalComponents);
		const modifiedResource = URI.revive(modifiedCompoennts);

		this._logService.trace(`$onDidCommitChatSessionItem: handle(${handle}), original(${originalResource}), modified(${modifiedResource})`);
		const chatSessionType = this._itemControllerRegistrations.get(handle)?.chatSessionType;
		if (!chatSessionType) {
			this._logService.error(`No chat session type found for provider handle ${handle}`);
			return;
		}

		const originalEditor = this._editorService.editors.find(editor => editor.resource?.toString() === originalResource.toString());
		const originalModel = this._chatService.acquireExistingSession(originalResource);
		const contribution = this._chatSessionsService.getAllChatSessionContributions().find(c => c.type === chatSessionType);

		try {

			this._chatTodoListService.migrateTodos(originalResource, modifiedResource);

			this._chatArtifactsService.getArtifacts(originalResource).migrate(this._chatArtifactsService.getArtifacts(modifiedResource));

			if (chatSessionType === 'copilotcli') {
				this._chatDebugService.invokeProviders(modifiedResource).catch(() => { });
			}

			const originalGroup =
				this.editorGroupService.groups.find(group => group.editors.some(editor => isEqual(editor.resource, originalResource)))
				?? this.editorGroupService.activeGroup;

			const options: IChatEditorOptions = {
				title: {
					preferred: originalEditor?.getName() || undefined,
					fallback: localize('chatEditorContributionName', "{0}", contribution?.displayName),
				}
			};

			const newSession = await this._chatSessionsService.getOrCreateChatSession(
				URI.revive(modifiedResource),
				CancellationToken.None,
			);

			if (originalEditor) {
				newSession.transferredState = originalEditor instanceof ChatEditorInput
					? { editingSession: originalEditor.transferOutEditingSession(), inputState: originalModel?.object?.inputModel.toJSON() }
					: undefined;

				await this._editorService.replaceEditors([{
					editor: originalEditor,
					replacement: {
						resource: modifiedResource,
						options,
					},
				}], originalGroup);

				this._resendPendingRequests(originalResource, modifiedResource);
				return;
			}

			if (originalModel) {
				newSession.transferredState = {
					editingSession: originalModel.object.editingSession,
					inputState: originalModel.object.inputModel.toJSON()
				};
			}

			const chatViewWidget = this._chatWidgetService.getWidgetBySessionResource(originalResource);
			if (chatViewWidget && isIChatViewViewContext(chatViewWidget.viewContext)) {
				await this._chatWidgetService.openSession(modifiedResource, undefined, { preserveFocus: true });
			} else if (!chatViewWidget) {
				const ref = await this._chatService.acquireOrLoadSession(modifiedResource, ChatAgentLocation.Chat, CancellationToken.None);
				ref?.dispose();
			}

			this._resendPendingRequests(originalResource, modifiedResource);

			this._chatSessionsService.fireSessionCommitted(originalResource, modifiedResource);
		} finally {
			originalModel?.dispose();
		}
	}

	private _resendPendingRequests(originalResource: URI, modifiedResource: URI): void {
		this._chatService.migrateRequests(originalResource, modifiedResource);
	}

	private async _provideChatSessionContent(providerHandle: number, sessionResource: URI, token: CancellationToken): Promise<IChatSession> {
		const t0 = Date.now();
		this._logService.trace(`[MainThreadChatSessions] _provideChatSessionContent start handle=${providerHandle} uri=${sessionResource.toString()}`);

		let session = this._activeSessions.get(sessionResource);

		if (!session) {
			session = new ObservableChatSession(
				sessionResource,
				providerHandle,
				this._proxy,
				this._logService,
				this._dialogService
			);
			this._activeSessions.set(sessionResource, session);
			const disposable = session.onWillDispose(() => {
				this._activeSessions.delete(sessionResource);
				this._sessionDisposables.get(sessionResource)?.dispose();
				this._sessionDisposables.delete(sessionResource);
			});
			this._sessionDisposables.set(sessionResource, disposable);
		}

		try {
			const initialSessionOptions = this._chatSessionsService.getSessionOptions(sessionResource);
			await session.initialize(token, {
				initialSessionOptions: initialSessionOptions ? [...initialSessionOptions].map(([optionId, value]) => ({ optionId, value: typeof value === 'string' ? value : value?.id })) : undefined,
			});
			if (session.options) {
				for (const [_, handle] of this._sessionTypeToHandle) {
					if (handle === providerHandle) {
						for (const [optionId, value] of session.options) {
							this._chatSessionsService.setSessionOption(sessionResource, optionId, value);
						}
						break;
					}
				}
			}
			this._logService.trace(`[MainThreadChatSessions] _provideChatSessionContent done total=${Date.now() - t0}ms handle=${providerHandle} uri=${sessionResource.toString()}`);
			return session;
		} catch (error) {
			session.dispose();
			this._logService.error(`Error providing chat session content for handle ${providerHandle} and resource ${sessionResource.toString()}:`, error);
			throw error;
		}
	}

	$unregisterChatSessionItemController(handle: number): void {
		this._itemControllerRegistrations.deleteAndDispose(handle);
	}

	$registerChatSessionContentProvider(handle: number, chatSessionScheme: string): void {
		const provider: IChatSessionContentProvider = {
			provideChatSessionContent: (resource, token) => this._provideChatSessionContent(handle, resource, token)
		};

		this._sessionTypeToHandle.set(chatSessionScheme, handle);
		this._contentProvidersRegistrations.set(handle, this._chatSessionsService.registerChatSessionContentProvider(chatSessionScheme, provider));
		this._refreshProviderOptions(handle, chatSessionScheme);
	}

	$unregisterChatSessionContentProvider(handle: number): void {
		this._contentProvidersRegistrations.deleteAndDispose(handle);
		for (const [sessionType, h] of this._sessionTypeToHandle) {
			if (h === handle) {
				this._sessionTypeToHandle.delete(sessionType);
				break;
			}
		}

		for (const [key, session] of this._activeSessions) {
			if (session.providerHandle === handle) {
				session.dispose();
				this._activeSessions.delete(key);
			}
		}
	}

	async $handleProgressChunk(handle: number, sessionResource: UriComponents, requestId: string, chunks: (IChatProgressDto | [IChatProgressDto, number])[]): Promise<void> {
		const resource = URI.revive(sessionResource);
		const observableSession = this._activeSessions.get(resource);
		if (!observableSession) {
			this._logService.warn(`No session found for progress chunks: handle ${handle}, sessionResource ${resource}, requestId ${requestId}`);
			return;
		}

		const chatProgressParts: IChatProgress[] = chunks.map(chunk => {
			const [progress] = Array.isArray(chunk) ? chunk : [chunk];
			return revive(progress) as IChatProgress;
		});

		observableSession.handleProgressChunk(requestId, chatProgressParts);
	}

	$handleProgressComplete(handle: number, sessionResource: UriComponents, requestId: string) {
		const resource = URI.revive(sessionResource);
		const observableSession = this._activeSessions.get(resource);
		if (!observableSession) {
			this._logService.warn(`No session found for progress completion: handle ${handle}, sessionResource ${resource}, requestId ${requestId}`);
			return;
		}

		observableSession.handleProgressComplete(requestId);
	}

	$handleAnchorResolve(handle: number, sesssionResource: UriComponents, requestId: string, requestHandle: string, anchor: Dto<IChatContentInlineReference>): void {
	}

	$onDidChangeChatSessionProviderOptions(handle: number): void {
		let sessionType: string | undefined;
		for (const [type, h] of this._sessionTypeToHandle) {
			if (h === handle) {
				sessionType = type;
				break;
			}
		}

		if (!sessionType) {
			this._logService.warn(`No session type found for chat session content provider handle ${handle} when refreshing provider options`);
			return;
		}

		this._refreshProviderOptions(handle, sessionType);
	}

	$updateChatSessionInputState(controllerHandle: number, sessionResource: UriComponents, optionGroups: readonly IChatSessionProviderOptionGroup[]): void {
		const registration = this._itemControllerRegistrations.get(controllerHandle);
		if (!registration) {
			this._logService.warn(`No controller found for handle ${controllerHandle} when updating input state`);
			return;
		}

		this._applyOptionGroups(controllerHandle, registration.chatSessionType, sessionResource, optionGroups);
	}

	private _refreshProviderOptions(handle: number, chatSessionScheme: string): void {
		this._proxy.$provideChatSessionProviderOptions(handle, CancellationToken.None).then(options => {
			if (options?.optionGroups && options.optionGroups.length) {
				this._chatSessionsService.setOptionGroupsForSessionType(chatSessionScheme, handle, [...options.optionGroups]);
			}
		}).catch(err => this._logService.error('Error fetching chat session options', err));
	}

	override dispose(): void {
		for (const session of this._activeSessions.values()) {
			session.dispose();
		}
		this._activeSessions.clear();

		for (const disposable of this._sessionDisposables.values()) {
			disposable.dispose();
		}
		this._sessionDisposables.clear();

		super.dispose();
	}



	async notifyOptionsChange(handle: number, sessionResource: URI, updates: ReadonlyMap<string, string | IChatSessionProviderOptionItem | undefined>): Promise<void> {
		this._logService.trace(`[MainThreadChatSessions] notifyOptionsChange: starting proxy call for handle ${handle}, sessionResource ${sessionResource}`);
		try {
			await this._proxy.$provideHandleOptionsChange(handle, sessionResource, Object.fromEntries(updates), CancellationToken.None);
			this._logService.trace(`[MainThreadChatSessions] notifyOptionsChange: proxy call completed for handle ${handle}, sessionResource ${sessionResource}`);
		} catch (error) {
			this._logService.error(`[MainThreadChatSessions] notifyOptionsChange: error for handle ${handle}, sessionResource ${sessionResource}:`, error);
		}
	}
}

function reviveMarkdownString(value: string | IMarkdownString | undefined): string | MarkdownString | undefined {
	if (!value) {
		return undefined;
	}

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'object' && 'value' in value) {
		return MarkdownString.lift(value);
	}

	return undefined;
}
