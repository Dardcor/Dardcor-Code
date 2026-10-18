/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, IReader, observableValue } from '../../../../../base/common/observable.js';
import { hasKey } from '../../../../../base/common/types.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { VoiceCloseKind } from './voiceCloseCodes.js';
import { IChatToolInvocation, type ChatVoiceProgressStage } from '../chatService/chatService.js';

export function normalizeAgentsVoiceId(value: unknown): string {
	const voiceId = typeof value === 'string' ? value.trim() : '';
	switch (voiceId) {
		case 'harper_neutral':
		case 'birch_neutral':
		case 'junho_neutral':
		case 'oak_neutral':
			return voiceId;
		case 'victoria_neutral':
			return 'harper_neutral';
		case 'maya_neutral':
			return 'birch_neutral';
		case 'daniel_neutral':
			return 'junho_neutral';
		case 'kevin_neutral':
			return 'oak_neutral';
		default:
			return 'birch_neutral';
	}
}

export interface IVoicePendingOption {
	label: string;
	value: string;
}

export interface IVoicePendingQuestion {
	id: string;
	type: 'text' | 'singleSelect' | 'multiSelect';
	title: string;
	allow_freeform: boolean;
	options: IVoicePendingOption[];
}

export interface IVoiceSessionPending {
	type: 'questions' | 'approval';
	pending_id: string;
	request_id: string;
	allow_skip?: boolean;
	message?: string;
	questions?: IVoicePendingQuestion[];
}

const pendingOccurrenceTokens = new WeakMap<object, string>();
let pendingOccurrenceCounter = 0;

interface IActivePendingToolOccurrence {
	readonly requestId: string;
	readonly semanticKey: string;
	readonly token: string;
	readonly participants: Map<IChatToolInvocation, IDisposable>;
	resolved: boolean;
}

const activePendingToolOccurrences = new Map<string, IActivePendingToolOccurrence>();
const resolvedPendingToolOccurrences = new Map<string, IActivePendingToolOccurrence>();
const pendingToolOccurrenceByPart = new WeakMap<IChatToolInvocation, IActivePendingToolOccurrence>();
const pendingToolOccurrenceById = new Map<string, IActivePendingToolOccurrence>();
const pendingToolResolutionVersion = observableValue('pendingToolResolutionVersion', 0);
const MAX_RESOLVED_PENDING_TOOL_OCCURRENCES = 200;

function isPendingToolState(state: IChatToolInvocation.State): boolean {
	return state.type === IChatToolInvocation.StateKind.WaitingForConfirmation
		|| state.type === IChatToolInvocation.StateKind.WaitingForPostApproval
		|| state.type === IChatToolInvocation.StateKind.WaitingForAuthentication;
}

export function getVoiceToolApprovalCommand(invocation: IChatToolInvocation, includeParameters = true): string | undefined {
	const terminalData = invocation.toolSpecificData;
	let command: string | undefined;
	if (terminalData?.kind === 'terminal') {
		command = hasKey(terminalData, { commandLine: true })
			? terminalData.commandLine.userEdited
			?? terminalData.presentationOverrides?.commandLine
			?? terminalData.confirmation?.commandLine
			?? terminalData.commandLine.toolEdited
			?? terminalData.commandLine.original
			: terminalData.command;
	}
	if (!command && includeParameters) {
		const state = invocation.state.get();
		const parameters = state.type === IChatToolInvocation.StateKind.Streaming ? undefined : state.parameters as Record<string, unknown> | undefined;
		const parameterCommand = parameters?.['command'] ?? parameters?.['input'];
		command = typeof parameterCommand === 'string' ? parameterCommand : undefined;
	}
	return command?.trim() || undefined;
}

