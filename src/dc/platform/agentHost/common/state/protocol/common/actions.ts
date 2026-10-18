/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from './state.js';

import type { RootAgentsChangedAction, RootActiveSessionsChangedAction, RootTerminalsChangedAction, RootConfigChangedAction } from '../channels-root/actions.js';

import type { SessionReadyAction, SessionCreationFailedAction, SessionChatAddedAction, SessionChatRemovedAction, SessionChatUpdatedAction, SessionDefaultChatChangedAction, SessionTitleChangedAction, SessionServerToolsChangedAction, SessionActiveClientSetAction, SessionActiveClientRemovedAction, SessionWorkingDirectorySetAction, SessionWorkingDirectoryRemovedAction, SessionWorkingDirectoryReplacedAction, SessionInputNeededSetAction, SessionInputNeededRemovedAction, SessionCustomizationsChangedAction, SessionCustomizationToggledAction, SessionCustomizationUpdatedAction, SessionCustomizationRemovedAction, SessionMcpServerStateChangedAction, SessionMcpServerStartRequestedAction, SessionMcpServerStopRequestedAction, SessionIsReadChangedAction, SessionIsArchivedChangedAction, SessionActivityChangedAction, SessionChangesetsChangedAction, SessionConfigChangedAction, SessionMetaChangedAction } from '../channels-session/actions.js';

import type { ChatTurnStartedAction, ChatDeltaAction, ChatResponsePartAction, ChatToolCallStartAction, ChatToolCallDeltaAction, ChatToolCallReadyAction, ChatToolCallConfirmedAction, ChatToolCallCompleteAction, ChatToolCallResultConfirmedAction, ChatToolCallContentChangedAction, ChatToolCallAuthRequiredAction, ChatToolCallAuthResolvedAction, ChatTurnCompleteAction, ChatTurnCancelledAction, ChatErrorAction, ChatTurnResumeAction, ChatActivityChangedAction, ChatWorkingDirectorySetAction, ChatWorkingDirectoryRemovedAction, ChatUsageAction, ChatReasoningAction, ChatPendingMessageSetAction, ChatPendingMessageRemovedAction, ChatQueuedMessagesReorderedAction, ChatDraftChangedAction, ChatInputRequestedAction, ChatInputAnswerChangedAction, ChatInputCompletedAction, ChatTruncatedAction, ChatTurnsLoadedAction } from '../channels-chat/actions.js';

import type { ChangesetStatusChangedAction, ChangesetFileSetAction, ChangesetFileRemovedAction, ChangesetFilesReviewChangedAction, ChangesetContentChangedAction, ChangesetOperationsChangedAction, ChangesetOperationStatusChangedAction, ChangesetClearedAction } from '../channels-changeset/actions.js';

import type { AnnotationsSetAction, AnnotationsUpdatedAction, AnnotationsRemovedAction, AnnotationsEntrySetAction, AnnotationsEntryRemovedAction } from '../channels-annotations/actions.js';

import type { TerminalDataAction, TerminalInputAction, TerminalResizedAction, TerminalClaimedAction, TerminalTitleChangedAction, TerminalCwdChangedAction, TerminalExitedAction, TerminalClearedAction, TerminalCommandDetectionAvailableAction, TerminalCommandExecutedAction, TerminalCommandFinishedAction } from '../channels-terminal/actions.js';

import type { ResourceWatchChangedAction } from '../channels-resource-watch/actions.js';
import type { AutomationCreateRequestedAction, AutomationRemovedAction, AutomationSetAction, AutomationUpdateRequestedAction } from '../channels-automation/actions.js';
import type { AutomationRunLifecycleChangedAction, AutomationRunSessionSetAction, AutomationRunSessionRemovedAction, AutomationRunPrimarySessionChangedAction, AutomationRunCancelRequestedAction } from '../channels-automation-run/actions.js';


