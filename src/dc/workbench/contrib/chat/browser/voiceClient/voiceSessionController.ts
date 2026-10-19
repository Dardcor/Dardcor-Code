/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, observableValue, autorun, transaction, observableSignalFromEvent } from '../../../../../base/common/observable.js';
import { addDisposableListener, disposableWindowInterval } from '../../../../../base/browser/dom.js';
import { renderAsPlaintext } from '../../../../../base/browser/markdownRenderer.js';
import { alert as ariaAlert } from '../../../../../base/browser/ui/aria/aria.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { isObject } from '../../../../../base/common/types.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { IVoiceTranscriptEntryMetadata, IVoiceTranscriptStore, IVoiceTranscriptTurn, VoiceTranscriptKind } from '../../../agentsVoice/common/voiceTranscriptStore.js';
import { IVoiceAudioResponse, IVoiceBargeIn, IVoiceCheckpointNarrationMetadata, IVoiceClientService, IVoicePriorTimelineEntry, IVoiceSessionContext, IVoiceFeedbackPayload, IVoiceFeedbackTranscriptTurn, IVoiceTranscription, IVoiceTurnAutoEnded, IVoiceNarrationAck, IVoiceNarrationSignal, isVoiceCheckpointId, VoiceCheckpointId, VoiceConfirmationType, VoiceNarrationKind, IVoiceSessionPending, IVoicePendingQuestion, derivePendingId, getVoiceToolApprovalCommand, isPendingIdResolved, VOICE_AGENT_PROGRESS_SETTING } from '../../common/voiceClient/voiceClientService.js';
import { getVoiceConfirmationType, isPendingVoiceQuestionnaireInvocation, isVoiceQuestionnaireInvocation } from '../../common/voiceClient/voiceConfirmation.js';
import { IMicCaptureService, IPttDiagnostic, isMicrophonePermissionDeniedError } from './micCaptureService.js';
import { ITtsPlaybackService } from './ttsPlaybackService.js';
import { IVoiceAttachmentResult, IVoiceModelSelectionResult, IVoiceToolDispatchService, VoiceToolDispatchService } from './voiceToolDispatchService.js';
import { IVoicePlaybackService } from '../../common/voicePlaybackService.js';
import { ChatSendResult, IChatConfirmation, IChatElicitationRequest, IChatPlanReview, IChatQuestionCarousel, IChatService, IChatToolInvocation, ToolConfirmKind, IChatModelReference } from '../../common/chatService/chatService.js';
import { getDisplayedQuestionText, getOptionsWithDefaultsFirst } from '../../common/chatService/chatQuestionCarouselHelpers.js';
import { formatQuestionPrompt } from '../../common/voiceClient/voicePendingNarration.js';
import { IChatWidget, IChatWidgetService } from '../chat.js';
import { IChatModel, IChatProgressResponseContent, IChatResponseModel } from '../../common/model/chatModel.js';
import { isExplicitFileOrImageVariableEntry } from '../../common/attachments/chatVariableEntries.js';
import { ChatAgentLocation } from '../../common/constants.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { CHAT_INPUT_WINDOW_ACCEPT_VOICE_COMMAND_ID, CHAT_INPUT_WINDOW_SET_VOICE_TARGET_COMMAND_ID } from '../../common/chatInputWindow.js';
import { IPromptsService } from '../../common/promptSyntax/service/promptsService.js';
import { ChatEntitlement, IChatEntitlementService, isProUser } from '../../../../services/chat/common/chatEntitlementService.js';
import {
	VoiceFirstConnectClassification, VoiceFirstConnectEvent,
	VoiceSessionStartedClassification, VoiceSessionStartedEvent,
	VoiceSessionEndedClassification, VoiceSessionEndedEvent,
	VoicePttClassification, VoicePttEvent,
	VoiceTtsListenThroughClassification, VoiceTtsListenThroughEvent,
	VoiceToolApprovalClassification, VoiceToolApprovalEvent,
	VoiceReconnectClassification, VoiceReconnectEvent,
	VoiceLatencyClassification, VoiceLatencyEvent,
	VoiceNarrationDeferredClassification, VoiceNarrationDeferredEvent,
	VoiceNarrationDroppedClassification, VoiceNarrationDroppedEvent,
} from './voiceTelemetry.js';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export function isVoiceEntitled(chatEntitlementService: IChatEntitlementService): boolean {
	return isProUser(chatEntitlementService.entitlement)
		&& (chatEntitlementService.entitlement !== ChatEntitlement.Enterprise || chatEntitlementService.isInternal);
}

export function isVoiceSessionActiveForInput(
	isVoiceInputActive: boolean,
	targetSessionResource: URI | undefined,
	hasDraftTarget: boolean,
	sessionResource: URI | undefined
): boolean {
	if (targetSessionResource) {
		return isEqual(targetSessionResource, sessionResource);
	}
	if (hasDraftTarget) {
		return false;
	}
	return isVoiceInputActive;
}

interface IDeferredChunk {
	readonly audio: string;
	readonly isFirstChunk: boolean;
	readonly isFinal: boolean;
	readonly transcript: string | undefined;
}

interface IDeferredFlushResult {
	readonly flushed: boolean;
	readonly retained?: boolean;
	readonly retainedTranscript?: string;
	readonly finalTranscripts: readonly string[];
}

interface IDeferredResponse {
	readonly responseId?: string;
	readonly turnId?: string;
	finalized: boolean;
	readonly chunks: IDeferredChunk[];
}

interface IPendingSolicitedNarration {
	readonly sessionId: string;
	readonly kind: VoiceNarrationKind;
	readonly text: string;
	readonly pending?: { pendingId: string };
	readonly checkpoint?: IVoiceCheckpointNarrationMetadata;
	readonly confirmationType?: VoiceConfirmationType;
	readonly audioStartTimer: ReturnType<typeof setTimeout>;
	hasReceivedAudio: boolean;
}

interface IVoiceNarratable {
	readonly kind: Exclude<VoiceNarrationKind, 'checkpoint'>;
	readonly text: string;
	readonly pending?: { pendingId: string };
	readonly confirmationType?: VoiceConfirmationType;
}

interface IOmniQueuedNarration extends IVoiceNarratable {
	readonly sessionId: string;
	readonly ordinal: number;
}

interface IRoutedVoiceRequest {
	readonly requestId: string | undefined;
	modelRequestId?: string;
	previousRequestId?: string | null;
	readonly phase: 'queued' | 'running' | 'waiting';
}

interface IPlaybackNarration {
	readonly kind: VoiceNarrationKind;
	readonly checkpoint?: IVoiceCheckpointNarrationMetadata;
	readonly playbackId?: string;
}

interface IQueuedAudioResponse {
	readonly sessionId: string | undefined;
	readonly responseId?: string;
	readonly narration?: IPlaybackNarration;
	finalized: boolean;
	readonly chunks: { audio: string; isFirstChunk: boolean; isFinal: boolean; transcript: string | undefined }[];
}

interface IVoiceAgentStateInfo {
	readonly state: string;
	readonly detail?: string;
	readonly confirmation_type?: VoiceConfirmationType;
	readonly last_response_summary?: string;
}

interface IVisibleVoiceQuestionnaire {
	readonly context?: string | IMarkdownString;
	readonly questions: readonly {
		readonly prompt?: string | IMarkdownString;
		readonly details?: string | IMarkdownString;
		readonly options: readonly string[];
		readonly allowFreeformInput: boolean;
	}[];
}

function hasOwn<K extends string>(value: object, key: K): value is Record<K, unknown> {
	return Object.prototype.hasOwnProperty.call(value, key);
}

export interface IPendingToolConfirmation {
	readonly type: 'approval' | 'input';
	readonly sessionLabel: string;
	readonly sessionResource: URI;
	readonly description: string;
	approve(): void;
	deny(): void;
}

export interface ITranscriptTurn {
	readonly speaker: 'user' | 'assistant';
	readonly text: string;
	readonly committed: string;
	readonly isPartial: boolean;
}

type TranscriptionTurnPhase = 'active' | 'pending' | 'final';

interface ITranscriptionTurnState {
	readonly turnId: string;
	highestRevision: number | undefined;
	phase: TranscriptionTurnPhase;
}

export type VoiceNewSessionPreparationResult = 'prepared' | 'sent' | 'failed';

export interface IVoiceSessionController {
	readonly _serviceBrand: undefined;

	readonly voiceState: IObservable<VoiceState>;
	readonly statusText: IObservable<string>;
	readonly transcriptTurns: IObservable<readonly ITranscriptTurn[]>;
	readonly isConnected: IObservable<boolean>;
	readonly isConnecting: IObservable<boolean>;
	readonly isReconnecting: IObservable<boolean>;
	readonly isMuted: IObservable<boolean>;
	readonly pendingToolConfirmations: IObservable<readonly IPendingToolConfirmation[]>;
	readonly targetSession: IObservable<URI | undefined>;
	readonly hasDraftTarget: IObservable<boolean>;
	readonly omniInputActive: IObservable<boolean>;
	getLastSpokenResponseSession(): URI | undefined;

	connect(window: Window & typeof globalThis): Promise<void>;
	setActiveWindow(window: Window & typeof globalThis): void;
	releaseOmniInputOnBlur(): void;
	disconnect(source?: 'explicit' | 'internal'): void;

	pttDown(source?: 'explicit' | 'auto' | 'connect', forceNewTurn?: boolean): void;
	pttUp(source?: 'explicit' | 'internal', forceFinish?: boolean): void;

	stopListening(source?: 'explicit' | 'internal'): void;

	setAutoListenHeld(held: boolean): void;

	discardListening(): void;

	finishListeningAndSubmitTo(session: URI): void;

	markUserCancelled(sessionId: string): void;

	setTargetSession(resource: URI | undefined, omniRoute?: 'existing_session' | 'new_session'): void;
	prepareForRoutingRequest(): void;
	markRoutedRequestPending(resource: URI, requestId?: string): void;
	clearRoutedRequest(resource: URI): void;
	setDraftTarget(): void;
	takeSessionInputOwnership(resource: URI, window: Window & typeof globalThis): void;
	takeDraftInputOwnership(window: Window & typeof globalThis): void;
	takeOmniInputOwnership(window: Window & typeof globalThis): void;

	retainOmniInputOwnershipForBargeIn(window: Window & typeof globalThis): boolean;
	setOmniInputActive(active: boolean): void;
	setOmniInputOpen(open: boolean): void;

	newSessionAsTarget(): void;

	setActiveSessionShown(resource: URI | null | undefined): void;
	promoteDraftTarget(resource: URI): void;

	activateSession(resource: URI): void;

	submitFeedback(feedbackText: string): Promise<{ ok: boolean; error?: string }>;

	simulateConnection(): void;

	setMuted(muted: boolean): void;
}

export const IVoiceSessionController = createDecorator<IVoiceSessionController>('voiceSessionController');

export class VoiceSessionController extends Disposable implements IVoiceSessionController {

	declare readonly _serviceBrand: undefined;

	private readonly _voiceState = observableValue<VoiceState>(this, 'idle');
	readonly voiceState: IObservable<VoiceState> = this._voiceState;

	private readonly _statusText = observableValue<string>(this, 'Tap to start');
	readonly statusText: IObservable<string> = this._statusText;

	private static readonly _MAX_TURNS = 2;
	private readonly _transcriptTurns = observableValue<readonly ITranscriptTurn[]>(this, []);
	readonly transcriptTurns: IObservable<readonly ITranscriptTurn[]> = this._transcriptTurns;

	private readonly _isConnected = observableValue<boolean>(this, false);
	readonly isConnected: IObservable<boolean> = this._isConnected;

	private readonly _isConnecting = observableValue<boolean>(this, false);
	readonly isConnecting: IObservable<boolean> = this._isConnecting;

	private readonly _isReconnecting = observableValue<boolean>(this, false);
	readonly isReconnecting: IObservable<boolean> = this._isReconnecting;

	private readonly _isMuted = observableValue<boolean>(this, false);
	readonly isMuted: IObservable<boolean> = this._isMuted;

	private _fatalDisconnect = false;

	private readonly _pendingToolConfirmations = observableValue<readonly IPendingToolConfirmation[]>(this, []);
	readonly pendingToolConfirmations: IObservable<readonly IPendingToolConfirmation[]> = this._pendingToolConfirmations;

	private readonly _suppressedConfirmationSessions = observableValue<ReadonlySet<string>>(this, new Set());

	private readonly _targetSession = observableValue<URI | undefined>(this, undefined);
	readonly targetSession: IObservable<URI | undefined> = this._targetSession;
	private _targetOmniRoute: 'existing_session' | 'new_session' | undefined;
	private readonly _hasDraftTarget = observableValue<boolean>(this, false);
	readonly hasDraftTarget: IObservable<boolean> = this._hasDraftTarget;
	private readonly _omniInputActive = observableValue<boolean>(this, false);
	readonly omniInputActive: IObservable<boolean> = this._omniInputActive;
	private _omniInputOpen = false;

	private _pttHeld = false;
	private _speechDetectedInTurn = false;
	private _pttCurrentTurnPassive = false;
	private _pttToggleMode = false;
	private _bargeInListenActive = false;
	private _autoListenSuppressed = false;
	private _autoListenHeld = false;
	private _suppressSendToChatUntil = 0;
	private _pinnedSubmitSession: URI | undefined;
	private _pinnedSubmitTimer: ReturnType<typeof setTimeout> | undefined;
	private _enterListenOnSessionInit = false;
	private _pttCurrentTurnId = '';
	private _transcriptionTurnState: ITranscriptionTurnState | undefined;
	private _window: (Window & typeof globalThis) | undefined;
	private readonly _voiceEventDisposables = this._register(new DisposableStore());
	private readonly _windowFocusDisposables = this._register(new DisposableStore());
	private readonly _voiceAutorunDisposable = this._register(new MutableDisposable());
	private readonly _omniBlurRelease = this._register(new MutableDisposable());
	private readonly _connectWatchdog = this._register(new MutableDisposable());
	private static readonly _CONNECT_TIMEOUT_MS = 10000;
	private _connectAttemptGeneration = 0;
	private _sessionInitializationGeneration = 0;
	private readonly _autoApprovedSessions = new Set<string>();
	private _transcriptFadeTimer: ReturnType<typeof setTimeout> | undefined;
	private _pttMaxDurationTimer: ReturnType<typeof setTimeout> | undefined;
	private static readonly _PTT_MAX_DURATION_MS = 5 * 60 * 1000;
	private static readonly _PTT_TOGGLE_THRESHOLD_MS = 300;

	private static readonly _AUTO_LISTEN_QUIET_MS = 1200;
	private _delayedMicStopTimer: ReturnType<typeof setTimeout> | undefined;
	private _autoListenTimer: ReturnType<typeof setTimeout> | undefined;
	private _pttWaitingForPlayback = false;
	private _replyPlayedSinceSend = false;
	private _awaitingReplyAudio = false;
	private _awaitingReplyForSession: string | undefined;
	private _awaitingReplyWatchdog: ReturnType<typeof setTimeout> | undefined;

	private readonly _audioQueue: IQueuedAudioResponse[] = [];
	private _currentPlaybackSessionId: string | undefined | null = null;
	private _currentPlaybackResponseId: string | undefined;
	private _currentPlaybackNarration: IPlaybackNarration | undefined;
	private _currentPlaybackTranscript: string | undefined;
	private _lastSpokenResponseSessionId: string | undefined;
	private _currentPlaybackFinalized = false;
	private _isProcessingQueue = false;

	private _suppressIncomingAudio = false;
	private readonly _interruptedAudioIds = new Set<string>();

	private _lastShownSessionId: string | undefined;
	private _activeSessionShown: string | undefined;
	private _externalActiveSessionMode = false;
	private readonly _deferredResponses = new Map<string, IDeferredResponse[]>();
	private readonly _uiResourceByBackendId = new Map<string, string>();
	private readonly _confirmationPendingSessions = new Set<string>();
	private readonly _cancelledPendingNarrationIds = new Set<string>();
	private readonly _pendingResponseSummaries = new Map<string, string>();
	private readonly _liveReplyKeys = new Set<string>();

	private readonly _responseRoutes = new Map<string, 'live' | 'deferred'>();
	private readonly _responseSessionIds = new Map<string, string>();
	private readonly _ownershipDroppedResponseIds = new Set<string>();

	private readonly _recentlyReadResponse = new Map<string, { transcript: string; at: number }>();
	private readonly _droppingRenarration = new Set<string>();
	private readonly _solicitedNarrationIds = new Set<string>();
	private readonly _lastHeardTranscriptById = new Map<string, string>();

	private readonly _sessionAudioCache = new Map<string, Float32Array>();
	private _replaySourceNode: AudioBufferSourceNode | undefined;

	private readonly _prevSessionStates = new Map<string, { state: string; detail: string; pendingId: string; confirmationType?: VoiceConfirmationType; lastResponseSummary: string }>();

	private readonly _userCancelledSessions = new Map<string, ReturnType<typeof setTimeout>>();
	private static readonly _USER_CANCEL_SUPPRESS_MS = 10_000;
	private static readonly _DISCARD_SEND_SUPPRESS_MS = 2_000;
	private static readonly _PINNED_SUBMIT_EXPIRY_MS = 15_000;

	private readonly _confirmationFlushWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
	private static readonly _CONFIRMATION_FLUSH_DELAY_MS = 1500;

	private readonly _pendingStateChanges = new Map<string, { sessionId: string; currentState: string; label: string; detail?: string; confirmationType?: VoiceConfirmationType; lastResponseSummary?: string; fromState: string; fromDetail: string; fromConfirmationType?: VoiceConfirmationType; fromResponseSummary: string; pendingId: string; fromPendingId: string }>();
	private _stateChangeEmitTimer: ReturnType<typeof setTimeout> | undefined;
	private static readonly _STATE_CHANGE_SETTLE_MS = 120;

	private readonly _eagerModelRefs = new Map<string, IChatModelReference>();

	private readonly _eagerModelLoading = new Set<string>();

	private readonly _pendingIdleNarration = new Set<string>();

	private readonly _sessionsAwaitingResponseSummary = new Set<string>();

	private readonly _lastResponseSummaryById = new Map<string, string>();
	private readonly _routedRequests = new Map<string, IRoutedVoiceRequest>();
	private readonly _abandonedRoutedRequests = new Set<string>();
	private readonly _omniNarrationQueue: IOmniQueuedNarration[] = [];
	private readonly _omniDeferredSessionKeys = new Set<string>();
	private readonly _omniDeferredSessionOrdinals = new Map<string, number>();
	private _omniInboxOrdinal = 0;
	private readonly _omniClaimedPendingIds = new Map<string, string>();
	private readonly _omniClaimedResponseSummaries = new Map<string, string>();

	private readonly _omniNarrationIds = new Set<string>();

	private readonly _lastNarratedText = new Map<string, string>();

	private readonly _pendingNarrationRetries = new Map<string, IVoiceNarratable>();

	private readonly _pendingSolicitedNarrations = new Map<string, IPendingSolicitedNarration>();
	private static readonly _SOLICITED_NARRATION_AUDIO_START_TIMEOUT_MS = 30_000;
	private static readonly _VOICE_PROGRESS_INITIAL_DELAY_MS = 5_000;
	private static readonly _VOICE_PROGRESS_INTERVAL_MS = 10_000;
	private static readonly _MAX_VOICE_PROGRESS_PER_REQUEST = 5;
	private static readonly _MAX_CONFIRMATION_NARRATION_CHARS = 2_400;
	private static readonly _MAX_QUESTIONNAIRE_QUESTIONS = 6;
	private static readonly _MAX_QUESTIONNAIRE_OPTIONS = 5;
	private static readonly _MAX_CONFIRMATION_FIELD_CHARS = 280;
	private readonly _voiceProgressListeners = this._register(new DisposableMap<string, DisposableStore>());
	private readonly _voiceProgressSessionByResponse = new Map<string, string>();
	private readonly _lastSpokenAtBySession = new Map<string, number>();

	private readonly _deferredNarrations = new Map<string, IVoiceNarratable & { narrationId: string; reuseNarrationId: boolean }>();

	private readonly _narratedPending = new Map<string, string>();

	private _telemetrySessionIndex = 0;
	private _telemetrySessionStart: number | undefined;
	private _telemetryTurnCount = 0;
	private _telemetryReconnectCount = 0;
	private _telemetryFirstConnect = true;
	private _telemetryConnectStartMs: number | undefined;
	private _telemetryLastConnectMs: number | undefined;
	private _telemetryPttDownMs: number | undefined;
	private _telemetryPttUpMs: number | undefined;
	private _telemetryFirstTranscriptionMs: number | undefined;
	private _telemetryTtsInterrupted = false;
	private _entitlementCheckScheduled = false;

	private _userLogin: string | undefined;
	private _lastPersistedTurnId: string | undefined;
	private _pendingPriorTimeline: IVoicePriorTimelineEntry[] = [];
	private static readonly PRIOR_TIMELINE_ENTRY_LIMIT = 30;
	private static readonly CODING_AGENT_REPLY_SENTENCE_LIMIT = 2;