function pendingToolSemanticKey(requestId: string, invocation: IChatToolInvocation): string | undefined {
	const state = invocation.state.get();
	if (!isPendingToolState(state) || !invocation.toolCallId) {
		return undefined;
	}
	const phase = state.type === IChatToolInvocation.StateKind.WaitingForPostApproval
		? 'post'
		: state.type === IChatToolInvocation.StateKind.WaitingForAuthentication
			? 'authentication'
			: 'pre';
	const command = getVoiceToolApprovalCommand(invocation) ?? '';
	const authenticationResource = state.type === IChatToolInvocation.StateKind.WaitingForAuthentication ? state.server.resource : '';
	return JSON.stringify([requestId, invocation.toolCallId, phase, command, authenticationResource]);
}

function releasePendingToolParticipant(invocation: IChatToolInvocation, occurrence: IActivePendingToolOccurrence): void {
	occurrence.participants.get(invocation)?.dispose();
}

function pendingToolOccurrenceId(occurrence: IActivePendingToolOccurrence): string {
	return `${occurrence.requestId}#${occurrence.token}`;
}

function pruneResolvedPendingToolOccurrences(): void {
	while (resolvedPendingToolOccurrences.size > MAX_RESOLVED_PENDING_TOOL_OCCURRENCES) {
		const oldest = resolvedPendingToolOccurrences.entries().next().value;
		if (!oldest) {
			return;
		}
		const [semanticKey, occurrence] = oldest;
		resolvedPendingToolOccurrences.delete(semanticKey);
		if (occurrence.participants.size === 0 && pendingToolOccurrenceById.get(pendingToolOccurrenceId(occurrence)) === occurrence) {
			pendingToolOccurrenceById.delete(pendingToolOccurrenceId(occurrence));
		}
	}
}

function resolvePendingToolOccurrence(occurrence: IActivePendingToolOccurrence): void {
	if (occurrence.resolved) {
		return;
	}
	occurrence.resolved = true;
	if (activePendingToolOccurrences.get(occurrence.semanticKey) === occurrence) {
		activePendingToolOccurrences.delete(occurrence.semanticKey);
	}
	resolvedPendingToolOccurrences.delete(occurrence.semanticKey);
	resolvedPendingToolOccurrences.set(occurrence.semanticKey, occurrence);
	pruneResolvedPendingToolOccurrences();
	pendingToolResolutionVersion.set(pendingToolResolutionVersion.get() + 1, undefined);
}

function pendingToolOccurrence(requestId: string, invocation: IChatToolInvocation, mint: boolean, store?: DisposableStore, restoreResolved = false): IActivePendingToolOccurrence | undefined {
	const semanticKey = pendingToolSemanticKey(requestId, invocation);
	const current = pendingToolOccurrenceByPart.get(invocation);
	if (!semanticKey) {
		if (current) {
			releasePendingToolParticipant(invocation, current);
		}
		return undefined;
	}
	if (current?.semanticKey === semanticKey) {
		return current;
	}
	if (current) {
		resolvePendingToolOccurrence(current);
		releasePendingToolParticipant(invocation, current);
	}

	let occurrence = activePendingToolOccurrences.get(semanticKey);
	if (!occurrence && restoreResolved) {
		occurrence = resolvedPendingToolOccurrences.get(semanticKey);
	}
	if (!occurrence) {
		if (!mint) {
			return undefined;
		}
		occurrence = {
			requestId,
			semanticKey,
			token: `t${Date.now().toString(36)}-${++pendingOccurrenceCounter}`,
			participants: new Map(),
			resolved: false,
		};
		activePendingToolOccurrences.set(semanticKey, occurrence);
		pendingToolOccurrenceById.set(pendingToolOccurrenceId(occurrence), occurrence);
	}

	pendingToolOccurrenceByPart.set(invocation, occurrence);
	const trackedOccurrence = occurrence;
	const observer = new MutableDisposable();
	const tracking = toDisposable(() => {
		if (pendingToolOccurrenceByPart.get(invocation) === trackedOccurrence) {
			pendingToolOccurrenceByPart.delete(invocation);
		}
		store?.deleteAndLeak(tracking);
		if (trackedOccurrence.participants.get(invocation) === tracking) {
			trackedOccurrence.participants.delete(invocation);
		}
		if (trackedOccurrence.participants.size === 0 && activePendingToolOccurrences.get(trackedOccurrence.semanticKey) === trackedOccurrence) {
			activePendingToolOccurrences.delete(trackedOccurrence.semanticKey);
		}
		if (
			trackedOccurrence.participants.size === 0
			&& (!trackedOccurrence.resolved || resolvedPendingToolOccurrences.get(trackedOccurrence.semanticKey) !== trackedOccurrence)
			&& pendingToolOccurrenceById.get(pendingToolOccurrenceId(trackedOccurrence)) === trackedOccurrence
		) {
			pendingToolOccurrenceById.delete(pendingToolOccurrenceId(trackedOccurrence));
		}
		observer.dispose();
	});
	observer.value = autorun(reader => {
		if (!isPendingToolState(invocation.state.read(reader))) {
			resolvePendingToolOccurrence(trackedOccurrence);
			tracking.dispose();
		}
	});
	occurrence.participants.set(invocation, tracking);
	store?.add(tracking);
	return occurrence;
}

