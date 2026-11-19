/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



import { ActionType, type StateAction, type RootAgentsChangedAction, type RootActiveSessionsChangedAction, type RootTerminalsChangedAction, type RootConfigChangedAction, type SessionReadyAction, type SessionCreationFailedAction, type SessionChatAddedAction, type SessionChatRemovedAction, type SessionChatUpdatedAction, type SessionDefaultChatChangedAction, type SessionTitleChangedAction, type SessionServerToolsChangedAction, type SessionActiveClientSetAction, type SessionActiveClientRemovedAction, type SessionWorkingDirectorySetAction, type SessionWorkingDirectoryRemovedAction, type SessionWorkingDirectoryReplacedAction, type SessionInputNeededSetAction, type SessionInputNeededRemovedAction, type SessionCustomizationsChangedAction, type SessionCustomizationToggledAction, type SessionCustomizationUpdatedAction, type SessionCustomizationRemovedAction, type SessionMcpServerStateChangedAction, type SessionMcpServerStartRequestedAction, type SessionMcpServerStopRequestedAction, type SessionIsReadChangedAction, type SessionIsArchivedChangedAction, type SessionActivityChangedAction, type SessionChangesetsChangedAction, type SessionConfigChangedAction, type SessionMetaChangedAction, type ChatTurnStartedAction, type ChatDeltaAction, type ChatResponsePartAction, type ChatToolCallStartAction, type ChatToolCallDeltaAction, type ChatToolCallReadyAction, type ChatToolCallConfirmedAction, type ChatToolCallCompleteAction, type ChatToolCallResultConfirmedAction, type ChatToolCallContentChangedAction, type ChatToolCallAuthRequiredAction, type ChatToolCallAuthResolvedAction, type ChatTurnCompleteAction, type ChatTurnCancelledAction, type ChatErrorAction, type ChatTurnResumeAction, type ChatActivityChangedAction, type ChatWorkingDirectorySetAction, type ChatWorkingDirectoryRemovedAction, type ChatUsageAction, type ChatReasoningAction, type ChatPendingMessageSetAction, type ChatPendingMessageRemovedAction, type ChatQueuedMessagesReorderedAction, type ChatDraftChangedAction, type ChatInputRequestedAction, type ChatInputAnswerChangedAction, type ChatInputCompletedAction, type ChatTruncatedAction, type ChatTurnsLoadedAction, type ChangesetStatusChangedAction, type ChangesetFileSetAction, type ChangesetFileRemovedAction, type ChangesetFilesReviewChangedAction, type ChangesetContentChangedAction, type ChangesetOperationsChangedAction, type ChangesetOperationStatusChangedAction, type ChangesetClearedAction, type AnnotationsSetAction, type AnnotationsUpdatedAction, type AnnotationsRemovedAction, type AnnotationsEntrySetAction, type AnnotationsEntryRemovedAction, type TerminalDataAction, type TerminalInputAction, type TerminalResizedAction, type TerminalClaimedAction, type TerminalTitleChangedAction, type TerminalCwdChangedAction, type TerminalExitedAction, type TerminalClearedAction, type TerminalCommandDetectionAvailableAction, type TerminalCommandExecutedAction, type TerminalCommandFinishedAction, type ResourceWatchChangedAction, type AutomationCreateRequestedAction, type AutomationUpdateRequestedAction, type AutomationSetAction, type AutomationRemovedAction, type AutomationRunLifecycleChangedAction, type AutomationRunSessionSetAction, type AutomationRunSessionRemovedAction, type AutomationRunPrimarySessionChangedAction, type AutomationRunCancelRequestedAction } from './actions.js';



export type RootAction =
	| RootAgentsChangedAction
	| RootActiveSessionsChangedAction
	| RootTerminalsChangedAction
	| RootConfigChangedAction
	;

export type ClientRootAction =
	| RootConfigChangedAction
	;

export type ServerRootAction =
	| RootAgentsChangedAction
	| RootActiveSessionsChangedAction
	| RootTerminalsChangedAction
	;

export type SessionAction =
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
	;

export type ClientSessionAction =
	| SessionTitleChangedAction
	| SessionActiveClientSetAction
	| SessionActiveClientRemovedAction
	| SessionWorkingDirectorySetAction
	| SessionWorkingDirectoryRemovedAction
	| SessionWorkingDirectoryReplacedAction
	| SessionCustomizationToggledAction
	| SessionMcpServerStartRequestedAction
	| SessionMcpServerStopRequestedAction
	| SessionIsReadChangedAction
	| SessionIsArchivedChangedAction
	| SessionConfigChangedAction
	;

export type ServerSessionAction =
	| SessionReadyAction
	| SessionCreationFailedAction
	| SessionChatAddedAction
	| SessionChatRemovedAction
	| SessionChatUpdatedAction
	| SessionDefaultChatChangedAction
	| SessionServerToolsChangedAction
	| SessionInputNeededSetAction
	| SessionInputNeededRemovedAction
	| SessionCustomizationsChangedAction
	| SessionCustomizationUpdatedAction
	| SessionCustomizationRemovedAction
	| SessionMcpServerStateChangedAction
	| SessionActivityChangedAction
	| SessionChangesetsChangedAction
	| SessionMetaChangedAction
	;

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
	| ChatPendingMessageSetAction
	| ChatPendingMessageRemovedAction
	| ChatQueuedMessagesReorderedAction
	| ChatDraftChangedAction
	| ChatInputRequestedAction
	| ChatInputAnswerChangedAction
	| ChatInputCompletedAction
	| ChatTruncatedAction
	| ChatTurnsLoadedAction
	;

