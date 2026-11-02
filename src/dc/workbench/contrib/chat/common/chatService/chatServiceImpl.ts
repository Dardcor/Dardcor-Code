/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceCancellationError, raceTimeout, RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { BugIndicatingError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { Disposable, DisposableResourceMap, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { revive } from '../../../../../base/common/marshalling.js';
import { equals } from '../../../../../base/common/objects.js';
import { autorun, derived, IObservable, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { StopWatch } from '../../../../../base/common/stopwatch.js';
import { isDefined } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { OffsetRange } from '../../../../../editor/common/core/ranges/offsetRange.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Progress } from '../../../../../platform/progress/common/progress.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IChatEntitlementService } from '../../../../services/chat/common/chatEntitlementService.js';
import { IChatDebugService } from '../chatDebugService.js';
import { IMcpService } from '../../../mcp/common/mcpTypes.js';
import { awaitStatsForSession } from '../chat.js';
import { ChatPerfMark, clearChatMarks, markChat } from '../chatPerf.js';
import { IChatAgentAttachmentCapabilities, IChatAgentCommand, IChatAgentData, IChatAgentHistoryEntry, IChatAgentRequest, IChatAgentResult, IChatAgentService } from '../participants/chatAgents.js';
import { chatEditingSessionIsReady } from '../editing/chatEditingService.js';
import { ChatModel, ChatRequestModel, ChatRequestRemovalReason, IChatModel, IChatPendingRequest, IChatRequestModel, IChatRequestModeInfo, IChatRequestVariableData, IChatResponseModel, IExportableChatData, ISerializableChatData, ISerializableChatDataIn, ISerializableChatsData, ISerializedChatDataReference, normalizeSerializableChatData, toChatHistoryContent, updateRanges, ISerializableChatModelInputState, logChangesToStateModel } from '../model/chatModel.js';
import { ChatModelStore, IStartSessionProps } from '../model/chatModelStore.js';
import { chatAgentLeader, ChatRequestAgentPart, ChatRequestAgentSubcommandPart, ChatRequestSlashCommandPart, ChatRequestTextPart, chatSubcommandLeader, getPromptText, IParsedChatRequest } from '../requestParser/chatParserTypes.js';
import { ChatRequestParser } from '../requestParser/chatRequestParser.js';
import { ChatMcpServersStarting, ChatPendingRequestChangeClassification, ChatPendingRequestChangeEvent, ChatPendingRequestChangeEventName, ChatRequestQueueKind, ChatSendResult, ChatSendResultQueued, ChatSendResultSent, ChatStopCancellationNoopClassification, ChatStopCancellationNoopEvent, ChatStopCancellationNoopEventName, IChatCompleteResponse, IChatDetail, IChatFollowup, IChatModelReference, IChatProgress, IChatQuestionAnswers, IChatSendRequestOptions, IChatSendRequestResponseState, IChatService, IChatSessionStartOptions, IChatUserActionEvent, IRemotePendingRequest, ResponseModelState } from './chatService.js';
import { ChatRequestTelemetry, ChatServiceTelemetry } from './chatServiceTelemetry.js';
import { IChatSessionsService, isAgentHostTarget, isTerminalCommandPrompt, localChatSessionType } from '../chatSessionsService.js';
import { ChatSessionStore, IChatSessionEntryMetadata } from '../model/chatSessionStore.js';
import { IChatSlashCommandService } from '../participants/chatSlashCommands.js';
import { IChatTransferService } from '../model/chatTransferService.js';
import { chatSessionResourceToId, getChatSessionType, isUntitledChatSession, LocalChatSessionUri } from '../model/chatUri.js';
import { ChatRequestVariableSet, IChatRequestVariableEntry, isExplicitFileOrImageVariableEntry, isPromptTextVariableEntry } from '../attachments/chatVariableEntries.js';
import { IDynamicVariable } from '../attachments/chatVariables.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, SessionTypeSelectionReason } from '../constants.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { ChatMessageRole, IChatMessage, ILanguageModelsService } from '../languageModels.js';
import { ILanguageModelToolsService, ToolAndToolSetEnablementMap } from '../tools/languageModelToolsService.js';
import { ChatSessionOperationLog } from '../model/chatSessionOperationLog.js';
import { IPromptsService } from '../promptSyntax/service/promptsService.js';
import { AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING, TROUBLESHOOT_COMMAND_NAME, TROUBLESHOOT_SKILL_PATH, COPILOT_SKILL_URI_SCHEME } from '../promptSyntax/promptTypes.js';
import { ChatRequestHooks, mergeHooks } from '../promptSyntax/hookSchema.js';
import { ComputeAutomaticInstructions } from '../promptSyntax/computeAutomaticInstructions.js';
import { findLast } from '../../../../../base/common/arraysFind.js';
import { ChatMode } from '../chatModes.js';
import type { ICustomizationMigrationHint } from '../promptSyntax/service/customizationMigrationService.js';

const serializedChatKey = 'interactive.sessions';

function hasDraftInput(model: ChatModel): boolean {
	const state = model.inputModel.state.get();
	if (!state) {
		return false;
	}
	if (state.inputText.trim().length > 0) {
		return true;
	}
	return state.attachments.length > 0;
}

class CancellableRequest implements IDisposable {
	private readonly _yieldRequested: ISettableObservable<boolean> = observableValue(this, false);

	get yieldRequested(): IObservable<boolean> {
		return this._yieldRequested;
	}


	constructor(
		public readonly cancellationTokenSource: CancellationTokenSource,
		public requestId: string | undefined,
		public readonly responseCompletePromise: Promise<void> | undefined,
		public sendOptions: IChatSendRequestOptions | undefined,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService
	) { }

	dispose() {
		if (this.requestId) {
			this.toolsService.cancelToolCallsForRequest(this.requestId);
		}
		this.cancellationTokenSource.dispose();
	}

	cancel() {
		if (this.requestId) {
			this.toolsService.cancelToolCallsForRequest(this.requestId);
		}

		this.cancellationTokenSource.cancel();
	}

	setYieldRequested(): void {
		this._yieldRequested.set(true, undefined);
	}

	resetYieldRequested(): void {
		this._yieldRequested.set(false, undefined);
	}
}

const EMPTY_REFERENCES: ReadonlyArray<IDynamicVariable> = Object.freeze([]);
const EMPTY_TOOL_ENABLEMENT_MAP: ToolAndToolSetEnablementMap = ToolAndToolSetEnablementMap.fromEntries([]);

export function backfillRestoredPickerState(
	stateToApply: ISerializableChatModelInputState | undefined,
	savedState: ISerializableChatModelInputState | undefined,
	defaultAgentModeId: string,
): ISerializableChatModelInputState | undefined {
	if (!stateToApply || !savedState) {
		return stateToApply;
	}
	const mode = (stateToApply.mode.id === defaultAgentModeId && savedState.mode.id !== defaultAgentModeId)
		? savedState.mode
		: stateToApply.mode;
	if (mode === stateToApply.mode) {
		return stateToApply;
	}
	return { ...stateToApply, mode };
}

export function backfillTransferredModel(
	transferredState: ISerializableChatModelInputState | undefined,
	historyModel: ISerializableChatModelInputState['selectedModel'],
): ISerializableChatModelInputState | undefined {
	if (!transferredState || transferredState.selectedModel || !historyModel) {
		return transferredState;
	}
	return { ...transferredState, selectedModel: historyModel };
}

export class ChatService extends Disposable implements IChatService {
	declare _serviceBrand: undefined;

	private readonly _sessionModels: ChatModelStore;
	private readonly _persistDelayer: RunOnceScheduler;
	private readonly _pendingRequests = this._register(new DisposableResourceMap<CancellableRequest>());
	private readonly _queuedRequestDeferreds = new Map<string, DeferredPromise<ChatSendResult>>();
	private readonly _syntheticPendingRequests = new WeakSet<CancellableRequest>();

	private readonly _inFlightUntitledMaterializations = new ResourceMap<Promise<URI | undefined>>();
	private _saveModelsEnabled = true;

	private _transferredSessionResource: URI | undefined;
	public get transferredSessionResource(): URI | undefined {
		return this._transferredSessionResource;
	}

	private readonly _onDidSubmitRequest = this._register(new Emitter<{ readonly chatSessionResource: URI; readonly message?: IParsedChatRequest }>());
	public readonly onDidSubmitRequest = this._onDidSubmitRequest.event;

	public get onDidCreateModel() { return this._sessionModels.onDidCreateModel; }

	private readonly _onDidPerformUserAction = this._register(new Emitter<IChatUserActionEvent>());
	public readonly onDidPerformUserAction: Event<IChatUserActionEvent> = this._onDidPerformUserAction.event;

	private readonly _onDidReceiveQuestionCarouselAnswer = this._register(new Emitter<{ requestId: string; resolveId: string; answers: IChatQuestionAnswers | undefined }>());
	public readonly onDidReceiveQuestionCarouselAnswer = this._onDidReceiveQuestionCarouselAnswer.event;

	private readonly _onDidDisposeSession = this._register(new Emitter<{ readonly sessionResources: URI[]; reason: 'cleared' }>());
	public readonly onDidDisposeSession = this._onDidDisposeSession.event;

	private readonly _sessionFollowupCancelTokens = this._register(new DisposableResourceMap<CancellationTokenSource>());
	private readonly _chatServiceTelemetry: ChatServiceTelemetry;
	private readonly _chatSessionStore: ChatSessionStore;

	readonly requestInProgressObs: IObservable<boolean>;

	readonly chatModels: IObservable<Iterable<IChatModel>>;

	setSaveModelsEnabled(enabled: boolean): void {
		this._saveModelsEnabled = enabled;
	}

	waitForModelDisposals(): Promise<void> {
		return this._sessionModels.waitForModelDisposals();
	}

	private _customizationMigrationHintProvider: ((sessionResource: URI, token: CancellationToken) => Promise<ICustomizationMigrationHint | undefined>) | undefined;

	registerCustomizationMigrationHintProvider(provider: (sessionResource: URI, token: CancellationToken) => Promise<ICustomizationMigrationHint | undefined>): IDisposable {
		if (this._customizationMigrationHintProvider) {
			throw new BugIndicatingError('A customization migration hint provider is already registered');
		}

		this._customizationMigrationHintProvider = provider;
		return toDisposable(() => {
			if (this._customizationMigrationHintProvider === provider) {
				this._customizationMigrationHintProvider = undefined;
			}
		});
	}

	getPendingRequestSessionTypes(): readonly string[] {
		const sessionTypes = new Set<string>();
		for (const model of this._sessionModels.values()) {
			if (model.requestInProgress.get()) {
				sessionTypes.add(getChatSessionType(model.sessionResource));
			}
		}
		return Array.from(sessionTypes);
	}

	private get isEmptyWindow(): boolean {
		const workspace = this.workspaceContextService.getWorkspace();
		return !workspace.configuration && workspace.folders.length === 0;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IChatSlashCommandService private readonly chatSlashCommandService: IChatSlashCommandService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IChatTransferService private readonly chatTransferService: IChatTransferService,
		@IChatSessionsService private readonly chatSessionService: IChatSessionsService,
		@IMcpService private readonly mcpService: IMcpService,
		@IPromptsService private readonly promptsService: IPromptsService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IChatDebugService private readonly chatDebugService: IChatDebugService,
	) {
		super();

		this._sessionModels = this._register(instantiationService.createInstance(ChatModelStore, {
			createModel: (props: IStartSessionProps) => this._startSession(props),
			willDisposeModel: async (model: ChatModel) => {
				const localSessionId = LocalChatSessionUri.parseLocalSessionId(model.sessionResource);
				if (localSessionId && this.shouldStoreSession(model)) {
					if (model.getRequests().length === 0 && !model.customTitle) {
						logChangesToStateModel(model.inputModel, `disposing session ${model.sessionResource} (${localSessionId}) without title, deleting from storage`, undefined, undefined, this.logService);
						await this._chatSessionStore.deleteSession(localSessionId);
					} else if (this._saveModelsEnabled) {
						logChangesToStateModel(model.inputModel, `disposing session ${model.sessionResource} (${localSessionId}) with title, storing to storage`, undefined, undefined, this.logService);
						await this._chatSessionStore.storeSessions([model]);
					}
				} else if (!localSessionId && (model.getRequests().length > 0 || hasDraftInput(model))) {
					logChangesToStateModel(model.inputModel, `disposing external session ${model.sessionResource} with requests or draft input, storing metadata to storage`, undefined, undefined, this.logService);
					await this._chatSessionStore.storeSessionsMetadataOnly([model]);
				}
			}
		}));
		this._register(this._sessionModels.onDidDisposeModel(model => {
			clearChatMarks(model.sessionResource);
			this.chatDebugService.endSession(model.sessionResource);
			this._sessionFollowupCancelTokens.get(model.sessionResource)?.cancel();
			this._sessionFollowupCancelTokens.deleteAndDispose(model.sessionResource);
			this.chatSessionService.clearMaterializedSessionResource(model.sessionResource);
			this._onDidDisposeSession.fire({ sessionResources: [model.sessionResource], reason: 'cleared' });
		}));

		this._persistDelayer = this._register(new RunOnceScheduler(() => this.saveState(), 300));
		this._register(this._sessionModels.onDidCreateModel(model => {
			this._register(model.onDidChange(e => {
				if (e.kind === 'addRequest' || e.kind === 'completedRequest' || e.kind === 'setCustomTitle' || e.kind === 'removeRequest') {
					if (e.kind === 'completedRequest') {
						this.saveState();
					} else {
						this._persistDelayer.schedule();
					}
				}
			}));
		}));

		this._chatServiceTelemetry = this.instantiationService.createInstance(ChatServiceTelemetry);
		this._chatSessionStore = this._register(this.instantiationService.createInstance(ChatSessionStore));
		this._chatSessionStore.migrateDataIfNeeded(() => this.migrateData());

		const transferredData = this._chatSessionStore.getTransferredSessionData();
		if (transferredData) {
			this.trace('constructor', `Transferred session ${transferredData}`);
			this._transferredSessionResource = transferredData;
		}

		this._register(storageService.onWillSaveState(() => this.saveState()));

		this.chatModels = derived(this, reader => [...this._sessionModels.observable.read(reader).values()]);

		this.requestInProgressObs = derived(reader => {
			const models = this._sessionModels.observable.read(reader).values();
			return Iterable.some(models, model => model.requestInProgress.read(reader));
		});
	}

	public get editingSessions() {
		return [...this._sessionModels.values()].map(v => v.editingSession).filter(isDefined);
	}

	isEnabled(location: ChatAgentLocation): boolean {
		return this.chatAgentService.getContributedDefaultAgent(location) !== undefined;
	}

	private migrateData(): ISerializableChatsData | undefined {
		const sessionData = this.storageService.get(serializedChatKey, this.isEmptyWindow ? StorageScope.APPLICATION : StorageScope.WORKSPACE, '');
		if (sessionData) {
			const persistedSessions = this.deserializeChats(sessionData);
			const countsForLog = Object.keys(persistedSessions).length;
			if (countsForLog > 0) {
				this.info('migrateData', `Restored ${countsForLog} persisted sessions`);
			}

			return persistedSessions;
		}

		return;
	}

	private saveState(): void {
		if (!this._saveModelsEnabled) {
			return;
		}

		const liveLocalChats = Array.from(this._sessionModels.values())
			.filter(session => this.shouldStoreSession(session));

		const liveNonLocalChats = Array.from(this._sessionModels.values())
			.filter(session => !LocalChatSessionUri.parseLocalSessionId(session.sessionResource));

		this._chatSessionStore.updateAndFlushIndexSync(liveLocalChats, liveNonLocalChats);

		this._chatSessionStore.storeSessions(liveLocalChats);
		this._chatSessionStore.storeSessionsMetadataOnly(liveNonLocalChats);
	}

	private shouldStoreSession(session: ChatModel): boolean {
		if (session.isDeleted) {
			return false;
		}
		if (!LocalChatSessionUri.parseLocalSessionId(session.sessionResource)) {
			return false;
		}
		return session.initialLocation === ChatAgentLocation.Chat && !session.isImported;
	}

	notifyUserAction(action: IChatUserActionEvent): void {
		this._chatServiceTelemetry.notifyUserAction(action);
		this._onDidPerformUserAction.fire(action);
		if (action.action.kind === 'chatEditingSessionAction') {
			const model = this._sessionModels.get(action.sessionResource);
			if (model) {
				model.notifyEditingAction(action.action);
			}
		}
	}

	notifyQuestionCarouselAnswer(requestId: string, resolveId: string, answers: IChatQuestionAnswers | undefined): void {
		this._onDidReceiveQuestionCarouselAnswer.fire({ requestId, resolveId, answers });
	}

	async setChatSessionTitle(sessionResource: URI, title: string): Promise<void> {
		const model = this._sessionModels.get(sessionResource);
		if (model) {
			model.setCustomTitle(title);
		}

		const localSessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (localSessionId) {
			await this._chatSessionStore.setSessionTitle(localSessionId, title);
			this.saveState();
		}
	}

	private trace(method: string, message?: string): void {
		if (message) {
			this.logService.trace(`ChatService#${method}: ${message}`);
		} else {
			this.logService.trace(`ChatService#${method}`);
		}
	}

	private info(method: string, message?: string): void {
		if (message) {
			this.logService.info(`ChatService#${method}: ${message}`);
		} else {
			this.logService.info(`ChatService#${method}`);
		}
	}

	private error(method: string, message: string): void {
		this.logService.error(`ChatService#${method} ${message}`);
	}

	private deserializeChats(sessionData: string): ISerializableChatsData {
		try {
			const arrayOfSessions: ISerializableChatDataIn[] = revive(JSON.parse(sessionData));
			if (!Array.isArray(arrayOfSessions)) {
				throw new Error('Expected array');
			}

			const sessions = arrayOfSessions.reduce<ISerializableChatsData>((acc, session) => {
				for (const request of session.requests) {
					if (Array.isArray(request.response)) {
						request.response = request.response.map((response) => {
							if (typeof response === 'string') {
								return new MarkdownString(response);
							}
							return response;
						});
					} else if (typeof request.response === 'string') {
						request.response = [new MarkdownString(request.response)];
					}
				}

				acc[session.sessionId] = normalizeSerializableChatData(session);
				return acc;
			}, {});
			return sessions;
		} catch (err) {
			this.error('deserializeChats', `Malformed session data: ${err}. [${sessionData.substring(0, 20)}${sessionData.length > 20 ? '...' : ''}]`);
			return {};
		}
	}

	async getLocalSessionHistory(): Promise<IChatDetail[]> {
		const liveSessionItems = await this.getLiveSessionItems();
		const historySessionItems = await this.getHistorySessionItems();

		return [...liveSessionItems, ...historySessionItems];
	}

	async getLiveSessionItems(): Promise<IChatDetail[]> {
		return await Promise.all(Array.from(this._sessionModels.values())
			.filter(session => this.shouldBeInHistory(session))
			.map(chatModelToChatDetail));
	}

	async getHistorySessionItems(): Promise<IChatDetail[]> {
		const index = await this._chatSessionStore.getIndex();
		return Object.values(index)
			.filter(entry => !entry.isExternal)
			.filter(entry => !this._sessionModels.has(LocalChatSessionUri.forSession(entry.sessionId)) && entry.initialLocation === ChatAgentLocation.Chat && !entry.isEmpty)
			.map((entry): IChatDetail => {
				const sessionResource = LocalChatSessionUri.forSession(entry.sessionId);
				const { workingDirectory: workingDirectoryStr, ...rest } = entry;
				return ({
					...rest,
					sessionResource,
					isActive: this._sessionModels.has(sessionResource),
					workingDirectory: workingDirectoryStr ? URI.parse(workingDirectoryStr) : undefined,
				});
			});
	}

	async getMetadataForSession(sessionResource: URI): Promise<IChatDetail | undefined> {
		const index = await this._chatSessionStore.getIndex();
		const metadata: IChatSessionEntryMetadata | undefined = index[sessionResource.toString()];
		if (metadata) {
			const { workingDirectory: workingDirectoryStr, ...rest } = metadata;
			return {
				...rest,
				sessionResource,
				isActive: this._sessionModels.has(sessionResource),
				workingDirectory: workingDirectoryStr ? URI.parse(workingDirectoryStr) : undefined,
			};
		}

		return undefined;
	}

	private shouldBeInHistory(entry: ChatModel): boolean {
		return !entry.isImported && !entry.isDeleted && !!LocalChatSessionUri.parseLocalSessionId(entry.sessionResource) && entry.initialLocation === ChatAgentLocation.Chat;
	}

	async removeHistoryEntry(sessionResource: URI): Promise<void> {
		await this._chatSessionStore.deleteSession(this.toLocalSessionId(sessionResource));
		const model = this._sessionModels.get(sessionResource);
		if (model) {
			model.markDeleted();
		}
		this._onDidDisposeSession.fire({ sessionResources: [sessionResource], reason: 'cleared' });
	}

	async clearAllHistoryEntries(): Promise<void> {
		await this._chatSessionStore.clearAllSessions();
	}

	startNewLocalSession(location: ChatAgentLocation, options?: IChatSessionStartOptions): IChatModelReference {
		this.trace('startNewLocalSession');
		const sessionResource = LocalChatSessionUri.forSession(generateUuid());
		return this._sessionModels.acquireOrCreate({
			initialData: undefined,
			location,
			sessionResource,
			canUseTools: options?.canUseTools ?? true,
			disableBackgroundKeepAlive: options?.disableBackgroundKeepAlive
		}, options?.debugOwner ?? 'ChatService#startNewLocalSession');
	}

	private _startSession(props: IStartSessionProps): ChatModel {
		const { initialData, location, sessionResource, canUseTools, transferEditingSession, disableBackgroundKeepAlive, inputState, isReadOnly } = props;
		const model = this.instantiationService.createInstance(ChatModel, initialData, { initialLocation: location, canUseTools, resource: sessionResource, disableBackgroundKeepAlive, inputState, isReadOnly });
		if (location === ChatAgentLocation.Chat) {
			model.startEditingSession(true, transferEditingSession);
		}

		this.initializeSession(model);
		return model;
	}

	private initializeSession(model: ChatModel): void {
		this.trace('initializeSession', `Initialize session ${model.sessionResource}`);

		this.activateDefaultAgent(model.initialLocation).catch(e => this.logService.error(e));
	}

	async activateDefaultAgent(location: ChatAgentLocation): Promise<void> {
		await this.extensionService.whenInstalledExtensionsRegistered();

		const defaultAgentData = this.chatAgentService.getContributedDefaultAgent(location) ?? this.chatAgentService.getContributedDefaultAgent(ChatAgentLocation.Chat);
		if (!defaultAgentData) {
			this.logService.trace('No default agent contributed for location', location);
			return;
		}

		if (!defaultAgentData.isCore) {
			await this.extensionService.activateById(defaultAgentData.extensionId, {
				activationEvent: `onChatParticipant:${defaultAgentData.id}`,
				extensionId: defaultAgentData.extensionId,
				startup: false
			});
		}

		let defaultAgent = this.chatAgentService.getActivatedAgents().find(agent => agent.id === defaultAgentData.id);
		if (!defaultAgent) {
			await raceTimeout(Event.toPromise(this.chatAgentService.onDidChangeAgents), 2000);
			defaultAgent = this.chatAgentService.getActivatedAgents().find(agent => agent.id === defaultAgentData.id);
		}
		if (!defaultAgent) {
			this.logService.trace('No default agent registered yet for', defaultAgentData.id);
			return;
		}
	}

	getSession(sessionResource: URI): IChatModel | undefined {
		return this._sessionModels.get(sessionResource);
	}

	acquireExistingSession(sessionResource: URI, debugOwner?: string): IChatModelReference | undefined {
		return this._sessionModels.acquireExisting(sessionResource, debugOwner ?? 'ChatService#acquireExistingSession');
	}

	getChatModelReferenceDebugInfo() {
		return this._sessionModels.getReferenceDebugSnapshot();
	}

	private async acquireOrRestoreLocalSession(sessionResource: URI, debugOwner?: string): Promise<IChatModelReference | undefined> {
		this.trace('acquireOrRestoreSession', `${sessionResource}`);
		const existingRef = this.acquireExistingSession(sessionResource, debugOwner);
		if (existingRef) {
			return existingRef;
		}

		let sessionData: ISerializedChatDataReference | undefined;
		if (isEqual(this.transferredSessionResource, sessionResource)) {
			this._transferredSessionResource = undefined;
			sessionData = await this._chatSessionStore.readTransferredSession(sessionResource);
		} else {
			const localSessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
			if (localSessionId) {
				sessionData = await this._chatSessionStore.readSession(localSessionId);
			}
		}

		if (!sessionData) {
			return undefined;
		}

		const sessionRef = this._sessionModels.acquireOrCreate({
			initialData: sessionData,
			location: sessionData.value.initialLocation ?? ChatAgentLocation.Chat,
			sessionResource,
			canUseTools: true,
		}, debugOwner ?? 'ChatService#acquireOrRestoreLocalSession');

		return sessionRef;
	}

	getSessionTitle(sessionResource: URI): string | undefined {
		const sessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (!sessionId) {
			return undefined;
		}

		return this._sessionModels.get(sessionResource)?.title ??
			this._chatSessionStore.getMetadataForSessionSync(sessionResource)?.title;
	}

	loadSessionFromData(data: IExportableChatData | ISerializableChatData, debugOwner?: string, sessionTypeSelectionReason?: SessionTypeSelectionReason): IChatModelReference {
		const sessionId = (data as ISerializableChatData).sessionId ?? generateUuid();
		const sessionResource = LocalChatSessionUri.forSession(sessionId);
		return this._sessionModels.acquireOrCreate({
			initialData: { value: data, serializer: new ChatSessionOperationLog() },
			location: data.initialLocation ?? ChatAgentLocation.Chat,
			sessionResource,
			canUseTools: true,
			sessionTypeSelectionReason,
		}, debugOwner ?? 'ChatService#loadSessionFromData');
	}

	async acquireOrLoadSession(sessionResource: URI, location: ChatAgentLocation, token: CancellationToken, debugOwner?: string, sessionTypeSelectionReason?: SessionTypeSelectionReason): Promise<IChatModelReference | undefined> {
		if (LocalChatSessionUri.isLocalSession(sessionResource)) {
			return this.acquireOrRestoreLocalSession(sessionResource, debugOwner);
		} else {
			return this.loadRemoteSession(sessionResource, location, token, debugOwner, sessionTypeSelectionReason);
		}
	}

	private async loadRemoteSession(sessionResource: URI, location: ChatAgentLocation, token: CancellationToken, debugOwner?: string, sessionTypeSelectionReason?: SessionTypeSelectionReason): Promise<IChatModelReference | undefined> {
		{
			const existingRef = this.acquireExistingSession(sessionResource, debugOwner);
			if (existingRef) {
				return existingRef;
			}
		}

		if (!await raceCancellationError(this.chatSessionService.canResolveChatSession(getChatSessionType(sessionResource)), token)) {
			return undefined;
		}

		const providedSession = await this.chatSessionService.getOrCreateChatSession(sessionResource, token);

		{
			const existingRef = this.acquireExistingSession(sessionResource, debugOwner);
			if (existingRef) {
				return existingRef;
			}
		}
		const chatSessionType = getChatSessionType(sessionResource);
		const modelId = findLast(providedSession.history.filter(m => m.type === 'request'), req => req.modelId)?.modelId;
		const agentUri = findLast(providedSession.history.filter(m => m.type === 'request'), req => req.modeInstructions?.uri)?.modeInstructions?.uri;
		const storedMetadata = this._chatSessionStore.getMetadataForSessionSync(sessionResource);
		const storedPermissionLevel = storedMetadata?.permissionLevel;
		const storedInputState = storedMetadata?.inputState;
		let initialData: ISerializedChatDataReference | undefined = undefined;
		let historySelectedModel: string | undefined = undefined;
		let historyDerivedModel: ISerializableChatModelInputState['selectedModel'] = undefined;
		if ((modelId || agentUri)) {
			const mode: ISerializableChatModelInputState['mode'] = agentUri ? { kind: ChatModeKind.Agent, id: agentUri.toString() } : { kind: ChatModeKind.Agent, id: ChatMode.Agent.id };
			const modelMetadata = modelId ? this.languageModelsService.lookupLanguageModel(modelId) : undefined;
			const storedModelConfiguration = storedInputState?.selectedModel?.modelConfiguration
				?? (storedInputState as { modelConfiguration?: IStringDictionary<unknown> } | undefined)?.modelConfiguration;
			const modelConfiguration = storedInputState?.selectedModel?.identifier === modelId
				? storedModelConfiguration
				: undefined;
			const storedSelectedModel = storedInputState?.selectedModel;
			const selectedModel: ISerializableChatModelInputState['selectedModel'] = modelId && modelMetadata
				? { identifier: modelId, metadata: modelMetadata, modelConfiguration }
				: (modelId && storedSelectedModel && storedSelectedModel.identifier === modelId
					? { ...storedSelectedModel, modelConfiguration }
					: undefined);
			historySelectedModel = selectedModel?.identifier;
			historyDerivedModel = selectedModel;
			initialData = {
				serializer: new ChatSessionOperationLog(),
				value: {
					creationDate: Date.now(),
					initialLocation: undefined,
					customTitle: undefined,
					requests: [],
					responderUsername: '',
					sessionId: '',
					version: 3,
					inputState: {
						attachments: [],
						contrib: {},
						inputText: '',
						mode,
						selectedModel: selectedModel,
						selections: [],
						permissionLevel: storedPermissionLevel,
					},
					pendingRequests: undefined,
					repoData: undefined
				}
			};
		}

		const restoredDraft: ISerializableChatModelInputState | undefined = storedInputState
			? { ...storedInputState, selectedModel: historyDerivedModel }
			: undefined;
		const transferredInputState = providedSession.transferredState?.inputState;
		const stateToApply = transferredInputState
			? backfillTransferredModel(transferredInputState, historyDerivedModel)
			: restoredDraft;
		const inputState = backfillRestoredPickerState(stateToApply, storedInputState, ChatMode.Agent.id);
		const modelRef = this._sessionModels.acquireOrCreate({
			initialData,
			location,
			sessionResource: sessionResource,
			canUseTools: false,
			transferEditingSession: providedSession.transferredState?.editingSession,
			inputState,
			isReadOnly: providedSession.isReadOnly,
			sessionTypeSelectionReason,
		}, debugOwner ?? 'ChatService#loadRemoteSession');

		logChangesToStateModel(modelRef.object.inputModel, `loadRemoteSession inputState source: session=${sessionResource.toString()}, chatSessionType=${chatSessionType}, historyModelId=${modelId}, agentUri=${agentUri?.toString()}, historySelectedModel=${historySelectedModel}, transferredSelectedModel=${providedSession.transferredState?.inputState?.selectedModel?.identifier}, storedSelectedModel=${storedInputState?.selectedModel?.identifier}, finalSelectedModel=${modelRef.object.inputModel.state.get()?.selectedModel?.identifier}, hasTransferredInputState=${!!providedSession.transferredState?.inputState}, hasStoredInputState=${!!storedInputState}, hasInitialData=${!!initialData}`, modelRef.object.inputModel.state.get(), undefined, this.logService);

		if (storedPermissionLevel && !initialData && !storedInputState) {
			modelRef.object.inputModel.setState({ permissionLevel: storedPermissionLevel });
		}

		if (providedSession.title) {
			modelRef.object.setCustomTitle(providedSession.title);
		}

		const model = modelRef.object;
		const disposables = new DisposableStore();
		disposables.add(modelRef.object.onDidDispose(() => {
			disposables.dispose();
			providedSession.dispose();
		}));

		const isAgentHostSession = isAgentHostTarget(chatSessionType);
		const requestParser = isAgentHostSession ? this.instantiationService.createInstance(ChatRequestParser) : undefined;
		const parseAgentHostHistoryPrompt = (text: string, agent: IChatAgentData | undefined): IParsedChatRequest => {
			if (requestParser) {
				try {
					const attachmentCapabilities = this.getAttachmentCapabilitiesForParser(chatSessionType, agent);
					const parsed = requestParser.parseChatRequestWithReferences(
						EMPTY_REFERENCES,
						EMPTY_TOOL_ENABLEMENT_MAP,
						text,
						location,
						{ sessionType: chatSessionType, forcedAgent: agent, attachmentCapabilities },
					);
					if (parsed.parts.length > 0) {
						return parsed;
					}
				} catch (e) {
					this.logService.warn(`ChatService#loadRemoteSession: failed to re-parse historical prompt for ${chatSessionType}`, e);
				}
			}
			return {
				text,
				parts: [new ChatRequestTextPart(
					new OffsetRange(0, text.length),
					{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: text.length + 1 },
					text
				)]
			};
		};

		let lastRequest: ChatRequestModel | undefined;
		let lastResponseCompletedAt: number | undefined;
		const completeLastResponse = () => {
			if (Number.isFinite(lastResponseCompletedAt)) {
				lastRequest?.response?.complete(lastResponseCompletedAt);
			} else {
				lastRequest?.response?.completeWithoutTimestamp();
			}
			lastResponseCompletedAt = undefined;
		};
		for (const message of providedSession.history) {
			if (message.type === 'request') {
				if (lastRequest) {
					completeLastResponse();
				}

				const requestText = message.prompt;
				const agent =
					message.participant
						? this.chatAgentService.getAgent(message.participant)
						: this.chatAgentService.getAgent(chatSessionType);
				const parsedRequest = parseAgentHostHistoryPrompt(requestText, agent);
				const modeInfo = message.modeInstructions ? {
					kind: ChatModeKind.Agent,
					isBuiltin: message.modeInstructions.isBuiltin ?? false,
					modeInstructions: message.modeInstructions,
					telemetryModeId: 'custom',
					applyCodeBlockSuggestionId: undefined,
				} satisfies IChatRequestModeInfo : undefined;
				lastRequest = model.addRequest(parsedRequest,
					message.variableData ?? { variables: [] },
					0,
					modeInfo,
					agent,
					undefined,
					undefined,
					undefined,
					undefined,
					false,
					message.modelId,
					undefined,
					message.id,
					message.isSystemInitiated,
					message.systemInitiatedLabel,
					undefined,
					message.isTerminalRequest,
					message.timestamp ?? null,
				);
			} else {
				if (lastRequest) {
					for (const part of message.parts) {
						model.acceptResponseProgress(lastRequest, part);
					}
					if (lastRequest.response && (message.details || message.errorDetails)) {
						lastRequest.response.setResult({
							...(message.details ? { details: message.details } : {}),
							...(message.errorDetails ? { errorDetails: message.errorDetails } : {}),
						});
					}
					if (lastRequest.response && typeof message.elapsedMs === 'number') {
						lastRequest.response.setElapsedMs(message.elapsedMs);
					}
					lastResponseCompletedAt = message.completedAt;
				}
			}
		}

		const hasProgressStreaming = providedSession.progressObs && providedSession.interruptActiveResponseCallback;
		if (hasProgressStreaming) {
			let lastProgressLength = 0;

			const cancellationListener = disposables.add(new MutableDisposable());
			const createCancellationListener = (token: CancellationToken) => {
				return token.onCancellationRequested(() => {
					providedSession.interruptActiveResponseCallback?.().then(userConfirmedInterruption => {
						if (!userConfirmedInterruption) {
							trackNewCancellableRequest();
						}
					});
				});
			};

			const trackNewCancellableRequest = () => {
				const cancellableRequest = this.instantiationService.createInstance(CancellableRequest, new CancellationTokenSource(), undefined, undefined, undefined);
				this._syntheticPendingRequests.add(cancellableRequest);
				this._pendingRequests.set(model.sessionResource, cancellableRequest);
				this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'add', source: 'remoteSession', chatSessionId: chatSessionResourceToId(model.sessionResource) });
				cancellationListener.value = createCancellationListener(cancellableRequest.cancellationTokenSource.token);
			};

			const ensureCancellationTracking = () => {
				if (!this._pendingRequests.has(model.sessionResource)) {
					trackNewCancellableRequest();
				}
			};

			if (lastRequest && !providedSession.isCompleteObs?.get()) {
				trackNewCancellableRequest();
			}

			if (providedSession.onDidStartServerRequest) {
				disposables.add(providedSession.onDidStartServerRequest(({ id, prompt, variableData, timestamp, isSystemInitiated, systemInitiatedLabel, isTerminalRequest }) => {
					if (lastRequest?.response && !lastRequest.response.isComplete) {
						completeLastResponse();
					}

					const agent = this.chatAgentService.getAgent(chatSessionType);
					const parsedRequest = parseAgentHostHistoryPrompt(prompt, agent);
					lastRequest = model.addRequest(parsedRequest,
						variableData ?? { variables: [] },
						0,
						undefined,
						agent,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						id,
						isSystemInitiated,
						systemInitiatedLabel,
						undefined,
						isTerminalRequest,
						timestamp,
					);

					lastProgressLength = 0;

					ensureCancellationTracking();
				}));
			}

			if (!this._isServerManagedQueue(model.sessionResource)) {
				let dispatchingImmediateSteer = false;
				const canImmediatelyDispatch = () => {
					if (!model.getPendingRequests().some(r => r.kind === ChatRequestQueueKind.Steering)) {
						return false;
					}
					const pending = this._pendingRequests.get(model.sessionResource);
					return !pending || this._syntheticPendingRequests.has(pending);
				};
				disposables.add(model.onDidChangePendingRequests(() => {
					if (dispatchingImmediateSteer || !canImmediatelyDispatch()) {
						return;
					}
					dispatchingImmediateSteer = true;
					queueMicrotask(() => {
						dispatchingImmediateSteer = false;
						if (this._sessionModels.get(model.sessionResource) !== model || !canImmediatelyDispatch()) {
							return;
						}
						if (this._pendingRequests.has(model.sessionResource)) {
							this._pendingRequests.deleteAndDispose(model.sessionResource);
						}
						this.processNextPendingRequest(model);
						this._pendingRequests.get(model.sessionResource)?.responseCompletePromise?.finally(() => {
							if (this._sessionModels.get(model.sessionResource) === model && !(providedSession.isCompleteObs?.get() ?? false)) {
								ensureCancellationTracking();
							}
						});
					});
				}));
			}

			disposables.add(autorun(reader => {
				const progressArray = providedSession.progressObs?.read(reader) ?? [];
				const isComplete = providedSession.isCompleteObs?.read(reader) ?? false;

				if (!isComplete) {
					ensureCancellationTracking();
				}

				if (lastRequest && progressArray.length > lastProgressLength) {
					const newProgress = progressArray.slice(lastProgressLength);
					for (const progress of newProgress) {
						model?.acceptResponseProgress(lastRequest, progress);
					}
					lastProgressLength = progressArray.length;
				}

				if (isComplete && lastRequest) {
					this._pendingRequests.deleteAndDispose(model.sessionResource);
					cancellationListener.clear();
					completeLastResponse();
					this.processPendingRequests(model.sessionResource);
				}
			}));
		} else {
			if (providedSession.isCompleteObs?.get()) {
				completeLastResponse();
			}

			this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'notCancelable', source: 'remoteSession', chatSessionId: chatSessionResourceToId(model.sessionResource) });
			if (lastRequest && model.editingSession) {
				await chatEditingSessionIsReady(model.editingSession);
				completeLastResponse();
			}
		}

		return modelRef;
	}

	async resendRequest(request: IChatRequestModel, options?: IChatSendRequestOptions, preserveRequestId = false): Promise<void> {
		const model = this._sessionModels.get(request.session.sessionResource);
		if (!model && model !== request.session) {
			throw new Error(`Unknown session: ${request.session.sessionResource}`);
		}
		if (model.isReadOnly.get()) {
			return;
		}

		const cts = this._pendingRequests.get(request.session.sessionResource);
		if (cts) {
			this.trace('resendRequest', `Session ${request.session.sessionResource} already has a pending request, cancelling...`);
			cts.cancel();
		}

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		const enableCommandDetection = !options?.noCommandDetection;
		const requestedAgentId = options?.agentId ?? options?.agentIdSilent;
		const requestedAgent = requestedAgentId ? this.chatAgentService.getAgent(requestedAgentId) : undefined;
		if (requestedAgentId && !requestedAgent) {
			throw new Error('Unknown agent: ' + requestedAgentId);
		}
		const defaultAgent = requestedAgent ?? this.chatAgentService.getDefaultAgent(location, options?.modeInfo?.kind)!;

		const preservedRequest = preserveRequestId && request instanceof ChatRequestModel ? request : undefined;
		if (!preservedRequest) {
			model.removeRequest(request.id, ChatRequestRemovalReason.Resend);
		}

		const resendOptions: IChatSendRequestOptions = {
			...options,
			locationData: request.locationData,
			attachedContext: request.attachedContext,
		};
		await this._sendRequestAsync(model, model.sessionResource, request.message, attempt, enableCommandDetection, defaultAgent, location, resendOptions, preservedRequest, preserveRequestId ? request.id : undefined).responseCompletePromise;
	}

	private queuePendingRequest(model: ChatModel, sessionResource: URI, request: string, options: IChatSendRequestOptions): ChatSendResultQueued {
		const location = options.location ?? model.initialLocation;
		const parsedRequest = this.parseChatRequest(sessionResource, request, location, options);
		const requestModel = new ChatRequestModel({
			session: model,
			message: parsedRequest,
			variableData: { variables: options.attachedContext ?? [] },
			timestamp: Date.now(),
			modeInfo: options.modeInfo,
			locationData: options.locationData,
			attachedContext: options.attachedContext,
			modelId: options.userSelectedModelId,
			userSelectedTools: options.userSelectedTools?.get(),
			isSystemInitiated: options.isSystemInitiated,
			systemInitiatedLabel: options.systemInitiatedLabel,
			terminalExecutionId: options.terminalExecutionId,
		});

		const deferred = new DeferredPromise<ChatSendResult>();
		this._queuedRequestDeferreds.set(requestModel.id, deferred);

		model.addPendingRequest(requestModel, options.queue ?? ChatRequestQueueKind.Queued, { ...options, queue: undefined });

		if (options.queue === ChatRequestQueueKind.Steering) {
			this.setYieldRequested(sessionResource);
		}

		this.trace('sendRequest', `Queued message for session ${sessionResource}`);
		return { kind: 'queued', requestId: requestModel.id, deferred: deferred.p };
	}

	async sendRequest(sessionResource: URI, request: string, options?: IChatSendRequestOptions): Promise<ChatSendResult> {
		this.trace('sendRequest', `sessionResource: ${sessionResource.toString()}, message: ${request.substring(0, 20)}${request.length > 20 ? '[...]' : ''}}`);

		const hasExplicitFileOrImageAttachment = [...(options?.attachedContext ?? []), ...(options?.resolvedVariables ?? [])].some(isExplicitFileOrImageVariableEntry);
		if (!request.trim() && !hasExplicitFileOrImageAttachment && !options?.slashCommand && !options?.agentId && !options?.agentIdSilent) {
			this.trace('sendRequest', 'Rejected empty message');
			return { kind: 'rejected', reason: 'Empty message' };
		}

		let newSessionResource: URI | undefined;

		const materializedReal = this.chatSessionService.getMaterializedSessionResource(sessionResource);
		if (materializedReal) {
			sessionResource = materializedReal;
			newSessionResource = materializedReal;
		}

		let model = this._sessionModels.get(sessionResource);
		if (!model) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}
		if (model.isReadOnly.get()) {
			return {
				kind: 'rejected',
				reason: 'Session is read-only',
				...(newSessionResource ? { newSessionResource } : {}),
			};
		}

		if (!model.hasRequests && isUntitledChatSession(sessionResource) && getChatSessionType(sessionResource) !== localChatSessionType) {
			const materialized = await this._materializeUntitledSession(sessionResource, request, options, model);
			if (materialized) {
				model = materialized.model;
				sessionResource = materialized.sessionResource;
				newSessionResource = materialized.newSessionResource;
			}
		}
		if (model.isReadOnly.get()) {
			return { kind: 'rejected', reason: 'Session is read-only', newSessionResource };
		}

		const hasPendingRequest = this._pendingRequests.has(sessionResource);

		if (options?.queue) {
			const queued = this.queuePendingRequest(model, sessionResource, request, options);
			if (!options.pauseQueue) {
				this.processPendingRequests(sessionResource);
			}
			return queued;
		} else if (hasPendingRequest) {
			this.trace('sendRequest', `Session ${sessionResource} already has a pending request`);
			return { kind: 'rejected', reason: 'Request already in progress' };
		}

		const requests = model.getRequests();
		for (let i = requests.length - 1; i >= 0; i -= 1) {
			const request = requests[i];
			if (request.shouldBeRemovedOnSend) {
				if (request.shouldBeRemovedOnSend.afterUndoStop) {
					request.response?.finalizeUndoState();
				} else {
					await this.removeRequest(sessionResource, request.id);
				}
			}
		}

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		let defaultAgent = this.chatAgentService.getDefaultAgent(location, options?.modeInfo?.kind);
		if (!defaultAgent) {
			this.logService.warn('sendRequest', `No default agent for location ${location}`);
			defaultAgent = this.chatAgentService.getActivatedAgents()[0]
				?? this.chatAgentService.getAgents()[0]
				?? ChatService._dardcorFallbackAgent;
		}

		const parsedRequest = this.parseChatRequest(sessionResource, request, location, options);
		const silentAgent = options?.agentIdSilent ? this.chatAgentService.getAgent(options.agentIdSilent) : undefined;
		const agent = silentAgent ?? parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart)?.agent ?? defaultAgent;
		const agentSlashCommandPart = parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);

		const effectiveAgent = agent ?? defaultAgent ?? this.chatAgentService.getActivatedAgents()[0] ?? ChatService._dardcorFallbackAgent;

		const resolvedAgent: IChatAgentData = agent ?? effectiveAgent ?? ChatService._dardcorFallbackAgent;

		return {
			kind: 'sent',
			newSessionResource,
			data: {
				...this._sendRequestAsync(model, sessionResource, parsedRequest, attempt, !options?.noCommandDetection, resolvedAgent, location, options),
				agent: resolvedAgent,
				slashCommand: agentSlashCommandPart?.command,
			},
		};
	}

	private async _materializeUntitledSession(untitledResource: URI, request: string, options: IChatSendRequestOptions | undefined, untitledModel: ChatModel): Promise<{ model: ChatModel; sessionResource: URI; newSessionResource: URI } | undefined> {
		const inFlight = this._inFlightUntitledMaterializations.get(untitledResource);
		if (inFlight) {
			const realResource = await inFlight;
			if (!realResource) {
				this.trace('materializeUntitledSession', `In-flight materialization of ${untitledResource.toString()} produced no real session; keeping untitled`);
				return undefined;
			}
			const realModel = this._sessionModels.get(realResource);
			if (!realModel) {
				this.info('materializeUntitledSession', `Joined in-flight materialization of ${untitledResource.toString()} but real model ${realResource.toString()} is missing; keeping untitled`);
				return undefined;
			}
			this.trace('materializeUntitledSession', `Concurrent send joined in-flight materialization ${untitledResource.toString()} -> ${realResource.toString()}`);
			return { model: realModel, sessionResource: realResource, newSessionResource: realResource };
		}

		const materialized = new DeferredPromise<URI | undefined>();
		this._inFlightUntitledMaterializations.set(untitledResource, materialized.p);
		try {
			const parsedRequest = this.parseChatRequest(untitledResource, request, options?.location ?? untitledModel.initialLocation, options);
			const commandPart = parsedRequest.parts.find((r): r is ChatRequestSlashCommandPart => r instanceof ChatRequestSlashCommandPart);
			const requestText = getPromptText(parsedRequest).message;

			const initialSessionOptions = this.chatSessionService.getSessionOptions(untitledResource);

			const newItem = await this.chatSessionService.createNewChatSessionItem(getChatSessionType(untitledResource), { prompt: requestText, command: commandPart?.text, initialSessionOptions, untitledResource }, CancellationToken.None);
			if (!newItem) {
				materialized.complete(undefined);
				return undefined;
			}

			this.chatSessionService.registerSessionResourceAlias(untitledResource, newItem.resource);

			const tempRef = await this.loadRemoteSession(newItem.resource, untitledModel.initialLocation, CancellationToken.None);
			const realModel = tempRef?.object as ChatModel | undefined;
			if (!realModel) {
				throw new Error(`Failed to load session for resource: ${newItem.resource}`);
			}

			if (initialSessionOptions) {
				this.chatSessionService.updateSessionOptions(realModel.sessionResource, initialSessionOptions);
			}

			this.chatSessionService.setMaterializedSessionResource(untitledResource, newItem.resource);
			materialized.complete(newItem.resource);
			this.info('materializeUntitledSession', `Materialized untitled session ${untitledResource.toString()} into real session ${newItem.resource.toString()}`);
			return { model: realModel, sessionResource: newItem.resource, newSessionResource: newItem.resource };
		} catch (err) {
			materialized.complete(undefined);
			throw err;
		} finally {
			if (this._inFlightUntitledMaterializations.get(untitledResource) === materialized.p) {
				this._inFlightUntitledMaterializations.delete(untitledResource);
			}
		}
	}

	private getAttachmentCapabilitiesForParser(chatSessionType: string, agent: IChatAgentData | undefined): IChatAgentAttachmentCapabilities | undefined {
		return this.chatSessionService.getCapabilitiesForSessionType(chatSessionType) ?? agent?.capabilities;
	}

	private parseChatRequest(sessionResource: URI, request: string, location: ChatAgentLocation, options: IChatSendRequestOptions | undefined): IParsedChatRequest {
		let parserContext = options?.parserContext;
		let contextAgent = parserContext?.forcedAgent ?? parserContext?.selectedAgent;
		if (options?.agentId) {
			const agent = this.chatAgentService.getAgent(options.agentId);
			if (!agent) {
				throw new Error(`Unknown agent: ${options.agentId}`);
			}
			contextAgent = agent;
			parserContext = { ...parserContext, selectedAgent: agent, mode: options.modeInfo?.kind };
			const commandPart = options.slashCommand ? ` ${chatSubcommandLeader}${options.slashCommand}` : '';
			request = `${chatAgentLeader}${agent.name}${commandPart} ${request}`;
		} else if (options?.agentIdSilent && !parserContext?.forcedAgent) {
			const silentAgent = this.chatAgentService.getAgent(options.agentIdSilent);
			if (silentAgent) {
				contextAgent = silentAgent;
				parserContext = { ...parserContext, forcedAgent: silentAgent };
			}
		}

		const attachmentCapabilities = parserContext?.attachmentCapabilities ?? this.getAttachmentCapabilitiesForParser(getChatSessionType(sessionResource), contextAgent);
		if (attachmentCapabilities) {
			parserContext = { ...parserContext, attachmentCapabilities };
		}

		const parsedRequest = this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(sessionResource, request, location, parserContext);
		return parsedRequest;
	}

	private refreshFollowupsCancellationToken(sessionResource: URI): CancellationToken {
		this._sessionFollowupCancelTokens.get(sessionResource)?.cancel();
		const newTokenSource = new CancellationTokenSource();
		this._sessionFollowupCancelTokens.set(sessionResource, newTokenSource);

		return newTokenSource.token;
	}

	private static readonly _dardcorFallbackAgent: IChatAgentData = {
		id: 'dardcor.default',
		name: 'Dardcor',
		fullName: 'Dardcor Router Agent',
		description: 'Default Dardcor Router fallback agent',
		extensionId: new ExtensionIdentifier('dardcor.dardcor'),
		extensionVersion: '1.0.0',
		extensionPublisherId: 'dardcor',
		publisherDisplayName: 'Dardcor',
		extensionDisplayName: 'Dardcor',
		isDefault: true,
		isCore: true,
		metadata: { isSticky: false },
		slashCommands: [],
		locations: [ChatAgentLocation.Chat, ChatAgentLocation.Terminal, ChatAgentLocation.Notebook, ChatAgentLocation.EditorInline],
		modes: [ChatModeKind.Ask, ChatModeKind.Agent, ChatModeKind.Edit],
		disambiguation: [],
	};

	private _sendRequestAsync(model: ChatModel, sessionResource: URI, parsedRequest: IParsedChatRequest, attempt: number, enableCommandDetection: boolean, defaultAgent: IChatAgentData | undefined, location: ChatAgentLocation, options?: IChatSendRequestOptions, preservedRequest?: ChatRequestModel, requestId?: string): IChatSendRequestResponseState {
		const followupsCancelToken = this.refreshFollowupsCancellationToken(sessionResource);
		let request: ChatRequestModel | undefined;
		const agentPart = parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart);
		const agentSlashCommandPart = parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);
		const commandPart = parsedRequest.parts.find((r): r is ChatRequestSlashCommandPart => r instanceof ChatRequestSlashCommandPart);
		const requests = model.getRequests().filter(request => request !== preservedRequest);
		const isTerminalCommand = isTerminalCommandPrompt(parsedRequest.text, this.chatSessionService.getCapabilitiesForSessionType(getChatSessionType(sessionResource))?.terminalCommandPrefix);
		const requestTelemetry = this.instantiationService.createInstance(ChatRequestTelemetry, {
			agent: agentPart?.agent ?? defaultAgent ?? ChatService._dardcorFallbackAgent,
			agentSlashCommandPart,
			commandPart,
			sessionResource: model.sessionResource,
			location: model.initialLocation,
			options,
			enableCommandDetection
		});

		let gotProgress = false;
		const requestType = commandPart ? 'slashCommand' : 'string';

		const responseCreated = new DeferredPromise<IChatResponseModel>();
		let responseCreatedComplete = false;
		function completeResponseCreated(): void {
			if (!responseCreatedComplete && request?.response) {
				responseCreated.complete(request.response);
				responseCreatedComplete = true;
			}
		}

		const store = new DisposableStore();
		const source = store.add(new CancellationTokenSource());
		const token = source.token;
		const sendRequestInternal = async () => {
			const progressCallback = (progress: IChatProgress[]) => {
				if (token.isCancellationRequested) {
					return;
				}

				if (!gotProgress) {
					markChat(sessionResource, ChatPerfMark.FirstToken);
				}
				gotProgress = true;

				for (let i = 0; i < progress.length; i++) {
					const isLast = i === progress.length - 1;
					const progressItem = progress[i];

					if (progressItem.kind === 'markdownContent') {
						this.trace('sendRequest', `Provider returned progress for session ${model.sessionResource}, ${progressItem.content.value.length} chars`);
					} else {
						this.trace('sendRequest', `Provider returned progress: ${JSON.stringify(progressItem)}`);
					}

					if (request) {
						model.acceptResponseProgress(request, progressItem, !isLast);
					}
				}
				completeResponseCreated();
			};

			let detectedAgent: IChatAgentData | undefined;
			let detectedCommand: IChatAgentCommand | undefined;

			{
				const fileLoggingEnabled = this.configurationService.getValue<boolean>(AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING);
				if (!fileLoggingEnabled) {
					const isTroubleshootCommand = agentSlashCommandPart?.command.name === TROUBLESHOOT_COMMAND_NAME;
					const hasTroubleshootSkill = options?.attachedContext?.some(v => {
						const uri = IChatRequestVariableEntry.toUri(v);
						return uri && (uri.scheme === COPILOT_SKILL_URI_SCHEME || uri.path.includes(TROUBLESHOOT_SKILL_PATH));
					});
					if (isTroubleshootCommand || hasTroubleshootSkill) {
						request = model.addRequest(parsedRequest, { variables: [] }, attempt, options?.modeInfo);
						completeResponseCreated();

						const settingsArg = encodeURIComponent(JSON.stringify(AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING));
						model.acceptResponseProgress(request, {
							kind: 'markdownContent',
							content: new MarkdownString(localize(
								'agentDebugLog.troubleshootDisabled',
								"The `{0}` skill requires `{1}` to be enabled. After enabling, reload the window to apply. [Enable in Settings](command:workbench.action.openSettings?{2})",
								TROUBLESHOOT_COMMAND_NAME,
								AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING,
								settingsArg
							), { isTrusted: { enabledCommands: ['workbench.action.openSettings'] } }),
						});
						model.setResponse(request, {});
						request.response?.complete();
						store.dispose();
						return;
					}
				}
			}

			const collectHooks = async (): Promise<{ hooks: ChatRequestHooks | undefined; hasDisabledClaudeHooks: boolean }> => {
				let collectedHooks: ChatRequestHooks | undefined;
				let hasDisabledClaudeHooks = false;
				try {
					const hooksInfo = await this.promptsService.getHooks(token);
					if (hooksInfo) {
						collectedHooks = hooksInfo.hooks;
						hasDisabledClaudeHooks = hooksInfo.hasDisabledClaudeHooks;
					}
				} catch (error) {
					this.logService.warn('[ChatService] Failed to collect hooks:', error);
				}

				const agentName = options?.modeInfo?.modeInstructions?.name;
				if (agentName) {
					try {
						const agents = await this.promptsService.getCustomAgents(token);
						const customAgent = agents.find(a => a.name === agentName && a.enabled);
						if (customAgent?.hooks) {
							collectedHooks = mergeHooks(collectedHooks, customAgent.hooks);
						}
					} catch (error) {
						this.logService.warn('[ChatService] Failed to collect agent hooks:', error);
					}
				}
				return { hooks: collectedHooks, hasDisabledClaudeHooks };
			};

			const collectInstructions = async (): Promise<IChatRequestVariableEntry[]> => {
				const ctx = options?.instructionContext;
				if (!ctx) {
					return [];
				}
				if (this.configurationService.getValue<boolean>(ChatConfiguration.CollectInstructionsInExtension) === true) {
					return [];
				}
				markChat(sessionResource, ChatPerfMark.WillCollectInstructions);
				try {
					const variableSet = new ChatRequestVariableSet(options?.attachedContext);
					const computer = this.instantiationService.createInstance(ComputeAutomaticInstructions, ctx.modeKind, ctx.enabledTools, ctx.enabledSubAgents, getChatSessionType(sessionResource));
					await computer.collect(variableSet, token);
					const originalIds = new Set((options?.attachedContext ?? []).map(v => v.id));
					return variableSet.asArray().filter(v => !originalIds.has(v.id));
				} catch (err) {
					this.logService.error('[ChatService] Failed to collect instructions:', err);
					return [];
				} finally {
					markChat(sessionResource, ChatPerfMark.DidCollectInstructions);
				}
			};

			const stopWatch = new StopWatch(false);
			store.add(token.onCancellationRequested(() => {
				this.trace('sendRequest', `Request for session ${model.sessionResource} was cancelled`);
				if (!request) {
					return;
				}

				requestTelemetry.complete({
					timeToFirstProgress: undefined,
					result: 'cancelled',
					totalTime: stopWatch.elapsed(),
					requestType,
					detectedAgent,
					request,
				});

				model.cancelRequest(request);
			}));

			try {
				let rawResult: IChatAgentResult | null | undefined;
				let agentOrCommandFollowups: Promise<IChatFollowup[] | undefined> | undefined = undefined;
				if (agentPart || !commandPart || defaultAgent) {
					const initialAgent = agentPart?.agent ?? defaultAgent ?? this.chatAgentService.getActivatedAgents()[0] ?? ChatService._dardcorFallbackAgent;
					const initialCommand = agentSlashCommandPart?.command;
					const initVariableData: IChatRequestVariableData = { variables: [] };
					const effectiveModelId = options?.userSelectedModelId ?? preservedRequest?.modelId ?? model.getRequests().slice().reverse().find(r => r.modelId && r.modelId !== 'auto' && !r.modelId.endsWith('/auto') && !r.modelId.endsWith('/no-model-selected'))?.modelId;
					request = preservedRequest ?? model.addRequest(parsedRequest, initVariableData, attempt, options?.modeInfo, initialAgent, initialCommand, options?.confirmation, options?.locationData, options?.attachedContext, undefined, effectiveModelId, options?.userSelectedTools?.get(), requestId, options?.isSystemInitiated, options?.systemInitiatedLabel, options?.terminalExecutionId, isTerminalCommand);
					preservedRequest?.response?.reopen();
					const thisRequest = request;
					completeResponseCreated();

					const [hooksResult, instructionEntries] = await Promise.all([
						collectHooks(),
						collectInstructions(),
					]);
					const collectedHooks = hooksResult.hooks;
					const hasDisabledClaudeHooks = hooksResult.hasDisabledClaudeHooks;

					const allContext = this.prepareContext(request.attachedContext);
					if (instructionEntries.length > 0) {
						allContext.push(...instructionEntries);
					}

					const storedVariables = allContext.filter(v => !(isPromptTextVariableEntry(v) && v.automaticallyAdded));
					model.updateRequest(request, { variables: storedVariables });

					let variableData: IChatRequestVariableData = { variables: allContext };

					if (options?.resolvedVariables?.length) {
						variableData = { variables: [...variableData.variables, ...options.resolvedVariables] };
					}

					const promptTextResult = getPromptText(request.message);
					variableData = updateRanges(variableData, promptTextResult.diff);
					const message = promptTextResult.message;

					const buildAgentRequest = (agent: IChatAgentData, command?: IChatAgentCommand, enableCommandDetection?: boolean, isParticipantDetected?: boolean): IChatAgentRequest => {
						const agentRequest: IChatAgentRequest = {
							sessionResource: model.sessionResource,
							requestId: thisRequest.id,
							agentId: agent.id,
							message,
							command: command?.name,
							variables: variableData,
							enableCommandDetection,
							isParticipantDetected,
							attempt,
							location,
							locationData: thisRequest.locationData,
							acceptedConfirmationData: options?.acceptedConfirmationData,
							rejectedConfirmationData: options?.rejectedConfirmationData,
							agentHostSessionConfig: options?.agentHostSessionConfig,
							userSelectedModelId: effectiveModelId,
							modelConfiguration: options?.userSelectedModelConfiguration ?? (effectiveModelId ? this.languageModelsService.getModelConfiguration(effectiveModelId) : undefined),
							userSelectedTools: options?.userSelectedTools?.get(),
							modeInstructions: options?.modeInfo?.modeInstructions,
							modeInfo: options?.modeInfo,
							permissionLevel: options?.modeInfo?.permissionLevel,
							editedFileEvents: thisRequest.editedFileEvents,
							hooks: collectedHooks,
							hasHooksEnabled: !!collectedHooks && Object.values(collectedHooks).some(arr => arr.length > 0),
							isVoiceModeInput: options?.isVoiceModeInput,
							isSystemInitiated: options?.isSystemInitiated,
							workingDirectory: model.workingDirectory,
						};

						let isInitialTools = true;

						store.add(autorun(reader => {
							const tools = options?.userSelectedTools?.read(reader);
							if (isInitialTools) {
								isInitialTools = false;
								return;
							}

							if (tools && request) {
								this.chatAgentService.setRequestTools(agent.id, request.id, tools);
								agentRequest.userSelectedTools = tools;
							}
						}));

						return agentRequest;
					};

					if (
						this.configurationService.getValue('chat.detectParticipant.enabled') !== false &&
						this.chatAgentService.hasChatParticipantDetectionProviders() &&
						!agentPart &&
						!commandPart &&
						!agentSlashCommandPart &&
						enableCommandDetection &&
						location !== ChatAgentLocation.EditorInline &&
						options?.modeInfo?.kind !== ChatModeKind.Agent &&
						options?.modeInfo?.kind !== ChatModeKind.Edit &&
						!options?.agentIdSilent &&
						defaultAgent
					) {
						const defaultAgentHistory = this.getHistoryEntriesFromModel(requests, location, defaultAgent.id);
						const chatAgentRequest = buildAgentRequest(defaultAgent, undefined, enableCommandDetection, false);

						const result = await this.chatAgentService.detectAgentOrCommand(chatAgentRequest, defaultAgentHistory, { location }, token);
						if (result && this.chatAgentService.getAgent(result.agent.id)?.locations?.includes(location)) {
							request?.response?.setAgent(result.agent, result.command);
							detectedAgent = result.agent;
							detectedCommand = result.command;
						}
					}

					let agent = (detectedAgent ?? agentPart?.agent ?? defaultAgent);
					if (!agent) {
						agent = this.chatAgentService.getActivatedAgents()[0]
							?? (this.chatAgentService.getAgents()[0] as any)
							?? ChatService._dardcorFallbackAgent;
					}
					const command = detectedCommand ?? agentSlashCommandPart?.command;

					if (agent.id && !agent.id.startsWith('dardcor.') && !agent.isCore && !agent.isDynamic) {
						await this.extensionService.activateByEvent(`onChatParticipant:${agent.id}`);
					} else {
						await Promise.allSettled([
							this.extensionService.activateByEvent('onChatParticipant:github.dardcor.editsAgent'),
							this.extensionService.activateByEvent('onChatParticipant:github.dardcor.default'),
						]);
					}

					const history = this.getHistoryEntriesFromModel(requests, location, agent.id);
					const requestProps = buildAgentRequest(agent, command, enableCommandDetection, !!detectedAgent);
					this.generateInitialChatTitleIfNeeded(model, requestProps, defaultAgent, token);
					const pendingRequest = this._pendingRequests.get(sessionResource);
					if (pendingRequest) {
						store.add(autorun(reader => {
							const yieldRequested = pendingRequest.yieldRequested.read(reader);
							if (request) {
								this.chatAgentService.setYieldRequested(agent.id, request.id, yieldRequested);
							}
						}));
						pendingRequest.requestId ??= requestProps.requestId;
						if (pendingRequest.requestId) {
							this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'add', source: 'sendRequestId', requestId: pendingRequest.requestId, chatSessionId: chatSessionResourceToId(sessionResource) });
						}
					}

					const disabledClaudeHooksDismissedKey = 'chat.disabledClaudeHooks.notification';
					if (hasDisabledClaudeHooks && !this.storageService.getBoolean(disabledClaudeHooksDismissedKey, StorageScope.WORKSPACE)) {
						this.storageService.store(disabledClaudeHooksDismissedKey, true, StorageScope.WORKSPACE, StorageTarget.USER);
						progressCallback([{ kind: 'disabledClaudeHooks' }]);
					}

					if (model.canUseTools) {
						const autostartResult = new ChatMcpServersStarting(this.mcpService.autostart(token));
						if (!autostartResult.isEmpty) {
							progressCallback([autostartResult]);
							await autostartResult.wait();
						}
					}

					const agentResult = await this.chatAgentService.invokeAgent(agent.id, requestProps, progressCallback, history, token);
					rawResult = agentResult;
					agentOrCommandFollowups = this.chatAgentService.getFollowups(agent.id, requestProps, agentResult, history, followupsCancelToken);
				} else if (commandPart && this.chatSlashCommandService.hasCommand(commandPart.slashCommand.command, getChatSessionType(model.sessionResource))) {
					if (commandPart.slashCommand.silent !== true) {
						request = model.addRequest(parsedRequest, { variables: [] }, attempt, options?.modeInfo);
						completeResponseCreated();
					}
					const history: IChatMessage[] = [];
					for (const modelRequest of model.getRequests()) {
						if (!modelRequest.response) {
							continue;
						}
						history.push({ role: ChatMessageRole.User, content: [{ type: 'text', value: modelRequest.message.text }] });
						history.push({ role: ChatMessageRole.Assistant, content: [{ type: 'text', value: modelRequest.response.response.toString() }] });
					}
					const message = parsedRequest.text;
					const commandResult = await this.chatSlashCommandService.executeCommand(commandPart.slashCommand.command, message.substring(commandPart.slashCommand.command.length + 1).trimStart(), new Progress<IChatProgress>(p => {
						progressCallback([p]);
					}), history, location, model.sessionResource, token, options);
					agentOrCommandFollowups = Promise.resolve(commandResult?.followUp);
					rawResult = {};

				} else {
					const fallbackAgent = defaultAgent ?? this.chatAgentService.getActivatedAgents()[0] ?? this.chatAgentService.getAgents()[0] ?? ChatService._dardcorFallbackAgent;
					if (fallbackAgent) {
						if (!request) {
							request = model.addRequest(parsedRequest, { variables: [] }, attempt, options?.modeInfo, fallbackAgent, undefined, options?.confirmation, options?.locationData, options?.attachedContext, undefined, options?.userSelectedModelId);
							completeResponseCreated();
						}
						const thisReq = request;
						const fallbackEffectiveModelId = options?.userSelectedModelId ?? model.getRequests().slice().reverse().find(r => r.modelId && r.modelId !== 'auto' && !r.modelId.endsWith('/auto') && !r.modelId.endsWith('/no-model-selected'))?.modelId;
						const agentRequest: IChatAgentRequest = {
							sessionResource: model.sessionResource,
							requestId: thisReq.id,
							agentId: fallbackAgent.id,
							message: parsedRequest.text,
							variables: { variables: [] },
							enableCommandDetection,
							attempt,
							location,
							locationData: thisReq.locationData,
							userSelectedModelId: fallbackEffectiveModelId,
						};
						rawResult = await this.chatAgentService.invokeAgent(fallbackAgent.id, agentRequest, progressCallback, [], token);
					} else {
						rawResult = {};
					}
				}

				if ((token.isCancellationRequested && !rawResult)) {
					return;
				} else if (!request) {
					shouldProcessPending = !token.isCancellationRequested;
					return;
				} else {
					if (!rawResult) {
						this.trace('sendRequest', `Provider returned no response for session ${model.sessionResource}`);
						rawResult = { errorDetails: { message: localize('emptyResponse', "Provider returned null response") } };
					}

					const result = rawResult.errorDetails?.responseIsFiltered ? 'filtered' :
						rawResult.errorDetails && gotProgress ? 'errorWithOutput' :
							rawResult.errorDetails ? 'error' :
								'success';

					requestTelemetry.complete({
						timeToFirstProgress: rawResult.timings?.firstProgress,
						totalTime: rawResult.timings?.totalElapsed,
						result,
						requestType,
						detectedAgent,
						request,
					});

					model.setResponse(request, rawResult);
					completeResponseCreated();
					this.trace('sendRequest', `Provider returned response for session ${model.sessionResource}`);

					if (rawResult.errorDetails?.isRateLimited) {
						this.chatEntitlementService.markAnonymousRateLimited();
					}

					shouldProcessPending = !rawResult.errorDetails
						&& !token.isCancellationRequested
						&& !request.response?.response.value.some(v => v.kind === 'confirmation' && !v.isUsed);
					request.response?.complete();

					if (agentOrCommandFollowups) {
						const completedRequest = request;
						agentOrCommandFollowups.then(followups => {
							model.setFollowups(completedRequest, followups);
							const commandForTelemetry = agentSlashCommandPart ? agentSlashCommandPart.command.name : commandPart?.slashCommand.command;
							this._chatServiceTelemetry.retrievedFollowups(agentPart?.agent.id ?? '', commandForTelemetry, followups?.length ?? 0);
						});
					}
				}
			} catch (err) {
				this.logService.error(`Error while handling chat request: ${toErrorMessage(err, true)}`);
				if (request) {
					requestTelemetry.complete({
						timeToFirstProgress: undefined,
						totalTime: undefined,
						result: 'error',
						requestType,
						detectedAgent,
						request,
					});
					const rawResult: IChatAgentResult = { errorDetails: { message: (err as any)?.message || String(err) } };
					model.setResponse(request, rawResult);
					completeResponseCreated();
					request.response?.complete();
				}
			} finally {
				store.dispose();
			}
		};
		let shouldProcessPending = false;
		const rawResponsePromise = sendRequestInternal();
		const cancellableRequest = this.instantiationService.createInstance(CancellableRequest, source, undefined, rawResponsePromise, options);
		this._pendingRequests.set(model.sessionResource, cancellableRequest);
		this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'add', source: 'sendRequest', chatSessionId: chatSessionResourceToId(model.sessionResource) });
		rawResponsePromise.finally(() => {
			markChat(sessionResource, ChatPerfMark.RequestComplete);
			clearChatMarks(sessionResource);
			if (this._pendingRequests.get(model.sessionResource) === cancellableRequest) {
				this._pendingRequests.deleteAndDispose(model.sessionResource);
				this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'remove', source: 'sendRequestComplete', requestId: cancellableRequest.requestId, chatSessionId: chatSessionResourceToId(model.sessionResource) });
			}
			if (shouldProcessPending) {
				this.processNextPendingRequest(model);
			}
		});
		if (options?.userSelectedModelId && !options.isSystemInitiated) {
			this.languageModelsService.addToRecentlyUsedList(options.userSelectedModelId);
		}
		this._onDidSubmitRequest.fire({ chatSessionResource: model.sessionResource, message: parsedRequest });
		return {
			responseCreatedPromise: responseCreated.p,
			responseCompletePromise: rawResponsePromise,
		};
	}

	processPendingRequests(sessionResource: URI): void {
		const model = this._sessionModels.get(sessionResource);
		if (model && !this._pendingRequests.has(sessionResource)) {
			this.processNextPendingRequest(model);
		}
	}

	private _isServerManagedQueue(sessionResource: URI): boolean {
		return getChatSessionType(sessionResource).startsWith('agent-host-');
	}

	private processNextPendingRequest(model: ChatModel): void {
		if (this._isServerManagedQueue(model.sessionResource)) {
			return;
		}

		const steeringRequests = model.dequeueAllSteeringRequests();

		const nextQueued = steeringRequests.length === 0 ? model.dequeuePendingRequest() : undefined;

		const allRequests = steeringRequests.length > 0 ? steeringRequests : (nextQueued ? [nextQueued] : []);
		if (allRequests.length === 0) {
			return;
		}

		this.trace('processNextPendingRequest', `Processing ${allRequests.length} queued request(s) for session ${model.sessionResource}`);

		const deferreds: DeferredPromise<ChatSendResult>[] = [];
		for (const req of allRequests) {
			const deferred = this._queuedRequestDeferreds.get(req.request.id);
			this._queuedRequestDeferreds.delete(req.request.id);
			if (deferred) {
				deferreds.push(deferred);
			}
		}

		const firstRequest = allRequests[0];

		const terminalIds = new Set(allRequests.map(req => req.sendOptions.terminalExecutionId).filter((id): id is string => !!id));
		if (terminalIds.size > 1) {
			this.info('processNextPendingRequest', `Dropping terminalExecutionId: ${terminalIds.size} conflicting terminal IDs (${[...terminalIds].join(', ')})`);
		}
		const mergedTerminalExecutionId = terminalIds.size === 1 ? [...terminalIds][0] : undefined;

		const sendOptions: IChatSendRequestOptions = {
			...firstRequest.sendOptions,
			terminalExecutionId: mergedTerminalExecutionId,
			attachedContext: allRequests.flatMap(req => req.request.variableData.variables.slice()),
		};

		const location = sendOptions.location ?? sendOptions.locationData?.type ?? model.initialLocation;
		const defaultAgent = this.chatAgentService.getDefaultAgent(location, sendOptions.modeInfo?.kind);
		if (!defaultAgent) {
			this.logService.warn('processNextPendingRequest', `No default agent for location ${location}`);
		}

		let parsedRequest: IParsedChatRequest;
		try {
			if (allRequests.length > 1) {
				const combinedText = allRequests.map(req => req.request.message.text).join('\n\n');
				parsedRequest = this.parseChatRequest(model.sessionResource, combinedText, location, {
					...sendOptions,
					agentId: undefined,
					slashCommand: undefined,
				});
			} else {
				parsedRequest = firstRequest.request.message;
			}
		} catch (err) {
			this.logService.error('processNextPendingRequest: failed to parse combined chat request', err);
			const reason = toErrorMessage(err);
			for (const deferred of deferreds) {
				deferred.complete({ kind: 'rejected', reason });
			}
			return;
		}

		const silentAgent = sendOptions.agentIdSilent ? this.chatAgentService.getAgent(sendOptions.agentIdSilent) : undefined;
		const agent = silentAgent ?? parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart)?.agent ?? defaultAgent;
		const agentSlashCommandPart = parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);
		
		const resolvedAgent: IChatAgentData = agent ?? defaultAgent ?? ChatService._dardcorFallbackAgent;

		const responseState = this._sendRequestAsync(model, model.sessionResource, parsedRequest, firstRequest.request.attempt, !sendOptions.noCommandDetection, silentAgent ?? defaultAgent, location, sendOptions);

		const result: ChatSendResultSent = {
			kind: 'sent',
			data: {
				...responseState,
				agent: resolvedAgent,
				slashCommand: agentSlashCommandPart?.command,
			},
		};
		for (const deferred of deferreds) {
			deferred.complete(result);
		}
	}

	private generateInitialChatTitleIfNeeded(model: ChatModel, request: IChatAgentRequest, defaultAgent: IChatAgentData | undefined, token: CancellationToken): void {
		if (model.getRequests().length !== 1 || model.customTitle || !defaultAgent) {
			return;
		}

		const singleEntryHistory: IChatAgentHistoryEntry[] = [{
			request,
			response: [],
			result: {}
		}];
		const generate = async () => {
			const title = await this.chatAgentService.getChatTitle(defaultAgent.id, singleEntryHistory, token);
			if (title && !model.customTitle) {
				model.setCustomTitle(title);
			}
		};
		void generate();
	}

	private prepareContext(attachedContextVariables: IChatRequestVariableEntry[] | undefined): IChatRequestVariableEntry[] {
		attachedContextVariables ??= [];

		attachedContextVariables.sort((a, b) => {
			if (!a.range && !b.range) {
				return 0;
			}
			if (!a.range) {
				return 1;
			}
			if (!b.range) {
				return -1;
			}
			return b.range.start - a.range.start;
		});

		return attachedContextVariables;
	}

	private getHistoryEntriesFromModel(requests: IChatRequestModel[], location: ChatAgentLocation, forAgentId: string): IChatAgentHistoryEntry[] {
		const history: IChatAgentHistoryEntry[] = [];
		const agent = this.chatAgentService.getAgent(forAgentId);
		for (const request of requests) {
			if (!request.response) {
				continue;
			}

			if (forAgentId !== request.response.agent?.id && !agent?.isDefault && !agent?.canAccessPreviousChatHistory) {
				continue;
			}

			if (location === ChatAgentLocation.EditorInline) {
				continue;
			}

			const promptTextResult = getPromptText(request.message);
			const historyRequest: IChatAgentRequest = {
				sessionResource: request.session.sessionResource,
				requestId: request.id,
				agentId: request.response.agent?.id ?? '',
				message: promptTextResult.message,
				command: request.response.slashCommand?.name,
				variables: updateRanges(request.variableData, promptTextResult.diff),
				location: ChatAgentLocation.Chat,
				editedFileEvents: request.editedFileEvents,
				modeInstructions: request.modeInfo?.modeInstructions,
			};
			history.push({ request: historyRequest, response: toChatHistoryContent(request.response.response.value), result: request.response.result ?? {} });
		}

		return history;
	}

	async removeRequest(sessionResource: URI, requestId: string): Promise<void> {
		const model = this._sessionModels.get(sessionResource);
		if (!model) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		const pendingRequest = this._pendingRequests.get(sessionResource);
		if (pendingRequest?.requestId === requestId) {
			pendingRequest.cancel();
			this._pendingRequests.deleteAndDispose(sessionResource);
			this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'remove', source: 'removeRequest', requestId, chatSessionId: chatSessionResourceToId(model.sessionResource) });
		}

		model.removeRequest(requestId);
	}

	async adoptRequest(sessionResource: URI, request: IChatRequestModel) {
		if (!(request instanceof ChatRequestModel)) {
			throw new TypeError('Can only adopt requests of type ChatRequestModel');
		}
		const target = this._sessionModels.get(sessionResource);
		if (!target) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		const oldOwner = request.session;
		target.adoptRequest(request);

		if (request.response && !request.response.isComplete) {
			const cts = this._pendingRequests.deleteAndLeak(oldOwner.sessionResource);
			if (cts) {
				cts.requestId = request.id;
				this._pendingRequests.set(target.sessionResource, cts);
				this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'remove', source: 'adoptRequest', requestId: request.id, chatSessionId: chatSessionResourceToId(oldOwner.sessionResource) });
				this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'add', source: 'adoptRequest', requestId: request.id, chatSessionId: chatSessionResourceToId(target.sessionResource) });
			}
		}
	}

	async addCompleteRequest(sessionResource: URI, message: IParsedChatRequest | string, variableData: IChatRequestVariableData | undefined, attempt: number | undefined, response: IChatCompleteResponse): Promise<void> {
		this.trace('addCompleteRequest', `message: ${message}`);

		const model = this._sessionModels.get(sessionResource);
		if (!model) {
			throw new Error(`Unknown session: ${sessionResource}`);
		}

		const parsedRequest = typeof message === 'string' ?
			this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(sessionResource, message) :
			message;
		const request = model.addRequest(parsedRequest, variableData || { variables: [] }, attempt ?? 0, undefined, undefined, undefined, undefined, undefined, undefined, true);
		if (typeof response.message === 'string') {
			model.acceptResponseProgress(request, { content: new MarkdownString(response.message), kind: 'markdownContent' });
		} else {
			for (const part of response.message) {
				model.acceptResponseProgress(request, part, true);
			}
		}
		model.setResponse(request, response.result || {});
		if (response.followups !== undefined) {
			model.setFollowups(request, response.followups);
		}
		request.response?.complete();
	}

	async cancelCurrentRequestForSession(sessionResource: URI, source?: string): Promise<void> {
		this.trace('cancelCurrentRequestForSession', `session: ${sessionResource}`);
		const pendingRequest = this._pendingRequests.get(sessionResource);
		if (!pendingRequest) {
			if (source !== 'archive') {
				const model = this._sessionModels.get(sessionResource);
				const requestInProgress = model?.requestInProgress.get();
				const pendingRequestsCount = model?.getPendingRequests().length ?? 0;
				const lastRequest = model?.lastRequest;
				this.telemetryService.publicLog2<ChatStopCancellationNoopEvent, ChatStopCancellationNoopClassification>(ChatStopCancellationNoopEventName, {
					source: source ?? 'chatService',
					reason: 'noPendingRequest',
					requestInProgress: requestInProgress === undefined ? 'unknown' : requestInProgress ? 'true' : 'false',
					pendingRequests: pendingRequestsCount,
					sessionScheme: sessionResource.scheme,
					lastRequestId: lastRequest?.id,
					chatSessionId: chatSessionResourceToId(sessionResource),
				});
				this.info('cancelCurrentRequestForSession', `No pending request was found for session ${sessionResource}. requestInProgress=${requestInProgress ?? 'unknown'}, pendingRequests=${pendingRequestsCount}`);
			}
			return;
		}

		const responseCompletePromise = pendingRequest.responseCompletePromise;
		pendingRequest.cancel();
		this._pendingRequests.deleteAndDispose(sessionResource);
		this.telemetryService.publicLog2<ChatPendingRequestChangeEvent, ChatPendingRequestChangeClassification>(ChatPendingRequestChangeEventName, { action: 'remove', source: source ?? 'cancelRequest', requestId: pendingRequest.requestId, chatSessionId: chatSessionResourceToId(sessionResource) });

		if (responseCompletePromise) {
			await raceTimeout(responseCompletePromise, 1000);
		}
	}

	setYieldRequested(sessionResource: URI): void {
		const pendingRequest = this._pendingRequests.get(sessionResource);
		if (pendingRequest) {
			pendingRequest.setYieldRequested();
		}
	}

	migrateRequests(originalResource: URI, targetResource: URI): void {
		const model = this._sessionModels.get(originalResource);
		if (!model) {
			return;
		}

		const pendingRequests = [...model.getPendingRequests()];

		if (pendingRequests.length === 0) {
			return;
		}

		for (const pending of pendingRequests) {
			this.removePendingRequest(originalResource, pending.request.id);
		}

		for (const pending of pendingRequests) {
			void this.sendRequest(targetResource, pending.request.message.text, {
				...pending.sendOptions,
				queue: pending.kind,
			});
		}
	}

	removePendingRequest(sessionResource: URI, requestId: string): void {
		const model = this._sessionModels.get(sessionResource) as ChatModel | undefined;
		if (model) {
			model.removePendingRequest(requestId);

			const hasSteeringRequests = model.getPendingRequests().some(r => r.kind === ChatRequestQueueKind.Steering);
			if (!hasSteeringRequests) {
				const pendingRequest = this._pendingRequests.get(sessionResource);
				pendingRequest?.resetYieldRequested();
			}
		}

		const deferred = this._queuedRequestDeferreds.get(requestId);
		if (deferred) {
			deferred.complete({ kind: 'rejected', reason: 'Request was removed from queue', reasonCode: 'cancelled' });
			this._queuedRequestDeferreds.delete(requestId);
		}
	}

	setPendingRequests(sessionResource: URI, requests: readonly { requestId: string; kind: ChatRequestQueueKind }[]): void {
		const model = this._sessionModels.get(sessionResource) as ChatModel | undefined;
		if (model) {
			model.setPendingRequests(requests);
		}
	}

	syncPendingRequestsFromRemote(sessionResource: URI, requests: readonly IRemotePendingRequest[]): void {
		const model = this._sessionModels.get(sessionResource) as ChatModel | undefined;
		if (!model) {
			return;
		}

		const existing = model.getPendingRequests();
		const existingById = new Map(existing.map(request => [request.request.id, request]));
		const reconciled: IChatPendingRequest[] = requests.map(remote => {
			const variableData = remote.variableData ?? { variables: [] };
			const local = existingById.get(remote.id);
			if (local && local.request.message.text === remote.message && equals(local.request.variableData, variableData)) {
				return local.kind === remote.kind ? local : { ...local, kind: remote.kind };
			}
			const parsedRequest = this.parseChatRequest(sessionResource, remote.message, model.initialLocation, undefined);
			const requestModel = new ChatRequestModel({
				session: model,
				message: parsedRequest,
				variableData,
				timestamp: remote.timestamp,
				attachedContext: variableData.variables.slice(),
				restoredId: remote.id,
			});
			return { request: requestModel, kind: remote.kind, sendOptions: local?.sendOptions ?? {} };
		});

		if (existing.length === reconciled.length && reconciled.every((request, index) => existing[index] === request)) {
			return;
		}

		const reconciledIds = new Set(reconciled.map(request => request.request.id));
		model.replacePendingRequests(reconciled);

		for (const local of existing) {
			if (reconciledIds.has(local.request.id)) {
				continue;
			}
			const deferred = this._queuedRequestDeferreds.get(local.request.id);
			if (deferred) {
				deferred.complete({ kind: 'rejected', reason: 'Request is no longer in the provider queue', reasonCode: 'providerRemoved' });
				this._queuedRequestDeferreds.delete(local.request.id);
			}
		}

		if (!reconciled.some(request => request.kind === ChatRequestQueueKind.Steering)) {
			this._pendingRequests.get(sessionResource)?.resetYieldRequested();
		}
	}

	async sendPendingRequestImmediately(sessionResource: URI, requestId: string): Promise<void> {
		const model = this._sessionModels.get(sessionResource) as ChatModel | undefined;
		if (!model) {
			return;
		}

		const pendingRequests = model.getPendingRequests();
		const target = pendingRequests.find(r => r.request.id === requestId);
		if (!target) {
			return;
		}

		if (this._isServerManagedQueue(sessionResource)) {
			const message = target.request.message.text;
			const attachedContext = target.request.variableData.variables.slice();
			const sendOptions: IChatSendRequestOptions = {
				...target.sendOptions,
				queue: undefined,
				attachedContext,
			};
			this.removePendingRequest(sessionResource, requestId);
			await this.cancelCurrentRequestForSession(sessionResource, 'queueRunNext');
			let result: ChatSendResult | undefined;
			try {
				result = await this.sendRequest(sessionResource, message, sendOptions);
			} catch (err) {
				this.logService.error('sendPendingRequestImmediately: re-send failed', err);
			}
			if (!result || result.kind === 'rejected') {
				this.info('sendPendingRequestImmediately', `Re-send was not accepted (${result?.kind ?? 'error'}); restoring pending message to the queue`);
				await this.sendRequest(sessionResource, message, { ...sendOptions, attachedContext, queue: target.kind });
			}
			return;
		}

		const reordered = [
			{ requestId: target.request.id, kind: target.kind },
			...pendingRequests.filter(r => r.request.id !== requestId).map(r => ({ requestId: r.request.id, kind: r.kind })),
		];
		this.setPendingRequests(sessionResource, reordered);
		await this.cancelCurrentRequestForSession(sessionResource, 'queueRunNext');
		this.processPendingRequests(sessionResource);
	}

	public hasSessions(): boolean {
		return this._chatSessionStore.hasSessions();
	}

	async transferChatSession(transferredSessionResource: URI, toWorkspace: URI): Promise<void> {
		if (!LocalChatSessionUri.isLocalSession(transferredSessionResource)) {
			throw new Error(`Can only transfer local chat sessions. Invalid session: ${transferredSessionResource}`);
		}

		const model = this._sessionModels.get(transferredSessionResource) as ChatModel | undefined;
		if (!model) {
			throw new Error(`Failed to transfer session. Unknown session: ${transferredSessionResource}`);
		}

		if (model.initialLocation !== ChatAgentLocation.Chat) {
			throw new Error(`Can only transfer chat sessions located in the Chat view. Session ${transferredSessionResource} has location=${model.initialLocation}`);
		}

		await this._chatSessionStore.storeTransferSession({
			sessionResource: model.sessionResource,
			timestampInMilliseconds: Date.now(),
			toWorkspace: toWorkspace,
		}, model);
		this.chatTransferService.addWorkspaceToTransferred(toWorkspace);
		this.trace('transferChatSession', `Transferred session ${model.sessionResource} to workspace ${toWorkspace.toString()}`);
	}

	getChatStorageFolder(): URI {
		return this._chatSessionStore.getChatStorageFolder();
	}

	logChatIndex(): void {
		this._chatSessionStore.logIndex();
	}

	setSessionTitle(sessionResource: URI, title: string): void {
		this._sessionModels.get(sessionResource)?.setCustomTitle(title);
	}

	appendProgress(request: IChatRequestModel, progress: IChatProgress): void {
		const model = this._sessionModels.get(request.session.sessionResource);
		if (!(request instanceof ChatRequestModel)) {
			throw new BugIndicatingError('Can only append progress to requests of type ChatRequestModel');
		}

		model?.acceptResponseProgress(request, progress);
	}

	private toLocalSessionId(sessionResource: URI) {
		const localSessionId = LocalChatSessionUri.parseLocalSessionId(sessionResource);
		if (!localSessionId) {
			throw new Error(`Invalid local chat session resource: ${sessionResource}`);
		}
		return localSessionId;
	}
}

export async function chatModelToChatDetail(model: IChatModel): Promise<IChatDetail> {
	const title = model.title || localize('newChat', "New Chat");
	return {
		sessionResource: model.sessionResource,
		title,
		lastMessageDate: model.lastMessageDate,
		timing: model.timing,
		isActive: true,
		stats: await awaitStatsForSession(model),
		lastResponseState: model.lastRequest?.response?.state ?? ResponseModelState.Pending,
		workingDirectory: model.workingDirectory,
	};
}