function fallbackPendingOccurrenceIdentity(part: object): object {
	const invocation = part as Partial<IChatToolInvocation>;
	if (invocation.kind !== 'toolInvocation' || !invocation.state) {
		return part;
	}
	const state = invocation.state.get();
	if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation
		|| state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
		return typeof state.confirm === 'function' ? state.confirm : part;
	}
	if (state.type === IChatToolInvocation.StateKind.WaitingForAuthentication) {
		return typeof state.cancel === 'function' ? state.cancel : part;
	}
	return part;
}



export function derivePendingId(requestId: string, part: object, store?: DisposableStore): string {
	const invocation = part as Partial<IChatToolInvocation>;
	if (invocation.kind === 'toolInvocation' && invocation.state) {
		const occurrence = pendingToolOccurrence(requestId, invocation as IChatToolInvocation, true, store);
		if (occurrence) {
			return `${requestId}#${occurrence.token}`;
		}
	}

	const fallbackIdentity = fallbackPendingOccurrenceIdentity(part);
	let token = pendingOccurrenceTokens.get(fallbackIdentity);
	if (token === undefined) {
		token = `p${++pendingOccurrenceCounter}`;
		pendingOccurrenceTokens.set(fallbackIdentity, token);
	}
	return `${requestId}#${token}`;
}

export function markPendingIdResolved(pendingId: string): boolean {
	const occurrence = pendingToolOccurrenceById.get(pendingId);
	if (!occurrence) {
		return false;
	}
	resolvePendingToolOccurrence(occurrence);
	return true;
}

export function isPendingIdResolved(pendingId: string, reader?: IReader): boolean {
	pendingToolResolutionVersion.read(reader);
	return pendingToolOccurrenceById.get(pendingId)?.resolved === true;
}

export function restoreResolvedPendingId(requestId: string, part: object, store?: DisposableStore): string | undefined {
	const invocation = part as Partial<IChatToolInvocation>;
	if (invocation.kind !== 'toolInvocation' || !invocation.state) {
		return undefined;
	}
	const occurrence = pendingToolOccurrence(requestId, invocation as IChatToolInvocation, false, store, true);
	return occurrence?.resolved ? pendingToolOccurrenceId(occurrence) : undefined;
}

export function peekPendingId(requestId: string, part: object): string | undefined {
	const invocation = part as Partial<IChatToolInvocation>;
	if (invocation.kind === 'toolInvocation' && invocation.state) {
		const occurrence = pendingToolOccurrence(requestId, invocation as IChatToolInvocation, false);
		if (occurrence && !occurrence.resolved) {
			return `${requestId}#${occurrence.token}`;
		}
	}
	const token = pendingOccurrenceTokens.get(fallbackPendingOccurrenceIdentity(part));
	return token === undefined ? undefined : `${requestId}#${token}`;
}