export type ClientChatAction =
	| ChatTurnStartedAction
	| ChatToolCallConfirmedAction
	| ChatToolCallCompleteAction
	| ChatToolCallResultConfirmedAction
	| ChatToolCallContentChangedAction
	| ChatTurnCancelledAction
	| ChatTurnResumeAction
	| ChatWorkingDirectorySetAction
	| ChatWorkingDirectoryRemovedAction
	| ChatPendingMessageSetAction
	| ChatPendingMessageRemovedAction
	| ChatQueuedMessagesReorderedAction
	| ChatDraftChangedAction
	| ChatInputAnswerChangedAction
	| ChatInputCompletedAction
	| ChatTruncatedAction
	;

export type ServerChatAction =
	| ChatDeltaAction
	| ChatResponsePartAction
	| ChatToolCallStartAction
	| ChatToolCallDeltaAction
	| ChatToolCallReadyAction
	| ChatToolCallAuthRequiredAction
	| ChatToolCallAuthResolvedAction
	| ChatTurnCompleteAction
	| ChatErrorAction
	| ChatActivityChangedAction
	| ChatUsageAction
	| ChatReasoningAction
	| ChatInputRequestedAction
	| ChatTurnsLoadedAction
	;

export type TerminalAction =
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
	;

export type ClientTerminalAction =
	| TerminalInputAction
	| TerminalResizedAction
	| TerminalClaimedAction
	| TerminalTitleChangedAction
	| TerminalClearedAction
	;

export type ServerTerminalAction =
	| TerminalDataAction
	| TerminalCwdChangedAction
	| TerminalExitedAction
	| TerminalCommandDetectionAvailableAction
	| TerminalCommandExecutedAction
	| TerminalCommandFinishedAction
	;

export type ChangesetAction =
	| ChangesetStatusChangedAction
	| ChangesetFileSetAction
	| ChangesetFileRemovedAction
	| ChangesetFilesReviewChangedAction
	| ChangesetContentChangedAction
	| ChangesetOperationsChangedAction
	| ChangesetOperationStatusChangedAction
	| ChangesetClearedAction
	;

export type ClientChangesetAction =
	| ChangesetFilesReviewChangedAction
	;

export type ServerChangesetAction =
	| ChangesetStatusChangedAction
	| ChangesetFileSetAction
	| ChangesetFileRemovedAction
	| ChangesetContentChangedAction
	| ChangesetOperationsChangedAction
	| ChangesetOperationStatusChangedAction
	| ChangesetClearedAction
	;

export type AnnotationsAction =
	| AnnotationsSetAction
	| AnnotationsUpdatedAction
	| AnnotationsRemovedAction
	| AnnotationsEntrySetAction
	| AnnotationsEntryRemovedAction
	;

export type ClientAnnotationsAction =
	| AnnotationsSetAction
	| AnnotationsUpdatedAction
	| AnnotationsRemovedAction
	| AnnotationsEntrySetAction
	| AnnotationsEntryRemovedAction
	;

export type ServerAnnotationsAction =
	never
	;

export type ResourceWatchAction =
	| ResourceWatchChangedAction
	;

export type ClientResourceWatchAction =
	never
	;

export type ServerResourceWatchAction =
	| ResourceWatchChangedAction
	;

export type AutomationAction =
	| AutomationCreateRequestedAction
	| AutomationUpdateRequestedAction
	| AutomationSetAction
	| AutomationRemovedAction
	;

export type ClientAutomationAction =
	| AutomationCreateRequestedAction
	| AutomationUpdateRequestedAction
	| AutomationRemovedAction
	;

export type ServerAutomationAction =
	| AutomationSetAction
	;

export type AutomationRunAction =
	| AutomationRunLifecycleChangedAction
	| AutomationRunSessionSetAction
	| AutomationRunSessionRemovedAction
	| AutomationRunPrimarySessionChangedAction
	| AutomationRunCancelRequestedAction
	;

export type ClientAutomationRunAction =
	| AutomationRunCancelRequestedAction
	;

export type ServerAutomationRunAction =
	| AutomationRunLifecycleChangedAction
	| AutomationRunSessionSetAction
	| AutomationRunSessionRemovedAction
	| AutomationRunPrimarySessionChangedAction
	;