	constructor(
		@IVoiceClientService private readonly voiceClientService: IVoiceClientService,
		@IMicCaptureService private readonly micCaptureService: IMicCaptureService,
		@ITtsPlaybackService private readonly ttsPlaybackService: ITtsPlaybackService,
		@IVoiceToolDispatchService private readonly voiceToolDispatchService: IVoiceToolDispatchService,
		@IVoicePlaybackService private readonly voicePlaybackService: IVoicePlaybackService,
		@IChatService private readonly chatService: IChatService,
		@ICommandService private readonly commandService: ICommandService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IVoiceTranscriptStore private readonly voiceTranscriptStore: IVoiceTranscriptStore,
		@ILogService private readonly logService: ILogService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@INotificationService private readonly notificationService: INotificationService,
		@IPromptsService private readonly promptsService: IPromptsService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
	) {
		super();
		this._register(CommandsRegistry.registerCommand(CHAT_INPUT_WINDOW_SET_VOICE_TARGET_COMMAND_ID, (_accessor, resource: string | undefined, kind?: 'existing_session' | 'new_session') => {
			if (this._isConnected.get() || this._isConnecting.get()) {
				this.setTargetSession(resource ? URI.parse(resource) : undefined, kind);
			}
		}));

		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => {
			if (this._entitlementCheckScheduled) {
				return;
			}
			this._entitlementCheckScheduled = true;
			queueMicrotask(() => {
				this._entitlementCheckScheduled = false;
				if (!this._store.isDisposed && !isVoiceEntitled(this.chatEntitlementService)) {
					this.disconnect();
				}
			});
		}));

		this._register(this.chatWidgetService.onDidChangeFocusedSession(() => this._onFocusedSessionChanged()));
		this._register(this.chatWidgetService.onDidChangeWidgetVisibility(widget => {
			if (widget.visible) {
				this._onSessionShown(widget.viewModel?.sessionResource);
			}
		}));

		for (const widget of this.chatWidgetService.getAllWidgets()) {
			this._trackWidgetSession(widget);
		}
		this._register(this.chatWidgetService.onDidAddWidget(widget => this._trackWidgetSession(widget)));

		this.voiceToolDispatchService.setDelegate({
			acceptInput: (text: string): boolean => {
				this.commandService.executeCommand('_chat.voice.acceptInput', text).catch(err => {
					this.logService.warn('[voice] acceptInput delegate failed:', err);
				});
				return true;
			},
			getCurrentSessionResource: async (): Promise<URI | undefined> => {
				const resourceStr = await this.commandService.executeCommand<string | undefined>('_chat.voice.getCurrentSession').catch(() => undefined);
				return resourceStr ? URI.parse(resourceStr) : undefined;
			},
			switchToSession: async (resource: URI): Promise<boolean> =>
				await this.commandService.executeCommand<boolean>('_chat.voice.switchToSession', resource.toString()).catch(() => false) === true,
			setTargetSession: (resource: URI): void => this.setTargetSession(resource),
			getTargetSessionResource: (): URI | undefined => this._targetSession.get(),
			selectModel: async (requestedModel: string): Promise<IVoiceModelSelectionResult> =>
				(await this.commandService.executeCommand<IVoiceModelSelectionResult>('_chat.voice.selectModel', requestedModel)
					.catch(() => undefined)) ?? { ok: false, reason: 'no_input' },
			attachFiles: async (resources: readonly URI[]): Promise<IVoiceAttachmentResult> =>
				(await this.commandService.executeCommand<IVoiceAttachmentResult>('_chat.voice.attachFiles', resources.map(resource => resource.toString()))
					.catch(() => undefined)) ?? { ok: false, reason: 'no_input' },
			getAutoApprovedSessions: (): Set<string> => {
				return this._autoApprovedSessions;
			},
			addAllAutoApprovedSessions: (): void => {
				const sessions: any[] = [];
				for (const s of sessions) {
					this._autoApprovedSessions.add(s.resource.toString());
					const model = this.chatService.getSession(s.resource);
					if (model) {
						this._autoApprovePendingTools(model);
					}
				}
			},
			removeAutoApprovedSession: (resource: string): void => {
				this._autoApprovedSessions.delete(resource);
			},
			triggerAutoApproveCheck: (): void => {
				this._autoApproveCheck();
			},
		});

		this._register(autorun(reader => {
			const agentSessions: any[] = [];
			const toolConfirmations: IPendingToolConfirmation[] = [];
			const processedResources = new Set<string>();
			const suppressedSessions = this._suppressedConfirmationSessions.read(reader);

			const modelsToCheck: { model: IChatModel; resource: URI; label: string }[] = [];
			for (const s of agentSessions) {
				processedResources.add(s.resource.toString());
				this._recordSessionAlias(s.resource);
				const model = this.chatService.getSession(s.resource);
				if (model) {
					modelsToCheck.push({ model, resource: s.resource, label: s.label || 'Untitled session' });
				}
			}

			for (const chatModel of this.chatService.chatModels.read(reader)) {
				const key = chatModel.sessionResource.toString();
				if (processedResources.has(key)) { continue; }
				if (chatModel.getRequests().length === 0) { continue; }
				processedResources.add(key);
				modelsToCheck.push({ model: chatModel, resource: chatModel.sessionResource, label: chatModel.title || 'Chat' });
			}

			for (const { model, resource, label } of modelsToCheck) {
				if (suppressedSessions.has(resource.toString())) { continue; }
				const lastReq = model.lastRequestObs.read(reader);
				if (lastReq?.response) {
					const pending = lastReq.response.isPendingConfirmation.read(reader);
					if (pending && !this._autoApprovedSessions.has(resource.toString())) {
						const confirmType = this._classifyPendingType(lastReq.response);
						const desc = this._getConfirmationDescription(lastReq.response);
						toolConfirmations.push({
							type: confirmType,
							sessionLabel: label,
							sessionResource: resource,
							description: desc || pending.detail || (confirmType === 'input' ? 'Needs your input' : 'Needs approval'),
							approve: () => {
								if (lastReq.response) {
									for (const part of lastReq.response.response.value) {
										if (part.kind === 'toolInvocation') {
											IChatToolInvocation.confirmWith(part as IChatToolInvocation, { type: ToolConfirmKind.UserAction });
										}
									}
								}
							},
							deny: () => {
								if (lastReq.response) {
									for (const part of lastReq.response.response.value) {
										if (part.kind === 'toolInvocation') {
											IChatToolInvocation.confirmWith(part as IChatToolInvocation, { type: ToolConfirmKind.Denied });
										}
									}
								}
							},
						});
					}

					if (!pending && !this._autoApprovedSessions.has(resource.toString())) {
						for (const part of lastReq.response.response.value) {
							if (part.kind === 'toolInvocation') {
								const toolState = (part as IChatToolInvocation).state.read(reader);
								if (toolState.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
									const params = toolState.parameters as Record<string, unknown> | undefined;
									const questions = params?.['questions'];
									let desc = '';
									if (Array.isArray(questions) && questions.length > 0) {
										desc = questions.map((q: Record<string, unknown>) => {
											const title = q['header'] || q['question'];
											if (!title) {
												return '';
											}
											const options = q['options'];
											if (Array.isArray(options) && options.length > 0) {
												const labels = options
													.map((o: Record<string, unknown>) => o['label'])
													.filter(Boolean);
												if (labels.length > 0) {
													return `${title}: ${labels.join(', ')}`;
												}
											}
											return title;
										}).filter(Boolean).join('; ');
									}
									toolConfirmations.push({
										type: 'input',
										sessionLabel: label,
										sessionResource: resource,
										description: desc || 'Needs your input',
										approve: () => {
											IChatToolInvocation.confirmWith(part as IChatToolInvocation, { type: ToolConfirmKind.UserAction });
										},
										deny: () => {
											IChatToolInvocation.confirmWith(part as IChatToolInvocation, { type: ToolConfirmKind.Denied });
										},
									});
									break;
								}
							}
						}
					}
				}
			}
			this._pendingToolConfirmations.set(toolConfirmations, undefined);
		}));

		this._register(CommandsRegistry.registerCommand('_chat.voicePlayback.replay', (_accessor, payload?: { sessionId?: string; transcript?: string }) => {
			const sessionId = payload?.sessionId;
			if (!sessionId) { return; }
			this._replaySessionAudio(sessionId);
		}));
		this._register(CommandsRegistry.registerCommand('_chat.voicePlayback.stop', (_accessor, payload?: { sessionId?: string }) => {
			this._stopReplay();
			if (payload?.sessionId) {
				this.voicePlaybackService.notifyPlaybackEnd(URI.parse(payload.sessionId));
			}
		}));

		this._register({ dispose: () => this.disconnect() });
	}

	setMuted(muted: boolean): void {
		this._isMuted.set(muted, undefined);
		this.micCaptureService.isMuted = muted;
	}

	async connect(window: Window & typeof globalThis): Promise<void> {
		if (this._isConnecting.get() || this._isConnected.get()) { return; }
		if (!isVoiceEntitled(this.chatEntitlementService)) {
			this.notificationService.warn(this.chatEntitlementService.entitlement === ChatEntitlement.Enterprise
				? localize('voiceMode.enterpriseUnavailable', "Voice Mode is not available for Dardcor Enterprise accounts.")
				: localize('voiceMode.requiresPaidPlan', "Voice Mode requires a paid Dardcor plan."));
			return;
		}
		const connectAttemptGeneration = ++this._connectAttemptGeneration;

		this.setActiveWindow(window);
		this._fatalDisconnect = false;
		this._suppressedConfirmationSessions.set(new Set(), undefined);
		this._isConnecting.set(true, undefined);
		this._statusText.set('Connecting...', undefined);
		this._voiceState.set('idle', undefined);
		this._telemetryConnectStartMs = Date.now();

		this._armConnectWatchdog();

		let authToken: string | undefined;
		try {
			const sessions = await this.authenticationService.getSessions('github');
			if (connectAttemptGeneration !== this._connectAttemptGeneration) {
				return;
			}
			this._userLogin = sessions[0]?.account.label;
			authToken = sessions[0]?.accessToken;
			if (!this._userLogin) {
				this.logService.warn('[voice] no GitHub session found; transcripts will not be persisted');
			} else {
				const lastTurn = (await this.voiceTranscriptStore.loadTurns(this._userLogin, { limit: 1 }))[0];
				if (connectAttemptGeneration !== this._connectAttemptGeneration) {
					return;
				}
				this._lastPersistedTurnId = lastTurn?.turnId;

				try {
					const recent = await this.voiceTranscriptStore.loadTurns(
						this._userLogin,
						{ limit: VoiceSessionController.PRIOR_TIMELINE_ENTRY_LIMIT }
					);
					if (connectAttemptGeneration !== this._connectAttemptGeneration) {
						return;
					}
					this._pendingPriorTimeline = this._buildPriorTimeline(recent);
				} catch (err) {
					this.logService.warn('[voice] failed to load prior timeline entries for context', err);
					this._pendingPriorTimeline = [];
				}
			}
		} catch (err) {
			this.logService.warn('[voice] failed to resolve GitHub session', err);
		}

		if (!this._isConnecting.get() || connectAttemptGeneration !== this._connectAttemptGeneration) {
			return;
		}

		this._voiceEventDisposables.clear();

		this._voiceEventDisposables.add(this.micCaptureService.onPttStart((passive) => {
			this.voiceClientService.sendPttStart(this._pttCurrentTurnId, { hasActiveSession: !!this._targetSession.get(), passive });
		}));
		this._voiceEventDisposables.add(this.micCaptureService.onPttAudioChunk(b64 => {
			this.voiceClientService.sendPttAudioChunk(b64);
		}));
		this._voiceEventDisposables.add(this.micCaptureService.onPttEnd(() => {
			this.voiceClientService.sendPttEnd();
		}));
		this._voiceEventDisposables.add(this.micCaptureService.onPttDiagnostic((diag: IPttDiagnostic) => {
			this.logService.trace(
				`[voice] ptt.diagnostic turn_id=${diag.turnId} ` +
				`msHeld=${diag.msHeld} chunksSent=${diag.chunksSent} samplesSent=${diag.samplesSent} ` +
				`drainFired=${diag.drainFired} drainChunks=${diag.drainChunks} drainSamples=${diag.drainSamples} drainWindowMs=${diag.drainWindowMs} ` +
				`drainSkippedByMute=${diag.drainSkippedByMute} drainSkippedBySuppression=${diag.drainSkippedBySuppression} ` +
				`postReleaseCallbacks=${diag.postReleaseCallbacks} postReleaseSamples=${diag.postReleaseSamples} ` +
				`postReleaseSkippedByMute=${diag.postReleaseSkippedByMute} postReleaseSkippedBySuppression=${diag.postReleaseSkippedBySuppression} ` +
				`postReleaseWindowMs=${diag.postReleaseWindowMs} ` +
				`releasedDuringAcquire=${diag.releasedDuringAcquire} pttUpWithoutCapture=${diag.pttUpWithoutCapture}`
			);
			this.voiceClientService.sendPttDiagnostic(diag.turnId, {
				ms_held: diag.msHeld,
				chunks_sent: diag.chunksSent,
				samples_sent: diag.samplesSent,
				drain_fired: diag.drainFired,
				drain_chunks: diag.drainChunks,
				drain_samples: diag.drainSamples,
				drain_window_ms: diag.drainWindowMs,
				drain_skipped_by_mute: diag.drainSkippedByMute,
				drain_skipped_by_suppression: diag.drainSkippedBySuppression,
				post_release_callbacks: diag.postReleaseCallbacks,
				post_release_samples: diag.postReleaseSamples,
				post_release_skipped_by_mute: diag.postReleaseSkippedByMute,
				post_release_skipped_by_suppression: diag.postReleaseSkippedBySuppression,
				post_release_window_ms: diag.postReleaseWindowMs,
				released_during_acquire: diag.releasedDuringAcquire,
				ptt_up_without_capture: diag.pttUpWithoutCapture,
			});
		}));

		this._voiceEventDisposables.add(this.ttsPlaybackService.onPlaybackStopped(() => {
			const wasInterrupted = this._telemetryTtsInterrupted;
			const listenedToEnd = !wasInterrupted;
			this.telemetryService.publicLog2<VoiceTtsListenThroughEvent, VoiceTtsListenThroughClassification>('voiceTtsListenThrough', {
				listenedToEnd,
				listenedPct: listenedToEnd ? 100 : 50,
			});
			this._telemetryTtsInterrupted = false;
			const finishedSessionId = this._currentPlaybackSessionId;
			const samples = this.ttsPlaybackService.getLastPlayedSamples();
			if (samples && finishedSessionId !== null) {
				const cacheKey = finishedSessionId ?? '__generic__';
				this._sessionAudioCache.set(cacheKey, samples);
			}

			this.voicePlaybackService.notifyPlaybackEnd(undefined);
			this._currentPlaybackSessionId = null;
			this._currentPlaybackFinalized = false;
			const finishedResponseId = this._currentPlaybackResponseId;
			this._currentPlaybackResponseId = undefined;
			const finishedNarration = this._currentPlaybackNarration;
			this._currentPlaybackNarration = undefined;
			const finishedTranscript = this._currentPlaybackTranscript;
			this._currentPlaybackTranscript = undefined;
			if (!wasInterrupted) {
				const spokenSessionId = finishedSessionId ?? this._shownSessionId();
				if (spokenSessionId) {
					const spokenSessionKey = this._sessionKey(spokenSessionId);
					this._lastSpokenAtBySession.set(spokenSessionKey, Date.now());
					if (finishedResponseId) {
						this._notifyCheckpointPlaybackComplete(spokenSessionId, finishedResponseId, finishedNarration);
					}
					if (finishedNarration?.kind === 'response' || finishedNarration === undefined) {
						if (finishedTranscript) {
							this._lastNarratedText.set(spokenSessionKey, finishedTranscript);
						}
						if (finishedNarration?.kind === 'response') {
							this._clearPendingResponse(spokenSessionKey);
							this._completeRoutedResponse(spokenSessionId);
						} else if (this._routedRequests.has(spokenSessionKey)) {
							this._resumeRoutedCompletionAfterPlayback(spokenSessionId);
						} else {
							this._clearPendingResponse(spokenSessionKey);
						}
					}
				}
				if (finishedResponseId) {
					this._markNarrationHeard(finishedResponseId);
					this._omniNarrationIds.delete(finishedResponseId);
				}
			} else if (finishedResponseId && wasInterrupted) {
				const pending = this._pendingSolicitedNarrations.get(finishedResponseId);
				if (pending) {
					this._deferInterruptedNarration(finishedResponseId, pending);
				}
			}

			if (this._audioQueue.length > 0) {
				setTimeout(() => this._processQueue(), 500);
			} else {
				if (this._pttHeld) {
					if (this._bargeInListenActive) {
						this._bargeInListenActive = false;
						this._pttToggleMode = true;
					}
					this._voiceState.set('listening', undefined);
					this._statusText.set('Listening...', undefined);
				} else {
					this._voiceState.set('idle', undefined);
					this._statusText.set('Hold to speak...', undefined);
					if (this._pttWaitingForPlayback) {
						this._scheduleDelayedMicStop();
					}
					if (this._isHandsFreeEnabled() && !this._awaitingReplyAudio && this._replyPlayedSinceSend) {
						this._scheduleAutoListen();
					}
				}
				queueMicrotask(() => this._drainOmniInbox());
			}
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onDidChangeConnectionState(async connected => {
			if (connected) {
				const sessionInitializationGeneration = ++this._sessionInitializationGeneration;
				this._armConnectWatchdog();
				const pbCtx = this.ttsPlaybackService.ensureContext(window);
				pbCtx.resume();

				const isResuming = this.voiceClientService.isResuming;

				const now = Date.now();
				const connectMs = this._telemetryConnectStartMs ? now - this._telemetryConnectStartMs : 0;
				if (this._telemetryFirstConnect) {
					this._telemetryFirstConnect = false;
					this.telemetryService.publicLog2<VoiceFirstConnectEvent, VoiceFirstConnectClassification>('voiceFirstConnect', { timeToConnectMs: connectMs });
				}
				if (isResuming) {
					this._telemetryReconnectCount++;
					const secSinceLast = this._telemetryLastConnectMs ? Math.round((now - this._telemetryLastConnectMs) / 1000) : 0;
					this.telemetryService.publicLog2<VoiceReconnectEvent, VoiceReconnectClassification>('voiceReconnect', { timeSinceLastConnectSec: secSinceLast });
				} else {
					this._telemetrySessionIndex++;
					this._telemetrySessionStart = now;
					this._telemetryTurnCount = 0;
					this._telemetryReconnectCount = 0;
					this.telemetryService.publicLog2<VoiceSessionStartedEvent, VoiceSessionStartedClassification>('voiceSessionStarted', { sessionIndex: this._telemetrySessionIndex });
				}
				this._telemetryLastConnectMs = now;
				const voiceInstructions = await this.promptsService.getVoiceInstructions(CancellationToken.None);
				if (
					connectAttemptGeneration !== this._connectAttemptGeneration ||
					sessionInitializationGeneration !== this._sessionInitializationGeneration ||
					!this.voiceClientService.isConnected ||
					(!this._isConnecting.get() && !this._isReconnecting.get())
				) {
					return;
				}
				if (isResuming) {
					this.micCaptureService.stopCapture();
				}
				this.micCaptureService.prepare(window);
				if (this._isHandsFreeEnabled()) {
					try {
						await this.micCaptureService.startCapture(window);
					} catch (err) {
						if (
							connectAttemptGeneration !== this._connectAttemptGeneration ||
							sessionInitializationGeneration !== this._sessionInitializationGeneration ||
							!this.voiceClientService.isConnected ||
							(!this._isConnecting.get() && !this._isReconnecting.get())
						) {
							return;
						}
						this.logService.warn('[voice] failed to warm microphone capture for hands-free mode; resetting voice mode', err);
						const permissionDenied = isMicrophonePermissionDeniedError(err);
						this._resetFailedConnection(!permissionDenied);
						return;
					}
					if (
						connectAttemptGeneration !== this._connectAttemptGeneration ||
						sessionInitializationGeneration !== this._sessionInitializationGeneration ||
						!this.voiceClientService.isConnected ||
						(!this._isConnecting.get() && !this._isReconnecting.get())
					) {
						return;
					}
				}

				if (isResuming) {
					this.voiceClientService.sendResumeSession(this._buildSessionContext(), this._getMachineId(), voiceInstructions);
				} else {
					const priorTimeline = this._pendingPriorTimeline;
					this._pendingPriorTimeline = [];
					this.voiceClientService.sendStartSession(this._buildSessionContext(), this._getMachineId(), priorTimeline, undefined, voiceInstructions);
				}

				transaction(tx => {
					this._isConnecting.set(false, tx);
					this._isReconnecting.set(false, tx);
					this._isConnected.set(true, tx);
				});
				this._connectWatchdog.clear();

				const seededResources = new Set<string>();
				for (const chatModel of this.chatService.chatModels.get()) {
					const key = chatModel.sessionResource.toString();
					if (seededResources.has(key)) { continue; }
					if (chatModel.getRequests().length === 0) { continue; }
					const info = this._getAgentStateInfo(chatModel);
					if (info.state !== 'unknown') {
						this._prevSessionStates.set(key, { state: info.state, detail: info.detail ?? '', pendingId: info.state === 'waiting_for_confirmation' ? this._pendingIdFor(key) : '', confirmationType: info.confirmation_type, lastResponseSummary: info.last_response_summary ?? '' });
					}
				}

				const sessionChangeListener = toDisposable(() => {});
				const autorunDisposable = autorun(reader => {
					const agentSessions: any[] = [];
					let needsRecheck = false;
					const stateChanges: { sessionId: string; currentState: string; label: string; detail?: string; confirmationType?: VoiceConfirmationType; lastResponseSummary?: string; fromState: string; fromDetail: string; fromConfirmationType?: VoiceConfirmationType; fromResponseSummary: string; pendingId: string; fromPendingId: string }[] = [];
					const waitingForConfirmationSessions: { sessionId: string; label: string; detail?: string; transition: boolean }[] = [];
					const processedResources = new Set<string>();

					const processModel = (model: IChatModel, resource: URI, label: string) => {
						const sessionId = resource.toString();
						const lastReq = model.lastRequestObs.read(reader);
						if (lastReq?.response) {
							lastReq.response.isIncomplete.read(reader);
							const pending = lastReq.response.isPendingConfirmation.read(reader);

							const confirmationType = getVoiceConfirmationType(lastReq.response.response.value);
							if (pending && confirmationType === 'tool' && this._autoApprovedSessions.has(sessionId)) {
								for (const part of lastReq.response.response.value) {
									if (part.kind === 'toolInvocation') {
										if (IChatToolInvocation.confirmWith(part as IChatToolInvocation, { type: ToolConfirmKind.UserAction })) {
											needsRecheck = true;
										}
									}
								}
							}

							const responseSignal = observableSignalFromEvent(lastReq.response, lastReq.response.onDidChange);
							responseSignal.read(reader);
						}

						const info = this._getAgentStateInfo(model);
						const currentState = this._effectiveResidentState(sessionId, info);
						if (currentState === info.state) {
							this._pendingIdleNarration.delete(sessionId);
						}
						const detail = info.detail;
						const confirmationType = info.confirmation_type;
						const lastResponseSummary = info.last_response_summary;
						this._cacheResponseSummary(sessionId, info.state, lastResponseSummary);

						const prev = this._prevSessionStates.get(sessionId);
						const normalizedSummary = lastResponseSummary ?? '';
						const isStateTransition = prev !== undefined && prev.state !== currentState && currentState !== 'unknown';
						const pendingId = currentState === 'waiting_for_confirmation' ? this._pendingIdFor(sessionId) : '';
						const isDetailTransition = !isStateTransition && prev !== undefined && currentState === 'waiting_for_confirmation'
							&& ((detail ?? '') !== prev.detail || pendingId !== prev.pendingId || confirmationType !== prev.confirmationType);
						const isResponseSummaryTransition = !isStateTransition && prev !== undefined && currentState === 'idle' && !!normalizedSummary && normalizedSummary !== prev.lastResponseSummary && this._sessionsAwaitingResponseSummary.has(sessionId);
						const isTransition = isStateTransition || isDetailTransition || isResponseSummaryTransition;
						if (isTransition) {
							this.logService.trace(`[voice] autorun transition id=${sessionId.slice(-32)} ${prev?.state}→${currentState} detailChanged=${isDetailTransition} summaryChanged=${isResponseSummaryTransition} hasDetail=${!!detail}`);
							if (currentState === 'thinking' && !this._eagerModelLoading.has(sessionId)) {
								this._clearLastNarratedText(sessionId);
								this._clearDeferred(this._sessionKey(sessionId));
								this._sessionsAwaitingResponseSummary.add(sessionId);
							}
							if (currentState === 'idle' && !!normalizedSummary) {
								this._sessionsAwaitingResponseSummary.delete(sessionId);
							}
							const cancelExpiry = this._userCancelledSessions.get(sessionId);
							if (cancelExpiry) {
								this.logService.trace(`[voice] autorun swallowing transition (user-cancelled) id=${sessionId.slice(-32)}`);
								clearTimeout(cancelExpiry);
								this._userCancelledSessions.delete(sessionId);
							} else {
								stateChanges.push({ sessionId, currentState, label, detail, confirmationType, lastResponseSummary, fromState: prev?.state ?? currentState, fromDetail: prev?.detail ?? '', fromConfirmationType: prev?.confirmationType, fromResponseSummary: prev?.lastResponseSummary ?? '', pendingId, fromPendingId: prev?.pendingId ?? '' });
							}
						}
						if (currentState !== 'unknown') {
							const rememberedSummary = normalizedSummary || this._lastResponseSummaryById.get(sessionId) || prev?.lastResponseSummary || '';
							this._prevSessionStates.set(sessionId, { state: currentState, detail: detail ?? '', pendingId, confirmationType, lastResponseSummary: rememberedSummary });
							if (currentState !== 'waiting_for_confirmation') {
								this._narratedPending.delete(this._sessionKey(sessionId));
								if (prev?.state === 'waiting_for_confirmation') {
									this._stopPendingNarration(sessionId);
								}
							} else if (isDetailTransition) {
								this._narratedPending.delete(this._sessionKey(sessionId));
								this._stopPendingNarration(sessionId);
							}
						}

						if (currentState === 'waiting_for_confirmation') {
							waitingForConfirmationSessions.push({ sessionId, label, detail, transition: isTransition });
						}
					};

					for (const s of agentSessions) {
						processedResources.add(s.resource.toString());
						const model = this.chatService.getSession(s.resource);
						if (model) {
							processModel(model, s.resource, s.label || 'Untitled session');
						} else {
							const sessionId = s.resource.toString();
							const currentState = s.status === false ? 'thinking'
								: s.status === false ? 'waiting_for_confirmation'
									: s.status === false ? 'idle'
										: 'unknown';
							this._cacheResponseSummary(sessionId, currentState, undefined);
							if (s.status === false) {
								this._ensureModelLoaded(s.resource);
							}

							const prev = this._prevSessionStates.get(sessionId);
							const isStateTransition = prev !== undefined && prev.state !== currentState && currentState !== 'unknown';

							if (isStateTransition && currentState === 'thinking') {
								this._sessionsAwaitingResponseSummary.add(sessionId);
							}

							if (prev?.state === 'waiting_for_confirmation' && currentState !== 'waiting_for_confirmation' && currentState !== 'unknown') {
								this._narratedPending.delete(this._sessionKey(sessionId));
								this._stopPendingNarration(sessionId);
							}

							if (isStateTransition && currentState === 'idle') {
								const cachedSummary = this._lastResponseSummaryById.get(sessionId);
								if (!cachedSummary) {
									this._deferIdleNarrationUntilModelLoaded(s.resource);
									continue;
								}
								this._sessionsAwaitingResponseSummary.delete(sessionId);
								if (!this._userCancelledSessions.has(sessionId)) {
									stateChanges.push({ sessionId, currentState, label: s.label || 'Untitled session', lastResponseSummary: cachedSummary, fromState: prev?.state ?? currentState, fromDetail: prev?.detail ?? '', fromConfirmationType: prev?.confirmationType, fromResponseSummary: prev?.lastResponseSummary ?? '', pendingId: '', fromPendingId: prev?.pendingId ?? '' });
								}
								this._prevSessionStates.set(sessionId, { state: currentState, detail: '', pendingId: '', lastResponseSummary: cachedSummary ?? '' });
								continue;
							}

							if (isStateTransition) {
								const cancelExpiry = this._userCancelledSessions.get(sessionId);
								if (cancelExpiry) {
									clearTimeout(cancelExpiry);
									this._userCancelledSessions.delete(sessionId);
								} else {
									stateChanges.push({ sessionId, currentState, label: s.label || 'Untitled session', fromState: prev?.state ?? currentState, fromDetail: prev?.detail ?? '', fromConfirmationType: prev?.confirmationType, fromResponseSummary: prev?.lastResponseSummary ?? '', pendingId: '', fromPendingId: prev?.pendingId ?? '' });
								}
							}
							if (currentState !== 'unknown') {
								const rememberedSummary = this._lastResponseSummaryById.get(sessionId) || prev?.lastResponseSummary || '';
								this._prevSessionStates.set(sessionId, { state: currentState, detail: '', pendingId: '', lastResponseSummary: rememberedSummary });
								if (currentState !== 'waiting_for_confirmation') {
									this._narratedPending.delete(this._sessionKey(sessionId));
								}
							}
							if (currentState === 'waiting_for_confirmation') {
								waitingForConfirmationSessions.push({ sessionId, label: s.label || 'Untitled session', detail: undefined, transition: isStateTransition });
							}
						}
					}

					for (const chatModel of this.chatService.chatModels.read(reader)) {
						const key = chatModel.sessionResource.toString();
						if (processedResources.has(key)) { continue; }
						if (chatModel.getRequests().length === 0) { continue; }
						processedResources.add(key);
						processModel(chatModel, chatModel.sessionResource, chatModel.title || 'Chat');
					}

					if (needsRecheck) {
						setTimeout(() => this._autoApproveCheck(), 500);
					}
					this._pruneSessionCaches(processedResources);
					if (stateChanges.length > 0) {
						for (const change of stateChanges) {
							const existing = this._pendingStateChanges.get(change.sessionId);
							this._pendingStateChanges.set(change.sessionId, existing
								? { ...change, fromState: existing.fromState, fromDetail: existing.fromDetail, fromConfirmationType: existing.fromConfirmationType, fromResponseSummary: existing.fromResponseSummary, fromPendingId: existing.fromPendingId }
								: change);
						}
						this._scheduleStateChangeEmit();
					} else {
						this._sendContext();
					}

					for (const w of waitingForConfirmationSessions) {
						this._armConfirmationFlushWatchdog(w.sessionId, w.label, w.transition);
					}
					const stillWaiting = new Set(waitingForConfirmationSessions.map(w => w.sessionId));
					this._reconcileConfirmationIndicators(stillWaiting);
					for (const id of [...this._confirmationFlushWatchdogs.keys()]) {
						if (!stillWaiting.has(id)) {
							const t = this._confirmationFlushWatchdogs.get(id);
							if (t) { clearTimeout(t); }
							this._confirmationFlushWatchdogs.delete(id);
						}
					}
					for (const id of [...this._eagerModelRefs.keys()]) {
						if (!stillWaiting.has(id)) {
							this._eagerModelRefs.get(id)!.dispose();
							this._eagerModelRefs.delete(id);
						}
					}
				});
				const connectionDisposables = new DisposableStore();
				connectionDisposables.add(sessionChangeListener);
				connectionDisposables.add(autorunDisposable);
				connectionDisposables.add(disposableWindowInterval(this._window!, () => this._checkSessionStateChanges(), 5000));
				this._voiceAutorunDisposable.value = connectionDisposables;

				this.micCaptureService.isMuted = false;
				this._statusText.set('Hold to speak...', undefined);
				this._voiceState.set('idle', undefined);

				this._enterListenOnSessionInit = this._shouldEnterListenOnSessionInit(isResuming);
				this.logService.trace(`[voice] connected: isResuming=${isResuming} handsFree=${this._isHandsFreeEnabled()} armListen=${this._enterListenOnSessionInit}`);
				if (this._enterListenOnSessionInit) {
					this._voiceEventDisposables.add(disposableTimeout(() => {
						if (this._enterListenOnSessionInit && this._isConnected.get()) {
							this.logService.trace('[voice] session_init not seen within 750ms; entering listening via fallback');
							this._enterListenOnSessionInit = false;
							this._enterAutoListen('connect');
						}
					}, 750));
				}
			} else {
				this._sessionInitializationGeneration++;
				if (this._fatalDisconnect) {
				} else if (!this.voiceClientService.willReconnect) {
					this.disconnect();
				} else if (this._isConnected.get()) {
					this._onConnectionLost();
				} else {
					this.micCaptureService.stopCapture();
					transaction(tx => {
						this._isConnecting.set(false, tx);
						this._isReconnecting.set(true, tx);
					});
					this._voiceState.set('idle', undefined);
					this._statusText.set('Reconnecting...', undefined);
				}
			}
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onSessionInit(() => {
			this.logService.trace(`[voice] session_init received; armListen=${this._enterListenOnSessionInit} pendingRetries=${this._pendingNarrationRetries.size} deferredNarrations=${this._deferredNarrations.size}`);
			let narrated = false;
			if (this._pendingNarrationRetries.size > 0) {
				const retries = [...this._pendingNarrationRetries.entries()];
				this._pendingNarrationRetries.clear();
				for (const [sessionId, item] of retries) {
					narrated = this._retryPendingNarration(sessionId, item) || narrated;
				}
			}
			if (this._deferredNarrations.size > 0) {
				const deferredKeys = [...this._deferredNarrations.keys()];
				for (const sessionKey of deferredKeys) {
					narrated = this._retryDeferredNarration(sessionKey) || narrated;
				}
			}
			if (this._enterListenOnSessionInit && !narrated) {
				this._enterListenOnSessionInit = false;
				this._enterAutoListen('connect');
			} else if (narrated) {
				this._enterListenOnSessionInit = false;
			}
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onBargeIn(e => this._handleBargeIn(e)));

		this._voiceEventDisposables.add(this.voiceClientService.onNarrationAck(e => {
			this._handleNarrationAck(e);
		}));
		this._voiceEventDisposables.add(this.voiceClientService.onNarrationUnblocked(e => {
			this._retryDeferredNarration(this._sessionKey(e.codingSessionId), e.narrationId || undefined);
		}));
		this._voiceEventDisposables.add(this.voiceClientService.onNarrationInterrupted(e => {
			this._handleNarrationInterrupted(e);
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onSpeechStarted(event => {
			this._speechDetectedInTurn = true;
			this._clearAutoListenTimer();
			this._interruptAssistantPlayback();
			const turnId = event.turnId || this._pttCurrentTurnId;
			if (turnId && this._transcriptionTurnState?.turnId !== turnId) {
				this._beginTranscriptionTurn(turnId);
			}
			this._startUserTurn();
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onTurnAutoEnded(e => this._handleTurnAutoEnded(e)));

		this._voiceEventDisposables.add(this.voiceClientService.onTranscription(e => this._handleTranscription(e)));

		this._voiceEventDisposables.add(this.voiceClientService.onAudioResponse(e => {
			if (this._isInterruptedAudio(e)) {
				return;
			}
			const solicitedNarration = e.responseId ? this._pendingSolicitedNarrations.get(e.responseId) : undefined;
			const echoedCheckpoint: IVoiceCheckpointNarrationMetadata | undefined = e.requestId && e.checkpointId && e.sequence !== undefined
				? { requestId: e.requestId, checkpointId: e.checkpointId, sequence: e.sequence }
				: undefined;
			const narrationKind = e.narrationKind ?? solicitedNarration?.kind;
			const playbackNarration: IPlaybackNarration | undefined = narrationKind
				? {
					kind: narrationKind,
					checkpoint: echoedCheckpoint ?? solicitedNarration?.checkpoint,
					playbackId: e.playbackId,
				}
				: undefined;
			const isCheckpointNarration = playbackNarration?.kind === 'checkpoint';
			if (isCheckpointNarration && e.isFinal) {
				this.logService.trace(`[voice][checkpoint] received narration_id=${e.responseId} request_id=${playbackNarration.checkpoint?.requestId ?? '<unknown>'} phase=${playbackNarration.checkpoint?.checkpointId ?? '<unknown>'} sequence=${playbackNarration.checkpoint?.sequence ?? 0} playback_id=${playbackNarration.playbackId ?? '<none>'} spoken=${JSON.stringify(e.transcript ?? '')}`);
			}
			if (e.isFirstChunk && this._telemetryPttUpMs) {
				const ttft = this._telemetryFirstTranscriptionMs && this._telemetryPttDownMs
					? this._telemetryFirstTranscriptionMs - this._telemetryPttDownMs : 0;
				const e2e = Date.now() - this._telemetryPttUpMs;
				this.telemetryService.publicLog2<VoiceLatencyEvent, VoiceLatencyClassification>('voiceLatency', {
					timeToFirstTranscriptionMs: ttft,
					endToEndTurnMs: e2e,
				});
				this._telemetryPttUpMs = undefined;
			}
			const codingSessionId = this._canonicalSessionId(e.codingSessionId ?? solicitedNarration?.sessionId ?? (e.responseId ? this._responseSessionIds.get(e.responseId) : undefined));
			if (e.responseId && codingSessionId) {
				this._responseSessionIds.set(e.responseId, codingSessionId);
			}
			if (e.responseId && this._isOmniVoiceInboxActive()) {
				this._omniNarrationIds.add(e.responseId);
			}
			if (codingSessionId && !isCheckpointNarration && this._isOmniVoiceInboxActive()) {
				this._omniClaimedResponseSummaries.set(this._sessionKey(codingSessionId), e.transcript ?? '');
			}
			const routedRequest = codingSessionId ? this._routedRequests.get(this._sessionKey(codingSessionId)) : undefined;
			if (codingSessionId && this._abandonedRoutedRequests.has(this._sessionKey(codingSessionId))) {
				if (e.responseId) {
					this._rememberInterruptedAudioId(e.responseId);
					this._responseSessionIds.delete(e.responseId);
					this._responseRoutes.delete(e.responseId);
				}
				this.logService.trace(`[voice] dropping audio for closed omni route session=${codingSessionId.slice(-32)}`);
				return;
			}
			if (codingSessionId && routedRequest && routedRequest.phase !== 'running' && !solicitedNarration) {
				if (e.responseId && !e.isFinal) {
					this._ownershipDroppedResponseIds.add(e.responseId);
				}
				if (e.responseId && e.isFinal) {
					this._ownershipDroppedResponseIds.delete(e.responseId);
					this._responseSessionIds.delete(e.responseId);
					this._responseRoutes.delete(e.responseId);
				}
				this.logService.trace(`[voice] dropping stale response while routed request is ${routedRequest.phase} session=${codingSessionId.slice(-32)}`);
				return;
			}
			if (e.responseId && this._ownershipDroppedResponseIds.has(e.responseId)) {
				if (e.isFinal) {
					this._ownershipDroppedResponseIds.delete(e.responseId);
					this._responseSessionIds.delete(e.responseId);
					this._responseRoutes.delete(e.responseId);
				}
				return;
			}
			if (e.responseId !== undefined && this._cancelledPendingNarrationIds.has(e.responseId)) {
				if (e.isFinal) {
					this._cancelledPendingNarrationIds.delete(e.responseId);
				}
				return;
			}
			if (e.audio) {
				this._markSolicitedNarrationAudioStarted(e.responseId);
			}
			if (isCheckpointNarration && solicitedNarration && e.isFinal && !e.audio && !solicitedNarration.hasReceivedAudio) {
				if (e.responseId) {
					this._clearPendingSolicitedNarration(e.responseId, solicitedNarration);
					this._solicitedNarrationIds.delete(e.responseId);
					this._responseRoutes.delete(e.responseId);
				}
				return;
			}
			const isRenarration = this._isRenarration(e.responseId, codingSessionId, e.transcript, e.isFirstChunk, e.isFinal);
			const targetSessionId = this._targetSession.get()?.toString();
			const belongsToVoiceSession = this._isOmniVoiceInboxActive()
				|| !codingSessionId
				|| (!this._hasDraftTarget.get() && (!targetSessionId || this._isSameSession(codingSessionId, targetSessionId)));
			if (!belongsToVoiceSession) {
				if (e.responseId && !e.isFinal) {
					this._ownershipDroppedResponseIds.add(e.responseId);
				}
				if (e.responseId) {
					const pending = this._pendingSolicitedNarrations.get(e.responseId);
					if (pending) {
						if (pending.kind === 'response') {
							const key = this._sessionKey(pending.sessionId);
							this._pendingResponseSummaries.set(key, pending.text);
							this._markPendingResponse(key, true);
						}
						this._deferInterruptedNarration(e.responseId, pending);
					}
				}
				if (e.responseId && e.isFinal) {
					this._responseSessionIds.delete(e.responseId);
					this._responseRoutes.delete(e.responseId);
				}
				this.logService.trace(`[voice] dropping audio for non-target session=${codingSessionId} target=${targetSessionId}`);
				return;
			}
			const deferForOmniInbox = !isRenarration && !!codingSessionId && this._isOmniVoiceInboxActive()
				&& (this._isUserActivelySpeaking()
					|| this._omniNarrationQueue.length > 0
					|| this._omniDeferredSessionKeys.size > 0
					|| [...this._pendingSolicitedNarrations.values()].some(pending => pending.kind !== 'checkpoint' && !pending.hasReceivedAudio)
					|| this._deferredNarrations.size > 0);
			if (deferForOmniInbox && e.responseId) {
				this._responseRoutes.set(e.responseId, 'deferred');
			}
			const defer = isRenarration ? false : deferForOmniInbox || this._shouldDeferResponseStream(e.responseId, codingSessionId, e.isFirstChunk);
			if (e.isFirstChunk || e.isFinal) {
				this.logService.trace(`[voice] audio_response codingSessionId=${codingSessionId ?? '<none>'} responseId=${e.responseId?.slice(0, 8) ?? '<none>'} shown=${this._shownSessionId() ?? '<none>'} focused=${this._getFocusedSessionId() ?? '<none>'} external=${this._activeSessionShown ?? '<none>'} awaiting=${this._awaitingReplyForSession ?? '<none>'} isFirstChunk=${e.isFirstChunk} isFinal=${e.isFinal} suppress=${this._suppressIncomingAudio} renarration=${isRenarration} defer=${defer}`);
			}
			if (isRenarration) {
				this.logService.trace(`[voice] dropping re-narration for session=${codingSessionId} responseId=${e.responseId?.slice(0, 8) ?? '<none>'} isFirstChunk=${e.isFirstChunk} isFinal=${e.isFinal}`);
			} else if (defer && isCheckpointNarration) {
				if (e.responseId && solicitedNarration) {
					this._clearPendingSolicitedNarration(e.responseId, solicitedNarration);
					this._solicitedNarrationIds.delete(e.responseId);
				}
				return;
			} else if (defer) {
				if (deferForOmniInbox) {
					const sessionKey = this._sessionKey(codingSessionId!);
					this._omniDeferredSessionKeys.add(sessionKey);
					if (!this._omniDeferredSessionOrdinals.has(sessionKey)) {
						this._omniDeferredSessionOrdinals.set(sessionKey, ++this._omniInboxOrdinal);
					}
				}
				this._deferResponse(codingSessionId!, e.audio, e.isFirstChunk, e.isFinal, e.transcript, e.responseId, e.turnId);
			} else {
				if (e.audio && !isCheckpointNarration) {
					this._preemptCheckpointPlayback();
				}
				if (e.isFirstChunk && codingSessionId && this._deferredResponses.has(codingSessionId)
					&& !this._deferredBufferHasResponse(codingSessionId, e.responseId)) {
					this._flushDeferredResponse(codingSessionId);
				}
				this._enqueueAudio(codingSessionId, e.audio, e.isFirstChunk, e.isFinal, e.transcript, e.responseId, playbackNarration);
				if (e.isFinal) {
					this._liveReplyKeys.delete(codingSessionId ?? '');
					const heardSessionId = codingSessionId ?? this._awaitingReplyForSession ?? this._shownSessionId();
					if (!isCheckpointNarration && heardSessionId && e.transcript) {
						const heard = this._normalizeTranscript(e.transcript);
						if (heard) {
							const heardKey = this._sessionKey(heardSessionId);
							this._lastHeardTranscriptById.set(heardKey, heard);
							this._recentlyReadResponse.set(heardKey, { transcript: heard, at: Date.now() });
						}
					}
				}
			}
			if (!isCheckpointNarration && e.isFinal && e.transcript) {
				this._persistTurn('assistant', e.transcript);
			}
			if (e.isFinal && e.responseId) {
				this._responseSessionIds.delete(e.responseId);
				this._responseRoutes.delete(e.responseId);
			}
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onToolCall(e => {
			this.logService.trace(`[voice] tool_call received name=${e.name} coding_session_id=${typeof e.args?.['coding_session_id'] === 'string' ? String(e.args['coding_session_id']).slice(-32) : '<none>'} activeId=${this._getActiveSessionId()?.slice(-32) ?? '<none>'}`);
			const allowedTools = [
				'send_to_chat',
				'get_session_info', 'get_session_changes', 'get_session_thread',
				'respond_to_session',
				'auto_approve_session', 'revoke_auto_approve',
				'focus_session',
			];
			if (e.name === 'send_to_chat') {
				if (Date.now() < this._suppressSendToChatUntil) {
					this.logService.trace('[voice] dropping send_to_chat: turn discarded on focus change');
					this.voiceClientService.sendToolResult(e.callId, 'ok');
					return;
				}
				const rawText = typeof e.args?.['text'] === 'string' ? (e.args['text'] as string) : '';
				const text = this._stripStopPhrase(rawText);
				if (text !== rawText && e.args) {
					e.args['text'] = text;
				}
				this._statusText.set(VoiceToolDispatchService.getActionLabel(e.name), undefined);
				this._persistEntry('agent_tool_call', this._renderToolCallSummary(e.name, e.args), {
					toolName: e.name,
					toolArgs: e.args,
				});
				this._setAwaitingReply();
				const sendPromise = text.trim()
					? this._sendTranscriptionToChat(text)
					: Promise.resolve();
				sendPromise.finally(() => {
					this.voiceClientService.sendToolResult(e.callId, 'ok');
					this._voiceState.set(this._awaitingReplyAudio ? 'processing' : 'idle', undefined);
					this._statusText.set(this._awaitingReplyAudio ? 'Waiting for response...' : 'Hold to speak...', undefined);
					this._sendContext();
				});
				return;
			}
			if (allowedTools.includes(e.name)) {
				const passiveTools = ['get_session_info', 'get_session_changes', 'get_session_thread'];
				if (passiveTools.includes(e.name)) {
					this.voiceToolDispatchService.dispatchToolCall(e).then(result => {
						this.voiceClientService.sendToolResult(e.callId, result);
					}, err => {
						this.logService.error(`[voice] passive tool ${e.name} dispatch failed`, err);
						this.voiceClientService.sendToolResult(e.callId, 'error');
					});
					return;
				}
				this._statusText.set(VoiceToolDispatchService.getActionLabel(e.name), undefined);
				this._persistEntry('agent_tool_call', this._renderToolCallSummary(e.name, e.args), {
					toolName: e.name,
					toolArgs: e.args,
				});
				if (this._pttHeld) {
					this._finishPtt();
				}
				this._suppressIncomingAudio = false;
				this._setAwaitingReply();
				const settle = (): void => {
					this._voiceState.set('idle', undefined);
					this._statusText.set('Hold to speak...', undefined);
					this._sendContext();
				};
				if (e.name === 'respond_to_session') {
					const response = e.args?.['response'];
					const responseType = response && typeof response === 'object' && !Array.isArray(response)
						? (response as Record<string, unknown>)['type']
						: undefined;
					this.voiceToolDispatchService.respondToSession(e).then(result => {
						this.logService.trace(`[voice] respond_to_session type=${String(responseType)} ok=${result.ok} reason=${result.reason ?? '<none>'} coding_session_id=${typeof e.args?.['coding_session_id'] === 'string' ? String(e.args['coding_session_id']).slice(-32) : '<none>'}`);
						if (responseType === 'approve' || responseType === 'reject') {
							this.telemetryService.publicLog2<VoiceToolApprovalEvent, VoiceToolApprovalClassification>('voiceToolApproval', {
								toolName: e.name,
								approved: responseType === 'approve',
							});
						}
						this.voiceClientService.sendToolResult(e.callId, result);
						settle();
					}, err => {
						this.logService.error(`[voice] respond_to_session dispatch failed`, err);
						this.voiceClientService.sendToolResult(e.callId, { ok: false, reason: 'unsupported' });
						settle();
					});
					return;
				}
				this.voiceToolDispatchService.dispatchToolCall(e).then(result => {
					this.voiceClientService.sendToolResult(e.callId, result);
					settle();
				}, err => {
					this.logService.error(`[voice] tool ${e.name} dispatch failed`, err);
					this.voiceClientService.sendToolResult(e.callId, 'error');
					settle();
				});
			} else {
				this.voiceClientService.sendToolResult(e.callId, 'ok');
			}
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onError(detail => {
			if (!this._isConnecting.get()) {
				this._voiceState.set('error', undefined);
				this._statusText.set(`Error: ${detail}`, undefined);
			}
		}));

		this._voiceEventDisposables.add(this.voiceClientService.onFatalDisconnect(e => {
			this._handleFatalDisconnect(e.code, e.reason);
		}));

		await this.voiceClientService.connect(window, authToken);
		if (!this._isConnecting.get() || connectAttemptGeneration !== this._connectAttemptGeneration) {
			return;
		}

		this._armConnectWatchdog();
	}

	setActiveWindow(window: Window & typeof globalThis): void {
		this._window = window;
		this._windowFocusDisposables.clear();
		this._windowFocusDisposables.add(addDisposableListener(window, 'blur', () => this._onWindowBlur()));
		this._windowFocusDisposables.add(addDisposableListener(window, 'focus', () => this._onWindowFocus()));
		this._onFocusedSessionChanged();
	}

	private _armConnectWatchdog(): void {
		this._connectWatchdog.value = disposableTimeout(() => {
			if ((!this._isConnecting.get() && !this._isReconnecting.get()) || this._isConnected.get()) {
				return;
			}
			this.logService.warn('[voice] connect handshake timed out; resetting voice mode');
			this._resetFailedConnection();
		}, VoiceSessionController._CONNECT_TIMEOUT_MS);
	}

	private _resetFailedConnection(notifyUser = true): void {
		this.disconnect();
		if (notifyUser) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('voice.connectFailed', "Voice mode could not connect. Please try again."),
			});
		}
	}

	private _suppressPendingConfirmationsUntilConnect(): void {
		const suppressed = new Set(this._suppressedConfirmationSessions.get());
		for (const tc of this._pendingToolConfirmations.get()) {
			suppressed.add(tc.sessionResource.toString());
		}
		this._suppressedConfirmationSessions.set(suppressed, undefined);
	}

	disconnect(source: 'explicit' | 'internal' = 'internal'): void {
		this._connectAttemptGeneration++;
		const shouldPlayStoppedSignal = source === 'explicit' && (this._isConnecting.get() || this._isConnected.get() || this._isReconnecting.get());
		const shouldPlayRecordingStoppedSignal = source === 'explicit' && this._pttHeld;

		if (this._telemetrySessionStart) {
			const durationSec = Math.round((Date.now() - this._telemetrySessionStart) / 1000);
			this.telemetryService.publicLog2<VoiceSessionEndedEvent, VoiceSessionEndedClassification>('voiceSessionEnded', {
				turnCount: this._telemetryTurnCount,
				durationSec,
				reconnectCount: this._telemetryReconnectCount,
			});
			this._telemetrySessionStart = undefined;
		}

		this._isConnecting.set(false, undefined);
		this._isReconnecting.set(false, undefined);
		this._connectWatchdog.clear();
		this._voiceAutorunDisposable.clear();
		this._voiceEventDisposables.clear();
		this._windowFocusDisposables.clear();
		this.ttsPlaybackService.closeContext();
		this.micCaptureService.stopCapture();
		this.voiceClientService.disconnect();
		this._pttHeld = false;
		this._speechDetectedInTurn = false;
		this._pttToggleMode = false;
		this._pttCurrentTurnId = '';
		this._resetTranscriptionTurn();
		this._bargeInListenActive = false;
		this._isConnected.set(false, undefined);
		this._voiceState.set('idle', undefined);
		this._statusText.set('Tap to start', undefined);
		this._transcriptTurns.set([], undefined);
		this._clearAutoListenTimer();
		this._clearAwaitingReply();
		this._autoListenSuppressed = false;
		this._enterListenOnSessionInit = false;
		this._replyPlayedSinceSend = false;
		this._audioQueue.length = 0;
		this._currentPlaybackSessionId = null;
		this._currentPlaybackResponseId = undefined;
		this._currentPlaybackNarration = undefined;
		this._currentPlaybackTranscript = undefined;
		this._lastSpokenResponseSessionId = undefined;
		this._isProcessingQueue = false;
		this._suppressIncomingAudio = false;
		this._interruptedAudioIds.clear();
		this._clearDeferredResponses();
		this._uiResourceByBackendId.clear();
		this._liveReplyKeys.clear();
		this._lastShownSessionId = undefined;
		this._targetOmniRoute = undefined;
		this._targetSession.set(undefined, undefined);
		this._hasDraftTarget.set(false, undefined);
		this._omniInputActive.set(false, undefined);
		this._suppressPendingConfirmationsUntilConnect();
		this._pendingToolConfirmations.set([], undefined);
		this._activeSessionShown = undefined;
		this._externalActiveSessionMode = false;
		this._recentlyReadResponse.clear();
		this._droppingRenarration.clear();
		this._solicitedNarrationIds.clear();
		this._cancelledPendingNarrationIds.clear();
		this._awaitingReplyForSession = undefined;
		this._prevSessionStates.clear();
		for (const t of this._userCancelledSessions.values()) { clearTimeout(t); }
		this._userCancelledSessions.clear();
		for (const t of this._confirmationFlushWatchdogs.values()) { clearTimeout(t); }
		this._confirmationFlushWatchdogs.clear();
		if (this._stateChangeEmitTimer) { clearTimeout(this._stateChangeEmitTimer); this._stateChangeEmitTimer = undefined; }
		this._pendingStateChanges.clear();
		for (const ref of this._eagerModelRefs.values()) { ref.dispose(); }
		this._eagerModelRefs.clear();
		this._eagerModelLoading.clear();
		this._pendingIdleNarration.clear();
		this._sessionsAwaitingResponseSummary.clear();
		this._lastResponseSummaryById.clear();
		this._routedRequests.clear();
		this._abandonedRoutedRequests.clear();
		this._omniNarrationQueue.length = 0;
		this._omniDeferredSessionKeys.clear();
		this._omniDeferredSessionOrdinals.clear();
		this._omniInboxOrdinal = 0;
		this._omniClaimedPendingIds.clear();
		this._omniClaimedResponseSummaries.clear();
		this._omniNarrationIds.clear();
		this._lastNarratedText.clear();
		this._pendingNarrationRetries.clear();
		this._voiceProgressListeners.clearAndDisposeAll();
		this._voiceProgressSessionByResponse.clear();
		this._lastSpokenAtBySession.clear();
		for (const [narrationId, pending] of this._pendingSolicitedNarrations) {
			this._clearPendingSolicitedNarration(narrationId, pending);
		}
		this._pendingSolicitedNarrations.clear();
		this._deferredNarrations.clear();
		this._narratedPending.clear();
		this._userLogin = undefined;
		this._lastPersistedTurnId = undefined;
		this._pendingPriorTimeline = [];
		this._stopReplay();
		this._sessionAudioCache.clear();
		if (shouldPlayRecordingStoppedSignal) {
			this._playRecordingStoppedSignal(true);
		}
		if (shouldPlayStoppedSignal) {
			void this.accessibilitySignalService.playSignal(AccessibilitySignal.voiceModeStopped, {
				source: 'voiceMode.disconnect',
				userGesture: true,
			});
		}
	}

	simulateConnection(): void {
		this._isConnected.set(true, undefined);
		this._isConnecting.set(false, undefined);
		this._voiceState.set('idle', undefined);
		this._statusText.set('Hold to speak...', undefined);

		this._voiceEventDisposables.add(disposableTimeout(() => {
			if (!this._isConnected.get()) { return; }
			this._voiceState.set('listening', undefined);
			this._transcriptTurns.set([{ speaker: 'user', text: 'Create a', committed: '', isPartial: true }], undefined);
		}, 1000));

		this._voiceEventDisposables.add(disposableTimeout(() => {
			if (!this._isConnected.get()) { return; }
			this._transcriptTurns.set([{ speaker: 'user', text: 'Create a new React component', committed: 'Create a ', isPartial: true }], undefined);
		}, 2000));

		this._voiceEventDisposables.add(disposableTimeout(() => {
			if (!this._isConnected.get()) { return; }
			this._transcriptTurns.set([{ speaker: 'user', text: 'Create a new React component for the dashboard', committed: 'Create a new React component for the dashboard', isPartial: false }], undefined);
			this._voiceState.set('idle', undefined);
		}, 3000));

		this._voiceEventDisposables.add(disposableTimeout(() => {
			if (!this._isConnected.get()) { return; }
			this._transcriptTurns.set([
				{ speaker: 'user', text: 'Create a new React component for the dashboard', committed: 'Create a new React component for the dashboard', isPartial: false },
				{ speaker: 'assistant', text: 'I\'ll create a Dashboard component with some widgets...', committed: '', isPartial: false },
			], undefined);
		}, 4500));
	}

	private _handleFatalDisconnect(code: number, reason: string): void {
		this.logService.warn(`[voice] fatal disconnect code=${code} reason=${reason}; tearing down (no reconnect)`);
		this._fatalDisconnect = true;
		this._audioQueue.length = 0;
		this._currentPlaybackSessionId = null;
		this._currentPlaybackResponseId = undefined;
		this._currentPlaybackNarration = undefined;
		this._isProcessingQueue = false;
		this.ttsPlaybackService.closeContext();
		this.micCaptureService.stopCapture();
		this._windowFocusDisposables.clear();
		this._pttHeld = false;
		this._pttToggleMode = false;
		for (const [narrationId, pending] of this._pendingSolicitedNarrations) {
			this._clearPendingSolicitedNarration(narrationId, pending);
		}
		this._pendingSolicitedNarrations.clear();
		this._solicitedNarrationIds.clear();
		this._cancelledPendingNarrationIds.clear();
		this._pendingNarrationRetries.clear();
		this._voiceProgressListeners.clearAndDisposeAll();
		this._voiceProgressSessionByResponse.clear();
		this._lastSpokenAtBySession.clear();
		this._deferredNarrations.clear();
		this._narratedPending.clear();
		this._targetOmniRoute = undefined;
		this._targetSession.set(undefined, undefined);
		this._hasDraftTarget.set(false, undefined);
		this._omniInputActive.set(false, undefined);
		this._suppressPendingConfirmationsUntilConnect();
		this._pendingToolConfirmations.set([], undefined);
		transaction(tx => {
			this._isConnecting.set(false, tx);
			this._isReconnecting.set(false, tx);
			this._isConnected.set(false, tx);
		});
		this._voiceState.set('error', undefined);
		const message = code === 4008
			? localize('voice.movedToAnotherWindow', "Voice moved to another window. Tap to start.")
			: (reason || localize('voice.fatalDisconnect', "Voice disconnected. Tap to start."));
		this._statusText.set(message, undefined);
		ariaAlert(message);
	}

	private _onConnectionLost(): void {
		this.logService.warn('[voice] connection lost, preserving state for reconnect');
		this.ttsPlaybackService.closeContext();
		this._pttHeld = false;
		this._pttToggleMode = false;
		this._pttCurrentTurnId = '';
		this._resetTranscriptionTurn();
		this._isConnected.set(false, undefined);
		this._isReconnecting.set(true, undefined);
		this._voiceState.set('idle', undefined);
		this._statusText.set('Reconnecting...', undefined);
	}

	private _beginTranscriptionTurn(turnId: string): void {
		this._transcriptionTurnState = {
			turnId,
			highestRevision: undefined,
			phase: 'active',
		};
	}

	private _markTranscriptionTurnPending(): void {
		if (this._transcriptionTurnState?.turnId === this._pttCurrentTurnId && this._transcriptionTurnState.phase === 'active') {
			this._transcriptionTurnState.phase = 'pending';
		}
	}

	private _resetTranscriptionTurn(): void {
		this._transcriptionTurnState = undefined;
	}

	private _handleTurnAutoEnded(event: IVoiceTurnAutoEnded): void {
		if (!this._pttHeld) {
			return;
		}
		if (event.turnId && event.turnId !== this._pttCurrentTurnId) {
			return;
		}
		this._pttToggleMode = false;
		this._finishPtt('auto');
	}

	private _handleBargeIn(event: IVoiceBargeIn): void {
		this._speechDetectedInTurn = true;
		if (event.turnId) {
			if (this._transcriptionTurnState?.turnId !== event.turnId) {
				this._beginTranscriptionTurn(event.turnId);
			}
		} else {
			this._resetTranscriptionTurn();
		}
		this._startUserTurn();
		this._rememberInterruptedAudioId(event.interruptedTurnId);
		this._dropInterruptedDeferredAudio();
		this._interruptAssistantPlayback();
	}

	private _rememberInterruptedPlaybackIds(): void {
		this._rememberInterruptedAudioId(this._currentPlaybackResponseId);
		for (const queued of this._audioQueue) {
			this._rememberInterruptedAudioId(queued.responseId);
		}
	}

	private _rememberInterruptedAudioId(id: string | undefined): void {
		if (!id) {
			return;
		}
		this._interruptedAudioIds.delete(id);
		if (this._interruptedAudioIds.size >= 64) {
			const oldest = this._interruptedAudioIds.values().next().value;
			if (oldest !== undefined) {
				this._interruptedAudioIds.delete(oldest);
			}
		}
		this._interruptedAudioIds.add(id);
		this._responseRoutes.delete(id);
	}

	private _isInterruptedAudio(event: IVoiceAudioResponse): boolean {
		return (event.turnId !== undefined && this._interruptedAudioIds.has(event.turnId))
			|| (event.responseId !== undefined && this._interruptedAudioIds.has(event.responseId));
	}

	private _dropInterruptedDeferredAudio(): void {
		for (const [key, responses] of this._deferredResponses) {
			const kept = responses.filter(response => {
				const interrupted = (response.turnId !== undefined && this._interruptedAudioIds.has(response.turnId))
					|| (response.responseId !== undefined && this._interruptedAudioIds.has(response.responseId));
				if (interrupted && response.responseId) {
					this._responseRoutes.delete(response.responseId);
				}
				return !interrupted;
			});
			if (kept.length === responses.length) {
				continue;
			}
			if (kept.length === 0) {
				this._deferredResponses.delete(key);
			} else {
				this._deferredResponses.set(key, kept);
			}
			this._maybeHideIndicator(key);
		}
	}

	private _handleTranscription(event: IVoiceTranscription): void {
		if (event.text.trim()) {
			this._speechDetectedInTurn = true;
		}
		const state = this._transcriptionTurnState;
		if (event.turnId) {
			if (!state || state.turnId !== event.turnId || state.phase === 'final') {
				return;
			}
			if (event.revision !== undefined) {
				if (state.highestRevision !== undefined && event.revision <= state.highestRevision) {
					return;
				}
				state.highestRevision = event.revision;
			}
		}

		if (!this._telemetryFirstTranscriptionMs && this._telemetryPttDownMs) {
			this._telemetryFirstTranscriptionMs = Date.now();
		}

		const isPartial = event.status === 'partial';
		if (isPartial && !this._isLiveTranscriptEnabled()) {
			return;
		}
		this._updateUserTurn(event.text, event.committed ?? '', isPartial);
		if (isPartial) {
			return;
		}

		if (!this._pttHeld) {
			this._voiceState.set('processing', undefined);
			this._statusText.set('Processing...', undefined);
		}
		this._persistTurn('user', event.text);
		if (event.turnId && state) {
			state.phase = 'final';
		}
	}

	pttDown(source: 'explicit' | 'auto' | 'connect' = 'explicit', forceNewTurn = false): void {
		if (!this._isConnected.get()) { this.logService.trace('[voice] pttDown ignored: not connected'); return; }

		const passive = source !== 'explicit';

		this._suppressSendToChatUntil = 0;
		this._setPinnedSubmitSession(undefined);

		if (forceNewTurn) {
			this._pttToggleMode = false;
		} else if (this._pttToggleMode) {
			this.logService.trace('[voice] pttDown: toggle-mode second tap -> finishing turn');
			this._pttToggleMode = false;
			this._finishPtt();
			return;
		}

		if (this._bargeInListenActive) {
			this.logService.trace('[voice] pttDown: promoting passive barge-in listen to user interrupt');
			const shownSessionId = this._shownSessionId();
			if (shownSessionId) {
				this._cancelVoiceProgress(shownSessionId);
			}
			this._preemptCheckpointPlayback(undefined, undefined, false);
			this._bargeInListenActive = false;
			this._pttCurrentTurnPassive = false;
			this._speechDetectedInTurn = true;
			this._autoListenSuppressed = false;
			this._pttWaitingForPlayback = false;
			this._telemetryPttDownMs = Date.now();
			this._telemetryFirstTranscriptionMs = undefined;
			this._telemetryTurnCount++;
			this._rememberInterruptedPlaybackIds();
			this._telemetryTtsInterrupted = this._telemetryTtsInterrupted || this.ttsPlaybackService.isPlaying;
			if (this._delayedMicStopTimer) {
				clearTimeout(this._delayedMicStopTimer);
				this._delayedMicStopTimer = undefined;
			}
			this._cancelTranscriptFade();
			this._startUserTurn();
			this._audioQueue.length = 0;
			this._currentPlaybackSessionId = null;
			this._currentPlaybackResponseId = undefined;
			this._currentPlaybackNarration = undefined;
			this._currentPlaybackFinalized = false;
			this._isProcessingQueue = false;
			this._suppressIncomingAudio = true;
			this.ttsPlaybackService.stopPlayback();
			this._voiceState.set('listening', undefined);
			this._statusText.set('Listening...', undefined);
			if (source !== 'auto') {
				this._playListeningStartedSignal(source);
			}
			if (!this._pttMaxDurationTimer) {
				this._pttMaxDurationTimer = setTimeout(() => {
					if (this._pttHeld) {
						this._statusText.set('Max duration reached', undefined);
						this.pttUp('internal');
					}
				}, VoiceSessionController._PTT_MAX_DURATION_MS);
			}
			return;
		}

		if (this._pttHeld) { this.logService.trace('[voice] pttDown ignored: already held'); return; }
		if (source === 'explicit') {
			const shownSessionId = this._shownSessionId();
			if (shownSessionId) {
				this._cancelVoiceProgress(shownSessionId);
			}
			this._preemptCheckpointPlayback(undefined, undefined, false);
		}
		this._pttHeld = true;
		this._pttCurrentTurnPassive = passive;
		this._speechDetectedInTurn = !passive;
		this._autoListenSuppressed = false;
		this._clearAutoListenTimer();
		this._pttCurrentTurnId = generateUuid();
		this._beginTranscriptionTurn(this._pttCurrentTurnId);
		this._pttWaitingForPlayback = false;
		this._telemetryPttDownMs = Date.now();
		this._telemetryFirstTranscriptionMs = undefined;
		this._telemetryTurnCount++;
		this._rememberInterruptedPlaybackIds();
		this._telemetryTtsInterrupted = this._telemetryTtsInterrupted || this.ttsPlaybackService.isPlaying;
		if (this._delayedMicStopTimer) {
			clearTimeout(this._delayedMicStopTimer);
			this._delayedMicStopTimer = undefined;
		}
		this._cancelTranscriptFade();
		this._startUserTurn();

		this._audioQueue.length = 0;
		this._currentPlaybackSessionId = null;
		this._currentPlaybackResponseId = undefined;
		this._currentPlaybackNarration = undefined;
		this._currentPlaybackFinalized = false;
		this._isProcessingQueue = false;
		this._suppressIncomingAudio = true;

		this.micCaptureService.isMuted = false;
		this.micCaptureService.suppressUntil(0);
		this.micCaptureService.pttDown(this._pttCurrentTurnId, passive).catch((err) => {
			this.logService.warn('[voice] mic acquisition failed on pttDown; disconnecting', err);
			this._pttHeld = false;
			this._statusText.set('Microphone denied', undefined);
			this._voiceState.set('error', undefined);
			if (this._pttMaxDurationTimer) {
				clearTimeout(this._pttMaxDurationTimer);
				this._pttMaxDurationTimer = undefined;
			}
			this.disconnect();
		});
		this.ttsPlaybackService.stopPlayback();
		this._voiceState.set('listening', undefined);
		this._statusText.set('Listening...', undefined);
		if (source !== 'auto') {
			this._playListeningStartedSignal(source);
		}

		this._pttMaxDurationTimer = setTimeout(() => {
			if (this._pttHeld) {
				this._statusText.set('Max duration reached', undefined);
				this.pttUp('internal');
			}
		}, VoiceSessionController._PTT_MAX_DURATION_MS);
	}

	pttUp(source: 'explicit' | 'internal' = 'explicit', forceFinish = false): void {
		if (!this._pttHeld) { return; }

		if (!forceFinish) {
			const holdMs = this._telemetryPttDownMs ? Date.now() - this._telemetryPttDownMs : Infinity;
			if (holdMs < VoiceSessionController._PTT_TOGGLE_THRESHOLD_MS) {
				this._pttToggleMode = true;
				return;
			}
		}

		this._finishPtt('local', source);
	}

	setAutoListenHeld(held: boolean): void {
		if (this._autoListenHeld === held) {
			return;
		}
		this._autoListenHeld = held;
		this.logService.trace(`[voice] setAutoListenHeld: ${held}`);
		if (held) {
			this._clearAutoListenTimer();
			if (this._isConnected.get() && this._pttHeld) {
				this._finishPtt('local', 'internal');
			}
			return;
		}
		if (this._isConnected.get() && this._isHandsFreeEnabled()) {
			this._enterAutoListen('connect');
		}
	}

	stopListening(source: 'explicit' | 'internal' = 'explicit'): void {
		if (!this._isConnected.get()) { return; }
		this._autoListenSuppressed = true;
		this._pttToggleMode = false;
		this._clearAutoListenTimer();
		if (this._pttHeld) {
			this._finishPtt('local', source);
		} else {
			this._voiceState.set('idle', undefined);
			this._statusText.set('Tap to start', undefined);
		}
	}

	discardListening(): void {
		if (!this._isConnected.get()) { return; }
		this._autoListenSuppressed = true;
		this._pttToggleMode = false;
		this._clearAutoListenTimer();
		this._suppressSendToChatUntil = Date.now() + VoiceSessionController._DISCARD_SEND_SUPPRESS_MS;
		if (this._pttHeld) {
			this._finishPtt('discard');
		} else {
			this._voiceState.set('idle', undefined);
			this._statusText.set('Tap to start', undefined);
		}
	}

	finishListeningAndSubmitTo(session: URI): void {
		if (!this._isConnected.get()) { return; }
		this._autoListenSuppressed = true;
		this._pttToggleMode = false;
		this._clearAutoListenTimer();
		this._setPinnedSubmitSession(session);
		if (this._pttHeld) {
			this._finishPtt('local', 'internal');
		} else {
			this._voiceState.set('processing', undefined);
			this._statusText.set('Processing...', undefined);
		}
	}

	private _setPinnedSubmitSession(session: URI | undefined): void {
		if (this._pinnedSubmitTimer) {
			clearTimeout(this._pinnedSubmitTimer);
			this._pinnedSubmitTimer = undefined;
		}
		this._pinnedSubmitSession = session;
		if (session) {
			this._pinnedSubmitTimer = setTimeout(() => {
				this._pinnedSubmitTimer = undefined;
				this._pinnedSubmitSession = undefined;
			}, VoiceSessionController._PINNED_SUBMIT_EXPIRY_MS);
		}
	}

	private _consumePinnedSubmitSession(): URI | undefined {
		const pinned = this._pinnedSubmitSession;
		if (pinned) {
			this._setPinnedSubmitSession(undefined);
		}
		return pinned;
	}

	private _finishPtt(reason: 'local' | 'auto' | 'discard' = 'local', source: 'explicit' | 'internal' = 'explicit'): void {
		this._pttToggleMode = false;
		this._bargeInListenActive = false;
		if (!this._pttHeld) { return; }
		this._clearAutoListenTimer();
		this._pttHeld = false;
		this._speechDetectedInTurn = false;
		this._pttToggleMode = false;
		this._telemetryPttUpMs = Date.now();
		const holdMs = this._telemetryPttDownMs ? Date.now() - this._telemetryPttDownMs : 0;
		this.telemetryService.publicLog2<VoicePttEvent, VoicePttClassification>('voicePtt', { holdDurationMs: holdMs });
		if (this._pttMaxDurationTimer) {
			clearTimeout(this._pttMaxDurationTimer);
			this._pttMaxDurationTimer = undefined;
		}
		this._voiceState.set('processing', undefined);
		this._statusText.set('Processing...', undefined);
		this._replyPlayedSinceSend = false;
		this._clearAwaitingReply();
		this._suppressIncomingAudio = false;
		this._markTranscriptionTurnPending();
		if (reason === 'auto' || reason === 'discard') {
			this.micCaptureService.abortPtt();
		} else {
			this.micCaptureService.pttUp();
		}
		if (reason === 'discard') {
			this._voiceState.set('idle', undefined);
			this._statusText.set('Tap to start', undefined);
		}
		if (reason === 'local' && source === 'explicit') {
			this._playRecordingStoppedSignal(true);
		} else if (this.accessibilityService.isScreenReaderOptimized()) {
			this._playRecordingStoppedSignal(false);
		}
		queueMicrotask(() => this._drainOmniInbox());
	}

	private _playRecordingStoppedSignal(userGesture: boolean): void {
		void this.accessibilitySignalService.playSignal(AccessibilitySignal.voiceRecordingStopped, {
			source: userGesture ? 'voiceMode.explicitListeningStopped' : 'voiceMode.listeningStopped',
			userGesture,
		});
	}

	markUserCancelled(sessionId: string): void {
		this._cancelVoiceProgress(sessionId);
		this._preemptCheckpointPlayback(sessionId);
		const existing = this._userCancelledSessions.get(sessionId);
		if (existing) { clearTimeout(existing); }
		const expiry = setTimeout(() => {
			this._userCancelledSessions.delete(sessionId);
		}, VoiceSessionController._USER_CANCEL_SUPPRESS_MS);
		this._userCancelledSessions.set(sessionId, expiry);
	}

	setTargetSession(resource: URI | undefined, omniRoute?: 'existing_session' | 'new_session'): void {
		this._targetOmniRoute = resource ? omniRoute : undefined;
		this._hasDraftTarget.set(false, undefined);
		this._targetSession.set(resource, undefined);
	}

	prepareForRoutingRequest(): void {
		const resource = this._targetSession.get();
		if (resource) {
			this._discardResponsesSupersededByPending(this._sessionKey(resource.toString()));
		}
		this.setTargetSession(undefined);
	}

	markRoutedRequestPending(resource: URI, requestId?: string): void {
		const sessionKey = this._sessionKey(resource.toString());
		this._abandonedRoutedRequests.delete(sessionKey);
		const existing = this._routedRequests.get(sessionKey);
		const wasAlreadyMarked = existing !== undefined;
		const hasPreviousRequestBaseline = existing ? hasOwn(existing, 'previousRequestId') : !requestId;
		const previousRequestId = existing && hasOwn(existing, 'previousRequestId')
			? existing.previousRequestId
			: !requestId ? (this.chatService.getSession(resource)?.getRequests().at(-1)?.id ?? null) : undefined;
		const routedRequest: IRoutedVoiceRequest = {
			requestId: requestId ?? existing?.requestId,
			...(existing?.modelRequestId ? { modelRequestId: existing.modelRequestId } : {}),
			...(hasPreviousRequestBaseline ? { previousRequestId } : {}),
			phase: 'queued' as const,
		};
		this._routedRequests.set(sessionKey, routedRequest);
		this.logService.trace(`[voice] routed request pending session=${sessionKey.slice(-32)} request=${routedRequest.requestId ?? '<unknown>'} model=${routedRequest.modelRequestId ?? '<unknown>'} previous=${previousRequestId ?? '<none>'}`);
		if (!wasAlreadyMarked) {
			this._discardResponsesSupersededByPending(sessionKey);
		}

		const model = this.chatService.getSession(resource);
		if (model && this._isCurrentRoutedRequest(resource.toString(), routedRequest)) {
			const state = this._getAgentStateInfo(model);
			if (state.state === 'thinking') {
				this._routedRequests.set(sessionKey, { ...routedRequest, phase: 'running' });
			} else if (state.state === 'waiting_for_confirmation') {
				this._routedRequests.set(sessionKey, { ...routedRequest, phase: 'waiting' });
			}
		}
	}

	clearRoutedRequest(resource: URI): void {
		const sessionKey = this._sessionKey(resource.toString());
		this._routedRequests.delete(sessionKey);
		this._abandonedRoutedRequests.delete(sessionKey);
	}

	getLastSpokenResponseSession(): URI | undefined {
		if (!this._lastSpokenResponseSessionId) {
			return undefined;
		}
		try {
			return URI.parse(this._lastSpokenResponseSessionId);
		} catch {
			return undefined;
		}
	}

	setDraftTarget(): void {
		this._targetOmniRoute = undefined;
		this._targetSession.set(undefined, undefined);
		this._hasDraftTarget.set(true, undefined);
	}

	takeSessionInputOwnership(resource: URI, window: Window & typeof globalThis): void {
		this._omniBlurRelease.clear();
		this.setActiveWindow(window);
		transaction(tx => {
			this._targetOmniRoute = undefined;
			this._omniInputActive.set(false, tx);
			this._hasDraftTarget.set(false, tx);
			this._targetSession.set(resource, tx);
		});
		this.activateSession(resource);
	}

	takeDraftInputOwnership(window: Window & typeof globalThis): void {
		this._omniBlurRelease.clear();
		this.setActiveWindow(window);
		transaction(tx => {
			this._targetOmniRoute = undefined;
			this._omniInputActive.set(false, tx);
			this._targetSession.set(undefined, tx);
			this._hasDraftTarget.set(true, tx);
		});
	}

	takeOmniInputOwnership(window: Window & typeof globalThis): void {
		this._omniBlurRelease.clear();
		this.setActiveWindow(window);
		transaction(tx => {
			this._targetOmniRoute = undefined;
			this._targetSession.set(undefined, tx);
			this._hasDraftTarget.set(true, tx);
			this._omniInputActive.set(true, tx);
		});
	}

	retainOmniInputOwnershipForBargeIn(window: Window & typeof globalThis): boolean {
		if (!this._omniInputActive.get() || this._window !== window) {
			return false;
		}
		return true;
	}

	setOmniInputActive(active: boolean): void {
		this._omniBlurRelease.clear();
		if (this._omniInputActive.get() === active) {
			return;
		}
		this._omniInputActive.set(active, undefined);
		if (!active) {
			this._targetOmniRoute = undefined;
			this._targetSession.set(undefined, undefined);
			this._hasDraftTarget.set(false, undefined);
		}
	}

	setOmniInputOpen(open: boolean): void {
		if (this._omniInputOpen === open) {
			return;
		}
		this._omniInputOpen = open;
		this.logService.trace(`[voice] omni inbox ${open ? 'opened' : 'closed'}`);
		if (open) {
			for (const key of this._pendingVoiceIndicatorKeys()) {
				this._markPendingResponse(key, false);
			}

			for (const sessionKey of [...this._deferredNarrations.keys()]) {
				this._retryDeferredNarration(sessionKey);
			}
			this._drainOmniInbox();
		} else {
			this._releaseOmniInboxToPanel();
		}
	}

	releaseOmniInputOnBlur(): void {
		this._clearAutoListenTimer();
		if (!this._omniInputActive.get()) {
			return;
		}
		if (this._voiceState.get() === 'idle' || this._voiceState.get() === 'error') {
			this.setOmniInputActive(false);
			return;
		}
		this._omniBlurRelease.value = autorun(reader => {
			const state = this._voiceState.read(reader);
			if (state !== 'idle' && state !== 'error') {
				return;
			}
			Promise.resolve().then(() => {
				const currentState = this._voiceState.read(undefined);
				if (currentState === 'idle' || currentState === 'error') {
					this.setOmniInputActive(false);
				}
			});
		});
	}

	promoteDraftTarget(resource: URI): void {
		if (!this._hasDraftTarget.get()) {
			return;
		}
		this._hasDraftTarget.set(false, undefined);
		this._targetSession.set(resource, undefined);
		if (this._isSameSession(resource.toString(), this._shownSessionId())) {
			this._activateShownSession(resource);
		}
	}

	newSessionAsTarget(): void {
		const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat);
		const resource = ref.object.sessionResource;
		ref.dispose();
		this._targetOmniRoute = undefined;
		this._hasDraftTarget.set(false, undefined);
		this._targetSession.set(resource, undefined);
		this.commandService.executeCommand('_chat.voice.switchToSession', resource.toString()).catch(() => { });
	}

	private _scheduleDelayedMicStop(): void {
		if (this._delayedMicStopTimer) {
			clearTimeout(this._delayedMicStopTimer);
		}
		this._delayedMicStopTimer = setTimeout(() => {
			this._delayedMicStopTimer = undefined;
			this._pttWaitingForPlayback = false;
		}, 1000);
	}

	private _isHandsFreeEnabled(): boolean {
		return this.configurationService.getValue<boolean>('agents.voice.handsFree') === true;
	}

	private _shouldEnterListenOnSessionInit(isResuming: boolean): boolean {
		return !isResuming && this._isHandsFreeEnabled();
	}

	private _isLiveTranscriptEnabled(): boolean {
		return this.configurationService.getValue<boolean>('agents.voice.liveTranscript') === true;
	}

	private _stripStopPhrase(text: string): string {
		const raw = this.configurationService.getValue<string[]>('agents.voice.turn.stopPhrases');
		const phrases = Array.isArray(raw)
			? raw.map(p => (typeof p === 'string' ? p.trim() : '')).filter(p => p.length > 0)
			: [];
		if (phrases.length === 0) {
			return text;
		}
		const trimmed = text.trimEnd().replace(/[.,!?;:]+$/, '').trimEnd();
		const trimmedLower = trimmed.toLowerCase();
		const sorted = [...phrases].sort((a, b) => b.length - a.length);
		for (const phrase of sorted) {
			const phraseLower = phrase.toLowerCase();
			if (!trimmedLower.endsWith(phraseLower)) {
				continue;
			}
			const idx = trimmed.length - phrase.length;
			if (idx === 0 || /\s/.test(trimmed[idx - 1])) {
				return trimmed.slice(0, idx).replace(/[.,!?;:\s]+$/, '');
			}
		}
		return text;
	}

	private _isWindowFocused(): boolean {
		if (this._omniInputActive.get()) {
			return true;
		}
		try {
			return this._window?.document.hasFocus() ?? false;
		} catch {
			return false;
		}
	}

	private _onWindowBlur(): void {
		if (this._omniInputActive.get()) {
			return;
		}
		if (this._pttHeld && this._pttCurrentTurnPassive) {
			this.logService.trace('[voice] window blur: aborting passive turn (multi-window hands-free #8507)');
			this._finishPtt('discard', 'internal');
		}
	}

	private _onWindowFocus(): void {
		if (this._isHandsFreeEnabled()) {
			this.logService.trace('[voice] window focus: re-arming hands-free auto-listen (multi-window #8507)');
			this._enterAutoListen();
		}
	}

	private _enterAutoListen(source: 'auto' | 'connect' = 'auto'): void {
		this._clearAutoListenTimer();
		if (this._autoListenHeld || this._autoListenSuppressed || !this._isConnected.get() || this._pttHeld) {
			this.logService.trace(`[voice] _enterAutoListen skipped: held=${this._autoListenHeld} suppressed=${this._autoListenSuppressed} connected=${this._isConnected.get()} pttHeld=${this._pttHeld}`);
			return;
		}
		if (source === 'auto' && !this._isWindowFocused()) {
			this.logService.trace('[voice] _enterAutoListen skipped: window not focused (multi-window hands-free)');
			return;
		}
		if (this.ttsPlaybackService.isPlaying || this._audioQueue.length > 0 || this._currentPlaybackSessionId !== null) {
			this.logService.trace(`[voice] _enterAutoListen skipped: audio busy (playing=${this.ttsPlaybackService.isPlaying} queue=${this._audioQueue.length} pbSession=${this._currentPlaybackSessionId !== null})`);
			return;
		}
		this.logService.trace('[voice] _enterAutoListen entering listening');
		this.pttDown(source);
		this.pttUp('internal');
	}

	private _playListeningStartedSignal(source: 'explicit' | 'connect'): void {
		if (source === 'connect') {
			void this.accessibilitySignalService.playSignal(AccessibilitySignal.voiceModeStarted, {
				source: 'voiceMode.connectListeningStarted',
				userGesture: true,
			});
			return;
		}

		void this.accessibilitySignalService.playSignal(AccessibilitySignal.voiceRecordingStarted, {
			source: 'voiceMode.explicitListeningStarted',
			userGesture: true,
		});
	}

	private _startBargeInListen(): void {
		if (!this._isHandsFreeEnabled() || !this._isConnected.get() || this._pttHeld || this._autoListenHeld || this._autoListenSuppressed || !this._window) {
			return;
		}
		if (!this._isWindowFocused()) {
			return;
		}
		this._clearAutoListenTimer();
		this._pttCurrentTurnId = generateUuid();
		this._pttHeld = true;
		this._pttCurrentTurnPassive = true;
		this._speechDetectedInTurn = false;
		this._bargeInListenActive = true;
		this._telemetryPttDownMs = Date.now();
		this.micCaptureService.isMuted = false;
		this.micCaptureService.suppressUntil(0);
		this.micCaptureService.pttDown(this._pttCurrentTurnId, true).catch(err => {
			this.logService.warn('[voice] barge-in listen failed to start', err);
			this._pttHeld = false;
			this._bargeInListenActive = false;
		});
	}

	private _scheduleAutoListen(): void {
		this._clearAutoListenTimer();
		this._autoListenTimer = setTimeout(() => {
			this._autoListenTimer = undefined;
			if (this._awaitingReplyAudio) { return; }
			this._enterAutoListen();
		}, VoiceSessionController._AUTO_LISTEN_QUIET_MS);
	}

	private _clearAutoListenTimer(): void {
		if (this._autoListenTimer) {
			clearTimeout(this._autoListenTimer);
			this._autoListenTimer = undefined;
		}
	}

	private _setAwaitingReply(): void {
		this._awaitingReplyAudio = true;
		this._awaitingReplyForSession = this._getActiveSessionId();
		this._clearAutoListenTimer();
		if (this._awaitingReplyWatchdog) {
			clearTimeout(this._awaitingReplyWatchdog);
		}
		this._awaitingReplyWatchdog = setTimeout(() => {
			this._awaitingReplyWatchdog = undefined;
			this._awaitingReplyAudio = false;
			this._awaitingReplyForSession = undefined;
			if (this._isHandsFreeEnabled() && !this._pttHeld) {
				this._enterAutoListen();
			}
		}, 30_000);
	}

	private _clearAwaitingReply(): void {
		this._awaitingReplyAudio = false;
		this._awaitingReplyForSession = undefined;
		if (this._awaitingReplyWatchdog) {
			clearTimeout(this._awaitingReplyWatchdog);
			this._awaitingReplyWatchdog = undefined;
		}
	}

	private _acceptVoiceInput(text: string, sessionResource: URI): void {
		this.commandService.executeCommand<IChatResponseModel | undefined>('_chat.voice.acceptInput', text).then(response => {
			this.logService.info(`[voice] acceptInput completed session=${sessionResource.toString()} response=${response?.id ?? 'none'} connected=${this._isConnected.get()}`);
			if (response && this._isConnected.get()) {
				this._watchVoiceProgress(sessionResource, response);
			}
		}).catch(err => this.logService.warn('[voice] acceptInput failed:', err));
	}

	private async _sendVoiceRequest(sessionResource: URI, text: string): Promise<ChatSendResult | undefined> {
		const result = await this.chatService.sendRequest(sessionResource, text, { isVoiceModeInput: this._isVoiceProgressEnabled() }).catch(err => {
			this.logService.warn('[voice] Error sending transcription:', err);
			return undefined;
		});
		if (!result) {
			return undefined;
		}

		const sentResult = ChatSendResult.isQueued(result) ? result.deferred : Promise.resolve(result);
		sentResult.then(async sent => {
			if (ChatSendResult.isSent(sent)) {
				const response = await sent.data.responseCreatedPromise;
				if (this._isConnected.get()) {
					this._watchVoiceProgress(sessionResource, response);
				}
			}
		}).catch(err => this.logService.warn('[voice] Failed to watch voice response:', err));
		return result;
	}

	private _watchVoiceProgress(sessionResource: URI, response: IChatResponseModel): void {
		if (!this._isVoiceProgressEnabled()) {
			return;
		}
		const disposables = new DisposableStore();
		const timer = disposables.add(new MutableDisposable());
		const seen = new Set<string>();
		const sessionId = sessionResource.toString();
		const sessionKey = this._sessionKey(sessionId);
		const requestStartedAt = Date.now();
		let narratedCount = 0;
		let lastCheckpointAt: number | undefined;
		let nextSequence = 1;
		let pending: { id: VoiceCheckpointId; value: string } | undefined;
		this.logService.info(`[voice] watching progress session=${sessionId} response=${response.id} request=${response.requestId}`);

		const dispose = () => this._voiceProgressListeners.deleteAndDispose(response.id);
		const nextEligibleAt = () => {
			if (lastCheckpointAt !== undefined) {
				return lastCheckpointAt + VoiceSessionController._VOICE_PROGRESS_INTERVAL_MS;
			}
			const lastSpokenAt = this._lastSpokenAtBySession.get(sessionKey);
			return Math.max(
				requestStartedAt + VoiceSessionController._VOICE_PROGRESS_INITIAL_DELAY_MS,
				(lastSpokenAt ?? 0) + VoiceSessionController._VOICE_PROGRESS_INITIAL_DELAY_MS,
			);
		};
		const flush = () => {
			timer.clear();
			if (!this._isVoiceProgressEnabled()) {
				dispose();
				return;
			}
			if (response.isComplete || response.isCanceled) {
				dispose();
				return;
			}
			if (!pending || narratedCount >= VoiceSessionController._MAX_VOICE_PROGRESS_PER_REQUEST) {
				return;
			}
			if (!this._isConnected.get()) {
				return;
			}
			const canReplacePlayingCheckpoint = this._currentPlaybackNarration?.kind === 'checkpoint';
			if (this.ttsPlaybackService.isPlaying && !canReplacePlayingCheckpoint) {
				return;
			}
			const delay = nextEligibleAt() - Date.now();
			if (delay > 0) {
				timer.value = disposableTimeout(flush, delay);
				return;
			}

			const checkpoint = pending;
			pending = undefined;
			const metadata: IVoiceCheckpointNarrationMetadata = {
				requestId: response.requestId,
				checkpointId: checkpoint.id,
				sequence: nextSequence++,
			};
			const narrated = this._isConnected.get()
				&& this._isSameSession(sessionId, this._shownSessionId())
				&& this._narrate(sessionId, 'checkpoint', checkpoint.value, undefined, metadata);
			this.logService.info(`[voice] checkpoint dispatch session=${sessionId} response=${response.id} stage=${checkpoint.id} sequence=${metadata.sequence} narrated=${Boolean(narrated)}`);
			if (narrated) {
				narratedCount++;
				lastCheckpointAt = Date.now();
			}
		};
		const schedule = () => {
			timer.clear();
			const delay = nextEligibleAt() - Date.now();
			if (delay <= 0) {
				flush();
			} else {
				timer.value = disposableTimeout(flush, delay);
			}
		};
		const update = () => {
			if (!this._isVoiceProgressEnabled()) {
				dispose();
				return;
			}
			if (response.isComplete || response.isCanceled) {
				this._preemptCheckpointPlayback(sessionId);
				dispose();
				return;
			}
			for (const part of response.response.value) {
				if (part.kind !== 'voiceProgress' || !isVoiceCheckpointId(part.id) || seen.has(part.id)) {
					continue;
				}
				seen.add(part.id);
				pending = { id: part.id, value: part.value };
				this.logService.info(`[voice] checkpoint observed session=${sessionId} response=${response.id} stage=${part.id}`);
			}
			if (pending) {
				schedule();
			}
		};

		disposables.add(response.onDidChange(update));
		disposables.add(autorun(reader => {
			if (this._isConnected.read(reader) && pending) {
				schedule();
			}
		}));
		disposables.add(this.ttsPlaybackService.onPlaybackStopped(() => {
			if (pending) {
				schedule();
			}
		}));
		disposables.add({ dispose: () => this._voiceProgressSessionByResponse.delete(response.id) });
		this._voiceProgressListeners.set(response.id, disposables);
		this._voiceProgressSessionByResponse.set(response.id, sessionKey);
		update();
	}

	private _isVoiceProgressEnabled(): boolean {
		return this.configurationService.getValue<boolean>(VOICE_AGENT_PROGRESS_SETTING) === true;
	}

	private _cancelVoiceProgress(sessionId?: string): void {
		const sessionKey = sessionId ? this._sessionKey(sessionId) : undefined;
		for (const responseId of [...this._voiceProgressListeners.keys()]) {
			if (sessionKey === undefined || this._voiceProgressSessionByResponse.get(responseId) === sessionKey) {
				this._voiceProgressListeners.deleteAndDispose(responseId);
			}
		}
	}

	private async _sendTranscriptionToChat(text: string): Promise<void> {
		const pinnedTarget = this._consumePinnedSubmitSession();
		const acceptedByOmni = !pinnedTarget && await this.commandService.executeCommand<boolean>(CHAT_INPUT_WINDOW_ACCEPT_VOICE_COMMAND_ID, text).catch(() => false);
		if (acceptedByOmni) {
			return;
		}

		const target = pinnedTarget ?? this._targetSession.get();
		if (target) {
			const currentSession = await this.commandService.executeCommand<string | undefined>('_chat.voice.getCurrentSession').catch(() => undefined);
			const isTargetVisible = currentSession === target.toString();

			if (isTargetVisible) {
				this._acceptVoiceInput(text, target);
			} else {
				const cts = new CancellationTokenSource();
				const ref = await this.chatService.acquireOrLoadSession(target, ChatAgentLocation.Chat, cts.token, 'voice-send').catch(err => {
					this.logService.warn('[voice] Failed to load target session:', err);
					return undefined;
				});
				cts.dispose();
				if (!ref) {
					this.logService.warn('[voice] Could not load target session, falling back to switch');
					const switched = await this.commandService.executeCommand<boolean>('_chat.voice.switchToSession', target.toString()).catch(() => false);
					if (switched) {
						await new Promise(resolve => setTimeout(resolve, 200));
						this._acceptVoiceInput(text, target);
					}
					return;
				}
				const result = await this._sendVoiceRequest(target, text);
				if (result && result.kind !== 'rejected') {
					this._watchResponseForFloatingWindow(target);
					this.commandService.executeCommand('_agentsVoice.openWindow').catch(() => { });
					const model = this.chatService.getSession(target);
					if (model) {
						const lastReq = model.getRequests().at(-1);
						if (lastReq?.response && !lastReq.response.isComplete && !lastReq.response.isCanceled) {
							const responseDisposable = lastReq.response.onDidChange(() => {
								if (lastReq.response!.isComplete || lastReq.response!.isCanceled) {
									responseDisposable.dispose();
									ref.dispose();
								}
							});
						} else {
							ref.dispose();
						}
					} else {
						ref.dispose();
					}
				} else {
					ref.dispose();
				}
			}
		} else {
			const currentSession = await this.commandService.executeCommand<string | undefined>('_chat.voice.getCurrentSession').catch(() => undefined);
			if (currentSession) {
				this._acceptVoiceInput(text, URI.parse(currentSession));
			} else {
				const models = [...this.chatService.chatModels.get()];
				const existingSession = models.length > 0 ? models[models.length - 1] : undefined;
				const sessionResource = existingSession?.sessionResource;

				if (sessionResource) {
					const switched = await this.commandService.executeCommand<boolean>('_chat.voice.switchToSession', sessionResource.toString()).catch(() => false);
					if (switched) {
						await new Promise(resolve => setTimeout(resolve, 200));
						this._acceptVoiceInput(text, sessionResource);
					} else {
						await this._sendVoiceRequest(sessionResource, text);
					}
				} else {
					const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat);
					const resource = ref.object.sessionResource;
					ref.dispose();
					this.commandService.executeCommand('_chat.voice.switchToSession', resource.toString()).catch(() => { });
					await this._sendVoiceRequest(resource, text);
				}
			}

			this.commandService.executeCommand('workbench.panel.chat.view.copilot.focus').catch(() => { });
		}
	}

	private _watchResponseForFloatingWindow(sessionResource: URI): void {
		const model = this.chatService.getSession(sessionResource);
		if (!model) {
			return;
		}

		this._prevSessionStates.set(sessionResource.toString(), { state: 'thinking', detail: '', pendingId: '', lastResponseSummary: '' });
		this._sendContext();

		const disposables = new DisposableStore();
		let lastText = '';

		const updateFromResponse = () => {
			const lastReq = model.lastRequest;
			const response = lastReq?.response;
			if (!response) {
				return;
			}

			const markdown = response.response.getMarkdown();
			const previewText = markdown.length > 200 ? markdown.slice(0, 200) + '…' : markdown;
			if (previewText && previewText !== lastText) {
				const isFirst = lastText === '';
				lastText = previewText;
				this._setAssistantTurn(previewText, { startNewTurn: isFirst });
			}

			if (response.isComplete || response.isCanceled) {
				this._prevSessionStates.set(sessionResource.toString(), { state: 'idle', detail: '', pendingId: '', lastResponseSummary: '' });
				this._sendContext();
				this.voiceClientService.flushSessionContext();
				disposables.dispose();
			}
		};

		const checkResponse = () => {
			const lastReq = model.lastRequest;
			if (lastReq?.response) {
				disposables.add(lastReq.response.onDidChange(() => updateFromResponse()));
				updateFromResponse();
			}
		};

		disposables.add(model.onDidChange(e => {
			if (e.kind === 'addResponse') {
				checkResponse();
			}
		}));
		checkResponse();

		const timeout = setTimeout(() => disposables.dispose(), 5 * 60 * 1000);
		disposables.add({ dispose: () => clearTimeout(timeout) });
	}


	private _pushTurn(turn: ITranscriptTurn): void {
		const cur = this._transcriptTurns.get();
		const next = [...cur, turn].slice(-VoiceSessionController._MAX_TURNS);
		this._transcriptTurns.set(next, undefined);
	}

	private _startUserTurn(): void {
		const cur = this._transcriptTurns.get();
		const last = cur[cur.length - 1];
		if (last && last.speaker === 'user' && !last.text) {
			return;
		}
		this._pushTurn({ speaker: 'user', text: '', committed: '', isPartial: true });
	}

	private _updateUserTurn(text: string, committed: string, isPartial: boolean): void {
		const cur = this._transcriptTurns.get();
		const last = cur[cur.length - 1];
		if (!last || last.speaker !== 'user') {
			this._pushTurn({ speaker: 'user', text, committed, isPartial });
			return;
		}
		const updated: ITranscriptTurn = { speaker: 'user', text, committed, isPartial };
		this._transcriptTurns.set([...cur.slice(0, -1), updated], undefined);
	}

	private _setAssistantTurn(text: string, opts: { startNewTurn: boolean } = { startNewTurn: true }): void {
		const cur = this._transcriptTurns.get();
		const last = cur[cur.length - 1];
		if (!opts.startNewTurn && last && last.speaker === 'assistant') {
			const updated: ITranscriptTurn = { speaker: 'assistant', text, committed: '', isPartial: false };
			this._transcriptTurns.set([...cur.slice(0, -1), updated], undefined);
			return;
		}
		this._pushTurn({ speaker: 'assistant', text, committed: '', isPartial: false });
	}

	private _cancelTranscriptFade(): void {
		if (this._transcriptFadeTimer) {
			clearTimeout(this._transcriptFadeTimer);
			this._transcriptFadeTimer = undefined;
		}
	}


	private _persistEntry(
		kind: VoiceTranscriptKind,
		text: string,
		metadata?: IVoiceTranscriptEntryMetadata,
	): void {
		const userId = this._userLogin;
		if (!userId || !text) {
			return;
		}
		const entry: IVoiceTranscriptTurn = {
			turnId: generateUuid(),
			ancestorIds: this._lastPersistedTurnId ? [this._lastPersistedTurnId] : [],
			kind,
			role: kind === 'user_voice' ? 'user' : 'assistant',
			text,
			timestamp: new Date().toISOString(),
			...(metadata ? { metadata } : {}),
		};
		this._lastPersistedTurnId = entry.turnId;
		this.voiceTranscriptStore.appendTurn(userId, entry).catch(err => {
			this.logService.warn('[voice] failed to persist transcript entry', err);
		});
	}

	private _persistTurn(role: 'user' | 'assistant', text: string): void {
		this._persistEntry(role === 'user' ? 'user_voice' : 'agent_voice', text);
	}

	private _renderToolCallSummary(name: string, args: Record<string, unknown> | undefined): string {
		if (!args || Object.keys(args).length === 0) {
			return `${name}()`;
		}
		const pairs: string[] = [];
		for (const [k, v] of Object.entries(args)) {
			let rendered: string;
			if (typeof v === 'string') {
				rendered = v.length > 200 ? `${v.slice(0, 197)}...` : v;
				rendered = JSON.stringify(rendered);
			} else {
				try {
					const json = JSON.stringify(v);
					rendered = json.length > 200 ? `${json.slice(0, 197)}...` : json;
				} catch {
					rendered = String(v);
				}
			}
			pairs.push(`${k}=${rendered}`);
		}
		return `${name}(${pairs.join(', ')})`;
	}

	private _buildPriorTimeline(turns: readonly IVoiceTranscriptTurn[]): IVoicePriorTimelineEntry[] {
		const out: IVoicePriorTimelineEntry[] = [];

		for (const t of turns) {
			const kind: VoiceTranscriptKind | undefined = t.kind;
			if (!kind) {
				continue;
			}
			const entry: IVoicePriorTimelineEntry = {
				kind,
				text: t.text,
				timestamp: new Date(t.timestamp).toISOString(),
				...(t.metadata?.toolName ? { toolName: t.metadata.toolName } : {}),
				...(t.metadata?.codingSessionId ? { codingSessionId: t.metadata.codingSessionId } : {}),
				...(t.metadata?.codingStatus ? { codingStatus: t.metadata.codingStatus } : {}),
			};
			out.push(entry);
		}

		try {
			const sessions: any[] = [];
			for (const session of sessions) {
				const model = this.chatService.getSession(session.resource);
				const lastReq = model?.getRequests().at(-1);
				const value = lastReq?.response?.response.value;
				if (!value) {
					continue;
				}
				const full = value
					.filter(p => p.kind === 'markdownContent')
					.map(p => (p as { content: { value: string } }).content.value)
					.join(' ')
					.trim();
				if (!full) {
					continue;
				}
				const summary = this._firstSentences(full, VoiceSessionController.CODING_AGENT_REPLY_SENTENCE_LIMIT);
				if (!summary) {
					continue;
				}
				out.push({
					kind: 'coding_agent_reply',
					text: summary,
					timestamp: new Date().toISOString(),
					codingSessionId: session.resource.toString(),
				});
			}
		} catch (err) {
			this.logService.warn('[voice] failed to synthesize coding_agent_reply timeline entries', err);
		}

		return out;
	}

	private _firstSentences(text: string, n: number): string {
		const collapsed = text.replace(/\s+/g, ' ').trim();
		if (!collapsed) {
			return '';
		}
		const sentences: string[] = [];
		const re = /[^.!?]+[.!?]+(\s|$)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(collapsed)) !== null && sentences.length < n) {
			sentences.push(m[0].trim());
		}
		if (sentences.length === 0) {
			return collapsed.length > 600 ? `${collapsed.slice(0, 597)}...` : collapsed;
		}
		return sentences.join(' ');
	}


	private _recordSessionAlias(uiResource: URI): void {
		const backend = ((uri: any) => uri)(uiResource);
		if (!backend) {
			return;
		}
		const from = backend.toString();
		const to = uiResource.toString();
		if (this._uiResourceByBackendId.get(from) === to) {
			return;
		}
		this._uiResourceByBackendId.set(from, to);
		this._rekeySession(from, to);
	}

	private _rekeySession(from: string, to: string): void {
		if (from === to) {
			return;
		}
		const rekeyMap = <V>(m: Map<string, V>): void => {
			if (m.has(from)) {
				if (!m.has(to)) {
					m.set(to, m.get(from)!);
				}
				m.delete(from);
			}
		};
		const rekeySet = (s: Set<string>): void => {
			if (s.has(from)) {
				s.delete(from);
				s.add(to);
			}
		};
		rekeyMap(this._deferredResponses);
		rekeyMap(this._pendingResponseSummaries);
		rekeyMap(this._lastNarratedText);
		rekeyMap(this._lastHeardTranscriptById);
		rekeyMap(this._recentlyReadResponse);
		rekeyMap(this._lastResponseSummaryById);
		rekeyMap(this._pendingNarrationRetries);
		rekeyMap(this._deferredNarrations);
		rekeyMap(this._narratedPending);
		rekeyMap(this._routedRequests);
		rekeyMap(this._omniClaimedPendingIds);
		rekeyMap(this._omniClaimedResponseSummaries);
		rekeyMap(this._omniDeferredSessionOrdinals);
		rekeySet(this._confirmationPendingSessions);
		rekeySet(this._abandonedRoutedRequests);
		rekeySet(this._omniDeferredSessionKeys);
		rekeySet(this._liveReplyKeys);
		rekeySet(this._sessionsAwaitingResponseSummary);
		rekeySet(this._pendingIdleNarration);
		this._markPendingResponse(from, false);
		if (this._pendingOwned(to)) {
			this._markPendingResponse(to, true);
		}
	}

	private _sessionKey(id: string): string {
		return this._uiResourceByBackendId.get(id) ?? id;
	}

	private _pendingOwned(key: string): boolean {
		return this._confirmationPendingSessions.has(key)
			|| this._deferredResponses.has(key)
			|| this._pendingResponseSummaries.has(key);
	}

	private _canonicalSessionId(id: string | undefined): string | undefined {
		return id ? (this._uiResourceByBackendId.get(id) ?? id) : id;
	}

	private _getFocusedSessionId(): string | undefined {
		return this.chatWidgetService.lastFocusedWidget?.viewModel?.sessionResource?.toString();
	}

	private _onFocusedSessionChanged(): void {
		if (this._externalActiveSessionMode) {
			return;
		}
		const focused = this._getFocusedSessionId();
		if (focused) {
			const resource = URI.parse(focused);
			if (!this._omniInputOpen && (this._isConnected.get() || this._isConnecting.get())) {
				this.setTargetSession(resource);
			}
			this._activateShownSession(resource);
			return;
		}
		this._sendContext();
		this.voiceClientService.flushSessionContext();
	}

	private _trackWidgetSession(widget: IChatWidget): void {
		this._register(widget.onDidChangeViewModel(e => {
			this._rebindMaterializedSession(e.previousSessionResource, e.currentSessionResource);
			this._onSessionShown(e.currentSessionResource);
		}));
		this._onSessionShown(widget.viewModel?.sessionResource);
	}

	private _rebindMaterializedSession(previous: URI | undefined, current: URI | undefined): void {
		if (
			!previous
			|| !current
			|| previous.scheme !== current.scheme
			|| !previous.scheme.startsWith('agent-host-')
			|| !previous.path.replace(/^\//, '').startsWith('untitled-')
			|| current.path.replace(/^\//, '').startsWith('untitled-')
		) {
			return;
		}

		const from = previous.toString();
		const to = current.toString();
		const canonicalFrom = this._sessionKey(from);
		const target = this._targetSession.get();
		if (target && isEqual(target, previous)) {
			this._targetSession.set(current, undefined);
		}
		if (this._activeSessionShown === from) {
			this._activeSessionShown = to;
		}
		if (this._lastShownSessionId === from) {
			this._lastShownSessionId = to;
		}
		if (this._currentPlaybackSessionId === from) {
			this._currentPlaybackSessionId = to;
		}
		if (this._lastSpokenResponseSessionId === from) {
			this._lastSpokenResponseSessionId = to;
		}

		this._rekeySession(canonicalFrom, to);
		this._uiResourceByBackendId.set(from, to);
		const previousBackend = ((uri: any) => uri)(previous);
		if (previousBackend) {
			this._uiResourceByBackendId.set(previousBackend.toString(), to);
		}
		this._recordSessionAlias(current);
		this.logService.trace(`[voice] rebound materialized session ${from.slice(-32)} -> ${to.slice(-32)}`);
	}

	private _onSessionShown(resource: URI | undefined): void {
		if (this._externalActiveSessionMode) {
			return;
		}
		const key = resource?.toString();
		if (!key) {
			return;
		}
		if (key === this._lastShownSessionId && !this._pendingOwned(this._sessionKey(key))) {
			return;
		}
		this.logService.trace(`[voice] session shown=${key}; flushing/re-sending context`);
		this._activateShownSession(resource!);
	}

	private _activateShownSession(resource: URI): void {
		const key = resource.toString();
		this._lastShownSessionId = key;
		this._suspendPlaybackForHiddenSessions();
		this._recordSessionAlias(resource);
		if (!this._isConnected.get()) {
			this.logService.trace(`[voice] _activateShownSession(${key.slice(-32)}) skipped: controller not connected (external=${this._externalActiveSessionMode})`);
			return;
		}
		if (this._hasDraftTarget.get()) {
			this.logService.trace(`[voice] _activateShownSession(${key.slice(-32)}) skipped: Voice Mode belongs to a draft`);
			return;
		}
		const flushResult = this._flushDeferredResponse(key);
		this._clearConfirmationIndicator(key);
		if (this._confirmationDetailPending(resource)) {
			this._ensureModelLoaded(resource);
		}
		if (this._externalActiveSessionMode && !this._recentlyReadResponse.has(key)) {
			const heard = this._lastHeardTranscriptById.get(key);
			if (heard) {
				this._recentlyReadResponse.set(key, { transcript: heard, at: Date.now() });
			}
		}
		let narratable = this._currentNarratable(resource);
		const sessionKey = this._sessionKey(key);
		const pendingSummary = this._pendingResponseSummaries.get(sessionKey);
		const pendingSummaryFlushed = !!pendingSummary
			&& flushResult.finalTranscripts.includes(this._normalizeTranscript(pendingSummary));
		this.logService.trace(`[voice] activate shown=${key.slice(-32)} pendingKey=${this._pendingResponseSummaries.has(sessionKey) ? sessionKey.slice(-32) : '<none>'} narratable=${narratable?.kind ?? '<none>'} flushedFinal=${flushResult.finalTranscripts.length} pendingFlushed=${pendingSummaryFlushed}`);
		if (!narratable && pendingSummary && !pendingSummaryFlushed) {
			narratable = { kind: 'response', text: pendingSummary };
		}
		let handledResponse = pendingSummaryFlushed;
		this._sendContext();
		this.voiceClientService.flushSessionContext();
		if (narratable) {
			const wasJustPlayed = narratable.kind === 'response'
				&& flushResult.finalTranscripts.includes(this._normalizeTranscript(narratable.text));
			if (wasJustPlayed) {
				this._lastNarratedText.set(sessionKey, narratable.text);
				handledResponse = true;
			} else {
				const alreadyNarrated = narratable.kind === 'response'
					&& this._getLastNarratedText(key) === narratable.text;
				const pendingAlreadyHeard = narratable.kind !== 'response'
					&& this._narratedPending.get(sessionKey) === this._narratableIdentity(narratable);
				const staleResponse = narratable.kind === 'response'
					&& !this._pendingResponseSummaries.has(sessionKey);
				const bufferRetainedUnderPress = flushResult.retained === true
					&& narratable.kind === 'response'
					&& !!flushResult.retainedTranscript
					&& this._normalizeTranscript(narratable.text) === flushResult.retainedTranscript;
				if (pendingAlreadyHeard) {
					this.logService.trace(`[voice] activate skip: ${narratable.kind} already heard for ${key.slice(-32)}`);
				} else if (staleResponse) {
					this.logService.trace(`[voice] activate skip: stale response (no pending summary) for ${key.slice(-32)}`);
				} else if (bufferRetainedUnderPress) {
					this.logService.trace(`[voice] activate skip: buffered reply retained under held press for ${key.slice(-32)}`);
				} else {
					const deferred = this._deferredNarrations.get(sessionKey);
					if (deferred && this._narratableIdentity(deferred) === this._narratableIdentity(narratable)) {
						this._clearDeferred(sessionKey);
					}
					this._narrate(key, narratable.kind, narratable.text, undefined, undefined, narratable.confirmationType, narratable.pending);
				}
				if (narratable.kind === 'response') {
					handledResponse = handledResponse || alreadyNarrated;
				}
			}
		}
		if (handledResponse) {
			this._clearPendingResponse(sessionKey);
		}
	}

	private _narrate(sessionId: string, kind: VoiceNarrationKind, text: string, reuseId?: string, checkpoint?: IVoiceCheckpointNarrationMetadata, confirmationType?: VoiceConfirmationType, pending?: { pendingId: string }, fromOmniQueue = false): boolean {
		if (!text) {
			return false;
		}
		const sessionKey = this._sessionKey(sessionId);
		const identity = this._narratableIdentity({ text, pending, confirmationType });
		if (kind === 'response' && this._wasResponseHeard(sessionId, text)) {
			return false;
		}
		if (kind !== 'response' && kind !== 'checkpoint' && this._narratedPending.get(sessionKey) === identity) {
			return false;
		}
		for (const s of this._pendingSolicitedNarrations.values()) {
			if (s.kind === kind && this._narratableIdentity(s) === identity && this._sessionKey(s.sessionId) === sessionKey) {
				return false;
			}
		}
		if (!fromOmniQueue && kind !== 'checkpoint' && this._isOmniVoiceInboxActive() && this._shouldQueueOmniNarration()) {
			this._queueOmniNarration({ sessionId, kind, text, confirmationType, ...(pending ? { pending } : {}) });
			return false;
		}
		if (kind !== 'response' && kind !== 'checkpoint') {
			this._stopPendingNarration(sessionId);
		}
		if (kind !== 'response') {
			this._preemptCheckpointPlayback();
		}
		if (kind !== 'response' && kind !== 'checkpoint') {
			this._sendContext();
			this.voiceClientService.flushSessionContext();
		}
		this.logService.trace(`[voice] narrate kind=${kind} id=${sessionId.slice(-32)}`);
		const narrationId = this.voiceClientService.requestNarration(sessionId, kind, text, reuseId, checkpoint, confirmationType, pending);
		if (!narrationId) {
			if (kind === 'checkpoint') {
				return false;
			}
			this._pendingNarrationRetries.set(sessionId, { kind, text, confirmationType, pending });
			return false;
		}
		if (kind === 'checkpoint') {
			this.logService.trace(`[voice][checkpoint] requested narration_id=${narrationId} request_id=${checkpoint?.requestId ?? '<unknown>'} phase=${checkpoint?.checkpointId ?? '<unknown>'} sequence=${checkpoint?.sequence ?? 0} seed=${JSON.stringify(text)}`);
		}
		this._prepareForPlayback();
		this._pendingNarrationRetries.delete(sessionId);
		this._clearDeferred(sessionKey);
		if (this._solicitedNarrationIds.size >= 64) {
			const oldest = this._solicitedNarrationIds.values().next().value;
			if (oldest !== undefined) {
				this._solicitedNarrationIds.delete(oldest);
			}
		}
		this._solicitedNarrationIds.add(narrationId);
		if (this._isOmniVoiceInboxActive() || fromOmniQueue) {
			this._omniNarrationIds.add(narrationId);
		}
		const audioStartTimer = setTimeout(() => {
			this._handleSolicitedNarrationAudioStartTimeout(narrationId);
		}, VoiceSessionController._SOLICITED_NARRATION_AUDIO_START_TIMEOUT_MS);
		this._pendingSolicitedNarrations.set(narrationId, {
			sessionId,
			kind,
			text,
			pending,
			checkpoint,
			confirmationType,
			audioStartTimer,
			hasReceivedAudio: false,
		});
		return true;
	}

	private _shouldQueueOmniNarration(): boolean {
		return this._isUserActivelySpeaking()
			|| this.ttsPlaybackService.isPlaying
			|| this._currentPlaybackSessionId !== null
			|| this._audioQueue.length > 0
			|| this._omniDeferredSessionKeys.size > 0
			|| [...this._pendingSolicitedNarrations.values()].some(pending => pending.kind !== 'checkpoint')
			|| this._deferredNarrations.size > 0
			|| this._omniNarrationQueue.length > 0;
	}

	private _queueOmniNarration(item: Omit<IOmniQueuedNarration, 'ordinal'>): void {
		const sessionKey = this._sessionKey(item.sessionId);
		const identity = this._narratableIdentity(item);
		if (item.kind !== 'response') {
			for (let index = this._omniNarrationQueue.length - 1; index >= 0; index--) {
				const queued = this._omniNarrationQueue[index];
				if (queued.kind !== 'response' && this._sessionKey(queued.sessionId) === sessionKey) {
					this._omniNarrationQueue.splice(index, 1);
				}
			}
		}
		if (this._omniNarrationQueue.some(queued =>
			queued.kind === item.kind
			&& this._sessionKey(queued.sessionId) === sessionKey
			&& this._narratableIdentity(queued) === identity)) {
			return;
		}
		this._omniNarrationQueue.push({ ...item, ordinal: ++this._omniInboxOrdinal });
		this.logService.trace(`[voice] omni inbox queued kind=${item.kind} session=${sessionKey.slice(-32)} depth=${this._omniNarrationQueue.length}`);
	}

	private _drainOmniInbox(): void {
		if (!this._isOmniVoiceInboxActive() || this._isUserActivelySpeaking()) {
			return;
		}
		if (this.ttsPlaybackService.isPlaying
			|| this._currentPlaybackSessionId !== null
			|| this._audioQueue.length > 0
			|| [...this._pendingSolicitedNarrations.values()].some(pending => pending.kind !== 'checkpoint' && !pending.hasReceivedAudio)
			|| this._deferredNarrations.size > 0) {
			return;
		}
		while (this._omniNarrationQueue.length > 0 || this._omniDeferredSessionKeys.size > 0) {
			const nextNarration = this._omniNarrationQueue[0];
			const nextDeferredSession = [...this._omniDeferredSessionKeys]
				.map(sessionKey => ({ sessionKey, ordinal: this._omniDeferredSessionOrdinals.get(sessionKey) ?? Number.MAX_SAFE_INTEGER }))
				.sort((a, b) => a.ordinal - b.ordinal)[0];
			if (nextDeferredSession && (!nextNarration || nextDeferredSession.ordinal < nextNarration.ordinal)) {
				const result = this._flushDeferredResponse(nextDeferredSession.sessionKey);
				if (!result.retained) {
					this._omniDeferredSessionKeys.delete(nextDeferredSession.sessionKey);
					this._omniDeferredSessionOrdinals.delete(nextDeferredSession.sessionKey);
				}
				if (result.retained || this.ttsPlaybackService.isPlaying || this._currentPlaybackSessionId !== null || this._audioQueue.length > 0) {
					return;
				}
				continue;
			}
			const item = this._omniNarrationQueue.shift()!;
			let resource: URI | undefined;
			try {
				resource = URI.parse(item.sessionId);
			} catch {
				resource = undefined;
			}
			const current = resource ? this._currentNarratable(resource) : undefined;
			const itemIdentity = this._narratableIdentity(item);
			const sessionKey = this._sessionKey(item.sessionId);
			const cachedResponseStillCurrent = item.kind === 'response'
				&& this._omniClaimedResponseSummaries.get(sessionKey) === item.text;
			const cachedPendingStillCurrent = item.kind !== 'response'
				&& this._omniClaimedPendingIds.get(sessionKey) === itemIdentity;
			if ((!current || current.kind !== item.kind || this._narratableIdentity(current) !== itemIdentity) && !cachedResponseStillCurrent && !cachedPendingStillCurrent) {
				this.logService.trace(`[voice] omni inbox dropped stale kind=${item.kind} session=${this._sessionKey(item.sessionId).slice(-32)}`);
				continue;
			}
			const sent = this._narrate(item.sessionId, item.kind, item.text, undefined, undefined, item.confirmationType, item.pending, true);
			if (sent || this._pendingNarrationRetries.has(item.sessionId)) {
				return;
			}
		}
	}

	private _markSolicitedNarrationAudioStarted(narrationId: string | undefined): void {
		if (!narrationId) {
			return;
		}
		const pending = this._pendingSolicitedNarrations.get(narrationId);
		if (!pending || pending.hasReceivedAudio) {
			return;
		}
		pending.hasReceivedAudio = true;
		clearTimeout(pending.audioStartTimer);
	}

	private _handleSolicitedNarrationAudioStartTimeout(narrationId: string): void {
		const pending = this._pendingSolicitedNarrations.get(narrationId);
		if (!pending || pending.hasReceivedAudio) {
			return;
		}
		this._pendingSolicitedNarrations.delete(narrationId);
		this._solicitedNarrationIds.delete(narrationId);
		this._omniNarrationIds.delete(narrationId);
		if (this._awaitingReplyAudio || this._hasNarrationAwaitingAudio()) {
			this.logService.trace(`[voice] solicited narration ${narrationId.slice(0, 8)} timed out waiting for audio start; another response still expected, deferring state restore`);
			return;
		}
		this.logService.trace(`[voice] solicited narration ${narrationId.slice(0, 8)} timed out waiting for audio start; restoring idle state`);
		this._restoreVoiceStateAfterNarrationTimeout();
		queueMicrotask(() => this._drainOmniInbox());
	}

	private _hasNarrationAwaitingAudio(): boolean {
		for (const pending of this._pendingSolicitedNarrations.values()) {
			if (!pending.hasReceivedAudio) {
				return true;
			}
		}
		return false;
	}

	private _clearPendingSolicitedNarration(narrationId: string, pending: IPendingSolicitedNarration): void {
		clearTimeout(pending.audioStartTimer);
		this._pendingSolicitedNarrations.delete(narrationId);
	}

	private _notifyCheckpointPlaybackComplete(sessionId: string, narrationId: string, narration: IPlaybackNarration | undefined): void {
		if (narration?.kind === 'checkpoint' && narration.playbackId) {
			this.voiceClientService.sendNarrationPlaybackComplete(sessionId, narrationId, narration.playbackId);
		}
	}

	private _restoreVoiceStateAfterNarrationTimeout(): void {
		if (this.ttsPlaybackService.isPlaying || this._audioQueue.length > 0 || this._currentPlaybackSessionId !== null || this._pttHeld) {
			return;
		}
		if (this._isHandsFreeEnabled() && this._window && this._isConnected.get()) {
			this._enterAutoListen();
			return;
		}
		this._voiceState.set('idle', undefined);
		this._statusText.set('Hold to speak...', undefined);
	}

	private _markNarrationHeard(narrationId: string): void {
		const solicited = this._pendingSolicitedNarrations.get(narrationId);
		if (!solicited) {
			return;
		}
		this._clearPendingSolicitedNarration(narrationId, solicited);
		this._omniNarrationIds.delete(narrationId);
		const sessionKey = this._sessionKey(solicited.sessionId);
		if (solicited.kind === 'response') {
			this._lastNarratedText.set(sessionKey, solicited.text);
			this._clearPendingResponse(sessionKey);
			this._completeRoutedResponse(solicited.sessionId);
		} else if (solicited.kind !== 'checkpoint') {
			this._narratedPending.set(sessionKey, this._narratableIdentity(solicited));
			this.logService.trace(`[voice] pending item heard for ${sessionKey.slice(-32)}; marking occurrence spoken`);
		}
		queueMicrotask(() => this._drainOmniInbox());
	}

	private _completeRoutedResponse(sessionId: string): void {
		const sessionKey = this._sessionKey(sessionId);
		this._abandonedRoutedRequests.delete(sessionKey);
		if (this._routedRequests.delete(sessionKey)) {
			this.logService.trace(`[voice] completed routed response after playback session=${sessionKey.slice(-32)}`);
		}
	}

	private _resumeRoutedCompletionAfterPlayback(sessionId: string): void {
		const sessionKey = this._sessionKey(sessionId);
		const summary = this._pendingResponseSummaries.get(sessionKey);
		if (!summary) {
			return;
		}
		if (this._wasResponseHeard(sessionId, summary)) {
			this._clearPendingResponse(sessionKey);
			this._completeRoutedResponse(sessionId);
			return;
		}
		this._narrate(sessionId, 'response', summary);
	}

	private _handleNarrationAck(e: IVoiceNarrationAck): void {
		if (e.disposition === 'accepted') {
			return;
		}
		const key = this._sessionKey(e.codingSessionId);
		const solicited = this._pendingSolicitedNarrations.get(e.narrationId);
		if (solicited) {
			this._clearPendingSolicitedNarration(e.narrationId, solicited);
		}
		this._solicitedNarrationIds.delete(e.narrationId);
		if (e.disposition === 'invalid' || e.disposition === 'suppressed') {
			this._omniNarrationIds.delete(e.narrationId);
			this.logService.trace(`[voice] narration_ack ${e.disposition} id=${e.narrationId.slice(0, 8)} reason=${e.reason ?? '<none>'}; dropping`);
			this._clearDeferred(key);
			if (solicited) {
				this.telemetryService.publicLog2<VoiceNarrationDroppedEvent, VoiceNarrationDroppedClassification>('voiceNarrationDropped', { kind: solicited.kind, reason: e.disposition });
			}
			queueMicrotask(() => this._drainOmniInbox());
			return;
		}
		const kind = solicited?.kind;
		const text = solicited?.text;
		if (kind && text) {
			if (kind === 'checkpoint') {
				this.logService.trace(`[voice] narration_ack busy id=${e.narrationId.slice(0, 8)}; dropping checkpoint`);
				return;
			}
			this.logService.trace(`[voice] narration_ack busy id=${e.narrationId.slice(0, 8)} reason=${e.reason ?? '<none>'}; deferring`);
			this._deferredNarrations.set(key, { narrationId: e.narrationId, kind, text, reuseNarrationId: true, confirmationType: solicited.confirmationType, pending: solicited.pending });
			this.telemetryService.publicLog2<VoiceNarrationDeferredEvent, VoiceNarrationDeferredClassification>('voiceNarrationDeferred', { kind, reason: 'busy' });
		}
	}

	private _handleNarrationInterrupted(e: IVoiceNarrationSignal): void {
		const solicited = this._pendingSolicitedNarrations.get(e.narrationId);
		if (solicited) {
			if (solicited.kind === 'checkpoint') {
				this._preemptCheckpointPlayback(e.codingSessionId, e.narrationId);
				return;
			}
			this._deferInterruptedNarration(e.narrationId, solicited);
			this.logService.trace(`[voice] narration_interrupted id=${e.narrationId.slice(0, 8)}; deferring for revalidation`);
			this.telemetryService.publicLog2<VoiceNarrationDeferredEvent, VoiceNarrationDeferredClassification>('voiceNarrationDeferred', { kind: solicited.kind, reason: 'interrupted' });
		} else {
			this._solicitedNarrationIds.delete(e.narrationId);
		}
	}

	private _deferInterruptedNarration(narrationId: string, solicited: IPendingSolicitedNarration): void {
		this._clearPendingSolicitedNarration(narrationId, solicited);
		this._solicitedNarrationIds.delete(narrationId);
		this._omniNarrationIds.delete(narrationId);
		if (solicited.kind === 'checkpoint') {
			return;
		}
		this._deferredNarrations.set(this._sessionKey(solicited.sessionId), {
			narrationId,
			kind: solicited.kind,
			text: solicited.text,
			reuseNarrationId: false,
			pending: solicited.pending,
			confirmationType: solicited.confirmationType,
		});
	}

	private _retryDeferredNarration(sessionKey: string, unblockedNarrationId?: string): boolean {
		const deferred = this._deferredNarrations.get(sessionKey);
		if (!deferred) {
			this.logService.trace(`[voice] narration_unblocked for ${sessionKey.slice(-32)} but nothing deferred; nothing to retry`);
			return false;
		}
		if (unblockedNarrationId && deferred.narrationId !== unblockedNarrationId) {
			this.logService.trace(`[voice] narration_unblocked id=${unblockedNarrationId.slice(0, 8)} for ${sessionKey.slice(-32)} does not match currently deferred id=${deferred.narrationId.slice(0, 8)}; a newer entry superseded it, skipping`);
			return false;
		}
		let resource: URI | undefined;
		try {
			resource = URI.parse(sessionKey);
		} catch {
			resource = undefined;
		}
		const narratable = resource ? this._currentNarratable(resource) : undefined;
		if (!narratable
			|| narratable.kind !== deferred.kind
			|| narratable.text !== deferred.text
			|| (deferred.kind === 'confirmation' && narratable.confirmationType !== deferred.confirmationType)) {
			this.logService.trace(`[voice] deferred narration for ${sessionKey.slice(-32)} no longer warranted; dropping`);
			this._clearDeferred(sessionKey);
			this.telemetryService.publicLog2<VoiceNarrationDroppedEvent, VoiceNarrationDroppedClassification>('voiceNarrationDropped', { kind: deferred.kind, reason: 'stale' });
			queueMicrotask(() => this._drainOmniInbox());
			return false;
		}
		if (this._shouldDeferForSession(sessionKey)) {
			this.logService.trace(`[voice] deferred narration for ${sessionKey.slice(-32)} no longer shown; dropping`);
			this._clearDeferred(sessionKey);
			this.telemetryService.publicLog2<VoiceNarrationDroppedEvent, VoiceNarrationDroppedClassification>('voiceNarrationDropped', { kind: deferred.kind, reason: 'session_changed' });
			queueMicrotask(() => this._drainOmniInbox());
			return false;
		}
		const reuseId = deferred.reuseNarrationId && this._narratableIdentity(narratable) === this._narratableIdentity(deferred) ? deferred.narrationId : undefined;
		this.logService.trace(`[voice] retrying deferred narration for ${sessionKey.slice(-32)} reuse=${!!reuseId}`);
		this._clearDeferred(sessionKey);
		return this._narrate(sessionKey, narratable.kind, narratable.text, reuseId, undefined, narratable.confirmationType, narratable.pending);
	}

	private _retryPendingNarration(sessionId: string, pending: IVoiceNarratable): boolean {
		let resource: URI;
		try {
			resource = URI.parse(sessionId);
		} catch {
			this.logService.trace(`[voice] queued confirmation for invalid session id; dropping`);
			return false;
		}
		const current = this._currentNarratable(resource);
		if (!current
			|| current.kind !== pending.kind
			|| this._narratableIdentity(current) !== this._narratableIdentity(pending)) {
			this.logService.trace(`[voice] queued narration for ${sessionId.slice(-32)} no longer matches current state; dropping`);
			return false;
		}
		if (current.kind !== 'response' && this._shouldDeferForSession(this._sessionKey(sessionId))) {
			this.logService.trace(`[voice] queued narration for ${sessionId.slice(-32)} is no longer shown; dropping`);
			return false;
		}
		return this._narrate(sessionId, current.kind, current.text, undefined, undefined, current.confirmationType, current.pending);
	}

	private _clearDeferred(sessionKey: string): void {
		this._deferredNarrations.delete(sessionKey);
	}

	private _currentNarratable(resource: URI): IVoiceNarratable | undefined {
		const model = this.chatService.getSession(resource);
		if (model) {
			const question = this._questionNarratable(model);
			if (question) {
				return question;
			}
			const info = this._getAgentStateInfo(model);
			if (info.state === 'waiting_for_confirmation' && info.detail) {
				const pending = this._pendingNarrationReference(model);
				return { kind: 'confirmation', text: info.detail, confirmationType: info.confirmation_type, ...(pending ? { pending } : {}) };
			}
			if (info.state === 'idle' && info.last_response_summary) {
				return { kind: 'response', text: info.last_response_summary };
			}
			return undefined;
		}
		const session: any = undefined;
		if (session?.status === false) {
			this._ensureModelLoaded(resource);
			return undefined;
		}
		if (session?.status === false) {
			const summary = this._lastResponseSummaryById.get(resource.toString());
			if (summary) {
				return { kind: 'response', text: summary };
			}
			this._ensureModelLoaded(resource);
			return undefined;
		}
		return undefined;
	}

	private _pendingIdFor(sessionId: string): string {
		const selected = this._selectPendingPart(this._modelForSession(sessionId));
		return selected ? derivePendingId(selected.requestId, selected.part, this._store) : '';
	}

	private _narratableIdentity(narratable: { text: string; pending?: { pendingId: string }; confirmationType?: VoiceConfirmationType }): string {
		return narratable.pending ? `#${narratable.pending.pendingId}` : `${narratable.confirmationType ?? ''}:${narratable.text}`;
	}

	private _questionNarratable(model: IChatModel | undefined | null): { kind: 'question'; text: string; pending: { pendingId: string } } | undefined {
		const pending = model ? this._buildPendingPayload(model) : undefined;
		const question = pending?.type === 'questions' ? pending.questions?.[0] : undefined;
		if (!pending || !question) {
			return undefined;
		}
		return {
			kind: 'question',
			text: formatQuestionPrompt(question, pending.allow_skip === true),
			pending: { pendingId: pending.pending_id },
		};
	}

	private _pendingNarrationReference(model: IChatModel | undefined | null): { pendingId: string } | undefined {
		const pending = model ? this._buildPendingPayload(model) : undefined;
		return pending ? { pendingId: pending.pending_id } : undefined;
	}

	private _confirmationDetailPending(resource: URI): boolean {
		const session: any = undefined;
		if (!session || session.status !== false) {
			return false;
		}
		const model = this.chatService.getSession(resource);
		if (!model) {
			return true;
		}
		const info = this._getAgentStateInfo(model);
		return info.state !== 'waiting_for_confirmation' || !info.detail;
	}

	private _getActiveSessionId(): string | undefined {
		if (this._hasDraftTarget.get()) {
			return undefined;
		}
		if (this._externalActiveSessionMode) {
			return this._targetSession.get()?.toString() ?? this._activeSessionShown;
		}
		return this._targetSession.get()?.toString() ?? this._activeSessionShown ?? this._lastShownSessionId ?? this._getFocusedSessionId();
	}

	private _shownSessionId(): string | undefined {
		if (this._externalActiveSessionMode) {
			return this._activeSessionShown;
		}
		return this._getFocusedSessionId();
	}

	private _pinActiveSessionAsTarget(): void {
		if ((this._isConnected.get() || this._isConnecting.get()) && this._activeSessionShown && !this._targetSession.get() && !this._hasDraftTarget.get()) {
			this._targetSession.set(URI.parse(this._activeSessionShown), undefined);
		}
	}

	setActiveSessionShown(resource: URI | null | undefined): void {
		const key = resource?.toString();
		if (resource === null) {
			this._pinActiveSessionAsTarget();
			if (!this._targetSession.get()) {
				this._hasDraftTarget.set(true, undefined);
			}
			this.logService.trace(`[voice] setActiveSessionShown=<draft> (was ${this._activeSessionShown ?? '<none>'})`);
			this._externalActiveSessionMode = true;
			this._activeSessionShown = undefined;
			this._suspendPlaybackForHiddenSessions();
			return;
		}
		if (resource === undefined) {
			if (!this._externalActiveSessionMode && this._activeSessionShown === undefined) {
				return;
			}
			this._pinActiveSessionAsTarget();
			this.logService.trace(`[voice] setActiveSessionShown=<none>; restoring focus-based detection (was ${this._activeSessionShown ?? '<none>'})`);
			this._externalActiveSessionMode = false;
			this._activeSessionShown = undefined;
			this._hasDraftTarget.set(false, undefined);
			this._onFocusedSessionChanged();
			return;
		}
		this._externalActiveSessionMode = true;
		const definedKey = key!;
		if (this._isSameSession(definedKey, this._activeSessionShown)) {
			const sessionKey = this._sessionKey(definedKey);
			if (this._pendingOwned(sessionKey)) {
				this.logService.trace(`[voice] re-pinned active session=${definedKey} has pending voice work; re-activating`);
				this._activateShownSession(resource);
			}
			return;
		}
		this._pinActiveSessionAsTarget();
		this.logService.trace(`[voice] setActiveSessionShown=${definedKey} (was ${this._activeSessionShown ?? '<none>'})`);
		this._activeSessionShown = definedKey;
		this._suspendPlaybackForHiddenSessions();
		this._activateShownSession(resource);
	}

	activateSession(resource: URI): void {
		const key = resource.toString();
		this.logService.trace(`[voice] activateSession=${key} (explicit UI action)`);
		if (this._externalActiveSessionMode) {
			this._activeSessionShown = key;
		}
		this._activateShownSession(resource);
	}

	private _shouldDeferResponseStream(responseId: string | undefined, sessionId: string | undefined, isFirstChunk: boolean): boolean {
		if (!responseId) {
			return this._shouldDeferResponse(sessionId, isFirstChunk);
		}
		const known = this._responseRoutes.get(responseId);
		if (known !== undefined) {
			if (known === 'live' && this._shouldDeferForSession(sessionId)) {
				this._responseRoutes.set(responseId, 'deferred');
				return true;
			}
			return known === 'deferred';
		}
		const defer = this._shouldDeferForSession(sessionId);
		this._responseRoutes.set(responseId, defer ? 'deferred' : 'live');
		return defer;
	}

	private _isSameSession(a: string | undefined, b: string | undefined): boolean {
		if (!a || !b) {
			return false;
		}
		if (a === b || this._canonicalSessionId(a) === this._canonicalSessionId(b)) {
			return true;
		}
		try {
			return isEqual(URI.parse(a), URI.parse(b));
		} catch {
			return false;
		}
	}

	private _getLastNarratedText(sessionId: string): string | undefined {
		return this._lastNarratedText.get(this._sessionKey(sessionId));
	}

	private _wasResponseHeard(sessionId: string, text: string): boolean {
		if (this._getLastNarratedText(sessionId) === text) {
			return true;
		}
		const heard = this._lastHeardTranscriptById.get(this._sessionKey(sessionId));
		const requested = this._normalizeTranscript(text);
		return !!heard && !!requested && (heard === requested || heard.startsWith(requested) || requested.startsWith(heard));
	}

	private _clearLastNarratedText(sessionId: string): void {
		this._lastNarratedText.delete(this._sessionKey(sessionId));
	}

	private _isOmniRoutedSession(sessionId: string | undefined): boolean {
		if (!sessionId) {
			return false;
		}
		const sessionKey = this._sessionKey(sessionId);
		return (this._routedRequests.has(sessionKey) && !this._abandonedRoutedRequests.has(sessionKey))
			|| (!!this._targetOmniRoute && this._isSameSession(this._targetSession.get()?.toString(), sessionId));
	}

	private _isOmniVoiceInboxActive(): boolean {
		return this._omniInputOpen && this._isConnected.get();
	}

	private _shouldDeferForSession(sessionId: string | undefined): boolean {
		if (!sessionId) {
			return false;
		}
		if (this._isOmniVoiceInboxActive()) {
			return false;
		}
		return !this._isOmniRoutedSession(sessionId) && !this._isSameSession(this._shownSessionId(), sessionId);
	}

	private _deferredBufferHasResponse(sessionId: string, responseId: string | undefined): boolean {
		if (!responseId) {
			return false;
		}
		return this._deferredResponses.get(sessionId)?.some(r => r.responseId === responseId) ?? false;
	}

	private _shouldDeferResponse(sessionId: string | undefined, isFirstChunk: boolean): boolean {
		const key = sessionId ? this._sessionKey(sessionId) : '';
		if (isFirstChunk) {
			if (!sessionId) {
				this._liveReplyKeys.add(key);
				return false;
			}
			if (!this._shouldDeferForSession(sessionId)) {
				this._liveReplyKeys.add(key);
				return false;
			}
			this._liveReplyKeys.delete(key);
			return true;
		}

		if (this._deferredResponses.has(key)) {
			return true;
		}
		if (this._liveReplyKeys.has(key)) {
			if (this._shouldDeferForSession(sessionId)) {
				this._liveReplyKeys.delete(key);
				return true;
			}
			return false;
		}
		return this._shouldDeferForSession(sessionId);
	}

	private _deferResponse(sessionId: string, audio: string, isFirstChunk: boolean, isFinal: boolean, transcript: string | undefined, responseId?: string, turnId?: string): void {
		const key = this._sessionKey(sessionId);
		let responses = this._deferredResponses.get(key);
		if (!responses) {
			responses = [];
			this._deferredResponses.set(key, responses);
		}
		let response: IDeferredResponse | undefined;
		if (!isFirstChunk) {
			response = responseId
				? responses.find(r => r.responseId === responseId)
				: [...responses].reverse().find(r => !r.finalized);
		}
		if (!response) {
			response = { responseId, turnId, finalized: false, chunks: [] };
			responses.push(response);
			this._markPendingResponse(key, true);
			this.logService.trace(`[voice] deferring response for unfocused session=${key} (buffered=${responses.length}); showing pending indicator`);
		}
		response.chunks.push({ audio, isFirstChunk, isFinal, transcript });
		if (isFinal) {
			response.finalized = true;
		}
	}

	private _matchDeferredKey(sessionId: string): string | undefined {
		const key = this._sessionKey(sessionId);
		if (this._deferredResponses.has(key)) {
			return key;
		}
		if (this._deferredResponses.size === 0) {
			return undefined;
		}
		let focusedUri: URI | undefined;
		try { focusedUri = URI.parse(key); } catch { focusedUri = undefined; }
		if (focusedUri) {
			for (const candidate of this._deferredResponses.keys()) {
				try {
					if (isEqual(URI.parse(candidate), focusedUri)) { return candidate; }
				} catch { }
			}
		}
		return undefined;
	}

	private _flushDeferredResponse(sessionId: string): IDeferredFlushResult {
		const key = this._matchDeferredKey(sessionId);
		if (!key) {
			if (this._deferredResponses.size > 0) {
				this.logService.trace(`[voice] no buffered response matches focused=${sessionId}; pending keys=[${[...this._deferredResponses.keys()].join(', ')}]`);
			}
			return { flushed: false, finalTranscripts: [] };
		}
		const responses = this._deferredResponses.get(key);
		if (!responses || responses.length === 0) {
			this._deferredResponses.delete(key);
			this._maybeHideIndicator(key);
			return { flushed: false, finalTranscripts: [] };
		}

		if (!this._prepareForPlayback()) {
			this.logService.trace(`[voice] deferred flush for session=${key} deferred: held deliberate press preserved, keeping ${responses.length} buffered response(s)`);
			const retainedFinals = responses
				.map(r => this._normalizeTranscript([...r.chunks].reverse().find(c => c.transcript)?.transcript ?? ''))
				.filter(t => !!t);
			return { flushed: false, retained: true, retainedTranscript: retainedFinals[retainedFinals.length - 1], finalTranscripts: [] };
		}

		this._deferredResponses.delete(key);
		this._maybeHideIndicator(key);
		const totalChunks = responses.reduce((n, r) => n + r.chunks.length, 0);
		this.logService.trace(`[voice] flushing ${responses.length} buffered response(s) (${totalChunks} chunk(s)) for now-focused session=${key}`);
		for (const r of responses) {
			if (r.responseId && !r.finalized) {
				this._responseRoutes.set(r.responseId, 'live');
			}
		}
		const finalTranscripts = responses
			.map(r => this._normalizeTranscript([...r.chunks].reverse().find(c => c.transcript)?.transcript ?? ''))
			.filter(t => !!t);
		const flushedTranscript = finalTranscripts[finalTranscripts.length - 1];
		if (flushedTranscript) {
			this._recentlyReadResponse.set(key, { transcript: flushedTranscript, at: Date.now() });
			this._lastHeardTranscriptById.set(key, flushedTranscript);
		}

		for (const r of responses) {
			for (const chunk of r.chunks) {
				this._enqueueAudio(key, chunk.audio, chunk.isFirstChunk, chunk.isFinal, chunk.transcript, r.responseId);
			}
		}
		return { flushed: true, finalTranscripts };
	}

	private _isUserActivelySpeaking(): boolean {
		return this._pttHeld && (!this._pttCurrentTurnPassive || this._speechDetectedInTurn);
	}

	private _prepareForPlayback(): boolean {
		this._clearAutoListenTimer();
		this._autoListenSuppressed = false;
		if (this._isUserActivelySpeaking()) {
			return false;
		}
		if (this._pttHeld) {
			this._finishPtt('auto', 'internal');
		}
		this._pttToggleMode = false;
		this._pttHeld = false;
		this._suppressIncomingAudio = false;
		if (!this.ttsPlaybackService.isPlaying && this._currentPlaybackSessionId !== null) {
			this._currentPlaybackSessionId = null;
		}
		return true;
	}

	private _isRenarration(responseId: string | undefined, sessionId: string | undefined, transcript: string | undefined, isFirstChunk: boolean, isFinal: boolean): boolean {
		if (!sessionId) {
			return false;
		}
		const dropKey = responseId ?? sessionId;
		if (responseId && this._solicitedNarrationIds.has(responseId)) {
			if (isFinal) {
				this._solicitedNarrationIds.delete(responseId);
			}
			return false;
		}
		if (!isFirstChunk && this._droppingRenarration.has(dropKey)) {
			if (isFinal) {
				this._droppingRenarration.delete(dropKey);
			}
			return true;
		}
		if (!isFirstChunk) {
			return false;
		}
		const sessionKey = this._sessionKey(sessionId);
		const heard = this._lastHeardTranscriptById.get(sessionKey) ?? this._recentlyReadResponse.get(sessionKey)?.transcript;
		if (heard === undefined) {
			return false;
		}
		const incoming = this._normalizeTranscript(transcript ?? '');
		if (!incoming || !(heard === incoming || heard.startsWith(incoming))) {
			return false;
		}
		this._liveReplyKeys.delete(sessionId);
		if (!isFinal) {
			this._droppingRenarration.add(dropKey);
		}
		return true;
	}

	private _normalizeTranscript(text: string): string {
		return text.toLowerCase().replace(/\s+/g, ' ').replace(/^[\s.,!?;:'"]+|[\s.,!?;:'"]+$/g, '').trim();
	}

	private _markPendingResponse(sessionId: string, pending: boolean): void {
		try {
			this.voicePlaybackService.setPendingResponse(URI.parse(sessionId), pending && !this._isOmniVoiceInboxActive());
		} catch {
		}
	}

	private _reconcileConfirmationIndicators(waitingSessionIds: Set<string>): void {
		const omniTarget = this._targetOmniRoute ? this._targetSession.get()?.toString() : undefined;
		const activeId = omniTarget ?? (this._externalActiveSessionMode
			? this._activeSessionShown
			: this._getFocusedSessionId());
		const activeKey = activeId ? this._sessionKey(activeId) : undefined;
		const waitingKeys = new Set<string>();
		for (const sessionId of waitingSessionIds) {
			const key = this._sessionKey(sessionId);
			waitingKeys.add(key);
			const pendingIdentity = this._pendingIdentityForSession(sessionId);
			if (this._abandonedRoutedRequests.has(key)) {
				this._omniClaimedPendingIds.set(key, pendingIdentity);
				this._clearConfirmationIndicator(key);
				continue;
			}
			if (this._isOmniVoiceInboxActive()) {
				this._omniClaimedPendingIds.set(key, pendingIdentity);
				this._clearConfirmationIndicator(key);
				continue;
			}
			const claimedIdentity = this._omniClaimedPendingIds.get(key);
			if (claimedIdentity === pendingIdentity) {
				this._clearConfirmationIndicator(key);
				continue;
			}
			if (claimedIdentity !== undefined) {
				this._omniClaimedPendingIds.delete(key);
			}
			if (key === activeKey) {
				this._clearConfirmationIndicator(key);
				continue;
			}
			if (!this._confirmationPendingSessions.has(key)) {
				this._confirmationPendingSessions.add(key);
				this._markPendingResponse(key, true);
			}
		}
		for (const key of [...this._confirmationPendingSessions]) {
			if (waitingKeys.has(key) && key !== activeKey) {
				continue;
			}
			this._clearConfirmationIndicator(key);
		}
		for (const key of [...this._omniClaimedPendingIds.keys()]) {
			if (!waitingKeys.has(key)) {
				this._omniClaimedPendingIds.delete(key);
			}
		}
	}

	private _pendingIdentityForSession(sessionId: string): string {
		let resource: URI | undefined;
		try {
			resource = URI.parse(sessionId);
		} catch {
			resource = undefined;
		}
		const narratable = resource ? this._currentNarratable(resource) : undefined;
		if (narratable && narratable.kind !== 'response') {
			return this._narratableIdentity(narratable);
		}
		const pendingId = this._pendingIdFor(sessionId);
		return pendingId ? `#${pendingId}` : '@waiting';
	}

	private _clearConfirmationIndicator(sessionId: string): void {
		const key = this._sessionKey(sessionId);
		if (this._confirmationPendingSessions.delete(key)) {
			this._maybeHideIndicator(key);
		}
	}

	private _clearPendingResponse(sessionId: string): void {
		const key = this._sessionKey(sessionId);
		if (this._pendingResponseSummaries.delete(key)) {
			this._maybeHideIndicator(key);
		}
	}

	private _maybeHideIndicator(sessionId: string): void {
		const key = this._sessionKey(sessionId);
		if (this._pendingOwned(key)) {
			return;
		}
		this._markPendingResponse(key, false);
	}

	private _pendingVoiceIndicatorKeys(): Set<string> {
		return new Set([
			...this._confirmationPendingSessions,
			...this._deferredResponses.keys(),
			...this._pendingResponseSummaries.keys(),
		]);
	}

	private _releaseOmniInboxToPanel(): void {
		const releasedSessionKeys = new Set<string>([
			...this._omniNarrationQueue.map(item => this._sessionKey(item.sessionId)),
			...this._omniDeferredSessionKeys,
			...this._omniClaimedPendingIds.keys(),
			...this._omniClaimedResponseSummaries.keys(),
		]);
		for (const sessionKey of this._routedRequests.keys()) {
			releasedSessionKeys.add(sessionKey);
			this._routedRequests.delete(sessionKey);
			this._abandonedRoutedRequests.delete(sessionKey);
		}
		for (const item of this._omniNarrationQueue) {
			const sessionKey = this._sessionKey(item.sessionId);
			if (item.kind === 'response') {
				this._pendingResponseSummaries.set(sessionKey, item.text);
			} else {
				this._confirmationPendingSessions.add(sessionKey);
			}
		}
		for (const sessionKey of this._omniClaimedPendingIds.keys()) {
			this._confirmationPendingSessions.add(sessionKey);
		}
		for (const [sessionKey, summary] of this._omniClaimedResponseSummaries) {
			this._pendingResponseSummaries.set(sessionKey, summary);
		}

		const releasedResponseIds = new Set(this._omniNarrationIds);
		for (const responseId of releasedResponseIds) {
			const pending = this._pendingSolicitedNarrations.get(responseId);
			if (pending) {
				const sessionKey = this._sessionKey(pending.sessionId);
				releasedSessionKeys.add(sessionKey);
				if (pending.kind === 'response') {
					this._pendingResponseSummaries.set(sessionKey, pending.text);
				} else {
					this._confirmationPendingSessions.add(sessionKey);
				}
				this._clearPendingSolicitedNarration(responseId, pending);
			}
			this._solicitedNarrationIds.delete(responseId);
			this._responseRoutes.delete(responseId);
			this._rememberInterruptedAudioId(responseId);
		}
		for (const key of this._omniDeferredSessionKeys) {
			for (const response of this._deferredResponses.get(key) ?? []) {
				if (response.responseId) {
					releasedResponseIds.add(response.responseId);
					this._rememberInterruptedAudioId(response.responseId);
				}
			}
		}
		for (let index = this._audioQueue.length - 1; index >= 0; index--) {
			const queued = this._audioQueue[index];
			const ownedSession = queued.sessionId && releasedSessionKeys.has(this._sessionKey(queued.sessionId));
			if ((queued.responseId && releasedResponseIds.has(queued.responseId)) || ownedSession) {
				this._audioQueue.splice(index, 1);
			}
		}
		const activeOwned = (this._currentPlaybackResponseId && releasedResponseIds.has(this._currentPlaybackResponseId))
			|| (this._currentPlaybackSessionId && releasedSessionKeys.has(this._sessionKey(this._currentPlaybackSessionId)));
		if (activeOwned) {
			this._rememberInterruptedAudioId(this._currentPlaybackResponseId);
			this._stopCurrentPlaybackAsInterrupted();
		}

		for (const sessionKey of releasedSessionKeys) {
			this._deferredNarrations.delete(sessionKey);
			if (this._pendingOwned(sessionKey)) {
				this._markPendingResponse(sessionKey, true);
			}
		}
		for (const sessionId of [...this._pendingNarrationRetries.keys()]) {
			if (releasedSessionKeys.has(this._sessionKey(sessionId))) {
				this._pendingNarrationRetries.delete(sessionId);
			}
		}
		this._omniNarrationQueue.length = 0;
		this._omniDeferredSessionKeys.clear();
		this._omniDeferredSessionOrdinals.clear();
		this._omniClaimedPendingIds.clear();
		this._omniClaimedResponseSummaries.clear();
		this._omniNarrationIds.clear();
		this.logService.trace(`[voice] released omni inbox to panel sessions=${releasedSessionKeys.size} responses=${releasedResponseIds.size}`);
	}

	private _clearDeferredResponses(): void {
		for (const key of this._deferredResponses.keys()) {
			this._markPendingResponse(key, false);
		}
		this._deferredResponses.clear();
		this._responseRoutes.clear();
		this._responseSessionIds.clear();
		this._ownershipDroppedResponseIds.clear();
		for (const key of this._confirmationPendingSessions) {
			this._markPendingResponse(key, false);
		}
		this._confirmationPendingSessions.clear();
		for (const key of this._pendingResponseSummaries.keys()) {
			this._markPendingResponse(key, false);
		}
		this._pendingResponseSummaries.clear();
	}


	private _suspendPlaybackForHiddenSessions(): void {
		const hiddenQueue: IQueuedAudioResponse[] = [];
		for (let i = this._audioQueue.length - 1; i >= 0; i--) {
			const queued = this._audioQueue[i];
			if (!queued.sessionId || !this._shouldDeferForSession(queued.sessionId)) {
				continue;
			}
			this._audioQueue.splice(i, 1);
			hiddenQueue.unshift(queued);
		}
		for (const queued of hiddenQueue) {
			const sessionId = queued.sessionId;
			if (!sessionId) {
				continue;
			}
			if (queued.narration?.kind === 'checkpoint') {
				this._preemptCheckpointPlayback(sessionId, queued.responseId, false);
				continue;
			}
			for (const chunk of queued.chunks) {
				this._deferResponse(sessionId, chunk.audio, chunk.isFirstChunk, chunk.isFinal, chunk.transcript, queued.responseId);
			}
		}

		const playingSession = this._currentPlaybackSessionId;
		if (playingSession && this._shouldDeferForSession(playingSession)) {
			this._stopCurrentPlaybackAsInterrupted();
		}
	}

	private _preemptCheckpointPlayback(sessionId?: string, targetNarrationId?: string, stopActivePlayback = true): void {
		const sessionKey = sessionId ? this._sessionKey(sessionId) : undefined;
		const shouldPreempt = (candidateSessionId: string | undefined, candidateNarrationId: string | undefined, narration: IPlaybackNarration | undefined) => {
			return narration?.kind === 'checkpoint'
				&& (targetNarrationId === undefined || candidateNarrationId === targetNarrationId)
				&& (sessionKey === undefined || (candidateSessionId !== undefined && this._sessionKey(candidateSessionId) === sessionKey));
		};

		const interruptedIds = new Set<string>();
		for (let i = this._audioQueue.length - 1; i >= 0; i--) {
			const queued = this._audioQueue[i];
			if (!shouldPreempt(queued.sessionId, queued.responseId, queued.narration)) {
				continue;
			}
			if (queued.responseId) {
				interruptedIds.add(queued.responseId);
			}
			this._audioQueue.splice(i, 1);
		}
		for (const [candidateNarrationId, pending] of this._pendingSolicitedNarrations) {
			if (pending.kind !== 'checkpoint'
				|| (targetNarrationId !== undefined && candidateNarrationId !== targetNarrationId)
				|| (sessionKey !== undefined && this._sessionKey(pending.sessionId) !== sessionKey)) {
				continue;
			}
			interruptedIds.add(candidateNarrationId);
			this._clearPendingSolicitedNarration(candidateNarrationId, pending);
			this._solicitedNarrationIds.delete(candidateNarrationId);
		}
		for (const narrationId of interruptedIds) {
			this._rememberInterruptedAudioId(narrationId);
		}

		const activeCheckpointMatches = shouldPreempt(this._currentPlaybackSessionId ?? undefined, this._currentPlaybackResponseId, this._currentPlaybackNarration);
		if (activeCheckpointMatches && this._currentPlaybackResponseId) {
			this._rememberInterruptedAudioId(this._currentPlaybackResponseId);
		}
		if (activeCheckpointMatches && stopActivePlayback) {
			this._stopCurrentPlaybackAsInterrupted();
		}
	}

	private _interruptAssistantPlayback(): void {
		const interruptedSessionId = this._currentPlaybackSessionId ?? this._shownSessionId();
		if (interruptedSessionId) {
			this._cancelVoiceProgress(interruptedSessionId);
		}
		this._preemptCheckpointPlayback(undefined, undefined, false);
		this._rememberInterruptedPlaybackIds();
		this._telemetryTtsInterrupted = this._telemetryTtsInterrupted || this.ttsPlaybackService.isPlaying;
		this._audioQueue.length = 0;
		this._currentPlaybackSessionId = null;
		this._currentPlaybackFinalized = false;
		this._isProcessingQueue = false;
		this._suppressIncomingAudio = true;
		this.ttsPlaybackService.stopPlayback();
		this._currentPlaybackResponseId = undefined;
		this._currentPlaybackNarration = undefined;
		this.voicePlaybackService.notifyPlaybackEnd(undefined);
	}

	private _stopCurrentPlaybackAsInterrupted(): void {
		if (this.ttsPlaybackService.isPlaying) {
			this._telemetryTtsInterrupted = true;
			this.ttsPlaybackService.stopPlayback();
			return;
		}

		this.ttsPlaybackService.stopPlayback();
		this._telemetryTtsInterrupted = false;
		this._currentPlaybackSessionId = null;
		this._currentPlaybackResponseId = undefined;
		this._currentPlaybackNarration = undefined;
		this._currentPlaybackFinalized = false;
		this.voicePlaybackService.notifyPlaybackEnd(undefined);
		if (this._audioQueue.length > 0) {
			if (!this._isProcessingQueue) {
				this._processQueue();
			}
		} else {
			this._restoreVoiceStateAfterNarrationTimeout();
		}
	}

	private _stopPendingNarration(sessionId: string): void {
		const sessionKey = this._sessionKey(sessionId);
		for (let index = this._omniNarrationQueue.length - 1; index >= 0; index--) {
			const queued = this._omniNarrationQueue[index];
			if (queued.kind !== 'response' && this._sessionKey(queued.sessionId) === sessionKey) {
				this._omniNarrationQueue.splice(index, 1);
			}
		}
		const cancelledIds = new Set<string>();
		for (const [narrationId, pending] of this._pendingSolicitedNarrations) {
			if (pending.kind !== 'response' && this._sessionKey(pending.sessionId) === sessionKey) {
				cancelledIds.add(narrationId);
				this._clearPendingSolicitedNarration(narrationId, pending);
			}
		}
		if (cancelledIds.size === 0) {
			queueMicrotask(() => this._drainOmniInbox());
			return;
		}
		for (let i = this._audioQueue.length - 1; i >= 0; i--) {
			const responseId = this._audioQueue[i].responseId;
			if (responseId !== undefined && cancelledIds.has(responseId)) {
				this._audioQueue.splice(i, 1);
			}
		}
		for (const id of cancelledIds) {
			if (this._cancelledPendingNarrationIds.size >= 64) {
				const oldest = this._cancelledPendingNarrationIds.values().next().value;
				if (oldest !== undefined) {
					this._cancelledPendingNarrationIds.delete(oldest);
				}
			}
			this._cancelledPendingNarrationIds.add(id);
		}
		for (const [key, responses] of this._deferredResponses) {
			const kept = responses.filter(r => r.responseId === undefined || !cancelledIds.has(r.responseId));
			if (kept.length === responses.length) {
				continue;
			}
			if (kept.length === 0) {
				this._deferredResponses.delete(key);
			} else {
				this._deferredResponses.set(key, kept);
			}
			this._maybeHideIndicator(key);
		}
		for (const id of cancelledIds) {
			this._responseRoutes.delete(id);
		}
		if (this._currentPlaybackResponseId !== undefined && cancelledIds.has(this._currentPlaybackResponseId)) {
			this._stopCurrentPlaybackAsInterrupted();
		}
		queueMicrotask(() => this._drainOmniInbox());
	}

	private _discardResponsesSupersededByPending(sessionId: string): void {
		const sessionKey = this._sessionKey(sessionId);
		const discardedIds = new Set<string>();
		for (const [narrationId, pending] of this._pendingSolicitedNarrations) {
			if (pending.kind === 'response' && this._sessionKey(pending.sessionId) === sessionKey) {
				discardedIds.add(narrationId);
				this._clearPendingSolicitedNarration(narrationId, pending);
				this._solicitedNarrationIds.delete(narrationId);
			}
		}
		for (let i = this._audioQueue.length - 1; i >= 0; i--) {
			const queued = this._audioQueue[i];
			if (queued.sessionId && this._sessionKey(queued.sessionId) === sessionKey && queued.narration?.kind !== 'confirmation' && queued.narration?.kind !== 'question') {
				if (queued.responseId) {
					discardedIds.add(queued.responseId);
				}
				this._audioQueue.splice(i, 1);
			}
		}
		const deferred = this._deferredResponses.get(sessionKey);
		if (deferred) {
			for (const response of deferred) {
				if (response.responseId) {
					discardedIds.add(response.responseId);
				}
			}
			this._deferredResponses.delete(sessionKey);
		}
		for (const id of discardedIds) {
			this._rememberInterruptedAudioId(id);
		}
		this._clearPendingResponse(sessionKey);
		this._clearDeferred(sessionKey);
		this._lastResponseSummaryById.delete(sessionKey);
		this._sessionAudioCache.delete(sessionKey);
		this._maybeHideIndicator(sessionKey);

		const activeIsSupersededResponse = this._currentPlaybackSessionId !== null
			&& this._currentPlaybackSessionId !== undefined
			&& this._sessionKey(this._currentPlaybackSessionId) === sessionKey
			&& this._currentPlaybackNarration?.kind !== 'confirmation'
			&& this._currentPlaybackNarration?.kind !== 'question';
		if (activeIsSupersededResponse) {
			this._rememberInterruptedAudioId(this._currentPlaybackResponseId);
			this._stopCurrentPlaybackAsInterrupted();
		}
	}

	private _hasResponseAudioInFlight(sessionId: string): boolean {
		const sessionKey = this._sessionKey(sessionId);
		const isResponseForSession = (candidateSessionId: string | undefined, narration: IPlaybackNarration | undefined) =>
			!!candidateSessionId
			&& this._sessionKey(candidateSessionId) === sessionKey
			&& (narration === undefined || narration.kind === 'response');
		return isResponseForSession(this._currentPlaybackSessionId ?? undefined, this._currentPlaybackNarration)
			|| this._audioQueue.some(queued => isResponseForSession(queued.sessionId, queued.narration));
	}

	private _enqueueAudio(sessionId: string | undefined, audio: string, isFirstChunk: boolean, isFinal: boolean, transcript: string | undefined, responseId?: string, narration?: IPlaybackNarration): void {
		const isCheckpointNarration = narration?.kind === 'checkpoint';
		this._clearAutoListenTimer();

		if (this._suppressIncomingAudio) {
			if (isFirstChunk) {
				this._suppressIncomingAudio = false;
			} else {
				return;
			}
		}

		if (isFirstChunk && !isCheckpointNarration) {
			this._clearAwaitingReply();
		}

		const nothingPlaying = this._currentPlaybackSessionId === null;
		const sameSession = !nothingPlaying && this._currentPlaybackSessionId === sessionId;
		const continuationOfCurrent = sameSession && !isFirstChunk && !this._currentPlaybackFinalized;
		if ((nothingPlaying && this._audioQueue.length === 0) || continuationOfCurrent) {
			this._playChunk(sessionId, audio, isFirstChunk, isFinal, transcript, responseId, narration);
			return;
		}

		let entry = isFirstChunk
			? undefined
			: [...this._audioQueue].reverse().find(e =>
				!e.finalized && (e.sessionId === sessionId || (e.sessionId === undefined && sessionId === undefined))
			);
		if (!entry) {
			entry = { sessionId, responseId, narration, finalized: false, chunks: [] };
			this._audioQueue.push(entry);
		}
		entry.chunks.push({ audio, isFirstChunk, isFinal, transcript });
		if (isFinal) {
			entry.finalized = true;
		}

		if (this._currentPlaybackSessionId === null && !this._isProcessingQueue) {
			this._processQueue();
		}
	}

	private _playChunk(sessionId: string | undefined, audio: string, isFirstChunk: boolean, isFinal: boolean, transcript: string | undefined, responseId?: string, narration?: IPlaybackNarration): void {
		const isCheckpointNarration = narration?.kind === 'checkpoint';
		if (transcript) {
			this._setAssistantTurn(transcript, { startNewTurn: isFirstChunk });
		}

		const sessionResource = sessionId ? URI.parse(sessionId) : undefined;
		if (sessionResource) {
			this.voicePlaybackService.notifyPlaybackStart(sessionResource, transcript);
		}

		const speakResponsesEnabled = this.configurationService.getValue<boolean>('agents.voice.speakResponses') !== false;
		if (speakResponsesEnabled && audio) {
			this._currentPlaybackSessionId = sessionId;
			if (sessionId && !isCheckpointNarration) {
				this._lastSpokenResponseSessionId = this._sessionKey(sessionId);
			}
			this._currentPlaybackResponseId = responseId;
			this._currentPlaybackNarration = narration;
			this._currentPlaybackTranscript = transcript ?? this._currentPlaybackTranscript;
			this._currentPlaybackFinalized = isFinal;
			this._clearAutoListenTimer();
			if (!isCheckpointNarration) {
				this._replyPlayedSinceSend = true;
			}
			this._voiceState.set('speaking', undefined);
			this._statusText.set('Speaking...', undefined);
			this.ttsPlaybackService.playAudioChunk(audio, isFinal, this._window!);
			if (this._isHandsFreeEnabled()) {
				this._startBargeInListen();
			} else {
				this.micCaptureService.suppressUntil(Date.now() + 800);
			}
		} else if (!speakResponsesEnabled) {
			if (!isCheckpointNarration) {
				this._replyPlayedSinceSend = true;
			}
			if (isFinal) {
				if (sessionId && narration?.kind === 'response') {
					this._completeRoutedResponse(sessionId);
				}
				this._currentPlaybackSessionId = null;
				this._currentPlaybackResponseId = undefined;
				this._currentPlaybackNarration = undefined;
				if (responseId) {
					if (sessionId) {
						this._notifyCheckpointPlaybackComplete(sessionId, responseId, narration);
					}
					this._markNarrationHeard(responseId);
					this._omniNarrationIds.delete(responseId);
				}
				if (!this._isProcessingQueue) {
					this._processQueue();
				}
				if (this._isHandsFreeEnabled()) {
					this._scheduleAutoListen();
				}
				queueMicrotask(() => this._drainOmniInbox());
			}
		} else {
			if (isFinal && this._currentPlaybackSessionId === sessionId) {
				this._currentPlaybackFinalized = true;
			}
			this.ttsPlaybackService.playAudioChunk(audio, isFinal, this._window!);
		}
	}

	private _processQueue(): void {
		this._isProcessingQueue = true;
		while (this._currentPlaybackSessionId === null && this._audioQueue.length > 0) {
			const next = this._audioQueue.shift()!;
			for (const chunk of next.chunks) {
				this._playChunk(next.sessionId, chunk.audio, chunk.isFirstChunk, chunk.isFinal, chunk.transcript, next.responseId, next.narration);
			}
		}
		this._isProcessingQueue = false;
	}


	private _replaySessionAudio(sessionId: string): void {
		this._stopReplay();

		const samples = this._sessionAudioCache.get(sessionId);
		if (!samples || !this._window) { return; }

		const ctx = this.ttsPlaybackService.ensureContext(this._window);
		const buffer = ctx.createBuffer(1, samples.length, 24000);
		buffer.getChannelData(0).set(samples);

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		this._replaySourceNode = source;

		const sessionResource = URI.parse(sessionId);
		this.voicePlaybackService.notifyPlaybackStart(sessionResource, undefined);
		this._voiceState.set('speaking', undefined);
		this._statusText.set('Replaying...', undefined);

		source.onended = () => {
			if (this._replaySourceNode === source) {
				this._replaySourceNode = undefined;
				this.voicePlaybackService.notifyPlaybackEnd(sessionResource);
				this._voiceState.set('idle', undefined);
				this._statusText.set('Hold to speak...', undefined);
			}
		};

		source.start(0);
	}

	private _stopReplay(): void {
		if (this._replaySourceNode) {
			try { this._replaySourceNode.stop(); } catch { }
			this._replaySourceNode = undefined;
		}
	}


	private _sendContext(): void {
		this.voiceClientService.sendSessionContext(this._buildSessionContext());
	}

	private _scheduleStateChangeEmit(): void {
		if (this._stateChangeEmitTimer) {
			clearTimeout(this._stateChangeEmitTimer);
		}
		this._stateChangeEmitTimer = setTimeout(() => {
			this._stateChangeEmitTimer = undefined;
			this._emitPendingStateChanges();
		}, VoiceSessionController._STATE_CHANGE_SETTLE_MS);
	}

	private _handleNarratableStateChange(sessionId: string, currentState: string, detail: string | undefined, lastResponseSummary: string | undefined, shownNow: string | undefined, confirmationType?: VoiceConfirmationType): void {
		const sessionKey = this._sessionKey(sessionId);
		const omniInboxActive = this._isOmniVoiceInboxActive();
		if (currentState === 'thinking') {
			this._omniClaimedResponseSummaries.delete(sessionKey);
		}
		if (currentState !== 'waiting_for_confirmation') {
			this._omniClaimedPendingIds.delete(sessionKey);
		}
		if (!omniInboxActive && currentState === 'idle' && lastResponseSummary && this._omniClaimedResponseSummaries.has(sessionKey)) {
			this._clearPendingResponse(sessionKey);
			this.logService.trace(`[voice] abandoning completed response claimed by closed omni inbox session=${sessionKey.slice(-32)}`);
			return;
		}
		const routedRequest = this._routedRequests.get(sessionKey);
		if (this._abandonedRoutedRequests.has(sessionKey)) {
			if (currentState === 'waiting_for_confirmation') {
				const narratable = this._modelForSession(sessionId) ? this._currentNarratable(URI.parse(sessionId)) : undefined;
				if (narratable && narratable.kind !== 'response') {
					this._omniClaimedPendingIds.set(sessionKey, this._narratableIdentity(narratable));
				}
			} else if (currentState === 'idle' && lastResponseSummary) {
				this._omniClaimedResponseSummaries.set(sessionKey, lastResponseSummary);
				this._clearPendingResponse(sessionKey);
				this._routedRequests.delete(sessionKey);
				this._abandonedRoutedRequests.delete(sessionKey);
			}
			this.logService.trace(`[voice] abandoning ${currentState} state for closed omni route session=${sessionKey.slice(-32)}`);
			return;
		}
		if (routedRequest) {
			if (!this._isCurrentRoutedRequest(sessionId, routedRequest)) {
				this.logService.trace(`[voice] suppressing ${currentState} state that does not belong to routed request session=${sessionKey.slice(-32)} request=${routedRequest.requestId ?? '<unknown>'}`);
				return;
			}
			if (currentState === 'thinking') {
				this._routedRequests.set(sessionKey, { ...routedRequest, phase: 'running' });
			} else if (currentState === 'waiting_for_confirmation') {
				this._routedRequests.set(sessionKey, { ...routedRequest, phase: 'waiting' });
			} else if (currentState === 'idle' && !lastResponseSummary) {
				this.logService.trace(`[voice] retaining routed request through summary-less idle session=${sessionKey.slice(-32)} request=${routedRequest.requestId ?? '<unknown>'}`);
			}
		}
		if (currentState === 'idle' || currentState === 'waiting_for_confirmation') {
			this._cancelVoiceProgress(sessionId);
		}
		if (currentState === 'thinking') {
			this._clearLastNarratedText(sessionKey);
			this._clearPendingResponse(sessionKey);
			this._clearDeferred(sessionKey);
		}
		if (!omniInboxActive && !this._isOmniRoutedSession(sessionId) && !this._isSameSession(sessionId, shownNow)) {
			if (currentState === 'idle' && lastResponseSummary) {
				const alreadyRead = this._lastNarratedText.get(sessionKey) === lastResponseSummary;
				const existingSummary = this._pendingResponseSummaries.get(sessionKey);
				if (!alreadyRead && existingSummary !== lastResponseSummary) {
					this._pendingResponseSummaries.set(sessionKey, lastResponseSummary);
					this._markPendingResponse(sessionKey, true);
					this.logService.trace(`[voice] response completed for unfocused session=${sessionKey.slice(-32)}; showing pending indicator`);
				}
			}
			return;
		}
		if (currentState === 'idle' && lastResponseSummary) {
			if (omniInboxActive) {
				this._omniClaimedResponseSummaries.set(sessionKey, lastResponseSummary);
				this._pendingResponseSummaries.set(sessionKey, lastResponseSummary);
			}
			const alreadyNarrated = this._lastNarratedText.get(sessionKey) === lastResponseSummary;
			if (this._hasResponseAudioInFlight(sessionKey)) {
				if (routedRequest) {
					this._pendingResponseSummaries.set(sessionKey, lastResponseSummary);
				}
			} else {
				this._narrate(sessionId, 'response', lastResponseSummary);
				if (alreadyNarrated || this._wasResponseHeard(sessionId, lastResponseSummary)) {
					this._clearPendingResponse(sessionKey);
					this._completeRoutedResponse(sessionId);
				}
			}
		} else if (currentState === 'waiting_for_confirmation' && detail) {
			this._discardResponsesSupersededByPending(sessionId);
			const question = this._questionNarratable(this._modelForSession(sessionId));
			if (question) {
				if (omniInboxActive) {
					this._omniClaimedPendingIds.set(sessionKey, this._narratableIdentity(question));
				}
				this._narrate(sessionId, question.kind, question.text, undefined, undefined, undefined, question.pending);
			} else {
				const pending = this._pendingNarrationReference(this._modelForSession(sessionId));
				const confirmation: IVoiceNarratable = { kind: 'confirmation', text: detail, confirmationType, ...(pending ? { pending } : {}) };
				if (omniInboxActive) {
					this._omniClaimedPendingIds.set(sessionKey, this._narratableIdentity(confirmation));
				}
				this._narrate(sessionId, confirmation.kind, confirmation.text, undefined, undefined, confirmation.confirmationType, confirmation.pending);
			}
		}
	}

	private _modelForSession(sessionId: string): IChatModel | undefined {
		let resource: URI;
		try {
			resource = URI.parse(sessionId);
		} catch {
			return undefined;
		}
		return this.chatService.getSession(resource);
	}

	private _isCurrentRoutedRequest(sessionId: string, routedRequest: IRoutedVoiceRequest): boolean {
		const currentRequestId = this._modelForSession(sessionId)?.getRequests().at(-1)?.id;
		if (!currentRequestId) {
			return false;
		}
		if (routedRequest.modelRequestId) {
			return currentRequestId === routedRequest.modelRequestId;
		}
		if (routedRequest.requestId === currentRequestId) {
			delete routedRequest.previousRequestId;
			return true;
		}
		if (!hasOwn(routedRequest, 'previousRequestId') || currentRequestId === routedRequest.previousRequestId) {
			return false;
		}
		routedRequest.modelRequestId = currentRequestId;
		delete routedRequest.previousRequestId;
		this.logService.trace(`[voice] adopted durable routed request id session=${this._sessionKey(sessionId).slice(-32)} request=${routedRequest.requestId ?? '<unknown>'} model=${currentRequestId}`);
		return true;
	}

	private _emitPendingStateChanges(): void {
		const changes = [...this._pendingStateChanges.values()];
		this._pendingStateChanges.clear();
		if (changes.length === 0) {
			return;
		}
		const netChanges: { change: typeof changes[number]; detailOnly: boolean }[] = [];
		for (const change of changes) {
			const detail = change.detail ?? '';
			const summary = change.lastResponseSummary ?? '';
			const stateChanged = change.fromState !== change.currentState;
			const detailOnly = !stateChanged && change.currentState === 'waiting_for_confirmation'
				&& (change.fromDetail !== detail || change.fromPendingId !== change.pendingId || change.fromConfirmationType !== change.confirmationType);
			const responseSummaryOnly = !stateChanged && change.currentState === 'idle' && !!summary && change.fromResponseSummary !== summary;
			if (stateChanged || detailOnly || responseSummaryOnly) {
				netChanges.push({ change, detailOnly });
			}
		}
		if (netChanges.length === 0) {
			this._sendContext();
			return;
		}
		for (const { change, detailOnly } of netChanges) {
			if (detailOnly) {
				this.voiceClientService.invalidateSessionCache(change.sessionId);
			}
		}
		this._sendContext();
		this.voiceClientService.flushSessionContext();
		const shownNow = this._shownSessionId();
		for (const { change } of netChanges) {
			this._handleNarratableStateChange(change.sessionId, change.currentState, change.detail, change.lastResponseSummary, shownNow, change.confirmationType);
		}
		this.logService.trace(`[voice] emitting ${netChanges.length} settled stateChange(s): ${netChanges.map(({ change, detailOnly }) => `${change.label}:${change.currentState}${detailOnly ? ' (detail-only)' : ''}`).join(', ')}`);
		for (const { change } of netChanges) {
			this._persistEntry(
				'coding_event',
				`session "${change.label}" → ${change.currentState}`,
				{
					codingSessionId: change.sessionId,
					codingStatus: change.currentState,
					codingSessionLabel: change.label,
				},
			);
		}
	}

	private _armConfirmationFlushWatchdog(sessionId: string, label: string, isTransition: boolean): void {
		if (this._confirmationFlushWatchdogs.has(sessionId)) {
			return;
		}
		if (isTransition) {
			this.logService.trace(`[voice] arming confirmation flush watchdog id=${sessionId.slice(-32)} label="${label}"`);
		}
		const timer = setTimeout(() => {
			this._confirmationFlushWatchdogs.delete(sessionId);
			this.logService.trace(`[voice] confirmation flush watchdog firing id=${sessionId.slice(-32)} label="${label}"`);
			this._sendContext();
			this.voiceClientService.flushSessionContext();
			let resource: URI | undefined;
			try {
				resource = URI.parse(sessionId);
			} catch {
				return;
			}
			const narratable = this._currentNarratable(resource);
			if (narratable && narratable.kind !== 'response') {
				this._retryPendingNarration(sessionId, narratable);
			}
		}, VoiceSessionController._CONFIRMATION_FLUSH_DELAY_MS);
		this._confirmationFlushWatchdogs.set(sessionId, timer);
	}

	private _checkSessionStateChanges(): void {
		if (this._deferredResponses.size > 0) {
			const shown = this._shownSessionId();
			if (shown) {
				this._flushDeferredResponse(shown);
			}
		}

		const sessions: any[] = [];
		const stateChanges: { sessionId: string; currentState: string; label: string; detail?: string; confirmationType?: VoiceConfirmationType; lastResponseSummary?: string }[] = [];
		const processedResources = new Set<string>();
		const waitingSessionIds = new Set<string>();

		for (const s of sessions) {
			processedResources.add(s.resource.toString());
			const sessionId = s.resource.toString();
			const model = this.chatService.getSession(s.resource);
			let currentState: string;
			let detail: string | undefined;
			let confirmationType: VoiceConfirmationType | undefined;
			let lastResponseSummary: string | undefined;
			if (model) {
				const info = this._getAgentStateInfo(model);
				currentState = this._effectiveResidentState(sessionId, info);
				detail = info.detail;
				confirmationType = info.confirmation_type;
				lastResponseSummary = currentState === info.state ? info.last_response_summary : undefined;
				this._cacheResponseSummary(sessionId, info.state, info.last_response_summary);
				if (currentState === info.state) {
					this._pendingIdleNarration.delete(sessionId);
				}
			} else {
				currentState = s.status === false ? 'thinking'
					: s.status === false ? 'waiting_for_confirmation'
						: s.status === false ? 'idle'
							: 'unknown';
				this._cacheResponseSummary(sessionId, currentState, undefined);
				if (s.status === false) {
					this._ensureModelLoaded(s.resource);
				}
			}

			const prev = this._prevSessionStates.get(sessionId);
			const isStateChange = prev !== undefined && prev.state !== currentState && currentState !== 'unknown';
			const pendingId = currentState === 'waiting_for_confirmation' ? this._pendingIdFor(sessionId) : '';
			const isDetailChange = !isStateChange && prev !== undefined && currentState === 'waiting_for_confirmation'
				&& ((detail ?? '') !== prev.detail || pendingId !== prev.pendingId || confirmationType !== prev.confirmationType);

			if (isStateChange && currentState === 'thinking' && !this._eagerModelLoading.has(sessionId)) {
				this._sessionsAwaitingResponseSummary.add(sessionId);
			}

			if (!model && currentState === 'idle' && isStateChange) {
				const cachedSummary = this._lastResponseSummaryById.get(sessionId);
				if (!cachedSummary) {
					this._deferIdleNarrationUntilModelLoaded(s.resource);
					continue;
				}
				lastResponseSummary = cachedSummary;
			}

			const normalizedSummary = lastResponseSummary ?? '';
			const isResponseSummaryChange = !isStateChange && prev !== undefined && currentState === 'idle' && !!normalizedSummary && normalizedSummary !== prev.lastResponseSummary && this._sessionsAwaitingResponseSummary.has(sessionId);

			if ((isStateChange && currentState === 'idle' && !!normalizedSummary) || isResponseSummaryChange) {
				this._sessionsAwaitingResponseSummary.delete(sessionId);
			}

			if (isStateChange || isDetailChange || isResponseSummaryChange) {
				const cancelExpiry = this._userCancelledSessions.get(sessionId);
				if (cancelExpiry) {
					clearTimeout(cancelExpiry);
					this._userCancelledSessions.delete(sessionId);
				} else {
					if (isDetailChange) {
						this.voiceClientService.invalidateSessionCache(sessionId);
					}
					stateChanges.push({ sessionId, currentState, label: s.label || 'Untitled session', detail, confirmationType, lastResponseSummary });
				}
			}
			if (currentState !== 'unknown') {
				const rememberedSummary = normalizedSummary || this._lastResponseSummaryById.get(sessionId) || prev?.lastResponseSummary || '';
				this._prevSessionStates.set(sessionId, { state: currentState, detail: detail ?? '', pendingId, confirmationType, lastResponseSummary: rememberedSummary });
			}
			if (currentState === 'waiting_for_confirmation') {
				waitingSessionIds.add(sessionId);
			}
		}

		for (const chatModel of this.chatService.chatModels.get()) {
			const key = chatModel.sessionResource.toString();
			if (processedResources.has(key)) { continue; }
			if (chatModel.getRequests().length === 0) { continue; }

			const info = this._getAgentStateInfo(chatModel);
			const currentState = info.state;
			const detail = info.detail;
			const confirmationType = info.confirmation_type;
			const lastResponseSummary = info.last_response_summary;

			const prev = this._prevSessionStates.get(key);
			const isStateChange = prev !== undefined && prev.state !== currentState && currentState !== 'unknown';
			const pendingId = currentState === 'waiting_for_confirmation' ? this._pendingIdFor(key) : '';
			const isDetailChange = !isStateChange && prev !== undefined && currentState === 'waiting_for_confirmation'
				&& ((detail ?? '') !== prev.detail || pendingId !== prev.pendingId || confirmationType !== prev.confirmationType);

			if (isStateChange && currentState === 'thinking' && !this._eagerModelLoading.has(key)) {
				this._sessionsAwaitingResponseSummary.add(key);
			}

			const normalizedSummary = lastResponseSummary ?? '';
			const isResponseSummaryChange = !isStateChange && prev !== undefined && currentState === 'idle' && !!normalizedSummary && normalizedSummary !== prev.lastResponseSummary && this._sessionsAwaitingResponseSummary.has(key);

			if ((isStateChange && currentState === 'idle' && !!normalizedSummary) || isResponseSummaryChange) {
				this._sessionsAwaitingResponseSummary.delete(key);
			}

			if (isStateChange || isDetailChange || isResponseSummaryChange) {
				if (isDetailChange) {
					this.voiceClientService.invalidateSessionCache(key);
				}
				stateChanges.push({ sessionId: key, currentState, label: chatModel.title || 'Chat', detail, confirmationType, lastResponseSummary });
			}
			if (currentState !== 'unknown') {
				const rememberedSummary = normalizedSummary || this._lastResponseSummaryById.get(key) || prev?.lastResponseSummary || '';
				this._prevSessionStates.set(key, { state: currentState, detail: detail ?? '', pendingId, confirmationType, lastResponseSummary: rememberedSummary });
			}
			if (currentState === 'waiting_for_confirmation') {
				waitingSessionIds.add(key);
			}
		}

		this._reconcileConfirmationIndicators(waitingSessionIds);

		if (stateChanges.length > 0) {
			this.logService.trace(`[voice] onDidChangeSessions detected ${stateChanges.length} state change(s): ${stateChanges.map(c => `${c.label}: ${c.currentState}`).join(', ')}`);
			this._sendContext();
			this.voiceClientService.flushSessionContext();
		}

		const shownNow = this._shownSessionId();
		for (const change of stateChanges) {
			this._handleNarratableStateChange(change.sessionId, change.currentState, change.detail, change.lastResponseSummary, shownNow, change.confirmationType);
		}

		if (stateChanges.length > 0) {
			for (const change of stateChanges) {
				this._persistEntry(
					'coding_event',
					`session "${change.label}" → ${change.currentState}`,
					{
						codingSessionId: change.sessionId,
						codingStatus: change.currentState,
						codingSessionLabel: change.label,
					},
				);
			}
		}
	}

	private _reportedAgentState(realState: string, isActive: boolean): { state: string; hideConfirmationDetail: boolean } {
		if (this._isOmniVoiceInboxActive()) {
			return { state: realState, hideConfirmationDetail: false };
		}
		if (realState === 'waiting_for_confirmation' && !isActive) {
			return { state: 'thinking', hideConfirmationDetail: true };
		}
		return { state: realState, hideConfirmationDetail: false };
	}

	private _getInputContext(model: IChatModel): Pick<IVoiceSessionContext['sessions'][number], 'selected_model' | 'attachment_names' | 'attachment_count'> {
		const state = model.inputModel?.state?.get();
		const selectedModel = state?.selectedModel
			?? this.chatWidgetService.getWidgetBySessionResource(model.sessionResource)?.inputPart.selectedLanguageModel.get();
		const attachmentNames = state?.attachments
			.filter(isExplicitFileOrImageVariableEntry)
			.map(attachment => attachment.name)
			.filter(name => name.length > 0) ?? [];
		return {
			...(selectedModel ? {
				selected_model: {
					identifier: selectedModel.identifier,
					name: selectedModel.metadata.name,
					vendor: selectedModel.metadata.vendor,
				},
			} : {}),
			...(attachmentNames.length > 0 ? {
				attachment_names: attachmentNames.slice(0, 10),
				attachment_count: attachmentNames.length,
			} : {}),
		};
	}

	private _buildSessionContext(): IVoiceSessionContext {
		const oneHourAgo = Date.now() - 60 * 60 * 1000;
		const sessions: any[] = [];

		const targetSessionId = this._getActiveSessionId();

		const sessionList: IVoiceSessionContext['sessions'] = sessions.map((s: any) => {
			const model = this.chatService.getSession(s.resource);
			const isActive = s.resource.toString() === targetSessionId;
			if (!model) {
				const sessionIdStr = s.resource.toString();
				let fallbackState = s.status === false ? 'thinking'
					: s.status === false ? 'waiting_for_confirmation'
						: s.status === false ? 'idle'
							: 'unknown';
				if (fallbackState === 'idle' && this._pendingIdleNarration.has(sessionIdStr) && !this._lastResponseSummaryById.has(sessionIdStr)) {
					const prev = this._prevSessionStates.get(sessionIdStr);
					if (prev?.state) {
						fallbackState = prev.state;
					}
				}
				if (fallbackState === 'waiting_for_confirmation') {
					this._ensureModelLoaded(s.resource);
					fallbackState = 'thinking';
				}
				const scoped = this._reportedAgentState(fallbackState, isActive);
				const cachedSummary = fallbackState === 'idle' ? this._lastResponseSummaryById.get(sessionIdStr) : undefined;
				return {
					id: sessionIdStr,
					...(s.label ? { label: s.label } : {}),
					session_type: 'agent' as const,
					is_active: isActive,
					...(isActive && this._targetOmniRoute ? { omni_route: this._targetOmniRoute } : {}),
					agent_state: scoped.state,
					...(cachedSummary ? { last_response_summary: cachedSummary } : {}),
				};
			}
			const stateInfo = this._getAgentStateInfo(model);
			this._cacheResponseSummary(s.resource.toString(), stateInfo.state, stateInfo.last_response_summary);
			const detailPending = stateInfo.state === 'waiting_for_confirmation' && !stateInfo.detail;
			const heldState = this._effectiveResidentState(s.resource.toString(), stateInfo);
			const scoped = detailPending
				? { state: 'thinking', hideConfirmationDetail: true }
				: this._reportedAgentState(heldState, isActive);
			const shipSummary = heldState === stateInfo.state ? stateInfo.last_response_summary : undefined;
			const pending = this._buildPendingPayload(model);
			return {
				id: s.resource.toString(),
				...(s.label ? { label: s.label } : {}),
				session_type: 'agent' as const,
				is_active: isActive,
				...(isActive && s.resource.toString() === this._targetSession.get()?.toString() && this._targetOmniRoute ? { omni_route: this._targetOmniRoute } : {}),
				agent_state: scoped.state,
				...(!scoped.hideConfirmationDetail && stateInfo.detail ? { agent_state_detail: stateInfo.detail } : {}),
				...(!scoped.hideConfirmationDetail && stateInfo.confirmation_type ? { confirmation_type: stateInfo.confirmation_type } : {}),
				...(shipSummary ? { last_response_summary: shipSummary } : {}),
				...(pending ? { pending } : {}),
				...this._getInputContext(model),
			};
		});

		const agentResources = new Set<string>();
		for (const chatModel of this.chatService.chatModels.get()) {
			const key = chatModel.sessionResource.toString();
			if (agentResources.has(key)) { continue; }
			if (chatModel.getRequests().length === 0) { continue; }
			const stateInfo = this._getAgentStateInfo(chatModel);
			if (stateInfo.state === 'idle') {
				const lastActive = chatModel.lastMessageDate;
				if (lastActive < oneHourAgo) { continue; }
			}
			const isActive = key === targetSessionId;
			const scoped = this._reportedAgentState(stateInfo.state, isActive);
			const pending = this._buildPendingPayload(chatModel);
			sessionList.push({
				id: key,
				...(chatModel.title ? { label: chatModel.title } : {}),
				session_type: 'chat',
				is_active: isActive,
				...(isActive && key === this._targetSession.get()?.toString() && this._targetOmniRoute ? { omni_route: this._targetOmniRoute } : {}),
				agent_state: scoped.state,
				...(!scoped.hideConfirmationDetail && stateInfo.detail ? { agent_state_detail: stateInfo.detail } : {}),
				...(!scoped.hideConfirmationDetail && stateInfo.confirmation_type ? { confirmation_type: stateInfo.confirmation_type } : {}),
				...(stateInfo.last_response_summary ? { last_response_summary: stateInfo.last_response_summary } : {}),
				...(pending ? { pending } : {}),
				...this._getInputContext(chatModel),
			});
		}

		return {
			sessions: sessionList,
			display_locale: this._window?.navigator.language || 'en-US',
		};
	}

	private _ensureModelLoaded(resource: URI): void {
		const key = resource.toString();
		if (this._eagerModelRefs.has(key) || this._eagerModelLoading.has(key) || this.chatService.getSession(resource)) {
			return;
		}
		this.logService.trace(`[voice] eagerly loading model for session ${key.slice(-32)}`);
		this._eagerModelLoading.add(key);
		const cts = new CancellationTokenSource();
		this.chatService.acquireOrLoadSession(resource, ChatAgentLocation.Chat, cts.token, 'VoiceSessionController#eagerLoad').then(ref => {
			this._eagerModelLoading.delete(key);
			if (ref) {
				const existing = this._eagerModelRefs.get(key);
				if (!this._isConnected.get() || existing) {
					ref.dispose();
					if (!this._isConnected.get()) {
						this._pendingIdleNarration.delete(key);
					}
				} else {
					this._eagerModelRefs.set(key, ref);
					this._checkSessionStateChanges();
					this._sendContext();
					this.voiceClientService.flushSessionContext();
					if (this._shownSessionId() === key) {
						this._activateShownSession(resource);
					}
				}
			} else {
				this._pendingIdleNarration.delete(key);
			}
			cts.dispose();
		}, () => { this._eagerModelLoading.delete(key); this._pendingIdleNarration.delete(key); cts.dispose(); });
	}

	private _deferIdleNarrationUntilModelLoaded(resource: URI): void {
		this._pendingIdleNarration.add(resource.toString());
		this._ensureModelLoaded(resource);
	}

	private _cacheResponseSummary(sessionId: string, state: string, summary: string | undefined): void {
		const sessionKey = this._sessionKey(sessionId);
		const routedRequest = this._routedRequests.get(sessionKey);
		const isCurrentRoutedRequest = routedRequest && this._isCurrentRoutedRequest(sessionId, routedRequest);
		if (isCurrentRoutedRequest && state === 'thinking') {
			this._routedRequests.set(sessionKey, { ...routedRequest, phase: 'running' });
		} else if (isCurrentRoutedRequest && state === 'waiting_for_confirmation') {
			this._routedRequests.set(sessionKey, { ...routedRequest, phase: 'waiting' });
		}
		if (state === 'idle' && summary) {
			this._lastResponseSummaryById.set(sessionId, summary);
		} else if (state === 'thinking') {
			this._lastResponseSummaryById.delete(sessionId);
		}
	}

	private _pruneSessionCaches(liveSessionIds: Set<string>): void {
		for (const id of this._lastResponseSummaryById.keys()) {
			if (!liveSessionIds.has(id)) {
				this._lastResponseSummaryById.delete(id);
			}
		}
		for (const id of this._lastNarratedText.keys()) {
			if (!liveSessionIds.has(id)) {
				this._lastNarratedText.delete(id);
			}
		}
		for (const id of Array.from(this._sessionsAwaitingResponseSummary)) {
			if (!liveSessionIds.has(id)) {
				this._sessionsAwaitingResponseSummary.delete(id);
			}
		}
		for (const id of [...this._pendingResponseSummaries.keys()]) {
			if (!liveSessionIds.has(id)) {
				this._clearPendingResponse(id);
			}
		}
	}

	private _effectiveResidentState(sessionId: string, stateInfo: { state: string; last_response_summary?: string }): string {
		if (stateInfo.state === 'idle'
			&& !stateInfo.last_response_summary
			&& this._pendingIdleNarration.has(sessionId)
			&& this._eagerModelLoading.has(sessionId)) {
			const prev = this._prevSessionStates.get(sessionId);
			return prev?.state ?? 'thinking';
		}
		return stateInfo.state;
	}

	private _visibleConfirmationText(value: string | IMarkdownString | undefined, maxLength = VoiceSessionController._MAX_CONFIRMATION_FIELD_CHARS): string {
		if (!value) {
			return '';
		}
		const plainText = renderAsPlaintext(typeof value === 'string' ? { value } : value, { useLinkFormatter: true }).replace(/\s+/g, ' ').trim();
		if (plainText.length <= maxLength) {
			return plainText;
		}
		const prefix = plainText.slice(0, maxLength - 3);
		const wordBoundary = prefix.lastIndexOf(' ');
		const truncated = wordBoundary > Math.floor(maxLength * 0.6) ? prefix.slice(0, wordBoundary) : prefix;
		return localize('voice.confirmation.truncated', "{0}...", truncated);
	}

	private _boundedConfirmationLines(lines: readonly string[], fallback: string): string {
		const result: string[] = [];
		for (const line of lines.filter(Boolean)) {
			const candidate = [...result, line].join('\n');
			if (candidate.length > VoiceSessionController._MAX_CONFIRMATION_NARRATION_CHARS) {
				break;
			}
			result.push(line);
		}
		return result.join('\n') || fallback;
	}

	private _visibleQuestionnaireFromCarousel(carousel: IChatQuestionCarousel, includeDetails: boolean): IVisibleVoiceQuestionnaire {
		return {
			context: carousel.message,
			questions: carousel.questions.map(question => ({
				prompt: question.message ?? (question.title !== question.id ? question.title : undefined),
				details: includeDetails ? question.description ?? question.detailedMessage : undefined,
				options: (question.options ?? []).map(option => option.label),
				allowFreeformInput: question.allowFreeformInput !== false,
			})),
		};
	}

	private _visibleQuestionnaireFromToolInvocation(toolInvocation: IChatToolInvocation): IVisibleVoiceQuestionnaire | undefined {
		if (!isPendingVoiceQuestionnaireInvocation(toolInvocation)) {
			return undefined;
		}
		const state = toolInvocation.state.get();
		if (state.type !== IChatToolInvocation.StateKind.WaitingForConfirmation && state.type !== IChatToolInvocation.StateKind.WaitingForPostApproval) {
			return undefined;
		}
		const parameters = state.parameters;
		if (!isObject(parameters) || !hasOwn(parameters, 'questions') || !Array.isArray(parameters.questions) || parameters.questions.length === 0) {
			return undefined;
		}

		return {
			questions: parameters.questions.map(rawQuestion => {
				if (!isObject(rawQuestion)) {
					return { options: [], allowFreeformInput: true };
				}
				const prompt = hasOwn(rawQuestion, 'question') && typeof rawQuestion.question === 'string'
					? rawQuestion.question
					: undefined;
				const options: string[] = [];
				if (hasOwn(rawQuestion, 'options') && Array.isArray(rawQuestion.options)) {
					for (const rawOption of rawQuestion.options) {
						if (!isObject(rawOption) || !hasOwn(rawOption, 'label') || typeof rawOption.label !== 'string') {
							continue;
						}
						const description = hasOwn(rawOption, 'description') && typeof rawOption.description === 'string'
							? rawOption.description
							: undefined;
						options.push(description ? `${rawOption.label} - ${description}` : rawOption.label);
					}
				}
				const allowFreeformInput = !(hasOwn(rawQuestion, 'allowFreeformInput') && rawQuestion.allowFreeformInput === false);
				return { prompt, options, allowFreeformInput };
			}),
		};
	}

	private _formatQuestionnaireNarration(questionnaire: IVisibleVoiceQuestionnaire): string | undefined {
		const fallback = localize('voice.questionnaire.fallback', "I need your input in the open questionnaire.");
		if (questionnaire.questions.length === 0) {
			return undefined;
		}

		const lines = [
			questionnaire.questions.length === 1
				? localize('voice.questionnaire.single', "questionnaire: 1 question")
				: localize('voice.questionnaire.multiple', "questionnaire: {0} questions", questionnaire.questions.length),
		];
		const context = this._visibleConfirmationText(questionnaire.context, 220);
		if (context) {
			lines.push(localize('voice.questionnaire.context', "context: {0}", context));
		}

		let includedQuestions = 0;
		const questionLimit = Math.min(questionnaire.questions.length, VoiceSessionController._MAX_QUESTIONNAIRE_QUESTIONS);
		for (let index = 0; index < questionLimit; index++) {
			const question = questionnaire.questions[index];
			const prompt = this._visibleConfirmationText(question.prompt);
			const questionLines = [
				localize('voice.questionnaire.question', "{0}. {1}", index + 1, prompt || fallback),
			];
			const description = this._visibleConfirmationText(question.details, 180);
			if (description && description !== prompt) {
				questionLines.push(localize('voice.questionnaire.description', "details: {0}", description));
			}

			const visibleOptions = question.options
				.map(option => this._visibleConfirmationText(option, 160))
				.filter(Boolean);
			if (visibleOptions.length > 0) {
				const includedOptions = visibleOptions.slice(0, VoiceSessionController._MAX_QUESTIONNAIRE_OPTIONS);
				const omittedOptions = visibleOptions.length - includedOptions.length;
				let optionsText = includedOptions.join('; ');
				if (omittedOptions > 0) {
					optionsText = localize('voice.questionnaire.moreOptions', "{0}; {1} more options", optionsText, omittedOptions);
				}
				if (question.allowFreeformInput) {
					optionsText = localize('voice.questionnaire.customOption', "{0}; a custom response is also available", optionsText);
				}
				questionLines.push(localize('voice.questionnaire.options', "options: {0}", optionsText));
			} else {
				questionLines.push(localize('voice.questionnaire.freeform', "response: enter a free-form answer in Dardcor"));
			}

			const remainingAfterCandidate = questionnaire.questions.length - (includedQuestions + 1);
			const reservedSuffix = remainingAfterCandidate > 0
				? remainingAfterCandidate === 1
					? localize('voice.questionnaire.oneOmitted', "1 more question is open in Dardcor.")
					: localize('voice.questionnaire.manyOmitted', "{0} more questions are open in Dardcor.", remainingAfterCandidate)
				: localize('voice.questionnaire.open', "The questionnaire is open in Dardcor.");
			const candidate = [...lines, ...questionLines, reservedSuffix].join('\n');
			if (candidate.length > VoiceSessionController._MAX_CONFIRMATION_NARRATION_CHARS) {
				break;
			}
			lines.push(...questionLines);
			includedQuestions++;
		}

		const omittedQuestions = questionnaire.questions.length - includedQuestions;
		if (omittedQuestions > 0) {
			lines.push(omittedQuestions === 1
				? localize('voice.questionnaire.oneOmitted', "1 more question is open in Dardcor.")
				: localize('voice.questionnaire.manyOmitted', "{0} more questions are open in Dardcor.", omittedQuestions));
		} else {
			lines.push(localize('voice.questionnaire.open', "The questionnaire is open in Dardcor."));
		}
		return lines.join('\n') || fallback;
	}

	private _formatChoiceLabels(choices: readonly { label: string; description?: string }[]): string | undefined {
		const visibleChoices = choices.map(choice => {
			const label = this._visibleConfirmationText(choice.label, 160);
			const description = this._visibleConfirmationText(choice.description, 160);
			return description ? localize('voice.confirmation.choiceDescription', "{0} - {1}", label, description) : label;
		}).filter(Boolean);
		if (visibleChoices.length === 0) {
			return undefined;
		}
		const includedChoices = visibleChoices.slice(0, VoiceSessionController._MAX_QUESTIONNAIRE_OPTIONS);
		const omittedChoices = visibleChoices.length - includedChoices.length;
		const text = includedChoices.join('; ');
		return omittedChoices > 0
			? localize('voice.confirmation.moreChoices', "{0}; {1} more choices", text, omittedChoices)
			: text;
	}

	private _formatPlanNarration(plan: IChatPlanReview): string {
		const fallback = localize('voice.plan.fallback', "A plan is open in Dardcor and needs your approval.");
		const title = this._visibleConfirmationText(plan.title) || fallback;
		const lines = [localize('voice.plan.title', "plan approval: {0}", title)];
		const choices = this._formatChoiceLabels(plan.actions);
		if (choices) {
			lines.push(localize('voice.plan.choices', "choices: {0}", choices));
		}
		lines.push(localize('voice.plan.open', "The plan is open in Dardcor."));
		return this._boundedConfirmationLines(lines, fallback);
	}

	private _formatElicitationNarration(elicitation: IChatElicitationRequest): string {
		const fallback = localize('voice.elicitation.fallback', "Dardcor needs your input in the open request.");
		const title = this._visibleConfirmationText(elicitation.title);
		const message = this._visibleConfirmationText(elicitation.message);
		const subtitle = this._visibleConfirmationText(elicitation.subtitle);
		const lines = [localize('voice.elicitation.title', "input request: {0}", title || message || fallback)];
		if (subtitle && subtitle !== title) {
			lines.push(subtitle);
		}
		if (message && message !== title) {
			lines.push(message);
		}
		const choices = this._formatChoiceLabels([
			{ label: elicitation.acceptButtonLabel },
			...(elicitation.rejectButtonLabel ? [{ label: elicitation.rejectButtonLabel }] : []),
			...(elicitation.moreActions ?? []).map(action => ({ label: action.label })),
		]);
		if (choices) {
			lines.push(localize('voice.elicitation.choices', "choices: {0}", choices));
		}
		return this._boundedConfirmationLines(lines, fallback);
	}

	private _formatConfirmationNarration(confirmation: IChatConfirmation): string {
		const fallback = localize('voice.confirmation.fallback', "Dardcor needs your approval to continue.");
		const title = this._visibleConfirmationText(confirmation.title);
		const message = this._visibleConfirmationText(confirmation.message);
		const lines = [localize('voice.confirmation.title', "confirmation: {0}", title || message || fallback)];
		if (message && message !== title) {
			lines.push(message);
		}
		const choices = this._formatChoiceLabels((confirmation.buttons ?? []).map(label => ({ label })));
		if (choices) {
			lines.push(localize('voice.confirmation.choices', "choices: {0}", choices));
		}
		return this._boundedConfirmationLines(lines, fallback);
	}

	private _formatToolNarration(toolInvocation: IChatToolInvocation): string {
		const fallback = localize('voice.toolConfirmation.fallback', "Dardcor needs your approval to continue.");
		const state = toolInvocation.state.get();
		if (state.type !== IChatToolInvocation.StateKind.WaitingForConfirmation && state.type !== IChatToolInvocation.StateKind.WaitingForPostApproval) {
			return fallback;
		}
		const messages = state.confirmationMessages;
		const title = this._visibleConfirmationText(messages?.title) || this._visibleConfirmationText(toolInvocation.invocationMessage);
		const message = this._visibleConfirmationText(messages?.message);
		const lines = [localize('voice.toolConfirmation.title', "tool approval: {0}", title || message || fallback)];
		const command = getVoiceToolApprovalCommand(toolInvocation, false);
		if (command) {
			lines.push(localize('voice.toolConfirmation.command', "command: {0}", command));
		}
		if (message && message !== title) {
			lines.push(message);
		}
		return this._boundedConfirmationLines(lines, fallback);
	}

	private _formatToolNarrationFallback(): string {
		const fallback = localize('voice.toolConfirmation.fallback', "Dardcor needs your approval to continue.");
		return localize('voice.toolConfirmation.title', "tool approval: {0}", fallback);
	}

	private _formatToolAuthenticationNarration(toolInvocation: IChatToolInvocation): string | undefined {
		const state = toolInvocation.state.get();
		if (state.type !== IChatToolInvocation.StateKind.WaitingForAuthentication) {
			return undefined;
		}
		const serverName = this._visibleConfirmationText(state.server.name);
		const fallback = localize('voice.authentication.fallback', "Dardcor needs authentication to continue.");
		return this._boundedConfirmationLines([
			localize('voice.authentication.title', "authentication request: MCP authentication required"),
			serverName
				? localize('voice.authentication.message', "The MCP server {0} requires authentication to continue this tool call.", serverName)
				: fallback,
			localize('voice.authentication.choices', "choices: Authenticate; Cancel"),
		], fallback);
	}

	private _selectPendingPart(model: IChatModel | undefined | null): { requestId: string; type: VoiceConfirmationType; part: IChatProgressResponseContent } | undefined {
		const lastRequest = model?.getRequests().at(-1);
		const parts = lastRequest?.response?.response.value;
		if (!lastRequest || !parts) {
			return undefined;
		}
		for (const part of parts) {
			if (part.kind === 'toolInvocation' && this._isOpenPendingPart(part)) {
				derivePendingId(lastRequest.id, part, this._store);
			}
		}

		for (let index = 0; index < parts.length; index++) {
			const part = parts[index];
			const type = getVoiceConfirmationType([part]);
			if (type && this._isOpenPendingPart(part)) {
				if (part.kind === 'toolInvocation') {
					const pendingId = derivePendingId(lastRequest.id, part, this._store);
					if (isPendingIdResolved(pendingId)) {
						continue;
					}
				}
				if (type === 'questionnaire' && isVoiceQuestionnaireInvocation(part)) {
					const carousel = parts.slice(index + 1).find(candidate =>
						candidate.kind === 'questionCarousel'
						&& candidate.resolveId === part.toolCallId
						&& this._isOpenPendingPart(candidate));
					if (carousel) {
						return { requestId: lastRequest.id, type, part: carousel };
					}
				}
				return { requestId: lastRequest.id, type, part };
			}
		}
		return undefined;
	}

	private _isOpenPendingPart(part: IChatProgressResponseContent): boolean {
		if (part.kind === 'questionCarousel') {
			return !part.isUsed && !part.answeredExternally;
		}
		if (part.kind === 'elicitation2') {
			return part.state.get() === 'pending';
		}
		if (part.kind === 'planReview' || part.kind === 'confirmation') {
			return !part.isUsed;
		}
		if (part.kind === 'toolInvocation') {
			const state = part.state.get();
			return state.type === IChatToolInvocation.StateKind.WaitingForConfirmation
				|| state.type === IChatToolInvocation.StateKind.WaitingForPostApproval
				|| state.type === IChatToolInvocation.StateKind.WaitingForAuthentication;
		}
		return false;
	}

	private _getPendingConfirmationInfo(model: IChatModel): { type: VoiceConfirmationType; detail?: string } | undefined {
		const lastResponse = model.getRequests().at(-1)?.response;
		if (!lastResponse) {
			return undefined;
		}

		const parts = lastResponse.response.value;
		const selected = this._selectPendingPart(model);
		if (!selected) {
			return undefined;
		}
		const { type, part } = selected;

		const askQuestionsCallIds = new Set(parts
			.filter(isVoiceQuestionnaireInvocation)
			.map(part => part.toolCallId));
		if (type === 'questionnaire' && part?.kind === 'questionCarousel') {
			const includeDetails = !part.resolveId || !askQuestionsCallIds.has(part.resolveId);
			return { type, detail: this._formatQuestionnaireNarration(this._visibleQuestionnaireFromCarousel(part, includeDetails)) };
		}
		if (type === 'questionnaire' && part?.kind === 'toolInvocation') {
			const questionnaire = this._visibleQuestionnaireFromToolInvocation(part);
			if (questionnaire) {
				return { type, detail: this._formatQuestionnaireNarration(questionnaire) };
			}
		}
		if (type === 'elicitation' && part?.kind === 'elicitation2') {
			return { type, detail: this._formatElicitationNarration(part) };
		}
		if (type === 'plan' && part?.kind === 'planReview') {
			return { type, detail: this._formatPlanNarration(part) };
		}
		if (type === 'tool' && part?.kind === 'toolInvocation') {
			return { type, detail: this._formatToolNarration(part) };
		}
		if (type === 'generic' && part?.kind === 'confirmation') {
			return { type, detail: this._formatConfirmationNarration(part) };
		}
		if (type === 'generic' && part?.kind === 'toolInvocation') {
			return { type, detail: this._formatToolAuthenticationNarration(part) };
		}
		if (type === 'questionnaire') {
			return { type };
		}
		return { type, detail: this._formatToolNarrationFallback() };
	}

	private _getAgentStateInfo(model: IChatModel | undefined | null): IVoiceAgentStateInfo {
		if (!model) {
			return { state: 'unknown' };
		}

		const lastRequest = model.getRequests().at(-1);

		if (lastRequest?.response?.isCanceled) {
			return { state: 'idle' };
		}

		const pendingConfirmation = lastRequest?.response?.isPendingConfirmation.get();
		const confirmation = this._getPendingConfirmationInfo(model);
		if (confirmation || (pendingConfirmation && !this._hasResolvedPendingToolApproval(model))) {
			return {
				state: 'waiting_for_confirmation',
				...(confirmation?.detail ? { detail: confirmation.detail } : !confirmation ? { detail: this._formatToolNarrationFallback() } : {}),
				confirmation_type: confirmation?.type ?? 'generic',
			};
		}

		const incomplete = lastRequest?.response?.isIncomplete.get() ?? false;
		if (incomplete) {
			return { state: 'thinking' };
		}

		const responseText = [
			lastRequest?.response?.response.getMarkdown().trim(),
			lastRequest?.response?.result?.errorDetails?.message.trim(),
		].filter(value => !!value).join('\n\n');
		return { state: 'idle', ...(responseText ? { last_response_summary: responseText } : {}) };
	}

	private _hasResolvedPendingToolApproval(model: IChatModel): boolean {
		const request = model.getRequests().at(-1);
		for (const part of request?.response?.response.value ?? []) {
			if (part.kind !== 'toolInvocation' || !this._isOpenPendingPart(part)) {
				continue;
			}
			const pendingId = derivePendingId(request!.id, part, this._store);
			if (isPendingIdResolved(pendingId)) {
				return true;
			}
		}
		return false;
	}

	private _buildPendingPayload(model: IChatModel | undefined | null): IVoiceSessionPending | undefined {
		const selected = this._selectPendingPart(model);
		if (!selected || (selected.type !== 'questionnaire' && selected.type !== 'plan' && selected.type !== 'tool')) {
			return undefined;
		}
		const { requestId, type, part } = selected;
		const routing = () => ({ pending_id: derivePendingId(requestId, part, this._store), request_id: requestId });
		if (type === 'questionnaire' && part.kind === 'questionCarousel') {
			const carousel = part as IChatQuestionCarousel;
			if (carousel.answeredExternally || carousel.questions.length === 0) {
				return undefined;
			}
			return {
				type: 'questions',
				...routing(),
				allow_skip: carousel.allowSkip === true,
				...(carousel.message ? { message: this._plainText(carousel.message) } : {}),
				questions: carousel.questions.map((question): IVoicePendingQuestion => ({
					id: question.id,
					type: question.type,
					title: this._plainText(getDisplayedQuestionText(question)),
					allow_freeform: question.allowFreeformInput !== false,
					options: getOptionsWithDefaultsFirst(question).map(({ option }) => ({
						label: option.label,
						value: option.value,
					})),
				})),
			};
		}
		if (type === 'plan' && part.kind === 'planReview') {
			return { type: 'approval', ...routing(), message: this._formatPlanNarration(part) };
		}
		if (type === 'tool' && part.kind === 'toolInvocation') {
			return { type: 'approval', ...routing(), message: this._formatToolNarration(part) };
		}

		return undefined;
	}

	private _plainText(value: string | IMarkdownString | undefined): string {
		if (!value) {
			return '';
		}
		return typeof value === 'string' ? value : value.value;
	}

	private _classifyPendingType(response: { response: { value: readonly { kind: string }[] } }): 'approval' | 'input' {
		let result: 'approval' | 'input' = 'input';
		for (const part of response.response.value) {
			if (part.kind === 'toolInvocation') {
				const invocation = part as IChatToolInvocation;
				const state = invocation.state.get();
				if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation ||
					state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
					result = 'approval';
				}
			}
			if (part.kind === 'confirmation' && !(part as { isUsed?: boolean }).isUsed) {
				result = 'approval';
			}
			if (part.kind === 'questionCarousel' && !(part as { isUsed?: boolean }).isUsed) {
				result = 'input';
			}
			if (part.kind === 'planReview' && !(part as { isUsed?: boolean }).isUsed) {
				result = 'input';
			}
			if (part.kind === 'elicitation2') {
				result = 'input';
			}
		}
		return result;
	}

	private _getConfirmationDescription(response: { response: { value: readonly { kind: string }[] } }): string {
		let desc = '';
		for (const part of response.response.value) {
			if (part.kind === 'toolInvocation') {
				const invocation = part as IChatToolInvocation;
				const state = invocation.state.get();
				if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
					const params = state.parameters as Record<string, unknown> | undefined;
					const command = params?.['command'] ?? params?.['input'];
					const explanation = params?.['explanation'] ?? params?.['goal'];
					if (typeof command === 'string' && command) {
						desc = typeof explanation === 'string' ? `${command} — ${explanation}` : command;
					}
				}
			} else if (part.kind === 'questionCarousel' && !(part as { isUsed?: boolean }).isUsed) {
				const carousel = part as { questions?: { title?: string }[]; message?: string | { value: string } };
				const titles = (carousel.questions ?? []).map(q => q.title).filter(Boolean);
				if (titles.length > 0) {
					desc = titles.join(', ');
				} else {
					const msg = carousel.message;
					desc = msg ? (typeof msg === 'string' ? msg : msg.value) : 'asking clarifying questions';
				}
			} else if (part.kind === 'elicitation2') {
				const elicitation = part as unknown as { state: IObservable<string>; title?: string | { value: string } };
				if (elicitation.state.get() === 'pending') {
					const title = elicitation.title;
					desc = title ? (typeof title === 'string' ? title : title.value) : 'needs input';
				}
			} else if (part.kind === 'planReview' && !(part as { isUsed?: boolean }).isUsed) {
				desc = 'review the plan to continue';
			} else if (part.kind === 'confirmation' && !(part as { isUsed?: boolean }).isUsed) {
				desc = (part as { title?: string }).title ?? 'needs approval';
			}
		}
		return desc;
	}

	private _autoApproveCheck(): void {
		if (this._autoApprovedSessions.size === 0) { return; }
		const sessions: any[] = [];
		for (const s of sessions) {
			if (!this._autoApprovedSessions.has(s.resource.toString())) { continue; }
			const model = this.chatService.getSession(s.resource);
			if (!model) { continue; }
			this._autoApprovePendingTools(model);
		}
	}

	private _autoApprovePendingTools(model: IChatModel): void {
		for (const request of model.getRequests()) {
			const response = request.response;
			if (!response?.isPendingConfirmation.get() || getVoiceConfirmationType(response.response.value) !== 'tool') {
				continue;
			}
			for (const part of response.response.value) {
				if (part.kind === 'toolInvocation') {
					IChatToolInvocation.confirmWith(part, { type: ToolConfirmKind.UserAction });
				}
			}
		}
	}


	private _getMachineId(): string {
		return (this.environmentService as { machineId?: string }).machineId ?? 'unknown';
	}


	async submitFeedback(feedbackText: string): Promise<{ ok: boolean; error?: string }> {
		let userId = this._userLogin;
		if (!userId) {
			try {
				const sessions = await this.authenticationService.getSessions('github');
				userId = sessions[0]?.account.label ?? 'unknown';
			} catch {
				userId = 'unknown';
			}
		}
		let transcriptHistory: IVoiceFeedbackTranscriptTurn[] = [];
		try {
			const turns = await this.voiceTranscriptStore.loadTurns(userId);
			transcriptHistory = turns.map(t => ({
				role: t.role,
				text: t.text,
				timestamp: t.timestamp,
			}));
		} catch (err) {
			this.logService.warn('[voice] failed to load transcript history for feedback', err);
		}

		const sessions: any[] = [];
		const clientSessionState: Record<string, unknown> = {
			voiceState: this._voiceState.get(),
			isConnected: this._isConnected.get(),
			isConnecting: this._isConnecting.get(),
			isReconnecting: this._isReconnecting.get(),
			pendingToolConfirmations: this._pendingToolConfirmations.get().map(tc => ({
				type: tc.type,
				sessionLabel: tc.sessionLabel,
				description: tc.description,
			})),
			activeSessions: sessions.map((s: any) => ({
				id: s.resource.toString(),
				label: s.label,
				status: s.status,
			})),
		};

		const clientEnvironment: Record<string, unknown> = {
			machineId: this._getMachineId(),
		};

		const payload: IVoiceFeedbackPayload = {
			feedbackText,
			machineId: this._getMachineId(),
			userId,
			sessionId: this.voiceClientService.currentSessionId ?? '',
			submissionId: generateUuid(),
			transcriptHistory,
			clientSessionState,
			clientEnvironment,
			timestamp: new Date().toISOString(),
		};

		return this.voiceClientService.submitFeedback(payload);
	}
}

registerSingleton(IVoiceSessionController, VoiceSessionController, InstantiationType.Delayed);