export const enum ActionType {
	RootAgentsChanged = 'root/agentsChanged',
	RootActiveSessionsChanged = 'root/activeSessionsChanged',
	SessionReady = 'session/ready',
	SessionCreationFailed = 'session/creationFailed',
	SessionChatAdded = 'session/chatAdded',
	SessionChatRemoved = 'session/chatRemoved',
	SessionChatUpdated = 'session/chatUpdated',
	SessionDefaultChatChanged = 'session/defaultChatChanged',
	ChatTurnStarted = 'chat/turnStarted',
	ChatDelta = 'chat/delta',
	ChatResponsePart = 'chat/responsePart',
	ChatToolCallStart = 'chat/toolCallStart',
	ChatToolCallDelta = 'chat/toolCallDelta',
	ChatToolCallReady = 'chat/toolCallReady',
	ChatToolCallConfirmed = 'chat/toolCallConfirmed',
	ChatToolCallComplete = 'chat/toolCallComplete',
	ChatToolCallResultConfirmed = 'chat/toolCallResultConfirmed',
	ChatToolCallContentChanged = 'chat/toolCallContentChanged',
	ChatToolCallAuthRequired = 'chat/toolCallAuthRequired',
	ChatToolCallAuthResolved = 'chat/toolCallAuthResolved',
	ChatTurnComplete = 'chat/turnComplete',
	ChatTurnCancelled = 'chat/turnCancelled',
	ChatError = 'chat/error',
	ChatTurnResume = 'chat/turnResume',
	ChatActivityChanged = 'chat/activityChanged',
	ChatWorkingDirectorySet = 'chat/workingDirectorySet',
	ChatWorkingDirectoryRemoved = 'chat/workingDirectoryRemoved',
	SessionTitleChanged = 'session/titleChanged',
	ChatUsage = 'chat/usage',
	ChatReasoning = 'chat/reasoning',
	SessionServerToolsChanged = 'session/serverToolsChanged',
	SessionActiveClientSet = 'session/activeClientSet',
	SessionActiveClientRemoved = 'session/activeClientRemoved',
	SessionWorkingDirectorySet = 'session/workingDirectorySet',
	SessionWorkingDirectoryRemoved = 'session/workingDirectoryRemoved',
	SessionWorkingDirectoryReplaced = 'session/workingDirectoryReplaced',
	SessionInputNeededSet = 'session/inputNeededSet',
	SessionInputNeededRemoved = 'session/inputNeededRemoved',
	ChatPendingMessageSet = 'chat/pendingMessageSet',
	ChatPendingMessageRemoved = 'chat/pendingMessageRemoved',
	ChatQueuedMessagesReordered = 'chat/queuedMessagesReordered',
	ChatDraftChanged = 'chat/draftChanged',
	ChatInputRequested = 'chat/inputRequested',
	ChatInputAnswerChanged = 'chat/inputAnswerChanged',
	ChatInputCompleted = 'chat/inputCompleted',
	SessionCustomizationsChanged = 'session/customizationsChanged',
	SessionCustomizationToggled = 'session/customizationToggled',
	SessionCustomizationUpdated = 'session/customizationUpdated',
	SessionCustomizationRemoved = 'session/customizationRemoved',
	SessionMcpServerStateChanged = 'session/mcpServerStateChanged',
	SessionMcpServerStartRequested = 'session/mcpServerStartRequested',
	SessionMcpServerStopRequested = 'session/mcpServerStopRequested',
	ChatTruncated = 'chat/truncated',
	ChatTurnsLoaded = 'chat/turnsLoaded',
	SessionIsReadChanged = 'session/isReadChanged',
	SessionIsArchivedChanged = 'session/isArchivedChanged',
	SessionActivityChanged = 'session/activityChanged',
	SessionChangesetsChanged = 'session/changesetsChanged',
	SessionConfigChanged = 'session/configChanged',
	SessionMetaChanged = 'session/metaChanged',
	ChangesetStatusChanged = 'changeset/statusChanged',
	ChangesetFileSet = 'changeset/fileSet',
	ChangesetFileRemoved = 'changeset/fileRemoved',
	ChangesetFilesReviewChanged = 'changeset/filesReviewChanged',
	ChangesetContentChanged = 'changeset/contentChanged',
	ChangesetOperationsChanged = 'changeset/operationsChanged',
	ChangesetOperationStatusChanged = 'changeset/operationStatusChanged',
	ChangesetCleared = 'changeset/cleared',
	AnnotationsSet = 'annotations/set',
	AnnotationsUpdated = 'annotations/updated',
	AnnotationsRemoved = 'annotations/removed',
	AnnotationsEntrySet = 'annotations/entrySet',
	AnnotationsEntryRemoved = 'annotations/entryRemoved',
	RootTerminalsChanged = 'root/terminalsChanged',
	RootConfigChanged = 'root/configChanged',
	TerminalData = 'terminal/data',
	TerminalInput = 'terminal/input',
	TerminalResized = 'terminal/resized',
	TerminalClaimed = 'terminal/claimed',
	TerminalTitleChanged = 'terminal/titleChanged',
	TerminalCwdChanged = 'terminal/cwdChanged',
	TerminalExited = 'terminal/exited',
	TerminalCleared = 'terminal/cleared',
	TerminalCommandDetectionAvailable = 'terminal/commandDetectionAvailable',
	TerminalCommandExecuted = 'terminal/commandExecuted',
	TerminalCommandFinished = 'terminal/commandFinished',
	ResourceWatchChanged = 'resourceWatch/changed',
	AutomationCreateRequested = 'automation/createRequested',
	AutomationUpdateRequested = 'automation/updateRequested',
	AutomationSet = 'automation/set',
	AutomationRemoved = 'automation/removed',
	AutomationRunLifecycleChanged = 'automationRun/lifecycleChanged',
	AutomationRunSessionSet = 'automationRun/sessionSet',
	AutomationRunSessionRemoved = 'automationRun/sessionRemoved',
	AutomationRunPrimarySessionChanged = 'automationRun/primarySessionChanged',
	AutomationRunCancelRequested = 'automationRun/cancelRequested',
}