export const IS_CLIENT_DISPATCHABLE: { readonly [K in StateAction['type']]: boolean } = {
	[ActionType.RootAgentsChanged]: false,
	[ActionType.RootActiveSessionsChanged]: false,
	[ActionType.RootTerminalsChanged]: false,
	[ActionType.RootConfigChanged]: true,
	[ActionType.SessionReady]: false,
	[ActionType.SessionCreationFailed]: false,
	[ActionType.SessionChatAdded]: false,
	[ActionType.SessionChatRemoved]: false,
	[ActionType.SessionChatUpdated]: false,
	[ActionType.SessionDefaultChatChanged]: false,
	[ActionType.SessionTitleChanged]: true,
	[ActionType.SessionServerToolsChanged]: false,
	[ActionType.SessionActiveClientSet]: true,
	[ActionType.SessionActiveClientRemoved]: true,
	[ActionType.SessionWorkingDirectorySet]: true,
	[ActionType.SessionWorkingDirectoryRemoved]: true,
	[ActionType.SessionWorkingDirectoryReplaced]: true,
	[ActionType.SessionInputNeededSet]: false,
	[ActionType.SessionInputNeededRemoved]: false,
	[ActionType.SessionCustomizationsChanged]: false,
	[ActionType.SessionCustomizationToggled]: true,
	[ActionType.SessionCustomizationUpdated]: false,
	[ActionType.SessionCustomizationRemoved]: false,
	[ActionType.SessionMcpServerStateChanged]: false,
	[ActionType.SessionMcpServerStartRequested]: true,
	[ActionType.SessionMcpServerStopRequested]: true,
	[ActionType.SessionIsReadChanged]: true,
	[ActionType.SessionIsArchivedChanged]: true,
	[ActionType.SessionActivityChanged]: false,
	[ActionType.SessionChangesetsChanged]: false,
	[ActionType.SessionConfigChanged]: true,
	[ActionType.SessionMetaChanged]: false,
	[ActionType.ChatTurnStarted]: true,
	[ActionType.ChatDelta]: false,
	[ActionType.ChatResponsePart]: false,
	[ActionType.ChatToolCallStart]: false,
	[ActionType.ChatToolCallDelta]: false,
	[ActionType.ChatToolCallReady]: false,
	[ActionType.ChatToolCallConfirmed]: true,
	[ActionType.ChatToolCallComplete]: true,
	[ActionType.ChatToolCallResultConfirmed]: true,
	[ActionType.ChatToolCallContentChanged]: true,
	[ActionType.ChatToolCallAuthRequired]: false,
	[ActionType.ChatToolCallAuthResolved]: false,
	[ActionType.ChatTurnComplete]: false,
	[ActionType.ChatTurnCancelled]: true,
	[ActionType.ChatError]: false,
	[ActionType.ChatTurnResume]: true,
	[ActionType.ChatActivityChanged]: false,
	[ActionType.ChatWorkingDirectorySet]: true,
	[ActionType.ChatWorkingDirectoryRemoved]: true,
	[ActionType.ChatUsage]: false,
	[ActionType.ChatReasoning]: false,
	[ActionType.ChatPendingMessageSet]: true,
	[ActionType.ChatPendingMessageRemoved]: true,
	[ActionType.ChatQueuedMessagesReordered]: true,
	[ActionType.ChatDraftChanged]: true,
	[ActionType.ChatInputRequested]: false,
	[ActionType.ChatInputAnswerChanged]: true,
	[ActionType.ChatInputCompleted]: true,
	[ActionType.ChatTruncated]: true,
	[ActionType.ChatTurnsLoaded]: false,
	[ActionType.ChangesetStatusChanged]: false,
	[ActionType.ChangesetFileSet]: false,
	[ActionType.ChangesetFileRemoved]: false,
	[ActionType.ChangesetFilesReviewChanged]: true,
	[ActionType.ChangesetContentChanged]: false,
	[ActionType.ChangesetOperationsChanged]: false,
	[ActionType.ChangesetOperationStatusChanged]: false,
	[ActionType.ChangesetCleared]: false,
	[ActionType.AnnotationsSet]: true,
	[ActionType.AnnotationsUpdated]: true,
	[ActionType.AnnotationsRemoved]: true,
	[ActionType.AnnotationsEntrySet]: true,
	[ActionType.AnnotationsEntryRemoved]: true,
	[ActionType.TerminalData]: false,
	[ActionType.TerminalInput]: true,
	[ActionType.TerminalResized]: true,
	[ActionType.TerminalClaimed]: true,
	[ActionType.TerminalTitleChanged]: true,
	[ActionType.TerminalCwdChanged]: false,
	[ActionType.TerminalExited]: false,
	[ActionType.TerminalCleared]: true,
	[ActionType.TerminalCommandDetectionAvailable]: false,
	[ActionType.TerminalCommandExecuted]: false,
	[ActionType.TerminalCommandFinished]: false,
	[ActionType.ResourceWatchChanged]: false,
	[ActionType.AutomationCreateRequested]: true,
	[ActionType.AutomationUpdateRequested]: true,
	[ActionType.AutomationSet]: false,
	[ActionType.AutomationRemoved]: true,
	[ActionType.AutomationRunLifecycleChanged]: false,
	[ActionType.AutomationRunSessionSet]: false,
	[ActionType.AutomationRunSessionRemoved]: false,
	[ActionType.AutomationRunPrimarySessionChanged]: false,
	[ActionType.AutomationRunCancelRequested]: true,
};
