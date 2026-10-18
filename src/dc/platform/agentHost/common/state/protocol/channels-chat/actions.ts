/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { StringOrMarkdown, FileEdit, UsageInfo, URI } from '../common/state.js';
import type { McpAuthRequirement } from '../channels-session/state.js';
import { ToolCallConfirmationReason, ToolCallCancellationReason, PendingMessageKind, type Message, type ResponsePart, type ToolCallResult, type ToolResultContent, type ChatInputAnswer, type ChatInputRequest, type ChatInputResponseKind, type ConfirmationOption, type ErrorResponsePart, type ToolCallContributor, type ToolCallRiskAssessment, type ToolInput, type Turn } from './state.js';


interface ToolCallActionBase {
	turnId: string;
	toolCallId: string;
	_meta?: Record<string, unknown>;
}



export interface ChatTurnStartedAction {
	type: ActionType.ChatTurnStarted;
	turnId: string;
	startedAt: string;
	message: Message;
	queuedMessageId?: string;
	_meta?: Record<string, unknown>;
}

export interface ChatDeltaAction {
	type: ActionType.ChatDelta;
	turnId: string;
	partId: string;
	content: string;
	_meta?: Record<string, unknown>;
}

export interface ChatResponsePartAction {
	type: ActionType.ChatResponsePart;
	turnId: string;
	part: ResponsePart;
	_meta?: Record<string, unknown>;
}

export interface ChatToolCallStartAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallStart;
	toolName: string;
	displayName: string;
	intention?: string;
	contributor?: ToolCallContributor;
}

export interface ChatToolCallDeltaAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallDelta;
	content?: string;
	invocationMessage?: StringOrMarkdown;
}

export interface ChatToolCallReadyAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallReady;
	contributor?: ToolCallContributor;
	intention?: string;
	invocationMessage: StringOrMarkdown;
	toolInput?: ToolInput;
	confirmationTitle?: StringOrMarkdown;
	riskAssessment?: ToolCallRiskAssessment;
	edits?: { items: FileEdit[] };
	editable?: boolean;
	confirmed?: ToolCallConfirmationReason;
	options?: ConfirmationOption[];
}

export interface ChatToolCallApprovedAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallConfirmed;
	approved: true;
	confirmed: ToolCallConfirmationReason;
	editedToolInput?: string;
	selectedOptionId?: string;
}

export interface ChatToolCallDeniedAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallConfirmed;
	approved: false;
	reason: ToolCallCancellationReason.Denied | ToolCallCancellationReason.Skipped;
	userSuggestion?: Message;
	reasonMessage?: StringOrMarkdown;
	selectedOptionId?: string;
}

export type ChatToolCallConfirmedAction =
	| ChatToolCallApprovedAction
	| ChatToolCallDeniedAction;

export interface ChatToolCallCompleteAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallComplete;
	result: ToolCallResult;
	requiresResultConfirmation?: boolean;
}

export interface ChatToolCallResultConfirmedAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallResultConfirmed;
	approved: boolean;
}

export interface ChatToolCallContentChangedAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallContentChanged;
	content: ToolResultContent[];
}

export interface ChatToolCallAuthRequiredAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallAuthRequired;
	auth: McpAuthRequirement;
}

export interface ChatToolCallAuthResolvedAction extends ToolCallActionBase {
	type: ActionType.ChatToolCallAuthResolved;
}

export interface ChatTurnCompleteAction {
	type: ActionType.ChatTurnComplete;
	turnId: string;
	duration: number;
	_meta?: Record<string, unknown>;
}

export interface ChatTurnCancelledAction {
	type: ActionType.ChatTurnCancelled;
	turnId: string;
	duration: number;
	_meta?: Record<string, unknown>;
}

export interface ChatErrorAction {
	type: ActionType.ChatError;
	turnId: string;
	duration: number;
	part: ErrorResponsePart;
	_meta?: Record<string, unknown>;
}

export interface ChatTurnResumeAction {
	type: ActionType.ChatTurnResume;
	turnId: string;
}

export interface ChatActivityChangedAction {
	type: ActionType.ChatActivityChanged;
	activity?: string;
}

export interface ChatWorkingDirectorySetAction {
	type: ActionType.ChatWorkingDirectorySet;
	directory: URI;
}

export interface ChatWorkingDirectoryRemovedAction {
	type: ActionType.ChatWorkingDirectoryRemoved;
	directory: URI;
}

export interface ChatUsageAction {
	type: ActionType.ChatUsage;
	turnId: string;
	usage: UsageInfo;
	_meta?: Record<string, unknown>;
}

export interface ChatReasoningAction {
	type: ActionType.ChatReasoning;
	turnId: string;
	partId: string;
	content: string;
	_meta?: Record<string, unknown>;
}



export interface ChatTruncatedAction {
	type: ActionType.ChatTruncated;
	turnId?: string;
}

export interface ChatTurnsLoadedAction {
	type: ActionType.ChatTurnsLoaded;
	turns: Turn[];
	turnsNextCursor?: string;
}


export interface ChatPendingMessageSetAction {
	type: ActionType.ChatPendingMessageSet;
	kind: PendingMessageKind;
	id: string;
	message: Message;
}

export interface ChatPendingMessageRemovedAction {
	type: ActionType.ChatPendingMessageRemoved;
	kind: PendingMessageKind;
	id: string;
}

export interface ChatQueuedMessagesReorderedAction {
	type: ActionType.ChatQueuedMessagesReordered;
	order: string[];
}


export interface ChatDraftChangedAction {
	type: ActionType.ChatDraftChanged;
	draft?: Message;
}


export interface ChatInputRequestedAction {
	type: ActionType.ChatInputRequested;
	request: ChatInputRequest;
}

export interface ChatInputAnswerChangedAction {
	type: ActionType.ChatInputAnswerChanged;
	requestId: string;
	questionId: string;
	answer?: ChatInputAnswer;
}

export interface ChatInputCompletedAction {
	type: ActionType.ChatInputCompleted;
	requestId: string;
	response: ChatInputResponseKind;
	answers?: Record<string, ChatInputAnswer>;
}


export type ChatAction =
	| ChatTurnStartedAction
	| ChatDeltaAction
	| ChatResponsePartAction
	| ChatToolCallStartAction
	| ChatToolCallDeltaAction
	| ChatToolCallReadyAction
	| ChatToolCallConfirmedAction
	| ChatToolCallCompleteAction
	| ChatToolCallResultConfirmedAction
	| ChatToolCallContentChangedAction
	| ChatToolCallAuthRequiredAction
	| ChatToolCallAuthResolvedAction
	| ChatTurnCompleteAction
	| ChatTurnCancelledAction
	| ChatErrorAction
	| ChatTurnResumeAction
	| ChatActivityChangedAction
	| ChatWorkingDirectorySetAction
	| ChatWorkingDirectoryRemovedAction
	| ChatUsageAction
	| ChatReasoningAction
	| ChatTruncatedAction
	| ChatTurnsLoadedAction
	| ChatPendingMessageSetAction
	| ChatPendingMessageRemovedAction
	| ChatQueuedMessagesReorderedAction
	| ChatDraftChangedAction
	| ChatInputRequestedAction
	| ChatInputAnswerChangedAction
	| ChatInputCompletedAction
	;