export interface IVoiceSessionContext {
	sessions: {
		id: string;
		label?: string;
		session_type?: 'agent' | 'chat';
		is_active: boolean;
		agent_state: string;
		agent_state_detail?: string;
		confirmation_type?: VoiceConfirmationType;
		selected_model?: IVoiceModelReference;
		attachment_names?: string[];
		attachment_count?: number;
		last_response_summary?: string;
		pending?: IVoiceSessionPending;
	}[];
	display_locale: string;
}

export interface IVoiceModelReference {
	readonly identifier: string;
	readonly name: string;
	readonly vendor: string;
}

export type VoiceConfirmationType = 'questionnaire' | 'elicitation' | 'plan' | 'tool' | 'generic';
export type VoiceCheckpointId = ChatVoiceProgressStage;

export function isVoiceCheckpointId(value: unknown): value is VoiceCheckpointId {
	return value === 'investigating' || value === 'planning' || value === 'editing' || value === 'validating' || value === 'recovering';
}

export interface IVoiceCheckpointNarrationMetadata {
	readonly requestId: string;
	readonly checkpointId: VoiceCheckpointId;
	readonly sequence: number;
}

export type VoiceNarrationKind = 'response' | 'confirmation' | 'question' | 'checkpoint';

export interface IVoiceDispatchResult {
	readonly ok: boolean;
	readonly reason?: 'stale_pending' | 'invalid_answer' | 'no_session' | 'unsupported';
}

export interface IVoiceTranscription {
	readonly text: string;
	readonly status?: 'partial' | 'final';
	readonly committed?: string;
	readonly turnId?: string;
	readonly revision?: number;
}

export interface IVoiceAudioResponse {
	readonly audio: string;
	readonly isFirstChunk: boolean;
	readonly isFinal: boolean;
	readonly codingSessionId?: string;
	readonly transcript?: string;
	readonly turnId?: string;
	readonly responseId?: string;
	readonly requestId?: string;
	readonly checkpointId?: VoiceCheckpointId;
	readonly sequence?: number;
	readonly narrationKind?: VoiceNarrationKind;
	readonly playbackId?: string;
}

export interface IVoiceBargeIn {
	readonly turnId: string;
	readonly interruptedTurnId: string;
}

export type IVoiceNarrationDisposition = 'accepted' | 'busy' | 'invalid' | 'suppressed';

export interface IVoiceNarrationAck {
	readonly narrationId: string;
	readonly codingSessionId: string;
	readonly disposition: IVoiceNarrationDisposition;
	readonly reason?: string;
}

export interface IVoiceNarrationSignal {
	readonly narrationId: string;
	readonly codingSessionId: string;
	readonly retryable?: boolean;
	readonly reason?: string;
}

export interface IVoiceToolCall {
	readonly callId: string;
	readonly name: string;
	readonly args: Record<string, unknown>;
}

export interface IVoiceSpeechStarted {
	readonly turnId?: string;
}

export interface IVoiceSessionInit {
	readonly sessionId: string;
}

export interface IVoiceTurnConfig {
	readonly auto_end_mode: 'off' | 'vad' | 'phrase' | 'both';
	readonly silence_ms: number;
	readonly stop_phrases: readonly string[];
	readonly vad_gate_asr: boolean;
}

export type IVoiceTurnAutoEndReason = 'vad_silence' | 'stop_phrase';

export interface IVoiceTurnAutoEnded {
	readonly reason: IVoiceTurnAutoEndReason;
	readonly turnId: string;
}

export interface IVoiceFatalDisconnect {
	readonly code: number;
	readonly reason: string;
	readonly kind?: VoiceCloseKind;
	readonly clientSide?: boolean;
}

export interface IVoiceConnectionIssue {
	readonly code: number;
	readonly reason: string;
}

export type IVoicePriorTimelineKind =
	| 'user_voice'
	| 'agent_voice'
	| 'agent_tool_call'
	| 'coding_event'
	| 'coding_agent_reply';