export interface ActionOrigin {
	clientId: string;
	clientSeq: number;
}

export interface ActionEnvelope {
	readonly channel: URI;
	readonly action: StateAction;
	readonly serverSeq: number;
	readonly origin: ActionOrigin | undefined;
	readonly rejectionReason?: string;
}


export type StateAction =
	| RootAgentsChangedAction
	| RootActiveSessionsChangedAction
	| RootTerminalsChangedAction
	| RootConfigChangedAction
	| SessionReadyAction
	| SessionCreationFailedAction
	| SessionChatAddedAction
	| SessionChatRemovedAction
	| SessionChatUpdatedAction
	| SessionDefaultChatChangedAction
	| SessionTitleChangedAction
	| SessionServerToolsChangedAction
	| SessionActiveClientSetAction
	| SessionActiveClientRemovedAction
	| SessionWorkingDirectorySetAction
	| SessionWorkingDirectoryRemovedAction
	| SessionWorkingDirectoryReplacedAction
	| SessionInputNeededSetAction
	| SessionInputNeededRemovedAction
	| SessionCustomizationsChangedAction
	| SessionCustomizationToggledAction
	| SessionCustomizationUpdatedAction
	| SessionCustomizationRemovedAction
	| SessionMcpServerStateChangedAction
	| SessionMcpServerStartRequestedAction
	| SessionMcpServerStopRequestedAction
	| SessionIsReadChangedAction
	| SessionIsArchivedChangedAction
	| SessionActivityChangedAction
	| SessionChangesetsChangedAction
	| SessionConfigChangedAction
	| SessionMetaChangedAction
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
	| ChatPendingMessageSetAction
	| ChatPendingMessageRemovedAction
	| ChatQueuedMessagesReorderedAction
	| ChatDraftChangedAction
	| ChatInputRequestedAction
	| ChatInputAnswerChangedAction
	| ChatInputCompletedAction
	| ChatTruncatedAction
	| ChatTurnsLoadedAction
	| ChangesetStatusChangedAction
	| ChangesetFileSetAction
	| ChangesetFileRemovedAction
	| ChangesetFilesReviewChangedAction
	| ChangesetContentChangedAction
	| ChangesetOperationsChangedAction
	| ChangesetOperationStatusChangedAction
	| ChangesetClearedAction
	| AnnotationsSetAction
	| AnnotationsUpdatedAction
	| AnnotationsRemovedAction
	| AnnotationsEntrySetAction
	| AnnotationsEntryRemovedAction
	| TerminalDataAction
	| TerminalInputAction
	| TerminalResizedAction
	| TerminalClaimedAction
	| TerminalTitleChangedAction
	| TerminalCwdChangedAction
	| TerminalExitedAction
	| TerminalClearedAction
	| TerminalCommandDetectionAvailableAction
	| TerminalCommandExecutedAction
	| TerminalCommandFinishedAction
	| ResourceWatchChangedAction
	| AutomationCreateRequestedAction
	| AutomationUpdateRequestedAction
	| AutomationSetAction
	| AutomationRemovedAction
	| AutomationRunLifecycleChangedAction
	| AutomationRunSessionSetAction
	| AutomationRunSessionRemovedAction
	| AutomationRunPrimarySessionChangedAction
	| AutomationRunCancelRequestedAction;