export interface IVoicePriorTimelineEntry {
	readonly kind: IVoicePriorTimelineKind;
	readonly timestamp: string;
	readonly text: string;
	readonly toolName?: string;
	readonly codingSessionId?: string;
	readonly codingStatus?: string;
}

export interface IVoiceFeedbackPayload {
	readonly feedbackText: string;
	readonly machineId: string;
	readonly userId: string;
	readonly sessionId: string;
	readonly submissionId: string;
	readonly transcriptHistory: readonly IVoiceFeedbackTranscriptTurn[];
	readonly clientSessionState: Record<string, unknown>;
	readonly clientEnvironment: Record<string, unknown>;
	readonly timestamp: string;
}

export interface IVoiceFeedbackTranscriptTurn {
	readonly role: 'user' | 'assistant';
	readonly text: string;
	readonly timestamp: string;
}

export interface IVoicePttStartOptions {
	readonly hasActiveSession: boolean;
	readonly passive?: boolean;
}

export interface IVoiceClientService {
	readonly _serviceBrand: undefined;

	connect(window: Window & typeof globalThis, authToken?: string): Promise<void>;
	disconnect(): void;

	sendPttStart(turnId: string, options: IVoicePttStartOptions): void;
	sendPttAudioChunk(audio: string): void;
	sendPttEnd(): void;
	sendPttDiagnostic(turnId: string, metrics: Record<string, unknown>): void;
	sendSessionContext(context: IVoiceSessionContext): void;
	flushSessionContext(): void;
	invalidateSessionCache(sessionId: string): void;
	sendToolResult(callId: string, result: string | IVoiceDispatchResult): void;
	sendNarrationPlaybackComplete(codingSessionId: string, narrationId: string, playbackId: string): void;
	requestNarration(codingSessionId: string, kind: VoiceNarrationKind, text: string, narrationId?: string, checkpoint?: IVoiceCheckpointNarrationMetadata, confirmationType?: VoiceConfirmationType, pending?: { pendingId: string }): string | undefined;
	sendSessionStateChange(sessionId: string, newState: string, label: string, detail?: string, lastResponseSummary?: string): void;
	stopSpeaking(): void;
	sendStartSession(context: IVoiceSessionContext, machineId: string, priorTimeline?: readonly IVoicePriorTimelineEntry[], turnConfigOverride?: IVoiceTurnConfig, voiceInstructions?: string): void;
	sendResumeSession(context: IVoiceSessionContext, machineId: string, voiceInstructions?: string): void;

	submitFeedback(payload: IVoiceFeedbackPayload): Promise<{ ok: boolean; error?: string }>;

	readonly onTranscription: Event<IVoiceTranscription>;
	readonly onAudioResponse: Event<IVoiceAudioResponse>;
	readonly onBargeIn: Event<IVoiceBargeIn>;
	readonly onNarrationAck: Event<IVoiceNarrationAck>;
	readonly onNarrationUnblocked: Event<IVoiceNarrationSignal>;
	readonly onNarrationInterrupted: Event<IVoiceNarrationSignal>;
	readonly onToolCall: Event<IVoiceToolCall>;
	readonly onSpeechStarted: Event<IVoiceSpeechStarted>;
	readonly onSessionInit: Event<IVoiceSessionInit>;
	readonly onError: Event<string>;
	readonly onDidChangeConnectionState: Event<boolean>;
	readonly onFatalDisconnect: Event<IVoiceFatalDisconnect>;

	readonly onConnectionIssue: Event<IVoiceConnectionIssue>;
	readonly onTurnAutoEnded: Event<IVoiceTurnAutoEnded>;

	readonly isConnected: boolean;
	readonly isResuming: boolean;
	readonly willReconnect: boolean;
	readonly currentSessionId: string | undefined;
}

export const IVoiceClientService = createDecorator<IVoiceClientService>('voiceClientService');
export const VOICE_AGENT_PROGRESS_SETTING = 'agents.voice.agentProgress';
